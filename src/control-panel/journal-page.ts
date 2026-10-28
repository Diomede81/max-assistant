/** The Journal area: what you did day by day, and Max's weekly and monthly reviews. */
export interface PanelJournal {
  today: string;
  /** The last 14 days, newest first, each with its entries. */
  days: { date: string; label: string; entries: PanelEntry[]; mood?: number }[];
  reviews: { id: string; period: string; from: string; to: string; at: string; text: string; sent: string[]; failed: string[] }[];
  settings: { reviewDay: number; reviewTime: string; monthly: boolean; email: boolean; whatsapp: boolean; captureMeetings: boolean; captureEvents: boolean; eventsTime: string };
  moods: Record<number, string>;
  emailReady: boolean;
  whatsappReady: boolean;
  calendar: boolean;
  meetings: boolean;
  /** Personal mode: Max logs by voice (otherwise the page is read and edited here only). */
  personal: boolean;
  counts: { entries: number; days: number };
}

export interface PanelEntry {
  id: string;
  at: string;
  text: string;
  source: string;
  mood?: number;
}

type Esc = (s: unknown) => string;
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MOOD_ICON: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

export function journalParts(j: PanelJournal, esc: Esc): { id: string; label: string; html: string }[] {
  const moodPick = (name: string, cur?: number) => `<select name="${name}" aria-label="How the day felt"><option value="">How did it feel?</option>${[5, 4, 3, 2, 1].map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${MOOD_ICON[m]} ${esc(j.moods[m])}</option>`).join('')}</select>`;
  const entry = (e: PanelEntry) => `<li class="row"><div style="flex:1;min-width:0"><div>${e.source === 'meeting' ? '🗣️ ' : e.source === 'event' ? '📅 ' : ''}${esc(e.text)}${e.mood ? ` <span class="meta">${MOOD_ICON[e.mood]} ${esc(j.moods[e.mood])}</span>` : ''}</div><div class="meta">${esc(time(e.at))}${e.source === 'meeting' ? ' · meeting Max attended' : e.source === 'event' ? ' · from your calendar' : e.source === 'panel' ? ' · typed here' : ' · you told Max'}</div></div><form method="post" action="/journal/delete"><input type="hidden" name="id" value="${esc(e.id)}"><button class="linkbtn" type="submit" aria-label="Remove">✕</button></form></li>`;
  const days = j.days
    .map((d) => `<section id="journal-${esc(d.date)}"><h2>${d.date === j.today ? 'Today' : esc(d.label)} <span class="meta">${esc(d.date)}${d.mood ? ` · ${MOOD_ICON[d.mood]} ${esc(j.moods[d.mood])}` : ''}</span></h2>
${d.entries.length ? `<ul>${d.entries.map(entry).join('')}</ul>` : '<p class="empty">Nothing noted.</p>'}
${d.date === j.today ? '' : `<form class="addfact" method="post" action="/journal/add"><input type="hidden" name="date" value="${esc(d.date)}"><input name="text" maxlength="1500" placeholder="Add something for that day" aria-label="What you did"><button class="btn secondary" type="submit">Add</button></form>`}</section>`)
    .join('');
  const log = `<section id="journal"><h2>Journal</h2>
${j.personal ? '' : '<p class="hint">Max is in work mode: he won\'t log by voice until personal mode. You can still write here.</p>'}
<p class="meta">What you did, in your words, any time of day: just tell Max "I went to the gym and had lunch with Marco", "just back from the dentist", "rough day". ${j.meetings ? 'He adds the meetings he attended for you' : ''}${j.meetings && j.calendar ? ' and ' : ''}${j.calendar ? `your calendar events each evening` : ''}${j.meetings || j.calendar ? ' by himself. ' : ''}Every ${DAY[j.settings.reviewDay - 1]} at ${esc(j.settings.reviewTime)} he writes your weekly review${j.settings.monthly ? ', and a monthly one on the last day of the month' : ''}: ask "how was my week?". ${j.counts.entries} entr${j.counts.entries === 1 ? 'y' : 'ies'} over ${j.counts.days} day${j.counts.days === 1 ? '' : 's'} so far.</p>
<form class="stack" method="post" action="/journal/add"><div class="addfact wrap"><input name="text" maxlength="1500" required placeholder="What did you do today? e.g. Gym at 7, then a long call with Mum; dinner with Anna" aria-label="What you did" style="flex:1 1 320px">${moodPick('mood')}<input type="date" name="date" max="${esc(j.today)}" aria-label="Day (today if empty)"><button class="btn" type="submit">Note</button></div></form></section>
${days}`;
  const reviews = `<section id="journal-reviews"><h2>Reviews</h2>
