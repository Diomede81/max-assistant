/**
 * Phone numbers and names for WhatsApp: the people Max may send messages to (the allowed list on the
 * control panel), and finding a chat or a person from what the user said ("Magda", "the family group").
 */

/** Someone Max may send WhatsApp messages to. */
export interface AllowedContact {
  name: string;
  /** International, digits only (447700900123). */
  number: string;
}

/**
 * A phone number as WhatsApp knows it: international, digits only. "+44 7700 900123", "0044…" and a
 * UK "07700 900123" all give 447700900123. Undefined when it can't be a phone number.
 */
export function normaliseNumber(input: string, defaultCountry = '44'): string | undefined {
  const t = input.trim();
  if (!/^[+\d][\d\s().-]*$/.test(t)) return undefined;
  let d = t.replace(/\D/g, '');
  if (t.startsWith('+')) {
    // already international
  } else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = defaultCountry + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : undefined;
}

/** "+44 7700 900123" for the control panel. */
export function showNumber(n: string): string {
  return n.startsWith('44') && n.length === 12 ? `+44 ${n.slice(2, 6)} ${n.slice(6)}` : `+${n}`;
}

const simplify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * How well a name matches what was said: 3 the same, 2 a whole word of it ("Magda" for "Magda Rossi"),
 * 1 the start of a word ("Mag"), 0 not at all. "My wife", "the family group": the words the user
 * gave the contact on the panel match the same way.
 */
export function nameScore(name: string, query: string): number {
  const n = simplify(name);
  const q = simplify(query).replace(/^(the|my) /, '').replace(/ (group|chat)$/, '');
  if (!q || !n) return 0;
  if (n === q) return 3;
  const words = n.split(' ');
  if (` ${n} `.includes(` ${q} `)) return 2;
  if (q.length >= 3 && words.some((w) => w.startsWith(q))) return 1;
  return 0;
}

/** The best match for what was said, if one stands out (two equally good: none, ask which). */
export function bestMatch<T>(items: T[], name: (t: T) => string, query: string): { match?: T; ambiguous: T[] } {
  let best = 0;
  let found: T[] = [];
  for (const it of items) {
    const s = nameScore(name(it), query);
    if (s > best) {
      best = s;
      found = [it];
    } else if (s && s === best) found.push(it);
  }
  return found.length === 1 ? { match: found[0], ambiguous: [] } : { ambiguous: found };
}
