import type { Candidate } from './sources';

/**
 * Telling news from noise, without the AI model: what's clearly not an article (coupons,
 * deals, sponsored posts, company pages, navigation) and how well a headline matches the
 * user's interests. Used to clean the headlines before the AI model sees them, and as the
 * fallback when the AI model can't answer.
 */

const JUNK_TITLE =
  /\b(coupons?|promo(tion)? codes?|discount codes?|voucher( codes?)?|deals? of the|best deals|% off|\d+% discount|sponsored|partner content|advertorial|paid post|sign up|subscribe( now)?|newsletter|log ?in|cookie|privacy|terms (of|and) |contact us|about us|careers?|jobs at|we'?re hiring|our (team|portfolio|investments|companies|story)|portfolio companies|book a demo|free trial|download (the|our) app|shop now|buy now|gift guide|horoscope|crossword|wordle|quiz)\b/i;

const JUNK_PATH =
  /\/(coupons?|vouchers?|deals?|promo(tions)?|discount|offers?|shop|store|tags?|category|categories|topics?|author|authors|about|careers|jobs|team|people|portfolio|companies|investments|contact|privacy|terms|cookies|subscribe|subscription|newsletter|login|signin|signup|register|account|search|advertise|sponsor(ed)?|partners?|events?|podcasts?|video|videos|gallery|live)(\/|$|\?)/i;

const STOP = new Set(
  'the and for with from that this news latest about into over under more most local world update updates what when where how why who new your our their its are was were has have had will can'.split(' '),
);

/** Not an article: a coupon, a deal, a sponsored post, a company or navigation page. */
export function isJunk(c: Pick<Candidate, 'title' | 'url'>): boolean {
  if (JUNK_TITLE.test(c.title)) return true;
  try {
    const path = new URL(c.url).pathname;
    if (path === '/' || JUNK_PATH.test(path)) return true;
  } catch {
    return true;
  }
  return false;
}

/** The user's interests as topics, each with its key words: "Formula 1, AI start-ups" -> [["formula","1"], ["ai","start","ups"]]. */
export function topicsOf(interests: string): { topic: string; words: string[] }[] {
  return interests
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .map((topic) => ({
      topic,
      words: topic
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w && (w.length > 2 || /\d/.test(w) || /^(ai|uk|us|eu|f1|vc)$/.test(w)) && !STOP.has(w)),
    }))
    .filter((t) => t.words.length);
}

/** How well a headline matches the interests: whole topic phrase = 3, each key word = 1 (best topic counts). */
export function keywordScore(c: Pick<Candidate, 'title' | 'snippet'>, topics: { topic: string; words: string[] }[]): { score: number; topic?: string } {
  const text = ` ${`${c.title} ${c.snippet ?? ''}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  let best = { score: 0, topic: undefined as string | undefined };
  for (const t of topics) {
    const phrase = ` ${t.words.join(' ')} `;
    const hits = t.words.filter((w) => text.includes(` ${w} `) || (w.length > 4 && text.includes(` ${w}`))).length;
    // Most of a multi-word topic must be there ("ai start ups" needs more than "ai").
    const enough = t.words.length === 1 ? hits === 1 : hits >= Math.ceil(t.words.length * 0.6);
    const score = text.includes(phrase) ? 3 + hits : enough ? hits : 0;
    if (score > best.score) best = { score, topic: t.topic };
  }
  return best;
}

/**
 * JSON from an AI model's reply, as forgiving as possible: code fences, text around it, and a
 * reply cut off half-way (the complete items before the cut are kept).
 */
export function looseJson(text: string): Record<string, unknown> | undefined {
  const t = text.replace(/```(json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return undefined;
  const body = t.slice(start);
  try {
    return JSON.parse(body.slice(0, body.lastIndexOf('}') + 1)) as Record<string, unknown>;
  } catch {
    // Cut off: keep the complete {...} items of the first list.
    const key = /"(\w+)"\s*:\s*\[/.exec(body);
    if (!key) return undefined;
    const items: unknown[] = [];
    for (const m of body.slice(key.index).matchAll(/\{[^{}]*\}/g)) {
      try {
        items.push(JSON.parse(m[0]));
      } catch {
        // skip a broken item
      }
    }
    return items.length ? { [key[1]]: items } : undefined;
  }
}
