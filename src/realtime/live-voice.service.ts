import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { SpeakerService } from '../audio/speaker.service';
import { SealedStore } from '../memory/sealed-store';
import { GeminiLiveClient } from './gemini-live-client';
import { RealtimeClient } from './realtime-client';
import type { VoiceClient } from './voice-client';
import { said } from '../log-content';

export const PCM24 = { rate: 24000, width: 2, channels: 1 };
const RECORD_TIMEOUT_MS = 20_000;
/** A reminder waits at most this long for its live-voice recording (the chimes play meanwhile). */
const ANNOUNCE_TIMEOUT_MS = 10_000;
const SAMPLE = "Hi, I'm Max. This is how I'd sound. How can I help?";

/** The voices each provider offers, with a word on each (the dashboard's list). */
export const LIVE_VOICES: Record<'openai' | 'gemini', { id: string; label: string }[]> = {
  openai: [
    { id: 'cedar', label: 'Cedar: male, natural (recommended)' },
    { id: 'marin', label: 'Marin: female, natural (recommended)' },
    { id: 'ash', label: 'Ash: male, clear' },
    { id: 'ballad', label: 'Ballad: male, gentle' },
    { id: 'echo', label: 'Echo: male, warm' },
    { id: 'verse', label: 'Verse: male, expressive' },
    { id: 'coral', label: 'Coral: female, friendly' },
    { id: 'sage', label: 'Sage: female, calm' },
    { id: 'shimmer', label: 'Shimmer: female, bright' },
    { id: 'alloy', label: 'Alloy: neutral' },
  ],
  gemini: [
    { id: 'Charon', label: 'Charon: male, informative' },
    { id: 'Puck', label: 'Puck: male, upbeat' },
    { id: 'Fenrir', label: 'Fenrir: male, excitable' },
    { id: 'Orus', label: 'Orus: male, firm' },
    { id: 'Kore', label: 'Kore: female, firm' },
    { id: 'Aoede', label: 'Aoede: female, breezy' },
    { id: 'Leda', label: 'Leda: female, youthful' },
    { id: 'Zephyr', label: 'Zephyr: female, bright' },
  ],
};

interface Saved {
  voice?: string;
  style?: string;
}

/**
 * Max's live voice (real-time mode): which voice and speaking style (chosen on the control panel,
 * or REALTIME_VOICE / REALTIME_STYLE in .env), and short phrases recorded once in that voice and
 * kept on disk (the "Hey Max" greeting), so they play instantly and sound like the rest of the
 * conversation. A new voice, style or phrase is simply recorded again.
 */
