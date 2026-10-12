import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { spokenDuration } from './clock';

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
  handle: NodeJS.Timeout;
}

const MAX_SECONDS = 24 * 3600;

/**
 * Timers and reminders, kept in memory (they don't survive a restart).
 * Emits 'fired' with the Timer when one goes off; Max announces it out loud.
 */
@Injectable()
export class TimerService extends EventEmitter implements OnModuleDestroy {
  private readonly log = new Logger(TimerService.name);
  private readonly timers = new Map<number, Timer>();
  private nextId = 1;

  start(durationSeconds: number, name?: string, reminder?: string): Timer {
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1) throw new Error('duration must be at least 1 second');
    if (durationSeconds > MAX_SECONDS) throw new Error('timers can be at most 24 hours');
    const id = this.nextId++;
    const timer: Timer = {
      id,
      name: name?.trim() || undefined,
      reminder: reminder?.trim() || undefined,
      durationSeconds: Math.round(durationSeconds),
      endsAt: Date.now() + Math.round(durationSeconds) * 1000,
      handle: setTimeout(() => this.fire(id), Math.round(durationSeconds) * 1000),
    };
    this.timers.set(id, timer);
    this.log.log(`Timer #${id} set: ${describe(timer)} for ${spokenDuration(timer.durationSeconds)}`);
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
      clearTimeout(t.handle);
      this.timers.delete(t.id);
      this.log.log(`Timer #${t.id} cancelled (${describe(t)})`);
    }
    return victims;
  }

  /** Says something out loud like a reminder (e.g. a project task falling due). */
  announce(text: string): void {
    this.emit('fired', { id: 0, say: text, durationSeconds: 0, endsAt: Date.now() } as unknown as Timer);
  }

  private fire(id: number): void {
    const t = this.timers.get(id);
    if (!t) return;
    this.timers.delete(id);
    this.log.log(`Timer #${id} finished (${describe(t)})`);
    this.emit('fired', t);
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t.handle);
    this.timers.clear();
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
