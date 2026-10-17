import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { sinkInputs } from '../music/sink-inputs';

/**
 * Max dancing to the music: the beat of what's playing (listened to from the speaker's own output,
 * so it works the same for Spotify, the radio and AirPlay) and the style of dancing for the music.
 */

/** How he dances: bouncing (dance, pop, hip hop), headbanging (rock), swaying (jazz, classical), nodding (the rest). */
export type GrooveMood = 'party' | 'rock' | 'chill' | 'groove';

const MOOD_WORDS: Record<Exclude<GrooveMood, 'groove'>, string[]> = {
  rock: ['rock', 'metal', 'punk', 'grunge', 'alternative', 'indie', 'emo', 'hardcore', 'heavy', 'planet rock', 'kerrang', 'absolute radio'],
  party: ['dance', 'edm', 'electronic', 'electro', 'house', 'techno', 'trance', 'disco', 'pop', 'hip hop', 'hip-hop', 'hiphop', 'rap',
    'funk', 'latin', 'reggaeton', 'salsa', 'dancehall', 'drum and bass', 'dnb', 'dubstep', 'garage', 'club', 'party', 'hits', 'top 40',
    'chart', 'kiss', 'capital', 'radio 1', '80s', '90s'],
  chill: ['jazz', 'lounge', 'chill', 'chillout', 'ambient', 'classical', 'classic fm', 'piano', 'acoustic', 'folk', 'blues', 'soul',
    'lofi', 'lo-fi', 'relax', 'relaxing', 'sleep', 'smooth', 'easy listening', 'orchestra', 'opera', 'bossa', 'meditation',
    'instrumental', 'new age', 'baroque', 'symphony'],
};