@Injectable()
export class LiveVoiceService implements OnModuleInit {
  private readonly log = new Logger('LiveVoice');
  private readonly store: SealedStore<Saved>;
  private saved: Saved = {};
  private readonly dir: string;
  private readonly recording = new Map<string, Promise<Buffer | undefined>>();

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly speaker: SpeakerService,
  ) {
    this.store = new SealedStore(cfg.memory.dir, 'live-voice');
    this.dir = join(cfg.memory.dir, 'voice-cache');
  }

  onModuleInit(): void {
    try {
      this.saved = this.store.load() ?? {};
    } catch {
      // .env values
    }
  }

  /** Real-time mode is on and has a key. */
  get active(): boolean {
    return this.cfg.voiceMode === 'realtime' && Boolean(this.cfg.realtime.apiKey);
  }

  get provider(): 'openai' | 'gemini' {
    return this.cfg.realtime.provider === 'gemini' ? 'gemini' : 'openai';
  }

  get voice(): string {
    return this.saved.voice || this.cfg.realtime.voice;
  }

  get style(): string {
    return this.saved.style ?? this.cfg.realtime.style;
  }

  /** Control panel: a new voice and/or style. The greeting is re-recorded in the background by the caller. */
  save(changes: Saved): string {
    const voice = changes.voice?.trim();
    if (voice !== undefined && !/^[A-Za-z0-9_-]{1,40}$/.test(voice)) return 'Unknown voice.';
    this.saved = {
      voice: voice ?? this.saved.voice,
      style: changes.style !== undefined ? changes.style.replace(/\s+/g, ' ').trim().slice(0, 400) : this.saved.style,
    };
    this.store.save(this.saved).catch((err) => this.log.warn(`Could not save the voice: ${(err as Error).message}`));
    this.log.log(`Live voice: ${this.voice}${this.saved.style ? ' (own speaking style)' : ''}`);
    return `Saved. Max now speaks with the ${this.voice} voice.`;
  }

  // ---------- Recorded phrases (the greeting) ----------

  private key(text: string, voice = this.voice, style = this.style): string {
    const r = this.cfg.realtime;
    return createHash('sha256').update([r.provider, r.model, voice, style, text].join('\n')).digest('hex').slice(0, 24);
  }

  /** The phrase in the live voice, if it has been recorded (24 kHz 16-bit mono). */
  recorded(text: string): Buffer | undefined {
    try {
      return readFileSync(join(this.dir, `${this.key(text)}.pcm`));
    } catch {
      return undefined;
    }
  }

  /** Records the phrase in the live voice if it isn't yet (once; later calls wait for the same recording). */
  ensure(text: string): Promise<Buffer | undefined> {
    if (!this.active || !text.trim()) return Promise.resolve(undefined);
    const have = this.recorded(text);
    if (have) return Promise.resolve(have);
    const key = this.key(text);
    let p = this.recording.get(key);
    if (!p) {
      p = this.record(text)
        .then((pcm) => {
          mkdirSync(this.dir, { recursive: true });
          // Only the current phrases are kept: older voices, styles or greetings are removed.
          for (const f of readdirSync(this.dir)) if (f.endsWith('.pcm') && f !== `${key}.pcm`) unlinkSync(join(this.dir, f));
          writeFileSync(join(this.dir, `${key}.pcm`), pcm);
          this.log.log(`Recorded "${text}" in the ${this.voice} voice`);
          return pcm;
        })
        .catch((err) => {
          this.log.warn(`Could not record "${text}" in the live voice (${(err as Error).message}); the standard voice says it meanwhile`);
          return undefined;
        })
        .finally(() => this.recording.delete(key));
      this.recording.set(key, p);
    }
    return p;
  }

  /**
   * A one-off line in the live voice (a reminder or a timer going off), recorded now and not kept.
   * Undefined if it can't be recorded in time: the caller says it in the standard voice instead.
   */
  async line(text: string, timeoutMs = ANNOUNCE_TIMEOUT_MS): Promise<Buffer | undefined> {
    if (!this.active || !text.trim()) return undefined;
    try {
      return await this.record(text, this.voice, this.style, timeoutMs);
    } catch (err) {
      this.log.warn(`Could not say ${said(text)} in the live voice (${(err as Error).message}); using the standard voice`);
      return undefined;
    }
  }

  async play(pcm: Buffer): Promise<void> {
    await this.speaker.play(PCM24, (async function* () { yield pcm; })());
  }

  /** Control panel "Try it": the sample line in this voice and style, played on the box. */
  async preview(voice: string, style: string): Promise<string> {
    if (!this.active) return 'Live voice is not on (VOICE_MODE=realtime and its key are needed).';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(voice)) return 'Unknown voice.';
    try {
      await this.play(await this.record(SAMPLE, voice, style.replace(/\s+/g, ' ').trim().slice(0, 400)));
      return `That was ${voice}.`;
    } catch (err) {
      return `Could not try ${voice}: ${(err as Error).message}`;
    }
  }

  /** One short session that only says `text`, recorded (no tools, no microphone). */
  private record(text: string, voice = this.voice, style = this.style, timeoutMs = RECORD_TIMEOUT_MS): Promise<Buffer> {
    const r = this.cfg.realtime;
    const client: VoiceClient = new (r.provider === 'gemini' ? GeminiLiveClient : RealtimeClient)({
      url: r.url,
      apiKey: r.apiKey,
      model: r.model,
      voice,
      instructions:
        `${style}\nYou are recording a voice line. When you are given a line of text, say exactly that line, once, ` +
        'in your voice and style. Add nothing before or after it, and do not answer it.',
      tools: [],
      silenceMs: r.silenceMs,
      interruptResponse: false,
      language: r.language,
    });
    return new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = [];
      let over = false;
      const finish = (err?: Error) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        client.removeAllListeners();
        client.on('error', () => undefined);
        client.close();
        if (err) reject(err);
        else if (!parts.length) reject(new Error('no audio came back'));
        else resolve(Buffer.concat(parts));
      };
      const timer = setTimeout(() => finish(new Error('timed out')), timeoutMs);
      client.on('audio', (b: Buffer) => parts.push(b));
      client.on('response-done', () => finish());
      client.on('error', (e: Error) => finish(e));
      client.on('close', () => finish(parts.length ? undefined : new Error('the connection closed')));
      client
        .connect()
        .then(() => client.speak(`Say exactly this line: ${text}`))
        .catch((e: Error) => finish(e));
    });
  }
}
