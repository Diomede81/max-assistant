/**
 * Streaming linear resampler for 16-bit mono PCM (e.g. 16 kHz mic -> 24 kHz for OpenAI
 * Realtime). Keeps state between chunks so there are no clicks at chunk boundaries.
 */
export class Resampler {
  private readonly step: number;
  private pos = 0; // fractional read position relative to the start of `prev` + current chunk
  private prev = 0; // last sample of the previous chunk
  private carry?: number; // odd trailing byte from the previous chunk

  constructor(fromRate: number, toRate: number) {
    this.step = fromRate / toRate;
  }

  push(chunk: Buffer): Buffer {
    if (this.carry !== undefined) {
      chunk = Buffer.concat([Buffer.from([this.carry]), chunk]);
      this.carry = undefined;
    }
    if (chunk.length % 2) {
      this.carry = chunk[chunk.length - 1];
      chunk = chunk.subarray(0, chunk.length - 1);
    }
    const n = chunk.length / 2;
    if (this.step === 1) return Buffer.from(chunk);
    // index -1 is `prev`, 0..n-1 are this chunk's samples
    const sample = (i: number) => (i < 0 ? this.prev : chunk.readInt16LE(i * 2));
    const out: number[] = [];
    while (this.pos < n) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = sample(i - 1);
      const b = sample(i);
      out.push(Math.round(a + (b - a) * f));
      this.pos += this.step;
    }
    this.pos -= n;
    if (n) this.prev = chunk.readInt16LE((n - 1) * 2);
    const buf = Buffer.alloc(out.length * 2);
    out.forEach((v, k) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), k * 2));
    return buf;
  }
}
