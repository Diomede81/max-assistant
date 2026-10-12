import { Logger } from '@nestjs/common';
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { open, seal, SealedFile } from './crypto';

export type ActivityKind = 'shared' | 'recall' | 'saved' | 'updated' | 'forgot' | 'moved' | 'note' | 'digest' | 'mode' | 'blocked';

export interface Activity {
  at: string;
  kind: ActivityKind;
  /** e.g. "Conversation start (Work mode)", the recall query, the mode switched to. */
  what: string;
  vaults?: string[];
  /** Short previews of the memories involved. */
  items?: string[];
}

const KEEP_DAYS = 30;
const MAX_ENTRIES = 3000;
const PREVIEW = 90;
const NAME = 'activity';

/**
 * Who-saw-what log for Max's memory: which memories were shared with the AI service in each
 * conversation, what was searched, saved, changed or forgotten, and mode switches. Encrypted
 * like the vaults (it quotes memories), kept for 30 days, shown on the control panel.
 */
export class ActivityLog {
  private entries: Activity[] = [];
  private writing: Promise<void> = Promise.resolve();
  private ok = true;
  private lastShared = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly key: Buffer,
    private readonly log: Logger,
  ) {
    try {
      const raw = readFileSync(this.file, 'utf8');
      this.entries = JSON.parse(open(key, NAME, JSON.parse(raw) as SealedFile)) as Activity[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.ok = false; // wrong key or damaged: don't overwrite it
        this.log.error('The memory activity log cannot be unlocked; activity is not recorded until the right MEMORY_KEY is set');
      }
    }
  }

  add(kind: ActivityKind, what: string, vaults?: string[], items?: string[]): void {
    if (!this.ok) return;
    // The same memories are shared on every turn of a conversation: log them once per 10 minutes.
    if (kind === 'shared') {
      const sig = `${what}|${(items ?? []).join('|')}`;
      const last = this.lastShared.get(sig);
      if (last && Date.now() - last < 10 * 60_000) return;
      this.lastShared.set(sig, Date.now());
    }
    this.entries.push({
      at: new Date().toISOString(),
      kind,
      what: what.slice(0, 200),
      ...(vaults?.length ? { vaults: [...new Set(vaults)] } : {}),
      ...(items?.length ? { items: items.slice(0, 20).map((t) => (t.length > PREVIEW ? `${t.slice(0, PREVIEW - 1)}…` : t)) } : {}),
    });
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
    this.entries = this.entries.filter((e) => e.at >= cutoff).slice(-MAX_ENTRIES);
    this.save();
  }

  recent(limit = 60): Activity[] {
    return this.entries.slice(-limit).reverse();
  }

  clear(): void {
    if (!this.ok) return;
    this.entries = [];
    this.save();
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private get file(): string {
    return join(this.dir, `${NAME}.vault`);
  }

  private save(): void {
    const body = JSON.stringify(seal(this.key, NAME, JSON.stringify(this.entries)));
    this.writing = this.writing
      .then(async () => {
        mkdirSync(this.dir, { recursive: true });
        await writeFile(`${this.file}.tmp`, body, { encoding: 'utf8', mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
      })
      .catch((err) => this.log.error(`Could not save the memory activity log: ${(err as Error).message}`));
  }
}
