/** The Routines tab of the control panel: scheduled jobs such as the news briefing. */
export interface PanelRoutines {
  /** Firecrawl is set up (news search, and reading sites that need a browser). */
  firecrawl: boolean;
  list: PanelRoutine[];
}

export interface PanelRoutine {
  id: string;
  name: string;
  enabled: boolean;
  vault: string;
  time: string;
  days: number[];
  daysText: string;
  sources: string[];
  interests: string;
  avoid: string;
  count: number;
  search: boolean;
  running: boolean;
  lastError?: string;
  suggestions?: {
    running: boolean;
    at?: string;
    error?: string;
    items: { url: string; name: string; why: string; via: string; feedUrl?: string; sample?: string; samples?: string[]; headlines: number; score?: number }[];
  };
  briefing?: {
    at: string;
    checked: number;
    failed: string[];
    heard?: boolean;
    note?: string;
    articles: { title: string; url: string; source: string; summary: string; why?: string; score?: number; feedback?: string }[];
  };
}

type Esc = (s: unknown) => string;
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LIST = { personal: 'Personal', work: 'Work', household: 'Household (shared)' } as Record<string, string>;

export function routinesSection(r: PanelRoutines, esc: Esc): string {
  const cards = r.list.map((x) => routineCard(x, r.firecrawl, esc)).join('');
  return `<section id="routines"><h2>Routines</h2>
<p class="meta">Jobs Max does on a schedule, so the result is ready when you ask. The <b>news briefing</b> checks your websites, picks the
articles that match your interests, reads them and prepares a short summary of each. Ask "Hey Max, what's the news?", or hear about it in
"what's going on in my day?". ${r.firecrawl ? '' : 'Tip: add a Firecrawl key (Connections tab) so Max can also read sites that need a browser and search the news for your interests.'}</p>
${r.list.length ? '' : '<p class="empty">No routines yet: create your first news briefing below.</p>'}</section>
${cards}
<section id="routine-new"><h2>New news briefing</h2>${routineForm(undefined, r.firecrawl, esc)}</section>`;
}

function routineCard(x: PanelRoutine, firecrawl: boolean, esc: Esc): string {
  const b = x.briefing;
  const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const status = x.running
    ? '<span class="badge warn">gathering now…</span>'
    : x.enabled
      ? '<span class="badge ok">on</span>'
      : '<span class="badge off">paused</span>';
  const articles = b?.articles.length
    ? `<ol class="news">${b.articles
        .map((a) => {
          const vote = (up: boolean) =>
            `<form method="post" action="/routines/feedback"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="url" value="${esc(a.url)}"><input type="hidden" name="vote" value="${up ? 'up' : 'down'}"><button class="vote ${a.feedback === (up ? 'up' : 'down') ? 'on' : ''}" type="submit" title="${up ? 'More like this' : 'Not for me: fewer like this'}">${up ? '👍' : '👎'}</button></form>`;
          return `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(a.title)}</b></a> <span class="meta">${esc(a.source)}${a.why ? ` · ${esc(a.why)}` : ''}${a.score ? ` · match ${a.score}/10` : ''}</span><div>${esc(a.summary)}</div><div class="votes">${vote(true)}${vote(false)}</div></li>`;
        })
        .join('')}</ol>`
    : `<p class="empty">${b ? 'The last run found nothing to report.' : 'Not run yet: it runs at the next scheduled time, or press Run now.'}</p>`;
  const meta = b
    ? `Gathered ${esc(new Date(b.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} from ${b.checked} headlines${b.heard ? ' · already read out' : ''}${b.failed.length ? ` · <span class="warntext">couldn't read ${esc(b.failed.join(', '))}</span>` : ''}`
    : '';
  const note = b?.note ? `<p class="${/couldn't|not in the expected|empty answer|Only adverts/.test(b.note) ? 'hint' : 'meta'}">${esc(b.note)}</p>` : '';
  return `<section id="routine-${esc(x.id)}"><h2>${esc(x.name)} ${status}</h2>
<p class="meta">${esc(x.daysText)} at ${esc(x.time)} · ${x.count} articles · ${esc(LIST[x.vault] ?? x.vault)} · ${x.sources.length} website${x.sources.length === 1 ? '' : 's'}: ${esc(x.sources.map(host).join(', ') || 'none')}${x.search ? ' · plus a news search' : ''}</p>
${x.lastError && !x.running ? `<p class="hint">Last run: ${esc(x.lastError)}</p>` : ''}
<h3>Latest briefing</h3>${meta ? `<p class="meta">${meta}</p>` : ''}${note}${articles}${b?.articles.length ? '<p class="meta">👍 / 👎 teach Max what you like: he uses them when choosing the next articles.</p>' : ''}
<div class="acts" style="margin-top:12px">
<form method="post" action="/routines/run"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn" type="submit" ${x.running ? 'disabled' : ''}>Run now</button></form>
<form method="post" action="/routines/toggle"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn secondary" type="submit">${x.enabled ? 'Pause' : 'Resume'}</button></form>
</div>
${suggestBlock(x, esc)}
<details><summary class="meta">Settings</summary>${routineForm(x, firecrawl, esc)}
<form class="addfact danger" method="post" action="/routines/delete"><input type="hidden" name="id" value="${esc(x.id)}"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete this routine and its briefings</label><button class="btn secondary" type="submit">Delete</button></form></details>
</section>`;
}

