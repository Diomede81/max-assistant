/** Routines → Scheduled tasks: tasks Max does on his own at set times, with the effort and model you choose. */
export interface PanelJobs {
  list: PanelJob[];
  /** Model providers to pick from (the ones set up first). */
  providers: { id: string; label: string; configured: boolean; setting: string }[];
  /** What runs a task that names no model of its own (Settings → AI models → Scheduled tasks). */
  defaultModel: string;
  efforts: { id: string; label: string; help: string }[];
  emailReady: boolean;
  emailTo?: string;
  whatsappReady: boolean;
}

export interface PanelJob {
  id: string;
  name: string;
  brief: string;
  enabled: boolean;
  vault: string;
  time: string;
  days: number[];
  once?: string;
  monthDay?: number;
  effort: string;
  provider: string;
  model: string;
  modelText: string;
  scheduleText: string;
  say: boolean;
  email: boolean;
  whatsapp: boolean;
  running: boolean;
  lastError?: string;
  runs: { at: string; seconds: number; ok: boolean; text: string; actions: number; sent: string[]; failed: string[] }[];
}

type Esc = (s: unknown) => string;
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LIST = { personal: 'Personal (personal mode)', work: 'Work (work mode)', household: 'Household (every mode)' } as Record<string, string>;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function jobsSection(j: PanelJobs, esc: Esc): string {
  const cards = j.list.map((x) => jobCard(x, j, esc)).join('');
  return `<section id="jobs"><h2>Scheduled tasks</h2>
<p class="meta">Anything Max can do with his actions (look things up on the web, check trains, the calendar or the news, compare prices, read your email…), done at a set time: once, on chosen days, or on a day of the month. You choose how much effort it gets and which AI model does it. The result is kept here and, if you like, spoken, emailed or sent to you on WhatsApp. A task only finds out and reports: it never sends to anyone else, books or deletes anything. Or just say "Hey Max, every morning at 7 check the trains to Bath and tell me if there are problems".</p>
${j.list.length ? '' : '<p class="empty">No scheduled tasks yet: create your first below.</p>'}</section>
${cards}
<section id="job-new"><h2>New scheduled task</h2>${jobForm(undefined, j, esc)}</section>`;
}

function jobCard(x: PanelJob, j: PanelJobs, esc: Esc): string {
  const status = x.running ? '<span class="badge warn">running…</span>' : x.enabled ? '<span class="badge ok">on</span>' : '<span class="badge off">paused</span>';
  const to = [x.say && 'spoken', x.email && 'email', x.whatsapp && 'WhatsApp'].filter(Boolean).join(', ') || 'kept here';
  const r = x.runs[0];
  const latest = r
    ? `<p class="meta">${r.ok ? 'Done' : '<span class="warntext">Failed</span>'} ${esc(when(r.at))} · ${r.seconds}s · ${r.actions} action${r.actions === 1 ? '' : 's'}${r.sent.length ? ` · sent by ${esc(r.sent.join(', '))}` : ''}${r.failed.length ? ` · <span class="warntext">not sent: ${esc(r.failed.join('; '))}</span>` : ''}</p>
<pre class="hplan">${esc(r.text)}</pre>${x.runs.length > 1 ? `<details><summary class="meta">Earlier results (${x.runs.length - 1})</summary>${x.runs.slice(1).map((e) => `<p class="meta">${esc(when(e.at))}${e.ok ? '' : ' · failed'}</p><pre class="hplan">${esc(e.text)}</pre>`).join('')}</details>` : ''}`
    : '<p class="empty">Not run yet: it runs at the next scheduled time, or press Run now.</p>';
  return `<section id="job-${esc(x.id)}"><h2>${esc(x.name)} ${status}</h2>
<p class="meta">${esc(x.scheduleText)} · ${esc(x.effort)} effort · ${esc(x.modelText)} · result ${esc(to)} · ${esc(LIST[x.vault]?.split(' (')[0] ?? x.vault)}</p>
<p>${esc(x.brief)}</p>
${x.lastError && !x.running ? `<p class="hint">Last time: ${esc(x.lastError)}</p>` : ''}
${x.running ? '<span data-wait></span>' : ''}${latest}
<div class="acts" style="margin-top:12px">
<form method="post" action="/jobs/run"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn" type="submit" ${x.running ? 'disabled' : ''}>Run now</button></form>
<form method="post" action="/jobs/toggle"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn secondary" type="submit">${x.enabled ? 'Pause' : 'Resume'}</button></form></div>
<details><summary class="meta">Settings</summary>${jobForm(x, j, esc)}
<form class="addfact danger" method="post" action="/jobs/delete"><input type="hidden" name="id" value="${esc(x.id)}"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete this task</label><button class="btn secondary" type="submit">Delete</button></form></details>
</section>`;
}

