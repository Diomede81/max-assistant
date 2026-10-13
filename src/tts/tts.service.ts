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
 * Text-to-speech. Two providers, chosen with TTS_PROVIDER:
 *  - piper:  local Piper over Wyoming (fast, robotic-ish)
 *  - openai: any OpenAI-compatible /audio/speech API, e.g. Kokoro running locally in
 *            Docker (natural, free) or OpenAI's cloud voices (most expressive, paid)
 * Sentences are synthesised as soon as the LLM produces them and played back in order,
 * so Max starts talking after the first sentence instead of waiting for the whole answer.
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
    let stopped = false;
    const playback = (async () => {
      for await (const s of order) {
        if (stopped) continue; // interrupted: drop what was still queued
        try {
          await this.speaker.play(await s.format, s.audio);
        } catch (err) {
          this.log.error(`Voice (text-to-speech) failed: ${(err as Error).message}. ${this.checkHint()}`);
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
        stopped = true;
        order.close();
        this.speaker.stop();
      },
    };
  }

  private checkHint(): string {
    return this.cfg.tts.provider === 'openai'
      ? `Check TTS_BASE_URL / TTS_API_KEY / TTS_VOICE (and "docker compose logs kokoro" if using Kokoro)`
      : 'Check: docker compose logs piper';
  }

  private synthesize(text: string): Synthesis {
    return this.cfg.tts.provider === 'openai' ? this.synthesizeOpenAi(text) : this.synthesizePiper(text);
  }

  /** OpenAI-compatible speech API, streamed as raw 16-bit mono PCM. */
  private synthesizeOpenAi(text: string): Synthesis {
    const audio = new AsyncQueue<Buffer>();
    const { tts } = this.cfg;
    const abort = new AbortController();
    const format = new Promise<PcmFormat>((resolve, reject) => {
      const timer = setTimeout(() => abort.abort(), SYNTH_TIMEOUT_MS);
      const body: Record<string, unknown> = {
        model: tts.model,
        input: text,
        voice: tts.voice ?? 'bm_george',
        response_format: 'pcm',
      };
      if (tts.instructions) body.instructions = tts.instructions;
      fetch(`${tts.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tts.apiKey}` },
        body: JSON.stringify(body),
        signal: abort.signal,
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            const detail = (await res.text().catch(() => '')).slice(0, 200);
            throw new Error(`speech API answered ${res.status}${detail ? `: ${detail}` : ''}`);
          }
          clearTimeout(timer);
          resolve({ rate: tts.sampleRate, width: 2, channels: 1 });
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            audio.push(Buffer.from(chunk));
          }
          audio.close();
        })
        .catch((err: Error) => {
          clearTimeout(timer);
          audio.close();
          reject(err.name === 'AbortError' ? new Error(`no audio from the speech API within ${SYNTH_TIMEOUT_MS / 1000}s`) : err);
        });
    });
    return { format, audio };
  }

  private synthesizePiper(text: string): Synthesis {
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
