import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { SealedStore } from '../memory/sealed-store';
import { WyomingClient } from '../wyoming/wyoming-client';

/**
 * Streams microphone audio to a local openWakeWord service (Wyoming protocol) and
 * resolves when the wake word is heard. "hey_max" is a custom model (see training/README.md);
 * the built-in "hey_jarvis" works out of the box as a stand-in until it is trained.
 * Runs fully on-device: no audio leaves the house until the wake word fires.
 */
@Injectable()
export class WakeWordService {
  private readonly log = new Logger(WakeWordService.name);
  private client?: WyomingClient;
  /** The wake words chosen on the control panel (Settings → Device & voice); else WAKEWORD_NAMES. */
  private readonly store: SealedStore<{ names: string[] }>;
  private chosen?: string[];

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'wake-words');
    try {
      const saved = this.store.load()?.names;
      if (saved?.length) this.chosen = saved;
    } catch {
      // WAKEWORD_NAMES then
    }
  }

  /** The wake words Max listens for now (e.g. "hey_max" and "hey_jarvis" while hey_max is being trained). */
  get names(): string[] {
    return this.chosen ?? this.cfg.wakeWord.names;
  }

  /** Whether the choice comes from the control panel (rather than .env). */
  get chosenOnPanel(): boolean {
    return Boolean(this.chosen);
  }

  /** Changes the wake words (only installed ones, at least one); the listening session switches straight away. */
  async setNames(names: string[]): Promise<string> {
    const available = await this.availableNames();
    const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => available.includes(n)))];
    if (!wanted.length) return 'Choose at least one wake word.';
    this.chosen = wanted;
    await this.store.save({ names: wanted });
    // the session already listening switches now (a fresh connection with the new words; no restart)
    if (this.session) await this.open().catch((err) => this.log.warn(`Wake words saved; they apply from the next wake-up (${(err as Error).message})`));
    this.log.log(`Wake words now: ${wanted.join(', ')}`);
    return `Max now wakes up for ${wanted.map((n) => `"${phrase(n)}"`).join(' or ')}.`;
  }

  /**
   * Lists the wake words the openWakeWord service actually has. Important because the
   * service silently falls back to "okay_nabu" when asked for a name it doesn't know.
   */
  async availableNames(): Promise<string[]> {
    const client = new WyomingClient(this.cfg.wakeWord.host, this.cfg.wakeWord.port);
    await client.connect();
    try {
      return wakeWordNames(await client.describe());
    } finally {
      client.close();
    }
  }

  /**
   * Logs which phrase will actually wake Max. If none of the configured wake words is
   * installed, the service silently listens for "okay_nabu" instead, so say that loudly.
   */
  async checkConfiguredNames(): Promise<void> {
    try {
      const available = await this.availableNames();
      const active = this.names.filter((n) => available.includes(n));
      const missing = this.names.filter((n) => !available.includes(n));
      this.log.log(`Wake words installed: ${available.join(', ')}`);
      if (missing.length) {
        this.log.warn(
          `WAKEWORD_NAMES contains "${missing.join(', ')}", which is NOT installed. ` +
            `Check .env has only ONE WAKEWORD_NAMES line (the last one wins), or add the model to ./wakewords.`,
        );
      }
      const phrases = (active.length ? active : ['okay_nabu']).map((n) => `"${n.replace(/_/g, ' ')}"`);
      this.log.log(`>>> Say ${phrases.join(' or ')} to wake Max <<<`);
    } catch (err) {
      this.log.warn(`Could not list installed wake words: ${(err as Error).message}`);
    }
  }

  /**
   * Opens a fresh detection session; call feed() with mic chunks until `detected` resolves.
   * (Wrapped in an object: returning the inner promise directly would make `await arm()`
   * wait for the wake word itself, before any audio had been fed.)
   */
  async arm(format: { rate: number; width: number; channels: number }): Promise<{ detected: Promise<string> }> {
    this.disarm();
    let resolve!: (name: string) => void;
    let reject!: (err: Error) => void;
    const detected = new Promise<string>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    this.session = { format, resolve, reject };
    await this.open();
    return { detected };
  }

  /** The listening session: what it listens to, and how to answer the one waiting for the wake word. */
  private session?: { format: { rate: number; width: number; channels: number }; resolve: (name: string) => void; reject: (err: Error) => void };

  /** Connects for the current session, with the current wake words (again after they change). */
  private async open(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const client = new WyomingClient(this.cfg.wakeWord.host, this.cfg.wakeWord.port);
    await client.connect();
    if (this.session !== s) {
      client.close(); // disarmed meanwhile
      return;
    }
    const old = this.client;
    this.client = client;
    old?.close();
    client.on('event', (e) => {
      if (e.type === 'detection' && this.client === client) s.resolve(String(e.data.name ?? 'wake'));
    });
    client.on('error', (err: Error) => {
      if (this.client === client) s.reject(err);
    });
    client.send('detect', { names: this.names });
    client.send('audio-start', { ...s.format, timestamp: 0 });
  }

  feed(chunk: Buffer, format: { rate: number; width: number; channels: number }): void {
    this.client?.send('audio-chunk', { ...format }, chunk);
  }

  disarm(): void {
    this.session = undefined;
    const c = this.client;
    this.client = undefined;
    c?.close();
  }
}

/** Extracts model names from a Wyoming `info` event: { wake: [{ models: [{ name }] }] }. */
export function wakeWordNames(info: Record<string, unknown>): string[] {
  const programs = (info.wake ?? []) as Array<{ models?: Array<{ name?: string }> }>;
  return programs.flatMap((p) => (p.models ?? []).map((m) => String(m.name ?? ''))).filter(Boolean);
}

/** "hey_jarvis" → "Hey Jarvis". */
export function phrase(name: string): string {
  return name.replace(/_v\d.*$/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
