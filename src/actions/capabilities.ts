import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { SCREEN_RULE } from './screen-tools.service';

/** Plain-English names for common Composio apps (tool names start with the app's slug). */
const APPS: Record<string, string> = {
  OUTLOOK: 'Office 365 / Outlook: read, search and send email, and see and manage the calendar',
  GMAIL: 'Gmail: read, search and send email',
  GOOGLECALENDAR: 'Google Calendar: see and manage events',
  FIRECRAWL: 'the internet: search the web and read any web page (news, prices, opening hours, facts)',
  TAVILY: 'the internet: search the web',
  EXA: 'the internet: search the web',
  SERPAPI: 'the internet: search the web',
  WHATSAPP: 'WhatsApp: send and read messages',
  LINKEDIN: 'LinkedIn: profile and posts',
  INSTAGRAM: 'Instagram: direct messages',
  SLACK: 'Slack: read and send messages',
  NOTION: 'Notion: pages and notes',
  GOOGLEDRIVE: 'Google Drive: files',
  ONE_DRIVE: 'OneDrive: files',
  TODOIST: 'Todoist: tasks',
};

const BUILTIN = new Set(['get_current_datetime', 'end_conversation', 'set_timer', 'set_reminder', 'list_timers', 'cancel_timer', 'remember', 'forget', 'recall']);

/**
 * A short briefing of what Max can reach right now, built from the actions actually
 * offered. Without it, AI models fall back on their default "I can't access your email /
 * browse the internet", even when the tools are right there.
 */
export function describeCapabilities(tools: ChatCompletionTool[]): string {
  const names = tools.filter((t) => t.type === 'function').map((t) => t.function.name);
  const apps = new Map<string, string>();
  for (const n of names) {
    if (BUILTIN.has(n) || !/^[A-Z0-9_]+$/.test(n)) continue; // Composio actions are UPPER_CASE
    const slug = Object.keys(APPS).find((s) => n.startsWith(`${s}_`)) ?? n.split('_')[0];
    apps.set(slug, APPS[slug] ?? `${slug.charAt(0)}${slug.slice(1).toLowerCase()}`);
  }
  // Built-in web search (Firecrawl, no Composio).
  if (names.includes('web_search')) apps.set('WEB', 'the internet: search the web and news, and read any web page');
  if (names.includes('train_departures') || names.includes('plan_train_journey')) {
    apps.set('TRAINS', `UK trains: ${[names.includes('train_departures') && 'live departures, delays and platforms', names.includes('plan_train_journey') && 'journey planning with a QR code to book on Trainline'].filter(Boolean).join('; ')}`);
  }
  // Train times only ever come from the train actions: the model's own idea of a timetable is wrong.
  const trains = names.includes('train_departures') || names.includes('plan_train_journey')
    ? 'Train times, platforms, journey lengths and delays: ONLY from the train actions, called for each question, and said exactly as they return them; never from memory or guesswork.'
    : 'You have no train data: if asked for train times, say they can be set up on the control panel (Trains), and never guess times.';
  const screen = names.includes('show_on_screen') ? SCREEN_RULE : '';
  if (!apps.size) return [screen, trains].filter(Boolean).join('\n');
  return (
    (screen ? `${screen}\n` : '') +
    `${trains}\n` +
    `Live connections you have RIGHT NOW through your tools: ${[...apps.values()].join('; ')}. ` +
    'You DO have access to these: when the user asks about any of them, call the matching tool straight away ' +
    'instead of saying you cannot. Never claim you have no access to email, calendar or the internet while ' +
    'they are listed here. If a tool returns an error, say briefly what went wrong.'
  );
}
