import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { timeZone } from '../actions/clock';
import { McpServersService } from '../mcp/mcp-servers.service';
import { ModesService } from '../memory/modes.service';
import { localToday } from '../memory/projects.service';
import { SealedStore } from '../memory/sealed-store';
import { TodoService } from '../memory/todo.service';
import { Weather, WeatherService } from '../weather/weather.service';
import { CalEvent, extractEvents } from './events';
import { LockService } from '../lock/lock.service';

export interface Glance {
  weather?: { icon: string; temp: number; text: string; hi?: number; lo?: number; rain?: number };
  /** The next meeting today (or the one going on now). */
  next?: { time: string; title: string; now: boolean };
  todos?: { critical: number; overdue: number; today: number };
  /** Evening photo frame: on now, with these pictures (served at /photos/<name>). */
  frame?: { photos: string[]; everySec: number };
}

export interface AmbientSettings {
  glance: boolean;
  frame: boolean;
  frameFrom: string;
  frameTo: string;
  frameEverySec: number;
  /** Live captions under the face: what Max heard and what he says. Off unless switched on. */
  captions: boolean;
  /** Notifications on the screen (NotifyService). */
  notifyBriefing: boolean;
  notifyEmail: boolean;
  notifyTodos: boolean;
}

const CAL_MS = 20 * 60_000;
const PHOTO_MAX = 15 * 1024 * 1024;
const PHOTO_EXT: Record<string, string> = { ffd8ff: 'jpg', '89504e': 'png', '524946': 'webp' };

/**
 * What the screen shows around Max's face when nothing is happening: the weather, the next
 * meeting and the to-dos that matter ("2 critical · 1 overdue"); and, in the evening, a photo
 * frame of your own pictures. In guest mode only the time and weather show: visitors don't
 * see meetings or to-dos. The next meeting comes from the calendar app of the current mode,
 * checked quietly every 20 minutes (and whenever Max reads the calendar for you).
 */
