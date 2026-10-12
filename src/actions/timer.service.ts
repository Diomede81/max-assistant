import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { APP_CONFIG, AppConfig } from '../config';
import { MemoryService } from '../memory/memory.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';
import { spokenDuration, spokenWhen } from './clock';

export interface Timer {
  id: number;
  /** Short name, e.g. "pasta". */
  name?: string;
  /** For reminders: what to say when it goes off, e.g. "call Mum". */
  reminder?: string;
  durationSeconds: number;
  endsAt: number;
  /** Set for plain announcements (not a timer): said exactly as written. */
  say?: string;
}

/** Reminders can be set up to a year ahead ("remind me on 3 March to renew the insurance"). */
const MAX_SECONDS = 366 * 24 * 3600;
/** After a restart: reminders missed by less than this are still announced ("while I was off..."). */
const MISSED_REMINDER_MS = 24 * 3600_000;
/** ...and kitchen timers only if they finished very recently. */
const MISSED_TIMER_MS = 30 * 60_000;
/** Give the rest of Max a moment to start listening before announcing missed ones. */
const STARTUP_ANNOUNCE_MS = 8000;

/**
 * Timers and reminders. Saved (encrypted, next to the memory vaults) on every change, so
 * they survive restarts and updates; reminders that came due while Max was off are
 * announced when he's back. Emits 'fired' with the Timer when one goes off; Max announces
 * it out loud.
 */
@Injectable()
export class TimerService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TimerService.name);
  private readonly timers = new Map<number, Timer>();
  private nextId = 1;
  private ticker?: NodeJS.Timeout;
  private startup?: NodeJS.Timeout;
  private store?: SealedStore<{ nextId: number; timers: Timer[] }>;

  constructor(
    @Optional() @Inject(APP_CONFIG) private readonly cfg?: AppConfig,
    // Injected so the memory key exists before the store is opened.
    @Optional() private readonly memory?: MemoryService,
  ) {
    super();
  }

  onModuleInit(): void {
    if (this.cfg) {
      this.store = new SealedStore(this.cfg.memory.dir, 'timers', memorySecret(this.cfg));
      this.restore();
    }
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  /** Starts a countdown (seconds from now) or, with `at`, a reminder at a set time (epoch ms). */
  start(durationSeconds: number, name?: string, reminder?: string, at?: number): Timer {
    if (at !== undefined) {
      if (!Number.isFinite(at)) throw new Error('that date and time could not be understood');
      durationSeconds = Math.round((at - Date.now()) / 1000);
      if (durationSeconds < 1) throw new Error('that time has already passed');
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1) throw new Error('duration must be at least 1 second');
    if (durationSeconds > MAX_SECONDS) throw new Error('reminders can be at most a year ahead');
    const id = this.nextId++;
    const timer: Timer = {
      id,
      name: name?.trim() || undefined,
      reminder: reminder?.trim() || undefined,
      durationSeconds: Math.round(durationSeconds),
      endsAt: at ?? Date.now() + Math.round(durationSeconds) * 1000,
    };
    this.timers.set(id, timer);
    this.log.log(`Timer #${id} set: ${describe(timer)}, ${spokenWhen(timer.endsAt)}`);
    this.persist();
    return timer;
  }

  list(): Timer[] {
    return [...this.timers.values()].sort((a, b) => a.endsAt - b.endsAt);
  }

  remainingSeconds(t: Timer): number {
    return Math.max(0, Math.round((t.endsAt - Date.now()) / 1000));
  }

  /** Cancels by name/reminder text (case-insensitive, partial match), or all when `all` is set. */
  cancel(match?: string, all = false): Timer[] {
    const q = match?.trim().toLowerCase();
    let victims = this.list();
    if (!all) {
      if (q) victims = victims.filter((t) => `${t.name ?? ''} ${t.reminder ?? ''}`.toLowerCase().includes(q));
      else if (victims.length > 1) return []; // ambiguous: caller asks which one
    }
    for (const t of victims) {
      this.timers.delete(t.id);
      this.log.log(`Timer #${t.id} cancelled (${describe(t)})`);
    }
    if (victims.length) this.persist();
    return victims;
  }

  /** Says something out loud like a reminder (e.g. a project task falling due). */
  announce(text: string): void {
    this.emit('fired', { id: 0, say: text, durationSeconds: 0, endsAt: Date.now() } as Timer);
  }

  private tick(): void {
    const now = Date.now();
    const due = this.list().filter((t) => t.endsAt <= now);
    if (!due.length) return;
    for (const t of due) {
      this.timers.delete(t.id);
      this.log.log(`Timer #${t.id} finished (${describe(t)})`);
      this.emit('fired', t);
    }
    this.persist();
  }

  /** Brings back the timers and reminders saved before the last restart. */
  private restore(): void {
    let saved: { nextId: number; timers: Timer[] } | undefined;
    try {
      saved = this.store?.load();
    } catch (err) {
      this.log.error(`Could not read saved timers and reminders (${(err as Error).message}); starting without them`);
      return;
    }
    if (!saved?.timers?.length) return;
    const now = Date.now();
    const missed: string[] = [];
    for (const t of saved.timers) {
      if (!t || typeof t.endsAt !== 'number') continue;
      if (t.endsAt > now) {
        this.timers.set(t.id, t);
        continue;
      }
      const late = now - t.endsAt;
      if (t.reminder && late < MISSED_REMINDER_MS) missed.push(`your reminder "${t.reminder.replace(/\.$/, '')}"`);
      else if (!t.reminder && late < MISSED_TIMER_MS) missed.push(`your ${t.name ? `${t.name} ` : ''}timer`);
      this.log.log(`Timer #${t.id} (${describe(t)}) came due while Max was off`);
    }
    this.nextId = Math.max(saved.nextId || 1, ...saved.timers.map((t) => (t?.id ?? 0) + 1));
    this.log.log(`Restored ${this.timers.size} timer${this.timers.size === 1 ? '' : 's'} and reminder${this.timers.size === 1 ? '' : 's'}`);
    if (missed.length) {
      const list = missed.length > 1 ? `${missed.slice(0, -1).join(', ')} and ${missed[missed.length - 1]}` : missed[0];
      this.startup = setTimeout(() => this.announce(`While I was switched off, I missed ${list}.`), STARTUP_ANNOUNCE_MS);
    }
    this.persist();
  }

  private persist(): void {
    this.store?.save({ nextId: this.nextId, timers: this.list() }).catch((err) =>
      this.log.error(`Could not save timers and reminders: ${(err as Error).message}`),
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.ticker);
    clearTimeout(this.startup);
  }
}

export function describe(t: Pick<Timer, 'name' | 'reminder'>): string {
  if (t.reminder) return `reminder "${t.reminder}"`;
  return t.name ? `"${t.name}" timer` : 'timer';
}

/** What Max says when a timer goes off. */
export function announcement(t: Timer): string {
  if (t.say) return t.say;
  if (t.reminder) return `Reminder: ${t.reminder}.`;
  return t.name ? `Your ${t.name} timer is done.` : `Time's up. The timer you set for ${spokenDuration(t.durationSeconds)} is done.`;
}
