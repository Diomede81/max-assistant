import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, ReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { LockService } from '../lock/lock.service';
import { SealedStore } from '../memory/sealed-store';

interface Saved {
  /** off, on until `until` (a set time), or always on. */
  mode: AirPlayMode;
  until?: number;
  code: string;
  /** Before modes: just on/off (read once, then replaced). */
  enabled?: boolean;
}

export type AirPlayMode = 'off' | 'timed' | 'always';
/** How often the time limit is checked. */
const CHECK_MS = 30_000;

/**
 * AirPlay: Max appears as a speaker called "Max" on iPhones, iPads and Macs, so any app (Apple
 * Music, YouTube Music, podcasts...) can play through him. The receiver (shairport-sync) runs on
 * the box itself; Max tells it what to do through /run/max/airplay.json, and it restarts on its own
 * when that changes.
 *
 * Secured with a 6-digit code: the first time a device picks "Max", it asks for the code (shown on
 * the control panel) and remembers it. A new code means every device must enter it again.
 *
 * Off unless switched on, so a device nearby can't spend hours guessing the code: on for an hour,
 * four hours, or always (control panel, or "Max, turn on AirPlay for an hour"). When the time is up
 * it switches off by itself (after the music playing then has stopped). Off while Max is locked.
 */
@Injectable()
export class AirPlayService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AirPlay');
  private readonly store: SealedStore<Saved>;
  private saved: Saved = { mode: 'off', code: newCode() };
  /** What's playing over AirPlay, from the receiver's metadata. */
  now?: { title?: string; artist?: string; album?: string; since: number };
  /** The album art of what's playing, when the app sends it (Apple Music does). */
  cover?: { data: Buffer; type: string; id: number; at: number };
  private coverIds = 0;
  private reader?: ReadStream;
  private retry?: NodeJS.Timeout;
  private closed = false;
  private check?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Optional() private readonly lock?: LockService,
  ) {
    super();
    this.store = new SealedStore(cfg.memory.dir, 'airplay');
  }

  onModuleInit(): void {
    let changed = false;
    try {
      const s = this.store.load();
      if (s?.code) this.saved = { mode: s.mode ?? 'off', until: s.until, code: s.code };
      // From before time limits: off until switched on (it used to be on all the time).
      if (s && !s.mode) changed = true;
      // 4-digit codes (10,000 guesses) are replaced by 6-digit ones (a million): devices ask once.
      if (!s?.code || !/^\d{6}$/.test(s.code)) {
        this.saved.code = newCode();
        changed = true;
        if (s?.code) this.log.log('AirPlay code is now 6 digits: devices will ask for the new one once');
      }
    } catch {
      changed = true;
    }
    if (changed) this.persist();
    if (!this.onBox) return;
    this.apply();
    this.lock?.on('change', () => this.apply());
    this.readMetadata();
    this.check = setInterval(() => this.checkTime(), CHECK_MS);
  }

  onModuleDestroy(): void {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.check);
    this.reader?.destroy();
  }

  get onBox(): boolean {
    return this.cfg.face.onBox;
  }

  /** Switched on (always, or within its time). */
  get enabled(): boolean {
    return this.saved.mode === 'always' || (this.saved.mode === 'timed' && (Date.now() < (this.saved.until ?? 0) || this.active));
  }

  get mode(): AirPlayMode {
    return this.enabled ? this.saved.mode : 'off';
  }

  /** When a time-limited AirPlay switches off. */
  get until(): number | undefined {
    return this.saved.mode === 'timed' ? this.saved.until : undefined;
  }

  get code(): string {
    return this.saved.code;
  }

  /** Something is playing over AirPlay right now. */
  get active(): boolean {
    return Boolean(this.now);
  }

  /** On for `minutes` (then off by itself), or always (no minutes). */
  turnOn(minutes?: number): string {
    const timed = minutes !== undefined && minutes > 0;
    this.saved = { ...this.saved, mode: timed ? 'timed' : 'always', until: timed ? Date.now() + Math.min(minutes!, 24 * 60) * 60_000 : undefined };
    this.persist();
    this.apply();
    this.log.log(timed ? `AirPlay on for ${minutes} min` : 'AirPlay always on');
    const until = this.saved.until ? ` until ${clock(this.saved.until)}` : '';
    return `AirPlay is on${until || ' (until switched off)'}: pick "Max" as the speaker on your iPhone, iPad or Mac.`;
  }

  turnOff(): string {
    this.saved = { ...this.saved, mode: 'off', until: undefined };
    this.persist();
    this.apply();
    this.log.log('AirPlay off');
    return 'AirPlay is off.';
  }

  /** The time is up: off (if something is still playing, once it has stopped). */
  private checkTime(): void {
    if (this.saved.mode !== 'timed' || Date.now() < (this.saved.until ?? 0) || this.active) return;
    this.log.log('AirPlay time is up: switching off');
    this.turnOff();
  }

  /** A new code: every device has to enter it again. */
  renewCode(): string {
    this.saved.code = newCode();
    this.persist();
    this.apply();
    this.log.log('New AirPlay code set');
    return `New AirPlay code: ${this.saved.code}. Devices will ask for it the next time they connect.`;
  }

  private persist(): void {
    this.store.save(this.saved).catch((err) => this.log.warn(`Could not save the AirPlay settings: ${(err as Error).message}`));
  }

  /** Tells the box's AirPlay receiver what to do (it restarts on its own when this changes). */
  private apply(): void {
    if (!this.onBox) return;
    const locked = Boolean(this.lock?.locked);
    try {
      writeFileSync(
        join(this.cfg.face.runDir, 'airplay.json'),
        JSON.stringify({ enabled: this.enabled && !locked, name: 'Max', password: this.saved.code }),
        { mode: 0o600 },
      );
      if (locked && this.enabled) this.log.log('AirPlay is off until Max is unlocked');
    } catch (err) {
      this.log.warn(`Could not update the AirPlay receiver: ${(err as Error).message}`);
    }
  }

  // ---------- What's playing (the receiver's metadata pipe) ----------

  private readMetadata(): void {
    if (this.closed) return;
    const pipe = join(this.cfg.face.runDir, 'airplay-metadata');
    if (!existsSync(pipe)) {
      this.retry = setTimeout(() => this.readMetadata(), 30_000);
      return;
    }
    let buf = '';
    const r = createReadStream(pipe, { encoding: 'utf8' });
    this.reader = r;
    r.on('data', (chunk: string | Buffer) => {
      buf += chunk.toString();
      buf = this.parse(buf);
    });
    const again = () => {
      if (this.reader !== r) return;
      this.reader = undefined;
      this.retry = setTimeout(() => this.readMetadata(), 2000);
    };
    r.on('end', again);
    r.on('error', again);
  }

  /** Reads complete <item>s from the metadata text; returns what's left over. */
  parse(buf: string): string {
    const re = /<item><type>([0-9a-f]{8})<\/type><code>([0-9a-f]{8})<\/code><length>(\d+)<\/length>(?:\s*<data encoding="base64">\s*([^<]*)<\/data>)?\s*<\/item>/g;
    let m: RegExpExecArray | null;
    let used = 0;
    while ((m = re.exec(buf))) {
      used = re.lastIndex;
      const code = Buffer.from(m[2], 'hex').toString('latin1');
      const raw = m[4] ? Buffer.from(m[4].trim(), 'base64') : Buffer.alloc(0);
      if (code === 'PICT') this.picture(raw);
      else this.item(code, raw.toString('utf8').trim());
    }
    const rest = buf.slice(used);
    // Album art can be a few hundred KB; anything far bigger is a broken stream.
    return rest.length > 8_000_000 ? '' : rest;
  }

  private item(code: string, text: string): void {
    switch (code) {
      case 'pbeg': // playback begins
      case 'prsm': // resumed
        if (!this.now) {
          this.now = { since: Date.now() };
          this.log.log('AirPlay started');
          this.emit('start');
        }
        break;
      case 'pend': // playback ended
        if (this.now) this.log.log('AirPlay stopped');
        this.now = undefined;
        this.cover = undefined;
        break;
      case 'minm':
        if (!this.now) break;
        // A new song: its picture usually follows; drop the last song's (unless it just came in).
        if ((text || undefined) !== this.now.title && this.cover && Date.now() - this.cover.at > 5000) this.cover = undefined;
        this.now.title = text || undefined;
        break;
      case 'asar':
        if (this.now) this.now.artist = text || undefined;
        break;
      case 'asal':
        if (this.now) this.now.album = text || undefined;
        break;
    }
  }

  /** Album art (JPEG or PNG). An empty picture means the song has none. */
  private picture(data: Buffer): void {
    const type = data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : data.subarray(0, 4).toString('latin1') === '\x89PNG' ? 'image/png' : undefined;
    this.cover = type ? { data, type, id: ++this.coverIds, at: Date.now() } : undefined;
  }
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const clock = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: process.env.TZ || 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
