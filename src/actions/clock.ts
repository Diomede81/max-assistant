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
