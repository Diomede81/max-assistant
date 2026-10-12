import { Inject, Injectable, Optional } from '@nestjs/common';
import { FaceService } from '../face/face.service';
import { ChildProcess, spawn } from 'node:child_process';
import { APP_CONFIG, AppConfig } from '../config';

export interface PcmFormat {
  rate: number;
  width: number;
  channels: number;
}

/** Plays raw PCM through `aplay`. One player process per utterance; stop() cuts audio instantly. */
@Injectable()
export class SpeakerService {
  private current?: ChildProcess;
  /** The box's face moves its mouth with whatever plays (optional: not in typing mode). */
  @Optional() @Inject(FaceService) private readonly face?: FaceService;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async play(format: PcmFormat, chunks: AsyncIterable<Buffer>): Promise<void> {
    const fmt = format.width === 2 ? 'S16_LE' : format.width === 4 ? 'S32_LE' : 'U8';
    const proc = spawn('aplay', ['-q', '-D', this.cfg.audio.outputDevice, '-f', fmt,
      '-c', String(format.channels), '-r', String(format.rate), '-t', 'raw'],
      { stdio: ['pipe', 'ignore', 'inherit'] });
    this.current = proc;
    const done = new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      proc.on('error', () => resolve()); // aplay missing: logged by the caller's silence, not a crash
    });
    proc.stdin!.on('error', () => undefined); // player stopped mid-sentence (stop() or missing aplay)
    try {
      for await (const chunk of chunks) {
        if (proc.exitCode !== null || proc.killed) break;
        this.face?.audio(chunk, format);
        proc.stdin!.write(chunk);
      }
    } finally {
      proc.stdin!.end();
    }
    await done;
    if (this.current === proc) this.current = undefined;
  }

  stop(): void {
    this.face?.audioStop();
    this.current?.kill();
    this.current = undefined;
  }
}
