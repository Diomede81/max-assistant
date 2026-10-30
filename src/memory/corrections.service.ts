import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { memorySecret, SealedStore } from './sealed-store';
import { localToday, addDays } from './projects.service';

/**
 * Counts how often the user has to correct Max: the headline measure of whether he is learning
 * (docs/design/SELF-LEARNING.md, phase 0). Found by rules on the box, no AI model: a user turn
 * that starts with "no", "not that", "I meant" (and the Italian equivalents) right after Max
 * answered, or that repeats the previous request with something changed; and a fact Max filed
 * by himself that the user removes within ten minutes. Kept encrypted for 90 days, shown on the
 * control panel (Max › Memory › Learning). Nothing from emails, pages or messages is ever quoted.
 */
export interface Correction {
  at: string;
  /** What kind of task Max got wrong (from the actions used around it). */
  task: string;
  /** How it was noticed. */
  how: 'said' | 'repeated' | 'removed';
  /** What the user had asked (short). */
  said?: string;
  /** The correction itself (short). */
  meant: string;
}

export interface TranscriptLineLike {
  who: 'user' | 'max' | 'action';
  text: string;
}

const KEEP_DAYS = 90;
const MAX = 2000;
const PREVIEW = 100;
/** Starts of a turn that correct the previous answer (English and Italian). */
const CORRECTION = /^(no[,.!]?\s|no\s*,?\s*(i|not|that|non|the)\b|nope\b|not (that|this|what i|quite|like that)\b|that'?s (not|wrong)\b|i (said|meant|asked|wanted)\b|i didn'?t (say|ask|mean)\b|wrong\b|try again\b|again[,.]? (but|i)\b|non (è|era|ho|volevo|intendevo|quello|questo|così)\b|intendevo\b|volevo dire\b|sbagliato\b|ho detto\b|non ho (detto|chiesto)\b|riprova\b)/i;
/** Quick commands where a repeat is normal, not a correction (lights again, next track). */
const REPEAT_OK = /^(next|skip|again|stop|pause|play|louder|quieter|up|down|more|yes|ok|thanks|thank you|grazie|sì|si|avanti|ancora|basta)\b/i;

const TASK_OF: [RegExp, string][] = [
  [/whatsapp/i, 'WhatsApp'],
  [/calendar|event|meeting/i, 'calendar'],
  [/email|mail|outlook|gmail/i, 'email'],
  [/light|switch|climate|home|hass|device|automation/i, 'home'],
  [/timer|remind|alarm/i, 'reminders'],
  [/todo|task_|project/i, 'to-dos'],
  [/music|play|radio|spotify|airplay/i, 'music'],
  [/remember|recall|forget|memory/i, 'memory'],
  [/web_search|read_webpage|news/i, 'the web'],
  [/train|journey/i, 'trains'],
  [/people|journal|health|meal|exercise/i, 'personal'],
  [/scheduled_task|work_on_task/i, 'tasks'],
];

@Injectable()
export class CorrectionsService implements OnModuleInit {
  private readonly log = new Logger('Learning');
  private readonly store: SealedStore<{ entries: Correction[] }>;
  private entries: Correction[] = [];

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'corrections', memorySecret(cfg));
  }

  onModuleInit(): void {
    try {
      this.entries = this.store.load()?.entries ?? [];
    } catch (err) {
      this.log.warn(`Could not read the corrections log: ${(err as Error).message}`);
    }
  }

  /** Looks through a finished conversation for corrections and records them. Returns how many. */
  note(lines: TranscriptLineLike[]): number {
    const found: Correction[] = [];
    let lastUser: string | undefined;
    let maxAnswered = false;
    let actions: string[] = [];
    for (const l of lines) {
      if (l.who === 'action') {
        actions.push(l.text);
        continue;
      }
      if (l.who === 'max') {
        maxAnswered = true;
        continue;
      }
      const text = l.text.trim();
      if (lastUser && maxAnswered) {
        const how = CORRECTION.test(text) ? 'said' : !REPEAT_OK.test(text) && repeats(lastUser, text) ? 'repeated' : undefined;
        if (how) found.push({ at: new Date().toISOString(), task: taskOf(actions), how, said: lastUser.slice(0, PREVIEW), meant: text.slice(0, PREVIEW) });
      }
      lastUser = text;
      maxAnswered = false;
      actions = [];
    }
    if (found.length) this.add(found);
    return found.length;
  }

  /** A fact Max filed by himself that the user removed within ten minutes: Max got it wrong. */
  removedSoon(text: string, createdAt: string, source: string): void {
    if (source !== 'conversation' || Date.now() - Date.parse(createdAt) > 10 * 60_000) return;
    this.add([{ at: new Date().toISOString(), task: 'memory', how: 'removed', meant: text.slice(0, PREVIEW) }]);
  }

  /** This week and last, per task, with the latest few: the Learning card. */
  summary(): { thisWeek: number; lastWeek: number; byTask: { task: string; thisWeek: number; lastWeek: number }[]; recent: Correction[]; since?: string } {
    const today = localToday();
    const weekAgo = addDays(today, -7);
    const twoWeeksAgo = addDays(today, -14);
    const inWeek = (c: Correction, from: string, to: string) => c.at.slice(0, 10) >= from && c.at.slice(0, 10) < to;
    const tasks = [...new Set(this.entries.map((c) => c.task))];
    return {
      thisWeek: this.entries.filter((c) => inWeek(c, weekAgo, addDays(today, 1))).length,
      lastWeek: this.entries.filter((c) => inWeek(c, twoWeeksAgo, weekAgo)).length,
      byTask: tasks
        .map((task) => ({ task, thisWeek: this.entries.filter((c) => c.task === task && inWeek(c, weekAgo, addDays(today, 1))).length, lastWeek: this.entries.filter((c) => c.task === task && inWeek(c, twoWeeksAgo, weekAgo)).length }))
        .filter((t) => t.thisWeek || t.lastWeek)
        .sort((a, b) => b.thisWeek - a.thisWeek),
      recent: [...this.entries].slice(-6).reverse(),
      since: this.entries[0]?.at,
    };
  }

  private add(found: Correction[]): void {
    const cutoff = addDays(localToday(), -KEEP_DAYS);
    this.entries = [...this.entries.filter((c) => c.at.slice(0, 10) >= cutoff), ...found].slice(-MAX);
    for (const c of found) this.log.log(`Correction noticed (${c.task}, ${c.how})`);
    this.store.save({ entries: this.entries }).catch((err) => this.log.warn(`Could not save the corrections log: ${(err as Error).message}`));
  }
}

/** The task kind, from the actions Max used for the turn (the last one wins); "answer" when he used none. */
export function taskOf(actions: string[]): string {
  for (const a of [...actions].reverse()) for (const [re, task] of TASK_OF) if (re.test(a)) return task;
  return 'answer';
}

const STOP = new Set('a an and the to of in on at for is it be my me i you please can could would max hey il la le lo gli un una di a da in per con mi puoi'.split(' '));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)));

/** The same request again with something changed: most content words shared, at least one different, not identical. */
export function repeats(previous: string, next: string): boolean {
  const a = words(previous), b = words(next);
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const w of b) if (a.has(w)) shared++;
  const ratio = shared / Math.max(a.size, b.size);
  return ratio >= 0.6 && ratio < 1 && [...b].some((w) => !a.has(w));
}
