/** HTML for the control panel. Server-rendered, no external assets, works on a phone. */
import { PanelRoutines, ROUTINES_CSS, routinesSection } from './routines-page';
import { MODELS_CSS, modelsSection, PanelModels } from './models-page';
import { PanelScreen, SCREEN_CSS, screenSection } from './screen-page';

export interface PanelData {
  music?: { state: string; account?: string; pairing?: { url: string; code: string }; error?: string };
  voice: string;
  routines?: PanelRoutines;
  /** Running on the Max box: the Device section can turn it off or restart it. */
  onBox?: boolean;
  device?: { volume?: number; brightness: number; brightnessSupported?: boolean };
  updates?: {
    onBox: boolean;
    version?: { sha: string; date: string; subject: string; repo: string };
    state?: { state: string; message: string; at: number };
    available?: { behind: number; changes: string[]; error?: string };
    auto: { auto: boolean; time: string };
  };
  models?: PanelModels;
  /** The start-up code (6 digits typed on Max's screen each time he starts). */
  lock?: { enabled: boolean; locked: boolean; canReset: boolean };
  /** The round screen's glance and photo frame (when the face is on). */
  screen?: PanelScreen;
  /** The tab to open first (overview, max, memory, projects, connections, settings). */
  tab?: string;
  notice?: { kind: 'ok' | 'error'; text: string };
  homeAssistant: { connected: boolean; tools: number; error?: string };
  web?: { configured: boolean; connected: boolean; remainingCredits?: number; error?: string };
  location?: { place: string; postcode?: string; country: string; countries: Record<string, string> };
  composio: {
    configured: boolean;
    error?: string;
    apps: { slug: string; name: string; logo?: string; connected: boolean; toolsOffered: number }[];
    /** The separate work accounts (used in work mode). */
    workApps: { slug: string; name: string; logo?: string; connected: boolean; toolsOffered: number }[];
    notEnabled: string[];
    otherUser: string[];
    userId: string;
  };
  servers: { name: string; connected: boolean; offered: number; total: number; error?: string }[];
  soul?: { docs: Record<string, string>; doc: string; maxChars: number; journal?: { id: string; at: string; text: string; source: string; mode?: string }[] };
  memory?: {
    mode: string;
    modeText: string;
    readable: string[];
    vaults: {
      name: string;
      status: string;
      error?: string;
      facts: { id: string; kind: string; subject?: string; text: string; source: string; unverified?: boolean; date?: string; expiresAt?: string; updatedAt: string }[];
      notes: { id: string; at: string; summary: string; level?: string; from?: string }[];
      totalNotes: number;
    }[];
    autoLearn: boolean;
    passwordSet: boolean;
    workApps: string[];
    selected?: string;
    query?: string;
    activity: { at: string; kind: string; what: string; vaults?: string[]; items?: string[] }[];
    projects: PanelProject[];
    project?: string;
    /** Today in the household time zone (YYYY-MM-DD). */
    today: string;
    todos: PanelTodo[];
  };
}

const VAULT_LABEL: Record<string, string> = { personal: 'Personal', household: 'Household', work: 'Work' };
const SOURCE: Record<string, string> = { you: 'you asked Max', conversation: 'learnt in conversation', panel: 'added here' };
const FACTS_SHOWN = 60;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const post = (action: string, fields: Record<string, string>, label: string, cls = 'btn secondary') =>
  `<form method="post" action="${action}">${Object.entries(fields).map(([k, v]) => hidden(k, v)).join('')}<button class="${cls}" type="submit">${label}</button></form>`;

export interface PanelTodo {
  id: string;
  title: string;
  vault: string;
  projectId?: string;
  projectName?: string;
  priority: string;
  criticality: string;
  due?: string;
  assignee?: string;
  done: boolean;
}

export interface PanelProject {
  id: string;
  name: string;
  vault: string;
  status: string;
  description?: string;
  people: { name: string; role?: string; contact?: string }[];
  tasks: { id: string; title: string; text: string; due?: string; status: string; priority?: string; criticality?: string }[];
  facts: { id: string; text: string; updatedAt: string }[];
  notes: { id: string; summary: string; at: string }[];
}

const SOUL_TABS: [string, string, string][] = [
  ['soul', 'Who Max is', 'His identity, story and personality, in every mode. Write it as Max ("I\'m Max…").'],
  ['personal', 'Personal mode', 'How he behaves when work mode is off. In personal mode he only sees personal and household memories.'],
  ['work', 'Work mode', 'How he behaves in work hours (WORK_HOURS) or after "work mode". In work mode he only sees work and household memories.'],
  ['guest', 'Guest mode', 'How he behaves when visitors are around ("guest mode"). He only sees household memories.'],
];

function soulSection(s: NonNullable<PanelData['soul']>): string {
  const [doc, , help] = SOUL_TABS.find((t) => t[0] === s.doc) ?? SOUL_TABS[0];
  const tabs = SOUL_TABS.map(([d, name]) => `<a class="tab ${d === doc ? 'on' : ''}" href="/?doc=${d}#soul">${name}</a>`).join('');
  const modeBadge = (m?: string) => `<span class="badge off">${m === 'work' ? 'Work' : 'Personal'}</span>`;
  const journal = s.journal
    ? s.journal.length
      ? s.journal
          .map((e) => `<li class="row"><div><div>${esc(e.text)} ${modeBadge(e.mode)}</div><div class="meta">${esc(day(e.at))} · ${e.source === 'panel' ? 'added here' : 'Max noted this'}</div></div>${post('/soul/journal-delete', { id: e.id }, 'Forget')}</li>`)
          .join('')
      : '<li class="empty">Nothing yet. After conversations, Max notes things that shape who he is here: nicknames, running jokes, how you like him to talk.</li>'
    : '';
  return `<section id="soul"><h2>Max's soul</h2>
<div class="tabs">${tabs}</div>
<p class="meta">${esc(help)} Notes between <code>&lt;!--</code> and <code>--&gt;</code> are for you and hidden from him.</p>
<form method="post" action="/soul/save">${hidden('doc', doc)}<textarea name="text" rows="${doc === 'soul' ? 22 : 10}" maxlength="${s.maxChars}" spellcheck="true" aria-label="${esc(doc)}">${esc(s.docs[doc] ?? '')}</textarea>
<div class="acts" style="margin-top:8px"><button class="btn" type="submit">Save</button></div></form>
<form class="addfact danger" method="post" action="/soul/reset">${hidden('doc', doc)}<label class="meta"><input type="checkbox" name="confirm" value="yes"> Go back to the starter version of this page (your text is replaced)</label><button class="btn secondary" type="submit">Reset</button></form>
${s.journal ? `<h3>Max's journal</h3><p class="meta">What Max has learnt about himself living with you, kept separately for personal and work mode (each mode only sees its own). Encrypted like his memory.</p><ul>${journal}</ul>
<form class="addfact" method="post" action="/soul/journal-add"><input name="text" maxlength="240" required placeholder="e.g. We call the hoover Dave, and Max is jealous of him"><select name="mode" aria-label="Mode"><option value="personal">Personal</option><option value="work">Work</option></select><button class="btn secondary" type="submit">Add</button></form>` : ''}
</section>`;
}

