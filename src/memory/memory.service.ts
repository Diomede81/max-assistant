import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { timeZone } from '../actions/clock';

export type FactSource = 'you' | 'auto' | 'panel';

export interface MemoryFact {
  id: string;
  text: string;
  /** you = asked Max to remember; auto = learnt from a conversation; panel = added on the control panel */
  source: FactSource;
  createdAt: string;
}

export interface ConversationNote {
  id: string;
  at: string;
  summary: string;
}

interface MemoryFile {
  version: 1;
  facts: MemoryFact[];
  conversations: ConversationNote[];
}

const MAX_FACTS = 500;
const MAX_FACT_CHARS = 300;
const MAX_CONVERSATIONS = 200;
/** Memory is sent to cloud AI services with every conversation, so secrets never go in. */
const SECRET = /\b(password|passcode|passphrase|pin( code| number)?|alarm code|door code|security code|cvv|card number|sort code|account number|iban|api key|token)\b/i;

/**
 * Max's long-term memory: facts about the household ("Luca's daughter is Sofia", "likes
 * the heating at 20 degrees") plus a short note of each past conversation. Kept in one
 * JSON file on this machine (MEMORY_FILE), loaded into every conversation, and editable
 * on the control panel.
 */
@Injectable()
export class MemoryService {
  private readonly log = new Logger('Memory');
  private data: MemoryFile = { version: 1, facts: [], conversations: [] };
  private writing: Promise<void> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    if (!this.enabled) return;
    this.load();
  }

  get enabled(): boolean {
    return this.cfg.memory.enabled;
  }

  get facts(): readonly MemoryFact[] {
    return this.data.facts;
  }

  get conversations(): readonly ConversationNote[] {
    return this.data.conversations;
  }

  /** Adds a fact. Returns a short sentence for the AI model / panel. */
  remember(text: string, source: FactSource): { ok: boolean; message: string } {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_CHARS);
    if (!clean) return { ok: false, message: 'Nothing to remember.' };
    if (SECRET.test(clean)) {
      return {
        ok: false,
        message: 'Not saved: passwords, PINs, codes and account numbers are never stored in memory.',
      };
    }
    const key = normalise(clean);
    if (this.data.facts.some((f) => normalise(f.text) === key)) return { ok: true, message: 'Already remembered.' };
    if (this.data.facts.length >= MAX_FACTS) {
      return { ok: false, message: `Memory is full (${MAX_FACTS} facts). Ask the user to remove old ones on the control panel.` };
    }
    this.data.facts.push({ id: randomUUID(), text: clean, source, createdAt: new Date().toISOString() });
    this.log.log(`Remembered (${source}): "${clean}"`);
    this.save();
    return { ok: true, message: `Remembered: ${clean}` };
  }

  /** Forgets the facts matching `query`; when several match and `all` is false, lists them instead. */
  forget(query: string, all = false): string {
    const matches = this.search(query, this.data.facts.length).filter((m) => m.kind === 'fact');
    if (!matches.length) return `Nothing in memory matches "${query}".`;
    const best = matches[0].score;
    const strong = matches.filter((m) => m.score === best);
    const targets = all ? matches : strong.length === 1 ? strong : [];
    if (!targets.length) {
      return `Several memories match: ${strong.map((m) => `"${m.text}"`).join('; ')}. Ask the user which one to forget.`;
    }
    const ids = new Set(targets.map((t) => t.id));
    this.data.facts = this.data.facts.filter((f) => !ids.has(f.id));
    this.log.log(`Forgot: ${targets.map((t) => `"${t.text}"`).join(', ')}`);
    this.save();
    return `Forgot: ${targets.map((t) => t.text).join('; ')}.`;
  }

  deleteFact(id: string): boolean {
    const before = this.data.facts.length;
    this.data.facts = this.data.facts.filter((f) => f.id !== id);
    if (this.data.facts.length === before) return false;
    this.save();
    return true;
  }

  deleteConversation(id: string): boolean {
    const before = this.data.conversations.length;
    this.data.conversations = this.data.conversations.filter((c) => c.id !== id);
    if (this.data.conversations.length === before) return false;
    this.save();
    return true;
  }

  /** Looks through every fact and past conversation note, best matches first. */
  recall(query: string): string {
    const hits = this.search(query, 6);
    if (!hits.length) return `Nothing in memory about "${query}".`;
    return hits.map((h) => (h.kind === 'fact' ? `Fact: ${h.text}` : `Conversation on ${shortDate(h.at)}: ${h.text}`)).join('\n');
  }

  addConversation(summary: string): void {
    const clean = summary.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    this.data.conversations.push({ id: randomUUID(), at: new Date().toISOString(), summary: clean });
    if (this.data.conversations.length > MAX_CONVERSATIONS) this.data.conversations.splice(0, this.data.conversations.length - MAX_CONVERSATIONS);
    this.log.log(`Conversation note saved: "${clean}"`);
    this.save();
  }

  /**
   * The part of Max's instructions that carries his memory. Newest facts win when the
   * list is longer than MEMORY_PROMPT_CHARS (older ones stay reachable through recall).
   */
  promptSection(): string {
    if (!this.enabled) return '';
    const guide =
      'Long-term memory: you remember things between conversations. Use what you know naturally (names, ' +
      'preferences, routines) without announcing that it comes from memory. When the user asks you to remember ' +
      'something, or mentions a lasting personal detail worth keeping (people, preferences, routines, important ' +
      'dates), call remember with one short self-contained sentence, written with real names and dates rather ' +
      'than "me" or "next week". Call forget when asked to forget something, and recall to look up older ' +
      'conversations or details not listed here. Never store passwords, PINs, codes or account numbers.';
    const budget = this.cfg.memory.promptChars;
    const lines: string[] = [];
    let used = 0;
    for (const f of [...this.data.facts].reverse()) {
      const line = `- ${f.text} (noted ${shortDate(f.createdAt)})`;
      if (used + line.length > budget) break;
      lines.push(line);
      used += line.length;
    }
    lines.reverse();
    const hidden = this.data.facts.length - lines.length;
    const recent = this.data.conversations.slice(-this.cfg.memory.recentConversations).map((c) => `- ${shortDate(c.at)}: ${c.summary}`);
    return [
      guide,
      lines.length ? `What you know about the user and household:\n${lines.join('\n')}` : 'You have no saved facts yet.',
      hidden > 0 ? `(${hidden} older fact${hidden === 1 ? '' : 's'} not shown; use recall to search them.)` : '',
      recent.length ? `Recent conversations:\n${recent.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private search(query: string, limit: number) {
    const words = tokens(query);
    const items = [
      ...this.data.facts.map((f) => ({ kind: 'fact' as const, id: f.id, text: f.text, at: f.createdAt })),
      ...this.data.conversations.map((c) => ({ kind: 'conversation' as const, id: c.id, text: c.summary, at: c.at })),
    ];
    const q = normalise(query);
    return items
      .map((i) => {
        const t = normalise(i.text);
        const have = new Set(tokens(i.text));
        const score = (q && t.includes(q) ? 10 : 0) + words.filter((w) => have.has(w)).length;
        return { ...i, score };
      })
      .filter((i) => i.score > 0)
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  private load(): void {
    const file = this.cfg.memory.file;
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.error(`Could not read ${file}: ${(err as Error).message}`);
      else this.log.log(`Starting with an empty memory (${file})`);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<MemoryFile>;
      this.data = {
        version: 1,
        facts: Array.isArray(parsed.facts) ? parsed.facts.filter((f) => f && typeof f.text === 'string') : [],
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations.filter((c) => c && typeof c.summary === 'string') : [],
      };
      for (const f of this.data.facts) f.id ??= randomUUID();
      for (const c of this.data.conversations) c.id ??= randomUUID();
      this.log.log(`Loaded ${this.data.facts.length} facts and ${this.data.conversations.length} conversation notes`);
    } catch (err) {
      // Keep the damaged file for the user to inspect instead of overwriting it.
      const aside = `${file}.damaged-${Date.now()}`;
      try {
        renameSync(file, aside);
      } catch {
        // ignore
      }
      this.log.error(`${file} is not valid JSON (${(err as Error).message}); moved it to ${aside} and started a fresh memory`);
    }
  }

  /** Writes are queued and atomic (temp file + rename), so a crash never leaves half a file. */
  private save(): void {
    const file = this.cfg.memory.file;
    const body = JSON.stringify(this.data, null, 2);
    this.writing = this.writing
      .then(async () => {
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, body, 'utf8');
        await rename(tmp, file);
      })
      .catch((err) => this.log.error(`Could not save memory to ${file}: ${(err as Error).message}`));
  }

  /** Resolves once pending writes are on disk (used by tests and the typing mode). */
  flush(): Promise<void> {
    return this.writing;
  }
}

const STOP = new Set(
  'a an and are as at be but by do does did for from has have he her his i in is it its me my of on or our she so that the their them they this to was we what when where which who will with you your about'.split(' '),
);
const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (s: string) => normalise(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
