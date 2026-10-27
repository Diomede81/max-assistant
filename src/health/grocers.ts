/**
 * Online supermarkets for the shopping list: a search link for each item, and (with Firecrawl) the
 * products found, so choosing what to buy is one tap each. Max never logs in or fills a basket:
 * supermarkets offer no way to do that for you, so the choice and the basket stay yours.
 */

export interface Grocer {
  name: string;
  /** The supermarket's own search page for some words. */
  search: (q: string) => string;
  /** How its product pages' addresses look (to find products in a search page). */
  product: RegExp;
}

const enc = encodeURIComponent;

export const GROCERS: Record<string, Grocer> = {
  tesco: { name: 'Tesco', search: (q) => `https://www.tesco.com/groceries/en-GB/search?query=${enc(q)}`, product: /^https:\/\/www\.tesco\.com\/groceries\/en-GB\/products\/\d+/ },
  sainsburys: { name: "Sainsbury's", search: (q) => `https://www.sainsburys.co.uk/gol-ui/SearchResults/${enc(q)}`, product: /^https:\/\/www\.sainsburys\.co\.uk\/gol-ui\/product\/[\w-]+/ },
  asda: { name: 'Asda', search: (q) => `https://www.asda.com/groceries/search/${enc(q)}`, product: /^https:\/\/www\.asda\.com\/groceries\/product\/[\w-]+\/\d+/ },
  morrisons: { name: 'Morrisons', search: (q) => `https://groceries.morrisons.com/search?q=${enc(q)}`, product: /^https:\/\/groceries\.morrisons\.com\/products\/[\w-]+/ },
  waitrose: { name: 'Waitrose', search: (q) => `https://www.waitrose.com/ecom/shop/search?searchTerm=${enc(q)}`, product: /^https:\/\/www\.waitrose\.com\/ecom\/products\/[\w-]+\/[\w-]+/ },
  ocado: { name: 'Ocado', search: (q) => `https://www.ocado.com/search?entry=${enc(q)}`, product: /^https:\/\/www\.ocado\.com\/products\/[\w-]+/ },
  iceland: { name: 'Iceland', search: (q) => `https://www.iceland.co.uk/search?q=${enc(q)}`, product: /^https:\/\/www\.iceland\.co\.uk\/p\/[\w-]+/ },
  amazon: { name: 'Amazon Fresh', search: (q) => `https://www.amazon.co.uk/s?k=${enc(q)}&i=amazonfresh`, product: /^https:\/\/www\.amazon\.co\.uk\/(?:[\w-]+\/)?dp\/[A-Z0-9]{10}/ },
};
export type GrocerId = keyof typeof GROCERS;

/** A product found for an item. */
export interface Product {
  title: string;
  url: string;
  /** "£1.25" when the page showed it. */
  price?: string;
}

const UNITS = '(?:g|kg|grams?|ml|l|litres?|liters?|cl|oz|lb|tbsp|tsp|teaspoons?|tablespoons?|cups?|pinch(?:es)?|handfuls?|bunch(?:es)?|cloves?|tins?|cans?|packs?|packets?|jars?|bags?|pots?|bottles?|cartons?|sprigs?|slices?|pieces?|heads?|stalks?|sticks?|knobs?|of)';

/** The words to search for: "2 × 280 g firm tofu" → "firm tofu", "1 tin (400 g) chopped tomatoes" → "chopped tomatoes". */
export function searchWords(item: string): string {
  let t = item
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // "(400 g)", "(optional)"
    .replace(/,.*$/, '') // "onions, finely chopped"
    .replace(/\b(about|approx\.?|roughly|around|large|small|medium|fresh|ripe|good|a few|few|some|optional|to serve|to taste)\b/g, ' ');
  // quantities and units at the start, repeatedly ("1 x 400 g tin of")
  const lead = new RegExp(`^\\s*(?:[\\d½¼¾⅓⅔.,/\\-–]+\\s*|[x×]\\s*|${UNITS}\\b\\s*|a\\s+|an\\s+)+`, 'i');
  for (let i = 0; i < 4; i++) t = t.replace(lead, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.split(' ').slice(0, 5).join(' ') || item.trim();
}

/**
 * The products on a supermarket's search page (as markdown, links kept): each product link once, its
 * name, and the first price shown after it. At most `max`.
 */
export function productsFrom(markdown: string, grocer: Grocer, max = 4): Product[] {
  const out: Product[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(/\[([^\]]{3,200})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = m[2].split(/[?#]/)[0];
    const title = m[1].replace(/!\[[^\]]*\]/g, '').replace(/[*_#]/g, '').replace(/\s+/g, ' ').trim();
    if (!grocer.product.test(url) || seen.has(url) || !title || /^(add|view|more|image|rest of|shop|see)\b/i.test(title)) continue;
    seen.add(url);
    const after = markdown.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 400);
    const price = /£\s?\d+(?:\.\d{2})?|\b\d{1,3}p\b/.exec(after)?.[0].replace(/\s/g, '');
    out.push({ title: title.slice(0, 140), url, price });
    if (out.length >= max) break;
  }
  return out;
}

/** "£1.85" → 185, "85p" → 85 (pence), undefined if not a price. */
export function pence(price?: string): number | undefined {
  if (!price) return undefined;
  const pounds = /£\s?(\d+(?:\.\d{1,2})?)/.exec(price);
  if (pounds) return Math.round(parseFloat(pounds[1]) * 100);
  const p = /(\d{1,3})\s?p\b/.exec(price);
  return p ? parseInt(p[1], 10) : undefined;
}

/** 185 → "£1.85". */
export function money(p: number): string {
  return `£${(p / 100).toFixed(2)}`;
}

/**
 * How many to buy, from the list's wording: "4 tins chickpeas" → 4, "2 × 280 g firm tofu" → 2. Loose
 * things ("2 red onions", "500 g rice") → 1 (one pack or bag): change it on the list if needed.
 */
export function packsNeeded(item: string): number {
  const t = item.toLowerCase().trim();
  // "2 × 280 g", "3 x 400g", "4 tins": the count; (× isn't a letter, so the word's end is a space or a digit)
  const m = /^(\d{1,2})\s*(?:[x×](?=\s|\d)|(?:tins?|cans?|packs?|packets?|jars?|bottles?|cartons?|bags?|pots?|boxes|tubs?|loaves|blocks?)\b)/.exec(t);
  return m ? Math.max(1, Math.min(20, parseInt(m[1], 10))) : 1;
}
