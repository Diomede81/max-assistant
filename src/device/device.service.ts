import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { APP_CONFIG, AppConfig } from '../config';
import { SealedStore } from '../memory/sealed-store';

const run = promisify(execFile);
const SINK = '@DEFAULT_SINK@';
/** Never fully dark: a black screen looks like the box is off. */
const MIN_BRIGHTNESS = 5;
export const STEP = 10;

export interface DeviceStatus {
  /** Speaker volume 0-100 (undefined: the sound system can't be reached). */
  volume?: number;
  /** Screen brightness 5-100. */
  brightness: number;
  /** Whether the box's screen can change its brightness (known after the first change on the box). */
  brightnessSupported?: boolean;
  /** What Max says when he hears "Hey Max" (empty: a short beep), and the start-up jingle. */
  greeting?: string;
  /** Minutes after a conversation during which "Hey Max" gets just the short beep, not the greeting again (0: greet every time). */
  greetAgainMin?: number;
  startSound?: boolean;
  /** How the speaker is tuned (see SPEAKER_TONES). */
  tone?: SpeakerTone;
}

/** Speaker tuning, applied on the box by max-sound.sh (an equaliser before the mic board). */
export const SPEAKER_TONES = {
  flat: 'Flat: the sound as it is',
  warm: 'Warm: fuller, more bass, softer highs (best for music)',
  voice: 'Voice: clearer speech, less boom',
} as const;
export type SpeakerTone = keyof typeof SPEAKER_TONES;

/**
 * The box's speaker volume and screen brightness, from the screen's menu, by voice or from the
 * control panel. Volume is the sound system's own (it covers Max's voice and the music) and
 * the sound system remembers it. Brightness is the screen's backlight: Max runs in a container,
 * so he asks the box through the folder they share (/run/max/brightness-request; the box's
 * max-brightness service applies it) and keeps the level so it is set again after a restart.
 */
export const DEFAULT_GREETING = 'Hello, how can I help?';

/** By default the greeting isn't repeated within 10 minutes of the last conversation: just the short beep. */
const GREET_AGAIN_MIN = 10;