@Injectable()
export class AmbientService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Ambient');
  private readonly store: SealedStore<AmbientSettings>;
  settings: AmbientSettings = { glance: true, frame: false, frameFrom: '19:00', frameTo: '23:00', frameEverySec: 20, captions: false, notifyBriefing: true, notifyEmail: true, notifyTodos: true };
  private events: { list: CalEvent[]; at: number; mode: string } = { list: [], at: 0, mode: '' };
  private timer?: NodeJS.Timeout;
  private readonly photoDir: string;
  private photoList: { names: string[]; at: number } = { names: [], at: 0 };

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Optional() private readonly weather?: WeatherService,
    @Optional() private readonly todos?: TodoService,
    @Optional() private readonly modes?: ModesService,
    @Optional() private readonly mcp?: McpServersService,
    @Optional() private readonly lock?: LockService,
  ) {
    this.store = new SealedStore(cfg.memory.dir, 'screen');
    this.photoDir = join(cfg.memory.dir, 'photos');
  }

  onModuleInit(): void {
    try {
      this.settings = { ...this.settings, ...(this.store.load() ?? {}) };
    } catch {
      // defaults
    }
    if (!this.cfg.face.enabled) return;
    setTimeout(() => void this.refreshCalendar(), 30_000);
    this.timer = setInterval(() => void this.refreshCalendar(), CAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  save(changes: Partial<AmbientSettings>): string {
    const t = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (changes.frameFrom !== undefined && !t.test(changes.frameFrom)) return 'Times must be like 19:00.';
    if (changes.frameTo !== undefined && !t.test(changes.frameTo)) return 'Times must be like 23:00.';
    if (changes.frameEverySec !== undefined) changes.frameEverySec = Math.max(5, Math.min(600, Math.round(changes.frameEverySec) || 20));
    this.settings = { ...this.settings, ...changes };
    this.store.save(this.settings).catch((err) => this.log.warn(`Could not save the screen settings: ${(err as Error).message}`));
    return 'Saved the screen settings.';
  }

  /** What's around the face right now. */
  glance(): Glance | undefined {
    if (!this.settings.glance && !this.settings.frame) return undefined;
    const guest = this.modes?.mode === 'guest';
    const w = this.weather?.now;
    const out: Glance = {};
    if (this.settings.glance) {
      if (w) out.weather = { icon: w.icon, temp: w.temp, text: w.text, hi: w.hi, lo: w.lo, rain: w.rain };
      if (!guest) {
        out.next = this.nextEvent();
        out.todos = this.todoCounts();
      }
    }
    if (this.settings.frame && this.inFrameHours()) {
      if (Date.now() - this.photoList.at > 30_000) this.photoList = { names: this.photos().map((p) => p.name), at: Date.now() };
      const photos = this.photoList.names;
      if (photos.length) out.frame = { photos, everySec: this.settings.frameEverySec };
    }
    return out;
  }

  get weatherNow(): Weather | undefined {
    return this.weather?.now;
  }

  /** Events Max just read for you (a calendar question): the glance uses them too. */
  noteEvents(list: CalEvent[]): void {
    if (list.length) this.events = { list, at: Date.now(), mode: this.modes?.mode ?? '' };
  }

  /** Today's events from what's known (for the "Your day" card when the face is tapped). */
  todaysEvents(): CalEvent[] {
    const today = localToday();
    if (this.events.mode !== (this.modes?.mode ?? '')) return [];
    return this.events.list.filter((e) => this.dayOf(e.start) === today);
  }

  private nextEvent(): Glance['next'] {
    const now = Date.now();
    const e = this.todaysEvents().find((x) => !x.allDay && (x.end ?? x.start + 30 * 60_000) > now);
    if (!e) return undefined;
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(e.start);
    return { time, title: e.title, now: e.start <= now };
  }

  private todoCounts(): Glance['todos'] {
    if (!this.todos) return undefined;
    const today = localToday();
    let critical = 0;
    let overdue = 0;
    let dueToday = 0;
    for (const { task } of this.todos.items()) {
      const d = task.due?.slice(0, 10);
      if (d && d < today) overdue++;
      else if (d === today) dueToday++;
      if (task.criticality === 'critical') critical++;
    }
    return critical || overdue || dueToday ? { critical, overdue, today: dueToday } : undefined;
  }

  private dayOf(ms: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(ms);
  }

  private inFrameHours(): boolean {
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const { frameFrom: a, frameTo: b } = this.settings;
    return a <= b ? t >= a && t < b : t >= a || t < b;
  }

  // ---------- The next meeting, quietly ----------

  /**
   * Asks the current mode's calendar app for the next 36 hours, without the AI model (and
   * without showing "Checking your calendar"): the app's action that lists events, with the
   * time range filled in from its own description. Skipped in guest mode and at night.
   */
  async refreshCalendar(): Promise<void> {
    if (!this.settings.glance || !this.mcp || this.modes?.mode === 'guest' || this.lock?.locked) return;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (hour < 6 || hour >= 23) return;
    const pick = this.calendarAction();
    if (!pick) return;
    try {
      const server = this.mcp.serverFor(pick.name);
      if (!server) return;
      const out = await server.call(pick.name, pick.args);
      const list = extractEvents(out);
      this.events = { list, at: Date.now(), mode: this.modes?.mode ?? '' };
    } catch (err) {
      this.log.debug(`Calendar check failed (${pick.name}): ${(err as Error).message}`);
    }
  }

  /** The calendar app's "list events" action and arguments for now → +36 h, if one is connected. */
  calendarAction(now = Date.now()): { name: string; args: Record<string, unknown> } | undefined {
    const tools = (this.mcp?.tools ?? []).filter((t): t is Extract<ChatCompletionTool, { type: 'function' }> => t.type === 'function');
    const rank = (n: string) =>
      /(CREATE|UPDATE|DELETE|CANCEL|ACCEPT|DECLINE|RESPOND|MOVE|QUICK_ADD|REMOVE|PATCH)/i.test(n) ? -1
        : /CALENDAR_?VIEW/i.test(n) ? 3
          : /(LIST|FIND|SEARCH|GET).*EVENTS?$|EVENTS?_(LIST|SEARCH)$/i.test(n) && /(CALENDAR|OUTLOOK|EVENT)/i.test(n) ? 2
            : -1;
    const candidates = tools.map((t) => ({ t, r: rank(t.function.name) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r);
    for (const { t } of candidates) {
      const schema = (t.function.parameters ?? {}) as { properties?: Record<string, { type?: string }>; required?: string[] };
      const props = schema.properties ?? {};
      const args: Record<string, unknown> = {};
      const from = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const to = new Date(now + 36 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      for (const key of Object.keys(props)) {
        const k = key.toLowerCase().replace(/[^a-z]/g, '');
        if (/^(start|startdatetime|startdate|starttime|timemin|from|after|mintime)$/.test(k)) args[key] = from;
        else if (/^(end|enddatetime|enddate|endtime|timemax|to|before|maxtime)$/.test(k)) args[key] = to;
        else if (/^(calendarid|calendar)$/.test(k)) args[key] = 'primary';
        else if (/^(singleevents|expandrecurring)$/.test(k) && props[key].type === 'boolean') args[key] = true;
        else if (/^(timezone|tz|timezoneid)$/.test(k)) args[key] = 'UTC';
        else if (/^(maxresults|top|limit|count)$/.test(k) && props[key].type !== 'string') args[key] = 25;
      }
      const hasRange = Object.values(args).includes(from);
      const missing = (schema.required ?? []).filter((r) => !(r in args));
      if (hasRange && !missing.length) return { name: t.function.name, args };
    }
    return undefined;
  }

  // ---------- Photos for the frame ----------

  photos(): { name: string; size: number; at: number }[] {
    try {
      return readdirSync(this.photoDir)
        .filter((n) => /^[a-z0-9-]+\.(jpg|png|webp)$/.test(n))
        .map((n) => {
          const st = statSync(join(this.photoDir, n));
          return { name: n, size: st.size, at: st.mtimeMs };
        })
        .sort((a, b) => a.at - b.at);
    } catch {
      return [];
    }
  }

  /** Saves an uploaded picture (JPEG, PNG or WebP, up to 15 MB). Returns its name or an error. */
  addPhoto(data: Buffer): { name?: string; error?: string } {
    if (data.length > PHOTO_MAX) return { error: 'That picture is too large (15 MB at most).' };
    const ext = PHOTO_EXT[data.subarray(0, 3).toString('hex')];
    if (!ext || (ext === 'webp' && data.subarray(8, 12).toString() !== 'WEBP')) return { error: 'Only JPEG, PNG or WebP pictures.' };
    mkdirSync(this.photoDir, { recursive: true });
    const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${ext}`;
    writeFileSync(join(this.photoDir, name), data);
    this.photoList.at = 0;
    return { name };
  }

  removePhoto(name: string): boolean {
    if (!/^[a-z0-9-]+\.(jpg|png|webp)$/.test(name)) return false;
    try {
      unlinkSync(join(this.photoDir, name));
      this.photoList.at = 0;
      return true;
    } catch {
      return false;
    }
  }

  /** A photo's bytes and type, for the screen and the control panel (safe names only). */
  photo(name: string): { data: Buffer; type: string } | undefined {
    const m = /^[a-z0-9-]+\.(jpg|png|webp)$/.exec(name);
    if (!m) return undefined;
    try {
      return { data: readFileSync(join(this.photoDir, name)), type: m[1] === 'jpg' ? 'image/jpeg' : `image/${m[1]}` };
    } catch {
      return undefined;
    }
  }
}
