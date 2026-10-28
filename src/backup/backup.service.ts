import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { APP_CONFIG, AppConfig } from '../config';
import { masterKey, vaultKey } from '../memory/crypto';
import { memorySecret, SealedStore } from '../memory/sealed-store';
import { local } from '../routines/routines.service';

/**
 * Backups of everything Max keeps, as one encrypted file that is safe to store anywhere (a laptop, a USB
 * stick, a cloud drive, an email to yourself): it can only be opened with Max's encryption key, which is
 * never inside it. Made on request (downloaded from the control panel) or every day into a folder on the box
 * that you can sync or copy elsewhere, and restored from the control panel.
 *
 * The file: a magic header, then AES-256-GCM (a key derived from Max's secret, bound to the word "backup")
 * over a gzip of a simple stream: for each file, one line of JSON ({"p": path, "s": size}) and its bytes.
 */
const MAGIC = Buffer.from('MAX-BACKUP-1\n');
const IV_LEN = 12;
const TAG_LEN = 16;
const TICK_MS = 60_000;
/** Left out of Max's data folder: the key (never travels with the data), half-written files, and the backups themselves. */
const SKIP_DATA = /^(memory\.key|.*\.tmp|backups(\/.*)?)$/;
/** Left out of Home Assistant's folder: its history database (large, rebuilt by itself), logs, caches and downloaded packages. */
const SKIP_HOME = /(^|\/)(home-assistant_v2\.db.*|home-assistant\.log.*|\.cloud|deps|tts|__pycache__|\.HA_VERSION|blueprints\/.*\/homeassistant)(\/|$)/;
const MAX_FILE = 256 * 1024 * 1024;

export interface BackupSettings {
  /** A backup into the folder every day at this time. */
  auto: boolean;
  time: string;
  /** How many daily backups the folder keeps (older ones are removed). */
  keep: number;
  lastAt?: string;
  lastSize?: number;
  lastWhere?: 'download' | 'folder';
  lastError?: string;
  /** The last restore, and whether Max still has to restart for it. */
  restoredAt?: string;
}

export interface BackupStatus extends BackupSettings {
  /** The folder on the box where daily backups go (BACKUP_DIR), if it exists. */
  folder?: string;
  files: { name: string; size: number; at: string }[];
  /** Home Assistant's own settings are included (its folder is mounted). */
  withHome: boolean;
  /** Max is about to restart after a restore. */
  restarting: boolean;
}

