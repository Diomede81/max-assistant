import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PowerAction, requestPower } from './power';
import { Card, CardHandlers, screen } from './screen';
import { eventLines, extractEvents } from './events';
import { extractEmails } from './emails';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { APP_CONFIG, AppConfig } from '../config';
import { timeZone } from '../actions/clock';
import { Timer, TimerService, describe as describeTimer } from '../actions/timer.service';
import { ModesService } from '../memory/modes.service';
import { MusicService } from '../music/music.service';
import type { PcmFormat } from '../audio/speaker.service';
import { analyse, CLOSED, Mouth } from './visemes';
import { Emotion, emotionFor } from './emotion';
import { ActivityEvent, ToolRouterService } from '../actions/tool-router.service';
import { BuiltinActionsService } from '../actions/builtin-actions.service';
import { ScreenToolsService } from '../actions/screen-tools.service';
import { LockService } from '../lock/lock.service';
import { AmbientService, Glance } from './ambient.service';

/** What the conversation is doing. "speaking" is worked out from the audio actually playing. */
export type BaseState = 'idle' | 'listening' | 'thinking';
export type FaceState = BaseState | 'speaking' | 'sleeping' | 'setup';

export interface WifiStatus {
  state: 'setup' | 'connecting' | 'connected' | 'failed';
  ssid?: string;
  password?: string;
  url?: string;
  error?: string;
  at?: number;
}

export interface FaceInfo {
  state: FaceState;
  mode: string;
  /** Countdown timers (shown as a ring). Reminders are separate: no countdown, just the next one. */
  timers: { label: string; endsAt: number; total: number }[];
  reminder?: { text: string; at: number };
  music?: { title: string; artist: string };
  wifi?: WifiStatus & { qrSvg?: string };
  offline: boolean;
  emotion: Emotion;
  /** What he's busy with right now ("Checking your email"), while an action runs. */
  activity?: { icon: string; label: string };
  /** A short-lived note when something didn't work ("Couldn't finish: Checking your email"). */
  notice?: string;
  /** The box is installing an update (Max restarts during it: the face says so instead of "Reconnecting"). */
  updating?: boolean;
  /** The card on screen (Max's face shrinks to the top while it shows). */
  card?: Card & { until: number };
  /** Live captions: what Max heard, or what he's saying. */
  caption?: { who: 'you' | 'max'; text: string };
  /** Around the face when idle: weather, next meeting, to-dos; and the evening photo frame. */
  glance?: Glance;
  /** The start-up code hasn't been entered: the keypad shows, and nothing personal. */
  locked?: { pausedUntil?: number; triesLeft: number };
  /** A start-up code is set (the menu offers Lock). */
  canLock?: boolean;
}

const FRAME_MS = 50;
/** How long a "couldn't finish" note stays on the face. */
const NOTICE_MS = 6000;
/** Each "Checking your email..." stays on the face at least this long. */
const MIN_ACTIVITY_MS = 3000;
const INFO_MS = 1000;
const MUSIC_MS = 5000;
/** How long cards stay if nobody taps them. */
const CARD_MS = 20_000;
const MUSIC_CARD_MS = 12_000;
const TAP_CARD_MS = 20_000;
const DAY_CARD_MS = 60_000;
const ALERT_MS = 5 * 60_000;
/** Captions stay this long after the last words. */
const CAPTION_MS = 7000;

/**
 * Drives the animated face on the box's round screen. Other parts of Max report what they
 * are doing (listening, thinking) and every bit of audio that plays; this turns that into a
 * face state plus a mouth level timed to the sound, and gathers the small extras the face
 * shows (mode, timers, music, WiFi setup). The face page subscribes via FaceServer.
 */
