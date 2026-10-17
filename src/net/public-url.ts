import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Addresses that come from outside Max (a news feed's links, a radio directory's stream URLs) must
 * lead to the public internet: never to the home network (the router, Home Assistant, printers...),
 * the box itself, or link-local / cloud metadata addresses. Otherwise a crafted feed or station could
 * make the box send requests to devices at home.
 */

/** A private, loopback, link-local or otherwise non-public address (IPv4 or IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast/reserved
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local (and cloud metadata)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) // benchmarking
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]);
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true; // not an address at all: treat as unsafe
}

/** Whether the URL is http(s) and every address its name resolves to is public. */
export async function isPublicUrl(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return !isPrivateAddress(host);
  // Names only the home network knows (router.lan, homeassistant.local, printer): not public.
  if (!host.includes('.') || /\.(local|lan|home|internal|localdomain|home\.arpa|localhost)$/.test(host) || host === 'localhost') return false;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * fetch() for addresses from outside Max: refuses ones that aren't public, and follows redirects
 * itself (up to 5), checking each new address, so a public page can't bounce the box to the home network.
 */
export async function fetchPublic(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    if (!(await isPublicUrl(current))) throw new Error(`not a public web address: ${new URL(current).host || current}`);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      current = new URL(location, current).toString();
      continue;
    }
    // Keep the final address visible to the caller (res.url is read-only on a real Response).
    if (current !== url) Object.defineProperty(res, 'url', { value: current });
    return res;
  }
  throw new Error('too many redirects');
}
