import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { SealedStore } from '../memory/sealed-store';

interface Saved {
  /** scrypt hash of the code, with its salt (the code itself is never stored). */
  salt?: string;
  hash?: string;
  /** Wrong tries in a row, and the pause after too many (kept across restarts). */
  fails: number;
  pausedUntil: number;
  pauses: number;
}

const TRIES = 5;
const FIRST_PAUSE_MS = 30_000;
const MAX_PAUSE_MS = 15 * 60_000;

export const isCode = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);

/**
 * The start-up code: once a 6-digit code is set on the control panel, Max is locked every time
 * the box starts (and when someone taps Lock). On the Max box, Max restarting on its own (an update)
 * doesn't lock him again: a note in /run/max (which the box empties when it powers off) remembers
 * that the code was entered since it started. Until the code is typed on his screen he
 * doesn't answer, run actions or show anything personal. After 5 wrong tries the keypad pauses,
 * longer each time (30 s, 1 min, 2 min... up to 15 min), and that survives restarts.
 */
@Injectable()
export class LockService extends EventEmitter implements OnModuleInit {
  private readonly log = new Logger('Lock');
  private readonly store: SealedStore<Saved>;
  private saved: Saved = { fails: 0, pausedUntil: 0, pauses: 0 };
  private isLocked = false;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    super();
    this.store = new SealedStore(cfg.memory.dir, 'startup-code');
  }

  onModuleInit(): void {
    try {
      this.saved = { ...this.saved, ...(this.store.load() ?? {}) };
    } catch (err) {
      this.log.error(`Could not read the start-up code settings: ${(err as Error).message}`);
    }
    this.isLocked = this.enabled && !this.unlockedSinceBoot();
    if (this.isLocked) this.log.log('Locked: waiting for the start-up code on the screen');
    else if (this.enabled) this.log.log('Unlocked: the code was entered since the box started (Max restarted)');
  }

  /** A code has been set. */
  get enabled(): boolean {
    return Boolean(this.saved.hash);
  }

  get locked(): boolean {
    return this.isLocked;
  }

  /** For the screen: locked, and if the keypad is paused, until when. */
  status(): { pausedUntil?: number; triesLeft: number } | undefined {
    if (!this.isLocked) return undefined;
    return { pausedUntil: this.saved.pausedUntil > Date.now() ? this.saved.pausedUntil : undefined, triesLeft: TRIES - this.saved.fails };
  }

  /** The code typed on the screen. */
  unlock(code: string): { ok: boolean; message: string } {
    if (!this.isLocked) return { ok: true, message: 'Unlocked.' };
    const check = this.check(code);
    if (!check.ok) return check;
    this.isLocked = false;
    this.markUnlocked(true);
    this.log.log('Unlocked with the start-up code');
    this.emit('change', false);
    return { ok: true, message: 'Unlocked.' };
  }

  /**
   * Every check of the code (the screen's keypad and the control panel's "current code") counts
   * towards the same 5 tries, so the code can't be guessed from anywhere.
   */
  private check(code: string): { ok: boolean; message: string } {
    const wait = this.saved.pausedUntil - Date.now();
    if (wait > 0) return { ok: false, message: `Too many tries. Wait ${Math.ceil(wait / 1000)} s.` };
    if (this.matches(code)) {
      if (this.saved.fails || this.saved.pauses) {
        this.saved = { ...this.saved, fails: 0, pausedUntil: 0, pauses: 0 };
        this.save();
      }
      return { ok: true, message: '' };
    }
    this.saved.fails++;
    let message = 'Wrong code.';
    if (this.saved.fails >= TRIES) {
      const pause = Math.min(MAX_PAUSE_MS, FIRST_PAUSE_MS * 2 ** this.saved.pauses);
      this.saved = { ...this.saved, fails: 0, pausedUntil: Date.now() + pause, pauses: this.saved.pauses + 1 };
      message = `Too many tries. Wait ${Math.round(pause / 1000)} s.`;
      this.log.warn(`Start-up code: ${TRIES} wrong tries, paused for ${Math.round(pause / 1000)} s`);
    }
    this.save();
    this.emit('change', this.isLocked);
    return { ok: false, message };
  }

  /** Lock now (the screen menu's Lock). */
  lock(): boolean {
    if (!this.enabled) return false;
    if (!this.isLocked) {
      this.isLocked = true;
      this.markUnlocked(false);
      this.log.log('Locked from the screen');
      this.emit('change', true);
    }
    return true;
  }

  /**
   * Set, change or remove the code (control panel). Changing or removing needs the current code,
   * unless `reset` (allowed only when the control panel itself has a password).
   */
  setCode(next: string | undefined, current?: string, reset = false): { ok: boolean; message: string } {
    if (this.enabled && !reset) {
      const check = this.check(current ?? '');
      if (!check.ok) return { ok: false, message: check.message === 'Wrong code.' ? 'The current code is not right.' : check.message };
    }
    if (next === undefined) {
      this.saved = { fails: 0, pausedUntil: 0, pauses: 0 };
      this.save();
      if (this.isLocked) {
        this.isLocked = false;
        this.emit('change', false);
      }
      this.log.log(reset ? 'Start-up code reset from the control panel' : 'Start-up code turned off');
      return { ok: true, message: 'The start-up code is off: Max starts without asking for it.' };
    }
    if (!isCode(next)) return { ok: false, message: 'The code must be exactly 6 digits.' };
    if (/^(\d)\1{5}$/.test(next) || '0123456789'.includes(next) || '9876543210'.includes(next)) {
      return { ok: false, message: 'That code is too easy to guess (like 111111 or 123456). Choose another.' };
    }
    const salt = randomBytes(16).toString('hex');
    this.saved = { salt, hash: hashOf(next, salt), fails: 0, pausedUntil: 0, pauses: 0 };
    this.save();
    if (!this.isLocked) this.markUnlocked(true); // set while unlocked: no need to type it until the box restarts
    this.log.log('Start-up code set');
    return { ok: true, message: 'Saved. Max will ask for this code every time he starts.' };
  }

  /** /run/max is emptied when the box powers off: the note only lasts until then. */
  private get marker(): string | undefined {
    return this.cfg.face.onBox ? join(this.cfg.face.runDir, 'unlocked') : undefined;
  }

  private unlockedSinceBoot(): boolean {
    return Boolean(this.marker && existsSync(this.marker));
  }

  private markUnlocked(on: boolean): void {
    if (!this.marker) return;
    try {
      if (on) writeFileSync(this.marker, String(Date.now()), { mode: 0o600 });
      else if (existsSync(this.marker)) unlinkSync(this.marker);
    } catch (err) {
      this.log.warn(`Could not update ${this.marker}: ${(err as Error).message}`);
    }
  }

  private matches(code: string): boolean {
    if (!this.saved.hash || !this.saved.salt || !isCode(code)) return false;
    return timingSafeEqual(Buffer.from(hashOf(code, this.saved.salt), 'hex'), Buffer.from(this.saved.hash, 'hex'));
  }

  private save(): void {
    this.store.save(this.saved).catch((err) => this.log.error(`Could not save the start-up code settings: ${(err as Error).message}`));
  }
}

function hashOf(code: string, salt: string): string {
  return scryptSync(code, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