const VIA: Record<string, string> = {
  feed: '<span class="badge ok">news feed</span>',
  page: '<span class="badge off">page headlines</span>',
  firecrawl: '<span class="badge off">via Firecrawl</span>',
};

/** "Suggest websites": Max proposes sources for the interests; tick the ones to add. */
function suggestBlock(x: PanelRoutine, esc: Esc): string {
  const s = x.suggestions;
  const button = `<form method="post" action="/routines/suggest"><input type="hidden" name="id" value="${esc(x.id)}"><button class="btn secondary" type="submit" ${s?.running || !x.interests ? 'disabled' : ''}>${s?.items.length ? 'Suggest again' : 'Suggest websites'}</button></form>`;
  const intro = `<p class="meta">${x.interests ? `Max finds websites for your interests (${esc(x.interests.slice(0, 120))}${x.interests.length > 120 ? '…' : ''}) and checks each one, looking for its news feed.` : 'Add your interests in Settings below, then Max can suggest websites.'}</p>`;
  if (s?.running) return `<h3>Suggested websites</h3><p class="meta"><span class="badge warn">looking…</span> Finding and checking websites: this takes about a minute. The page refreshes by itself.</p><span data-wait></span>`;
  const list = s?.items.length
    ? `<form method="post" action="/routines/add-suggested"><input type="hidden" name="id" value="${esc(x.id)}"><ul class="suggest">${s.items
        .map(
          (i) => `<li><label><input type="checkbox" name="url" value="${esc(i.url)}" ${i.via === 'feed' ? 'checked' : ''}>
<span><span><b>${esc(i.name)}</b> ${VIA[i.via] ?? ''}</span><span class="meta">${esc(i.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span>
<span class="meta">${esc(i.why)}${i.score ? ` · match ${i.score}/10` : ''}</span>
${(i.samples?.length ? i.samples : i.sample ? [i.sample] : []).map((t) => `<span class="meta">• “${esc(t.slice(0, 110))}”</span>`).join('')}</span></label></li>`,
        )
        .join('')}</ul><div class="acts"><button class="btn" type="submit">Add selected</button></div>
<p class="meta">Each site was opened and checked: the headlines shown are its recent ones that match your interests. Sites with a news feed are the most reliable and cost no Firecrawl credits, so they're ticked already.</p></form>`
    : s?.error
      ? `<p class="hint">${esc(s.error)}</p>`
      : '';
  return `<h3>Suggested websites</h3>${intro}${list}<div class="acts" style="margin-top:8px">${button}</div>`;
}

function routineForm(x: PanelRoutine | undefined, firecrawl: boolean, esc: Esc): string {
  const days = x?.days ?? [1, 2, 3, 4, 5, 6, 7];
  const lists = Object.entries(LIST).map(([v, l]) => `<option value="${v}" ${v === (x?.vault ?? 'personal') ? 'selected' : ''}>${l}</option>`).join('');
  const counts = [3, 4, 5, 6, 7, 8, 10].map((n) => `<option ${n === (x?.count ?? 6) ? 'selected' : ''}>${n}</option>`).join('');
  return `<form class="stack routine" method="post" action="/routines/save">${x ? `<input type="hidden" name="id" value="${esc(x.id)}">` : ''}
<label>Name<input name="name" maxlength="60" value="${esc(x?.name ?? 'Morning news')}"></label>
<label>Websites <span class="meta">(one per line: a news site, a section of it, or its RSS feed. Not sure? Leave it empty: Max suggests some for your interests)</span>
<textarea name="sources" rows="4" placeholder="bbc.co.uk/news&#10;theverge.com&#10;formula1.com/en/latest">${esc((x?.sources ?? []).join('\n'))}</textarea></label>
<label>What interests you <span class="meta">(topics, people, places; separated by commas)</span>
<textarea name="interests" rows="2" placeholder="Formula 1, AI start-ups, Brighton local news, Italian politics">${esc(x?.interests ?? '')}</textarea></label>
<label>Leave out <span class="meta">(optional)</span><input name="avoid" maxlength="500" value="${esc(x?.avoid ?? '')}" placeholder="celebrity gossip, shopping guides"></label>
<div class="addfact wrap"><label class="inline">Time <input type="time" name="time" required value="${esc(x?.time ?? '06:30')}"></label>
<label class="inline">Articles <select name="count">${counts}</select></label>
<label class="inline">Whose <select name="vault">${lists}</select></label></div>
<div class="days">${DAY.map((d, i) => `<label class="day"><input type="checkbox" name="days" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
<label class="check"><input type="checkbox" name="search" value="yes" ${(x ? x.search : firecrawl) ? 'checked' : ''} ${firecrawl ? '' : 'disabled'}> Research: also search the news for each of my interests${firecrawl ? ' (recommended; a few Firecrawl credits a day)' : ' (needs Firecrawl)'}</label>
${x ? `<label class="check"><input type="checkbox" name="enabled" value="yes" ${x.enabled ? 'checked' : ''}> On</label>` : ''}
<div class="acts"><button class="btn" type="submit">${x ? 'Save' : 'Create'}</button></div>
<p class="meta">Work briefings are only read out in work mode, personal ones in personal mode. Pick a time a little before you usually ask: gathering takes a minute or two.</p></form>`;
}

export const ROUTINES_CSS =
  '.votes{display:flex;gap:6px;margin-top:4px}.vote{background:none;border:1px solid var(--line);border-radius:999px;padding:2px 10px;cursor:pointer;font-size:14px;opacity:.6}.vote.on,.vote:hover{opacity:1;border-color:var(--accent)}' +
  '.suggest li{border-top:1px solid var(--line);padding:10px 0}.suggest label{display:flex;gap:10px;align-items:flex-start;cursor:pointer}.suggest label>span{display:flex;flex-direction:column;align-items:flex-start;gap:2px}.suggest input{margin-top:4px}' +
  '.routine label{display:block;margin:10px 0 4px;font-weight:600}.routine label input:not([type=checkbox]),.routine label textarea{display:block;width:100%;margin-top:4px;font-weight:400}' +
  '.routine input[name=name],.routine input[name=avoid]{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}' +
  '.routine label.inline{display:flex;align-items:center;gap:8px;margin:0}.routine label.inline input,.routine label.inline select{display:inline-block;width:auto;margin:0}' +
  '.routine label.check,.routine label.day{font-weight:400;display:inline-flex;gap:6px;align-items:center;margin:8px 12px 0 0}.days{margin:8px 0}' +
  '.news{padding-left:20px;margin:8px 0}.news li{margin:0 0 12px}.news a{text-decoration:none}.news a:hover{text-decoration:underline}';
