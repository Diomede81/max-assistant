import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../config';
import { masterKey, newSecret, open, seal, SealedFile, vaultKey } from './crypto';

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
      return this.key ? this.fromPlain() : undefined;
    }
    const text = this.key ? open(this.key, this.name, JSON.parse(raw) as SealedFile) : raw;
    return JSON.parse(text) as T;
  }

  /**
   * A plain file left from before this store was encrypted (memory switched off, or a first start
   * before the key existed): taken into the vault and removed, so nothing stays on disk unencrypted.
   */
  private fromPlain(): T | undefined {
    const plain = join(this.dir, `${this.name}.json`);
    if (!existsSync(plain)) return undefined;
    try {
      const data = JSON.parse(readFileSync(plain, 'utf8')) as T;
      writeFileSync(`${this.file}.tmp`, JSON.stringify(seal(this.key!, this.name, JSON.stringify(data))), { encoding: 'utf8', mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
      unlinkSync(plain);
      return data;
    } catch {
      return undefined;
    }
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

let generated = false;

/**
 * The encryption secret every store uses: MEMORY_KEY from .env, else a key made once on the first
 * start and kept in data/memory.key. Made here, synchronously, before any store opens, so no store
 * can ever be written unencrypted because it started before the key existed. Independent of whether
 * memory (the vaults) is switched on: WhatsApp keys, health records and the rest are encrypted regardless.
 */
export function memorySecret(cfg: AppConfig): string {
  if (cfg.memory.key) return cfg.memory.key;
  const file = join(cfg.memory.dir, 'memory.key');
  try {
    const s = readFileSync(file, 'utf8').trim();
    if (s) return s;
  } catch {
    // none yet
  }
  mkdirSync(cfg.memory.dir, { recursive: true });
  const s = newSecret();
  writeFileSync(file, s, { encoding: 'utf8', mode: 0o600 });
  generated = true;
  return s;
}

/** Whether this start made a new key (so the memory service can say so once). */
export function keyWasGenerated(): boolean {
  return generated;
}
