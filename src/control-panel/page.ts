/** HTML for the control panel. Server-rendered, no external assets, works on a phone. */
import { PanelRoutines, ROUTINES_CSS, routinesSection } from './routines-page';
import { jobsSection, PanelJobs } from './jobs-page';
import { MODELS_CSS, modelsSection, PanelModels } from './models-page';
import { DEVICES_CSS, devicesExtra, devicesParts } from './devices-page';
import { PanelScreen, SCREEN_CSS, screenSection } from './screen-page';
import { SPEAKER_TONES } from '../device/device.service';
import type { WhatsAppStatus } from '../whatsapp/whatsapp.service';
import { HEALTH_CSS, healthParts, PanelHealth } from './health-page';

export interface PanelData {
  /** Home Assistant on the Max box: the Devices tab. */
  homeDevices?: { enabled: boolean };
  /** Home automations (Devices tab). */
  automations?: {
    ready: boolean;
    error?: string;
    automations: { id?: string; entityId: string; name: string; description?: string; on: boolean; lastRun?: string; byMax: boolean }[];
    switches: { entityId: string; name: string; on: boolean }[];
    draft?: { id: string; name: string; summary: string; newSwitches: string[]; config: Record<string, unknown> };
  };
  music?: {
    state: string;
    account?: string;
    pairing?: { url: string; code: string };
    error?: string;
    radio?: { available: boolean; playing?: string };
    airplay?: { onBox: boolean; enabled: boolean; mode?: string; until?: number; code: string; locked: boolean; playing: boolean };
  };
  voice: string;
  routines?: PanelRoutines;
  /** Routines → Scheduled tasks. */
  jobs?: PanelJobs;
  /** Running on the Max box: the Device section can turn it off or restart it. */
  onBox?: boolean;
  device?: {
    volume?: number;
    brightness: number;
    brightnessSupported?: boolean;
    greeting?: string;
    greetAgainMin?: number;
    startSound?: boolean;
    tone?: string;
    /** The box's microphone (on the box only): off while muted, by the button on top or from here. */
    mic?: { muted: boolean };
  };
  /** The wake words installed, and the ones Max listens for (Settings → Voice & wake word). */
  wakeWords?: { available: string[]; active: string[]; error?: string };
  /** Max's recent log (Settings → Log). */
  log?: { at: number; level: string; context: string; message: string }[];
  /** The last "Hey Max" wake-ups and what happened to each. */
  wakeUps?: { list: { at: number; outcome: string; heard?: string; ms?: number; readyMs?: number }[]; verify: boolean; channel?: number };
  /** Real-time mode: Max's voice and speaking style. */
  liveVoice?: { active: boolean; provider: string; voice: string; style: string; voices: { id: string; label: string }[] };
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
  homeAssistant: { connected: boolean; tools: number; error?: string; where?: string };
  web?: { configured: boolean; connected: boolean; remainingCredits?: number; error?: string };
  trains?: { departures: boolean; journeys: boolean; home?: { crs: string; name: string } };
  whatsapp?: WhatsAppStatus;
  health?: PanelHealth;
  /** Devices signed in to this panel (Settings > Security). */
  devices?: { id: string; label: string; created: number; lastUsed: number; expires: number; current: boolean }[];
  location?: { place: string; postcode?: string; country: string; countries: Record<string, string> };
  /** Meetings: Max joins online meetings as a notetaker (Recall.ai). */
  meetings?: {
    enabled: boolean;
    /** Max can listen live and answer in meetings (the secure link is set up). */
    live: boolean;
    /** Max answers out loud in meetings (off: notes only). */
    speaks: boolean;
    projects: { id: string; name: string }[];
    settings: { ownerName: string; botName: string; ownerDefault: string; botDefault: string; ownerNow: string; botNow: string };
    monthMinutes: number;
    list: {
      id: string;
      title: string;
      platform: string;
      at: string;
      state: string;
      status: string;
      minutes?: number;
      turns: number;
      project?: string;
      projectId?: string;
      /** The project its transcript was added to. */
      filed?: string;
      /** The project it goes to once the transcript is ready. */
      fileWhenReady?: string;
      answers?: number;
      live?: string;
      liveOn?: boolean;
    }[];
    selected?: { id: string; title: string; platform: string; at: string; status: string; lines: { speaker: string; at: number; text: string }[]; notes?: MeetingNotesView; filed?: string };
  };
  /** About you: the person Max supports. */
  about?: { fields: { key: string; label: string; hint: string; kind: string; max: number; modes: string[]; value: string }[] };
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
  servers: { name: string; connected: boolean; offered: number; total: number; error?: string; duplicate?: boolean }[];
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
    passwordFromEnv?: boolean;
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
  /** "week:1" (unit:every) for a repeating to-do, and its words ("every week"). */
  repeat?: string;
  repeatText?: string;
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
  /** Meetings whose transcript was added to this project. */
  meetings?: { id: string; title: string; at: string; notes?: MeetingNotesView }[];
}

export interface MeetingNotesView {
  summary: string;
  decisions: string[];
  actions: string[];
}

