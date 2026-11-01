/**
 * Shared pieces of the control panel's look: help that stays out of the way until asked for.
 *
 * Cards explain themselves in a line; the rest sits behind "Details". `help()` builds that by hand;
 * `foldHelp()` applies it to a rendered page, so every long explanation on every card folds the same way
 * without each page being rewritten.
 */

/** Characters of explanation a card shows before the rest folds behind "Details". */
const KEEP_CHARS = 110;
/** Paragraphs shorter than this stay as they are. */
const FOLD_FROM_CHARS = 230;

/** A one-line lead with the rest behind a "Details" link. `lead` and `rest` are HTML already escaped. */
export function help(lead: string, rest: string, label = 'Details'): string {
  return `<p class="meta">${lead}</p><details class="help"><summary>${label}</summary><p class="meta">${rest}</p></details>`;
}

/**
 * Folds every long `<p class="meta">…</p>` on a rendered page: the first sentence or two stay, the rest
 * goes behind "Details". Splits only at a sentence end outside any tag, so links and emphasis stay whole.
 */
export function foldHelp(html: string): string {
  return html.replace(/<p class="meta">([\s\S]*?)<\/p>/g, (whole, inner: string) => {
    if (textLength(inner) < FOLD_FROM_CHARS) return whole;
    const at = splitPoint(inner);
    if (at < 0) return whole;
    const lead = inner.slice(0, at).trim();
    const rest = inner.slice(at).trim();
    if (!rest || textLength(rest) < 60) return whole;
    return `<p class="meta">${lead}</p><details class="help"><summary>Details</summary><p class="meta">${rest}</p></details>`;
  });
}

function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').length;
}

/** The end of the first sentence past KEEP_CHARS of text that is not inside a tag or a link. */
function splitPoint(html: string): number {
  let text = 0;
  let inTag = false;
  let linkDepth = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (inTag) {
      if (c === '>') inTag = false;
      continue;
    }
    if (c === '<') {
      inTag = true;
      if (html.startsWith('<a ', i) || html.startsWith('<a>', i)) linkDepth++;
      else if (html.startsWith('</a>', i)) linkDepth = Math.max(0, linkDepth - 1);
      continue;
    }
    text++;
    // a sentence ends: ". " / "! " / "? " (not a decimal point or an abbreviation like "e.g."), outside a link
    if (text >= KEEP_CHARS && linkDepth === 0 && /[.!?]/.test(c) && html[i + 1] === ' ' && !/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Dr|St)$/.test(html.slice(Math.max(0, i - 4), i + 1).replace(/<[^>]+>/g, ''))) {
      // not a sentence end when the next word starts with a lower-case letter ("docs/PI.md says")
      const next = html.slice(i + 2, i + 3);
      if (next && next === next.toLowerCase() && /[a-z]/.test(next)) continue;
      return i + 1;
    }
  }
  return -1;
}
