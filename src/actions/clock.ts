/** Time helpers in the household's time zone (TZ in .env, e.g. Europe/London). */
export function timeZone(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** e.g. "Sunday 11 October 2026, 14:32 (Europe/London)" */
export function describeNow(now = new Date()): string {
  const tz = timeZone();
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now);
  return `${date}, ${time} (${tz})`;
}

/** e.g. 3725 -> "1 hour, 2 minutes and 5 seconds" */
export function spokenDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const parts: string[] = [];
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (sec || !parts.length) parts.push(`${sec} second${sec === 1 ? '' : 's'}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

/** How far the time zone is ahead of UTC (ms) at a given moment. */
function offsetMs(at: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
}

/** "2026-10-16T09:00" (or "2026-10-16 09:00", or just a date = 09:00) in the household's time zone -> epoch ms. */
export function parseLocal(s: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s.trim());
  if (!m) return undefined;
  const tz = timeZone();
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
  if (Number.isNaN(wall)) return undefined;
  // Twice, so the answer is right on the days the clocks change.
  let t = wall - offsetMs(wall, tz);
  t = wall - offsetMs(t, tz);
  return t;
}

/** e.g. "today at 18:30", "tomorrow at 09:00", "on Friday 16 October at 09:00" */
export function spokenWhen(at: number, now = Date.now()): string {
  const tz = timeZone();
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  if (day(at) === day(now)) return `today at ${time}`;
  if (day(at) === day(now + 86_400_000)) return `tomorrow at ${time}`;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
  return `on ${date} at ${time}`;
}
