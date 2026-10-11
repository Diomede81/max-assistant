/**
 * Decides when the user has finished speaking. This is the single biggest hidden delay
 * in a voice assistant, so `silenceMs` is worth tuning per room.
 *
 * Energy-based for zero dependencies; swap for Silero VAD for noisy rooms.
 */
export class Endpointer {
  private heardSpeech = false;
  private silentMs = 0;
  private totalMs = 0;
  /** Loudest chunk seen, reported when nobody seems to speak (helps tune rmsThreshold). */
  peakRms = 0;

  constructor(
    private readonly rate: number,
    private readonly rmsThreshold: number,
    private readonly silenceMs: number,
    private readonly maxUtteranceMs: number,
    private readonly noSpeechTimeoutMs = 4000,
    /** Ignore the first ms of audio (e.g. Max's own wake chime) when deciding if someone spoke. */
    private readonly graceMs = 0,
  ) {}

  /** Returns 'continue', 'end' (user finished) or 'timeout' (nobody spoke). */
  push(chunk: Buffer): 'continue' | 'end' | 'timeout' {
    const samples = chunk.length / 2;
    const ms = (samples / this.rate) * 1000;
    let sum = 0;
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const s = chunk.readInt16LE(i);
      sum += s * s;
    }
    const rms = Math.sqrt(sum / Math.max(samples, 1));
    this.totalMs += ms;
    if (this.totalMs <= this.graceMs) return 'continue';
    this.peakRms = Math.max(this.peakRms, Math.round(rms));

    if (rms >= this.rmsThreshold) {
      this.heardSpeech = true;
      this.silentMs = 0;
    } else {
      this.silentMs += ms;
    }

    if (!this.heardSpeech && this.totalMs >= this.noSpeechTimeoutMs) return 'timeout';
    if (this.heardSpeech && this.silentMs >= this.silenceMs) return 'end';
    if (this.totalMs >= this.maxUtteranceMs) return 'end';
    return 'continue';
  }
}
