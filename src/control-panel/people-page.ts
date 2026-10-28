/** The People area: who's close to you, when you were last in touch, what they're into and how they're doing. */
export interface PanelPeople {
  list: PanelPerson[];
  circles: { id: string; label: string; every: number }[];
  touches: { id: string; label: string }[];
  whatsapp: boolean;
  /** People on the WhatsApp chat list, to fill the number in from. */
  chats: { name: string; number: string }[];
  /** Personal mode: Max uses the list by voice (in work mode the page is read and edited here only). */
  personal: boolean;
  /** The daily reminder about overdue catch-ups. */
  nudge: { speak: boolean; screen: boolean; time: string; laterDays: number };
  /** The screen is on (reminders can show there). */
  screen: boolean;
}

export interface PanelPerson {
  id: string;
  name: string;
  circle: string;
  circleLabel: string;
  relation?: string;
  every: number;
  everySet: boolean;
  phone?: string;
  email?: string;
  birthday?: string;
  birthdayInDays?: number;
  /** "Later" was pressed: no reminder before this day. */
  snoozedUntil?: string;
  interests: string[];
  updates: { at: string; text: string }[];
  touches: { at: string; kind: string; kindLabel: string; note?: string; auto?: boolean }[];
  /** Days since any contact (undefined: never). */
  daysSince?: number;
  /** Days overdue for a catch-up (0 or less: fine). */
  overdue: number;
}

