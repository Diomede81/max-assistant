import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { APP_CONFIG, AppConfig } from '../config';

/**
 * Captures 16-bit mono PCM from the default ALSA/PipeWire input using `arecord`
 * (package: alsa-utils). Emits 'chunk' events of ~20 ms each.
 */
@Injectable()
export class MicrophoneService extends EventEmitter implements OnModuleDestroy {
  private readonly log = new Logger(MicrophoneService.name);
  private proc?: ChildProcess;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    super();
  }

  get format() {
    return { rate: this.cfg.audio.sampleRate, width: 2, channels: 1 };
  }

  start(): void {
    if (this.proc) return;
    const args = ['-q', '-D', this.cfg.audio.inputDevice, '-f', 'S16_LE', '-c', '1',
      '-r', String(this.cfg.audio.sampleRate), '-t', 'raw', '--buffer-time=20000'];
    this.proc = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    this.proc.on('error', (err) =>
      this.log.error(`Cannot start microphone (${err.message}). Install it with: sudo apt install alsa-utils`));
    this.proc.stdout!.on('data', (chunk: Buffer) => this.emit('chunk', chunk));
    this.proc.on('exit', (code) => {
      this.log.warn(`arecord exited (${code})`);
      this.proc = undefined;
    });
    this.log.log(`Microphone started on "${this.cfg.audio.inputDevice}" @ ${this.cfg.audio.sampleRate} Hz`);
  }

  onModuleDestroy(): void {
    this.proc?.kill();
  }
}
