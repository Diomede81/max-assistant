/**
 * Second opinion on a wake-up. The wake word engine listens for a sound pattern, so a clatter,
 * a song or the TV can occasionally look like "hey max". When it fires, the last couple of
 * seconds are run through Max's own (local) speech recogniser: if the words don't contain the
 * wake word, it was a false alarm and Max stays asleep.
 */

const FILLER = new Set(['hey', 'hi', 'ok', 'okay', 'oi', 'yo', 'hello']);

/** Ways speech recognisers commonly write the key word (they hear names imperfectly). */
const SOUND_ALIKES: Record<string, string[]> = {
  max: ['mac', 'macs', 'mack', 'macks', 'maks', 'maxi', 'maxie', 'maxy', 'marks', 'mags', 'maxx'],
  jarvis: ['jervis', 'javis', 'jarvas', 'jarvi', 'service'],
  nabu: ['nabou', 'naboo', 'nabo'],
  mycroft: ['microsoft', 'micro'],
  alexa: ['alexia', 'alexis', 'lexa'],
};

/** "hey_max" -> ["max"]: the distinctive word(s) of each configured wake word. */
export function keyWords(names: string[]): string[] {
  return [...new Set(names.flatMap((n) => n.toLowerCase().split(/[_\s-]+/).filter((w) => w && !FILLER.has(w))))];
}

/** Does this transcript contain the wake word (allowing for small mishearings)? */
export function heardWakeWord(transcript: string, names: string[]): boolean {
  const tokens = transcript
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // "[music]", "(background noise)"
    .split(/[^a-z']+/)
    .map((t) => t.replace(/'s$|'/g, ''))
    .filter(Boolean);
  return keyWords(names).some((kw) =>
    tokens.some(
      (t) =>
        t === kw ||
        (SOUND_ALIKES[kw] ?? []).includes(t) ||
        (t.startsWith(kw) && t.length <= kw.length + 2) ||
        (kw.length >= 4 && editDistance(t, kw) <= (kw.length >= 6 ? 2 : 1)),
    ),
  );
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
