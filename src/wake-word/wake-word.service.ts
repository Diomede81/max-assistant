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
