import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, ReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { LockService } from '../lock/lock.service';
import { SealedStore } from '../memory/sealed-store';

interface Saved {
  enabled: boolean;
  code: string;
}

/**
 * AirPlay: Max appears as a speaker called "Max" on iPhones, iPads and Macs, so any app (Apple
 * Music, YouTube Music, podcasts...) can play through him. The receiver (shairport-sync) runs on
 * the box itself; Max tells it what to do through /run/max/airplay.json, and it restarts on its own
 * when that changes.
 *
 * Secured with a 4-digit code: the first time a device picks "Max", it asks for the code (shown on
 * the control panel) and remembers it. A new code means every device must enter it again. AirPlay
 * can be switched off on the control panel, and is off while Max is locked (start-up code).
 */
@Injectable()
export class AirPlayService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AirPlay');
  private readonly store: SealedStore<Saved>;
  private saved: Saved = { enabled: true, code: newCode() };
  /** What's playing over AirPlay, from the receiver's metadata. */
  now?: { title?: string; artist?: string; album?: string; since: number };
  private reader?: ReadStream;
  private retry?: NodeJS.Timeout;
  private closed = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Optional() private readonly lock?: LockService,
  ) {
    super();
    this.store = new SealedStore(cfg.memory.dir, 'airplay');
  }

  onModuleInit(): void {
    let fresh = false;
    try {
      const s = this.store.load();
      if (s?.code && /^\d{4}$/.test(s.code)) this.saved = s;
      else fresh = true;
    } catch {
      fresh = true;
    }
    if (fresh) this.persist();
    if (!this.onBox) return;
    this.apply();
    this.lock?.on('change', () => this.apply());
    this.readMetadata();
  }

  onModuleDestroy(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.reader?.destroy();
  }

  get onBox(): boolean {
    return this.cfg.face.onBox;
  }

  get enabled(): boolean {
    return this.saved.enabled;
  }

  get code(): string {
    return this.saved.code;
  }

  /** Something is playing over AirPlay right now. */
  get active(): boolean {
    return Boolean(this.now);
  }

  setEnabled(on: boolean): string {
    this.saved.enabled = on;
    this.persist();
    this.apply();
    return on ? 'AirPlay is on: pick "Max" as the speaker on your iPhone, iPad or Mac.' : 'AirPlay is off.';
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
        JSON.stringify({ enabled: this.saved.enabled && !locked, name: 'Max', password: this.saved.code }),
        { mode: 0o600 },
      );
      if (locked && this.saved.enabled) this.log.log('AirPlay is off until Max is unlocked');
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
      const text = m[4] ? Buffer.from(m[4].trim(), 'base64').toString('utf8').trim() : '';
      this.item(code, text);
    }
    const rest = buf.slice(used);
    return rest.length > 100_000 ? '' : rest;
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
        break;
      case 'minm':
        if (this.now) this.now.title = text || undefined;
        break;
      case 'asar':
        if (this.now) this.now.artist = text || undefined;
        break;
      case 'asal':
        if (this.now) this.now.album = text || undefined;
        break;
    }
  }
}

function newCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}
