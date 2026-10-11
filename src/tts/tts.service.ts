import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { SpeakerService, PcmFormat } from '../audio/speaker.service';
import { WyomingClient } from '../wyoming/wyoming-client';
import { AsyncQueue } from '../wyoming/async-queue';

const SYNTH_TIMEOUT_MS = 15_000;

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
  private readonly log = new Logger(TtsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly speaker: SpeakerService,
  ) {}

  /** Returns a speech session: say() each sentence, then await done(). */
  session() {
    const order = new AsyncQueue<Synthesis>();
    const playback = (async () => {
      for await (const s of order) {
        try {
          await this.speaker.play(await s.format, s.audio);
        } catch (err) {
          this.log.error(`Voice (text-to-speech) failed: ${(err as Error).message}. Check: docker compose logs piper`);
        }
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
      // Never wait forever: a voice service that doesn't answer would freeze Max.
      const timer = setTimeout(() => fail(new Error(`no audio from the voice service within ${SYNTH_TIMEOUT_MS / 1000}s`)), SYNTH_TIMEOUT_MS);
      const fail = (err: Error) => {
        clearTimeout(timer);
        audio.close();
        client.close();
        reject(err);
      };
      client.on('event', (e) => {
        if (e.type === 'audio-start') {
          clearTimeout(timer);
          resolve({ rate: Number(e.data.rate), width: Number(e.data.width), channels: Number(e.data.channels) });
        } else if (e.type === 'audio-chunk' && e.payload) {
          audio.push(e.payload);
        } else if (e.type === 'audio-stop') {
          audio.close();
          client.close();
        } else if (e.type === 'error') {
          fail(new Error(String(e.data.text ?? 'voice service error')));
        }
      });
      client.on('error', (err) => fail(err));
      client
        .connect()
        .then(() => {
          const data: Record<string, unknown> = { text };
          if (this.cfg.tts.voice) data.voice = { name: this.cfg.tts.voice };
          client.send('synthesize', data);
        })
        .catch((err) => fail(err));
    });
    return { format, audio };
  }

  /** A short rising two-note chime, so you know Max is listening. */
  chime(): Promise<void> {
    const rate = 22050;
    const notes = [880, 1320];
    const noteMs = 90;
    const pcm = Buffer.alloc(Math.round((rate * noteMs) / 1000) * notes.length * 2);
    let i = 0;
    for (const f of notes) {
      const n = Math.round((rate * noteMs) / 1000);
      for (let k = 0; k < n; k++, i += 2) {
        const fade = Math.min(1, k / 200, (n - k) / 200); // avoid clicks
        pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * k) / rate) * 6000 * fade), i);
      }
    }
    return this.speaker.play({ rate, width: 2, channels: 1 }, (async function* () { yield pcm; })());
  }
}
