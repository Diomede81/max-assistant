import { timeZone } from '../actions/clock';
import { dueEpoch } from '../memory/projects.service';
import type { CardLine } from './screen';

export interface CalEvent {
  title: string;
  start: number;
  end?: number;
  allDay: boolean;
  location?: string;
}

const TITLE = ['subject', 'summary', 'title', 'name'];
const START = ['start', 'startTime', 'start_time', 'startDateTime', 'start_datetime'];
const END = ['end', 'endTime', 'end_time', 'endDateTime', 'end_datetime'];

/**
 * Calendar events from a calendar app's answer (Outlook, Google Calendar...), whatever its
 * exact shape: any object with a title and a start time. Used to show the events on screen
 * when Max reads the calendar.
 */
export function extractEvents(answer: string): CalEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(answer);
  } catch {
    return [];
  }
  const out: CalEvent[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const title = TITLE.map((k) => o[k]).find((x) => typeof x === 'string' && x.trim()) as string | undefined;
    const startRaw = START.map((k) => o[k]).find((x) => x !== undefined && x !== null);
    const start = startRaw === undefined ? undefined : when(startRaw);
    if (title && start) {
      const endRaw = END.map((k) => o[k]).find((x) => x !== undefined && x !== null);
      const allDay = o.isAllDay === true || isDateOnly(startRaw);
      const loc = o.location;
      const location = typeof loc === 'string' ? loc : loc && typeof loc === 'object' ? String((loc as Record<string, unknown>).displayName ?? '') : '';
      const key = `${title}|${start}`;
      if (!seen.has(key) && o.isCancelled !== true) {
        seen.add(key);
        out.push({ title: title.trim().slice(0, 120), start, end: endRaw === undefined ? undefined : when(endRaw), allDay, location: location || undefined });
      }
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(data, 0);
  return out.sort((a, b) => a.start - b.start).slice(0, 30);
}

function isDateOnly(v: unknown): boolean {
  const s = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as Record<string, unknown>).date ?? '') : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** "2026-10-14T08:30:00Z", "2026-10-14T08:30:00 (UTC)", {dateTime, timeZone}, {date} -> epoch ms. */
function when(v: unknown): number | undefined {
  let s: string;
  let tz = '';
  if (typeof v === 'string') {
    s = v;
  } else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    s = String(o.dateTime ?? o.date_time ?? o.date ?? '');
    tz = String(o.timeZone ?? o.time_zone ?? '');
  } else return undefined;
  const m = /^(.*?)\s*\(([^)]+)\)$/.exec(s.trim()); // "... (UTC)" from the tidied answer
  if (m) {
    s = m[1];
    tz = m[2];
  }
  s = s.trim().replace(/(\.\d{3})\d+/, '$1');
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dueEpoch(s.slice(0, 10) + 'T00:00');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s) || undefined;
  // No offset: UTC if the app says so, otherwise the household's own time.
  if (!tz || /^(utc|etc\/utc|gmt|z)$/i.test(tz)) return Date.parse(s + 'Z') || undefined;
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s);
  return local ? dueEpoch(`${local[1]}T${local[2]}`) : undefined;
}

const hm = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(ms);

/** Card lines for events: "08:30" | "Daily stand-up" / "until 08:45 · Teams". Events of other days get their day. */
export function eventLines(events: CalEvent[], now = Date.now()): CardLine[] {
  const today = dayKey(now);
  return events.map((e) => {
    const otherDay = dayKey(e.start) !== today;
    const day = otherDay ? new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), weekday: 'short' }).format(e.start) + ' ' : '';
    const past = e.end ? e.end < now : false;
    return {
      time: e.allDay ? `${day}all day`.trim() : `${day}${hm(e.start)}`,
      text: e.title,
      sub: [e.end && !e.allDay ? `until ${hm(e.end)}` : '', e.location ?? ''].filter(Boolean).join(' · ') || undefined,
      tag: past ? 'done' : 'event',
    };
  });
}