function lockRow(l: NonNullable<PanelData['lock']>): string {
  const code = (name: string, label: string) =>
    `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" required autocomplete="off" placeholder="${label}" style="width:9em">`;
  const status = l.enabled ? (l.locked ? ' <span class="badge warn">Locked now</span>' : '') : '';
  return `<li class="row"><div style="width:100%"><div class="name">Start-up code ${badge(l.enabled, 'On', 'Off')}${status}</div>
<div class="meta">${l.enabled
    ? 'Every time Max starts, he stays locked until this 6-digit code is typed on his screen: he won\'t answer, act or show anything personal. You can also lock him from his screen menu (hold a finger on the screen for 2 seconds).'
    : 'Set a 6-digit code and Max will ask for it on his screen every time he starts. Until it is entered he won\'t answer, act or show anything personal.'}</div>
${l.enabled
    ? `<form class="addfact" method="post" action="/lock/set">${code('current', 'Current code')}${code('code', 'New code')}${code('repeat', 'Repeat new code')}<button class="btn" type="submit">Change</button></form>
<form class="addfact" method="post" action="/lock/off">${code('current', 'Current code')}<button class="btn secondary" type="submit">Turn off</button></form>
${l.canReset
    ? `<form class="addfact danger" method="post" action="/lock/reset"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Forgot the code? Remove it (you signed in to this page with its password)</label><button class="btn secondary" type="submit">Remove code</button></form>`
    : '<p class="meta">Forgot the code? Set <code>PANEL_PASSWORD</code> to be able to remove it from this page, or delete <code>data/startup-code.json</code> on the box.</p>'}`
    : `<form class="addfact" method="post" action="/lock/set">${code('code', 'New 6-digit code')}${code('repeat', 'Repeat it')}<button class="btn" type="submit">Turn on</button></form>`}
</div></li>`;
}

function locationSection(l: NonNullable<PanelData['location']>): string {
  const opts = Object.entries(l.countries)
    .concat(l.countries[l.country] ? [] : [[l.country, l.country]])
    .map(([code, name]) => `<option value="${esc(code)}" ${code === l.country ? 'selected' : ''}>${esc(name)}</option>`)
    .join('');
  return `<section id="location"><h2>Home location</h2>
<p class="meta">Where home is, so "what's the weather?", "is the pharmacy open?" or "what's on this weekend?" are answered for your area, and web searches show local results. ${l.place ? '' : '<b>Not set yet.</b>'}</p>
<form class="stack" method="post" action="/location">
<div class="addfact"><input name="place" maxlength="100" required value="${esc(l.place)}" placeholder="Town, city or area, e.g. Clapham, London"></div>
<div class="addfact"><input name="postcode" maxlength="10" value="${esc(l.postcode ?? '')}" placeholder="Postcode (optional, e.g. SW4 or SW4 7AB)"><select name="country" aria-label="Country">${opts}</select><button class="btn" type="submit">Save</button></div>
</form><p class="meta">The postcode makes "near me" answers sharper; it's never mentioned while guest mode is on. Kept encrypted with Max's memory.</p></section>`;
}

const STATUS: Record<string, string> = { active: 'Active', on_hold: 'On hold', done: 'Finished' };

