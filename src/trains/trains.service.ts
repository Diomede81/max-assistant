import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import QRCode from 'qrcode';
import { APP_CONFIG, AppConfig } from '../config';
import { SealedStore } from '../memory/sealed-store';
import { showCard } from '../face/screen';
import type { CardLine } from '../face/screen';
import { Station, STATIONS } from './stations';
import { stripTags } from '../text/markup';

/**
 * Live departure boards (Rail Data Marketplace). The product's address differs between its
 * versions, so both are tried (RAIL_DATA_URL overrides) and the one that answers is kept.
 */
const BOARD_URLS = [
  'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120',
  'https://api1.raildata.org.uk/1010-live-departure-board-dep/LDBWS/api/20220120',
];
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 12_000;
/** The journey card (with the Trainline QR code) stays up long enough to scan it. */
const JOURNEY_CARD_MS = 10 * 60_000;
const BOARD_CARD_MS = 3 * 60_000;

export interface TrainsStatus {
  departures: boolean;
  journeys: boolean;
  home?: Station;
}

type Json = Record<string, unknown>;

/**
 * Trains, for "when's the next train to Waterloo?" and "get me to Manchester by 10 tomorrow":
 *  - train_departures: the live departure board of a station (National Rail's own data, through the
 *    free Rail Data Marketplace): times, delays, cancellations, platforms and arrival times.
 *  - plan_train_journey: door-to-door train journeys with changes (Google Maps Routes API), shown on
 *    the screen with a QR code that opens Trainline for that route, to book in the app.
 * The home station (control panel, or HOME_STATION) is the default "from".
 */
