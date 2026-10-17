/**
 * HTML and XML helpers that take time in proportion to the text's length, whatever it contains.
 *
 * Regexes with open-ended spans (`<item[\s\S]*?</item>`, `<[^>]+>`) restart their scan at every
 * possible start: on crafted input (an email full of "<a" that never closes, a feed with thousands of
 * unclosed <item>) that's quadratic, and Max froze for seconds to minutes. These scan forward once.
 */

/** Tags removed, each replaced by `sep`. Text after a "<" that never closes is kept as it is. */
export function stripTags(s: string, sep = ' '): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) break; // no tag can close after this: the rest is text
    out += s.slice(i, lt) + sep;
    i = gt + 1;
  }
  return out + s.slice(i);
}

/** Whether the text has any HTML tag (e.g. <p>, </div>, <br/>). */
export const hasTags = (s: string) => /<\/?[a-z][a-z0-9]*[\s/>]/i.test(s) && s.includes('>');

/**
 * Each <name ...>...</name> block, in order (any of `names`, case-insensitive). An unclosed one ends
 * the search (nothing after it can be a complete block of that kind).
 */
export function blocks(s: string, names: string[], max = Infinity): string[] {
  const out: string[] = [];
  forEachBlock(s, names, (start, end) => {
    out.push(s.slice(start, end));
    return out.length < max;
  });
  return out;
}

/** The text with every <name>...</name> block removed (an unclosed one: to the end). */
export function removeBlocks(s: string, names: string[], sep = ' '): string {
  let out = '';
  let i = 0;
  const done = forEachBlock(s, names, (start, end) => {
    out += s.slice(i, start) + sep;
    i = end;
    return true;
  });
  if (done.unclosedAt !== undefined) return out + s.slice(i, done.unclosedAt) + sep;
  return out + s.slice(i);
}

/** The inside of the first <name ...>...</name> (empty if there's none). */
export function inner(s: string, name: string): string {
  const open = new RegExp(`<${escape(name)}(?=[\\s>/])`, 'i').exec(s);
  if (!open) return '';
  const gt = s.indexOf('>', open.index);
  if (gt < 0) return '';
  const close = s.toLowerCase().indexOf(`</${name.toLowerCase()}`, gt);
  return close < 0 ? '' : s.slice(gt + 1, close);
}

/** The opening tag of a block ("<a href=...>"), and what's between it and its closing tag. */
export function splitBlock(block: string): { open: string; body: string } {
  const gt = block.indexOf('>');
  const close = block.lastIndexOf('</');
  return { open: block.slice(0, gt + 1), body: gt < 0 || close <= gt ? '' : block.slice(gt + 1, close) };
}

function forEachBlock(s: string, names: string[], each: (start: number, end: number) => boolean): { unclosedAt?: number } {
  const open = new RegExp(`<(${names.map(escape).join('|')})(?=[\\s>/])`, 'gi');
  const lower = s.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = open.exec(s))) {
    const close = lower.indexOf(`</${m[1].toLowerCase()}`, m.index + m[0].length);
    const end = close < 0 ? -1 : lower.indexOf('>', close);
    if (end < 0) return { unclosedAt: m.index };
    if (!each(m.index, end + 1)) return {};
    open.lastIndex = end + 1;
  }
  return {};
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
