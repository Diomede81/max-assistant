/**
 * A friendly description of what an action is doing, for the face ("📧 Checking your email…")
 * and, if it takes a moment, for Max to say. Instant actions (time, timers, modes) return
 * undefined: nothing to show.
 */
export interface Activity {
  icon: string;
  label: string;
}

const INSTANT = new Set([
  'get_current_datetime', 'set_timer', 'set_reminder', 'list_timers', 'cancel_timer', 'end_conversation', 'set_mode', 'music_control', 'device_power', 'device_settings', 'show_on_screen',
]);

const SENDING = /(SEND|REPLY|FORWARD|CREATE_DRAFT|DRAFT)/;
const CHANGING = /(CREATE|UPDATE|DELETE|CANCEL|ACCEPT|DECLINE|MOVE)/;

export function describeActivity(name: string): Activity | undefined {
  if (INSTANT.has(name)) return undefined;
  const n = name.toUpperCase();
  if (name === 'recall') return { icon: '🧠', label: 'Checking my memory' };
  if (name === 'remember' || name === 'forget') return { icon: '🧠', label: 'Updating my memory' };
  if (name === 'project') return { icon: '📁', label: 'Checking your projects' };
  if (name === 'todo' || name === 'task') return { icon: '✅', label: 'Updating your to-do list' };
  if (name === 'my_day') return { icon: '☀️', label: 'Looking at your day' };
  if (name === 'software_update') return { icon: '⬇️', label: 'Checking for updates' };
  if (name === 'news_briefing') return { icon: '📰', label: 'Getting your news' };
  if (name === 'news_settings') return { icon: '📰', label: 'Updating your news' };
  if (name === 'play_music') return { icon: '🎵', label: 'Finding the music' };
  if (name === 'web_search') return { icon: '🌐', label: 'Searching the web' };
  if (name === 'read_webpage') return { icon: '🌐', label: 'Reading the page' };
  if (n.startsWith('WHATSAPP_')) return { icon: '💬', label: SENDING.test(n) ? 'Sending the WhatsApp' : 'Checking WhatsApp' };
  if (/^(SLACK|MICROSOFT_TEAMS|TEAMS)_/.test(n)) return { icon: '💬', label: SENDING.test(n) ? 'Sending the message' : 'Checking your messages' };
  if (n.startsWith('LINKEDIN_')) return { icon: '💼', label: 'On LinkedIn' };
  if (n.startsWith('INSTAGRAM_')) return { icon: '📷', label: 'On Instagram' };
  if (/(EVENT|CALENDAR|SCHEDULE|MEETING|AVAILABILITY)/.test(n)) {
    return { icon: '📅', label: CHANGING.test(n) ? 'Updating your calendar' : 'Checking your calendar' };
  }
  if (/(MAIL|MESSAGE|INBOX|^GMAIL_|^OUTLOOK_)/.test(n)) {
    return { icon: '📧', label: SENDING.test(n) ? 'Sending the email' : 'Checking your email' };
  }
  if (/^(FIRECRAWL|TAVILY|EXA|SERPAPI|PERPLEXITY|BRAVE)/.test(n) || /(SEARCH|SCRAPE|CRAWL)/.test(n)) {
    return { icon: '🌐', label: 'Searching the web' };
  }
  if (/^(NOTION|GOOGLEDRIVE|ONE_DRIVE|GOOGLEDOCS|DROPBOX)_/.test(n)) return { icon: '📄', label: 'Looking at your documents' };
  if (/^(TODOIST|ASANA|TRELLO|JIRA)_/.test(n)) return { icon: '✅', label: 'Checking your tasks' };
  if (/^(HASS|GETLIVECONTEXT|GET_LIVE_CONTEXT)/.test(n) || /^Hass|^Get/.test(name)) return { icon: '🏠', label: 'Talking to your home' };
  return { icon: '⚙️', label: 'Working on it' };
}
