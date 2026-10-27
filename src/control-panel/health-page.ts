/** The Health tab of the control panel: exercise, diet, heart, sleep and weight, and the plans Max makes. */
export interface PanelHealth {
  parts: PanelHealthPart[];
  plans: PanelHealthPlan[];
  emailTo?: string;
  /** A personal Gmail or Outlook account is connected (Connections → Apps). */
  emailConnected: boolean;
  whatsappReady: boolean;
  /** Which AI model writes the plans (Settings → AI models). */
  model: string;
  /** Today in the household's time zone ("YYYY-MM-DD"). */
  today: string;
}

export interface PanelHealthPart {
  id: string;
  label: string;
  icon: string;
  text: string;
  example: string;
  fields: readonly { key: string; label: string; unit: string }[];
  summary: string;
  goal?: string;
  entries: { id: string; date: string; text: string; values: Record<string, number> }[];
  /** The last 14 days of its main number (exercise minutes, calories, blood pressure…). */
  chart: { label: string; unit: string; days: { date: string; value?: number }[] };
  planable: boolean;
}

export interface PanelHealthPlan {
  id: string;
  part: string;
  name: string;
  sources: string[];
  brief: string;
  span: 'day' | 'week';
  days: number[];
  time: string;
  email: boolean;
  whatsapp: boolean;
  enabled: boolean;
  running: boolean;
  lastError?: string;
  latest?: { at: string; text: string; sent: string[]; failed: string[] };
}

type Esc = (s: unknown) => string;
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function healthSection(h: PanelHealth, esc: Esc): string {
  const tiles = h.parts
    .map((p) => `<a class="htile" href="#health-${p.id}"><span class="hicon">${p.icon}</span><b>${esc(p.label)}</b><span class="meta">${esc(p.summary)}</span>${p.goal ? `<span class="meta">Goal: ${esc(p.goal)}</span>` : ''}</a>`)
    .join('');
  return `<section id="health"><h2>Health</h2>
<p class="meta">Keep track of your exercise, diet, heart, sleep and weight, here or just by telling Max ("I ran 5 km in 30 minutes", "my blood pressure is 128 over 82", "I slept 7 hours"). Ask "how am I doing this week?". Max also makes your exercise routines and meal plans from the websites you choose, and sends them to you. Everything here stays on the box, encrypted, and only in personal mode. Max isn't a doctor: for anything worrying, talk to your GP.</p>
<div class="htiles">${tiles}</div></section>
${plansSection(h, esc)}
${h.parts.map((p) => partSection(p, h.today, esc)).join('')}`;
}

function chart(c: PanelHealthPart['chart'], esc: Esc): string {
  const vals = c.days.map((d) => d.value).filter((v): v is number => v !== undefined);
  if (!vals.length) return '<p class="empty">Nothing in the last 14 days yet.</p>';
  const max = Math.max(...vals) || 1;
  const w = 14 * 22;
  const bars = c.days
    .map((d, i) => {
      const hgt = d.value === undefined ? 0 : Math.max(3, Math.round((d.value / max) * 70));
      return `<rect x="${i * 22 + 3}" y="${80 - hgt}" width="16" height="${hgt}" rx="3"><title>${esc(d.date)}: ${d.value ?? 'nothing'}${d.value !== undefined && c.unit ? ` ${esc(c.unit)}` : ''}</title></rect>${i % 2 === 0 ? `<text x="${i * 22 + 11}" y="96">${esc(d.date.slice(8))}</text>` : ''}`;
    })
    .join('');
  return `<figure class="hchart"><svg viewBox="0 0 ${w} 100" role="img" aria-label="${esc(c.label)}, last 14 days">${bars}</svg><figcaption class="meta">${esc(c.label)}${c.unit ? ` (${esc(c.unit)})` : ''}, last 14 days · highest ${max}</figcaption></figure>`;
}

