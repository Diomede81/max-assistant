import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { MicrophoneService } from '../audio/microphone.service';
import { Endpointer } from '../audio/endpointer';
import { WakeWordService } from '../wake-word/wake-word.service';
import { SttService } from '../stt/stt.service';
import { LlmService, explainLlmError } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import { SentenceSplitter } from './sentence-splitter';
import { TimerService, announcement } from '../actions/timer.service';

type State = 'idle' | 'wake' | 'listen' | 'respond';

const HISTORY_LIMIT = 16;
const HISTORY_RESET_MS = 2 * 60 * 1000;
const FOLLOW_UP_WINDOW_MS = 5000;
const CHIME_GRACE_MS = 400;
const STT_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

/**
 * The conductor: wake word -> listen -> transcribe -> think/act -> speak -> short
 * follow-up window (no wake word needed) -> back to wake word.
 * Logs a latency breakdown for every turn so tuning is based on numbers.
 */
@Injectable()
export class ConversationService implements OnApplicationBootstrap {
  private readonly log = new Logger(ConversationService.name);
  private state: State = 'idle';
  private onChunk: (chunk: Buffer) => void = () => undefined;
  private history: ChatCompletionMessageParam[] = [];
  private lastTurnAt = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mic: MicrophoneService,
    private readonly wake: WakeWordService,
    private readonly stt: SttService,
    private readonly llm: LlmService,
    private readonly tts: TtsService,
    private readonly timers: TimerService,
  ) {}

  private readonly pendingAnnouncements: string[] = [];
  private announcing = false;

  onApplicationBootstrap(): void {
    this.mic.on('chunk', (c: Buffer) => this.onChunk(c));
    this.mic.start();
    // Timers/reminders are announced straight away when Max is idle, otherwise as soon as
    // the current conversation ends (never in the middle of an answer).
    this.timers.on('fired', (t) => {
      this.pendingAnnouncements.push(announcement(t));
      if (this.state === 'wake') void this.flushAnnouncements();
    });
    void this.wake.checkConfiguredNames().then(() => this.waitForWakeWord());
  }

  private async flushAnnouncements(): Promise<void> {
    if (this.announcing) return;
    this.announcing = true;
    try {
      while (this.pendingAnnouncements.length) {
        const text = this.pendingAnnouncements.shift()!;
        this.log.log(`Announcing: "${text}"`);
        await this.tts.chime().catch(() => undefined);
        await this.tts.chime().catch(() => undefined);
        const speech = this.tts.session();
        speech.say(text);
        await speech.done();
      }
    } finally {
      this.announcing = false;
    }
  }

  private async waitForWakeWord(): Promise<void> {
    this.state = 'wake';
    if (this.pendingAnnouncements.length) void this.flushAnnouncements();
    const fmt = this.mic.format;
    let name: string;
    try {
      const { detected } = await this.wake.arm(fmt);
      this.onChunk = (c) => this.wake.feed(c, fmt);
      this.log.log(`Listening for wake word: ${this.cfg.wakeWord.names.join(', ')}`);
      name = await detected;
      this.wake.disarm();
    } catch (err) {
      this.log.error(`Wake word service error: ${(err as Error).message}; retrying in 3s`);
      this.wake.disarm();
      this.onChunk = () => undefined;
      setTimeout(() => void this.waitForWakeWord(), 3000);
      return;
    }

    this.log.log(`Wake word "${name}" detected - listening for your request`);
    if (this.cfg.audio.wakeChime) void this.tts.chime().catch(() => undefined);
    await this.conversation();
    return this.waitForWakeWord();
  }

  /** One request, then follow-ups without the wake word, until nobody speaks. */
  private async conversation(): Promise<void> {
    let noSpeechMs = 5000;
    for (;;) {
      try {
        const text = await this.listen(noSpeechMs, noSpeechMs === FOLLOW_UP_WINDOW_MS);
        if (!text) return;
        await this.respond(text.value, text.endOfSpeech);
      } catch (err) {
        this.log.error(`${(err as Error).message}; going back to waiting for the wake word`);
        this.onChunk = () => undefined;
        return;
      }
      noSpeechMs = FOLLOW_UP_WINDOW_MS;
    }
  }

  /**
   * Records one utterance and transcribes it. Returns undefined (and logs why) when
   * nobody spoke or nothing was understood, so Max never goes quiet without a reason.
   */
  private async listen(
    noSpeechMs: number,
    isFollowUp = false,
  ): Promise<{ value: string; endOfSpeech: number } | undefined> {
    this.state = 'listen';
    const fmt = this.mic.format;
    const { vad } = this.cfg;
    const grace = this.cfg.audio.wakeChime ? CHIME_GRACE_MS : 0;
    const endpointer = new Endpointer(fmt.rate, vad.rmsThreshold, vad.silenceMs, vad.maxUtteranceMs, noSpeechMs + grace, grace);
    let session: Awaited<ReturnType<SttService['open']>>;
    try {
      session = await this.stt.open(fmt);
    } catch (err) {
      throw new Error(`Speech-to-text service unreachable (${(err as Error).message}). Check: docker compose logs whisper`);
    }

    const outcome = await new Promise<'end' | 'timeout'>((resolve) => {
      this.onChunk = (c) => {
        session.write(c);
        const r = endpointer.push(c);
        if (r !== 'continue') {
          this.onChunk = () => undefined;
          resolve(r);
        }
      };
    });

    if (outcome === 'timeout') {
      session.abort();
      if (isFollowUp) {
        this.log.log('No follow-up question; going back to waiting for the wake word');
        return undefined;
      }
      this.log.log(
        `No request heard (loudest sound: level ${endpointer.peakRms}, speech needs >= ${vad.rmsThreshold}).` +
          (endpointer.peakRms > 0 && endpointer.peakRms < vad.rmsThreshold
            ? ` If you did speak, lower VAD_RMS_THRESHOLD in .env to about ${Math.max(100, Math.round(endpointer.peakRms * 0.6))}.`
            : ''),
      );
      return undefined;
    }

    const tEnd = Date.now();
    let text: string;
    try {
      text = await withTimeout(session.finish(), STT_TIMEOUT_MS, 'speech-to-text took too long');
    } catch (err) {
      session.abort();
      throw new Error(`Speech-to-text failed (${(err as Error).message}). Check: docker compose logs whisper`);
    }
    if (!text) {
      this.log.log('Heard sound but could not make out any words. Try speaking a little closer to the microphone.');
      return undefined;
    }
    this.log.log(`You: "${text}"  (stt ${Date.now() - tEnd} ms)`);
    return { value: text, endOfSpeech: tEnd };
  }

  private async respond(text: string, tEndOfSpeech: number): Promise<void> {
    this.state = 'respond';
    if (Date.now() - this.lastTurnAt > HISTORY_RESET_MS) this.history = [];
    this.history.push({ role: 'user', content: text });

    const speech = this.tts.session();
    const splitter = new SentenceSplitter();
    let firstSpoken = 0;
    let reply = '';
    try {
      for await (const fragment of this.llm.respond(this.history)) {
        reply += fragment;
        for (const sentence of splitter.push(fragment)) {
          if (!firstSpoken) firstSpoken = Date.now();
          speech.say(sentence);
        }
      }
    } catch (err) {
      const why = explainLlmError(err);
      this.log.error(`LLM error: ${why.log}`);
      splitter.flush();
      speech.say(why.spoken);
    }
    for (const sentence of splitter.flush()) {
      if (!firstSpoken) firstSpoken = Date.now();
      speech.say(sentence);
    }
    if (firstSpoken) {
      this.log.log(`Max: "${reply.trim()}"  (end-of-speech -> first sentence ${firstSpoken - tEndOfSpeech} ms)`);
    }
    await speech.done();
    this.lastTurnAt = Date.now();
    this.trimHistory();
  }

  /** Keep the context short (faster + cheaper) without orphaning tool results. */
  private trimHistory(): void {
    while (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
      while (this.history.length && this.history[0].role !== 'user') this.history.shift();
    }
  }
}
