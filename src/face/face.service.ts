import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { APP_CONFIG, AppConfig } from '../config';
import { timeZone } from '../actions/clock';
import { TimerService, describe as describeTimer } from '../actions/timer.service';
import { ModesService } from '../memory/modes.service';
import { MusicService } from '../music/music.service';
import type { PcmFormat } from '../audio/speaker.service';

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
  timers: { label: string; endsAt: number; total: number }[];
  music?: { title: string; artist: string };
  wifi?: WifiStatus & { qrSvg?: string };
  offline: boolean;
}

const FRAME_MS = 50;
const INFO_MS = 1000;
const MUSIC_MS = 5000;

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
  /** Mouth levels (0..1) scheduled against the clock, one per 50 ms of audio. */
  private levels: { at: number; v: number }[] = [];
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
  ) {
    super();
    this.setMaxListeners(50);
  }

  onModuleInit(): void {
    if (!this.cfg.face.enabled) return;
    this.timers.push(setInterval(() => this.tickLevel(), FRAME_MS));
    this.timers.push(setInterval(() => void this.tickInfo(), INFO_MS));
    this.timers.push(setInterval(() => void this.pollMusic(), MUSIC_MS));
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  // ---------- Inputs from the rest of Max ----------

  setState(s: BaseState): void {
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
      let sum = 0;
      let n = 0;
      for (let i = off; i + 1 < end; i += bytesPerFrame) {
        const v = chunk.readInt16LE(i);
        sum += v * v;
        n++;
      }
      const rms = n ? Math.sqrt(sum / n) / 32768 : 0;
      // Speech sits around 0.02-0.2 RMS; map to a lively 0..1 mouth opening.
      this.levels.push({ at: t, v: Math.min(1, Math.pow(rms * 6, 0.7)) });
      t += ((end - off) / bytesPerFrame / fmt.rate) * 1000;
    }
    this.audioEndsAt = t;
    if (this.levels.length > 4000) this.levels.splice(0, this.levels.length - 4000);
  }

  /** Audio was cut off (interrupted). */
  audioStop(): void {
    this.levels = [];
    this.audioEndsAt = 0;
  }

  /** Long-press on the screen: ask the box's WiFi service to start setup mode. */
  requestWifiSetup(): boolean {
    try {
      writeFileSync(join(this.cfg.face.runDir, 'wifi-request'), String(Date.now()));
      this.log.log('WiFi setup requested from the screen');
      return true;
    } catch {
      return false; // not on the Max box (no WiFi service)
    }
  }

  // ---------- State for the face page ----------

  get speaking(): boolean {
    return Date.now() < this.audioEndsAt;
  }

  info(): FaceInfo {
    const offline = this.wifi?.state === 'setup' || this.wifi?.state === 'connecting';
    let state: FaceState = this.wifi && this.wifi.state !== 'connected' ? 'setup' : this.speaking ? 'speaking' : this.base;
    if (state === 'idle' && this.inSleepHours()) state = 'sleeping';
    return {
      state,
      mode: this.modes?.mode ?? 'personal',
      timers: (this.timerService?.list() ?? []).map((t) => ({ label: describeTimer(t), endsAt: t.endsAt, total: t.durationSeconds * 1000 })),
      music: this.music,
      wifi: this.wifi,
      offline,
    };
  }

  private tickLevel(): void {
    const now = Date.now();
    while (this.levels.length > 1 && this.levels[1].at <= now) this.levels.shift();
    const cur = this.levels[0] && this.levels[0].at <= now && now < this.audioEndsAt ? this.levels[0].v : 0;
    if (cur > 0 || this.lastLevel > 0) this.emit('level', cur);
    this.lastLevel = cur;
    if (!this.speaking && this.wasSpeaking) void this.tickInfo();
    this.wasSpeaking = this.speaking;
    if (this.speaking && !this.announcedSpeaking) void this.tickInfo();
    this.announcedSpeaking = this.speaking;
  }
  private lastLevel = 0;
  private wasSpeaking = false;
  private announcedSpeaking = false;

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
    this.music = (await this.musicService?.nowPlaying().catch(() => undefined)) ?? undefined;
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