interface Entry {
  p: string;
  s: number;
}

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private readonly store: SealedStore<BackupSettings>;
  private settings: BackupSettings = { auto: true, time: '03:30', keep: 7 };
  private timer?: NodeJS.Timeout;
  private lastAutoDate = '';
  private key?: Buffer;
  restarting = false;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'backup', memorySecret(cfg));
  }

  onModuleInit(): void {
    try {
      this.settings = { ...this.settings, ...(this.store.load() ?? {}) };
    } catch (err) {
      this.log.error(`Could not read the backup settings: ${(err as Error).message}`);
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (this.settings.auto) this.log.log(`A backup goes into ${this.folder ?? this.cfg.backup.dir} every day at ${this.settings.time}${this.folder ? '' : ' (the folder is missing: see docs/BACKUP.md)'}`);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** The folder daily backups go into, when it exists (mounted from the box: ./backups). */
  get folder(): string | undefined {
    return existsSync(this.cfg.backup.dir) ? this.cfg.backup.dir : undefined;
  }

  get withHome(): boolean {
    return existsSync(this.cfg.backup.homeDir);
  }

  status(): BackupStatus {
    const files = this.folder
      ? readdirSync(this.folder)
          .filter((n) => n.endsWith('.maxbak'))
          .map((n) => {
            const st = statSync(join(this.folder!, n));
            return { name: n, size: st.size, at: st.mtime.toISOString() };
          })
          .sort((a, b) => b.at.localeCompare(a.at))
      : [];
    return { ...this.settings, folder: this.folder, files, withHome: this.withHome, restarting: this.restarting };
  }

  /** The encryption key, for keeping somewhere safe (a password manager): without it a backup can't be opened. */
  secret(): string {
    const s = memorySecret(this.cfg);
    if (!s) throw new Error('Max has no encryption key yet (memory is off): backups need one');
    return s;
  }

  setAuto(auto: boolean, time?: string, keep?: string): string {
    if (time !== undefined && !/^\d{2}:\d{2}$/.test(time)) return 'The time should look like 03:30.';
    const n = keep === undefined || keep === '' ? this.settings.keep : Number(keep);
    if (!Number.isInteger(n) || n < 1 || n > 60) return 'Keep between 1 and 60 backups.';
    this.settings = { ...this.settings, auto, time: time ?? this.settings.time, keep: n };
    this.save();
    return auto ? `A backup goes into the folder every day at ${this.settings.time}, keeping the last ${n}.` : 'Daily backups are off: download one from here now and then.';
  }

  /** The backup file, for downloading. */
  make(): { name: string; data: Buffer } {
    const data = this.build();
    this.settings = { ...this.settings, lastAt: new Date().toISOString(), lastSize: data.length, lastWhere: 'download', lastError: undefined };
    this.save();
    this.log.log(`Backup downloaded (${mb(data.length)})`);
    return { name: this.fileName(), data };
  }

  /** A backup into the folder now (also what the daily backup does). */
  toFolder(): string {
    const dir = this.folder;
    if (!dir) {
      const why = `The backup folder ${this.cfg.backup.dir} doesn't exist (see docs/BACKUP.md).`;
      this.settings = { ...this.settings, lastError: why };
      this.save();
      return why;
    }
    try {
      const data = this.build();
      const path = join(dir, this.fileName());
      writeFileSync(`${path}.tmp`, data, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      this.prune(dir);
      this.settings = { ...this.settings, lastAt: new Date().toISOString(), lastSize: data.length, lastWhere: 'folder', lastError: undefined };
      this.save();
      this.log.log(`Backup saved: ${path} (${mb(data.length)})`);
      return `Backup saved to the folder (${mb(data.length)}).`;
    } catch (err) {
      const why = `Backup failed: ${(err as Error).message}`;
      this.log.error(why);
      this.settings = { ...this.settings, lastError: why };
      this.save();
      return why;
    }
  }

  /**
   * Puts a backup's files back. Max's own data goes straight into place; Home Assistant's settings go into
   * data/home-assistant-restore for copying over by hand (its folder is read-only here). Max restarts afterwards
   * so everything is read fresh.
   */
  restore(file: Buffer): { ok: true; files: number; home: number } | { ok: false; error: string } {
    let entries: { entry: Entry; bytes: Buffer }[];
    try {
      entries = this.unpack(file);
    } catch (err) {
      return { ok: false, error: /unable to authenticate|auth/i.test((err as Error).message) ? "This backup was made with a different key, so it can't be opened here." : `Not a Max backup: ${(err as Error).message}` };
    }
    let files = 0;
    let home = 0;
    for (const { entry, bytes } of entries) {
      const parts = entry.p.split('/');
      if (parts.some((x) => x === '..' || x === '' || x === '.')) continue; // never outside the data folder
      const [root, ...rest] = parts;
      let target: string;
      if (root === 'data') {
        if (SKIP_DATA.test(rest.join('/'))) continue;
        target = join(this.cfg.memory.dir, ...rest);
        files++;
      } else if (root === 'home-assistant') {
        target = join(this.cfg.memory.dir, 'home-assistant-restore', ...rest);
        home++;
      } else continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(`${target}.tmp`, bytes, { mode: 0o600 });
      renameSync(`${target}.tmp`, target);
    }
    this.settings = { ...this.settings, restoredAt: new Date().toISOString() };
    this.save();
    this.log.warn(`Restored ${files} files from a backup${home ? ` (and ${home} Home Assistant files into home-assistant-restore)` : ''}: restarting so everything is read fresh`);
    this.restarting = true;
    setTimeout(() => process.exit(0), 1500).unref();
    return { ok: true, files, home };
  }

  // ---------- the file ----------

  private build(): Buffer {
    const chunks: Buffer[] = [];
    const add = (base: string, root: string, skip: RegExp) => {
      for (const path of walk(base)) {
        const rel = relative(base, path).split(sep).join('/');
        if (skip.test(rel)) continue;
        const st = statSync(path);
        if (st.size > MAX_FILE) {
          this.log.warn(`Backup: ${rel} left out (${mb(st.size)} is too large)`);
          continue;
        }
        const bytes = readFileSync(path);
        chunks.push(Buffer.from(`${JSON.stringify({ p: `${root}/${rel}`, s: bytes.length } as Entry)}\n`), bytes);
      }
    };
    add(this.cfg.memory.dir, 'data', SKIP_DATA);
    if (this.withHome) add(this.cfg.backup.homeDir, 'home-assistant', SKIP_HOME);
    const plain = gzipSync(Buffer.concat(chunks));
    const iv = randomBytes(IV_LEN);
    const c = createCipheriv('aes-256-gcm', this.cipherKey(), iv);
    c.setAAD(MAGIC);
    const data = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
  }

  private unpack(file: Buffer): { entry: Entry; bytes: Buffer }[] {
    if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a Max backup file');
    const iv = file.subarray(MAGIC.length, MAGIC.length + IV_LEN);
    const tag = file.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN);
    const d = createDecipheriv('aes-256-gcm', this.cipherKey(), iv);
    d.setAAD(MAGIC);
    d.setAuthTag(tag);
    const plain = gunzipSync(Buffer.concat([d.update(file.subarray(MAGIC.length + IV_LEN + TAG_LEN)), d.final()]));
    const out: { entry: Entry; bytes: Buffer }[] = [];
    let at = 0;
    while (at < plain.length) {
      const nl = plain.indexOf(0x0a, at);
      if (nl < 0) throw new Error('the file ends early');
      const entry = JSON.parse(plain.subarray(at, nl).toString('utf8')) as Entry;
      if (typeof entry.p !== 'string' || !Number.isInteger(entry.s) || entry.s < 0) throw new Error('bad entry');
      at = nl + 1;
      out.push({ entry, bytes: plain.subarray(at, at + entry.s) });
      at += entry.s;
    }
    return out;
  }

  private cipherKey(): Buffer {
    return (this.key ??= vaultKey(masterKey(this.secret()), 'backup'));
  }

  private fileName(): string {
    const { date, time } = local();
    return `max-backup-${date}-${time.replace(':', '')}.maxbak`;
  }

  private prune(dir: string): void {
    const files = readdirSync(dir)
      .filter((n) => /^max-backup-.*\.maxbak$/.test(n))
      .sort()
      .reverse();
    for (const n of files.slice(this.settings.keep)) {
      try {
        unlinkSync(join(dir, n));
      } catch {
        /* someone else's file */
      }
    }
  }

  private tick(): void {
    if (!this.settings.auto || this.restarting) return;
    const { date, time } = local();
    if (time !== this.settings.time || this.lastAutoDate === date) return;
    this.lastAutoDate = date;
    this.toFolder();
  }

  private save(): void {
    this.store.save(this.settings).catch((err) => this.log.error(`Could not save the backup settings: ${(err as Error).message}`));
  }
}

function* walk(dir: string): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names.sort()) {
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

export function mb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