/** The style of music from its genre, the station's name or tags, or the title. Undefined if nothing gives it away. */
export function moodFor(text: string): GrooveMood | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9&-]+/g, ' ')} `;
  let best: { mood: GrooveMood; score: number; at: number } | undefined;
  for (const [mood, words] of Object.entries(MOOD_WORDS) as [GrooveMood, string[]][]) {
    let score = 0;
    let at = Infinity;
    for (const w of words) {
      const i = t.indexOf(` ${w} `);
      if (i >= 0) {
        score++;
        at = Math.min(at, i);
      }
    }
    if (score && (!best || score > best.score || (score === best.score && at < best.at))) best = { mood, score, at };
  }
  return best?.mood;
}

/** When the style can't be told from the names: fast music is a party, slow music is chill. */
export function moodForTempo(bpm: number | undefined): GrooveMood {
  if (!bpm) return 'groove';
  if (bpm >= 118) return 'party';
  if (bpm <= 88) return 'chill';
  return 'groove';
}

export const RATE = 11025;
const BLOCK = 256; // ~23 ms
const HISTORY = 43; // ~1 s of blocks
const MIN_GAP_MS = 280; // no faster than ~210 beats a minute
const LOWPASS = 1 - Math.exp((-2 * Math.PI * 150) / RATE); // the kick drum and the bass

/** What the face gets ~20 times a second: how loud (0–1) and whether a beat landed since the last one. */
export interface GrooveFrame {
  e: number;
  b: 0 | 1;
}

/** Finds the beats in 16-bit mono sound, block by block (pure, so it can be tested with made-up sound). */
export class BeatTracker {
  private lp = 0;
  private history: number[] = [];
  private peak = 1e-6;
  private lastBeat = -1e9;
  private beats: number[] = [];
  private pending: number[] = [];
  private level = 0;
  private beatSince = false;
  private ms = 0;

  /** Feeds samples (any length); returns nothing, read the result with frame(). */
  push(samples: Int16Array): void {
    for (const v of samples) {
      this.pending.push(v / 32768);
      if (this.pending.length === BLOCK) {
        this.block(this.pending);
        this.pending = [];
      }
    }
  }

  /** The loudness and beat since the last call. */
  frame(): GrooveFrame {
    const f: GrooveFrame = { e: Math.round(this.level * 100) / 100, b: this.beatSince ? 1 : 0 };
    this.beatSince = false;
    return f;
  }

  /** The tempo in beats a minute, once there are enough beats to tell (folded into 70–180). */
  get bpm(): number | undefined {
    if (this.beats.length < 6) return undefined;
    const gaps = this.beats.slice(1).map((t, i) => t - this.beats[i]).sort((a, b) => a - b);
    // the middle half of the gaps, averaged: steady against a missed or extra beat, and finer than one block
    const mid = gaps.slice(gaps.length >> 2, Math.max((gaps.length >> 2) + 1, gaps.length - (gaps.length >> 2)));
    let bpm = 60_000 / (mid.reduce((a, c) => a + c, 0) / mid.length);
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm);
  }

  private block(b: number[]): void {
    this.ms += (BLOCK * 1000) / RATE;
    let bass = 0;
    let all = 0;
    for (const v of b) {
      this.lp += LOWPASS * (v - this.lp);
      bass += this.lp * this.lp;
      all += v * v;
    }
    bass /= b.length;
    const rms = Math.sqrt(all / b.length);
    this.peak = Math.max(rms, this.peak * 0.9995);
    this.level = rms < 0.003 ? 0 : Math.min(1, rms / this.peak);
    const avg = this.history.length ? this.history.reduce((a, c) => a + c, 0) / this.history.length : bass;
    this.history.push(bass);
    if (this.history.length > HISTORY) this.history.shift();
    if (rms >= 0.003 && this.history.length >= 10 && bass > avg * 1.45 && bass > 1e-6 && this.ms - this.lastBeat >= MIN_GAP_MS) {
      // a gap of more than 2 seconds starts the tempo afresh (a new song, or a quiet bit)
      if (this.ms - this.lastBeat > 2000) this.beats = [];
      this.lastBeat = this.ms;
      this.beats.push(this.ms);
      if (this.beats.length > 17) this.beats.shift();
      this.beatSince = true;
    }
  }
}

const FRAME_MS = 50;

/** The music streams to listen to: the radio, AirPlay and Spotify (not Max's own voice). */
const MUSIC = /max radio|shairport|librespot|spotify/;

/**
 * Listens to the music while it plays and emits 'frame' (GrooveFrame) every 50 ms. Nothing is
 * recorded or kept: the sound only becomes a loudness and a beat. It listens to the music stream
 * itself (wherever the sound system sends it: the speaker, another output, or nowhere when no speaker
 * is plugged in), else to what the default speaker plays. Without a sound system (e.g. no parec) the
 * face keeps time by itself.
 */
export class GrooveListener extends EventEmitter {
  private readonly log = new Logger('Groove');
  private proc?: ChildProcess;
  /** What parec listens to: a stream's number, or the default speaker ('default'). */
  private target?: number | 'default';
  private tracker = new BeatTracker();
  private tick?: NodeJS.Timeout;
  private failures = 0;
  /** Listening to a single stream didn't work on this sound system: the default speaker only. */
  private noStreams = false;
  private wanted = false;

  get bpm(): number | undefined {
    return this.wanted ? this.tracker.bpm : undefined;
  }

  /** Starts listening, or (already listening) follows the music to its current stream, e.g. radio to AirPlay. */
  async start(): Promise<void> {
    if (!this.wanted) {
      this.wanted = true;
      this.failures = 0;
      this.tracker = new BeatTracker();
      this.tick = setInterval(() => this.emit('frame', this.tracker.frame()), FRAME_MS);
    }
    const target = await this.find();
    if (!this.wanted) return;
    if (this.proc && target === this.target) return;
    this.kill();
    this.target = target;
    this.listen();
  }

  stop(): void {
    this.wanted = false;
    clearInterval(this.tick);
    this.tick = undefined;
    this.target = undefined;
    this.kill();
  }

  private kill(): void {
    const p = this.proc;
    this.proc = undefined;
    p?.kill();
  }

  /** The newest music stream playing, or the default speaker. */
  private async find(): Promise<number | 'default'> {
    if (this.noStreams) return 'default';
    const s = (await sinkInputs()).filter((x) => MUSIC.test(x.names)).sort((a, b) => b.index - a.index)[0];
    return s ? s.index : 'default';
  }

  private listen(): void {
    if (!this.wanted || this.proc || this.failures >= 3 || this.target === undefined) return;
    const target = this.target;
    const from = target === 'default' ? ['-d', '@DEFAULT_MONITOR@'] : [`--monitor-stream=${target}`];
    let proc: ChildProcess;
    try {
      proc = spawn('parec', [...from, '--raw', '--format=s16le', `--rate=${RATE}`, '--channels=1', '--latency-msec=40'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return;
    }
    this.proc = proc;
    const started = Date.now();
    let rest: Buffer = Buffer.alloc(0);
    let heard = false;
    proc.stdout?.on('data', (d: Buffer) => {
      heard = true;
      const buf = rest.length ? Buffer.concat([rest, d]) : d;
      const even = buf.length & ~1;
      rest = buf.subarray(even);
      this.tracker.push(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even)));
    });
    const ended = () => {
      if (this.proc !== proc) return;
      this.proc = undefined;
      if (!this.wanted) return;
      if (target !== 'default') {
        // The stream ended (another station, another source): find the music again. Twice without a
        // sound: this sound system can't listen to a single stream, so the default speaker from now on.
        if (!heard && ++this.failures >= 2) {
          this.noStreams = true;
          this.failures = 0;
          this.log.log('Listening to the default speaker for the beat');
        }
        setTimeout(() => void this.start(), 1000);
        return;
      }
      if (Date.now() - started < 10_000) {
        if (++this.failures >= 3) {
          this.log.warn('Could not listen to the music for the beat: Max will keep time by himself.');
          return;
        }
      }
      setTimeout(() => this.listen(), 2000);
    };
    proc.on('error', ended);
    proc.on('exit', ended);
  }
}
