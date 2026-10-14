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
}

/**
 * The box's speaker volume and screen brightness, from the screen's menu, by voice or from the
 * control panel. Volume is the sound system's own (it covers Max's voice and the music) and
 * the sound system remembers it. Brightness is the screen's backlight: Max runs in a container,
 * so he asks the box through the folder they share (/run/max/brightness-request; the box's
 * max-brightness service applies it) and keeps the level so it is set again after a restart.
 */
@Injectable()
export class DeviceService implements OnModuleInit {
  private readonly log = new Logger('Device');
  private readonly store: SealedStore<{ brightness?: number }>;
  private level = 100;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'device');
  }

  onModuleInit(): void {
    try {
      this.level = clamp(this.store.load()?.brightness ?? 100, MIN_BRIGHTNESS);
    } catch {
      // keep full brightness
    }
    // After a restart, the box's screen starts at full brightness: set it back to the chosen level.
    if (this.cfg.face.onBox && this.level !== 100) this.applyBrightness();
  }

  async status(): Promise<DeviceStatus> {
    return { volume: await this.volume(), brightness: this.level, brightnessSupported: this.backlight()?.supported };
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
    this.store.save({ brightness: this.level }).catch((err) => this.log.warn(`Could not save the brightness: ${(err as Error).message}`));
    if (!this.applyBrightness()) return "Couldn't reach the box's screen settings";
    this.log.log(`Brightness ${this.level}%`);
    return this.level;
  }

  changeBrightness(by: number): number | string {
    return this.setBrightness(this.level + by);
  }

  private applyBrightness(): boolean {
    try {
      writeFileSync(join(this.cfg.face.runDir, 'brightness-request'), String(this.level));
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