/** A meeting's summary: what it was about, what was decided, what's to do. */
function notesHtml(n: MeetingNotesView): string {
  const list = (title: string, items: string[]) => (items.length ? `<p class="meta"><b>${title}</b></p><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<p>${esc(n.summary)}</p>${list('Decided', n.decisions)}${list("To do", n.actions)}`;
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

function liveVoiceForm(v: NonNullable<PanelData['liveVoice']>): string {
  if (!v.active) {
    return '<p class="meta"><b>Voice:</b> Max uses his standard voice (see docs/VOICES.md). In real-time mode (<code>VOICE_MODE=realtime</code>) you can choose his live voice here.</p>';
  }
  const list = v.voices.some((x) => x.id === v.voice) ? v.voices : [{ id: v.voice, label: v.voice }, ...v.voices];
  const opts = list.map((x) => `<option value="${esc(x.id)}" ${x.id === v.voice ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  return `<form class="stack" method="post" action="/voice/save">
<div class="addfact"><label class="meta" for="lv">Max's voice (${v.provider === 'gemini' ? 'Gemini Live' : 'OpenAI Realtime'})</label><select id="lv" name="voice">${opts}</select></div>
<div class="addfact"><input name="style" maxlength="400" value="${esc(v.style)}" placeholder="How he speaks, e.g. a warm, calm British accent, like a witty butler"></div>
<div class="addfact"><button class="btn secondary" type="submit" formaction="/voice/try">▶ Try it on Max</button><button class="btn" type="submit">Save</button></div>
<p class="meta">"Try it" plays a short sample on the box (takes a few seconds). Saving also re-records the greeting in the new voice.</p>
</form>`;
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

const SEEN: Record<string, string> = { 'personal,work,guest': 'Every mode (guests only hear your name)', 'personal,work': 'Personal and work mode', personal: 'Personal mode only' };

function aboutSection(a: NonNullable<PanelData['about']>): string {
  const name = a.fields.find((f) => f.key === 'name')?.value;
  const rows = a.fields
    .map((f) => {
      const id = `about-${f.key}`;
      const input =
        f.kind === 'text'
          ? `<textarea id="${id}" name="${f.key}" rows="2" maxlength="${f.max}" placeholder="${esc(f.hint)}">${esc(f.value)}</textarea>`
          : `<input id="${id}" name="${f.key}" ${f.kind === 'date' ? 'type="date"' : `maxlength="${f.max}"`} value="${esc(f.value)}" placeholder="${esc(f.hint)}">`;
      return `<div class="afield"><label for="${id}">${esc(f.label)}</label>${input}<div class="meta">Max knows this in: ${SEEN[f.modes.join(',')] ?? f.modes.join(', ')}</div></div>`;
    })
    .join('');
  return `<section id="about-you"><h2>About you</h2>
<p class="meta">Who Max supports. ${name ? `He knows you as <b>${esc(name)}</b>.` : '<b>Max doesn\'t know your name yet.</b>'} Fill in as much or as little as you like: he reads it at the start of every conversation and uses it naturally. You can also just tell him ("Max, my birthday is 14 March"). Each mode sees only its part, and it's kept encrypted with his memory.</p>
<form class="about" method="post" action="/about">${rows}<button class="btn" type="submit">Save</button></form></section>`;
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

const ON_NOW = ['joining', 'lobby', 'in-call', 'recording', 'ended'];

function automationsSection(a: NonNullable<PanelData['automations']>): string {
  if (!a.ready) return `<section id="automations"><h2>Automations</h2><p class="meta">${a.error ? `Couldn't read them: ${esc(a.error)}` : 'Home Assistant is still starting: automations show here once it is ready.'}</p></section>`;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
  const d = a.draft;
  const draft = d
    ? `<div class="card"><h3>Draft: ${esc(d.name)}</h3><p>${esc(d.summary)}</p>${d.newSwitches.length ? `<p class="meta">Adds a new on/off switch: <b>${d.newSwitches.map(esc).join(', ')}</b>.</p>` : ''}
<details><summary class="meta">The details (for Home Assistant)</summary><pre class="meta">${esc(JSON.stringify(d.config, null, 2))}</pre></details>
<div class="acts">${post('/automations/save', { draft: d.id }, 'Save it', 'btn')}${post('/automations/discard', { draft: d.id }, 'Discard')}</div></div>`
    : '';
  const autos = a.automations.length
    ? a.automations
        .map(
          (x) => `<li class="row auto"><div><div class="name">${esc(x.name)} <span class="badge ${x.on ? 'ok' : 'off'}">${x.on ? 'on' : 'off'}</span>${x.byMax ? ' <span class="badge">by Max</span>' : ''}</div>${x.description ? `<div class="meta">${esc(x.description)}</div>` : ''}<div class="meta">Last ran: ${esc(when(x.lastRun))}</div></div>
<div class="acts">${post('/automations/on', { entity: x.entityId, on: x.on ? '0' : '1' }, x.on ? 'Turn off' : 'Turn on')}${post('/automations/run', { entity: x.entityId }, 'Run now')}${x.id ? `<form class="addfact" method="post" action="/automations/rename">${hidden('id', x.id)}<input name="name" maxlength="80" required value="${esc(x.name)}" aria-label="New name"><button class="btn secondary" type="submit">Rename</button></form>` : ''}${x.id ? `<form class="addfact danger" method="post" action="/automations/delete">${hidden('id', x.id)}<label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete</label><button class="btn secondary" type="submit">Delete</button></form>` : ''}</div></li>`,
        )
        .join('')
    : '<li class="empty">No automations yet: describe one below.</li>';
  const switches = a.switches.length
    ? `<h3>Switches</h3><p class="meta">On/off switches automations can check (say "Max, turn on the alarm").</p><ul>${a.switches
        .map(
          (s) => `<li class="row"><div class="name">${esc(s.name)} <span class="badge ${s.on ? 'ok' : 'off'}">${s.on ? 'on' : 'off'}</span></div><div class="acts">${post('/automations/on', { entity: s.entityId, on: s.on ? '0' : '1' }, s.on ? 'Turn off' : 'Turn on', s.on ? 'btn secondary' : 'btn')}<form class="addfact danger" method="post" action="/automations/delete">${hidden('entity', s.entityId)}<label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete</label><button class="btn secondary" type="submit">Delete</button></form></div></li>`,
        )
        .join('')}</ul>`
    : '';
  return `<section id="automations"><h2>Automations</h2>
<p class="meta">Things the house does by itself. Describe one in your own words (when…, only if…, then…), or ask Max ("Max, make an automation: …"). He writes it, shows it to you here (or reads it back), and saves it once you agree. Automations never unlock, disarm or open anything.</p>
${draft}
<form class="stack" method="post" action="/automations/draft">
<textarea name="text" rows="3" maxlength="1500" required placeholder="e.g. When the alarm is on and I'm out, if the hallway motion sensor sees movement, turn on all the lights and say &quot;Motion in the hallway&quot;"></textarea>
<div class="addfact"><input name="name" maxlength="80" placeholder="Name (optional)"><button class="btn" type="submit">Write it</button></div></form>
<ul>${autos}</ul>
${switches}
<form class="addfact" method="post" action="/automations/switch"><input name="name" maxlength="40" required placeholder="New on/off switch, e.g. Alarm, Holiday, Guests"><button class="btn secondary" type="submit">Add switch</button></form>
</section>`;
}

/** Which wake words Max listens for: e.g. "Hey Jarvis" too, while your own "Hey Max" is being trained. */
function wakeWordsRow(w: NonNullable<PanelData['wakeWords']>): string {
  const say = (n: string) => n.replace(/_v\d.*$/, '').split('_').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
  const builtIn = new Set(['hey_jarvis', 'alexa', 'hey_mycroft', 'hey_rhasspy', 'ok_nabu', 'okay_nabu']);
  if (w.error) return `<p class="meta"><b>Wake words:</b> couldn't reach the wake-word service (${esc(w.error)}).</p>`;
  const boxes = w.available
    .map((n) => `<label class="check"><input type="checkbox" name="names" value="${esc(n)}" ${w.active.includes(n) ? 'checked' : ''}> "${esc(say(n))}"${builtIn.has(n) ? ' <span class="meta">(ready-made)</span>' : ' <span class="meta">(your own model)</span>'}</label>`)
    .join('');
  return `<form class="stack" method="post" action="/device/wake-words"><p class="meta"><b>Wake words</b>: Max wakes up for any of the ones ticked. The ready-made ones work well straight away; tick "Hey Jarvis" alongside "Hey Max" while your own model is being trained, then untick it. Changes work at once.</p>
<div class="addfact wrap">${boxes}</div><div class="acts"><button class="btn secondary" type="submit">Save wake words</button></div></form>`;
}

/** "Hey Max": the last wake-ups and what happened to each, for tuning. */
function wakeUpsSection(w: NonNullable<PanelData['wakeUps']>): string {
  const when = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const label: Record<string, [string, string]> = {
    woke: ['Woke up', 'ok'],
    repeat: ['Woke up (said twice)', 'ok'],
    unchecked: ['Woke up (not double-checked)', ''],
    ignored: ['Ignored: sounded like noise', 'warn'],
  };
  const rows = w.list.length
    ? w.list.map((e) => {
        const [text, cls] = label[e.outcome] ?? [e.outcome, ''];
        return `<li class="row"><div><div>${esc(when(e.at))} <span class="badge ${cls}">${esc(text)}</span></div>${e.heard !== undefined || e.ms !== undefined ? `<div class="meta">${e.heard !== undefined ? `Heard: "${esc(e.heard)}"` : 'Heard nothing'}${e.ms !== undefined ? ` · check took ${(e.ms / 1000).toFixed(1)} s` : ''}${e.readyMs !== undefined ? ` · listening after ${(e.readyMs / 1000).toFixed(1)} s` : ''}</div>` : ''}</div></li>`;
      }).join('')
    : '<li class="empty">No wake-ups since Max started.</li>';
  const ignored = w.list.filter((e) => e.outcome === 'ignored').length;
  return `<details class="wakeups"><summary><b>Wake-ups</b> <span class="meta">(last ${w.list.length}${ignored ? `, ${ignored} ignored` : ''})</span></summary>
<p class="meta">Every time the box heard something like "Hey Max"${w.verify ? ', and what the double-check made of it. "Ignored" means it heard the wake word but the words didn\'t sound like it: in a noisy room, say it again within 15 seconds and he wakes anyway.' : '. The double-check is off (WAKEWORD_VERIFY=off).'}${w.channel !== undefined ? ` Listening to microphone channel ${w.channel}.` : ''} Times he didn\'t hear you at all aren\'t listed: see docs/PI.md for tuning.</p>
<ul>${rows}</ul></details>`;
}

/** Microphone on/off (the same as the button on top of the box). */
function micSwitch(mic: { muted: boolean }, from: string): string {
  return `<div class="addfact"><div><b>Microphone ${mic.muted ? 'off' : 'on'}</b> <span class="badge ${mic.muted ? 'warn' : 'ok'}">${mic.muted ? "Max can't hear" : 'listening for "Hey Max"'}</span>
<div class="meta">${mic.muted ? 'Nothing reaches Max until you turn it on (here, or the button on top of the box).' : 'Turn it off when you want privacy: Max hears nothing, the same as the button on top of the box.'}</div></div>
${post('/device/mute', { on: mic.muted ? '0' : '1', from }, mic.muted ? 'Turn the microphone on' : 'Turn the microphone off', mic.muted ? 'btn' : 'btn secondary')}</div>`;
}

/** On the Home tab while the microphone is off, so it's never a surprise that Max doesn't answer. */
function micBanner(d: PanelData): string {
  const mic = d.device?.mic;
  if (!mic) return '';
  return mic.muted ? `<section id="mic" class="mic-off">${micSwitch(mic, 'home')}</section>` : `<div class="acts mic-on">${post('/device/mute', { on: '1', from: 'home' }, '🎙️ Mute the microphone')}</div>`;
}

function meetingsSection(m: NonNullable<PanelData['meetings']>): string {
  if (!m.enabled) {
    return `<section id="meetings"><h2>Meetings</h2>
<p class="meta">Max can join your Teams, Zoom and Google Meet meetings as a notetaker and bring back the transcript. It uses Recall.ai (about $0.65 per meeting hour): create an account at recall.ai (choose the EU region), then add its key to <code>.env</code> as <code>RECALL_API_KEY=…</code> and restart Max.</p></section>`;
  }
  const now = m.list.filter((x) => ON_NOW.includes(x.state));
  const past = m.list.filter((x) => !ON_NOW.includes(x.state));
  const len = (min?: number) => (min === undefined ? '' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const row = (x: (typeof m.list)[number]) =>
    `<li class="row"><div><div class="name">${esc(x.title)} <span class="badge ${x.state === 'ready' ? 'ok' : x.state === 'failed' ? 'off' : ''}">${esc(x.status)}</span></div>
<div class="meta">${esc(x.platform)} · ${esc(when(x.at))}${x.minutes !== undefined ? ` · ${len(x.minutes)}` : ''}${x.turns ? ` · ${x.turns} turns` : ''}${x.project ? ` · ${esc(x.project)}` : ''}${x.answers ? ` · answered you ${x.answers}×` : ''}</div>${ON_NOW.includes(x.state) && x.liveOn ? `<div class="meta">${esc(x.live ?? 'Live: no transcript lines received yet (they start once Max is taking notes)')}</div>` : ''}</div>
<div class="acts">${['joining', 'lobby', 'in-call', 'recording'].includes(x.state) ? post('/meetings/leave', { id: x.id }, 'Leave') : ''}${x.turns ? `<a class="btn secondary" href="/?meeting=${encodeURIComponent(x.id)}#meetings">Transcript</a>` : ''}${fileForm(x)}</div></li>`;
  // Adding the transcript to a project: now if it's ready, else as soon as it is.
  const fileForm = (x: (typeof m.list)[number], from = '') => {
    if (x.state === 'failed' || !m.projects.length) return '';
    if (x.filed) return `<span class="badge ok">in ${esc(x.filed)}</span>`;
    if (x.fileWhenReady) return `<span class="badge">goes to ${esc(x.fileWhenReady)} when ready</span>${post('/meetings/unfile', { id: x.id }, 'Cancel')}`;
    if (x.state === 'ready' && !x.turns) return '';
    const opts = m.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === x.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    return `<form class="addfact" method="post" action="/meetings/file">${hidden('id', x.id)}${from ? hidden('from', from) : ''}<select name="project" aria-label="Project">${opts}</select><button class="btn secondary" type="submit">${x.state === 'ready' ? 'Add to project' : 'Add to project when ready'}</button></form>`;
  };
  const sel = m.selected;
  const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const detail = sel
    ? `<section id="meeting-transcript"><h2>${esc(sel.title)}</h2>
<p class="meta">${esc(sel.platform)} · ${esc(when(sel.at))} · ${esc(sel.status)} · <a href="/meetings/transcript.txt?id=${encodeURIComponent(sel.id)}">Download as text</a> · <a href="/#meetings">Back to meetings</a></p>
<form class="addfact" method="post" action="/meetings/rename">${hidden('id', sel.id)}<input name="title" maxlength="120" required value="${esc(sel.title)}" aria-label="Meeting name"><button class="btn secondary" type="submit">Rename</button></form>
${sel.notes ? `<h3>Summary</h3>${notesHtml(sel.notes)}` : sel.lines.length ? `<p class="meta">No summary yet.</p>` : ''}
<div class="acts">${(() => {
        const x = m.list.find((y) => y.id === sel.id);
        return x ? fileForm(x, 'detail') : '';
      })()}${sel.lines.length ? post('/meetings/summarise', { id: sel.id }, sel.notes ? 'Write the summary again' : 'Write a summary') : ''}</div>
<h3>Transcript</h3>
<div class="transcript">${sel.lines.map((l) => `<p><span class="meta">${stamp(l.at)}</span> <b>${esc(l.speaker)}</b> ${esc(l.text)}</p>`).join('') || '<p class="meta">Nobody spoke.</p>'}</div>
<form class="addfact danger" method="post" action="/meetings/delete">${hidden('id', sel.id)}<label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete this meeting and its transcript</label><button class="btn secondary" type="submit">Delete</button></form></section>`
    : '';
  const cost = (m.monthMinutes / 60) * 0.65;
  return `<section id="meetings"><h2>Meetings</h2>
<p class="meta">Send Max to an online meeting: he joins as a notetaker, tells everyone in the meeting chat that he's transcribing, and brings back who said what.</p>
<form class="stack" method="post" action="/meetings/join">
<div class="addfact"><input name="link" type="url" required placeholder="Paste the meeting link (Teams, Zoom or Google Meet)" aria-label="Meeting link"></div>
<div class="addfact"><input name="title" maxlength="120" placeholder="What it's about (optional), e.g. Acme weekly with Marco" aria-label="Meeting name">${m.projects.length ? `<select name="project" aria-label="Project"><option value="">Project: from the name</option>${m.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : ''}<button class="btn" type="submit">Send Max</button></div></form>
<p class="meta">${m.live && !m.speaks ? `<b>Max only takes notes in meetings</b> (he won't answer out loud, even when you say "Max, …").` : m.live ? `<b>Max can answer you in meetings:</b> start with "Max, …" (only you, by your name in the meeting). He answers out loud from the meeting, general knowledge of its topic and its project, never anything personal.` : 'Max can also answer you out loud in meetings ("Max, what did we decide?"): this needs the secure link (Cloudflare Tunnel), see docs/MEETINGS.md.'}</p>
${m.live ? `<div class="acts">${m.speaks ? post('/meetings/speak', { on: '0' }, 'Notes only: don\'t answer out loud') : post('/meetings/speak', { on: '1' }, 'Let Max answer out loud')}</div>` : ''}
<p class="meta">Teams: if the meeting has a lobby, someone in it has to let Max in. This month: ${len(m.monthMinutes) || '0 min'} of meetings, about $${cost.toFixed(2)} at Recall.ai.</p>
${now.length ? `<h3>On now</h3><ul>${now.map(row).join('')}</ul>` : ''}
${past.length ? `<h3>Earlier</h3><ul>${past.slice(0, 30).map(row).join('')}</ul>` : '<p class="meta">No meetings yet.</p>'}
<h3>Names in meetings</h3>
<form class="stack about" method="post" action="/meetings/settings">
<div class="afield"><label for="m-owner">Max answers to</label><input id="m-owner" name="owner" maxlength="80" value="${esc(m.settings.ownerName)}" placeholder="${esc(m.settings.ownerDefault || 'Your name as it shows in Teams, e.g. Luca Licata')}">
<div class="meta">${m.settings.ownerNow ? `Now: <b>${esc(m.settings.ownerNow)}</b>${m.settings.ownerName ? '' : ' (from About you)'}. ` : '<b>Not set:</b> Max won\'t answer anyone until you add your name. '}Your name exactly as the meeting shows it. Only this person can ask Max questions out loud.</div></div>
<div class="afield"><label for="m-bot">Max's name in meetings</label><input id="m-bot" name="bot" maxlength="60" value="${esc(m.settings.botName)}" placeholder="${esc(m.settings.botDefault)}">
<div class="meta">What everyone sees when he joins${m.settings.botName ? ` (now "${esc(m.settings.botNow)}")` : ''}. Empty: "${esc(m.settings.botDefault)}".</div></div>
<button class="btn" type="submit">Save</button></form>
<div class="acts">${post('/meetings/check', {}, 'Check the Recall.ai connection')}${m.live ? post('/meetings/check-live', {}, 'Check the secure link') : ''}</div>
${now.length ? '<script>setTimeout(function () { var a = document.activeElement; if (!a || a === document.body) location.reload(); }, 15000);</script>' : ''}
</section>${detail}`;
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
${p.meetings?.length ? `<h3>Meetings</h3><ul>${p.meetings.map((x) => `<li class="row"><div><div class="name">${esc(x.title)} <span class="meta">· ${esc(day(x.at))}</span></div>${x.notes ? `<details><summary class="meta">Summary</summary>${notesHtml(x.notes)}</details>` : ''}</div><div class="acts"><a class="btn secondary" href="/?meeting=${encodeURIComponent(x.id)}#meetings">Transcript</a></div></li>`).join('')}</ul>` : ''}
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

/** How often a to-do comes round (the add and change forms); the panel's own forms take "unit:every". */
const REPEATS: [string, string][] = [['', 'Once'], ['day:1', 'Every day'], ['weekday:1', 'Weekdays'], ['week:1', 'Every week'], ['week:2', 'Every 2 weeks'], ['month:1', 'Every month'], ['month:3', 'Every 3 months'], ['year:1', 'Every year']];
const repeatSelect = (cur = '') =>
  `<select name="repeat" aria-label="Repeats" title="Repeats">${REPEATS.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

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
    const meta = [t.due ? `${late ? 'was due' : 'due'} ${shortDate(t.due)}` : '', t.repeatText ? `🔁 ${esc(t.repeatText)}` : '', t.projectName ? `📁 ${esc(t.projectName)}` : `${VAULT_LABEL[t.vault]} list`, t.assignee ? esc(t.assignee) : '']
      .filter(Boolean)
      .join(' · ');
    const [date, time] = (t.due ?? '').split('T');
    return `<li class="row"><div style="flex:1;min-width:0"><div>${esc(t.title)}${badges}</div><div class="meta">${meta}</div>
<details><summary class="meta">Change</summary><form class="addfact edit" method="post" action="/todo/update">${hidden('id', t.id)}${levelSelects(t.priority, t.criticality)}${repeatSelect(t.repeat ?? '')}
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
<p class="meta">${summary}. Ask Max "what's going on in my day?" for a briefing with your calendar. <b>Priority</b> = how soon; <b>criticality</b> = what's at stake if it slips. A repeating to-do (every day, week, month…) comes back with its next date when you tick it off, and Max reminds you each time.</p>
<form class="stack" method="post" action="/todo/add">
<div class="addfact"><input name="title" maxlength="200" required placeholder="New to-do, e.g. Renew the car insurance"></div>
<div class="addfact wrap">${levelSelects()}${repeatSelect()}<input type="date" name="date" aria-label="Due date"><input type="time" name="time" aria-label="Time (optional, for a spoken reminder)">
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
${m.passwordSet ? '' : '<p class="hint">Anyone who can open this page can read Max\'s memory. Set <code>PANEL_PASSWORD</code> in <code>.env</code> (on the Max box the panel always asks for one).</p>'}
<p class="meta">${esc(m.modeText)} Personal: Work vault locked${m.workApps.length ? ' (and work apps)' : ''} · Work: Personal vault locked · Guest: only Household. Household is shared. <a href="#mode">Change mode</a></p>
<div class="tabs">${tabs}</div>
<form class="search" method="get" action="/#memory">${hidden('vault', v.name)}<input name="q" value="${esc(m.query ?? '')}" placeholder="Search ${VAULT_LABEL[v.name]}…"><button class="btn secondary" type="submit">Search</button></form>
<ul>${facts}</ul>
<form class="addfact" method="post" action="/memory/add">${hidden('vault', v.name)}<input name="fact" maxlength="300" required placeholder="Add to ${VAULT_LABEL[v.name]}, e.g. Sofia's birthday is 14 March"><select name="kind" aria-label="Kind">${kinds}</select><button class="btn" type="submit">Remember</button></form>
<p class="meta">Each vault is encrypted separately. Passwords, PINs and codes are never stored.</p></section>
<section id="conversations"><h2>Conversations <span class="meta">${VAULT_LABEL[v.name]}${v.totalNotes > v.notes.length ? ` · latest ${v.notes.length} of ${v.totalNotes}; Max can search them all` : ''}</span></h2><ul>${notes}</ul>
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

/** A part of an area: its own entry in the area's sub-menu. `one`: its sections show one at a time. */
interface Part {
  id: string;
  label: string;
  html: string;
  one?: boolean;
}

/** The menu: every area in order, its group (Every day / Set up) and a line on what it's for. */
const AREAS: { id: string; label: string; group: 'day' | 'setup'; about: string }[] = [
  { id: 'overview', label: 'Home', group: 'day', about: 'Max today: his mode, the microphone and whatever needs you.' },
  { id: 'myday', label: 'My Day', group: 'day', about: 'Your to-do list and your meetings.' },
  { id: 'projects', label: 'Projects', group: 'day', about: 'Each project with its people, tasks and memory.' },
  { id: 'health', label: 'Health', group: 'day', about: 'Exercise, meals, heart, sleep and weight.' },
  { id: 'devices', label: 'Devices', group: 'day', about: 'Your lights, heating and devices, through Home Assistant on the box.' },
  { id: 'routines', label: 'Routines', group: 'day', about: 'Jobs Max does on a schedule: your news briefing and your own scheduled tasks.' },
  { id: 'max', label: "Max's memory & personality", group: 'setup', about: 'What Max knows about you, what he remembers, and who he is.' },
  { id: 'connections', label: 'Connections', group: 'setup', about: 'The accounts and services Max can use.' },
  { id: 'settings', label: 'Settings', group: 'setup', about: 'How the Max box behaves: its sound, voice, screen and software.' },
];
const GROUP_LABEL: Record<'day' | 'setup', string> = { day: 'Every day', setup: 'Set up' };
/** The phone's bottom bar: the first four of these that exist, then More (everything, grouped). */
const BAR = ['overview', 'myday', 'health', 'devices', 'projects'];
/** Old addresses: areas that became part of another, and the old tab names. */
const ALIAS: Record<string, string> = { 'tab-memory': 'memory', 'tab-meetings': 'meetings', 'tab-max': 'about-you' };
const TAB_ALIAS: Record<string, string> = { memory: 'max', meetings: 'myday' };

/** Simple line icons for the phone's bottom bar (24px grid). */
const ICON: Record<string, string> = {
  overview: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  myday: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  health: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z',
  devices: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const icon = (id: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${id === 'more' ? 3 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[id] ?? ICON.more}"/></svg>`;

/** Settings → Log: what Max did lately (the same lines as the box's Docker log, never message content). */
function logSection(lines: NonNullable<PanelData['log']>): string {
  const t = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const shown = lines.slice(-200).reverse();
  const problems = lines.filter((l) => l.level === 'warn' || l.level === 'error').length;
  const rows = shown
    .map((l) => `<div class="logline ${esc(l.level)}"><span class="meta">${esc(t(l.at))}</span> <b>${esc(l.context)}</b> ${esc(l.message)}</div>`)
    .join('');
  return `<section id="log"><h2>Log</h2>
<p class="meta">What Max has been doing, newest first (the last ${shown.length} of ${lines.length} lines since he started${problems ? `; <span class="warntext">${problems} warnings or errors</span>` : ''}). The same lines as the box's own log: actions, timings and problems, never what was said. If something went wrong, download the log and send it to whoever helps you.</p>
<div class="acts"><a class="btn secondary" href="/log.txt" download="max-log.txt">Download the log</a><a class="btn secondary" href="/#log">Refresh</a></div>
<div class="logbox">${rows || '<p class="empty">Nothing yet.</p>'}</div></section>`;
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


/** Something that needs the user: listed on Home with a link, and a dot on its area in the menu. */
interface Attention {
  area: string;
  href: string;
  where: string;
  text: string;
}

function attentionItems(d: PanelData): Attention[] {
  const out: Attention[] = [];
  const m = d.memory;
  if (m) {
    const overdue = m.todos.filter((t) => !t.done && t.due && t.due.slice(0, 10) < m.today);
    if (overdue.length) out.push({ area: 'myday', href: '#myday', where: 'My Day', text: `<b>${overdue.length} to-do${overdue.length === 1 ? ' is' : 's are'} overdue</b> · ${esc(overdue.slice(0, 3).map((t) => t.title).join(', '))}${overdue.length > 3 ? '…' : ''}` });
    const closed = m.vaults.filter((v) => v.status !== 'open');
    if (closed.length) out.push({ area: 'max', href: '#memory', where: 'Max › Memory', text: `<b>A memory vault can't be opened</b> · ${esc(closed.map((v) => VAULT_LABEL[v.name]).join(', '))}` });
    const unverified = m.vaults.filter((v) => m.readable.includes(v.name)).reduce((n, v) => n + v.facts.filter((f) => f.unverified).length, 0);
    if (unverified) out.push({ area: 'max', href: '#memory', where: 'Max › Memory', text: `<b>${unverified} memor${unverified === 1 ? 'y' : 'ies'} to confirm</b> · saved right after Max read something: check ${unverified === 1 ? "it's" : "they're"} true` });
  }
  if (d.device?.mic?.muted) out.push({ area: 'overview', href: '#mode', where: 'Home', text: "<b>The microphone is off</b> · Max can't hear you" });
  if (d.music?.state === 'pairing') out.push({ area: 'connections', href: '#music', where: 'Connections › Music', text: "<b>Spotify needs a sign-in</b> · music by voice won't work until then" });
  if (d.composio.error) out.push({ area: 'connections', href: '#apps', where: 'Connections › Apps', text: `<b>Apps can't be reached</b> · ${esc(d.composio.error)}` });
  if (d.composio.notEnabled.length || d.composio.otherUser.length) out.push({ area: 'connections', href: '#apps', where: 'Connections › Apps', text: `<b>Some apps aren't usable yet</b> · ${esc([...d.composio.notEnabled, ...d.composio.otherUser].join(', '))}` });
  if (d.web?.configured && !d.web.connected) out.push({ area: 'connections', href: '#web', where: 'Connections › Web & trains', text: `<b>Web search isn't working</b>${d.web.error ? ` · ${esc(d.web.error)}` : ''}` });
  if (d.homeAssistant.error && (d.homeDevices?.enabled || d.homeAssistant.where)) out.push({ area: 'connections', href: '#home-assistant', where: 'Connections › Home Assistant', text: `<b>Home Assistant isn't connected</b> · ${esc(d.homeAssistant.error)}` });
  if (d.whatsapp?.note) out.push({ area: 'connections', href: '#whatsapp', where: 'Connections › WhatsApp', text: `<b>WhatsApp</b> · ${esc(d.whatsapp.note)}` });
  for (const r of d.routines?.list ?? []) if (r.enabled && r.lastError && !r.running) out.push({ area: 'routines', href: '#routines', where: 'News briefing', text: `<b>${esc(r.name)} failed last time</b> · ${esc(r.lastError)}` });
  for (const p of d.health?.plans ?? []) if (p.enabled && p.lastError && !p.running) out.push({ area: 'health', href: `#plan-${esc(p.id)}`, where: 'Health › Plans', text: `<b>${esc(p.name)} failed last time</b> · ${esc(p.lastError)}` });
  if (d.location && !d.location.place) out.push({ area: 'settings', href: '#location', where: 'Settings › Home location', text: '<b>Home location not set</b> · for local answers, trains and the weather' });
  if (d.updates?.onBox && d.updates.available?.behind && !d.updates.auto.auto) out.push({ area: 'settings', href: '#updates', where: 'Settings › Updates', text: `<b>An update is ready</b> · ${d.updates.available.behind} change${d.updates.available.behind === 1 ? '' : 's'} since your version` });
  if (d.updates?.state?.state === 'failed') out.push({ area: 'settings', href: '#updates', where: 'Settings › Updates', text: `<b>The last update failed</b> · ${esc(d.updates.state.message)}` });
  return out;
}

/** Home: mode and microphone, what needs attention, today's numbers, and whether everything is connected. */
function overview(d: PanelData, items: Attention[]): string {
  const m = d.memory;
  const mic = d.device?.mic;
  const modes = m
    ? (['personal', 'work', 'guest', 'auto'] as const)
        .map((x) => post('/mode', { mode: x }, x === 'auto' ? 'Automatic' : `${x[0].toUpperCase()}${x.slice(1)}`, `btn ${m.mode === x ? '' : 'secondary'}`))
        .join('')
    : '';
  const mode = `<section id="mode"${mic?.muted ? ' class="mic-off"' : ''}><h2>Mode and microphone</h2>
${m ? `<div class="name">${esc(m.modeText)}</div><p class="meta">Each mode has its own behaviour, memories and accounts. You can also say "Max, work mode", "personal mode" or "guest mode".</p><div class="modes">${modes}</div>` : ''}
${mic ? micSwitch(mic, 'home') : ''}</section>`;
  const attention = `<section id="attention"${items.length ? ' class="attn"' : ''}><h2>Needs your attention${items.length ? ` · ${items.length}` : ''}</h2>
${items.length ? `<ul>${items.map((i) => `<li class="row"><div>${i.text}</div><a class="btn secondary" href="${i.href}">${esc(i.where)}</a></li>`).join('')}</ul>` : '<p class="meta">Nothing: everything is set up and working.</p>'}</section>`;

  const tile = (href: string, k: string, v: string, meta: string) => `<a class="tile" href="${href}"><div class="k">${k}</div><div class="v">${v}</div><div class="meta">${meta}</div></a>`;
  const tiles: string[] = [];
  if (m) {
    const open = m.todos.filter((t) => !t.done);
    const today = open.filter((t) => t.due?.slice(0, 10) === m.today).length;
    const critical = open.filter((t) => t.criticality === 'critical').length;
    tiles.push(tile('#myday', 'My Day', `${today} due today`, `${critical} critical · ${open.length} open to-do${open.length === 1 ? '' : 's'}`));
  }
  if (d.meetings?.enabled) {
    const now = d.meetings.list.filter((x) => ON_NOW.includes(x.state));
    if (now.length) tiles.push(tile('#meetings', 'Meetings', `In a meeting: ${esc(now[0].title)}`, now[0].status));
  }
  if (d.health) {
    const h = d.health;
    const day = h.meals?.days.find((x) => x.date === h.today);
    const dinner = day?.meals.dinner ?? day?.meals.lunch;
    const toBuy = h.shopping.filter((i) => !i.done).length;
    tiles.push(tile('#health-meals', 'Health', dinner ? `${day?.meals.dinner ? 'Dinner' : 'Lunch'}: ${esc(dinner.name)}` : h.meals ? 'Nothing planned today' : 'No meal plan yet', toBuy ? `${toBuy} item${toBuy === 1 ? '' : 's'} to buy` : 'Shopping list done'));
  }
  if (d.music) {
    const a = d.music.airplay;
    const now = d.music.radio?.playing ? `📻 ${esc(d.music.radio.playing)}` : a?.playing ? '📱 AirPlay' : 'Nothing playing';
    const code = a?.onBox ? (!a.enabled ? 'AirPlay off' : a.locked ? 'AirPlay off while Max is locked' : `AirPlay code <b>${esc(a.code)}</b>`) : 'Radio, Spotify and AirPlay';
    tiles.push(tile('#music', 'Music', now, code));
  }
  if (d.routines) {
    const first = d.routines.list[0];
    const b = first?.briefing;
    tiles.push(first
      ? tile('#routines', 'News briefing', first.running ? 'Gathering now…' : b?.articles.length ? `${b.articles.length} articles ready` : 'Nothing gathered yet', `${first.daysText} at ${first.time}`)
      : tile('#routines', 'News briefing', 'Not set up', 'Max prepares your news each morning'));
  }
  const today = `<h2 class="sh">Today</h2><div class="tiles">${tiles.join('')}</div>`;

  const count = (list: { connected: boolean }[]) => `${list.filter((a) => a.connected).length} of ${list.length} connected`;
  const srow = (href: string, name: string, meta: string, state: 'ok' | 'off' | 'warn', label: string) =>
    `<li class="row"><div><div class="name">${name} <span class="badge ${state}">${label}</span></div><div class="meta">${meta}</div></div><a class="btn secondary" href="${href}">Open</a></li>`;
  const status: string[] = [];
  status.push(d.composio.configured
    ? srow('#apps', 'Apps', `${count(d.composio.apps)} personal · ${count(d.composio.workApps)} work`, d.composio.error ? 'warn' : 'ok', d.composio.error ? 'Check' : 'Fine')
    : srow('#apps', 'Apps', 'Email, calendar and other apps', 'off', 'Not set up'));
  if (d.whatsapp) status.push(srow('#whatsapp', 'WhatsApp', d.whatsapp.state === 'connected' ? `Linked${d.whatsapp.phone ? ` · ${esc(d.whatsapp.phone)}` : ''} · ${d.whatsapp.readable.length + 1} chat${d.whatsapp.readable.length ? 's' : ''} visible` : 'Max reads and sends messages once a phone is linked', d.whatsapp.state === 'connected' ? 'ok' : 'off', d.whatsapp.state === 'connected' ? 'Fine' : d.whatsapp.state === 'off' ? 'Not linked' : 'Connecting'));
  if (d.music && d.music.state !== 'off') status.push(srow('#music', 'Spotify', d.music.account ? `Signed in as ${esc(d.music.account)}` : 'Play music by voice', d.music.state === 'ready' ? 'ok' : 'warn', d.music.state === 'ready' ? 'Fine' : d.music.state === 'pairing' ? 'Sign-in needed' : 'Not running'));
  status.push(d.homeAssistant.connected
    ? srow('#home-assistant', 'Home Assistant', `${d.homeAssistant.tools} actions`, 'ok', 'Fine')
    : srow('#home-assistant', 'Home Assistant', d.homeAssistant.error ? esc(d.homeAssistant.error) : 'Lights, heating and devices', d.homeAssistant.where || d.homeDevices?.enabled ? 'warn' : 'off', d.homeAssistant.where || d.homeDevices?.enabled ? 'Check' : 'Not set up'));
  status.push(d.web?.configured
    ? srow('#web', 'Web search', d.web.remainingCredits !== undefined ? `${d.web.remainingCredits.toLocaleString('en-GB')} credits left` : 'Searching and reading web pages', d.web.connected ? 'ok' : 'warn', d.web.connected ? 'Fine' : 'Check')
    : srow('#web', 'Web search', 'Searching and reading web pages', 'off', 'Not set up'));
  if (d.trains) status.push(srow('#trains', 'Trains', d.trains.home ? `Home station: ${esc(d.trains.home.name)}` : 'Live departures and journeys', d.trains.departures || d.trains.journeys ? 'ok' : 'off', d.trains.departures || d.trains.journeys ? 'Fine' : 'Not set up'));
  if (d.meetings) status.push(srow('#meetings', 'Meetings', d.meetings.enabled ? 'Max can join as a notetaker' : 'Max joins online meetings as a notetaker', d.meetings.enabled ? 'ok' : 'off', d.meetings.enabled ? 'Fine' : 'Not set up'));
  const connected = `<section id="status"><h2>Is everything connected?</h2><ul>${status.join('')}</ul></section>`;
  return `${mode}${attention}${today}${connected}`;
}

/** The first section's address in a part's HTML (what its sub-menu entry links to). */
const firstId = (html: string) => /<section id="([^"]+)"/.exec(html)?.[1] ?? '';

/** A second row of pills for a part whose sections show one at a time: one per section, from its heading. */
function pills(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/<section id="([^"]+)"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/g)) {
    const label = m[2].replace(/<span[^>]*>[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&(amp|#39|quot|lt|gt);/g, (_, e: string) => ({ amp: '&', '#39': "'", quot: '"', lt: '<', gt: '>' })[e as 'amp']).replace(/^[^\p{L}\p{N}]+/u, '').split(/ · | \(/)[0].trim();
    if (label) out.push(`<a href="#${m[1]}">${esc(label)}</a>`);
  }
  return out.length > 1 ? `<nav class="sub sub2" aria-label="Parts">${out.join('')}</nav>` : '';
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
        <div class="meta">${s.connected ? `${s.offered} of ${s.total} actions available to Max` : esc(s.error ?? '')}</div>${s.duplicate ? `<div class="meta"><b>This looks like another Home Assistant.</b> Max ignores its device actions and uses ${esc(d.homeAssistant.where ?? 'the main one')}. To remove it, delete "${esc(s.name)}" from config/mcp-servers.json (or set "enabled": false) and restart Max.</div>` : ''}</div></li>`,
    )
    .join('');
  const items = attentionItems(d);
  const m = d.memory;
  const tab = TAB_ALIAS[d.tab ?? ''] ?? d.tab;

  // Settings › Device: the box itself (microphone, sound, screen brightness, power).
  const deviceSection = `<section id="device"><h2>Device</h2>
${d.device?.mic ? micSwitch(d.device.mic, 'device') : ''}
${d.device ? `<form class="addfact level" method="post" action="/device/level"><label class="meta" for="vol">Volume</label><input id="vol" type="range" name="volume" min="0" max="100" step="5" value="${d.device.volume ?? 50}" ${d.device.volume === undefined ? 'disabled' : ''} oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="this.form.submit()"><span class="meta">${d.device.volume ?? '–'}%</span></form>
<form class="addfact level" method="post" action="/device/level"><label class="meta" for="bri">Brightness</label><input id="bri" type="range" name="brightness" min="5" max="100" step="5" value="${d.device.brightness}" ${!d.onBox || d.device.brightnessSupported === false ? 'disabled' : ''} oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="this.form.submit()"><span class="meta">${d.device.brightness}%</span></form>
${d.onBox ? `<form class="stack" method="post" action="/device/sound"><p class="meta"><b>Speaker sound</b></p>
${Object.entries(SPEAKER_TONES).map(([k, label]) => `<label class="meta tick"><input type="radio" name="tone" value="${k}" ${(d.device!.tone ?? 'flat') === k ? 'checked' : ''} onchange="this.form.submit()"> ${esc(label)}</label>`).join('')}
<noscript><button class="btn" type="submit">Save</button></noscript></form>` : ''}
${d.device.volume === undefined ? '<p class="meta">The speaker volume can\'t be read: is the sound system running?</p>' : ''}${d.onBox && d.device.brightnessSupported === false ? "<p class=\"meta\">This screen doesn't let the Pi change its brightness.</p>" : ''}` : ''}
${d.onBox
  ? `<p class="meta">Turn the Max box off safely before unplugging it, or restart it. You can also hold a finger on its screen for 2 seconds, or say "Max, turn off". To turn it on again, press the power button on the Raspberry Pi.</p>
<form class="addfact danger" method="post" action="/device/power"><input type="hidden" name="action" value="reboot"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Yes, restart Max now</label><button class="btn secondary" type="submit">Restart</button></form>
<form class="addfact danger" method="post" action="/device/power"><input type="hidden" name="action" value="poweroff"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Yes, turn Max off now</label><button class="btn secondary" type="submit">Turn off</button></form>`
  : '<p class="meta">Turning off and restarting are available when Max runs on the Max box (Raspberry Pi).</p>'}

</section>`;
  // Settings › Voice & wake word: how Max listens and speaks.
  const voiceSection = `<section id="voice"><h2>Voice &amp; wake word</h2>
${d.wakeWords ? wakeWordsRow(d.wakeWords) : ''}
${d.wakeUps ? wakeUpsSection(d.wakeUps) : ''}
${d.device ? `<form class="stack" method="post" action="/device/voice">
<div class="addfact"><label class="meta" for="greet">When you say "Hey Max", he answers</label><input id="greet" name="greeting" maxlength="120" value="${esc(d.device.greeting ?? '')}" placeholder="Leave empty for a short beep"></div>
<div class="addfact"><label class="meta" for="greet-again">Say it again only after</label><select id="greet-again" name="greetAgain">${[
      [0, 'Every time'],
      [5, '5 minutes'],
      [10, '10 minutes'],
      [30, '30 minutes'],
      [60, '1 hour'],
    ]
      .map(([v, l]) => `<option value="${v}" ${v === (d.device!.greetAgainMin ?? 10) ? 'selected' : ''}>${l}</option>`)
      .join('')}</select><span class="meta">of quiet. Sooner than that, "Hey Max" gets just the short beep.</span></div>
<div class="addfact"><label class="meta"><input type="checkbox" name="startSound" value="on" ${d.device.startSound !== false ? 'checked' : ''}> Play a short jingle when Max starts (after a restart or an update)</label><button class="btn" type="submit">Save</button></div>
<p class="meta">To end a conversation, say "stop", "that's all" or "thank you", on its own or in a sentence ("that was really helpful, thank you"). A request after it still goes through ("thanks, can you also set a timer").</p>
</form>` : ''}
${d.liveVoice ? liveVoiceForm(d.liveVoice) : ''}
</section>`;

  const parts: Record<string, (Part | false | undefined | '')[]> = {
    overview: [{ id: 'home', label: 'Home', html: overview(d, items) }],
    myday: [m && { id: 'todo', label: 'To-do list', html: myDaySection(m) }, d.meetings && { id: 'meetings', label: 'Meetings', html: meetingsSection(d.meetings) }],
    projects: [m && { id: 'projects', label: 'Projects', html: projectsSection(m) }],
    health: d.health ? healthParts(d.health, esc) : [],
    devices: d.homeDevices?.enabled ? [...devicesParts(), d.automations && { id: 'automations', label: 'Automations', html: automationsSection(d.automations) }] : [],
    routines: [d.routines && { id: 'routines', label: 'News briefing', html: routinesSection(d.routines, esc) }, d.jobs && { id: 'jobs', label: 'Scheduled tasks', html: jobsSection(d.jobs, esc) }],
    max: [d.about && { id: 'about', label: 'About you', html: aboutSection(d.about) }, m && { id: 'memory', label: 'Memory', html: memorySection(m), one: true }, d.soul && { id: 'soul', label: 'Personality', html: soulSection(d.soul) }],
    connections: [
      { id: 'apps', label: 'Apps', html: `<section id="apps"><h2>Apps</h2><ul>${apps}${hints}</ul>
<p class="meta add">To add another app (e.g. linkedin, instagram, slack, notion), add its name to <code>COMPOSIO_TOOLKITS</code> (personal) or <code>COMPOSIO_WORK_TOOLKITS</code> (work) in <code>.env</code> and restart Max; it then appears here with a Connect button.</p></section>` },
      d.whatsapp && { id: 'whatsapp', label: 'WhatsApp', html: whatsappSection(d.whatsapp) },
      { id: 'music', label: 'Music', html: musicSection(d.music) },
      { id: 'home', label: 'Home Assistant', html: `<section id="home-assistant"><h2>Home Assistant</h2><ul><li class="row"><div><div class="name">Home Assistant ${badge(d.homeAssistant.connected)}</div>
<div class="meta">${d.homeAssistant.where ? `${esc(d.homeAssistant.where)} · ` : ''}${d.homeAssistant.connected ? `${d.homeAssistant.tools} actions available to Max` : esc(d.homeAssistant.error ?? 'Not connected')}</div></div></li></ul>
<p class="meta">Max uses one Home Assistant. ${d.homeDevices?.enabled ? 'It runs on this box: manage your devices on the Devices tab. Any earlier Home Assistant connection is no longer used.' : 'To change it, edit HA_MCP_URL and HA_TOKEN in .env.'}</p></section>${servers ? `<section id="servers"><h2>Other MCP servers</h2><ul>${servers}</ul></section>` : ''}` },
      { id: 'web', label: 'Web & trains', html: `<section id="web"><h2>Web search</h2><ul><li class="row"><div><div class="name">Firecrawl ${d.web?.configured ? badge(d.web.connected) : '<span class="badge off">Not set up</span>'}</div>
<div class="meta">${!d.web?.configured ? 'Add <code>FIRECRAWL_API_KEY</code> to <code>.env</code> (free key at <a href="https://firecrawl.dev" target="_blank" rel="noopener">firecrawl.dev</a>) and restart Max: he can then search the web and read pages.' : d.web.connected ? `Max can search the web and read pages${d.web.remainingCredits !== undefined ? ` · ${d.web.remainingCredits.toLocaleString('en-GB')} credits left` : ''}` : esc(d.web.error ?? 'Not reachable')}</div></div></li></ul></section>${d.trains ? trainsSection(d.trains) : ''}` },
    ],
    settings: [
      { id: 'device', label: 'Device', html: deviceSection },
      { id: 'voice', label: 'Voice & wake word', html: voiceSection },
      d.screen && { id: 'screen', label: 'Screen', html: screenSection(d.screen, esc) },
      d.location && { id: 'location', label: 'Home location', html: locationSection(d.location) },
      d.models && { id: 'models', label: 'AI models', html: modelsSection(d.models, esc) },
      d.updates && { id: 'updates', label: 'Updates', html: updatesSection(d.updates) },
      d.log && { id: 'log', label: 'Log', html: logSection(d.log) },
      { id: 'security', label: 'Security', html: `<section id="security"><h2>Security</h2><ul><li class="row"><div><div class="name">Panel password ${badge(Boolean(d.memory?.passwordSet), 'On', 'Off')}</div>
<div class="meta">${d.memory?.passwordSet ? 'This page asks for a password.' : 'Anyone who can open this page can use it. Set <code>PANEL_PASSWORD</code> in <code>.env</code> (on the Max box the panel always asks for one).'}</div>
${d.memory?.passwordSet && !d.memory.passwordFromEnv ? `<form class="stack" method="post" action="/security/password" style="margin-top:8px">
<input type="password" name="current" placeholder="Current password" required autocomplete="current-password">
<input type="password" name="password" placeholder="New password (8+ characters)" minlength="8" required autocomplete="new-password">
<input type="password" name="again" placeholder="New password again" minlength="8" required autocomplete="new-password">
<div><button class="btn secondary" type="submit">Change password</button></div></form>` : d.memory?.passwordFromEnv ? '<div class="meta">Set in <code>.env</code> (<code>PANEL_PASSWORD</code>): change it there.</div>' : ''}</div></li>
${d.devices ? devicesRow(d.devices) : ''}
${d.lock ? lockRow(d.lock) : ''}
<li class="row"><div><div class="name">Voice</div><div class="meta">${esc(d.voice)}</div></div></li></ul></section>` },
    ],
  };
  const areas = AREAS.map((a) => ({ ...a, parts: (parts[a.id] ?? []).filter((p): p is Part => Boolean(p && p.html)) })).filter((a) => a.parts.length);
  const flag = (area: string) => items.some((i) => i.area === area);
  const dot = (on: boolean, title = 'Needs attention') => (on ? `<span class="dot" title="${title}"></span>` : '');

  const pane = (a: (typeof areas)[number]) => {
    const sub = a.parts.length > 1
      ? `<nav class="sub" aria-label="${esc(a.label)} parts">${a.parts.map((p) => `<a href="#${firstId(p.html)}" data-part="${p.id}">${esc(p.label)}${dot(items.some((i) => i.area === a.id && p.html.includes(`id="${i.href.slice(1)}"`)))}</a>`).join('')}</nav>`
      : '';
    const body = a.parts.map((p) => `<div class="part" data-part="${p.id}"${p.one ? ' data-one' : ''}>${p.one ? pills(p.html) : ''}${p.html}</div>`).join('');
    const extra = a.id === 'devices' ? devicesExtra() : a.id === 'connections' ? '<p class="meta">Sending, replying, deleting and similar actions always need your spoken "yes" first.</p>' : '';
    return `<div class="pane" id="tab-${a.id}"><div class="phead"><h1>${esc(a.label)}</h1><p class="meta">${esc(a.about)}</p></div>${sub}${body}${extra}</div>`;
  };
  const menu = (['day', 'setup'] as const)
    .map((g) => `<div class="mgroup"><div class="mtitle">${GROUP_LABEL[g]}</div>${areas.filter((a) => a.group === g).map((a) => `<a href="#tab-${a.id}" data-tab="${a.id}"><span>${esc(a.label)}</span>${dot(flag(a.id))}</a>`).join('')}</div>`)
    .join('');
  const acts = `<div class="sacts"><form method="post" action="/refresh"><button class="btn secondary" type="submit">Refresh</button></form>${d.memory?.passwordSet ? '<form method="post" action="/logout"><button class="btn secondary" type="submit">Sign out</button></form>' : ''}</div>`;
  const barIds = BAR.filter((id) => areas.some((a) => a.id === id)).slice(0, 4);
  const bar = barIds.map((id) => `<a href="#tab-${id}" data-tab="${id}">${icon(id)}${esc(areas.find((a) => a.id === id)!.label)}${dot(flag(id))}</a>`).join('')
    + `<button type="button" id="moreBtn" aria-controls="sheet" aria-expanded="false">${icon('more')}More${dot(areas.some((a) => !barIds.includes(a.id) && flag(a.id)), 'Something in the menu needs attention')}</button>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Max Control Panel</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--muted:#5d6670;--line:#e3e6ea;--accent:#2f6fed;--ok:#1f8a4c;--okbg:#e5f5ec;--offbg:#eef0f2;--err:#b42318;--errbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--text:#e8eaed;--muted:#9aa3ad;--line:#2b3138;--accent:#6e9bff;--ok:#5fd18f;--okbg:#173524;--offbg:#252a31;--err:#ff8a80;--errbg:#3a1d1b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
h2{font-size:15px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
ul{list-style:none;margin:0;padding:0}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.row:first-child{border-top:0;padding-top:0}.mic-off{border:1px solid var(--err);background:var(--errbg)}.mic-on{justify-content:flex-end;margin:0 0 12px}.row.auto{flex-direction:column;align-items:stretch}.row.auto .acts{flex-wrap:wrap;align-items:center}.row.auto .addfact{margin:0;flex:1 1 260px}.row.auto .addfact input{min-width:0}.app{display:flex;gap:12px;align-items:flex-start}.app img,.ph{width:32px;height:32px;border-radius:8px;flex:none;background:var(--offbg)}
.addfact,.search{display:flex;gap:8px;margin:12px 0 8px}.addfact input,.search input,select{flex:1;min-width:0;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
select{flex:none}.modes,.tabs,.acts{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.acts{margin:0;flex:none}.move{display:flex;gap:6px}
.tab{padding:6px 12px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--text)}.tab.on{border-color:var(--accent);color:var(--accent);font-weight:600}
.badge.warn{background:var(--errbg);color:var(--err)}.badge.imp{background:#fff4e0;color:#9a5b00}.warntext{color:var(--err)}
${ROUTINES_CSS}${MODELS_CSS}${SCREEN_CSS}${DEVICES_CSS}${HEALTH_CSS}
.logbox{max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg)}.logline{white-space:pre-wrap;word-break:break-word}.logline.warn{color:#b26b00}.logline.error{color:var(--err)}
.wrap{flex-wrap:wrap}.level{align-items:center}.level label{width:84px;flex:none}.level input[type=range]{flex:1;accent-color:var(--accent)}.level span{width:44px;text-align:right}.edit{flex-wrap:wrap;margin:8px 0}summary{cursor:pointer}
h3{font-size:14px;margin:16px 0 8px}.stack{margin:12px 0}.stack .addfact{margin:6px 0}.danger{margin-top:20px;align-items:center;justify-content:space-between}
.about .afield{margin:0 0 14px}.about label{display:block;font-weight:600;margin:0 0 4px}.about input{display:block;width:100%;max-width:420px;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}.about textarea{box-sizing:border-box}.about .meta{margin-top:3px;font-size:13px}
.transcript{max-height:70vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:10px 0;background:var(--bg)}.transcript p{margin:6px 0;line-height:1.45}.addfact input[type=url]{flex:1 1 auto;min-width:0}
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
.stack input[type=password]{display:block;width:100%;max-width:340px;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);margin:6px 0}

.shell{display:flex;min-height:100vh}.side{display:none}
main{flex:1 1 auto;min-width:0;max-width:820px;margin:0 auto;padding:16px 16px 96px}
.phead{margin:4px 0 14px}.phead h1{font-size:24px;margin:0}.phead p{margin:2px 0 0}h2.sh{margin:4px 0 10px}
.mgroup{padding:8px 0}.mtitle{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;padding:6px 12px}
.mgroup a{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:8px;text-decoration:none;color:var(--text);font-weight:600}.mgroup a:hover{background:var(--bg)}.mgroup a.on{background:var(--accent);color:#fff}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--err);flex:none}
.sub{position:sticky;top:0;z-index:5;background:var(--bg);display:flex;gap:6px;flex-wrap:wrap;padding:8px 0 10px;margin:0 0 12px;border-bottom:1px solid var(--line)}
.sub a{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:999px;text-decoration:none;color:var(--muted);font-weight:600;font-size:14px}.sub a:hover{color:var(--text)}.sub a.on{background:var(--accent);color:#fff}
.sub2{position:static;border-bottom:0;padding:0;margin:0 0 10px}.sub2 a{font-size:13px;padding:5px 11px;border:1px solid var(--line);color:var(--text)}.sub2 a.on{border-color:var(--accent);background:transparent;color:var(--accent)}
.js .pane{display:none}.js .pane.on{display:block}.js .part{display:none}.js .part.on{display:block}.js .part[data-one]>section{display:none}.js .part[data-one]>section.on{display:block}
section{scroll-margin-top:72px}
.bar{position:fixed;left:0;right:0;bottom:0;z-index:10;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--card);border-top:1px solid var(--line);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
.bar a,.bar button{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;font:inherit;font-size:11px;font-weight:600;text-decoration:none;color:var(--muted);background:none;border:0;cursor:pointer;position:relative}.bar svg{width:22px;height:22px}.bar .on{color:var(--accent)}.bar .dot{position:absolute;top:4px;left:calc(50% + 8px)}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:20}.scrim[hidden],.sheet[hidden]{display:none}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:85vh;overflow-y:auto;background:var(--card);border-radius:16px 16px 0 0;z-index:21;padding:12px 12px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -8px 24px rgba(0,0,0,.15)}
.dhead{display:flex;justify-content:space-between;align-items:center;padding:0 4px 4px}.dhead button{border:0;background:none;font-size:20px;color:var(--muted);cursor:pointer;padding:6px}
.sacts{display:flex;gap:8px;padding:12px 4px 0}.sacts form{flex:1}.sacts .btn{width:100%;text-align:center}
.attn{border-color:var(--err)}.attn h2{color:var(--err)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px}
.tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;text-decoration:none;color:var(--text)}.tile:hover{border-color:var(--accent)}.tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}.tile .v{font-weight:600;margin:4px 0 2px}
@media (min-width:900px){.side{display:flex;flex-direction:column;flex:0 0 240px;position:sticky;top:0;height:100vh;overflow-y:auto;box-sizing:border-box;padding:20px 12px;background:var(--card);border-right:1px solid var(--line)}.brand{font-size:22px;font-weight:700;padding:0 12px 14px}.side .sacts{margin-top:auto}.bar{display:none}main{padding:24px 32px 48px}}
</style><script>document.documentElement.className='js'</script></head><body data-tab="${esc(AREAS.some((t) => t.id === tab) ? tab : 'overview')}"><div class="shell">
<aside class="side"><div class="brand">Max</div><nav aria-label="Menu">${menu}</nav>${acts}</aside>
<main>
${d.notice ? `<div class="notice ${d.notice.kind}">${esc(d.notice.text)}</div>` : ''}
${areas.map(pane).join('\n')}
</main></div>
<nav class="bar" aria-label="Menu">${bar}</nav>
<div class="scrim" id="scrim" hidden></div>
<div class="sheet" id="sheet" hidden><div class="dhead"><b>Menu</b><button type="button" id="sheetClose" aria-label="Close">✕</button></div><nav aria-label="All areas">${menu}</nav>${acts}</div>
<script>
(function () {
  var panes = [].slice.call(document.querySelectorAll('.pane'));
  var menuLinks = [].slice.call(document.querySelectorAll('[data-tab]'));
  var sheet = document.getElementById('sheet'), scrim = document.getElementById('scrim'), moreBtn = document.getElementById('moreBtn');
  var ALIAS = ${JSON.stringify(ALIAS)};
  function openMenu(open) {
    sheet.hidden = !open; scrim.hidden = !open;
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var first = sheet.querySelector('a.on') || sheet.querySelector('a'); if (first) first.focus(); }
  }
  moreBtn.addEventListener('click', function () { openMenu(sheet.hidden); });
  scrim.addEventListener('click', function () { openMenu(false); });
  document.getElementById('sheetClose').addEventListener('click', function () { openMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) openMenu(false); });
  [].slice.call(sheet.querySelectorAll('a')).forEach(function (a) { a.addEventListener('click', function () { openMenu(false); }); });
  // The address says where we are: #tab-health (an area), #health-meals (a part, or a section inside one).
  function route() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (ALIAS[id]) id = ALIAS[id];
    var el = id ? document.getElementById(id) : null;
    var pane = el && (el.classList.contains('pane') ? el : el.closest('.pane'));
    if (!pane) { pane = document.getElementById('tab-' + document.body.getAttribute('data-tab')) || panes[0]; el = null; }
    var parts = [].slice.call(pane.querySelectorAll(':scope > .part'));
    var part = (el && el !== pane && el.closest('.part')) || parts[0];
    panes.forEach(function (p) { p.classList.toggle('on', p === pane); });
    parts.forEach(function (p) { p.classList.toggle('on', p === part); });
    var sec = null;
    if (part && part.hasAttribute('data-one')) {
      var secs = [].slice.call(part.querySelectorAll(':scope > section'));
      var inner = el && el !== part ? (secs.indexOf(el) >= 0 ? el : el.closest('section')) : null;
      sec = inner && secs.indexOf(inner) >= 0 ? inner : secs[0];
      secs.forEach(function (s) { s.classList.toggle('on', s === sec); });
      [].slice.call(part.querySelectorAll('.sub2 a')).forEach(function (a) { a.classList.toggle('on', !!sec && a.getAttribute('href') === '#' + sec.id); });
    }
    [].slice.call(pane.querySelectorAll(':scope > .sub a')).forEach(function (a) { a.classList.toggle('on', !!part && a.getAttribute('data-part') === part.getAttribute('data-part')); });
    var inBar = false;
    menuLinks.forEach(function (a) { var on = a.getAttribute('data-tab') === pane.id.slice(4); a.classList.toggle('on', on); if (on && a.closest('.bar')) inBar = true; });
    moreBtn.classList.toggle('on', !inBar);
    var first = part && (sec || part.querySelector(':scope > section'));
    if (el && el !== pane && el !== part && el !== first) el.scrollIntoView(); else window.scrollTo(0, 0);
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
  if (!m) return '';
  const extra = radioRow(m.radio) + airplayRow(m.airplay);
  if (m.state === 'off') return extra ? `<section id="music"><h2>Music</h2><ul>${extra}</ul></section>` : '';
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
  return `<section id="music"><h2>Music</h2><ul>${body}${extra}</ul></section>`;
}

function radioRow(r: NonNullable<PanelData['music']>['radio']): string {
  if (!r) return '';
  return `<li class="row"><div><div class="name">Internet radio ${r.available ? badge(true, r.playing ? 'Playing' : 'Ready') : badge(false, '', 'Update needed')}</div>
<div class="meta">${r.available
    ? `${r.playing ? `Now: <b>${esc(r.playing)}</b>. ` : ''}Free, no account. Say "Hey Max, play BBC Radio 2", "play some jazz radio" or "play the radio" (the last station).`
    : 'Update Max (Settings → Updates) to get the radio player.'}</div></div></li>`;
}

function airplayRow(a: NonNullable<PanelData['music']>['airplay']): string {
  if (!a) return '';
  if (!a.onBox) return '<li class="row"><div><div class="name">AirPlay</div><div class="meta">Available on the Max box: it appears as a speaker on iPhones, iPads and Macs.</div></div></li>';
  const until = a.until ? new Date(a.until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const state = !a.enabled ? badge(false, '', 'Off') : a.locked ? badge(false, '', 'Off while Max is locked') : badge(true, a.playing ? 'Playing' : a.mode === 'timed' ? `On until ${until}` : 'Always on');
  const btn = (value: string, label: string, primary = false) =>
    `<form method="post" action="/music/airplay"><input type="hidden" name="for" value="${value}"><button class="btn ${primary ? '' : 'secondary'}" type="submit">${label}</button></form>`;
  return `<li class="row"><div style="width:100%"><div class="name">AirPlay ${state}</div>
<div class="meta">Max appears as the speaker <b>Max</b> on your iPhone, iPad or Mac, so any app (Apple Music, YouTube Music, podcasts…) can play through him. The first time, the device asks for this code and remembers it:</div>
<div class="name" style="font-size:28px;letter-spacing:.3em;margin:8px 0">${esc(a.code)}</div>
<div class="addfact wrap">${a.enabled ? btn('off', 'Turn off', true) : ''}${btn('60', a.enabled && a.mode === 'timed' ? 'On for 1 more hour' : 'On for 1 hour', !a.enabled)}${btn('240', 'On for 4 hours')}${a.mode !== 'always' ? btn('always', 'Always on') : ''}
<form method="post" action="/music/airplay-code" onsubmit="return confirm('Every phone and computer will have to enter the new code. Continue?')"><button class="btn secondary" type="submit">New code</button></form></div>
<p class="meta">Off unless you switch it on, so nobody nearby can spend hours guessing the code. When the time is up it switches off by itself (after the music then playing has stopped). Or say "Max, turn on AirPlay for an hour". It's also off while Max is locked. A new code makes every device ask again.</p></div></li>`;
}

/** Connections > WhatsApp: link a phone (QR code), and the people Max may send messages to. */
function whatsappSection(w: WhatsAppStatus): string {
  const state =
    w.state === 'connected' ? badge(true, `Linked${w.phone ? ` · ${esc(w.phone)}` : ''}`)
    : w.state === 'linking' ? '<span class="badge">Waiting for the scan</span>'
    : w.state === 'connecting' ? '<span class="badge">Connecting…</span>'
    : '<span class="badge off">Not linked</span>';
  const link =
    w.state === 'linking'
      ? `<div id="waQr" style="max-width:260px;background:#fff;padding:10px;border-radius:12px;margin:10px 0">${w.qrSvg ?? ''}</div>
<p class="meta">On your phone: <b>WhatsApp → Settings → Linked devices → Link a device</b>, then scan this code. It changes every few seconds; this page keeps it up to date.</p>
<script>(function(){var t=setInterval(function(){fetch('/whatsapp/status').then(function(r){return r.json()}).then(function(s){if(s.state!=='linking'){clearInterval(t);location.href='/#whatsapp';return}if(s.qrSvg)document.getElementById('waQr').innerHTML=s.qrSvg}).catch(function(){})},3000)})()</script>`
      : w.state === 'off'
        ? '<form method="post" action="/whatsapp/link"><button class="btn" type="submit">Link a phone</button></form>'
        : `<form method="post" action="/whatsapp/unlink" onsubmit="return confirm('Unlink WhatsApp? Max will forget the login and the messages he kept.')"><button class="btn secondary" type="submit">Unlink</button></form>`;
  const people = w.allowed
    .map(
      (a) => `<div class="addfact"><span class="meta"><b>${esc(a.name)}</b> · ${esc(a.shown)}</span>
<form method="post" action="/whatsapp/disallow"><input type="hidden" name="number" value="${esc(a.number)}"><button class="btn secondary" type="submit">Remove</button></form></div>`,
    )
    .join('');
  return `<section id="whatsapp"><h2>WhatsApp</h2><ul><li class="row"><div style="flex:1"><div class="name">Your WhatsApp ${state}</div>
<div class="meta">"Any new WhatsApp messages?", "what did Magda say?", "message Magda that I'm on my way". Max joins as a linked device, like WhatsApp Web, but only sees your own chat and the chats you allow below, and keeps their last 7 days of messages on the box, encrypted. He's never shown as online, so your phone still gets its notifications, and reading here doesn't mark anything as read. Not in guest mode or while Max is locked.</div>
${w.note ? `<p class="meta"><b>${esc(w.note)}</b></p>` : ''}
${w.received ? receivedRow(w.received) : ''}
${link}</div></li>
${readableRow(w)}
<li class="row"><div style="flex:1"><div class="name">Who Max may send messages to</div>
<div class="meta">Max only sends to the people on this list, and only after reading the message back and hearing your "yes". He can't add people himself.</div>
${people || '<p class="meta">Nobody yet: Max can read your messages but not send any.</p>'}
<form class="addfact" method="post" action="/whatsapp/allow"><input name="name" maxlength="40" placeholder="Name, e.g. Magda" aria-label="Name" required><input name="number" maxlength="24" placeholder="+44 7700 900123" aria-label="Phone number" inputmode="tel" required><button class="btn" type="submit">Add</button></form>
</div></li></ul>
<p class="meta">This uses WhatsApp's linked-devices feature through unofficial software (not a WhatsApp product). WhatsApp unlinks devices when the phone has been offline for about 14 days: link again then. You can also unlink Max from the phone (Linked devices).</p>
</section>`;
}

/** The sandbox: Max sees your own chat, plus only the chats added here. */
function readableRow(w: WhatsAppStatus): string {
  const rows = w.readable
    .map(
      (r) => `<div class="addfact"><span class="meta"><b>${esc(r.name)}</b> · ${esc(r.shown)}</span>
<form method="post" action="/whatsapp/read-remove"><input type="hidden" name="id" value="${esc(r.id)}"><button class="btn secondary" type="submit">Remove</button></form></div>`,
    )
    .join('');
  const groups = w.groups?.length
    ? `<form class="addfact" method="post" action="/whatsapp/read-allow"><select name="group" aria-label="Group">${w.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select><button class="btn" type="submit">Add group</button></form>`
    : w.state === 'connected'
      ? '<form class="addfact" method="post" action="/whatsapp/groups"><button class="btn secondary" type="submit">Show my groups</button></form>'
      : '';
  const chat = `<li class="row"><div style="flex:1"><div class="name">Chat with Max ${w.chat ? badge(true, 'On') : '<span class="badge off">Off</span>'}</div>
<div class="meta">Write to Max in your own chat ("Message yourself", the chat with your own number) and he answers there, starting with 🤖: anything you'd ask him out loud ("what's on tomorrow?", "remind me at 6 to call Mum", "turn off the heating"). Only you can reach him this way, and he asks for your typed "yes" before sending or changing anything.</div>
<form method="post" action="/whatsapp/chat"><input type="hidden" name="on" value="${w.chat ? 'no' : 'yes'}"><button class="btn secondary" type="submit">${w.chat ? 'Switch off' : 'Switch on'}</button></form></div></li>`;
  return `${chat}<li class="row"><div style="flex:1"><div class="name">Chats Max can see</div>
<div class="meta"><b>Only your own chat</b> ("Message yourself", where Max sends you things) <b>and the chats on this list.</b> Every other chat is dropped the moment it reaches Max: never kept, named or shown to his AI. Removing a chat deletes what he kept from it.</div>
${rows || '<p class="meta">None yet: Max sees only your own chat.</p>'}
<form class="addfact" method="post" action="/whatsapp/read-allow"><input name="name" maxlength="40" placeholder="Name, e.g. Magda" aria-label="Name" required><input name="number" maxlength="24" placeholder="+44 7700 900123" aria-label="Phone number" inputmode="tel" required><button class="btn" type="submit">Add person</button></form>
${groups}
</div></li>`;
}

/** What has reached Max (no message text): shows at a glance whether messages arrive, and whether they can be read. */
function receivedRow(r: NonNullable<WhatsAppStatus['received']>): string {
  const t = (ms?: number) => (ms ? new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const recent = r.recent.map((c) => `${esc(c.name)} (${c.messages}, ${t(c.lastAt)})`).join(' · ');
  return `<p class="meta"><b>Since Max started:</b> ${r.messages} message${r.messages === 1 ? '' : 's'} received${r.lastAt ? `, the last at ${t(r.lastAt)}` : ''}${r.unreadable ? ` · <b>${r.unreadable} couldn't be decrypted</b> (if this keeps growing, Unlink and link again)` : ''}${r.ignored ? ` · ${r.ignored} from chats Max may not see, dropped unread` : ''}.<br>
<b>Kept on the box:</b> ${r.kept} message${r.kept === 1 ? '' : 's'} in ${r.chats} chat${r.chats === 1 ? '' : 's'} (last 7 days, text only).${recent ? `<br><b>Latest chats:</b> ${recent}` : ''}</p>`;
}

function trainsSection(t: NonNullable<PanelData['trains']>): string {
  const row = (name: string, on: boolean, yes: string, no: string) =>
    `<li class="row"><div><div class="name">${name} ${on ? badge(true) : '<span class="badge off">Not set up</span>'}</div><div class="meta">${on ? yes : no}</div></div></li>`;
  return `<section id="trains"><h2>Trains</h2><ul>
${row('Live departures (National Rail)', t.departures, '"When\'s the next train to Waterloo?", "is the 8:15 on time?": times, delays, platforms', 'Add <code>RAIL_DATA_KEY</code> to <code>.env</code> (free at <a href="https://raildata.org.uk" target="_blank" rel="noopener">raildata.org.uk</a>, "Live Departure Board" product) and restart Max. See docs/TRAINS.md.')}
${row('Journey planning (Google Maps)', t.journeys, '"Trains to Manchester tomorrow morning", "get me to Bath by 10": options on the screen with a QR code to book on Trainline', 'Add <code>GOOGLE_MAPS_API_KEY</code> (Routes API) to <code>.env</code> and restart Max. See docs/TRAINS.md.')}
</ul>
<form class="addfact" method="post" action="/trains/home"><label class="meta" for="homeSt">Home station (the "from" when you don't say)</label><input id="homeSt" name="station" maxlength="60" value="${esc(t.home?.name ?? '')}" placeholder="e.g. Twickenham"><button class="btn" type="submit">Save</button></form>
</section>`;
}

/** Settings > Security: the devices signed in to the panel, each with Sign out. */
function devicesRow(devices: NonNullable<PanelData['devices']>): string {
  const when = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const rows = devices
    .map(
      (x) => `<div class="addfact"><span class="meta"><b>${esc(x.label)}</b>${x.current ? ' (this device)' : ''} · signed in ${when(x.created)} · last used ${when(x.lastUsed)}</span>
<form method="post" action="/security/device-remove"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn secondary" type="submit">Sign out</button></form></div>`,
    )
    .join('');
  const others = devices.filter((x) => !x.current).length;
  return `<li class="row"><div><div class="name">Signed-in devices</div>
<div class="meta">A new phone or computer signs in with the password, then <b>Allow</b> on Max's screen; it then stays signed in for 30 days.</div>
${rows || '<p class="meta">None.</p>'}
${others ? '<form method="post" action="/security/device-remove"><input type="hidden" name="id" value="all"><button class="btn secondary" type="submit">Sign out all other devices</button></form>' : ''}</div></li>`;
}
