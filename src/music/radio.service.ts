import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { APP_CONFIG, AppConfig } from '../config';
import { LocationService } from '../location/location.service';
import { SealedStore } from '../memory/sealed-store';
import { setSinkInputVolume, sinkInputs } from './sink-inputs';

export interface Station {
  name: string;
  url: string;
  favicon?: string;
  country?: string;
  tags?: string;
}

/** radio-browser.info: a free, open directory of ~50,000 stations (no account, no key). */
const DIRECTORY = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];
const STREAM_NAME = 'Max radio';
const RESTART_MS = 3000;

interface DirStation {
  name: string;
  url_resolved?: string;
  url?: string;
  favicon?: string;
  countrycode?: string;
  tags?: string;
  lastcheckok?: number;
  clickcount?: number;
  bitrate?: number;
}

/**
 * Internet radio on Max's own speaker: "play BBC Radio 2", "play some jazz radio". Stations come
 * from the free radio-browser.info directory; ffmpeg plays the stream into the box's sound system
 * (same speaker and echo cancellation as Max's voice). The song title is shown when the station
 * sends it. The last station is remembered ("play the radio").
 */
@Injectable()
export class RadioService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Radio');
  private readonly store: SealedStore<{ last?: Station }>;
  /** ffmpeg is installed (in the Docker image). */
  available = false;
  current?: { station: Station; song?: string; since: number };
  private last?: Station;
  private proc?: ChildProcess;
  private stopping = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Optional() private readonly location?: LocationService,
  ) {
    this.store = new SealedStore(cfg.memory.dir, 'radio');
  }

  onModuleInit(): void {
    this.available = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
    try {
      this.last = this.store.load()?.last;
    } catch {
      // none yet
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  get playing(): boolean {
    return Boolean(this.proc && this.current);
  }

  /** "BBC Radio 2", "jazz", "Italian news"... or nothing for the last station. */
  async play(query: string): Promise<string> {
    if (!this.available) return 'Internet radio needs ffmpeg, which is part of the Max box image (update Max to get it).';
    const q = query.trim();
    const station = q && !/^(the )?radio$|^(my|last|previous) (radio|station)$/i.test(q) ? await this.find(q) : this.last;
    if (!station) return q ? `I couldn't find a radio station for "${q}".` : 'Which station? For example "BBC Radio 2" or "jazz radio".';
    this.start(station);
    this.last = station;
    this.store.save({ last: station }).catch(() => undefined);
    return `Playing ${station.name}${station.country ? ` (${station.country})` : ''}.`;
  }

  stop(): string {
    if (!this.proc) return 'The radio is off.';
    this.stopping = true;
    this.proc.kill('SIGTERM');
    this.proc = undefined;
    const name = this.current?.station.name;
    this.current = undefined;
    return `Stopped ${name ?? 'the radio'}.`;
  }

  /** Volume of the radio stream (% of full). */
  async volume(): Promise<number | undefined> {
    return (await this.stream())?.volume;
  }

  async setVolume(pct: number): Promise<boolean> {
    const s = await this.stream();
    if (!s) return false;
    await setSinkInputVolume(s.index, pct);
    return true;
  }

  private async stream() {
    return (await sinkInputs()).find((s) => s.names.includes(STREAM_NAME.toLowerCase()));
  }

  private start(station: Station, attempt = 0): void {
    if (this.proc) {
      this.stopping = true;
      this.proc.kill('SIGTERM');
    }
    this.stopping = false;
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'info'];
    if (/^https?:/i.test(station.url)) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    args.push('-i', station.url, '-vn', '-f', 'pulse', '-name', STREAM_NAME, '-stream_name', station.name.slice(0, 60), 'default');
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = proc;
    this.current = { station, since: Date.now() };
    this.log.log(`Playing ${station.name} (${station.url})`);
    let err = '';
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (d: string) => {
      err = (err + d).slice(-2000);
      // Song titles some stations send ("StreamTitle: Artist - Song").
      const m = /StreamTitle\s*:\s*(.*)/.exec(d);
      if (m && this.current && this.proc === proc) this.current.song = m[1].trim().slice(0, 120) || undefined;
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return; // replaced or stopped on purpose
      const ranFor = Date.now() - (this.current?.since ?? Date.now());
      this.proc = undefined;
      if (this.stopping) return;
      // A dropped stream: try again once (or again later if it had played for a while).
      if (attempt < 1 || ranFor > 60_000) {
        this.log.warn(`${station.name} stopped (${code}); reconnecting`);
        setTimeout(() => {
          if (!this.proc && this.current?.station === station) this.start(station, ranFor > 60_000 ? 0 : attempt + 1);
        }, RESTART_MS);
        return;
      }
      this.log.warn(`${station.name} can't be played: ${err.split('\n').filter(Boolean).slice(-2).join(' ')}`);
      this.current = undefined;
    });
  }

  // ---------- Finding a station ----------

  async find(query: string): Promise<Station | undefined> {
    // The name as said first ("BBC Radio 2"), then without the words around it ("some jazz radio" -> "jazz").
    const full = query.replace(/^(the|some|a|an)\s+/i, '').trim();
    const bare = full.replace(/\b(radio station|station|radio|music)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    let q = full;
    let list = await this.search({ name: full });
    if (!list.length && bare && bare !== full) list = await this.search({ name: (q = bare) });
    if (!list.length && (bare || full)) list = await this.search({ tag: (q = bare || full).toLowerCase() });
    if (!list.length) return undefined;
    const home = (this.location?.home?.country ?? '').toUpperCase();
    const want = norm(q);
    const score = (s: DirStation) =>
      (norm(s.name) === want ? 100 : 0) +
      (norm(s.name).startsWith(want) ? 30 : norm(s.name).includes(want) ? 20 : 0) +
      Math.log10((s.clickcount ?? 0) + 1) * 8 +
      (home && s.countrycode === home ? 12 : 0) +
      ((s.bitrate ?? 0) >= 96 ? 3 : 0);
    const best = [...list].sort((a, b) => score(b) - score(a))[0];
    return {
      name: best.name.trim(),
      url: (best.url_resolved || best.url)!,
      favicon: best.favicon && /^https:\/\//.test(best.favicon) ? best.favicon : undefined,
      country: best.countrycode || undefined,
      tags: best.tags || undefined,
    };
  }

  private async search(params: Record<string, string>): Promise<DirStation[]> {
    const qs = new URLSearchParams({ ...params, hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '20' });
    for (const base of DIRECTORY) {
      try {
        const res = await fetch(`${base}/json/stations/search?${qs}`, { headers: { 'User-Agent': 'max-assistant/1.0' }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const list = (await res.json()) as DirStation[];
        return list.filter((s) => s.lastcheckok !== 0 && (s.url_resolved || s.url));
      } catch {
        // try the next directory server
      }
    }
    throw new Error('the radio directory is unreachable');
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