@Injectable()
export class TrainsService implements OnModuleInit {
  private readonly log = new Logger('Trains');
  private readonly store: SealedStore<{ home?: string }>;
  private homeCrs = '';
  private boardUrl?: string;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'trains');
  }

  onModuleInit(): void {
    try {
      this.homeCrs = this.store.load()?.home ?? '';
    } catch {
      // the .env value
    }
    if (!this.homeCrs && this.cfg.trains.homeStation) this.homeCrs = resolveStation(this.cfg.trains.homeStation).station?.crs ?? '';
    if (this.cfg.trains.railDataKey || this.cfg.trains.googleMapsKey) {
      const parts = [this.cfg.trains.railDataKey && 'live departures', this.cfg.trains.googleMapsKey && 'journey planning'].filter(Boolean);
      this.log.log(`Trains: ${parts.join(' and ')}${this.home ? ` (home station ${this.home.name})` : ''}`);
    }
  }

  get status(): TrainsStatus {
    return { departures: Boolean(this.cfg.trains.railDataKey), journeys: Boolean(this.cfg.trains.googleMapsKey), home: this.home };
  }

  get home(): Station | undefined {
    return STATIONS.find((s) => s.crs === this.homeCrs);
  }

  /** Control panel: the home station, by name or code. */
  setHome(query: string): string {
    if (!query.trim()) {
      this.homeCrs = '';
      this.store.save({}).catch(() => undefined);
      return 'Home station cleared.';
    }
    const r = resolveStation(query);
    if (!r.station) return r.choices.length ? `Which one? ${r.choices.map((s) => s.name).join(', ')}.` : `No station called "${query}".`;
    this.homeCrs = r.station.crs;
    this.store.save({ home: this.homeCrs }).catch((err) => this.log.warn(`Could not save the home station: ${(err as Error).message}`));
    return `Home station: ${r.station.name} (${r.station.crs}).`;
  }

  // ---------- Actions for the AI model ----------

  get tools(): ChatCompletionTool[] {
    const out: ChatCompletionTool[] = [];
    const home = this.home ? ` Leave it out for the user's home station, ${this.home.name}.` : '';
    if (this.cfg.trains.railDataKey) {
      out.push({
        type: 'function',
        function: {
          name: 'train_departures',
          description:
            'Live train departures from a UK station (National Rail): times, delays, cancellations, platforms, and the ' +
            'arrival time at a destination. Use for "when is the next train to...", "is the 8:15 on time?", "trains to ' +
            'London". Shows the board on the screen. Say the next two or three trains briefly. Call it every time the user ' +
            'wants to see the trains: never say they are on the screen without calling it.',
          parameters: {
            type: 'object',
            properties: {
              from: { type: 'string', description: `Station to depart from (name or 3-letter code).${home}` },
              to: { type: 'string', description: 'Only trains calling at this station (name or code), e.g. "London Waterloo". Optional.' },
              count: { type: 'integer', description: 'How many trains (default 5, at most 10).' },
            },
          },
        },
      });
    }
    if (this.cfg.trains.googleMapsKey) {
      out.push({
        type: 'function',
        function: {
          name: 'plan_train_journey',
          description:
            'Plan a UK train journey, with changes, for a time: "trains to Manchester tomorrow morning", "get me to Bath by ' +
            '10am on Saturday". Shows the options on the screen with a QR code to book on Trainline. Say the best one or ' +
            'two options briefly (leave, arrive, changes) and that the QR code on the screen opens Trainline to book. ' +
            'Ticket prices are only known by Trainline: never guess them. Call it again every time the user asks to see the ' +
            'journey or the QR code again: never say it is on the screen without calling it.',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Destination: a station, town or address in the UK.' },
              from: { type: 'string', description: `Where from: a station, town or address.${home}` },
              time: { type: 'string', description: 'Local date and time, as YYYY-MM-DDTHH:MM (e.g. 2026-10-17T08:00). Leave out for now.' },
              time_is: { type: 'string', enum: ['depart', 'arrive'], description: '"depart": leave at/after the time (default). "arrive": arrive by the time.' },
            },
            required: ['to'],
          },
        },
      });
    }
    return out;
  }

  has(name: string): boolean {
    return name === 'train_departures' || name === 'plan_train_journey';
  }

  async call(name: string, args: Json): Promise<string> {
    if (name === 'train_departures') return this.departures(str(args.from), str(args.to), Number(args.count) || 5);
    return this.journey(str(args.to), str(args.from), str(args.time), args.time_is === 'arrive' ? 'arrive' : 'depart');
  }

  // ---------- Live departures ----------

  async departures(fromQ: string, toQ: string, count: number): Promise<string> {
    if (!this.cfg.trains.railDataKey) return 'Live train times are not set up (RAIL_DATA_KEY in .env, see docs/TRAINS.md).';
    const from = fromQ ? resolveStation(fromQ) : { station: this.home, choices: [] };
    if (!from.station) return fromQ ? ambiguity(fromQ, from.choices) : 'Ask the user which station they are leaving from (no home station is set).';
    const to = toQ ? resolveStation(toQ) : undefined;
    if (to && !to.station) return ambiguity(toQ, to.choices);
    const n = Math.max(1, Math.min(10, Math.round(count)));
    const board = await this.board(from.station.crs, to?.station?.crs, n);
    const services = list(get(board, 'trainServices'));
    const notices = list(get(board, 'nrccMessages'))
      .map((m) => clean(String(get(m, 'Value') ?? get(m, 'value') ?? '')))
      .filter(Boolean)
      .slice(0, 2);
    const where = `${from.station.name}${to?.station ? ` to ${to.station.name}` : ''}`;
    if (!services.length) {
      showCard({ id: 'trains', kind: 'list', icon: '🚆', title: `Trains from ${from.station.name}`, subtitle: to?.station ? `to ${to.station.name}` : undefined, big: 'No trains in the next two hours', body: notices.join('\n\n') || undefined, ttlMs: BOARD_CARD_MS });
      return `No trains from ${where} in the next two hours.${notices.length ? ` Notice: ${notices.join(' ')}` : ''}`;
    }
    const trains = services.slice(0, n).map((s) => this.service(s, to?.station?.crs));
    showCard({
      id: 'trains',
      kind: 'list',
      icon: '🚆',
      title: `Trains from ${from.station.name}`,
      subtitle: to?.station ? `to ${to.station.name}` : 'Live departures',
      lines: trains.map((t): CardLine => ({
        time: t.time,
        text: `${t.destination}${t.arrives ? `  → ${t.arrives}` : ''}`,
        sub: [t.status, t.platform ? `Platform ${t.platform}` : '', t.operator].filter(Boolean).join(' · '),
      })),
      body: notices[0],
      ttlMs: BOARD_CARD_MS,
    });
    const rows = trains.map(
      (t) =>
        `- ${t.time} to ${t.destination}: ${t.status}${t.platform ? `, platform ${t.platform}` : ''}` +
        `${t.arrives ? `, arrives ${to?.station?.name} ${t.arrives}` : ''}${t.reason ? ` (${t.reason})` : ''}${t.operator ? ` [${t.operator}]` : ''}`,
    );
    return `Live departures from ${where}:\n${rows.join('\n')}${notices.length ? `\nNotice: ${notices.join(' ')}` : ''}`;
  }

  private service(s: unknown, toCrs?: string) {
    const std = String(get(s, 'std') ?? '');
    const etd = String(get(s, 'etd') ?? '');
    const cancelled = get(s, 'isCancelled') === true || /cancel/i.test(etd);
    const status = cancelled ? 'Cancelled' : /on time/i.test(etd) ? 'On time' : /delayed/i.test(etd) ? 'Delayed' : /^\d\d:\d\d$/.test(etd) ? `Expected ${etd}` : etd || 'Scheduled';
    const destination = list(get(s, 'destination')).map((l) => String(get(l, 'locationName') ?? '')).filter(Boolean).join(' & ') || '?';
    let arrives: string | undefined;
    if (toCrs) {
      const stop = list(get(s, 'subsequentCallingPoints'))
        .flatMap((l) => list(get(l, 'callingPoint')))
        .find((c) => String(get(c, 'crs') ?? '').toUpperCase() === toCrs);
      if (stop) {
        const et = String(get(stop, 'et') ?? '');
        arrives = /^\d\d:\d\d$/.test(et) ? et : String(get(stop, 'st') ?? '') || undefined;
      }
    }
    const reason = clean(String(get(s, cancelled ? 'cancelReason' : 'delayReason') ?? ''));
    return { time: std, status, destination, arrives, platform: String(get(s, 'platform') ?? '') || undefined, operator: String(get(s, 'operator') ?? '') || undefined, reason: reason || undefined };
  }

  /** National Rail's departure board for a station (with each train's calling points). */
  private async board(crs: string, filterCrs: string | undefined, rows: number): Promise<unknown> {
    const qs = new URLSearchParams({ numRows: String(rows), timeWindow: '120' });
    if (filterCrs) {
      qs.set('filterCrs', filterCrs);
      qs.set('filterType', 'to');
    }
    const urls = this.cfg.trains.railDataUrl ? [this.cfg.trains.railDataUrl.replace(/\/$/, '')] : this.boardUrl ? [this.boardUrl] : BOARD_URLS;
    let last = '';
    for (const base of urls) {
      const res = await fetch(`${base}/GetDepBoardWithDetails/${crs}?${qs}`, {
        headers: { 'x-apikey': this.cfg.trains.railDataKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('the rail data key was refused: check RAIL_DATA_KEY, and that the "Live Departure Board" product is subscribed on raildata.org.uk');
      }
      if (res.status === 404 && urls.length > 1) {
        last = `${res.status} at ${base}`;
        continue;
      }
      if (!res.ok) throw new Error(`the departure board answered ${res.status} ${(await res.text()).slice(0, 160)}`);
      this.boardUrl = base;
      return res.json();
    }
    throw new Error(`the departure board address wasn't found (${last}); set RAIL_DATA_URL from the product's Specification tab`);
  }

  // ---------- Journey planning ----------

  async journey(toQ: string, fromQ: string, time: string, timeIs: 'depart' | 'arrive'): Promise<string> {
    if (!this.cfg.trains.googleMapsKey) return 'Journey planning is not set up (GOOGLE_MAPS_API_KEY in .env, see docs/TRAINS.md).';
    if (!toQ) return 'Ask the user where they want to go.';
    const from = this.place(fromQ) ?? (this.home ? { text: `${this.home.name} station, UK`, station: this.home } : undefined);
    if (!from) return 'Ask the user where they are leaving from (no home station is set).';
    const to = this.place(toQ)!;
    const when = time ? localTime(time) : undefined;
    if (time && !when) return `"${time}" isn't a date and time like 2026-10-17T08:00.`;
    const body: Json = {
      origin: { address: from.text },
      destination: { address: to.text },
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: true,
      transitPreferences: { allowedTravelModes: ['RAIL'] },
      languageCode: 'en-GB',
      regionCode: 'GB',
    };
    if (when) body[timeIs === 'arrive' ? 'arrivalTime' : 'departureTime'] = when.toISOString();
    const res = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.cfg.trains.googleMapsKey,
        'X-Goog-FieldMask': 'routes.duration,routes.localizedValues,routes.legs.steps.travelMode,routes.legs.steps.transitDetails',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      if (res.status === 403 || /API_KEY|PERMISSION_DENIED|billing/i.test(text)) {
        throw new Error(`Google refused the key: check GOOGLE_MAPS_API_KEY, that the Routes API is enabled and billing is set up (${text.slice(0, 120)})`);
      }
      throw new Error(`Google Maps answered ${res.status}: ${text}`);
    }
    const routes = list(get(await res.json(), 'routes')).map((r) => this.route(r)).filter((r): r is Trip => Boolean(r));
    if (!routes.length) return `No train journey found from ${from.text} to ${to.text}${when ? ' at that time' : ''}.`;
    // "Arrive by": the ones that make it, latest departure first. Otherwise the earliest first.
    const inTime = timeIs === 'arrive' && when ? routes.filter((r) => r.arrive <= when.getTime()) : routes;
    const trips = (inTime.length ? inTime : routes).sort((a, b) => (timeIs === 'arrive' ? b.depart - a.depart : a.depart - b.depart)).slice(0, 3);

    // Trainline for the stations the trains actually use (the user's own words if they were stations).
    const a = from.station?.name ?? trips[0].fromStop;
    const b = to.station?.name ?? trips[0].toStop;
    const link = `https://www.thetrainline.com/en/train-times/${slug(a)}-to-${slug(b)}`;
    const qr = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f14', light: '#ffffff' } });
    // Short, so the QR code has room: the route, the options on one line each, where to change.
    showCard({
      id: 'journey',
      kind: 'list',
      icon: '🚆',
      title: `${shortName(a)} → ${shortName(b)}`,
      subtitle: `${when ? `${timeIs === 'arrive' ? 'Arrive by' : 'From'} ${dayTime(when)}` : 'Leaving now'} · scan to book`,
      image: `data:image/svg+xml;base64,${Buffer.from(qr).toString('base64')}`,
      lines: trips.slice(0, 2).map((t) => ({
        time: hm(t.depart),
        text: `→ ${hm(t.arrive)} · ${t.duration} · ${t.changes ? `${t.changes} change${t.changes > 1 ? 's' : ''}` : 'direct'}`,
        sub: t.changes ? `via ${t.legs.slice(1).map((l) => l.from).join(', ')}` : undefined,
      })),
      ttlMs: JOURNEY_CARD_MS,
    });
    const rows = trips.map(
      (t) =>
        `- Leave ${hm(t.depart)} (${dayName(t.depart)}), arrive ${hm(t.arrive)}, ${t.duration}, ${t.changes ? `${t.changes} change${t.changes > 1 ? 's' : ''}` : 'direct'}: ` +
        t.legs.map((l) => `${hm(l.depart)} ${l.line || 'train'} ${l.from} to ${l.to}`).join('; ') +
        (t.fare ? ` (fare from Google: ${t.fare})` : ''),
    );
    return `Train journeys from ${from.station?.name ?? from.text} to ${to.station?.name ?? to.text}:\n${rows.join('\n')}\nThe options and a QR code to book on Trainline are on the screen now. If the user asks to see them again later, call plan_train_journey again (the card is only on the screen when you call it).`;
  }

  /** A station by name (sent to Google as "<name> station"), or any other place as said. */
  private place(q: string): { text: string; station?: Station } | undefined {
    if (!q.trim()) return undefined;
    const r = resolveStation(q);
    if (r.station) return { text: `${r.station.name} station, UK`, station: r.station };
    return { text: /\b(uk|united kingdom|england|scotland|wales)\b/i.test(q) ? q : `${q}, UK` };
  }

  private route(r: unknown): Trip | undefined {
    const steps = list(get(r, 'legs')).flatMap((l) => list(get(l, 'steps')));
    const legs = steps
      .map((s) => get(s, 'transitDetails'))
      .filter(Boolean)
      .map((d) => {
        const stops = get(d, 'stopDetails');
        const line = get(d, 'transitLine');
        const vehicle = String(get(get(line, 'vehicle'), 'type') ?? '');
        const name = String(get(line, 'nameShort') ?? '') || String(get(line, 'name') ?? '') || String(get(list(get(line, 'agencies'))[0], 'name') ?? '');
        return {
          from: shortName(String(get(get(stops, 'departureStop'), 'name') ?? '')),
          to: shortName(String(get(get(stops, 'arrivalStop'), 'name') ?? '')),
          depart: Date.parse(String(get(stops, 'departureTime') ?? '')),
          arrive: Date.parse(String(get(stops, 'arrivalTime') ?? '')),
          line: vehicle === 'SUBWAY' ? (name ? `${name} (Tube)` : 'Tube') : name,
        };
      })
      .filter((l) => Number.isFinite(l.depart) && Number.isFinite(l.arrive));
    if (!legs.length) return undefined;
    const depart = legs[0].depart;
    const arrive = legs[legs.length - 1].arrive;
    const secs = parseInt(String(get(r, 'duration') ?? ''), 10) || Math.round((arrive - depart) / 1000);
    const fare = String(get(get(get(r, 'localizedValues'), 'transitFare'), 'text') ?? '') || undefined;
    return { depart, arrive, duration: span(secs), changes: legs.length - 1, legs, fromStop: legs[0].from, toStop: legs[legs.length - 1].to, fare };
  }
}

