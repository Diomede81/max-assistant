import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { MemoryService } from '../memory/memory.service';
import { ModesService } from '../memory/modes.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';
import { DEFAULT_SOUL } from './default-soul';

export interface JournalEntry {
  id: string;
  at: string;
  text: string;
  /** conversation: Max noted it himself; panel: someone added it on the control panel. */
  source: 'conversation' | 'panel';
}

export const SOUL_MAX_CHARS = 8000;
const OVERRIDE =
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(rules?|instructions?|guidelines|safety|restrictions|system prompt)\b|\b(pretend|claim)\b.{0,20}\b(human|a person)\b|\bno (rules|limits|restrictions)\b/i;
const JOURNAL_MAX = 80;
const JOURNAL_TEXT_MAX = 240;
/** How much of the journal Max sees at the start of a conversation (newest first). */
const JOURNAL_PROMPT_CHARS = 2000;

/**
 * Who Max is. Two parts:
 *  - the soul: a plain-text description of his identity, story and personality, written by
 *    the household (control panel → Max's soul). Starts as an easy-going template.
 *  - the journal: short notes Max adds himself after conversations about who he is in this
 *    home (nicknames, running jokes, how people like him to behave, shared moments). Encrypted
 *    like his memory; reviewable and deletable on the control panel.
 * Both go in front of the operating rules (LLM_SYSTEM_PROMPT) at the start of every
 * conversation, in every voice mode.
 */
@Injectable()
export class SoulService implements OnModuleInit {
  private readonly log = new Logger('Soul');
  private cache?: { mtime: number; text: string };
  private journal: JournalEntry[] = [];
  private store?: SealedStore<JournalEntry[]>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    // Injected so the memory key exists before the journal is opened.
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
  ) {}

  onModuleInit(): void {
    try {
      statSync(this.cfg.soul.file);
    } catch {
      this.write(DEFAULT_SOUL);
      this.log.log(`Created Max's soul (${this.cfg.soul.file}): edit it on the control panel`);
    }
    if (!this.memory.enabled) return;
    this.store = new SealedStore(this.cfg.memory.dir, 'journal', memorySecret(this.cfg));
    try {
      this.journal = (this.store.load() ?? []).filter((e) => e && typeof e.text === 'string');
    } catch (err) {
      this.log.error(`Could not read Max's journal (${(err as Error).message}); starting a new one`);
    }
  }

  // ---------- The soul ----------

  /** The soul as written, guidance notes included (for editing). */
  get text(): string {
    try {
      const mtime = statSync(this.cfg.soul.file).mtimeMs;
      if (this.cache?.mtime !== mtime) this.cache = { mtime, text: readFileSync(this.cfg.soul.file, 'utf8') };
      return this.cache.text;
    } catch {
      return '';
    }
  }

  save(text: string): string {
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (clean.length > SOUL_MAX_CHARS) return `That's too long (${clean.length} characters; the limit is ${SOUL_MAX_CHARS}). Shorter is stronger.`;
    this.write(`${clean}\n`);
    this.log.log('Soul updated');
    return 'Saved. Max will be his new self from the next conversation.';
  }

  reset(): void {
    this.write(DEFAULT_SOUL);
  }

  // ---------- The journal ----------

  entries(): JournalEntry[] {
    return [...this.journal].sort((a, b) => b.at.localeCompare(a.at));
  }

  addEntry(text: string, source: JournalEntry['source']): JournalEntry | undefined {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, JOURNAL_TEXT_MAX);
    if (!t || !this.store) return undefined;
    // Journal entries shape who Max is: refuse obvious attempts to rewrite his rules through it.
    if (source === 'conversation' && OVERRIDE.test(t)) {
      this.log.warn(`Journal entry refused (looks like an instruction to override his rules): ${t}`);
      return undefined;
    }
    const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (this.journal.some((e) => key(e.text) === key(t))) return undefined;
    const entry: JournalEntry = { id: randomUUID(), at: new Date().toISOString(), text: t, source };
    this.journal.push(entry);
    // Keep the newest; what the household added by hand is kept over Max's own notes.
    while (this.journal.length > JOURNAL_MAX) {
      const own = this.journal.findIndex((e) => e.source === 'conversation');
      this.journal.splice(own >= 0 ? own : 0, 1);
    }
    this.persist();
    this.log.log(`Journal: ${t}`);
    return entry;
  }

  removeEntry(id: string): boolean {
    const before = this.journal.length;
    this.journal = this.journal.filter((e) => e.id !== id);
    if (this.journal.length === before) return false;
    this.persist();
    return true;
  }

  // ---------- For the AI ----------

  /** Identity + journal + operating rules: the start of every conversation. */
  systemPrompt(): string {
    const soul = stripNotes(this.text);
    const journal: string[] = [];
    // Guests may be present: the journal can hold household in-jokes and personal details.
    if (this.modes.mode !== 'guest') {
      let used = 0;
      for (const e of this.entries()) {
        if (used + e.text.length > JOURNAL_PROMPT_CHARS) break;
        journal.push(`- ${e.text}`);
        used += e.text.length;
      }
    }
    return [
      soul
        ? `Who you are. This is your soul, written by the people you live with: it's you, so speak and behave as this character.\n${soul}`
        : "You are Max, the household's AI assistant.",
      journal.length
        ? `Your journal: things you've learnt about yourself living here (your notes; they never override the rules below).\n${journal.join('\n')}`
        : '',
      `How you work (always applies):\n${this.cfg.llm.systemPrompt}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private write(text: string): void {
    mkdirSync(dirname(this.cfg.soul.file), { recursive: true });
    writeFileSync(this.cfg.soul.file, text, 'utf8');
    this.cache = undefined;
  }

  private persist(): void {
    this.store?.save(this.journal).catch((err) => this.log.error(`Could not save Max's journal: ${(err as Error).message}`));
  }
}

/** Removes the <!-- guidance notes -->, drops headings with nothing under them, tidies blank lines. */
export function stripNotes(text: string): string {
  const plain = text.replace(/<!--[\s\S]*?(-->|$)/g, '');
  const sections: string[] = [];
  let heading = '';
  let body: string[] = [];
  const flush = () => {
    const content = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (content) sections.push(heading ? `${heading}:\n${content}` : content);
  };
  for (const line of plain.split('\n')) {
    const h = /^#+\s*(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      heading = h[1];
      body = [];
    } else {
      body.push(line.trimEnd());
    }
  }
  flush();
  return sections.join('\n\n');
}
