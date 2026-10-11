import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { WyomingClient } from '../wyoming/wyoming-client';

/**
 * Speech-to-text over Wyoming (faster-whisper locally, or any Wyoming-compatible STT).
 * Audio is streamed while the user is still talking, so only the final decode is on
 * the critical path. To use a cloud streaming STT (e.g. Deepgram) implement the same
 * `transcribe` signature in another provider.
 */
@Injectable()
export class SttService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async open(format: { rate: number; width: number; channels: number }) {
    const client = new WyomingClient(this.cfg.stt.host, this.cfg.stt.port);
    await client.connect();
    const transcript = new Promise<string>((resolve, reject) => {
      client.on('event', (e) => {
        if (e.type === 'transcript') {
          resolve(String(e.data.text ?? '').trim());
          client.close();
        }
      });
      client.on('error', reject);
    });
    client.send('transcribe', { language: this.cfg.stt.language });
    client.send('audio-start', { ...format, timestamp: 0 });
    return {
      write: (chunk: Buffer) => client.send('audio-chunk', { ...format }, chunk),
      finish: () => {
        client.send('audio-stop', {});
        return transcript;
      },
      abort: () => client.close(),
    };
  }
}