function partSection(p: PanelHealthPart, today: string, esc: Esc): string {
  const val = (e: PanelHealthPart['entries'][number]) =>
    p.fields.filter((f) => e.values[f.key] !== undefined).map((f) => `${e.values[f.key]}${f.unit ? ` ${esc(f.unit)}` : ''}`);
  const rows = p.entries.length
    ? `<ul class="hlist">${p.entries
        .map(
          (e) => `<li><span class="meta">${esc(e.date)}</span> ${esc([e.text, ...val(e)].filter(Boolean).join(' · '))}
<form method="post" action="/health/delete"><input type="hidden" name="id" value="${esc(e.id)}"><button class="linkbtn" type="submit" title="Remove" aria-label="Remove">✕</button></form></li>`,
        )
        .join('')}</ul>`
    : '';
  const inputs = p.fields
    .map((f) => `<label class="inline">${esc(f.label)}${f.unit ? ` <span class="meta">${esc(f.unit)}</span>` : ''}<input type="number" step="any" min="0" name="${esc(f.key)}" style="width:6em"></label>`)
    .join('');
  return `<section id="health-${esc(p.id)}"><h2>${p.icon} ${esc(p.label)}</h2>
<p class="meta">${esc(p.summary)}</p>
${chart(p.chart, esc)}
<h3>Add</h3>
<form class="stack" method="post" action="/health/log"><input type="hidden" name="part" value="${esc(p.id)}">
<div class="addfact wrap"><label class="inline">${esc(p.text)}<input name="text" maxlength="300" placeholder="${esc(p.example)}"></label>${inputs}
<label class="inline">Date<input type="date" name="date" max="${today}" value="${today}"></label><button class="btn" type="submit">Add</button></div></form>
${rows ? `<h3>Latest</h3>${rows}` : ''}
<form class="addfact" method="post" action="/health/goal"><input type="hidden" name="part" value="${esc(p.id)}"><label class="meta" for="goal-${esc(p.id)}">Goal</label><input id="goal-${esc(p.id)}" name="goal" maxlength="300" value="${esc(p.goal ?? '')}" placeholder="${esc(GOAL_HINT[p.id] ?? '')}"><button class="btn secondary" type="submit">Save</button></form>
</section>`;
}

const GOAL_HINT: Record<string, string> = {
  exercise: 'e.g. 4 sessions a week, run 10 km by March',
  diet: 'e.g. about 2,000 kcal a day, 2 L of water',
  heart: 'e.g. blood pressure under 130/85',
  sleep: 'e.g. 7–8 hours a night',
  weight: 'e.g. 78 kg by summer',
};

function plansSection(h: PanelHealth, esc: Esc): string {
  const delivery = [
    h.emailConnected
      ? h.emailTo
        ? `Email: to <b>${esc(h.emailTo)}</b>.`
        : 'Email: add your address below.'
      : 'Email: connect Gmail or Outlook first (Connections → Apps).',
    h.whatsappReady ? 'WhatsApp: to your own number ("Message yourself").' : 'WhatsApp: link it first (Connections → WhatsApp).',
  ].join(' ');
  return `<section id="health-plans"><h2>🏋️ Plans</h2>
<p class="meta">Max reads the websites you choose and writes your routine (or meal plan) for the day or the week, following your brief and what you've logged, then sends it to you. Ask "what's my workout today?" any time. Written by ${esc(h.model)} (change it in Settings → AI models → Health plans). ${delivery}</p>
<form class="addfact" method="post" action="/health/email"><label class="meta" for="hemail">Send plans to</label><input id="hemail" type="email" name="email" maxlength="120" value="${esc(h.emailTo ?? '')}" placeholder="you@example.com"><button class="btn secondary" type="submit">Save</button></form>
${h.plans.length ? '' : '<p class="empty">No plans yet: create your first below.</p>'}</section>
${h.plans.map((p) => planCard(p, esc)).join('')}
<section id="health-plan-new"><h2>New plan</h2>${planForm(undefined, esc)}</section>`;
}

function planCard(p: PanelHealthPlan, esc: Esc): string {
  const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const status = p.running ? '<span class="badge warn">preparing…</span>' : p.enabled ? '<span class="badge ok">on</span>' : '<span class="badge off">paused</span>';
  const days = p.span === 'week' ? `Every ${DAY[(p.days[0] ?? 1) - 1]}` : p.days.length === 7 ? 'Every day' : p.days.map((d) => DAY[d - 1]).join(', ');
  const to = [p.email && 'email', p.whatsapp && 'WhatsApp'].filter(Boolean).join(' and ') || 'not sent (ask Max or look here)';
  const latest = p.latest
    ? `<p class="meta">Made ${esc(when(p.latest.at))}${p.latest.sent.length ? ` · sent by ${esc(p.latest.sent.join(' and '))}` : ''}${p.latest.failed.length ? ` · <span class="warntext">not sent: ${esc(p.latest.failed.join('; '))}</span>` : ''}</p><pre class="hplan">${esc(p.latest.text)}</pre>`
    : `<p class="empty">Not made yet: it's made at the next scheduled time, or press Make now.</p>`;
  return `<section id="plan-${esc(p.id)}"><h2>${esc(p.name)} ${status}</h2>
<p class="meta">${p.span === 'week' ? 'The week ahead' : 'The day'} · ${esc(days)} at ${esc(p.time)} · sent by ${esc(to)} · ${p.sources.length ? `following ${esc(p.sources.map(host).join(', '))}` : 'no websites (general advice)'}</p>
${p.lastError && !p.running ? `<p class="hint">Last time: ${esc(p.lastError)}</p>` : ''}
${p.running ? '<span data-wait></span>' : ''}${latest}
<div class="acts" style="margin-top:12px">
<form method="post" action="/health/plan-run"><input type="hidden" name="id" value="${esc(p.id)}"><button class="btn" type="submit" ${p.running ? 'disabled' : ''}>Make now</button></form>
<form method="post" action="/health/plan-toggle"><input type="hidden" name="id" value="${esc(p.id)}"><button class="btn secondary" type="submit">${p.enabled ? 'Pause' : 'Resume'}</button></form></div>
<details><summary class="meta">Settings</summary>${planForm(p, esc)}
<form class="addfact danger" method="post" action="/health/plan-delete"><input type="hidden" name="id" value="${esc(p.id)}"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete this plan</label><button class="btn secondary" type="submit">Delete</button></form></details>
</section>`;
}

