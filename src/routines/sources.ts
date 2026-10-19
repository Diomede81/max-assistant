import { blocks, inner, removeBlocks, splitBlock, stripTags } from '../text/markup';

/**
 * Collecting headlines from a website for the news briefing, cheapest way first:
 *  1. the site's news feed (RSS or Atom): free, clean titles, dates and summaries;
 *  2. the headlines linked from the page itself (plain download);
 *  3. Firecrawl (handled by the caller) for sites that only show content to a real browser.
 */

import { fetchPublic } from '../net/public-url';

export interface Candidate {
  title: string;
  url: string;
  source: string;
  snippet?: string;
  /** ISO date when known. */
  date?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MaxAssistant';
const MAX_PER_SOURCE = 30;
/** A page or feed is read up to this size, as it downloads (a huge or endless answer is cut off). */
const MAX_PAGE_BYTES = 1_500_000;

export function normaliseUrl(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes('.') ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

async function download(url: string): Promise<{ type: string; body: string; url: string }> {
  // Links come from websites and feeds: only public addresses, redirects checked too (never the home network).
  const res = await fetchPublic(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return { type: res.headers.get('content-type') ?? '', body: await readCapped(res, MAX_PAGE_BYTES), url: res.url || url };
}

// Only the start of the page is looked at (the pattern repeats over comments: bounded, it can't run long).
const isFeed = (type: string, body: string) => /xml|rss|atom/i.test(type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 4000));

/** Feed first, then the page's own headline links. `minFromPage`: fewer than this from the page counts as failure. */
export async function headlinesFrom(url: string, minFromPage = 6, guessFeeds = false): Promise<{ items: Candidate[]; via: 'feed' | 'page'; feedUrl?: string; title?: string } | undefined> {
  const page = await download(url);
  const source = host(page.url);
  if (isFeed(page.type, page.body)) return { items: parseFeed(page.body, source), via: 'feed', feedUrl: page.url, title: text(tag(page.body, 'title')) || undefined };
  const title = text(tag(page.body, 'title')).slice(0, 80) || undefined;
  // The feeds the page announces, then (when checking a suggestion) the usual feed addresses.
  const guesses = guessFeeds ? ['/feed', '/rss', '/feed.xml', '/rss.xml', '/index.xml'].map((p) => new URL(p, page.url).toString()) : [];
  for (const feedUrl of [...feedLinks(page.body, page.url).slice(0, 2), ...guesses]) {
    try {
      const feed = await download(feedUrl);
      const items = isFeed(feed.type, feed.body) ? parseFeed(feed.body, source) : [];
      if (items.length) return { items, via: 'feed', feedUrl: feed.url || feedUrl, title };
    } catch {
      // try the next feed, then the page
    }
  }
  const items = linksFromHtml(page.body, page.url, source);
  return items.length >= minFromPage ? { items, via: 'page', title } : undefined;
}

/** <link rel="alternate" type="application/rss+xml" href="..."> in a page. */
export function feedLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]{0,1000}>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) {
      try {
        out.push(new URL(decode(href), base).toString());
      } catch {
        // ignore
      }
    }
  }
  return out;
}

export function parseFeed(xml: string, source: string): Candidate[] {
  const items: Candidate[] = [];
  for (const b of blocks(xml, ['item', 'entry'], MAX_PER_SOURCE * 3)) {
    const title = text(tag(b, 'title'));
    // Atom: <link rel="alternate" href="...">, looked for in the link tags themselves (bounded, not across the item).
    const linkTags = b.match(/<link\b[^>]{0,500}>/gi) ?? [];
    const attr = (t: string | undefined) => (t ? /href=["']([^"']+)["']/i.exec(t)?.[1] : undefined);
    const link = text(tag(b, 'link')) || attr(linkTags.find((t) => /rel=["']alternate["']/i.test(t))) || attr(linkTags[0]) || text(tag(b, 'guid'));
    if (!title || !/^https?:\/\//.test(link ?? '')) continue;
    const when = text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const parsed = when ? Date.parse(when) : NaN;
    items.push({
      title: title.slice(0, 200),
      url: decode(link!),
      source,
      snippet: text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 300) || undefined,
      date: Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString(),
    });
    if (items.length >= MAX_PER_SOURCE) break;
  }
  return items;
}

/** Headline-looking links on the same site: 4+ words of link text, not navigation. */
export function linksFromHtml(html: string, base: string, source: string): Candidate[] {
  const baseHost = host(base);
  const seen = new Set<string>();
  const items: Candidate[] = [];
  const body = removeBlocks(html, ['script', 'style', 'nav', 'footer', 'header']);
  for (const a of blocks(body, ['a'], 2000)) {
    const { open, body: inside } = splitBlock(a);
    const href = /href=["']([^"'#]+)["']/i.exec(open)?.[1];
    if (!href) continue;
    const title = text(inside);
    if (title.split(' ').length < 4 || title.length > 200) continue;
    let url: string;
    try {
      url = new URL(decode(href), base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(url) || !host(url).endsWith(baseHost.split('.').slice(-2).join('.')) || url === base || seen.has(url)) continue;
    // Article pages have a path with some depth or a long slug, not "/sport" or "/about".
    const path = new URL(url).pathname;
    if (path.split('/').filter(Boolean).length < 2 && path.length < 25) continue;
    seen.add(url);
    items.push({ title, url, source });
    if (items.length >= MAX_PER_SOURCE) break;
  }
  return items;
}

/** Headline links from Firecrawl's markdown of a page: [Title](url). */
export function linksFromMarkdown(md: string, base: string, source: string): Candidate[] {
  const baseHost = host(base).split('.').slice(-2).join('.');
  const seen = new Set<string>();
  const items: Candidate[] = [];
  for (const m of md.matchAll(/\[([^\]]{20,200})\]\((https?:\/\/[^)\s]+)/g)) {
    const title = m[1].replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim();
    const url = m[2];
    if (title.split(' ').length < 4 || !host(url).endsWith(baseHost) || seen.has(url) || /!\[/.test(m[0])) continue;
    seen.add(url);
    items.push({ title, url, source });
    if (items.length >= MAX_PER_SOURCE) break;
  }
  return items;
}

/** The readable text of an article page, without Firecrawl (rough: paragraphs only). */
export async function articleText(url: string): Promise<string> {
  const page = await download(url);
  const paras = blocks(removeBlocks(page.body, ['script', 'style']), ['p'], 400)
    .map((p) => text(splitBlock(p).body))
    .filter((p) => p.split(' ').length > 8);
  return paras.join('\n').slice(0, 6000);
}

function tag(xml: string, name: string): string {
  return inner(xml, name);
}

/** Markup -> plain text: CDATA, tags and entities removed, spaces tidied. */
function text(s: string): string {
  return decode(
    // CDATA markers dropped (keeping what's inside), then tags.
    stripTags(s.split('<![CDATA[').join('').split(']]>').join('')),
  )
    .replace(/<[^>]{0,300}>/g, ' ') // tags that were entity-encoded inside CDATA
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&#(\d{1,7});/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/g, (_, e) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' })[e as string] ?? '',
    );
}

/** A character from its number; nothing for numbers that aren't one (e.g. &#99999999;). */
const codePoint = (n: number) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/** The response's text, reading at most `max` bytes (stops the download there). */
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(parts).subarray(0, max).toString('utf8');
}