type Esc = (s: unknown) => string;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function peopleParts(p: PanelPeople, esc: Esc): { id: string; label: string; html: string }[] {
  const due = [...p.list].filter((x) => x.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  const bdays = p.list.filter((x) => x.birthdayInDays !== undefined && x.birthdayInDays <= 30).sort((a, b) => a.birthdayInDays! - b.birthdayInDays!);
  const byCircle = p.circles.map((c) => ({ c, people: p.list.filter((x) => x.circle === c.id) })).filter((g) => g.people.length);
  const overview = `<section id="people"><h2>People</h2>
${p.personal ? '' : '<p class="hint">Max is in work mode: he won\'t mention these people or log contact by voice until personal mode. You can still read and update the list here.</p>'}
<p class="meta">The people close to you, and keeping in touch with them. Tell Max "I called Mum, her knee is better", "had lunch with Marco", "Anna's into climbing now", or ask "who should I catch up with?" and "what's new with Marco?". A WhatsApp message to or from someone here counts as texting. Everything stays on the box, encrypted, and only in personal mode.</p>
${p.list.length ? '' : '<p class="empty">Nobody yet: add the people you want to stay close to below, or say "Max, add my sister Anna to my people".</p>'}</section>
<section id="people-reminders"><h2>Reminders</h2>
<p class="meta">Once a day, when it's been too long with someone: Max says so${p.screen ? ' and shows them on his screen, with an "In touch" button each and Later' : ''}. In personal mode only. "Later" (on the screen, or "remind me about Marco next week") pauses the reminder for a few days.</p>
<form class="addfact wrap" method="post" action="/people/reminders"><label class="meta"><input type="checkbox" name="speak" value="yes" ${p.nudge.speak ? 'checked' : ''}> Out loud</label>${p.screen ? `<label class="meta"><input type="checkbox" name="screen" value="yes" ${p.nudge.screen ? 'checked' : ''}> On the screen</label>` : `<input type="hidden" name="screen" value="${p.nudge.screen ? 'yes' : 'no'}">`}<label class="meta">at <input type="time" name="time" value="${esc(p.nudge.time)}"></label><label class="meta">Later means <input type="number" name="laterDays" min="1" max="30" value="${p.nudge.laterDays}" style="width:4em"> days</label><button class="btn secondary" type="submit">Save</button></form></section>
${due.length ? `<section id="people-due"><h2>Worth catching up with</h2><ul>${due.map((x) => `<li class="row"><div><div class="name">${esc(x.name)} <span class="badge warn">${x.daysSince === undefined ? 'not in touch yet' : `${x.daysSince} days`}</span>${x.snoozedUntil ? ` <span class="badge off">later: ${esc(x.snoozedUntil)}</span>` : ''}</div><div class="meta">${esc(x.circleLabel)}${x.relation ? ` · ${esc(x.relation)}` : ''} · you'd like every ${x.every} days${x.updates[0] ? ` · latest: ${esc(x.updates[0].text)}` : ''}</div></div><div class="acts">${quick(x, esc)}</div></li>`).join('')}</ul></section>` : ''}
${bdays.length ? `<section id="people-birthdays"><h2>Birthdays</h2><ul>${bdays.map((x) => `<li class="row"><div><div class="name">${esc(x.name)}</div><div class="meta">${x.birthdayInDays === 0 ? 'Today!' : x.birthdayInDays === 1 ? 'Tomorrow' : `In ${x.birthdayInDays} days`} · ${esc(x.birthday)}${x.interests.length ? ` · into ${esc(x.interests.slice(0, 4).join(', '))}` : ''}</div></div></li>`).join('')}</ul></section>` : ''}
${byCircle.map((g) => `<section id="people-${esc(g.c.id)}"><h2>${esc(g.c.label)}${g.c.label.endsWith('y') ? '' : 's'} <span class="meta">${g.people.length}</span></h2><ul>${g.people.map((x) => `<li class="row"><div><div class="name"><a href="#person-${esc(x.id)}">${esc(x.name)}</a>${x.overdue > 0 ? ' <span class="badge warn">catch up</span>' : ''}</div><div class="meta">${x.relation ? `${esc(x.relation)} · ` : ''}${x.daysSince === undefined ? 'not in touch yet' : x.daysSince === 0 ? 'in touch today' : `${x.daysSince} day${x.daysSince === 1 ? '' : 's'} ago`}${x.updates[0] ? ` · ${esc(x.updates[0].text)}` : ''}</div></div><div class="acts">${quick(x, esc)}</div></li>`).join('')}</ul></section>`).join('')}`;
  const cards = p.list.map((x) => personCard(x, p, esc)).join('');
  return [
    { id: 'overview', label: 'Overview', html: overview },
    { id: 'everyone', label: 'Everyone', html: cards + `<section id="person-new"><h2>Add someone</h2>${personForm(undefined, p, esc)}</section>` },
  ];
}

/** One-tap "we were in touch today" buttons. */
function quick(x: PanelPerson, esc: Esc): string {
  return ['spoke', 'texted', 'met'].map((k) => `<form method="post" action="/people/log"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="kind" value="${k}"><button class="btn secondary small" type="submit" title="We ${k === 'met' ? 'met' : k} today">${k === 'spoke' ? 'Spoke' : k === 'texted' ? 'Texted' : 'Met'}</button></form>`).join('') +
    (x.overdue > 0 && !x.snoozedUntil ? `<form method="post" action="/people/later"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn secondary small" type="submit" title="No reminder for a few days">Later</button></form>` : '');
}

function personCard(x: PanelPerson, p: PanelPeople, esc: Esc): string {
  const status = x.overdue > 0 ? `<span class="badge warn">catch up: ${x.daysSince === undefined ? 'not in touch yet' : `${x.daysSince} days`}</span>` : x.daysSince === undefined ? '<span class="badge off">not in touch yet</span>' : `<span class="badge ok">in touch ${x.daysSince === 0 ? 'today' : `${x.daysSince} day${x.daysSince === 1 ? '' : 's'} ago`}</span>`;
  const last = (kind: string) => {
    const t = x.touches.find((t) => t.kind === kind);
    return t ? day(t.at) : 'never';
  };
  const touches = x.touches.slice(0, 8).map((t) => `<li class="row"><div class="meta">${esc(day(t.at))} · ${esc(t.kindLabel)}${t.note ? ` · ${esc(t.note)}` : ''}${t.auto ? ' · from WhatsApp' : ''}</div></li>`).join('');
  const updates = x.updates.map((u) => `<li class="row"><div><div>${esc(u.text)}</div><div class="meta">${esc(day(u.at))}</div></div><form method="post" action="/people/update-remove"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="at" value="${esc(u.at)}"><button class="linkbtn" type="submit" aria-label="Remove">✕</button></form></li>`).join('');
  const kinds = p.touches.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  return `<section id="person-${esc(x.id)}"><h2>${esc(x.name)} ${status}</h2>
<p class="meta">${esc(x.circleLabel)}${x.relation ? ` · ${esc(x.relation)}` : ''} · keep in touch every ${x.every} days${x.birthday ? ` · birthday ${esc(x.birthday)}${x.birthdayInDays !== undefined && x.birthdayInDays <= 30 ? ` (${x.birthdayInDays === 0 ? 'today!' : `in ${x.birthdayInDays} days`})` : ''}` : ''}${x.phone ? ` · ${esc(x.phone)}` : ''}${x.email ? ` · ${esc(x.email)}` : ''}</p>
<p class="meta">Last spoke: <b>${esc(last('spoke'))}</b> · called: <b>${esc(last('called'))}</b> · texted: <b>${esc(last('texted'))}</b> · met: <b>${esc(last('met'))}</b></p>
<p><b>Into:</b> ${x.interests.length ? esc(x.interests.join(', ')) : '<span class="meta">nothing noted yet</span>'}</p>
<form class="addfact" method="post" action="/people/interests"><input type="hidden" name="id" value="${esc(x.id)}"><input name="text" maxlength="200" placeholder="Add interests, e.g. climbing, jazz, Italian food" aria-label="Interests"><button class="btn secondary" type="submit">Add</button></form>
<h3>How they are</h3>
${updates ? `<ul>${updates}</ul>` : '<p class="meta">Nothing noted yet.</p>'}
<form class="addfact" method="post" action="/people/news"><input type="hidden" name="id" value="${esc(x.id)}"><input name="text" maxlength="400" placeholder="What's going on with them, e.g. started a new job, knee is better" aria-label="News"><button class="btn secondary" type="submit">Note</button></form>
<h3>In touch</h3>
<form class="addfact wrap" method="post" action="/people/log"><input type="hidden" name="id" value="${esc(x.id)}"><select name="kind" aria-label="How">${kinds}</select><input type="date" name="date" aria-label="When (today if empty)"><input name="text" maxlength="300" placeholder="Anything they told you (optional)" aria-label="Note"><button class="btn" type="submit">Log</button></form>
${touches ? `<ul>${touches}</ul>` : ''}
<details><summary class="meta">Settings</summary>${personForm(x, p, esc)}
<form class="addfact danger" method="post" action="/people/delete"><input type="hidden" name="id" value="${esc(x.id)}"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Remove ${esc(x.name)} from the list</label><button class="btn secondary" type="submit">Remove</button></form></details>
</section>`;
}

function personForm(x: PanelPerson | undefined, p: PanelPeople, esc: Esc): string {
  const circles = p.circles.map((c) => `<option value="${esc(c.id)}" ${c.id === (x?.circle ?? 'friend') ? 'selected' : ''}>${esc(c.label)} (every ${c.every} days)</option>`).join('');
  return `<form class="stack routine" method="post" action="/people/save">${x ? `<input type="hidden" name="id" value="${esc(x.id)}">` : ''}
<div class="addfact wrap"><label class="inline">Name <input name="name" maxlength="60" required value="${esc(x?.name ?? '')}" placeholder="Anna"></label>
<label class="inline">Circle <select name="circle">${circles}</select></label>
<label class="inline">Relation <input name="relation" maxlength="60" value="${esc(x?.relation ?? '')}" placeholder="my sister, old school friend"></label></div>
<div class="addfact wrap"><label class="inline">Keep in touch every <input type="number" name="every" min="1" max="365" value="${x?.everySet ? x.every : ''}" placeholder="${x?.every ?? ''}" style="width:5em"> days <span class="meta">(empty: the circle's default)</span></label>
<label class="inline">Birthday <input name="birthday" maxlength="10" value="${esc(x?.birthday ?? '')}" placeholder="1981-03-14 or 03-14"></label></div>
<div class="addfact wrap"><label class="inline">WhatsApp / phone <input name="phone" maxlength="24" value="${esc(x?.phone ?? '')}" placeholder="+44 7700 900123" list="wa-people-${esc(x?.id ?? 'new')}"></label>${p.chats.length ? `<datalist id="wa-people-${esc(x?.id ?? 'new')}">${p.chats.map((c) => `<option value="+${esc(c.number)}">${esc(c.name)}</option>`).join('')}</datalist>` : ''}
<label class="inline">Email <input name="email" maxlength="120" value="${esc(x?.email ?? '')}" placeholder="anna@example.com"></label></div>
${x ? '' : '<label>Interests <span class="meta">(comma-separated)</span><input name="interests" maxlength="300" placeholder="climbing, jazz, Italian food"></label>'}
<div class="acts"><button class="btn" type="submit">${x ? 'Save' : 'Add'}</button></div>
${x ? '' : `<p class="meta">With a WhatsApp number, every message to or from them updates "last texted" by itself${p.chats.length ? ' (start typing + to pick from your WhatsApp chats)' : ''}. Max only needs to know when the last message was: he doesn\'t need to read the chat.${p.whatsapp ? '' : ' WhatsApp is not linked yet.'}</p>`}</form>`;
}
