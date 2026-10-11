import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { SpeakerService } from '../audio/speaker.service';
import { Resampler } from '../audio/resampler';
import { AsyncQueue } from '../wyoming/async-queue';
import { ToolRouterService } from '../actions/tool-router.service';
import { TtsService } from '../tts/tts.service';
import { describeNow } from '../actions/clock';
import { WakeWordService } from '../wake-word/wake-word.service';
import { RealtimeClient } from './realtime-client';
import { GeminiLiveClient } from './gemini-live-client';
import type { VoiceClient, VoiceClientOptions } from './voice-client';

const PCM24 = { rate: 24000, width: 2, channels: 1 };
/** Skip the first moments after the wake word: that's Max's own chime. */
const CHIME_SKIP_MS = 400;
const FIRST_TURN_WAIT_MS = 7000;
/** If a provider never answers after the user spoke, stop waiting (keeps sessions from hanging open). */
const NO_ANSWER_MS = 15000;
/** After an interruption, listen again almost immediately (Max's audio has been cut). */
const INTERRUPT_REOPEN_MS = 250;

/**
 * One spoken conversation using OpenAI Realtime (speech in, speech out, no separate
 * transcription or text-to-speech). The local wake word starts it; it ends after
 * REALTIME_FOLLOW_UP_MS of quiet, so the paid connection is only open while talking.
 * Home Assistant, time and timer actions work exactly as in the normal pipeline.
 */
