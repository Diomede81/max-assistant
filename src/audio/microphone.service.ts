import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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

  /** Muting from the control panel works on the box: its mute service (the one behind the button) does it. */
  get canMute(): boolean {
    return this.cfg.face.onBox;
  }

  /**
   * The control panel's Mute / Unmute: asks the box's mute service, so the button, its light, the face and the panel
   * always agree (and pressing the button still toggles it). Waits for the microphone to follow.
   */
  async setMuted(on: boolean): Promise<string> {
    if (!this.canMute) return 'Muting from here only works on the Max box.';
    this.checkMute();
    if (this._muted === on) return on ? 'The microphone is already off.' : 'The microphone is already on.';
    try {
      writeFileSync(join(this.cfg.face.runDir, 'mute-request'), on ? 'on\n' : 'off\n');
    } catch (err) {
      return `Couldn't ask the box: ${(err as Error).message}`;
    }
    for (let i = 0; i < 20 && this._muted !== on; i++) {
      await new Promise((r) => setTimeout(r, 150));
      this.checkMute();
    }
    if (this._muted !== on) return "The box's mute service didn't answer: run the setup again (it installs it), or use the button on top.";
    return on ? 'Microphone off: Max can\'t hear anything until you turn it on again (here or with the button on top).' : 'Microphone on: Max can hear you again.';
  }

  private checkMute(): void {
    const muted = existsSync(join(this.cfg.face.runDir, 'muted'));
    if (muted === this._muted) return;
    this._muted = muted;
    this.log.log(muted ? 'Microphone muted' : 'Microphone on again');
  }

  get format() {
    return { rate: this.cfg.audio.sampleRate, width: 2, channels: 1 };
  }

  start(): void {
    if (this.proc) return;
    // One channel of a multi-channel microphone (AUDIO_INPUT_CHANNEL): the ReSpeaker XVF3800 gives two, each
    // processed differently; asked for mono, the sound system averages them, which blurs the one that suits
    // wake words. Recorded with every channel and the chosen one picked out here.
    const pick = this.cfg.audio.inputChannel;
    const channels = pick === undefined ? 1 : this.cfg.audio.inputChannels;
    const args = ['-q', '-D', this.cfg.audio.inputDevice, '-f', 'S16_LE', '-c', String(channels),
      '-r', String(this.cfg.audio.sampleRate), '-t', 'raw', '--buffer-time=20000'];
    const frame = channels * 2;
    let rest: Buffer = Buffer.alloc(0);
    const mono = (chunk: Buffer): Buffer => {
      if (pick === undefined) return chunk;
      const all = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const frames = Math.floor(all.length / frame);
      rest = all.subarray(frames * frame);
      const out = Buffer.alloc(frames * 2);
      for (let i = 0; i < frames; i++) out.writeInt16LE(all.readInt16LE(i * frame + pick * 2), i * 2);
      return out;
    };
    if (pick !== undefined) this.log.log(`Listening to channel ${pick} of ${channels} on "${this.cfg.audio.inputDevice}"`);
    if (this.cfg.face.onBox && !this.muteTimer) {
      this.checkMute();
      this.muteTimer = setInterval(() => this.checkMute(), MUTE_CHECK_MS);
    }
    this.proc = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    this.proc.on('error', (err) =>
      this.log.error(`Cannot start microphone (${err.message}). Install it with: sudo apt install alsa-utils`));
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      const pcm = mono(chunk);
      if (pcm.length) this.emit('chunk', this._muted ? Buffer.alloc(pcm.length) : pcm);
    });
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
