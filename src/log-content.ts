/**
 * Personal content in the logs: what was said, email and message text, memory facts, reminders. Off by
 * default, so the logs (kept by Docker in plain text) don't undo the memory's encryption: they say what
 * happened ("You: 12 words", "tool OUTLOOK_SEND_EMAIL {to, subject, body}") but not the words.
 * LOG_CONTENT=on in .env shows everything, for troubleshooting (then set it back).
 */
export const logContent = (): boolean => process.env.LOG_CONTENT === 'on';

/** Someone's words: quoted with LOG_CONTENT=on, otherwise just how many words. */
export function said(text: string): string {
  if (logContent()) return `"${text}"`;
  const n = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `(${n} word${n === 1 ? '' : 's'})`;
}

/** An action's details: in full with LOG_CONTENT=on, otherwise only their names. */
export function detail(args: Record<string, unknown>): string {
  return logContent() ? JSON.stringify(args) : `{${Object.keys(args).join(', ')}}`;
}
