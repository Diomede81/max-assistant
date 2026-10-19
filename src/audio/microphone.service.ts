import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';

/** How often the mute button's note is checked. */
const MUTE_CHECK_MS = 250;

/**
 * Captures 16-bit mono PCM from the default ALSA/PipeWire input using `arecord`
 * (package: alsa-utils). Emits 'chunk' events of ~20 ms each.
 *
 * The box's mute button (scripts/pi/max-mute-button.py) leaves a note, /run/max/muted, while the
 * microphone is off. Max then hears only silence: no wake word, nothing sent anywhere.
 */
@Injectable()
export class MicrophoneService extends EventEmitter implements OnModuleDestroy {
  private readonly log = new Logger(MicrophoneService.name);
  private proc?: ChildProcess;
  private muteTimer?: NodeJS.Timeout;
  private _muted = false;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    super();
  }

  /** The mute button is on: the microphone only delivers silence. */
  get muted(): boolean {
    return this._muted;
  }

  private checkMute(): void {
    const muted = existsSync(join(this.cfg.face.runDir, 'muted'));
    if (muted === this._muted) return;
    this._muted = muted;
    this.log.log(muted ? 'Microphone muted (mute button)' : 'Microphone on again (mute button)');
  }

  get format() {
    return { rate: this.cfg.audio.sampleRate, width: 2, channels: 1 };
  }

  start(): void {
    if (this.proc) return;
    const args = ['-q', '-D', this.cfg.audio.inputDevice, '-f', 'S16_LE', '-c', '1',
      '-r', String(this.cfg.audio.sampleRate), '-t', 'raw', '--buffer-time=20000'];
    if (this.cfg.face.onBox && !this.muteTimer) {
      this.checkMute();
      this.muteTimer = setInterval(() => this.checkMute(), MUTE_CHECK_MS);
    }
    this.proc = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    this.proc.on('error', (err) =>
      this.log.error(`Cannot start microphone (${err.message}). Install it with: sudo apt install alsa-utils`));
    this.proc.stdout!.on('data', (chunk: Buffer) => this.emit('chunk', this._muted ? Buffer.alloc(chunk.length) : chunk));
    this.proc.on('exit', (code) => {
      this.log.warn(`arecord exited (${code})`);
      this.proc = undefined;
    });
    this.log.log(`Microphone started on "${this.cfg.audio.inputDevice}" @ ${this.cfg.audio.sampleRate} Hz`);
  }

  onModuleDestroy(): void {
    clearInterval(this.muteTimer);
    this.proc?.kill();
  }
}
