/**
 * Is a new fact the same as one Max already has, in other words? Meaning alone (embedding similarity)
 * can't tell "Sofia's birthday is 3 May" from "Marco's birthday is 5 June": they read alike. So two
 * facts are the same only when they mean nearly the same AND name the same people, places and numbers.
 */

/** Similarity above which a fact is the same whatever it names (an exact rewording). */
export const SAME_FACT = 0.9;
/** Similarity above which a fact is the same when it names the same people, places and numbers. */
export const SAME_FACT_ANCHORED = 0.78;

const NOT_NAMES = new Set([
  'i', 'a', 'an', 'the', 'user', 'he', 'she', 'they', 'we', 'it', 'his', 'her', 'their', 'my', 'our', 'on', 'in', 'at', 'to', 'for', 'and',
  'today', 'tomorrow', 'tonight', 'every', 'each', 'next', 'this',
]);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/;

/** A word as compared: lower case, without "'s"; months shortened (Oct = October). */
function token(w: string): string {
  const t = w.toLowerCase().replace(/['’]s$/, '');
  const month = t.length >= 3 ? MONTHS.find((m) => m.startsWith(t)) : undefined;
  return month ? month.slice(0, 3) : /^\d+$/.test(t) ? String(Number(t)) : t;
}

/** Every word and number of a fact, as compared. */
function words(text: string): Set<string> {
  return new Set([...text.matchAll(/[\p{L}'’-]+|\d+/gu)].map((m) => token(m[0])));
}

/**
 * The people, places, numbers and dates a fact names: "Luca is going to Bath on 24 October" → luca,
 * bath, 24, oct. A weekday counts unless there's a full date (then "Friday 24 October" = "24 October").
 */
export function anchors(text: string): Set<string> {
  const out = new Set<string>();
  const hasDate = /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\d{4}-\d{2}-\d{2}/i.test(text);
  for (const m of text.matchAll(/\d+/g)) out.add(token(m[0]));
  for (const m of text.matchAll(/[\p{L}'’-]+/gu)) {
    const w = m[0];
    const t = token(w);
    if (MONTHS.some((x) => x.slice(0, 3) === t)) out.add(t);
    else if (WEEKDAYS.test(t)) {
      if (!hasDate) out.add(t);
    } else if (/^\p{Lu}/u.test(w) && !NOT_NAMES.has(t)) out.add(t);
  }
  return out;
}

/** The same fact? `similarity`: how alike they mean (cosine of their embeddings, 0–1). */
export function isSameFact(a: string, b: string, similarity: number): boolean {
  if (similarity >= SAME_FACT) return true;
  if (similarity < SAME_FACT_ANCHORED) return false;
  // each names nothing the other doesn't mention (people, places, numbers, dates)
  const wa = words(a);
  const wb = words(b);
  const ax = anchors(a);
  const bx = anchors(b);
  return ax.size + bx.size > 0 && [...ax].every((x) => wb.has(x)) && [...bx].every((x) => wa.has(x));
}
