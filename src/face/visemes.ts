/**
 * Real-time lip-sync from audio. Each 50 ms of Max's voice is analysed for where its
 * energy sits in the spectrum, which tells the mouth shapes apart:
 *  - open  (a, ah, o): strong energy around 500-1100 Hz (high first formant)
 *  - wide  (ee, i, e): strong energy around 1800-3200 Hz (high second formant)
 *  - round (oo, u, w): energy concentrated low, little above 1 kHz
 *  - teeth (s, f, sh, t): hiss above 3.5 kHz
 *  - closed (m, b, p, pauses): quiet
 * The same idea game and VTuber characters use; it works with any voice (OpenAI, Gemini,
 * Kokoro, Piper) because it only needs the sound.
 */
export interface Mouth {
  /** jaw opening 0..1 */
  o: number;
  /** lips spread (ee) 0..1 */
  w: number;
  /** lips rounded (oo) 0..1 */
  r: number;
  /** teeth / hiss (s, f) 0..1 */
  s: number;
}

export const CLOSED: Mouth = { o: 0, w: 0, r: 0, s: 0 };

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function analyse(samples: Float32Array, rate: number): Mouth {
  const n = samples.length;
  if (!n) return CLOSED;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += samples[i] * samples[i];
  const rms = Math.sqrt(sq / n);
  // Speech sits around 0.02-0.2 RMS; map to a lively 0..1 loudness.
  const loud = clamp(Math.pow(rms * 6, 0.7));
  if (loud < 0.06) return CLOSED;

  // Pre-emphasis flattens the voice's natural treble roll-off so the bands compare fairly.
  const size = Math.min(2048, 1 << Math.ceil(Math.log2(n)));
  const m = Math.min(n, size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 1; i < m; i++) re[i] = (samples[i] - 0.95 * samples[i - 1]) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (m - 1)));
  fft(re, im);
  const hz = rate / size;
  const band = (lo: number, hi: number) => {
    let e = 0;
    const a = Math.max(1, Math.floor(lo / hz));
    const b = Math.min(size / 2 - 1, Math.ceil(hi / hz));
    for (let k = a; k <= b; k++) e += re[k] * re[k] + im[k] * im[k];
    return e;
  };
  const b = [band(150, 500), band(500, 1100), band(1100, 1800), band(1800, 3200), band(3500, Math.min(8000, rate / 2 - hz))];
  const total = b.reduce((x, y) => x + y, 0) + 1e-12;
  const [p1, p2, , p4, p5] = b.map((v) => v / total);

  const teeth = clamp((p5 - 0.15) * 2.5);
  const wide = clamp((p4 - 0.1) * 4) * (1 - teeth);
  const round = clamp((p1 - 0.35) * 3) * clamp(1 - (p4 - 0.04) * 8) * (1 - teeth);
  const open = clamp(p2 * 1.3 + 0.1);
  return {
    o: clamp(loud * (0.25 + 0.75 * open) * (1 - teeth * 0.6)),
    w: wide * Math.min(1, loud * 1.5),
    r: round * Math.min(1, loud * 1.5),
    s: teeth * Math.min(1, loud * 2),
  };
}

/** In-place iterative radix-2 FFT (size must be a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
