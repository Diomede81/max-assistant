import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../config';
import { masterKey, open, seal, SealedFile, vaultKey } from './crypto';

/**
 * A small file of Max's own state (timers and reminders, his journal...) kept next to the
 * memory vaults so it survives restarts and updates. Encrypted with its own key derived
 * from the memory key, like the vaults; plain JSON only when memory is switched off.
 * Writes are queued and atomic (temp file + rename), so a crash never leaves half a file.
 */
export class SealedStore<T> {
  private readonly key?: Buffer;
  private readonly file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly name: string,
    secret?: string,
  ) {
    if (secret) this.key = vaultKey(masterKey(secret), name);
    this.file = join(dir, `${name}.${secret ? 'vault' : 'json'}`);
  }

  /** undefined when there is nothing saved yet (or it can't be read: logged by the caller). */
  load(): T | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return undefined;
    }
    const text = this.key ? open(this.key, this.name, JSON.parse(raw) as SealedFile) : raw;
    return JSON.parse(text) as T;
  }

  save(data: T): Promise<void> {
    const body = JSON.stringify(this.key ? seal(this.key, this.name, JSON.stringify(data)) : data);
    this.writing = this.writing.then(async () => {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}

/** The memory encryption secret (MEMORY_KEY, or the key file MemoryService created), if memory is on. */
export function memorySecret(cfg: AppConfig): string | undefined {
  if (!cfg.memory.enabled) return undefined;
  if (cfg.memory.key) return cfg.memory.key;
  try {
    return readFileSync(join(cfg.memory.dir, 'memory.key'), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}
