/**
 * The last wake-ups, for the control panel (Settings → Device → Wake-ups): did "Hey Max" get through, and if
 * not, why. Helps tuning: the wake word engine's hits that the double-check threw away show up here with what
 * the speech recogniser heard instead.
 */
export type WakeOutcome = 'woke' | 'ignored' | 'repeat' | 'unchecked';

export interface WakeEvent {
  at: number;
  outcome: WakeOutcome;
  /** What the speech recogniser made of the last couple of seconds (the double-check). */
  heard?: string;
  /** How long the double-check took (ms). */
  ms?: number;
  /** How long after the wake word Max was listening (ms). */
  readyMs?: number;
}

const KEEP = 20;
const events: WakeEvent[] = [];

export function recordWake(outcome: WakeOutcome, heard?: string, ms?: number): void {
  events.push({ at: Date.now(), outcome, heard: heard?.trim() || undefined, ms });
  if (events.length > KEEP) events.splice(0, events.length - KEEP);
}

/** The latest wake-up turned out differently after all (a late verdict): say so. */
export function amendLast(outcome: WakeOutcome, note: string): void {
  const last = events[events.length - 1];
  if (!last) return;
  last.outcome = outcome;
  last.heard = `${last.heard ?? ''} ${note}`.trim();
}

/** Max started listening this long after the latest wake-up. */
export function markReady(readyMs: number): void {
  const last = events[events.length - 1];
  if (last && last.readyMs === undefined) last.readyMs = readyMs;
}

/** Newest first. */
export function wakeLog(): WakeEvent[] {
  return [...events].reverse();
}