function jobForm(x: PanelJob | undefined, p: PanelJobs, esc: Esc): string {
  const days = x?.days ?? [1, 2, 3, 4, 5, 6, 7];
  const kind = x?.once ? 'once' : x?.monthDay ? 'month' : 'days';
  const lists = Object.entries(LIST).map(([v, l]) => `<option value="${v}" ${v === (x?.vault ?? 'personal') ? 'selected' : ''}>${l}</option>`).join('');
  const efforts = p.efforts.map((e) => `<option value="${esc(e.id)}" ${e.id === (x?.effort ?? 'normal') ? 'selected' : ''}>${esc(e.label)}: ${esc(e.help)}</option>`).join('');
  const providers = `<option value="" ${x?.provider ? '' : 'selected'}>Scheduled tasks model (${esc(p.defaultModel)})</option>${p.providers
    .filter((v) => v.id !== 'default')
    .map((v) => `<option value="${esc(v.id)}" ${v.id === x?.provider ? 'selected' : ''} ${v.configured ? '' : 'disabled'}>${esc(v.label)}${v.configured ? '' : ` (add ${esc(v.setting)})`}</option>`)
    .join('')}`;
  const tick = (name: string, on: boolean, label: string, ok = true, hint = '') =>
    `<label class="check"><input type="checkbox" name="${name}" value="yes" ${on ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${label}${hint ? ` <span class="meta">(${esc(hint)})</span>` : ''}</label>`;
  return `<form class="stack routine" method="post" action="/jobs/save">${x ? `<input type="hidden" name="id" value="${esc(x.id)}">` : ''}
<label>Name<input name="name" maxlength="60" value="${esc(x?.name ?? '')}" placeholder="e.g. Flights to Palermo"></label>
<label>What to do <span class="meta">(in full, as you'd say it to Max: what, where, which dates, what matters to you)</span>
<textarea name="brief" rows="3" required placeholder="Check flights from Bristol to Palermo for the first week of August, two adults, and tell me the three cheapest with times and airline. Also note if prices went up since last time.">${esc(x?.brief ?? '')}</textarea></label>
<div class="addfact wrap"><label class="inline">When <select name="kind" onchange="var f=this.form;f.querySelector('.k-days').hidden=this.value!=='days';f.querySelector('.k-once').hidden=this.value!=='once';f.querySelector('.k-month').hidden=this.value!=='month'">
<option value="days" ${kind === 'days' ? 'selected' : ''}>On these days</option><option value="once" ${kind === 'once' ? 'selected' : ''}>Once, on a date</option><option value="month" ${kind === 'month' ? 'selected' : ''}>Monthly, on a day</option></select></label>
<label class="inline">at <input type="time" name="time" required value="${esc(x?.time ?? '07:00')}"></label>
<span class="k-once" ${kind === 'once' ? '' : 'hidden'}><label class="inline">Date <input type="date" name="once" value="${esc(x?.once ?? '')}"></label></span>
<span class="k-month" ${kind === 'month' ? '' : 'hidden'}><label class="inline">Day of the month <input type="number" name="monthDay" min="1" max="31" value="${x?.monthDay ?? 1}" style="width:5em"></label></span></div>
<div class="days k-days" ${kind === 'days' ? '' : 'hidden'}>${DAY.map((d, i) => `<label class="day"><input type="checkbox" name="days" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
<div class="addfact wrap"><label class="inline">Effort <select name="effort">${efforts}</select></label></div>
<div class="addfact wrap model"><label class="inline">Model <select name="provider" onchange="var i=this.form.model;i.setAttribute('list','models-'+this.value);i.disabled=!this.value;if(!this.value)i.value=''">${providers}</select></label>
<input name="model" value="${esc(x?.model ?? '')}" list="models-${esc(x?.provider ?? '')}" placeholder="model name, e.g. pick from the list" ${x?.provider ? '' : 'disabled'} aria-label="Model"></div>
<div class="addfact wrap"><span class="meta">Result:</span>${tick('say', x?.say ?? true, 'Say it and show it on the screen')}${tick('email', x?.email ?? false, 'Email me', p.emailReady, p.emailReady ? `to ${p.emailTo}` : 'set your address in Health → Plans and connect Gmail or Outlook')}${tick('whatsapp', x?.whatsapp ?? false, 'WhatsApp me', p.whatsappReady, p.whatsappReady ? '' : 'link WhatsApp first')}</div>
<div class="addfact wrap"><label class="inline">Whose <select name="vault">${lists}</select></label>${x ? tick('enabled', x.enabled, 'On') : ''}</div>
<div class="acts"><button class="btn" type="submit">${x ? 'Save' : 'Create'}</button></div>
<p class="meta">A work task is spoken about in work mode only (its result is still kept and sent). The model list comes from each provider; keys go in .env (Settings → AI models shows which are set up).</p></form>`;
}
