import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { SpeakerService } from '../audio/speaker.service';
import { Resampler } from '../audio/resampler';
import { AsyncQueue } from '../wyoming/async-queue';
import { ToolRouterService } from '../actions/tool-router.service';
import { TtsService } from '../tts/tts.service';
import { describeNow } from '../actions/clock';
import { RealtimeClient } from './realtime-client';

const PCM24 = { rate: 24000, width: 2, channels: 1 };
/** Ignore the mic briefly after Max stops talking, so the room echo isn't sent back. */
const ECHO_TAIL_MS = 300;
/** Skip the first moments after the wake word: that's Max's own chime. */
const CHIME_SKIP_MS = 400;
const FIRST_TURN_WAIT_MS = 7000;

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
  ) {}

  /**
   * Runs until the conversation goes quiet. `setMicHandler` routes microphone chunks
   * (16-bit mono at `micRate`) to this conversation.
   */
  async run(setMicHandler: (h: (chunk: Buffer) => void) => void, micRate: number, chimed: boolean): Promise<void> {
    const rt = this.cfg.realtime;
    if (!rt.apiKey) {
      this.log.error('REALTIME_API_KEY (or OPENAI_API_KEY) is not set in .env');
      return this.sayFallback("I can't use my real-time voice: the OpenAI key is missing.");
    }
    const started = Date.now();
    const resampler = new Resampler(micRate, PCM24.rate);
    const skipUntil = chimed ? started + CHIME_SKIP_MS : 0;

    // Capture what the user says while we connect (they often keep talking after the wake word).
    let connected = false;
    const early: Buffer[] = [];
    let speaking = false;
    let tailUntil = 0;
    setMicHandler((chunk) => {
      const now = Date.now();
      if (now < skipUntil) return;
      if (!rt.bargeIn && (speaking || now < tailUntil)) return;
      const pcm = resampler.push(chunk);
      if (connected) client.sendAudio(pcm);
      else early.push(pcm);
    });

    const client = new RealtimeClient({
      url: rt.url,
      apiKey: rt.apiKey,
      model: rt.model,
      voice: rt.voice,
      instructions:
        `${this.cfg.llm.systemPrompt}\n${rt.style}\nCurrent local time: ${describeNow()}.` +
        (this.tools.homeAssistantConnected ? '' : '\nHome Assistant is NOT connected right now, so you cannot control devices.'),
      tools: this.tools.tools,
      silenceMs: rt.silenceMs,
      interruptResponse: rt.bargeIn,
      transcribeModel: rt.transcribeModel,
    });

    try {
      await client.connect();
    } catch (err) {
      setMicHandler(() => undefined);
      this.log.error(`Could not start a Realtime session: ${(err as Error).message}`);
      return this.sayFallback("Sorry, I can't reach my real-time voice right now.");
    }
    connected = true;
    for (const pcm of early.splice(0)) client.sendAudio(pcm);
    this.log.log(`Connected to ${rt.model} (voice "${rt.voice}") in ${Date.now() - started} ms - talk now`);

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

    client.on('speech-started', () => {
      userSpeaking = true;
      lastActivity = Date.now();
      if (rt.bargeIn && speaking) {
        this.speaker.stop(); // user interrupted Max
        player?.close();
        player = undefined;
      }
    });
    client.on('speech-stopped', () => {
      userSpeaking = false;
      busy = true;
      speechStoppedAt = Date.now();
      firstAudioThisTurn = true;
    });
    client.on('audio', (pcm: Buffer) => {
      if (!player) {
        player = new AsyncQueue<Buffer>();
        speaking = true;
        if (firstAudioThisTurn && speechStoppedAt) {
          this.log.log(`voice-to-voice ${Date.now() - speechStoppedAt} ms (end of your speech -> Max starts talking)`);
          firstAudioThisTurn = false;
        }
        const q = player;
        playing = this.speaker.play(PCM24, q).finally(() => {
          speaking = false;
          tailUntil = Date.now() + ECHO_TAIL_MS;
          lastActivity = Date.now();
        });
      }
      player.push(pcm);
    });
    client.on('tool-call', (c: { callId: string; name: string; args: Record<string, unknown> }) => {
      pendingTools.push(this.tools.call(c.name, c.args).then((out) => client.sendToolResult(c.callId, out)));
    });
    client.on('response-done', async (r: { toolCalls: number; status?: string; reason?: string }) => {
      player?.close();
      player = undefined;
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
      lastActivity = Date.now();
    });
    client.on('user-transcript', (t: string) => this.log.log(`You: "${t}"`));
    client.on('assistant-transcript', (t: string) => this.log.log(`Max: "${t}"`));
    client.on('error', (err: Error) => this.log.error(`OpenAI Realtime: ${err.message}`));
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
        else if (!speaking && !busy && !userSpeaking && quietFor > limit) {
          why = turns === 0 ? 'no request heard' : 'no follow-up question';
        }
        if (why) {
          clearInterval(tick);
          resolve(why);
        }
      }, 200);
    });

    setMicHandler(() => undefined);
    client.close();
    await playing.catch(() => undefined);
    this.log.log(`Conversation ended (${reason}, ${turns} answer${turns === 1 ? '' : 's'}, ${Math.round((Date.now() - started) / 1000)}s); waiting for the wake word`);
  }

  private async sayFallback(text: string): Promise<void> {
    const s = this.tts.session();
    s.say(text);
    await s.done().catch(() => undefined);
  }
}
