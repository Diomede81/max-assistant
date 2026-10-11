import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { SpeakerService, PcmFormat } from '../audio/speaker.service';
import { WyomingClient } from '../wyoming/wyoming-client';
import { AsyncQueue } from '../wyoming/async-queue';

interface Synthesis {
  format: Promise<PcmFormat>;
  audio: AsyncQueue<Buffer>;
}

/**
 * Text-to-speech over Wyoming (Piper locally). Sentences are synthesised as soon as the
 * LLM produces them and played back in order, so Max starts talking after the first
 * sentence instead of waiting for the whole answer.
 */
@Injectable()
export class TtsService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly speaker: SpeakerService,
  ) {}

  /** Returns a speech session: say() each sentence, then await done(). */
  session() {
    const order = new AsyncQueue<Synthesis>();
    const playback = (async () => {
      for await (const s of order) {
        await this.speaker.play(await s.format, s.audio);
      }
    })();
    return {
      say: (text: string) => {
        if (text.trim()) order.push(this.synthesize(text));
      },
      done: async () => {
        order.close();
        await playback;
      },
      interrupt: () => {
        order.close();
        this.speaker.stop();
      },
    };
  }

  private synthesize(text: string): Synthesis {
    const audio = new AsyncQueue<Buffer>();
    const client = new WyomingClient(this.cfg.tts.host, this.cfg.tts.port);
    const format = new Promise<PcmFormat>((resolve, reject) => {
      client.on('event', (e) => {
        if (e.type === 'audio-start') {
          resolve({ rate: Number(e.data.rate), width: Number(e.data.width), channels: Number(e.data.channels) });
        } else if (e.type === 'audio-chunk' && e.payload) {
          audio.push(e.payload);
        } else if (e.type === 'audio-stop') {
          audio.close();
          client.close();
        }
      });
      client.on('error', (err) => {
        audio.close();
        reject(err);
      });
    });
    client
      .connect()
      .then(() => {
        const data: Record<string, unknown> = { text };
        if (this.cfg.tts.voice) data.voice = { name: this.cfg.tts.voice };
        client.send('synthesize', data);
      })
      .catch(() => audio.close());
    return { format, audio };
  }
}