@Injectable()
export class DeviceService implements OnModuleInit {
  private readonly log = new Logger('Device');
  private readonly store: SealedStore<{ brightness?: number; greeting?: string; greetAgainMin?: number; startSound?: boolean; tone?: SpeakerTone }>;
  private level = 100;
  private voice: { greeting: string; greetAgainMin: number; startSound: boolean } = { greeting: DEFAULT_GREETING, greetAgainMin: GREET_AGAIN_MIN, startSound: true };
  private speakerTone: SpeakerTone = 'flat';

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'device');
  }

  onModuleInit(): void {
    try {
      const saved = this.store.load();
      this.level = clamp(saved?.brightness ?? 100, MIN_BRIGHTNESS);
      this.voice = { greeting: saved?.greeting ?? DEFAULT_GREETING, greetAgainMin: saved?.greetAgainMin ?? GREET_AGAIN_MIN, startSound: saved?.startSound ?? true };
      if (saved?.tone && saved.tone in SPEAKER_TONES) this.speakerTone = saved.tone;
    } catch {
      // keep full brightness
    }
    // /run/max is emptied when the box restarts: tell it the speaker tuning again.
    if (this.cfg.face.onBox) this.applyTone();
    // After a restart, the box's screen starts at full brightness: set it back to the chosen level.
    if (this.cfg.face.onBox && this.level !== 100) this.applyBrightness();
  }

  async status(): Promise<DeviceStatus> {
    return { volume: await this.volume(), brightness: this.level, brightnessSupported: this.backlight()?.supported, ...this.voice, tone: this.speakerTone };
  }

  // ---------- Greeting and start-up sound ----------

  /** What Max says when he hears "Hey Max" (empty: just the short beep). */
  get greeting(): string {
    return this.voice.greeting;
  }

  /** Minutes after a conversation when "Hey Max" gets just the beep instead of the greeting (0: greet every time). */
  get greetAgainMin(): number {
    return this.voice.greetAgainMin;
  }

  /** A short jingle when Max starts, so you know he's ready. */
  get startSound(): boolean {
    return this.voice.startSound;
  }

  setVoice(changes: { greeting?: string; greetAgainMin?: number; startSound?: boolean }): string {
    if (changes.greeting !== undefined) this.voice.greeting = changes.greeting.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (changes.greetAgainMin !== undefined && Number.isFinite(changes.greetAgainMin)) this.voice.greetAgainMin = Math.max(0, Math.min(240, Math.round(changes.greetAgainMin)));
    if (changes.startSound !== undefined) this.voice.startSound = changes.startSound;
    this.persist();
    return 'Saved.';
  }

  private persist(): void {
    this.store
      .save({ brightness: this.level, ...this.voice, tone: this.speakerTone })
      .catch((err) => this.log.warn(`Could not save the device settings: ${(err as Error).message}`));
  }

  // ---------- Speaker tuning ----------

  get tone(): SpeakerTone {
    return this.speakerTone;
  }

  setTone(tone: string): string {
    if (!(tone in SPEAKER_TONES)) return 'Unknown speaker sound.';
    if (!this.cfg.face.onBox) return 'The speaker sound can only be changed on the Max box.';
    this.speakerTone = tone as SpeakerTone;
    this.persist();
    if (!this.applyTone()) return "Couldn't reach the box's sound settings.";
    this.log.log(`Speaker sound: ${tone}`);
    return `Speaker sound: ${tone}. It changes in a couple of seconds.`;
  }

  private applyTone(): boolean {
    try {
      writeFileSync(join(this.cfg.face.runDir, 'sound.json'), JSON.stringify({ tone: this.speakerTone }));
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Volume ----------

  async volume(): Promise<number | undefined> {
    try {
      const { stdout } = await run('pactl', ['get-sink-volume', SINK], { timeout: 4000 });
      const m = /(\d+)%/.exec(stdout);
      return m ? Number(m[1]) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Sets the speaker volume (0-100). Returns the new level, or an error message. */
  async setVolume(pct: number): Promise<number | string> {
    const v = clamp(pct, 0);
    try {
      await run('pactl', ['set-sink-volume', SINK, `${v}%`], { timeout: 4000 });
      if (v > 0) await run('pactl', ['set-sink-mute', SINK, '0'], { timeout: 4000 }).catch(() => undefined);
      this.log.log(`Volume ${v}%`);
      return v;
    } catch (err) {
      return `The sound system didn't respond (${(err as Error).message.split('\n')[0]})`;
    }
  }

  async changeVolume(by: number): Promise<number | string> {
    const now = await this.volume();
    if (now === undefined) return "The sound system didn't respond";
    return this.setVolume(now + by);
  }

  // ---------- Brightness ----------

  get brightness(): number {
    return this.level;
  }

  /** Sets the screen brightness (5-100). Returns the new level, or an error message. */
  setBrightness(pct: number): number | string {
    if (!this.cfg.face.onBox) return 'Screen brightness can only be changed on the Max box';
    this.level = clamp(pct, MIN_BRIGHTNESS);
    this.dimmed = false;
    this.persist();
    if (!this.applyBrightness()) return "Couldn't reach the box's screen settings";
    this.log.log(`Brightness ${this.level}%`);
    return this.level;
  }

  changeBrightness(by: number): number | string {
    return this.setBrightness(this.level + by);
  }

  /**
   * The screen dims itself after a quiet spell (and lights up again for anything): a temporary
   * level, never saved, never above the chosen brightness. Returns whether the backlight can do it.
   */
  dim(on: boolean, level: number): boolean {
    if (!this.cfg.face.onBox) return false;
    this.dimmed = on;
    this.dimLevel = clamp(level, MIN_BRIGHTNESS);
    const ok = this.applyBrightness();
    return ok && this.backlight()?.supported !== false;
  }
  private dimmed = false;
  private dimLevel = 20;

  private applyBrightness(): boolean {
    try {
      const level = this.dimmed ? Math.min(this.level, this.dimLevel) : this.level;
      writeFileSync(join(this.cfg.face.runDir, 'brightness-request'), String(level));
      return true;
    } catch {
      return false;
    }
  }

  /** What the box reported after applying the last change (written by max-brightness.sh). */
  private backlight(): { supported: boolean } | undefined {
    if (!this.cfg.face.onBox) return { supported: false };
    try {
      return JSON.parse(readFileSync(join(this.cfg.face.runDir, 'backlight.json'), 'utf8')) as { supported: boolean };
    } catch {
      return undefined;
    }
  }
}

const clamp = (v: number, min: number) => Math.max(min, Math.min(100, Math.round(Number.isFinite(v) ? v : 100)));
