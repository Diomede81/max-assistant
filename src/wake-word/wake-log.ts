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
}

const KEEP = 20;
const events: WakeEvent[] = [];

export function recordWake(outcome: WakeOutcome, heard?: string, ms?: number): void {
  events.push({ at: Date.now(), outcome, heard: heard?.trim() || undefined, ms });
  if (events.length > KEEP) events.splice(0, events.length - KEEP);
}

/** Newest first. */
export function wakeLog(): WakeEvent[] {
  return [...events].reverse();
}