function planForm(p: PanelHealthPlan | undefined, esc: Esc): string {
  const days = p?.days ?? [1, 2, 3, 4, 5, 6, 7];
  const opt = (v: string, label: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return `<form class="stack" method="post" action="/health/plan-save">${p ? `<input type="hidden" name="id" value="${esc(p.id)}">` : ''}
<div class="addfact wrap"><label class="inline">Name<input name="name" maxlength="60" value="${esc(p?.name ?? '')}" placeholder="Morning workout"></label>
<label class="inline">For <select name="part">${opt('exercise', 'Exercise routine', p?.part ?? 'exercise')}${opt('diet', 'Meal plan', p?.part ?? 'exercise')}</select></label>
<label class="inline">Covers <select name="span">${opt('day', 'the day', p?.span ?? 'day')}${opt('week', 'the week ahead', p?.span ?? 'day')}</select></label></div>
<label>Websites to follow <span class="meta">(one per line, up to 5: a programme, a page of exercises or recipes, e.g. nhs.uk/live-well/exercise)</span>
<textarea name="sources" rows="3" placeholder="nhs.uk/live-well/exercise/strength-exercises&#10;darebee.com/programs">${esc((p?.sources ?? []).join('\n'))}</textarea></label>
<label>What you want <span class="meta">(your level, goal, equipment, time you have, injuries or foods to avoid)</span>
<textarea name="brief" rows="3" required placeholder="Intermediate, want to get stronger and run 10 km. Dumbbells at home, 30–40 minutes on weekdays, longer at weekends. Bad left knee: no jumping.">${esc(p?.brief ?? '')}</textarea></label>
<div class="addfact wrap"><label class="inline">Time <input type="time" name="time" required value="${esc(p?.time ?? '06:45')}"></label>
<label class="check"><input type="checkbox" name="email" value="yes" ${p?.email ?? true ? 'checked' : ''}> Email it to me</label>
<label class="check"><input type="checkbox" name="whatsapp" value="yes" ${p?.whatsapp ? 'checked' : ''}> WhatsApp it to me</label></div>
<div class="days">${DAY.map((d, i) => `<label class="day"><input type="checkbox" name="days" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
<p class="meta">Days: when it's made and sent. For a weekly plan, the first day ticked (e.g. Sunday evening or Monday morning).</p>
${p ? `<label class="check"><input type="checkbox" name="enabled" value="yes" ${p.enabled ? 'checked' : ''}> On</label>` : ''}
<div class="acts"><button class="btn" type="submit">${p ? 'Save' : 'Create'}</button></div></form>`;
}

export const HEALTH_CSS =
  '.htiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:12px}' +
  '.htile{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:inherit;background:var(--card)}.htile:hover{border-color:var(--accent)}.hicon{font-size:22px}' +
  '.hchart{margin:8px 0}.hchart svg{width:100%;max-width:420px;height:auto;display:block}.hchart rect{fill:var(--accent);opacity:.8}.hchart text{font-size:9px;fill:var(--muted);text-anchor:middle}' +
  '.hlist{list-style:none;padding:0;margin:0}.hlist li{display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);padding:6px 0}.hlist form{margin-left:auto}' +
  '.linkbtn{background:none;border:0;color:var(--muted);cursor:pointer;font-size:14px}' +
  '.hplan{white-space:pre-wrap;font:inherit;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;max-height:420px;overflow:auto}';
