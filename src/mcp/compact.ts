/**
 * Makes an app's answer (usually JSON from Microsoft Graph, Gmail...) small enough for the AI
 * without losing the content. A raw Outlook event is 3-8k characters (HTML invitation, attendee
 * records, Teams join details, ids), so a plain cut after a few thousand characters left the AI
 * with one event out of a whole day. Instead:
 *  1. drop technical fields nobody asks about (ids, etags, odata links, change keys...);
 *  2. turn HTML into plain text and tidy whitespace;
 *  3. when it is a list and still too long, shorten long texts in each item (bodies, previews)
 *     so every item survives, not just the first.
 * Only then, as a last resort, cut.
 */

const NOISE = new Set([
  'changekey', 'icaluid', 'transactionid', 'etag', 'seriesmasterid', 'originalstarttimezone', 'originalendtimezone',
  'allownewtimeproposals', 'hideattendees', 'isdraft', 'isreminderon', 'reminderminutesbeforestart', 'responserequested',
  'createddatetime', 'lastmodifieddatetime', 'occurrenceid', 'conversationid', 'conversationindex', 'internetmessageid',
  'parentfolderid', 'inferenceclassification', 'flag', 'categories', 'hasattachments', 'isreadreceiptrequested',
  'isdeliveryreceiptrequested', 'uniquebody', 'onlinemeetingprovider', 'onlinemeetingurl', 'isonlinemeeting',
  'allowedonlinemeetingproviders', 'defaultonlinemeetingprovider', 'cancelledoccurrences', 'exceptionoccurrences',
  'uniqueid', 'uniqueidtype', 'locationuri', 'locationtype', 'coordinates', 'sensitivity', 'importance',
  'thumbnail', 'thumbnailurl', 'logo', 'icon', 'favicon', 'headers', 'payload_headers', 'mimetype', 'sizeestimate',
  'historyid', 'labelids', 'threadid', 'raw', 'log_id', 'logid', 'requestid', 'request_id',
]);

/** Text fields worth keeping in full for a single item but shortened in long lists. */
/** Full texts that a short preview next to them already covers (dropped only as a last resort for long lists). */
const FULL_TEXT = /^(body|content|html|uniquebody)$/i;
const LONG_TEXT = /^(body|content|bodypreview|preview|snippet|description|text|html|notes|message)$/i;

export function compactResult(raw: string, limit: number): { text: string; compacted: boolean; truncated: boolean } {
  let text = raw;
  let compacted = false;
  const trimmed = raw.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && raw.length > 1500) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      let slim = clean(data, Infinity);
      text = JSON.stringify(slim);
      // Still too long and it is a list: shorten long texts per item, more and more, until it fits.
      // (0 = last resort: drop full bodies and keep only the short previews.)
      for (const cap of [800, 400, 200, 100, 0]) {
        if (text.length <= limit || !hasList(slim)) break;
        slim = clean(data, cap);
        text = JSON.stringify(slim);
      }
      compacted = text.length < raw.length;
    } catch {
      text = raw;
    }
  } else if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && /<(html|body|div|p|table)\b/i.test(raw)) {
    // A web page (not JSON: turning HTML into text inside JSON would break its structure).
    text = htmlToText(raw);
    compacted = true;
  }
  if (text.length <= limit) return { text, compacted, truncated: false };
  return { text: `${text.slice(0, limit)}\n…(cut: the result was too long; ask for a narrower range for the rest)`, compacted, truncated: true };
}

function clean(v: unknown, cap: number, key = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => clean(x, cap, key)).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (lk.startsWith('@odata') || lk.endsWith('@odata.type') || NOISE.has(lk)) continue;
      if (cap === 0 && FULL_TEXT.test(k)) continue;
      // Long opaque ids (Graph ids are ~150 characters) say nothing to the AI, except the item's own id;
      // nor do very long links (Outlook web links, Teams join links): they can't be said out loud.
      if (typeof x === 'string' && lk !== 'id' && lk.endsWith('id') && x.length > 60) continue;
      if (typeof x === 'string' && /^https?:\/\//.test(x) && x.length > 160) continue;
      const c = clean(x, cap, k);
      if (c === undefined || c === null || c === '' || (Array.isArray(c) && !c.length) || (isEmptyObject(c))) continue;
      out[k] = c;
    }
    return flattenSingle(out);
  }
  if (typeof v === 'string') {
    let s = /<\/?[a-z][\s\S]*>/i.test(v) ? htmlToText(v) : v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const max = cap === 0 ? 100 : cap;
    if (LONG_TEXT.test(key) && s.length > max) s = `${s.slice(0, max)}…`;
    return s;
  }
  return v;
}

/** {"content": "...", "contentType": "html"} -> "..." ; {"emailAddress": {"name": "Anna", "address": "a@x"}} -> "Anna <a@x>". */
function flattenSingle(o: Record<string, unknown>): unknown {
  const keys = Object.keys(o);
  if (keys.length <= 2 && 'content' in o && (keys.length === 1 || 'contentType' in o)) return o.content;
  if (keys.length === 1 && keys[0] === 'emailAddress') return o.emailAddress;
  if (keys.length <= 2 && typeof o.name === 'string' && typeof o.address === 'string') return `${o.name} <${o.address}>`;
  if (keys.length <= 2 && typeof o.dateTime === 'string') return o.timeZone ? `${o.dateTime.replace(/\.0+$/, '')} (${o.timeZone})` : o.dateTime;
  // An attendee: "Anna <a@x> (required, accepted)".
  if (typeof o.emailAddress === 'string' && keys.every((k) => ['emailAddress', 'type', 'status'].includes(k))) {
    const st = o.status as { response?: string } | undefined;
    const bits = [o.type, st?.response && st.response !== 'none' ? st.response : ''].filter(Boolean).join(', ');
    return bits ? `${o.emailAddress} (${bits})` : o.emailAddress;
  }
  // A response with an empty date ("0001-01-01"): just the response.
  if (keys.length <= 2 && typeof o.response === 'string' && (!o.time || String(o.time).startsWith('0001'))) return o.response;
  return o;
}

const isEmptyObject = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length;

function hasList(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 1 || v.some(hasList);
  if (v && typeof v === 'object') return Object.values(v).some(hasList);
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/_{5,}|-{5,}/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