@Injectable()
export class FaceService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Face');
  private base: BaseState = 'idle';
  /** Mouth shapes scheduled against the clock, one per 50 ms of audio. */
  private levels: { at: number; v: Mouth }[] = [];
  private emotion: Emotion = 'neutral';
  private emotionUntil = 0;
  private audioEndsAt = 0;
  private timers: NodeJS.Timeout[] = [];
  private music?: { title: string; artist: string };
  private wifi?: WifiStatus & { qrSvg?: string };
  private lastInfo = '';

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Optional() private readonly timerService?: TimerService,
    @Optional() private readonly modes?: ModesService,
    @Optional() private readonly musicService?: MusicService,
    @Optional() private readonly toolRouter?: ToolRouterService,
    @Optional() private readonly ambient?: AmbientService,
    @Optional() private readonly actions?: BuiltinActionsService,
    @Optional() private readonly screenTools?: ScreenToolsService,
    @Optional() private readonly lock?: LockService,
  ) {
    super();
    this.setMaxListeners(50);
  }

  onModuleInit(): void {
    if (!this.cfg.face.enabled) return;
    this.timers.push(setInterval(() => this.tickLevel(), FRAME_MS));
    this.timers.push(setInterval(() => void this.tickInfo(), INFO_MS));
    this.lock?.on('change', () => void this.tickInfo());
    this.timers.push(setInterval(() => void this.pollMusic(), MUSIC_MS));
    // Cards from anywhere in Max (showCard in ./screen), and the ones the face makes itself.
    screen.on('card', (card: Card, handlers: CardHandlers) => this.showCard(card, handlers));
    screen.on('dismiss', (id: string) => this.dismissCard(id));
    this.timerService?.on('fired', (t: Timer) => this.timerCard(t));
    this.toolRouter?.activity.on('result', (r: { name: string; out: string }) => {
      this.calendarCard(r.name, r.out);
      this.emailCard(r.name, r.out);
    });
    // Show what he's doing while actions run (email, calendar, web, the house...).
    this.toolRouter?.activity.on('start', (e: ActivityEvent) => {
      this.activities.set(e.id, { icon: e.icon, label: e.label });
      this.activityStarted.set(e.id, Date.now());
      if (this.base === 'idle') {
        this.base = 'thinking';
        this.thinkingForActivity = true;
      }
      void this.tickInfo();
    });
    this.toolRouter?.activity.on('end', (e: ActivityEvent) => {
      // Quick actions (a light, a search hit) would only flash: keep each label up long enough to read.
      const shownFor = Date.now() - (this.activityStarted.get(e.id) ?? 0);
      this.activityStarted.delete(e.id);
      setTimeout(() => {
        this.activities.delete(e.id);
        // Back to idle if it was only the action that made him look busy.
        if (!this.activities.size && this.thinkingForActivity && this.base === 'thinking') this.base = 'idle';
        if (!this.activities.size) this.thinkingForActivity = false;
        void this.tickInfo();
      }, e.ok === false ? 0 : Math.max(0, MIN_ACTIVITY_MS - shownFor)); // a failure shows straight away
      if (e.ok === false) {
        this.notice = { text: `Couldn't finish: ${e.label.charAt(0).toLowerCase()}${e.label.slice(1)}`, until: Date.now() + NOTICE_MS };
        this.setEmotion('concerned', NOTICE_MS);
      }
      void this.tickInfo();
    });
  }
  private readonly activities = new Map<number, { icon: string; label: string }>();
  private readonly activityStarted = new Map<number, number>();
  private thinkingForActivity = false;
  private notice?: { text: string; until: number };

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  // ---------- Inputs from the rest of Max ----------

  setState(s: BaseState): void {
    this.thinkingForActivity = false; // the conversation is in charge again
    if (s === this.base) return;
    this.base = s;
    void this.tickInfo();
  }

  /** Every chunk of audio Max plays (voice, chime, announcements), as it is queued. */
  audio(chunk: Buffer, fmt: PcmFormat): void {
    if (!this.cfg.face.enabled || fmt.width !== 2) return;
    const bytesPerFrame = fmt.channels * 2;
    const perSlice = Math.max(bytesPerFrame, Math.floor((fmt.rate * FRAME_MS) / 1000) * bytesPerFrame);
    // FACE_AUDIO_DELAY_MS: sound systems buffer a little before the speaker plays it.
    let t = Math.max(Date.now() + this.cfg.face.audioDelayMs, this.audioEndsAt);
    for (let off = 0; off + bytesPerFrame <= chunk.length; off += perSlice) {
      const end = Math.min(chunk.length, off + perSlice);
      const samples = new Float32Array(Math.floor((end - off) / bytesPerFrame));
      for (let i = 0; i < samples.length; i++) {
        // Mix channels down to mono.
        let v = 0;
        for (let c = 0; c < fmt.channels; c++) v += chunk.readInt16LE(off + i * bytesPerFrame + c * 2);
        samples[i] = v / fmt.channels / 32768;
      }
      this.levels.push({ at: t, v: analyse(samples, fmt.rate) });
      t += (samples.length / fmt.rate) * 1000;
    }
    this.audioEndsAt = t;
    if (this.levels.length > 4000) this.levels.splice(0, this.levels.length - 4000);
  }

  /** What Max heard the user say (live captions). */
  heard(text: string): void {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    this.screenTools?.userSaid(t);
    this.caption = { who: 'you', text: t.slice(-220), until: Date.now() + CAPTION_MS };
    void this.tickInfo();
  }

  /**
   * What Max is saying (a sentence, a reply, or a chunk of live transcript). His expression
   * follows it: happy for good news, concerned for problems, curious for questions.
   */
  said(text: string): void {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t) {
      this.screenTools?.maxSaid(t); // a recipe only spoken still ends up on screen
      // Captions: his sentences follow one another; keep the latest (a sentence or two).
      const cont = this.caption?.who === 'max' && Date.now() < this.caption.until && this.caption.text.length + t.length < 160;
      this.caption = { who: 'max', text: cont ? `${this.caption!.text} ${t}` : t.slice(-220), until: Date.now() + CAPTION_MS };
      void this.tickInfo();
    }
    const e = emotionFor(text);
    if (!e) return;
    // Replies arrive a few sentences at a time: the first cue sets the tone, so a quick
    // "Sorry, I can't. Anything else?" stays concerned rather than flicking to curious.
    const now = Date.now();
    if (now - this.saidAt < 2500 && e !== 'concerned') return;
    this.saidAt = now;
    this.setEmotion(e, 6000);
  }
  private saidAt = 0;

  setEmotion(e: Emotion, holdMs = 6000): void {
    this.emotionUntil = Date.now() + holdMs;
    if (e === this.emotion) return;
    this.emotion = e;
    void this.tickInfo();
  }

  /** Audio was cut off (interrupted). */
  audioStop(): void {
    this.levels = [];
    this.audioEndsAt = 0;
  }

  /** The screen's menu (hold for 2 s): ask the box's WiFi service to start setup mode. */
  requestWifiSetup(): boolean {
    try {
      writeFileSync(join(this.cfg.face.runDir, 'wifi-request'), String(Date.now()));
      this.log.log('WiFi setup requested from the screen');
      return true;
    } catch {
      return false; // not on the Max box (no WiFi service)
    }
  }

  /** "Back to Max" on the WiFi setup screen: ask the box's WiFi service to leave setup mode. */
  cancelWifiSetup(): boolean {
    try {
      writeFileSync(join(this.cfg.face.runDir, 'wifi-cancel'), String(Date.now()));
      this.log.log('WiFi setup cancelled from the screen');
      return true;
    } catch {
      return false;
    }
  }

  /** The screen's menu: turn the box off or restart it. */
  requestPower(action: PowerAction): boolean {
    const ok = requestPower(this.cfg, action);
    if (ok) this.log.log(action === 'poweroff' ? 'Turning off (asked from the screen)' : 'Restarting (asked from the screen)');
    return ok;
  }

  // ---------- State for the face page ----------

  get speaking(): boolean {
    return Date.now() < this.audioEndsAt;
  }

  info(): FaceInfo {
    const info = this.fullInfo();
    const locked = this.lock?.status();
    if (!locked) return info;
    // Locked (start-up code): the clock, timers and the keypad only; nothing personal.
    return { ...info, locked, reminder: undefined, music: undefined, activity: undefined, card: undefined, caption: undefined, glance: undefined };
  }

  private fullInfo(): FaceInfo {
    const offline = this.wifi?.state === 'setup' || this.wifi?.state === 'connecting';
    let state: FaceState = this.wifi && this.wifi.state !== 'connected' ? 'setup' : this.speaking ? 'speaking' : this.base;
    if (state === 'idle' && this.inSleepHours()) state = 'sleeping';
    return {
      state,
      mode: this.modes?.mode ?? 'personal',
      timers: (this.timerService?.list() ?? []).filter((t) => !t.reminder).map((t) => ({ label: describeTimer(t), endsAt: t.endsAt, total: t.durationSeconds * 1000 })),
      reminder: this.nextReminder(),
      music: this.music,
      wifi: this.wifi,
      offline,
      emotion: this.emotion,
      activity: this.activities.size ? [...this.activities.values()].pop() : undefined,
      notice: this.notice && Date.now() < this.notice.until ? this.notice.text : undefined,
      updating: this.updating(),
      card: this.card && Date.now() < this.card.until ? this.card : undefined,
      caption: this.ambient?.settings.captions && this.caption && Date.now() < this.caption.until ? { who: this.caption.who, text: this.caption.text } : undefined,
      glance: this.ambient?.glance(),
      canLock: this.lock?.enabled || undefined,
    };
  }

  private tickLevel(): void {
    const now = Date.now();
    while (this.levels.length > 1 && this.levels[1].at <= now) this.levels.shift();
    const cur = this.levels[0] && this.levels[0].at <= now && now < this.audioEndsAt ? this.levels[0].v : CLOSED;
    const open = cur.o + cur.w + cur.r + cur.s > 0;
    if (open || this.mouthOpen) this.emit('level', cur);
    this.mouthOpen = open;
    if (!this.speaking && this.wasSpeaking) void this.tickInfo();
    this.wasSpeaking = this.speaking;
    if (this.speaking && !this.announcedSpeaking) void this.tickInfo();
    this.announcedSpeaking = this.speaking;
    // Expressions fade back to neutral once the moment has passed (and he's finished talking).
    if (this.emotion !== 'neutral' && now > this.emotionUntil && !this.speaking) {
      this.emotion = 'neutral';
      void this.tickInfo();
    }
  }
  private mouthOpen = false;
  private wasSpeaking = false;
  private announcedSpeaking = false;

  /** The next reminder due in the coming 12 hours, for a small line under the clock. */
  private nextReminder(): FaceInfo['reminder'] {
    const r = (this.timerService?.list() ?? []).find((t) => t.reminder && t.endsAt - Date.now() < 12 * 3600_000);
    return r?.reminder ? { text: r.reminder, at: r.endsAt } : undefined;
  }

  private async tickInfo(): Promise<void> {
    await this.readWifi();
    const info = this.info();
    const key = JSON.stringify({ ...info, timers: info.timers.map((t) => t.label) });
    if (key !== this.lastInfo) {
      this.lastInfo = key;
      this.emit('info', info);
    }
  }

  private async pollMusic(): Promise<void> {
    const before = this.music?.title;
    this.music = (await this.musicService?.nowPlaying().catch(() => undefined)) ?? undefined;
    // A new song: show the music card for a moment.
    if (this.music && this.music.title !== before) await this.musicCard(MUSIC_CARD_MS);
    else if (this.card?.id === 'music' && Date.now() < this.card.until) await this.musicCard(this.card.until - Date.now());
  }

  // ---------- Cards ----------

  private card?: Card & { until: number };
  private handlers: CardHandlers = {};
  private caption?: { who: 'you' | 'max'; text: string; until: number };

  showCard(card: Card, handlers: CardHandlers = {}): void {
    if (!this.cfg.face.enabled) return;
    this.card = { ...card, until: Date.now() + (card.ttlMs ?? CARD_MS) };
    this.handlers = handlers;
    void this.tickInfo();
  }

  dismissCard(id?: string): void {
    if (!this.card || (id && this.card.id !== id)) return;
    this.card = undefined;
    this.handlers = {};
    void this.tickInfo();
  }

  /** A button on the card was tapped ("dismiss" = Back to Max). */
  async cardAction(id: string, action: string): Promise<boolean> {
    if (this.lock?.locked) return false;
    if (!this.card || this.card.id !== id) return false;
    if (action === 'dismiss') {
      this.dismissCard(id);
      return true;
    }
    const h = this.handlers[action];
    if (!h) return false;
    try {
      await h();
    } catch (err) {
      this.log.warn(`Card button "${action}" failed: ${(err as Error).message}`);
    }
    return true;
  }

  /** A short tap on the face: show what's useful right now (the music if it's playing, otherwise your day). */
  async tapped(): Promise<void> {
    if (this.lock?.locked) return;
    if (this.music || (await this.musicService?.player().catch(() => undefined))) {
      await this.musicCard(TAP_CARD_MS);
      return;
    }
    const w = this.ambient?.weatherNow;
    const weather = w ? `${w.icon} ${w.temp}°${w.hi !== undefined ? ` (${w.lo}°–${w.hi}°)` : ''}` : undefined;
    // Visitors (guest mode) see only the weather, not your meetings or to-dos.
    if (this.modes?.mode === 'guest') {
      if (w) this.weatherCard();
      return;
    }
    this.actions?.dayCard({ events: eventLines(this.ambient?.todaysEvents() ?? []), weather });
  }

  /** The weather for the next hours (guest mode's tap). */
  private weatherCard(): void {
    const w = this.ambient?.weatherNow;
    if (!w) return;
    this.showCard({
      id: 'weather',
      kind: 'list',
      icon: w.icon,
      title: `${w.temp}° · ${w.text}`,
      subtitle: [w.place, w.hi !== undefined ? `${w.lo}°–${w.hi}°` : '', w.rain ? `${w.rain}% rain` : ''].filter(Boolean).join(' · '),
      lines: w.hours.map((h) => ({ time: h.time, text: `${h.icon} ${h.temp}°`, sub: h.rain ? `${h.rain}% rain` : undefined })),
      ttlMs: TAP_CARD_MS,
    });
  }

  private async musicCard(ttlMs: number): Promise<void> {
    const p = await this.musicService?.player().catch(() => undefined);
    if (!p) {
      this.dismissCard('music');
      return;
    }
    const press = (a: 'pause' | 'resume' | 'next' | 'previous') => async () => {
      await this.musicService!.press(a);
      setTimeout(() => void this.musicCard(Math.max(5000, (this.card?.until ?? 0) - Date.now())), 800);
    };
    this.showCard(
      {
        id: 'music',
        kind: 'music',
        icon: '♪',
        title: p.title,
        subtitle: p.artist,
        image: p.art,
        progress: p.duration ? { position: p.position ?? 0, duration: p.duration, at: Date.now(), paused: p.paused } : undefined,
        actions: [
          { id: 'previous', label: '⏮', style: 'icon' },
          { id: p.paused ? 'resume' : 'pause', label: p.paused ? '▶' : '⏸', style: 'icon' },
          { id: 'next', label: '⏭', style: 'icon' },
        ],
        ttlMs,
      },
      { previous: press('previous'), pause: press('pause'), resume: press('resume'), next: press('next') },
    );
  }

  /** A timer or reminder went off: a card with what it was, and buttons. */
  private timerCard(t: Timer): void {
    if (t.say) {
      const id = `say-${Date.now()}`;
      this.showCard({ id, kind: 'notice', icon: '🔔', title: 'Max', big: t.say, actions: [{ id: 'ok', label: 'OK', style: 'primary' }], ttlMs: CARD_MS * 3 }, { ok: () => this.dismissCard(id) });
      return;
    }
    const id = `timer-${t.id}`;
    if (t.reminder) {
      const reminder = t.reminder;
      this.showCard(
        { id, kind: 'alert', icon: '🔔', title: 'Reminder', big: reminder.charAt(0).toUpperCase() + reminder.slice(1), actions: [{ id: 'done', label: 'Done', style: 'primary' }, { id: 'snooze', label: 'Snooze 10 min' }], ttlMs: ALERT_MS },
        {
          done: () => this.dismissCard(id),
          snooze: () => {
            this.timerService?.start(600, undefined, reminder);
            this.dismissCard(id);
          },
        },
      );
      return;
    }
    const name = t.name ? `${t.name.charAt(0).toUpperCase()}${t.name.slice(1)} timer done` : 'Time is up';
    this.showCard(
      { id, kind: 'alert', icon: '⏲', title: 'Timer', big: name, actions: [{ id: 'ok', label: 'OK', style: 'primary' }, { id: 'again', label: 'Again' }], ttlMs: ALERT_MS },
      {
        ok: () => this.dismissCard(id),
        again: () => {
          this.timerService?.start(t.durationSeconds, t.name);
          this.dismissCard(id);
        },
      },
    );
  }

  /** Max read the calendar: show the events (merged into "Your day" if it's on screen). */
  private calendarCard(tool: string, out: string): void {
    if (!/CALENDAR|EVENT/i.test(tool) || /(CREATE|UPDATE|DELETE|CANCEL|ACCEPT|DECLINE|RESPOND|MOVE)/i.test(tool)) return;
    const events = extractEvents(out);
    if (!events.length) return;
    this.ambient?.noteEvents(events);
    const lines = eventLines(events);
    const day = this.card?.id === 'my-day' && Date.now() < this.card.until ? this.card : undefined;
    if (day && this.actions) {
      // Redrawn by its owner, so the to-dos' Done buttons keep working (and what was ticked stays).
      this.actions.dayCard({ ...this.actions.dayInfo, events: lines }, true);
      return;
    }
    if (day) {
      const rest = (day.lines ?? []).filter((l) => l.tag !== 'event' && l.tag !== 'done');
      this.showCard({ ...day, lines: [...lines, ...rest], ttlMs: Math.max(DAY_CARD_MS, day.until - Date.now()) }, this.handlers);
      return;
    }
    this.showCard({ id: 'calendar', kind: 'list', icon: '📅', title: 'Calendar', subtitle: `${events.length} event${events.length === 1 ? '' : 's'}`, lines, ttlMs: DAY_CARD_MS });
  }


  /**
   * Max read your email: show it (one email: who, when, the subject and the start of the text; several:
   * a list). If the AI then shows its own summary with show_on_screen, that replaces this card.
   */
  private emailCard(tool: string, out: string): void {
    if (!/^(GMAIL|OUTLOOK)_/i.test(tool) || !/(FETCH|LIST|GET|SEARCH|READ|FIND).*(EMAIL|MESSAGE|MAIL)/i.test(tool)) return;
    if (/(SEND|REPLY|DRAFT|DELETE|MOVE|FORWARD|ATTACHMENT|LABEL|FOLDER)/i.test(tool)) return;
    const mails = extractEmails(out);
    if (!mails.length) return;
    const when = (ms?: number) => {
      if (!ms) return '';
      const tz = timeZone();
      const day = (x: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x);
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
      return day(ms) === day(Date.now()) ? hm : `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms)} ${hm}`;
    };
    if (mails.length === 1) {
      const m = mails[0];
      this.showCard({
        id: 'email',
        kind: 'list',
        icon: '✉️',
        title: 'Email',
        subtitle: [m.from ? `From ${m.from}` : '', when(m.at)].filter(Boolean).join(' · ') || undefined,
        big: m.subject,
        body: m.body ?? m.snippet,
        ttlMs: DAY_CARD_MS * 2,
      });
      return;
    }
    this.showCard({
      id: 'email',
      kind: 'list',
      icon: '✉️',
      title: 'Email',
      subtitle: `${mails.length} messages`,
      lines: mails.slice(0, 10).map((m) => ({ time: when(m.at).slice(-5) || undefined, text: m.subject, sub: [m.from, m.snippet].filter(Boolean).join(' · ').slice(0, 140) || undefined })),
      ttlMs: DAY_CARD_MS * 2,
    });
  }

  /** Whether the box's updater is working (/run/max/update.json, written by max-update.py). */
  private updating(): boolean {
    try {
      const u = JSON.parse(readFileSync(join(this.cfg.face.runDir, 'update.json'), 'utf8')) as { state?: string; at?: number };
      return (u.state === 'updating' || u.state === 'rebooting') && Date.now() - (u.at ?? 0) < 3600_000;
    } catch {
      return false;
    }
  }

  /** The box's WiFi service writes its status here; announce changes out loud. */
  private async readWifi(): Promise<void> {
    let next: WifiStatus | undefined;
    try {
      next = JSON.parse(readFileSync(join(this.cfg.face.runDir, 'wifi.json'), 'utf8')) as WifiStatus;
      if (!next?.state) next = undefined;
    } catch {
      next = undefined;
    }
    const prev = this.wifi;
    if (next && next.state === 'connected' && next.at && Date.now() - next.at > 60_000) next = undefined; // old news
    if (!next) {
      this.wifi = undefined;
      return;
    }
    if (prev?.state !== next.state || prev?.password !== next.password) {
      let qrSvg: string | undefined;
      if (next.state === 'setup' && next.ssid) {
        const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
        const payload = `WIFI:T:WPA;S:${esc(next.ssid)};P:${esc(next.password ?? '')};;`;
        qrSvg = await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f14', light: '#ffffff' } });
      }
      this.wifi = { ...next, qrSvg };
      this.announceWifi(next, prev);
    } else {
      this.wifi = { ...next, qrSvg: this.wifi?.qrSvg };
    }
  }

  private announceWifi(next: WifiStatus, prev?: WifiStatus): void {
    const say = (t: string) => this.timerService?.announce(t);
    if (next.state === 'setup' && prev?.state !== 'setup') {
      say(next.error ? `That didn't work: ${next.error}. Scan the code on my screen to try again.` : "I can't reach the WiFi. Scan the code on my screen to set me up.");
    } else if (next.state === 'connected' && prev && prev.state !== 'connected') {
      say(`I'm connected${next.ssid ? ` to ${next.ssid}` : ''}.`);
    }
  }

  private inSleepHours(): boolean {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(this.cfg.face.sleep.trim());
    if (!m) return false;
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const now = +(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + +(p.find((x) => x.type === 'minute')?.value ?? 0);
    const from = +m[1] * 60 + +m[2];
    const to = +m[3] * 60 + +m[4];
    return from <= to ? now >= from && now < to : now >= from || now < to;
  }
}
