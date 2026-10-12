/** HTML for the control panel. Server-rendered, no external assets, works on a phone. */
export interface PanelData {
  music?: { state: string; account?: string; pairing?: { url: string; code: string }; error?: string };
  voice: string;
  notice?: { kind: 'ok' | 'error'; text: string };
  homeAssistant: { connected: boolean; tools: number; error?: string };
  composio: {
    configured: boolean;
    error?: string;
    apps: { slug: string; name: string; logo?: string; connected: boolean; toolsOffered: number }[];
    notEnabled: string[];
    otherUser: string[];
    userId: string;
  };
  servers: { name: string; connected: boolean; offered: number; total: number; error?: string }[];
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
  };
}

const VAULT_LABEL: Record<string, string> = { personal: 'Personal', household: 'Household', work: 'Work' };
const SOURCE: Record<string, string> = { you: 'you asked Max', conversation: 'learnt in conversation', panel: 'added here' };
const FACTS_SHOWN = 60;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const post = (action: string, fields: Record<string, string>, label: string, cls = 'btn secondary') =>
  `<form method="post" action="${action}">${Object.entries(fields).map(([k, v]) => hidden(k, v)).join('')}<button class="${cls}" type="submit">${label}</button></form>`;

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
  const modes = (['personal', 'work', 'guest', 'auto'] as const)
    .map((x) => post('/mode', { mode: x }, x === 'auto' ? 'Automatic' : `${x[0].toUpperCase()}${x.slice(1)}`, `btn ${m.mode === x ? '' : 'secondary'}`))
    .join('');
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
<div class="name">${esc(m.modeText)}</div>
<p class="meta">Personal: Work vault locked${m.workApps.length ? ' (and work apps)' : ''} · Work: everything open · Guest: only Household. Say "Max, work mode", "personal mode" or "guest mode".</p>
<div class="modes">${modes}</div>
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

export function renderPanel(d: PanelData): string {
  const apps = d.composio.configured
    ? d.composio.apps.length
      ? d.composio.apps
          .map(
            (a) => `
      <li class="row">
        <div class="app">
          ${a.logo ? `<img src="${esc(a.logo)}" alt="" width="32" height="32">` : '<span class="ph"></span>'}
          <div>
            <div class="name">${esc(a.name)} ${badge(a.connected)}</div>
            <div class="meta">${a.connected ? `${a.toolsOffered} action${a.toolsOffered === 1 ? '' : 's'} available to Max` : esc(NOTES[a.slug] ?? 'Sign in to let Max use this app.')}</div>
            ${a.connected && NOTES[a.slug] ? `<div class="meta">${esc(NOTES[a.slug])}</div>` : ''}
          </div>
        </div>
        <a class="btn ${a.connected ? 'secondary' : ''}" href="/connect/${encodeURIComponent(a.slug)}">${a.connected ? 'Reconnect' : 'Connect'}</a>
      </li>`,
          )
          .join('')
      : `<li class="empty">${d.composio.error ? `Composio error: ${esc(d.composio.error)}` : 'Loading apps…'}</li>`
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
.badge.warn{background:var(--errbg);color:var(--err)}
details{margin-top:4px}.items{list-style:disc;padding-left:18px;color:var(--muted);font-size:13px}
.hint{border-top:1px solid var(--line);padding:12px 0;color:var(--err)}.add{margin:12px 0 0}
.name{font-weight:600}.meta{color:var(--muted);font-size:13px}.empty{color:var(--muted)}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;margin-left:6px;vertical-align:1px}
.badge.ok{background:var(--okbg);color:var(--ok)}.badge.off{background:var(--offbg);color:var(--muted)}
.btn{flex:none;background:var(--accent);color:#fff;text-decoration:none;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}
.notice{border-radius:10px;padding:10px 14px;margin-bottom:16px}.notice.ok{background:var(--okbg);color:var(--ok)}.notice.error{background:var(--errbg);color:var(--err)}
code{background:var(--offbg);padding:1px 5px;border-radius:5px;font-size:13px}a{color:var(--accent)}
form{margin:0}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
@media (max-width:520px){.row{flex-direction:column;align-items:stretch}.btn{text-align:center}.addfact{flex-wrap:wrap}.addfact input{flex-basis:100%}}
</style></head><body><main>
<div class="top"><div><h1>Max</h1><p class="sub">Voice: ${esc(d.voice)}</p></div>
<div class="acts"><form method="post" action="/refresh"><button class="btn secondary" type="submit">Refresh</button></form>${d.memory?.passwordSet ? '<form method="post" action="/logout"><button class="btn secondary" type="submit">Sign out</button></form>' : ''}</div></div>
${d.notice ? `<div class="notice ${d.notice.kind}">${esc(d.notice.text)}</div>` : ''}
<section><h2>Apps</h2><ul>${apps}${hints}</ul>
<p class="meta add">To add another app (e.g. firecrawl, slack, notion), add its name to <code>COMPOSIO_TOOLKITS</code> in <code>.env</code> and restart Max; it then appears here with a Connect button.</p></section>
${musicSection(d.music)}
<section><h2>Home Assistant</h2><ul><li class="row"><div><div class="name">Home Assistant ${badge(d.homeAssistant.connected)}</div>
<div class="meta">${d.homeAssistant.connected ? `${d.homeAssistant.tools} actions available to Max` : esc(d.homeAssistant.error ?? 'Not connected')}</div></div></li></ul></section>
${d.memory ? memorySection(d.memory) : ''}
${servers ? `<section><h2>Other MCP servers</h2><ul>${servers}</ul></section>` : ''}
<p class="meta">Sending, replying, deleting and similar actions always need your spoken "yes" first.</p>
</main></body></html>`;
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