<p class="meta">Max's look back at your ${j.settings.monthly ? 'week and month' : 'week'}: what you did, people, health, work, how it felt, patterns, and a few questions for next time. Written from the journal, your health numbers, the to-dos you finished and the people you saw.</p>
<div class="acts"><form method="post" action="/journal/review"><input type="hidden" name="period" value="week"><button class="btn" type="submit">Write this week's review now</button></form><form method="post" action="/journal/review"><input type="hidden" name="period" value="month"><button class="btn secondary" type="submit">Write this month's review now</button></form></div>
${j.reviews.length ? j.reviews.map((r) => `<details ${r === j.reviews[0] ? 'open' : ''}><summary><b>${r.period === 'week' ? 'Week' : 'Month'}</b> ${esc(r.from)} to ${esc(r.to)} <span class="meta">· written ${esc(when(r.at))}${r.sent.length ? ` · sent by ${esc(r.sent.join(', '))}` : ''}${r.failed.length ? ` · <span class="warntext">not sent: ${esc(r.failed.join('; '))}</span>` : ''}</span></summary><pre class="hplan">${esc(r.text)}</pre></details>`).join('') : '<p class="empty">No reviews yet: the first comes at the next review time, or press the button.</p>'}</section>`;
  const s = j.settings;
  const tick = (name: string, on: boolean, label: string, ok = true, hint = '') => `<label class="check"><input type="checkbox" name="${name}" value="yes" ${on ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${label}${hint ? ` <span class="meta">(${esc(hint)})</span>` : ''}</label>`;
  const settings = `<section id="journal-settings"><h2>Journal settings</h2>
<form class="stack routine" method="post" action="/journal/settings">
<div class="addfact wrap"><label class="inline">Weekly review on <select name="reviewDay">${DAY.map((d, i) => `<option value="${i + 1}" ${i + 1 === s.reviewDay ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
<label class="inline">at <input type="time" name="reviewTime" value="${esc(s.reviewTime)}" required></label>
${tick('monthly', s.monthly, 'Monthly review too', true, 'on the last day of the month, same time')}</div>
<div class="addfact wrap"><span class="meta">Send reviews:</span>${tick('email', s.email, 'Email me', j.emailReady, j.emailReady ? '' : 'set your address under Health → Plans and connect Gmail or Outlook')}${tick('whatsapp', s.whatsapp, 'WhatsApp me', j.whatsappReady, j.whatsappReady ? '' : 'link WhatsApp first')}</div>
<div class="addfact wrap"><span class="meta">Max adds by himself:</span>${tick('captureMeetings', s.captureMeetings, 'Meetings he attended', j.meetings, j.meetings ? '' : 'meetings are not set up')}${tick('captureEvents', s.captureEvents, 'My calendar events', j.calendar, j.calendar ? '' : 'connect a calendar under Connections → Apps')}<label class="inline">read at <input type="time" name="eventsTime" value="${esc(s.eventsTime)}" required></label></div>
<div class="acts"><button class="btn" type="submit">Save</button></div>
<p class="meta">Reviews are written by the model chosen for Life reviews under Settings → AI models. Everything stays on the box, encrypted; Max uses the journal by voice in personal mode only.</p></form></section>`;
  return [
    { id: 'log', label: 'Day by day', html: log },
    { id: 'reviews', label: 'Reviews', html: reviews },
    { id: 'settings', label: 'Settings', html: settings },
  ];
}
