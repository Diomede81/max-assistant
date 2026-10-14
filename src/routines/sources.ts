/**
 * Collecting headlines from a website for the news briefing, cheapest way first:
 *  1. the site's news feed (RSS or Atom): free, clean titles, dates and summaries;
 *  2. the headlines linked from the page itself (plain download);
 *  3. Firecrawl (handled by the caller) for sites that only show content to a real browser.
 */

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
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return { type: res.headers.get('content-type') ?? '', body: (await res.text()).slice(0, 3_000_000), url: res.url || url };
}

const isFeed = (type: string, body: string) => /xml|rss|atom/i.test(type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(body);

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
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
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
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items: Candidate[] = [];
  for (const b of blocks) {
    const title = text(tag(b, 'title'));
    const link = text(tag(b, 'link')) || /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b)?.[1] || /<link\b[^>]*href=["']([^"']+)["']/i.exec(b)?.[1] || text(tag(b, 'guid'));
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
  const body = html.replace(/<(script|style|nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = text(m[2]);
    if (title.split(' ').length < 4 || title.length > 200) continue;
    let url: string;
    try {
      url = new URL(decode(m[1]), base).toString();
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
  const paras = [...page.body.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => text(m[1]))
    .filter((p) => p.split(' ').length > 8);
  return paras.join('\n').slice(0, 6000);
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
  return m ? m[1] : '';
}

/** Markup -> plain text: CDATA, tags and entities removed, spaces tidied. */
function text(s: string): string {
  return decode(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/<[^>]+>/g, ' ') // tags that were entity-encoded inside CDATA
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/g, (_, e) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' })[e as string] ?? '',
    );
}