interface Trip {
  depart: number;
  arrive: number;
  duration: string;
  changes: number;
  legs: { from: string; to: string; depart: number; arrive: number; line: string }[];
  fromStop: string;
  toStop: string;
  fare?: string;
}

// ---------- Stations ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\bst\.?\b/g, 'st')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A station from what the user said ("Twickenham", "Waterloo", "TWI"), or the candidates if unclear. */
export function resolveStation(query: string): { station?: Station; choices: Station[] } {
  const raw = query.trim();
  // A 3-letter code ("TWI"), unless it's also a station's name ("Ely").
  if (/^[A-Za-z]{3}$/.test(raw) && !STATIONS.some((s) => norm(s.name) === norm(raw))) {
    const byCode = STATIONS.find((s) => s.crs === raw.toUpperCase());
    if (byCode) return { station: byCode, choices: [] };
  }
  const q = norm(raw.replace(/\b(train|railway|rail)?\s*station\b/gi, ' '));
  if (!q) return { choices: [] };
  const exact = STATIONS.filter((s) => norm(s.name) === q);
  if (exact.length === 1) return { station: exact[0], choices: [] };
  // "Waterloo", "Paddington", "Kings Cross": the London terminal.
  const londonExact = STATIONS.find((s) => norm(s.name) === `london ${q}`);
  if (londonExact) return { station: londonExact, choices: [] };
  const london = STATIONS.filter((s) => norm(s.name).startsWith(`london ${q} `));
  if (london.length === 1) return { station: london[0], choices: [] };
  const starts = STATIONS.filter((s) => norm(s.name).startsWith(`${q} `));
  const words = STATIONS.filter((s) => ` ${norm(s.name)} `.includes(` ${q} `));
  const found = exact.length ? exact : starts.length ? starts : words;
  if (found.length === 1) return { station: found[0], choices: [] };
  return { choices: found.slice(0, 6) };
}

