export interface MailItem {
  id: string;
  subject: string;
  from: string;
  /** When it arrived (epoch ms), if the app says. */
  at?: number;
  snippet?: string;
}

const ID = ['messageId', 'message_id', 'id', 'internetMessageId'];
const FROM = ['sender', 'from', 'fromAddress', 'from_address'];
const AT = ['messageTimestamp', 'receivedDateTime', 'received_date_time', 'internalDate', 'date', 'sentDateTime'];
const SNIPPET = ['preview', 'bodyPreview', 'snippet', 'messageText'];

/**
 * Emails from an email app's answer (Gmail, Outlook...), whatever its exact shape: any object
 * with a subject and an id. Used for the "important email" card on the screen.
 */
export function extractEmails(answer: string): MailItem[] {
  let data: unknown;
  try {
    data = JSON.parse(answer);
  } catch {
    return [];
  }
  const out: MailItem[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const subject = typeof o.subject === 'string' ? o.subject.trim() : '';
    const id = ID.map((k) => o[k]).find((x) => typeof x === 'string' && x) as string | undefined;
    if (subject && id) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, subject: subject.slice(0, 160), from: sender(FROM.map((k) => o[k]).find(Boolean)), at: time(AT.map((k) => o[k]).find(Boolean)), snippet: snippet(o) });
      }
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(data, 0);
  return out;
}

/** "Anna Rossi <anna@x.com>", {emailAddress: {name, address}} -> "Anna Rossi". */
function sender(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const e = (o.emailAddress ?? o) as Record<string, unknown>;
    return String(e.name || e.address || '').trim().slice(0, 80);
  }
  if (typeof v !== 'string') return '';
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(v);
  return (m ? m[1] || m[2] : v).trim().slice(0, 80);
}

function time(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  if (/^\d{12,}$/.test(v)) return Number(v); // Gmail internalDate (ms)
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

function snippet(o: Record<string, unknown>): string | undefined {
  const raw = SNIPPET.map((k) => o[k]).find((x) => typeof x === 'string' && x.trim()) as string | undefined;
  if (!raw) return undefined;
  const t = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 240) : undefined;
}