@Injectable()
export class RealtimeConversationService {
  private readonly log = new Logger('Realtime');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly speaker: SpeakerService,
    private readonly tools: ToolRouterService,
    private readonly tts: TtsService,
    private readonly wake: WakeWordService,
  ) {}

  /**
   * Runs until the conversation goes quiet. `setMicHandler` routes microphone chunks
   * (16-bit mono at `micRate`) to this conversation.
   */
  async run(setMicHandler: (h: (chunk: Buffer) => void) => void, micRate: number, chimed: boolean): Promise<void> {
    const rt = this.cfg.realtime;
    const providerName = rt.provider === 'gemini' ? 'Gemini Live' : 'OpenAI Realtime';
    if (!rt.apiKey) {
      this.log.error(
        rt.provider === 'gemini'
          ? 'GEMINI_API_KEY is not set in .env'
          : 'REALTIME_API_KEY (or OPENAI_API_KEY) is not set in .env',
      );
      return this.sayFallback(`I can't use my real-time voice: the ${rt.provider === 'gemini' ? 'Gemini' : 'OpenAI'} key is missing.`);
    }
    const started = Date.now();
    const options: VoiceClientOptions = {
      url: rt.url,
      apiKey: rt.apiKey,
      model: rt.model,
      voice: rt.voice,
      instructions:
        `${this.cfg.llm.systemPrompt}\n${rt.style}\nCurrent local time: ${describeNow()}.` +
        (this.tools.homeAssistantConnected ? '' : '\nHome Assistant is NOT connected right now, so you cannot control devices.'),
      tools: rt.tools ? this.tools.tools : [],
      silenceMs: rt.silenceMs,
      interruptResponse: rt.bargeIn,
      transcribeModel: rt.transcribeModel,
      language: rt.language,
      vadThreshold: this.cfg.vad.rmsThreshold,
    };
    const client: VoiceClient = rt.provider === 'gemini' ? new GeminiLiveClient(options) : new RealtimeClient(options);
    const resampler = new Resampler(micRate, client.inputRate);
    const skipUntil = chimed ? started + CHIME_SKIP_MS : 0;

    // Capture what the user says while we connect (they often keep talking after the wake word).
    let connected = false;
    const early: Buffer[] = [];
    // Max's replies play strictly one after another, and the mic stays deaf until the last
    // one has finished coming out of the speakers (tracked by the clock: the Mac sound bridge
    // keeps playing buffered audio after the player process exits) plus an echo tail.
    let audioEndsAt = 0;
    const echoTail = this.cfg.audio.echoTailMs;
    const speaking = () => Date.now() < audioEndsAt;
    const deaf = () => Date.now() < audioEndsAt + echoTail;
    // The wake word detector keeps listening during the conversation, even while Max talks,
    // so "Hey Jarvis" interrupts him. Max never says the wake word, so his voice can't trigger it.
    const micFormat = { rate: micRate, width: 2, channels: 1 };
    let interrupt: () => void = () => undefined;
    let wakeArmed = false;
    let ended = false;
    const armWake = async () => {
      if (!rt.wakeInterrupt || ended) return;
      try {
        const { detected } = await this.wake.arm(micFormat);
        wakeArmed = true;
        detected
          .then(() => {
            wakeArmed = false;
            interrupt();
            void armWake();
          })
          .catch(() => (wakeArmed = false));
      } catch (err) {
        this.log.warn(`Wake word interruption unavailable: ${(err as Error).message}`);
      }
    };
    void armWake();

    setMicHandler((chunk) => {
      const now = Date.now();
      if (wakeArmed) this.wake.feed(chunk, micFormat);
      if (now < skipUntil) return;
      if (!rt.bargeIn && deaf()) return;
      const pcm = resampler.push(chunk);
      if (connected) client.sendAudio(pcm);
      else early.push(pcm);
    });


    try {
      await client.connect();
    } catch (err) {
      setMicHandler(() => undefined);
      this.log.error(`Could not start the ${providerName} session: ${(err as Error).message}`);
      return this.sayFallback("Sorry, I can't reach my real-time voice right now.");
    }
    connected = true;
    for (const pcm of early.splice(0)) client.sendAudio(pcm);
    this.log.log(`Connected to ${providerName} ${rt.model} (voice "${rt.voice}") in ${Date.now() - started} ms - talk now`);

    let player: AsyncQueue<Buffer> | undefined;
    let playing: Promise<void> = Promise.resolve();
    let pendingTools: Promise<void>[] = [];
    let userSpeaking = false;
    let busy = false;
    let turns = 0;
    let closed = false;
    let lastActivity = Date.now();
    let speechStoppedAt = 0;
    let firstAudioThisTurn = true;
    let clearTimer: NodeJS.Timeout | undefined;
    // Bumped on every interruption: queued replies from before it are dropped, not played.
    let generation = 0;
    let discardingCancelled = false;
    // Whether the server is still sending the current reply (audio usually arrives faster
    // than it plays, so the server has often finished before the user interrupts).
    let responseActive = false;

    interrupt = () => {
      if (!speaking()) return; // only meaningful while Max is talking
      generation++;
      this.speaker.stop();
      player?.close();
      player = undefined;
      if (responseActive) {
        discardingCancelled = true; // ignore audio still in flight for the cancelled reply
        client.cancelResponse();
      }
      client.clearInput();
      clearTimeout(clearTimer);
      busy = false;
      audioEndsAt = Date.now() - echoTail + INTERRUPT_REOPEN_MS; // reopen the mic almost at once
      lastActivity = Date.now();
      this.log.log('Interrupted - Max stopped talking, listening to you');
    };

    client.on('speech-started', () => {
      userSpeaking = true;
      lastActivity = Date.now();
      if (rt.bargeIn) interrupt(); // headphones mode: just start talking
    });
    client.on('speech-stopped', () => {
      userSpeaking = false;
      busy = true;
      speechStoppedAt = Date.now();
      firstAudioThisTurn = true;
    });
    client.on('audio', (pcm: Buffer) => {
      if (discardingCancelled) return;
      responseActive = true;
      if (!player) {
        if (!rt.bargeIn && !speaking()) client.clearInput();
        if (firstAudioThisTurn && speechStoppedAt) {
          this.log.log(`voice-to-voice ${Date.now() - speechStoppedAt} ms (end of your speech -> Max starts talking)`);
          firstAudioThisTurn = false;
        }
        const q = (player = new AsyncQueue<Buffer>());
        const gen = generation;
        // Queue behind any reply still playing, so two replies never overlap; skip it if
        // the user interrupted in the meantime.
        playing = playing
          .then(() => (gen === generation ? this.speaker.play(PCM24, q) : undefined))
          .catch(() => undefined);
      }
      audioEndsAt = Math.max(audioEndsAt, Date.now()) + (pcm.length / (PCM24.rate * 2)) * 1000;
      player.push(pcm);
    });
    client.on('tool-call', (c: { callId: string; name: string; args: Record<string, unknown> }) => {
      responseActive = true;
      pendingTools.push(this.tools.call(c.name, c.args).then((out) => client.sendToolResult(c.callId, out)));
    });
    client.on('response-done', async (r: { toolCalls: number; status?: string; reason?: string }) => {
      responseActive = false;
      if (discardingCancelled) {
        // The reply the user interrupted has now ended on the server side.
        discardingCancelled = false;
        if (r.status === 'cancelled') return;
      }
      player?.close();
      player = undefined;
      // Discard anything the server buffered while Max was still audible (his own echo).
      if (!rt.bargeIn) {
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => client.clearInput(), Math.max(0, audioEndsAt + echoTail - Date.now()));
      }
      if (r.status === 'failed') this.log.error(`Response failed: ${r.reason ?? 'unknown reason'}`);
      if (r.toolCalls) {
        const work = pendingTools;
        pendingTools = [];
        await Promise.all(work);
        client.requestResponse(); // let Max say what happened
        return;
      }
      turns++;
      busy = false;
      lastActivity = Math.max(Date.now(), audioEndsAt + echoTail);
    });
    client.on('user-transcript', (t: string) => this.log.log(`You: "${t}"`));
    client.on('assistant-transcript', (t: string) => this.log.log(`Max: "${t}"`));
    client.on('error', (err: Error) => {
      this.log.error(`${providerName}: ${err.message}`);
      if (/invalid argument/i.test(err.message) && rt.tools) {
        this.log.warn(
          `${providerName} rejected part of the session set-up (${options.tools.length} actions offered). ` +
            'To check whether an action description is the cause, set REALTIME_TOOLS=off in .env and restart.',
        );
      }
    });
    client.on('close', () => (closed = true));

    // Stay open while the conversation is alive; close after a quiet spell.
    const reason = await new Promise<string>((resolve) => {
      const tick = setInterval(() => {
        const now = Date.now();
        const quietFor = now - lastActivity;
        const limit = turns === 0 ? FIRST_TURN_WAIT_MS : rt.followUpMs;
        let why: string | undefined;
        if (closed) why = 'connection closed';
        else if (now - started > rt.maxSessionMs) why = `reached the ${rt.maxSessionMs / 1000}s session limit`;
        else if (busy && !speaking() && speechStoppedAt && now - speechStoppedAt > NO_ANSWER_MS && now - lastActivity > NO_ANSWER_MS) {
          busy = false; // the provider never answered (e.g. it heard noise, not a request)
          lastActivity = now;
        } else if (!busy && !userSpeaking && !deaf() && quietFor > limit) {
          why = turns === 0 ? 'no request heard' : 'no follow-up question';
        }
        if (why) {
          clearInterval(tick);
          resolve(why);
        }
      }, 200);
    });

    ended = true;
    this.wake.disarm();
    setMicHandler(() => undefined);
    clearTimeout(clearTimer);
    client.close();
    player?.close();
    await playing;
    this.log.log(`Conversation ended (${reason}, ${turns} answer${turns === 1 ? '' : 's'}, ${Math.round((Date.now() - started) / 1000)}s); waiting for the wake word`);
  }

  private async sayFallback(text: string): Promise<void> {
    const s = this.tts.session();
    s.say(text);
    await s.done().catch(() => undefined);
  }
}
