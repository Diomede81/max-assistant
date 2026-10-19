import { EventEmitter } from 'node:events';

/**
 * Cards on the box's round screen: anything worth seeing rather than hearing (a timer that
 * went off, the music, your day, a list). While a card shows, Max's face shrinks to the top
 * of the screen. Any part of Max can show one with showCard(); FaceService puts it on screen
 * and runs the matching handler when a button on the card is tapped.
 */

export interface CardLine {
  text: string;
  /** Second, smaller line. */
  sub?: string;
  /** Left column, e.g. "08:30". */
  time?: string;
  tag?: 'critical' | 'overdue' | 'important' | 'event' | 'reminder' | 'done';
  /** A small button on the line (e.g. Done for a to-do); runs the card's handler with this id. */
  action?: { id: string; label: string };
}

export interface CardAction {
  id: string;
  label: string;
  style?: 'primary' | 'quiet' | 'danger' | 'icon';
}

export interface Card {
  /** Showing a card with the same id replaces it (e.g. the music card when the song changes). */
  id: string;
  kind: 'alert' | 'music' | 'list' | 'notice';
  icon?: string;
  title: string;
  subtitle?: string;
  /** A large line (e.g. "Pasta timer done"). */
  big?: string;
  /** A paragraph (e.g. an email's summary), scrolls if long. */
  body?: string;
  /** Picture (e.g. album cover), http(s) or data: URL. */
  image?: string;
  lines?: CardLine[];
  actions?: CardAction[];
  /** Music position (ms) at `at`, to draw a progress bar that moves on its own. */
  progress?: { position: number; duration: number; at: number; paused?: boolean };
  /** How long it stays (ms) if nobody taps it. */
  ttlMs?: number;
}

export type CardHandlers = Record<string, () => void | Promise<void>>;

export const screen = new EventEmitter();

export function showCard(card: Card, handlers: CardHandlers = {}): void {
  screen.emit('card', card, handlers);
}

export function dismissCard(id: string): void {
  screen.emit('dismiss', id);
}