function ambiguity(q: string, choices: Station[]): string {
  return choices.length ? `"${q}" could be several stations: ${choices.map((s) => s.name).join(', ')}. Ask the user which one.` : `There's no station called "${q}". Ask the user to say it again.`;
}

const shortName = (s: string) => s.replace(/\s+(Rail(way)? )?Station$/i, '').replace(/\s+Underground Station$/i, '').trim();
const slug = (s: string) =>
  shortName(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------- Small helpers ----------

/** A key from National Rail's data, whatever its capitalisation (trainServices / TrainServices). */
function get(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  const rec = o as Json;
  if (key in rec) return rec[key];
  const k = Object.keys(rec).find((x) => x.toLowerCase() === key.toLowerCase());
  return k ? rec[k] : undefined;
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const clean = (s: string) => stripTags(s.slice(0, 20_000)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tz = () => process.env.TZ || 'Europe/London';
const hm = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const dayName = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'long', day: 'numeric', month: 'long' }).format(ms);
const dayTime = (d: Date) => `${new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short' }).format(d)} ${hm(d.getTime())}`;
const span = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
};

/** "2026-10-17T08:00" in the box's time zone, as an instant. */
export function localTime(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment (e.g. +60 min in British Summer Time).
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asLocal = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'));
  return new Date(guess - (asLocal - guess));
}
