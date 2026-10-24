import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { MusicService } from '../music/music.service';
import { FaceService } from '../face/face.service';
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
import { RealtimeConversationService } from '../realtime/realtime-conversation.service';
import { MemoryLearnerService, TranscriptLine } from '../memory/memory-learner.service';
import { Mode, ModesService } from '../memory/modes.service';
import { heardWakeWord } from '../wake-word/verify';
import { recordWake } from '../wake-word/wake-log';
import { LockService } from '../lock/lock.service';
import { DeviceService } from '../device/device.service';
import { LiveVoiceService } from '../realtime/live-voice.service';
import { isStopRequest } from './stop';
import { ConversationControl } from '../actions/conversation-control';
import { ActivityEvent, ToolRouterService } from '../actions/tool-router.service';
import { said } from '../log-content';

type State = 'idle' | 'wake' | 'listen' | 'respond';

const HISTORY_LIMIT = 16;
const HISTORY_RESET_MS = 2 * 60 * 1000;
const FOLLOW_UP_WINDOW_MS = 5000;
const CHIME_GRACE_MS = 400;
/** The start-up jingle waits a moment for the sound system to be ready. */
const START_SOUND_DELAY_MS = 1500;
/** A short pause after the greeting before listening (the mic board cancels most of his own voice). */
const AFTER_GREETING_MS = 250;
const STT_TIMEOUT_MS = 20_000;
/** Wake-up double-check: how much sound before the detection, and how long to wait for the words. */
const VERIFY_SECONDS = 2.5;
/** Generous: in a noisy room the recogniser takes longer, and it runs while Max already greets you. */
const VERIFY_TIMEOUT_MS = 4000;
/** After being interrupted, start listening again this soon (his voice has been cut). */
const INTERRUPT_REOPEN_MS = 300;
/** Say what he's doing when an action is still running after this long and he hasn't spoken yet. */
const SPOKEN_CUE_MS = 1000;
/** A second wake word this soon after an ignored one always wakes Max up. */
const REPEAT_WAKE_MS = 15_000;

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
  private transcript: TranscriptLine[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mic: MicrophoneService,
    private readonly wake: WakeWordService,
    private readonly stt: SttService,
    private readonly llm: LlmService,
    private readonly tts: TtsService,
    private readonly timers: TimerService,
    private readonly realtime: RealtimeConversationService,
    private readonly learner: MemoryLearnerService,
  ) {}

  /** Personal / work / guest: the conversation context never carries over a mode switch. */
  @Optional() @Inject(ModesService) private readonly modes?: ModesService;
  /** The start-up code: while locked, Max doesn't answer or announce anything. */
  @Optional() @Inject(LockService) private readonly lock?: LockService;
  /** The greeting ("Hello, how can I help?") and the start-up jingle, set on the control panel. */
  @Optional() @Inject(DeviceService) private readonly device?: DeviceService;
  /** Real-time mode: the greeting recorded in Max's live voice, so it sounds like the rest of the conversation. */
  @Optional() @Inject(LiveVoiceService) private readonly liveVoice?: LiveVoiceService;
  private historyMode?: Mode;
  private lastIgnoredWakeAt = 0;
  /** He greeted (rather than beeped) at the last wake-up. */
  private greeted = false;
  /** A short beep instead of the greeting this time. */
  private chimed = false;
  /** When the last conversation ended: the greeting isn't repeated soon after. */
  private lastTalkEnd = 0;
  /** end_conversation: the AI decided the conversation is over. */
  @Optional() @Inject(ConversationControl) private readonly control?: ConversationControl;
  @Optional() @Inject(ToolRouterService) private readonly toolRouter?: ToolRouterService;
  /** Music is turned down while Max talks (property-injected: optional, e.g. no Spotify speaker). */
  @Optional() @Inject(MusicService) private readonly music?: MusicService;
  /** The box's screen: idle / listening / thinking (speaking follows the audio). */
  @Optional() @Inject(FaceService) private readonly face?: FaceService;

  private readonly pendingAnnouncements: { text: string; timer: boolean; system?: boolean }[] = [];
  private announcing = false;

  onApplicationBootstrap(): void {
    if (this.cfg.voiceMode === 'realtime') {
      const name = this.cfg.realtime.provider === 'gemini' ? 'Gemini Live' : 'OpenAI Realtime';
      this.log.log(`Voice mode: ${name} (${this.cfg.realtime.model}, voice "${this.cfg.realtime.voice}")`);
    }
    this.mic.on('chunk', (c: Buffer) => this.onChunk(c));
    this.mic.start();
    // A jingle when Max starts, so you know he's ready; and the greeting prepared so it plays instantly.
    setTimeout(() => {
      if (this.device?.startSound ?? true) void this.tts.jingle().catch((err) => this.log.warn(`Start-up sound: ${(err as Error).message}`));
      if (this.device?.greeting) {
        void this.tts.prepare(this.device.greeting); // the stand-in until the live voice has recorded it
        void this.liveVoice?.ensure(this.device.greeting);
      }
    }, START_SOUND_DELAY_MS);
    // Timers/reminders are announced straight away when Max is idle, otherwise as soon as
    // the current conversation ends (never in the middle of an answer).
    this.timers.on('fired', (t) => {
      this.pendingAnnouncements.push({ text: announcement(t), timer: !t.say, system: t.system });
      if (this.state === 'wake') void this.flushAnnouncements();
    });
    // Reminders that came due while he was locked are said once he's unlocked.
    this.lock?.on('change', (locked: boolean) => {
      if (!locked && this.state === 'wake') void this.flushAnnouncements();
    });
    void this.wake.checkConfiguredNames().then(() => this.waitForWakeWord());
  }

  private async flushAnnouncements(): Promise<void> {
    // Reminders can be personal: not until unlocked. Messages about the box itself (no WiFi) are said anyway.
    const next = () => (this.lock?.locked ? this.pendingAnnouncements.findIndex((a) => a.system) : this.pendingAnnouncements.length ? 0 : -1);
    if (this.announcing || next() < 0) return;
    this.announcing = true;
    await this.music?.duckStart();
    try {
      for (let i = next(); i >= 0; i = next()) {
        const { text, timer, system } = this.pendingAnnouncements.splice(i, 1)[0];
        if (system) {
          // The connection may be what's wrong: the box's own voice, no waiting for the online one.
          this.log.log(`Announcing: ${said(text)}`);
          await this.tts.chime().catch(() => undefined);
          await this.tts.sayLocal(text).catch((err) => this.log.warn(`Announcement: ${(err as Error).message}`));
          continue;
        }
        if (timer) this.face?.setEmotion('surprised', 5000);
        else this.face?.said(text);
        this.log.log(`Announcing: ${said(text)}`);
        // In real-time mode it's said in Max's live voice: recorded while the chimes play.
        const live = this.liveVoice?.active ? this.liveVoice.line(text) : undefined;
        await this.tts.chime().catch(() => undefined);
        await this.tts.chime().catch(() => undefined);
        const pcm = await live;
        if (pcm) {
          await this.liveVoice!.play(pcm).catch((err) => this.log.warn(`Announcement: ${(err as Error).message}`));
          continue;
        }
        const speech = this.tts.session();
        speech.say(text);
        await speech.done();
      }
    } finally {
      this.announcing = false;
      await this.music?.duckEnd();
    }
  }

  /**
   * A second opinion before waking up: do the words in the last couple of seconds contain the
   * wake word? Catches false alarms from noise, music and TV. If the speech recogniser can't be
   * reached in time, Max wakes up as usual.
   */
  private async confirmWake(audio: Buffer, fmt: { rate: number; width: number; channels: number }): Promise<boolean> {
    const started = Date.now();
    let session: Awaited<ReturnType<SttService['open']>> | undefined;
    // His own radio or music can sound like "Hey Max": while it plays, only the word itself counts, saying it
    // again isn't enough on its own, and a check that didn't finish doesn't wake him.
    const ownAudio = this.music ? await this.music.playingNow() : false;
    const tag = ownAudio ? ' [music playing]' : '';
    try {
      session = await withTimeout(this.stt.open(fmt), VERIFY_TIMEOUT_MS, 'took too long');
      session.write(audio);
      const text = await withTimeout(session.finish(), VERIFY_TIMEOUT_MS, 'took too long');
      if (heardWakeWord(text, this.cfg.wakeWord.names, ownAudio)) {
        this.log.log(`Wake word confirmed (${said(text)}, ${Date.now() - started} ms)${tag}`);
        recordWake('woke', text + tag, Date.now() - started);
        return true;
      }
      // Said it again straight after being ignored: that's a person calling, not noise (unless the radio is on).
      if (!ownAudio && Date.now() - this.lastIgnoredWakeAt < REPEAT_WAKE_MS) {
        this.log.log(`Wake word heard twice in a row: waking up (heard ${text ? said(text) : 'no words'})`);
        recordWake('repeat', text, Date.now() - started);
        return true;
      }
      this.lastIgnoredWakeAt = Date.now();
      this.log.log(`Ignored a possible false wake-up: heard ${text ? said(text) : 'no words'}${tag} (WAKEWORD_VERIFY=off disables this check)`);
      recordWake('ignored', (text || '') + tag, Date.now() - started);
      return false;
    } catch (err) {
      session?.abort();
      if (ownAudio) {
        this.log.warn(`Could not double-check the wake word (${(err as Error).message}) while music plays; staying asleep`);
        recordWake('ignored', `check didn't finish${tag}`, Date.now() - started);
        return false;
      }
      this.log.warn(`Could not double-check the wake word (${(err as Error).message}); waking up anyway`);
      recordWake('unchecked', undefined, Date.now() - started);
      return true;
    }
  }

  private async waitForWakeWord(): Promise<void> {
    this.state = 'wake';
    this.face?.setState('idle');
    if (this.pendingAnnouncements.length) void this.flushAnnouncements();
    const fmt = this.mic.format;
    let name: string;
    // The last few seconds of sound, to double-check a wake-up with the speech recogniser.
    const recent: Buffer[] = [];
    let recentBytes = 0;
    const keepBytes = Math.round(fmt.rate * fmt.width * fmt.channels * VERIFY_SECONDS);
    try {
      const { detected } = await this.wake.arm(fmt);
      this.onChunk = (c) => {
        this.wake.feed(c, fmt);
        recent.push(c);
        recentBytes += c.length;
        while (recentBytes - recent[0].length >= keepBytes) recentBytes -= recent.shift()!.length;
      };
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

    // The double-check runs while Max already answers, so it adds no delay; a false wake-up cuts
    // the greeting short and he goes back to sleep.
    const heardAt = Date.now();
    if (!this.cfg.wakeWord.verify) recordWake('unchecked');
    const verified = this.cfg.wakeWord.verify ? this.confirmWake(Buffer.concat(recent), fmt) : Promise.resolve(true);
    if (this.lock?.locked) {
      if (!(await verified)) return this.waitForWakeWord();
      this.log.log(`Wake word "${name}" detected, but Max is locked (start-up code)`);
      const speech = this.tts.session();
      speech.say("I'm locked. Please enter my code on the screen.");
      await speech.done().catch(() => undefined);
      return this.waitForWakeWord();
    }

    this.log.log(`Wake word "${name}" detected - answering`);
    // Turn any music down while we talk (in parallel with the greeting, so no added delay).
    const ducked = this.music?.duckStart();
    // "Hello, how can I help?" (set on the control panel), or the short beep if there's no greeting. Not again so soon
    // after the last conversation (within the minutes set on the panel): then just the beep, so it doesn't get tiring.
    const again = (this.device?.greetAgainMin ?? 0) * 60_000;
    const recently = again > 0 && this.lastTalkEnd > 0 && heardAt - this.lastTalkEnd < again;
    const greeting = recently ? undefined : this.device?.greeting;
    this.greeted = Boolean(greeting);
    this.chimed = !greeting && (this.cfg.audio.wakeChime || recently);
    let answering: Promise<unknown> = Promise.resolve();
    let falseAlarm = false;
    if (greeting) {
      const live = this.liveVoice?.active ? this.liveVoice.recorded(greeting) : undefined;
      if (live) answering = this.liveVoice!.play(live).catch((err) => this.log.warn(`Greeting: ${(err as Error).message}`));
      else {
        answering = (async () => {
          await this.tts.prepare(greeting); // normally ready since start-up
          if (!falseAlarm) await this.tts.sayReady(greeting);
        })().catch((err) => this.log.warn(`Greeting: ${(err as Error).message}`));
        void this.liveVoice?.ensure(greeting); // in the live voice from next time
      }
    } else if (this.chimed) void this.tts.chime().catch(() => undefined);
    if (!(await verified)) {
      falseAlarm = true;
      this.tts.stopPlayback();
      await answering;
      await ducked;
      await this.music?.duckEnd();
      return this.waitForWakeWord();
    }
    await answering;
    if (greeting) await new Promise((r) => setTimeout(r, AFTER_GREETING_MS));
    this.log.log(`Ready for your request ${Date.now() - heardAt} ms after the wake word`);
    this.face?.setState('listening');
    try {
      await this.talk();
    } finally {
      this.lastTalkEnd = Date.now();
      await ducked;
      await this.music?.duckEnd();
    }
    return this.waitForWakeWord();
  }

  private async talk(): Promise<void> {
    if (this.cfg.voiceMode === 'realtime') {
      this.state = 'respond';
      let chimed = this.chimed;
      // Switching mode starts a fresh conversation in the new mode (only its memories, nothing carried over) and
      // carries straight on: no need to say "Hey Max" again. A short beep says he's listening.
      for (let i = 0; i < 4; i++) {
        const again = await this.realtime
          .run((h) => (this.onChunk = h), this.mic.format.rate, chimed)
          .catch((err) => this.log.error(`Realtime conversation failed: ${(err as Error).message}`));
        this.onChunk = () => undefined;
        if (again !== true) break;
        this.log.log(`New mode: carrying on listening (${this.modes?.mode} mode)`);
        chimed = true;
        void this.tts.chime().catch(() => undefined);
        this.face?.setState('listening');
      }
    } else {
      await this.conversation();
    }
  }

  /** One request, then follow-ups without the wake word, until nobody speaks. */
  private async conversation(): Promise<void> {
    this.transcript = [];
    this.control?.reset(); // nothing left over from a previous conversation
    try {
      await this.conversationTurns();
    } finally {
      // Filed in memory in the background once the conversation is over.
      void this.learner.learn(this.transcript);
    }
  }

  private async conversationTurns(): Promise<void> {
    let noSpeechMs = 5000;
    for (;;) {
      try {
        const text = await this.listen(noSpeechMs, noSpeechMs === FOLLOW_UP_WINDOW_MS);
        if (!text) return;
        // "Stop", "that's all", "not talking to you": go quiet straight away, no AI involved.
        if (isStopRequest(text.value)) {
          this.log.log(`Stopping: you said ${said(text.value)}`);
          this.control?.consumeEnd();
          this.face?.conversationEnded();
          return;
        }
        const outcome = await this.respond(text.value, text.endOfSpeech);
        if (outcome === 'ended') {
          this.log.log('Conversation ended by Max (told to stop, or the speech was not meant for him)');
          this.face?.conversationEnded();
          return;
        }
        if (outcome === 'music') {
          this.log.log('Music started: conversation ended so you can listen');
          return;
        }
        if (outcome === 'interrupted') {
          // "Hey Max" over his voice: he's stopped talking; listen for what comes next ("stop", or a new question).
          noSpeechMs = FOLLOW_UP_WINDOW_MS;
          await new Promise((r) => setTimeout(r, INTERRUPT_REOPEN_MS));
          continue;
        }
      } catch (err) {
        this.log.error(`${(err as Error).message}; going back to waiting for the wake word`);
        this.onChunk = () => undefined;
        return;
      }
      noSpeechMs = FOLLOW_UP_WINDOW_MS;
      // Let Max's voice finish coming out of the speakers before listening again, so he
      // doesn't transcribe (and answer) the end of his own sentence.
      await new Promise((r) => setTimeout(r, this.cfg.audio.echoTailMs));
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
    this.face?.setState('listening');
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
    this.log.log(`You: ${said(text)}  (stt ${Date.now() - tEnd} ms)`);
    return { value: text, endOfSpeech: tEnd };
  }

  private async respond(text: string, tEndOfSpeech: number): Promise<'done' | 'ended' | 'music' | 'interrupted'> {
    this.state = 'respond';
    this.face?.setState('thinking');
    if (Date.now() - this.lastTurnAt > HISTORY_RESET_MS) this.history = [];
    // The mode changed (by voice or the work-hours schedule): file what was said under the old
    // mode and start a clean context, so nothing said in personal mode carries into work mode.
    const mode = this.modes?.mode;
    if (this.historyMode && mode !== this.historyMode) {
      void this.learner.learn(this.transcript, this.historyMode);
      this.transcript = [];
      this.history = [];
    }
    this.historyMode = mode;
    this.history.push({ role: 'user', content: text });
    this.transcript.push({ who: 'user', text });
    this.toolRouter?.heard(text); // the answer to any "Shall I go ahead?"
    this.face?.heard(text);
    const historyStart = this.history.length;

    const speech = this.tts.session();
    const splitter = new SentenceSplitter();
    let firstSpoken = 0;
    let reply = '';
    // While he answers, the wake word still works: "Hey Max" cuts him off.
    let interrupted = false;
    // A slow action (email, web...) before he's said anything: tell the user what he's doing.
    let cued = false;
    const onActivity = (e: ActivityEvent) => {
      setTimeout(() => {
        if (firstSpoken || cued || interrupted || this.control?.endRequested) return;
        cued = true;
        this.log.log(`Busy: ${e.label}`);
        speech.say(`${e.label}.`);
      }, SPOKEN_CUE_MS);
    };
    this.toolRouter?.activity.on('start', onActivity);
    const stopInterrupt = this.armInterrupt(() => {
      interrupted = true;
      speech.interrupt();
      this.log.log('Interrupted - Max stopped talking, listening to you');
    });
    try {
      for await (const fragment of this.llm.respond(this.history)) {
        if (interrupted || this.control?.endRequested) break;
        reply += fragment;
        for (const sentence of splitter.push(fragment)) {
          if (!firstSpoken) firstSpoken = Date.now();
          this.face?.said(sentence);
          speech.say(sentence);
        }
      }
    } catch (err) {
      const why = explainLlmError(err);
      this.log.error(`LLM error: ${why.log}`);
      splitter.flush();
      this.face?.setEmotion('concerned');
      speech.say(why.spoken);
    }
    for (const sentence of splitter.flush()) {
      if (!firstSpoken) firstSpoken = Date.now();
      this.face?.said(sentence);
      speech.say(sentence);
    }
    if (firstSpoken) {
      this.log.log(`Max: ${said(reply.trim())}  (end-of-speech -> first sentence ${firstSpoken - tEndOfSpeech} ms)`);
    }
    for (const m of this.history.slice(historyStart)) {
      if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls) {
        for (const c of m.tool_calls) if (c.type === 'function') this.transcript.push({ who: 'action', text: c.function.name });
      }
    }
    if (reply.trim()) this.transcript.push({ who: 'max', text: reply.trim() });
    this.toolRouter?.activity.off('start', onActivity);
    if (this.control?.endRequested) speech.interrupt();
    await speech.done();
    stopInterrupt();
    this.lastTurnAt = Date.now();
    this.trimHistory();
    if (this.control?.consumeEnd()) return 'ended';
    // Music just started: he's said so, now quiet so you can listen.
    if (this.control?.consumeEndAfterReply() && !interrupted) return 'music';
    return interrupted ? 'interrupted' : 'done';
  }

  /** Listens for the wake word while Max is talking; returns a function that stops listening. */
  private armInterrupt(onWake: () => void): () => void {
    if (!this.cfg.realtime.wakeInterrupt) return () => undefined;
    const fmt = this.mic.format;
    let stopped = false;
    void this.wake
      .arm(fmt)
      .then(({ detected }) => {
        if (stopped) return this.wake.disarm();
        this.onChunk = (c) => this.wake.feed(c, fmt);
        detected.then(() => !stopped && onWake()).catch(() => undefined);
      })
      .catch((err) => this.log.warn(`Interrupting by wake word unavailable: ${(err as Error).message}`));
    return () => {
      stopped = true;
      this.wake.disarm();
      this.onChunk = () => undefined;
    };
  }

  /** Keep the context short (faster + cheaper) without orphaning tool results. */
  private trimHistory(): void {
    while (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
      while (this.history.length && this.history[0].role !== 'user') this.history.shift();
    }
  }
}
