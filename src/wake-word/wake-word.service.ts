import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
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

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

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
      const active = this.cfg.wakeWord.names.filter((n) => available.includes(n));
      const missing = this.cfg.wakeWord.names.filter((n) => !available.includes(n));
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
    const client = new WyomingClient(this.cfg.wakeWord.host, this.cfg.wakeWord.port);
    await client.connect();
    this.client = client;
    const detected = new Promise<string>((resolve, reject) => {
      client.on('event', (e) => {
        if (e.type === 'detection') resolve(String(e.data.name ?? 'wake'));
      });
      client.on('error', reject);
    });
    client.send('detect', { names: this.cfg.wakeWord.names });
    client.send('audio-start', { ...format, timestamp: 0 });
    return { detected };
  }

  feed(chunk: Buffer, format: { rate: number; width: number; channels: number }): void {
    this.client?.send('audio-chunk', { ...format }, chunk);
  }

  disarm(): void {
    this.client?.close();
    this.client = undefined;
  }
}

/** Extracts model names from a Wyoming `info` event: { wake: [{ models: [{ name }] }] }. */
export function wakeWordNames(info: Record<string, unknown>): string[] {
  const programs = (info.wake ?? []) as Array<{ models?: Array<{ name?: string }> }>;
  return programs.flatMap((p) => (p.models ?? []).map((m) => String(m.name ?? ''))).filter(Boolean);
}