function projectsSection(m: NonNullable<PanelData['memory']>): string {
  const sel = m.projects.find((p) => p.id === m.project);
  const today = new Date().toISOString().slice(0, 10);
  const rank = (p: PanelProject) => ({ active: 0, on_hold: 1, done: 2 })[p.status as 'active'] ?? 3;
  const list = m.projects.length
    ? [...m.projects]
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
        .map((p) => {
          const open = p.tasks.filter((t) => t.status === 'open').sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
          const overdue = open.filter((t) => t.due && t.due.slice(0, 10) < today).length;
          const locked = !m.readable.includes(p.vault);
          return `<li class="row"><div><div class="name">${esc(p.name)} <span class="badge ${p.status === 'active' ? 'ok' : 'off'}">${esc(STATUS[p.status] ?? p.status)}</span> <span class="badge off">${esc(VAULT_LABEL[p.vault])}</span>${locked ? ' <span class="badge off">locked for Max</span>' : ''}${overdue ? ` <span class="badge warn">${overdue} overdue</span>` : ''}</div>
<div class="meta">${p.people.length} ${p.people.length === 1 ? 'person' : 'people'} · ${open.length} open task${open.length === 1 ? '' : 's'}${open[0]?.due ? ` · next: ${esc(open[0].text)}` : ''}</div></div>
<a class="btn ${sel?.id === p.id ? '' : 'secondary'}" href="/?project=${encodeURIComponent(p.id)}#projects">Open</a></li>`;
        })
        .join('')
    : '<li class="empty">No projects yet. Say "Hey Max, create a work project called Milan launch with Marco and Anna", or add one below.</li>';
  const vaultOpts = (cur = 'work') => ['work', 'personal', 'household'].map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${VAULT_LABEL[v]}</option>`).join('');
  const create = `<form class="stack" method="post" action="/projects/create">
<div class="addfact"><input name="name" maxlength="80" required placeholder="New project name"><select name="vault" aria-label="Vault">${vaultOpts()}</select></div>
<div class="addfact"><input name="people" placeholder="People, e.g. Marco (supplier, marco@acme.com), Anna (designer)"></div>
<div class="addfact"><input name="description" maxlength="500" placeholder="What it's about (optional)"><button class="btn" type="submit">Create</button></div></form>`;
  return `<section id="projects"><h2>Projects</h2><ul>${list}</ul>${create}</section>${sel ? projectDetail(sel) : ''}`;
}

function projectDetail(p: PanelProject): string {
  const id = { id: p.id };
  const open = p.tasks.filter((t) => t.status === 'open').sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
  const done = p.tasks.filter((t) => t.status === 'done');
  const today = new Date().toISOString().slice(0, 10);
  const statusOpts = Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('');
  const people = p.people.length
    ? p.people.map((x) => `<li class="row"><div><div>${esc(x.name)}${x.role ? ` <span class="meta">· ${esc(x.role)}</span>` : ''}</div>${x.contact ? `<div class="meta">${esc(x.contact)}</div>` : ''}</div>${post('/projects/person-remove', { ...id, name: x.name }, 'Remove')}</li>`).join('')
    : '<li class="empty">No people yet.</li>';
  const tasks = open.length
    ? open.map((t) => `<li class="row"><div><div>${esc(t.title)}${t.criticality === 'critical' ? ' <span class="badge warn">critical</span>' : ''}${t.priority === 'high' ? ' <span class="badge warn">high</span>' : ''}${t.due && t.due.slice(0, 10) < today ? ' <span class="badge warn">overdue</span>' : ''}</div><div class="meta">${esc(t.text.slice(t.title.length).replace(/^, /, ''))}</div></div>
<div class="acts">${post('/projects/task-done', { ...id, task: t.id }, 'Done', 'btn')}${post('/projects/task-delete', { ...id, task: t.id }, 'Delete')}</div></li>`).join('')
    : '<li class="empty">No open tasks.</li>';
  const doneList = done.length
    ? `<details><summary class="meta">${done.length} finished task${done.length === 1 ? '' : 's'}</summary><ul>${done.map((t) => `<li class="row"><div class="meta">${esc(t.text)}</div>${post('/projects/task-reopen', { ...id, task: t.id }, 'Reopen')}</li>`).join('')}</ul></details>`
    : '';
  const facts = p.facts.length
    ? p.facts.map((f) => `<li class="row"><div><div>${esc(f.text)}</div><div class="meta">${esc(day(f.updatedAt))}</div></div>${post('/memory/delete', { id: f.id, vault: p.vault }, 'Forget')}</li>`).join('')
    : '<li class="empty">Nothing yet. Say "remember for the Milan project that…", or add a note below.</li>';
  const notes = p.notes.length ? `<details><summary class="meta">${p.notes.length} conversation note${p.notes.length === 1 ? '' : 's'}</summary><ul>${p.notes.map((n) => `<li class="meta">${esc(day(n.at))}: ${esc(n.summary)}</li>`).join('')}</ul></details>` : '';
  const assignees = `<datalist id="people-${esc(p.id)}">${p.people.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>`;
  return `<section id="project"><h2>${esc(p.name)} · ${esc(VAULT_LABEL[p.vault])}</h2>
<form class="addfact" method="post" action="/projects/update">${hidden('id', p.id)}<select name="status" aria-label="Status">${statusOpts}</select><input name="description" maxlength="500" value="${esc(p.description ?? '')}" placeholder="Description"><button class="btn secondary" type="submit">Save</button></form>
<h3>Tasks</h3><ul>${tasks}</ul>${doneList}
<form class="stack" method="post" action="/projects/task-add">${hidden('id', p.id)}
<div class="addfact"><input name="title" maxlength="200" required placeholder="New task"></div>
<div class="addfact"><input type="date" name="date" aria-label="Due date"><input type="time" name="time" aria-label="Time (optional, for a spoken reminder)"><input name="assignee" list="people-${esc(p.id)}" placeholder="Who">${assignees}${levelSelects()}<button class="btn" type="submit">Add</button></div></form>
<h3>People</h3><ul>${people}</ul>
<form class="addfact" method="post" action="/projects/person-add">${hidden('id', p.id)}<input name="people" required placeholder="e.g. Marco (supplier, marco@acme.com)"><button class="btn secondary" type="submit">Add</button></form>
<h3>Project memory</h3><ul>${facts}</ul>${notes}
<form class="addfact" method="post" action="/projects/note-add">${hidden('id', p.id)}<input name="fact" maxlength="300" required placeholder="Add a note to this project"><button class="btn secondary" type="submit">Remember</button></form>
<form class="addfact danger" method="post" action="/projects/delete">${hidden('id', p.id)}<label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete this project with its tasks and memory</label><button class="btn secondary" type="submit">Delete</button></form>
</section>`;
}

const PRIORITIES = ['high', 'medium', 'low'];
const CRITICALITIES = ['critical', 'important', 'routine'];
const opts = (values: string[], selected: string, label = (v: string) => v) =>
  values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(v)}</option>`).join('');
const levelSelects = (priority = 'medium', criticality = 'routine') =>
  `<select name="priority" aria-label="Priority" title="Priority: how soon">${opts(PRIORITIES, priority, (v) => `${v} priority`)}</select>` +
  `<select name="criticality" aria-label="Criticality" title="Criticality: what's at stake if it slips">${opts(CRITICALITIES, criticality)}</select>`;

const shortDate = (due: string) => {
  const [d, t] = due.split('T');
  return `${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}${t ? ` ${t}` : ''}`;
};

/** My Day: the to-do list grouped by what needs attention first. */
function myDaySection(m: NonNullable<PanelData['memory']>): string {
  const today = m.today;
  const open = m.todos.filter((t) => !t.done);
  const done = m.todos.filter((t) => t.done);
  const overdue = open.filter((t) => t.due && t.due.slice(0, 10) < today);
  const dueToday = open.filter((t) => t.due?.slice(0, 10) === today);
  const critical = open.filter((t) => t.criticality === 'critical' && !overdue.includes(t) && !dueToday.includes(t));
  const later = open.filter((t) => !overdue.includes(t) && !dueToday.includes(t) && !critical.includes(t));
  const projectOpts = (selected?: string) =>
    m.projects.filter((p) => p.status !== 'done').map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} (${VAULT_LABEL[p.vault]})</option>`).join('');
  const row = (t: PanelTodo) => {
    const late = t.due && t.due.slice(0, 10) < today;
    const badges =
      (t.criticality === 'critical' ? ' <span class="badge warn">critical</span>' : t.criticality === 'important' ? ' <span class="badge imp">important</span>' : '') +
      (t.priority === 'high' ? ' <span class="badge warn">high priority</span>' : t.priority === 'low' ? ' <span class="badge off">low priority</span>' : '') +
      (late ? ' <span class="badge warn">overdue</span>' : '');
    const meta = [t.due ? `${late ? 'was due' : 'due'} ${shortDate(t.due)}` : '', t.projectName ? `📁 ${esc(t.projectName)}` : `${VAULT_LABEL[t.vault]} list`, t.assignee ? esc(t.assignee) : '']
      .filter(Boolean)
      .join(' · ');
    const [date, time] = (t.due ?? '').split('T');
    return `<li class="row"><div style="flex:1;min-width:0"><div>${esc(t.title)}${badges}</div><div class="meta">${meta}</div>
<details><summary class="meta">Change</summary><form class="addfact edit" method="post" action="/todo/update">${hidden('id', t.id)}${levelSelects(t.priority, t.criticality)}
<select name="project" aria-label="Project"><option value="none" ${t.projectId ? '' : 'selected'}>No project</option>${projectOpts(t.projectId)}</select>
<input type="date" name="date" value="${esc(date ?? '')}" aria-label="Due date"><input type="time" name="time" value="${esc(time ?? '')}" aria-label="Time"><button class="btn secondary" type="submit">Save</button></form></details></div>
<div class="acts">${post('/todo/done', { id: t.id }, 'Done', 'btn')}${post('/todo/delete', { id: t.id }, 'Delete')}</div></li>`;
  };
  const group = (title: string, items: PanelTodo[], hint = '') => (items.length ? `<h3>${title} <span class="meta">${items.length}${hint ? ` · ${hint}` : ''}</span></h3><ul>${items.map(row).join('')}</ul>` : '');
  const summary = [
    overdue.length ? `<b class="warntext">${overdue.length} overdue</b>` : '',
    `${dueToday.length} due today`,
    `${open.filter((t) => t.criticality === 'critical').length} critical`,
    `${open.length} open in total`,
  ]
    .filter(Boolean)
    .join(' · ');
  const doneList = done.length
    ? `<details><summary class="meta">${done.length} done in the last 2 weeks</summary><ul>${done.map((t) => `<li class="row"><div class="meta">${esc(t.title)}${t.projectName ? ` · ${esc(t.projectName)}` : ''}</div>${post('/todo/reopen', { id: t.id }, 'Reopen')}</li>`).join('')}</ul></details>`
    : '';
  return `<section id="myday"><h2>My Day</h2>
<p class="meta">${summary}. Ask Max "what's going on in my day?" for a briefing with your calendar. <b>Priority</b> = how soon; <b>criticality</b> = what's at stake if it slips.</p>
<form class="stack" method="post" action="/todo/add">
<div class="addfact"><input name="title" maxlength="200" required placeholder="New to-do, e.g. Renew the car insurance"></div>
<div class="addfact wrap">${levelSelects()}<input type="date" name="date" aria-label="Due date"><input type="time" name="time" aria-label="Time (optional, for a spoken reminder)">
<select name="project" aria-label="Project"><option value="">No project</option>${projectOpts()}</select>
<select name="vault" aria-label="List" title="Which list, when it has no project"><option value="personal">Personal list</option><option value="work">Work list</option><option value="household">Household list</option></select>
<button class="btn" type="submit">Add</button></div></form>
${group('Overdue', overdue, 'should already have been done')}${group('Today', dueToday)}${group('Critical', critical)}${group('Later', later)}
${open.length ? '' : '<p class="empty">Nothing on the list. Add one above, or say "Hey Max, add to my to-do list…".</p>'}
${doneList}
<p class="meta">Work items are only visible to Max in work mode, personal ones in personal mode.</p></section>`;
}

const ACTIVITY: Record<string, string> = {
  shared: 'Shared with AI', recall: 'Searched', saved: 'Saved', updated: 'Updated', forgot: 'Forgot', moved: 'Moved',
  note: 'Filed', digest: 'Digest', mode: 'Mode', blocked: 'Refused',
};
const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const noteWhen = (n: { at: string; level?: string; from?: string }) =>
  n.level === 'month'
    ? new Date(n.from ?? n.at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' · monthly digest'
    : n.level === 'week'
      ? `Week of ${day(n.from ?? n.at)} · weekly digest`
      : day(n.at);

function activitySection(a: NonNullable<PanelData['memory']>['activity']): string {
  const rows = a.length
    ? a
        .map(
          (e) => `<li class="row"><div><div><b>${esc(ACTIVITY[e.kind] ?? e.kind)}</b> · ${esc(e.what)}${e.vaults?.length ? ` <span class="meta">(${esc(e.vaults.join(', '))})</span>` : ''}</div>
<div class="meta">${esc(time(e.at))}</div>${e.items?.length ? `<details><summary class="meta">${e.items.length} memor${e.items.length === 1 ? 'y' : 'ies'}</summary><ul class="items">${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></details>` : ''}</div></li>`,
        )
        .join('')
    : '<li class="empty">Nothing yet.</li>';
  return `<section id="activity"><h2>Memory activity · last 30 days</h2>
<p class="meta">Which memories were shared with the AI service, searched, saved or changed, and mode switches. Encrypted like the vaults.</p>
<ul>${rows}</ul><div class="acts" style="margin-top:12px">${post('/activity/clear', {}, 'Clear activity log')}</div></section>`;
}

function memorySection(m: NonNullable<PanelData['memory']>): string {
  const sel = m.selected ?? 'personal';
  const q = (m.query ?? '').toLowerCase();
  const v = m.vaults.find((x) => x.name === sel) ?? m.vaults[0];
  const tabs = m.vaults
    .map((x) => {
      const locked = !m.readable.includes(x.name);
      return `<a class="tab ${x.name === sel ? 'on' : ''}" href="/?vault=${x.name}#memory">${VAULT_LABEL[x.name]} <span class="meta">${x.status === 'open' ? x.facts.length : '!'}</span>${locked ? ' <span class="badge off">locked for Max</span>' : ''}</a>`;
    })
    .join('');
  const shown = v.facts.filter((f) => !q || f.text.toLowerCase().includes(q) || (f.subject ?? '').toLowerCase().includes(q));
  const others = (name: string) => m.vaults.filter((x) => x.name !== name).map((x) => `<option value="${x.name}">${VAULT_LABEL[x.name]}</option>`).join('');
  const facts =
    v.status !== 'open'
      ? `<li class="hint">This vault ${esc(v.error ?? 'cannot be opened')}. Check <code>MEMORY_KEY</code> in <code>.env</code>.</li>`
      : shown.length
        ? shown
            .slice(0, FACTS_SHOWN)
            .map(
              (f) => `<li class="row"><div><div>${esc(f.text)}${f.unverified ? ' <span class="badge warn">unverified</span>' : ''}</div>
<div class="meta">${esc(f.kind)}${f.subject ? ` · ${esc(f.subject)}` : ''} · ${esc(SOURCE[f.source] ?? f.source)} · ${esc(day(f.updatedAt))}${f.expiresAt ? ` · until ${esc(day(f.expiresAt))}` : ''}${f.unverified ? ' · saved right after Max read emails or web pages: check it is really yours' : ''}</div></div>
<div class="acts">${f.unverified ? post('/memory/confirm', { id: f.id, vault: v.name }, 'Confirm') : ''}
<form method="post" action="/memory/move" class="move">${hidden('id', f.id)}${hidden('vault', v.name)}<select name="to" aria-label="Move to">${others(v.name)}</select><button class="btn secondary" type="submit">Move</button></form>
${post('/memory/delete', { id: f.id, vault: v.name }, 'Forget')}</div></li>`,
            )
            .join('') + (shown.length > FACTS_SHOWN ? `<li class="empty">${shown.length - FACTS_SHOWN} more: use search to find them.</li>` : '')
        : `<li class="empty">${q ? 'Nothing matches.' : 'Nothing yet. Say "Hey Max, remember that…", or add a fact below.'}</li>`;
  const notes = v.notes.length
    ? v.notes.map((n) => `<li class="row"><div><div>${esc(n.summary)}</div><div class="meta">${esc(noteWhen(n))}</div></div>${post('/memory/delete', { id: n.id, type: 'note', vault: v.name }, 'Forget')}</li>`).join('')
    : `<li class="empty">${m.autoLearn ? 'Max files a one-line note after each conversation worth remembering.' : 'Conversation notes are off (MEMORY_AUTO_LEARN=off).'}</li>`;
  const kinds = ['fact', 'person', 'preference', 'routine', 'date', 'project'].map((k) => `<option>${k}</option>`).join('');
  return `<section id="memory"><h2>Memory</h2>
${m.passwordSet ? '' : '<p class="hint">Anyone who can open this page can read Max\'s memory. Set <code>PANEL_PASSWORD</code> in <code>.env</code> and restart Max.</p>'}
<p class="meta">${esc(m.modeText)} Personal: Work vault locked${m.workApps.length ? ' (and work apps)' : ''} · Work: Personal vault locked · Guest: only Household. Household is shared. <a href="#mode">Change mode</a></p>
<div class="tabs">${tabs}</div>
<form class="search" method="get" action="/#memory">${hidden('vault', v.name)}<input name="q" value="${esc(m.query ?? '')}" placeholder="Search ${VAULT_LABEL[v.name]}…"><button class="btn secondary" type="submit">Search</button></form>
<ul>${facts}</ul>
<form class="addfact" method="post" action="/memory/add">${hidden('vault', v.name)}<input name="fact" maxlength="300" required placeholder="Add to ${VAULT_LABEL[v.name]}, e.g. Sofia's birthday is 14 March"><select name="kind" aria-label="Kind">${kinds}</select><button class="btn" type="submit">Remember</button></form>
<p class="meta">Each vault is encrypted separately. Passwords, PINs and codes are never stored.</p></section>
<section><h2>${VAULT_LABEL[v.name]} conversations${v.totalNotes > v.notes.length ? ` (latest ${v.notes.length} of ${v.totalNotes}; Max can search them all)` : ''}</h2><ul>${notes}</ul>
<p class="meta">Older notes are rolled up into weekly, then monthly digests automatically.</p></section>
${activitySection(m.activity)}`;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const NOTES: Record<string, string> = {
  outlook: 'Office 365 email and calendar. Work or school accounts may need your IT admin to approve the first sign-in.',
  whatsapp:
    'Uses the official WhatsApp Business API: needs a WhatsApp Business account and number, not your personal WhatsApp. ' +
    'Meta restricts general-purpose AI assistants on this platform.',
};

const badge = (ok: boolean, yes = 'Connected', no = 'Not connected') =>
  `<span class="badge ${ok ? 'ok' : 'off'}">${ok ? yes : no}</span>`;

const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['myday', 'My Day'],
  ['routines', 'Routines'],
  ['max', 'Max'],
  ['memory', 'Memory'],
  ['projects', 'Projects'],
  ['connections', 'Connections'],
  ['settings', 'Settings'],
];

function myDayTile(m: NonNullable<PanelData['memory']>, tile: (href: string, k: string, v: string, meta: string) => string): string {
  const open = m.todos.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due.slice(0, 10) < m.today).length;
  const today = open.filter((t) => t.due?.slice(0, 10) === m.today).length;
  const critical = open.filter((t) => t.criticality === 'critical').length;
  return tile(
    '#tab-myday',
    'My Day',
    `${today} due today${overdue ? ` · <span class="warntext">${overdue} overdue</span>` : ''}`,
    `${critical} critical · ${open.length} open to-do${open.length === 1 ? '' : 's'}`,
  );
}

function newsTile(r: PanelRoutines, tile: (href: string, k: string, v: string, meta: string) => string): string {
  if (!r.list.length) return tile('#tab-routines', 'Routines', 'No news briefing yet', 'Set one up: Max prepares your news each morning');
  const first = r.list[0];
  const b = first.briefing;
  return tile(
    '#tab-routines',
    'News briefing',
    first.running ? 'Gathering now…' : b?.articles.length ? `${b.articles.length} articles ready` : 'Nothing gathered yet',
    `${first.daysText} at ${first.time}${r.list.length > 1 ? ` · ${r.list.length} routines` : ''}`,
  );
}

function updatesSection(u: NonNullable<PanelData['updates']>): string {
  if (!u.onBox) return '<section id="updates"><h2>Updates</h2><p class="meta">One-click updates work when Max runs on the Max box (Raspberry Pi).</p></section>';
  const v = u.version;
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const busy = u.state && ['checking', 'updating', 'rebooting'].includes(u.state.state);
  const state = u.state
    ? `<p class="${u.state.state === 'failed' ? 'hint' : 'meta'}">${busy ? '<span class="badge warn">in progress</span> ' : ''}${esc(u.state.message)} <span class="meta">(${esc(when(new Date(u.state.at).toISOString()))})</span></p>`
    : '';
  const a = u.available;
  const list = a && !a.error && a.behind
    ? `<p><b>${a.behind} new change${a.behind === 1 ? '' : 's'} available:</b></p><ul class="items">${a.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : a?.error
      ? `<p class="hint">${esc(a.error)}</p>`
      : a
        ? '<p class="meta">Max is up to date.</p>'
        : '';
  return `<section id="updates"><h2>Updates</h2>
<p class="meta">Installed: ${v ? `<b>${esc(v.subject)}</b> · ${esc(when(v.date))} · <code>${esc(v.sha.slice(0, 7))}</code>` : 'unknown (run the setup on the box once)'}</p>
${state}${busy ? '<span data-updating></span><p class="meta">Max restarts during the update: this page comes back by itself.</p>' : list}
<div class="acts" style="margin:12px 0">${!busy && a && a.behind ? '<form method="post" action="/updates/install"><button class="btn" type="submit">Update now</button></form>' : ''}
${busy ? '' : '<form method="post" action="/updates/check"><button class="btn secondary" type="submit">Check again</button></form>'}</div>
<form class="addfact" method="post" action="/updates/auto"><label class="meta"><input type="checkbox" name="auto" value="yes" ${u.auto.auto ? 'checked' : ''}> Install updates automatically at</label><input type="time" name="time" value="${esc(u.auto.time)}"><button class="btn secondary" type="submit">Save</button></form>
<p class="meta">New versions come from GitHub (${esc(v?.repo || 'your repository')}): merge a change there and it shows up here. Your settings, keys and Max's memory stay as they are.</p></section>`;
}

/** The front page: the mode switch, then one tile per area with its status; each tile opens its tab. */
function overview(d: PanelData): string {
  const m = d.memory;
  const modes = m
    ? (['personal', 'work', 'guest', 'auto'] as const)
        .map((x) => post('/mode', { mode: x }, x === 'auto' ? 'Automatic' : `${x[0].toUpperCase()}${x.slice(1)}`, `btn ${m.mode === x ? '' : 'secondary'}`))
        .join('')
    : '';
  const count = (list: { connected: boolean }[]) => `${list.filter((a) => a.connected).length} of ${list.length}`;
  const tile = (href: string, k: string, v: string, meta: string) =>
    `<a class="tile" href="${href}"><div class="k">${k}</div><div class="v">${v}</div><div class="meta">${meta}</div></a>`;
  const facts = m ? m.vaults.filter((v) => m.readable.includes(v.name)).reduce((n, v) => n + v.facts.length, 0) : 0;
  const tasks = m ? m.projects.reduce((n, p) => n + p.tasks.filter((t) => t.status === 'open').length, 0) : 0;
  const music = d.music && d.music.state !== 'off' ? (d.music.state === 'ready' ? badge(true, 'Ready') : badge(false, '', d.music.state === 'pairing' ? 'Sign-in needed' : 'Not running')) : '';
  const tiles = [
    d.composio.configured
      ? tile('#apps', 'Apps', `${count(d.composio.apps)} personal · ${count(d.composio.workApps)} work`, 'Email, calendar, messaging and more')
      : tile('#apps', 'Apps', badge(false, '', 'Not set up'), 'Add a Composio key to connect email and other apps'),
    tile('#web', 'Web search', d.web?.configured ? badge(d.web.connected) : badge(false, '', 'Not set up'), d.web?.remainingCredits !== undefined ? `${d.web.remainingCredits.toLocaleString('en-GB')} credits left` : 'Searching and reading web pages'),
    tile('#home-assistant', 'Home Assistant', badge(d.homeAssistant.connected), d.homeAssistant.connected ? `${d.homeAssistant.tools} actions` : 'Lights, heating and devices'),
    music ? tile('#music', 'Music', `Spotify ${music}`, d.music?.account ? `Signed in as ${esc(d.music.account)}` : 'Play music by voice') : '',
    m ? myDayTile(m, tile) : '',
    d.routines ? newsTile(d.routines, tile) : '',
    m ? tile('#tab-memory', 'Memory', `${facts} thing${facts === 1 ? '' : 's'} Max knows`, 'In the vaults open in this mode') : '',
    m ? tile('#tab-projects', 'Projects', `${m.projects.length} project${m.projects.length === 1 ? '' : 's'}`, `${tasks} open task${tasks === 1 ? '' : 's'}`) : '',
    d.soul ? tile('#tab-max', 'Personality', "Max's soul", 'Who he is and how he behaves in each mode') : '',
    d.location ? tile('#location', 'Home location', d.location.place ? esc(d.location.place) : badge(false, '', 'Not set'), 'For local answers and search results') : '',
  ].join('');
  return `${m ? `<section id="mode"><h2>Mode</h2><div class="name">${esc(m.modeText)}</div>
<p class="meta">Each mode has its own behaviour, memories and accounts. You can also say "Max, work mode", "personal mode" or "guest mode".</p>
<div class="modes">${modes}</div></section>` : ''}
<div class="tiles">${tiles}</div>`;
}

export function renderPanel(d: PanelData): string {
  const appRows = (list: PanelData['composio']['apps'], side: 'personal' | 'work') =>
    list.length
      ? list
          .map(
            (a) => `
      <li class="row">
        <div class="app">
          ${a.logo ? `<img src="${esc(a.logo)}" alt="" width="32" height="32">` : '<span class="ph"></span>'}
          <div>
            <div class="name">${esc(a.name)} ${badge(a.connected)}</div>
            <div class="meta">${a.connected ? `${a.toolsOffered} action${a.toolsOffered === 1 ? '' : 's'} available to Max` : esc(NOTES[a.slug] ?? `Sign in with your ${side} account.`)}</div>
            ${a.connected && NOTES[a.slug] ? `<div class="meta">${esc(NOTES[a.slug])}</div>` : ''}
          </div>
        </div>
        <a class="btn ${a.connected ? 'secondary' : ''}" href="/connect/${encodeURIComponent(a.slug)}?side=${side}">${a.connected ? 'Reconnect' : 'Connect'}</a>
      </li>`,
          )
          .join('')
      : `<li class="empty">${d.composio.error ? `Composio error: ${esc(d.composio.error)}` : 'Loading apps…'}</li>`;
  const apps = d.composio.configured
    ? `<li class="group"><h3>Personal accounts</h3><p class="meta">Used in personal mode: your own email, WhatsApp, Instagram…</p></li>${appRows(d.composio.apps, 'personal')}` +
      `<li class="group"><h3>Work accounts</h3><p class="meta">Used in work mode: your work email, calendar, LinkedIn… Until one is connected, work mode uses the personal accounts.</p></li>${appRows(d.composio.workApps, 'work')}`
    : `<li class="empty">Add <code>COMPOSIO_API_KEY</code> to <code>.env</code> (from <a href="https://platform.composio.dev" target="_blank" rel="noopener">platform.composio.dev</a>) and restart Max to connect Office 365, WhatsApp and other apps.</li>`;

  const hints = [
    d.composio.notEnabled.length
      ? `Connected in Composio but not enabled in Max: <b>${esc(d.composio.notEnabled.join(', '))}</b>. Add ${d.composio.notEnabled.length === 1 ? 'it' : 'them'} to <code>COMPOSIO_TOOLKITS</code> in <code>.env</code> and restart Max.`
      : '',
    d.composio.otherUser.length
      ? `Connected in Composio under a different user, so Max can't use ${d.composio.otherUser.length === 1 ? 'it' : 'them'}: <b>${esc(d.composio.otherUser.join(', '))}</b>. Add the app to <code>COMPOSIO_TOOLKITS</code> and connect it here, or set <code>COMPOSIO_USER_ID</code> to the user you used (Max uses "${esc(d.composio.userId)}").`
      : '',
  ].filter(Boolean).map((h) => `<li class="hint">${h}</li>`).join('');

  const servers = d.servers
    .filter((s) => s.name !== 'composio')
    .map(
      (s) => `<li class="row"><div><div class="name">${esc(s.name)} ${badge(s.connected)}</div>
        <div class="meta">${s.connected ? `${s.offered} of ${s.total} actions available to Max` : esc(s.error ?? '')}</div></div></li>`,
    )
    .join('');

  const show: Record<string, boolean> = { overview: true, myday: Boolean(d.memory), routines: Boolean(d.routines), max: Boolean(d.soul), memory: Boolean(d.memory), projects: Boolean(d.memory), connections: true, settings: true };
  const attention: Record<string, boolean> = {
    connections: Boolean(d.composio.error || d.composio.notEnabled.length || d.composio.otherUser.length || (d.web?.configured && !d.web.connected) || d.music?.state === 'pairing'),
    settings: Boolean(d.location && !d.location.place),
    routines: Boolean(d.routines?.list.some((r) => r.enabled && r.lastError && !r.running)),
    myday: Boolean(d.memory?.todos.some((t) => !t.done && t.due && t.due.slice(0, 10) < d.memory!.today)),
    memory: Boolean(d.memory?.vaults.some((v) => v.status !== 'open' || v.facts.some((f) => f.unverified))),
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Max Control Panel</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--muted:#5d6670;--line:#e3e6ea;--accent:#2f6fed;--ok:#1f8a4c;--okbg:#e5f5ec;--offbg:#eef0f2;--err:#b42318;--errbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--text:#e8eaed;--muted:#9aa3ad;--line:#2b3138;--accent:#6e9bff;--ok:#5fd18f;--okbg:#173524;--offbg:#252a31;--err:#ff8a80;--errbg:#3a1d1b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
h2{font-size:15px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
ul{list-style:none;margin:0;padding:0}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.row:first-child{border-top:0;padding-top:0}.app{display:flex;gap:12px;align-items:flex-start}.app img,.ph{width:32px;height:32px;border-radius:8px;flex:none;background:var(--offbg)}
.addfact,.search{display:flex;gap:8px;margin:12px 0 8px}.addfact input,.search input,select{flex:1;min-width:0;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
select{flex:none}.modes,.tabs,.acts{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.acts{margin:0;flex:none}.move{display:flex;gap:6px}
.tab{padding:6px 12px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--text)}.tab.on{border-color:var(--accent);color:var(--accent);font-weight:600}
.badge.warn{background:var(--errbg);color:var(--err)}.badge.imp{background:#fff4e0;color:#9a5b00}.warntext{color:var(--err)}
${ROUTINES_CSS}${MODELS_CSS}${SCREEN_CSS}
.wrap{flex-wrap:wrap}.level{align-items:center}.level label{width:84px;flex:none}.level input[type=range]{flex:1;accent-color:var(--accent)}.level span{width:44px;text-align:right}.edit{flex-wrap:wrap;margin:8px 0}summary{cursor:pointer}
h3{font-size:14px;margin:16px 0 8px}.stack{margin:12px 0}.stack .addfact{margin:6px 0}.danger{margin-top:20px;align-items:center;justify-content:space-between}
textarea{width:100%;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);resize:vertical;font-variant-ligatures:none}
input[type=date],input[type=time]{flex:none}details{margin-top:4px}.items{list-style:disc;padding-left:18px;color:var(--muted);font-size:13px}
.hint{border-top:1px solid var(--line);padding:12px 0;color:var(--err)}.group{padding:14px 0 2px}.group h3{margin:0}.group+.row{border-top:0}.add{margin:12px 0 0}
.name{font-weight:600}.meta{color:var(--muted);font-size:13px}.empty{color:var(--muted)}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;margin-left:6px;vertical-align:1px}
.badge.ok{background:var(--okbg);color:var(--ok)}.badge.off{background:var(--offbg);color:var(--muted)}
.btn{flex:none;background:var(--accent);color:#fff;text-decoration:none;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}
.notice{border-radius:10px;padding:10px 14px;margin-bottom:16px}.notice.ok{background:var(--okbg);color:var(--ok)}.notice.error{background:var(--errbg);color:var(--err)}
code{background:var(--offbg);padding:1px 5px;border-radius:5px;font-size:13px}a{color:var(--accent)}
form{margin:0}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
@media (max-width:520px){.row{flex-direction:column;align-items:stretch}.btn{text-align:center}.addfact{flex-wrap:wrap}.addfact input{flex-basis:100%}}
.nav{position:sticky;top:0;z-index:5;background:var(--bg);display:flex;gap:4px;overflow-x:auto;margin:0 -16px 16px;padding:8px 16px;border-bottom:1px solid var(--line);scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}.nav a{flex:none;padding:8px 14px;border-radius:999px;text-decoration:none;color:var(--muted);font-weight:600}
.nav a:hover{color:var(--text)}.nav a.on{background:var(--accent);color:#fff}.nav .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--err);margin-left:6px;vertical-align:2px}
section{scroll-margin-top:64px}.js .pane{display:none}.js .pane.on{display:block}.pane>h2.title{font-size:13px;margin:0 0 10px}
.jump{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.jump a{font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--text)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;text-decoration:none;color:var(--text)}
.tile:hover{border-color:var(--accent)}.tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}.tile .v{font-weight:600;margin:4px 0 2px}
</style><script>document.documentElement.className='js'</script></head><body data-tab="${esc(TABS.some((t) => t[0] === d.tab) ? d.tab : 'overview')}"><main>
<div class="top"><div><h1>Max</h1><p class="sub">Voice: ${esc(d.voice)}</p></div>
<div class="acts"><form method="post" action="/refresh"><button class="btn secondary" type="submit">Refresh</button></form>${d.memory?.passwordSet ? '<form method="post" action="/logout"><button class="btn secondary" type="submit">Sign out</button></form>' : ''}</div></div>
<nav class="nav" aria-label="Sections">${TABS.filter(([id]) => show[id]).map(([id, name]) => `<a href="#tab-${id}" data-tab="${id}">${name}${attention[id] ? '<span class="dot" title="Needs attention"></span>' : ''}</a>`).join('')}</nav>
${d.notice ? `<div class="notice ${d.notice.kind}">${esc(d.notice.text)}</div>` : ''}

<div class="pane" id="tab-overview">${overview(d)}</div>

<div class="pane" id="tab-myday">${d.memory ? myDaySection(d.memory) : ''}</div>

<div class="pane" id="tab-routines">${d.routines ? routinesSection(d.routines, esc) : ''}</div>

<div class="pane" id="tab-max">${d.soul ? soulSection(d.soul) : ''}</div>

<div class="pane" id="tab-memory">${d.memory ? memorySection(d.memory) : ''}</div>

<div class="pane" id="tab-projects">${d.memory ? projectsSection(d.memory) : ''}</div>

<div class="pane" id="tab-connections">
<div class="jump"><a href="#apps">Apps</a><a href="#web">Web search</a><a href="#home-assistant">Home Assistant</a>${musicSection(d.music) ? '<a href="#music">Music</a>' : ''}${servers ? '<a href="#servers">Other</a>' : ''}</div>
<section id="apps"><h2>Apps</h2><ul>${apps}${hints}</ul>
<p class="meta add">To add another app (e.g. linkedin, instagram, slack, notion), add its name to <code>COMPOSIO_TOOLKITS</code> (personal) or <code>COMPOSIO_WORK_TOOLKITS</code> (work) in <code>.env</code> and restart Max; it then appears here with a Connect button.</p></section>
<section id="web"><h2>Web search</h2><ul><li class="row"><div><div class="name">Firecrawl ${d.web?.configured ? badge(d.web.connected) : '<span class="badge off">Not set up</span>'}</div>
<div class="meta">${!d.web?.configured ? 'Add <code>FIRECRAWL_API_KEY</code> to <code>.env</code> (free key at <a href="https://firecrawl.dev" target="_blank" rel="noopener">firecrawl.dev</a>) and restart Max: he can then search the web and read pages.' : d.web.connected ? `Max can search the web and read pages${d.web.remainingCredits !== undefined ? ` · ${d.web.remainingCredits.toLocaleString('en-GB')} credits left` : ''}` : esc(d.web.error ?? 'Not reachable')}</div></div></li></ul></section>
<section id="home-assistant"><h2>Home Assistant</h2><ul><li class="row"><div><div class="name">Home Assistant ${badge(d.homeAssistant.connected)}</div>
<div class="meta">${d.homeAssistant.connected ? `${d.homeAssistant.tools} actions available to Max` : esc(d.homeAssistant.error ?? 'Not connected')}</div></div></li></ul></section>
${musicSection(d.music)}
${servers ? `<section id="servers"><h2>Other MCP servers</h2><ul>${servers}</ul></section>` : ''}
<p class="meta">Sending, replying, deleting and similar actions always need your spoken "yes" first.</p>
</div>

<div class="pane" id="tab-settings">${d.location ? locationSection(d.location) : ''}
${d.screen ? screenSection(d.screen, esc) : ''}
${d.models ? modelsSection(d.models, esc) : ''}
<section id="device"><h2>Device</h2>
${d.device ? `<form class="addfact level" method="post" action="/device/level"><label class="meta" for="vol">Volume</label><input id="vol" type="range" name="volume" min="0" max="100" step="5" value="${d.device.volume ?? 50}" ${d.device.volume === undefined ? 'disabled' : ''} oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="this.form.submit()"><span class="meta">${d.device.volume ?? '–'}%</span></form>
<form class="addfact level" method="post" action="/device/level"><label class="meta" for="bri">Brightness</label><input id="bri" type="range" name="brightness" min="5" max="100" step="5" value="${d.device.brightness}" ${!d.onBox || d.device.brightnessSupported === false ? 'disabled' : ''} oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="this.form.submit()"><span class="meta">${d.device.brightness}%</span></form>
${d.device.volume === undefined ? '<p class="meta">The speaker volume can\'t be read: is the sound system running?</p>' : ''}${d.onBox && d.device.brightnessSupported === false ? "<p class=\"meta\">This screen doesn't let the Pi change its brightness.</p>" : ''}` : ''}
${d.onBox
  ? `<p class="meta">Turn the Max box off safely before unplugging it, or restart it. You can also hold a finger on its screen for 2 seconds, or say "Max, turn off". To turn it on again, press the power button on the Raspberry Pi.</p>
<form class="addfact danger" method="post" action="/device/power"><input type="hidden" name="action" value="reboot"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Yes, restart Max now</label><button class="btn secondary" type="submit">Restart</button></form>
<form class="addfact danger" method="post" action="/device/power"><input type="hidden" name="action" value="poweroff"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Yes, turn Max off now</label><button class="btn secondary" type="submit">Turn off</button></form>`
  : '<p class="meta">Turning off and restarting are available when Max runs on the Max box (Raspberry Pi).</p>'}
</section>
${d.updates ? updatesSection(d.updates) : ''}
<section id="security"><h2>Security</h2><ul><li class="row"><div><div class="name">Panel password ${badge(Boolean(d.memory?.passwordSet), 'On', 'Off')}</div>
<div class="meta">${d.memory?.passwordSet ? 'This page asks for a password.' : 'Anyone on your network can open this page. Set <code>PANEL_PASSWORD</code> in <code>.env</code> and restart Max.'}</div></div></li>
${d.lock ? lockRow(d.lock) : ''}
<li class="row"><div><div class="name">Voice</div><div class="meta">${esc(d.voice)}</div></div></li></ul></section></div>
</main>
<script>
(function () {
  var panes = [].slice.call(document.querySelectorAll('.pane'));
  var links = [].slice.call(document.querySelectorAll('.nav a'));
  function route() {
    var id = decodeURIComponent(location.hash.slice(1));
    var el = id && document.getElementById(id);
    var pane = el && (el.classList.contains('pane') ? el : el.closest('.pane'));
    if (!pane) pane = document.getElementById('tab-' + document.body.getAttribute('data-tab')) || panes[0];
    panes.forEach(function (p) { p.classList.toggle('on', p === pane); });
    links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + pane.id); });
    if (el && el !== pane) el.scrollIntoView(); else window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
  // An update is running: Max restarts during it. Look every 10 s; reload when he's back.
  if (document.querySelector('[data-updating]')) {
    var down = false;
    setInterval(function () {
      fetch('/api/status', { cache: 'no-store' }).then(function (r) { if (r.ok && down) location.reload(); }).catch(function () { down = true; });
    }, 10000);
    setTimeout(function () { if (!down) location.reload(); }, 30000);
  }
  // Something is being prepared (website suggestions): look again shortly.
  if (document.querySelector('[data-wait]')) setTimeout(function () { location.reload(); }, 15000);
})();
</script></body></html>`;
}

function musicSection(m: PanelData['music']): string {
  if (!m || m.state === 'off') return '';
  const check = '<form method="post" action="/music/check"><button class="btn secondary" type="submit">Check again</button></form>';
  let body: string;
  if (m.state === 'ready') {
    body = `<li class="row"><div><div class="name">Spotify ${badge(true, 'Ready')}</div>
      <div class="meta">Signed in as ${esc(m.account)}. Say "Hey Max, play…", or pick <b>Max</b> as the speaker in the Spotify app.</div></div></li>`;
  } else if (m.state === 'pairing') {
    body = `<li class="row"><div><div class="name">Spotify ${badge(false, '', 'Sign-in needed')}</div>
      <div class="meta">${
        m.pairing
          ? `One-time step: open the link, sign in to Spotify and approve "Max". If asked, the code is <b>${esc(m.pairing.code)}</b>.`
          : 'Waiting for a sign-in code from the Spotify speaker…'
      }</div></div>${m.pairing ? `<a class="btn" href="${esc(m.pairing.url)}" target="_blank" rel="noopener">Sign in to Spotify</a>` : check}</li>`;
  } else {
    body = `<li class="row"><div><div class="name">Spotify ${badge(false, '', 'Not running')}</div>
      <div class="meta">Start the Spotify speaker: <code>docker compose --profile music up -d</code> (needs Spotify Premium). ${esc(m.error ?? '')}</div></div>${check}</li>`;
  }
  return `<section id="music"><h2>Music</h2><ul>${body}</ul></section>`;
}
