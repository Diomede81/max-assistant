/**
 * Second opinion on a wake-up. The wake word engine listens for a sound pattern, so a clatter,
 * a song or the TV can occasionally look like "hey max". When it fires, the last couple of
 * seconds are run through Max's own (local) speech recogniser: if nothing in it sounds like the
 * wake word, it was a false alarm and Max stays asleep.
 *
 * It's deliberately lenient: the engine has already matched the sound, so this only needs to
 * rule out noise, music and unrelated talk. Recognisers often mishear names (especially with an
 * accent: "Max" -> "Marx", "Mats", "Mex"), so any word starting with the same sound and close
 * in spelling counts.
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

/**
 * Does this transcript contain the wake word (allowing for small mishearings)? `strict`: only the word itself or
 * a known sound-alike counts, no near misses: used while Max's own speaker plays (a presenter saying "man",
 * "map" or "may" would otherwise pass as "max").
 */
export function heardWakeWord(transcript: string, names: string[], strict = false): boolean {
  const tokens = transcript
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // "[music]", "(background noise)"
    .split(/[^a-z']+/)
    .map((t) => t.replace(/'s$|'/g, ''))
    .filter(Boolean);
  if (strict) {
    // The whole phrase, "hey" (or another lead-in) right before the name, and the name itself or something that
    // plainly is it with an accent ("mex", "macks"): a song or a presenter saying "man", "may" or "marks" doesn't
    // pass, and neither does the name on its own.
    return keyWords(names).some((kw) =>
      tokens.some((t, i) => i > 0 && FILLER.has(tokens[i - 1]) && (t === kw || (SOUND_ALIKES[kw] ?? []).includes(t) || (kw === 'max' && /^m[aeiu][xkc]{1,2}s?$/.test(t)))),
    );
  }
  // A near miss ("mats", "mex", "marx") only counts right after a lead-in ("hey", "okay"...): on its own, a short
  // word one letter away from the name is far too common in ordinary talk ("may", "man", "map"), and the engine
  // firing on those is exactly the false wake-up to catch.
  const near = (t: string, kw: string) => editDistance(t, kw) <= 1 || (t[0] === kw[0] && t.length >= 2 && editDistance(t, kw) <= (kw.length >= 6 ? 3 : 2));
  return keyWords(names).some((kw) =>
    tokens.some(
      (t, i) =>
        t === kw ||
        (SOUND_ALIKES[kw] ?? []).includes(t) ||
        (t.startsWith(kw) && t.length <= kw.length + 2) ||
        (kw.length >= 5 && near(t, kw)) ||
        (i > 0 && FILLER.has(tokens[i - 1]) && near(t, kw)),
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
