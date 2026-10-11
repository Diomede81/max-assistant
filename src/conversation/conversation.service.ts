import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { MicrophoneService } from '../audio/microphone.service';
import { Endpointer } from '../audio/endpointer';
import { WakeWordService } from '../wake-word/wake-word.service';
import { SttService } from '../stt/stt.service';
import { LlmService } from '../llm/llm.service';
import { TtsService } from '../tts/tts.service';
import { SentenceSplitter } from './sentence-splitter';

type State = 'idle' | 'wake' | 'listen' | 'respond';

const HISTORY_LIMIT = 16;
const HISTORY_RESET_MS = 2 * 60 * 1000;
const FOLLOW_UP_WINDOW_MS = 5000;

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
  ) {}

  onApplicationBootstrap(): void {
    this.mic.on('chunk', (c: Buffer) => this.onChunk(c));
    this.mic.start();
    void this.waitForWakeWord();
  }

  private async waitForWakeWord(): Promise<void> {
    this.state = 'wake';
    const fmt = this.mic.format;
    try {
      const { detected } = await this.wake.arm(fmt);
      this.onChunk = (c) => this.wake.feed(c, fmt);
      this.log.log(`Listening for wake word: ${this.cfg.wakeWord.names.join(', ')}`);
      const name = await detected;
      this.wake.disarm();
      this.log.log(`Wake word "${name}" detected`);
      await this.listen(4000);
    } catch (err) {
      this.log.error(`Wake word service error: ${(err as Error).message}; retrying in 3s`);
      this.wake.disarm();
      this.onChunk = () => undefined;
      setTimeout(() => void this.waitForWakeWord(), 3000);
    }
  }

  /** Records one utterance; if nobody speaks within `noSpeechMs` we go back to sleep. */
  private async listen(noSpeechMs: number): Promise<void> {
    this.state = 'listen';
    const fmt = this.mic.format;
    const { vad } = this.cfg;
    const endpointer = new Endpointer(fmt.rate, vad.rmsThreshold, vad.silenceMs, vad.maxUtteranceMs, noSpeechMs);
    const session = await this.stt.open(fmt);

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
      return this.waitForWakeWord();
    }

    const tEnd = Date.now();
    const text = await session.finish();
    const tStt = Date.now();
    if (!text) return this.waitForWakeWord();
    this.log.log(`You: "${text}"  (stt ${tStt - tEnd} ms)`);
    await this.respond(text, tEnd);
    return this.listen(FOLLOW_UP_WINDOW_MS);
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
      this.log.error(`LLM error: ${(err as Error).message}`);
      splitter.flush();
      speech.say('Sorry, I could not reach my brain just now.');
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
