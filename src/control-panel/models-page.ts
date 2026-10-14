/** The "AI models" section of the Settings tab: which model does each background job. */
export interface PanelModels {
  main: string;
  providers: { id: string; label: string; setting: string; configured: boolean; where?: string; models: string[]; error?: string }[];
  tasks: { id: string; label: string; help: string; provider: string; model: string; describe: string }[];
}

type Esc = (s: unknown) => string;

export function modelsSection(m: PanelModels, esc: Esc): string {
  const ready = m.providers.filter((p) => p.configured);
  const lists = ready
    .filter((p) => p.models.length)
    .map((p) => `<datalist id="models-${esc(p.id)}">${p.models.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`)
    .join('');
  const rows = m.tasks
    .map((t) => {
      const opts = m.providers
        .map((p) => `<option value="${esc(p.id)}" ${p.id === t.provider ? 'selected' : ''} ${p.configured ? '' : 'disabled'}>${esc(p.label)}${p.configured ? '' : ` (add ${esc(p.setting)})`}</option>`)
        .join('');
      return `<li class="row"><div style="flex:1;min-width:0"><div class="name">${esc(t.label)} <span class="badge off">${esc(t.describe)}</span></div><div class="meta">${esc(t.help)}</div>
<form class="addfact wrap model" method="post" action="/models/assign"><input type="hidden" name="task" value="${esc(t.id)}">
<select name="provider" aria-label="Provider" onchange="var i=this.form.model;i.setAttribute('list','models-'+this.value);i.disabled=this.value==='default';if(this.value==='default')i.value=''">${opts}</select>
<input name="model" value="${esc(t.model)}" list="models-${esc(t.provider)}" placeholder="model name, e.g. pick from the list" ${t.provider === 'default' ? 'disabled' : ''} aria-label="Model">
<button class="btn" type="submit">Save</button></form></div>
<form method="post" action="/models/test"><input type="hidden" name="task" value="${esc(t.id)}"><button class="btn secondary" type="submit">Test</button></form></li>`;
    })
    .join('');
  const providers = m.providers
    .filter((p) => p.id !== 'default')
    .map(
      (p) =>
        `<li class="row"><div><div class="name">${esc(p.label)} ${p.configured ? '<span class="badge ok">Set up</span>' : '<span class="badge off">Not set up</span>'}</div>
<div class="meta">${p.configured ? (p.error ? `Couldn't list its models (${esc(p.error)}): type the model name.` : `${p.models.length} models available`) : `Add <code>${esc(p.setting)}</code> to <code>.env</code>${p.where ? ` (<a href="${esc(p.where)}" target="_blank" rel="noopener">get one</a>)` : ''} and restart Max.`}</div></div></li>`,
    )
    .join('');
  return `<section id="models"><h2>AI models</h2>
<p class="meta">Choose which AI model does each background job: a cheaper, faster one for routine work, a stronger one where quality matters.
The conversation itself uses <b>${esc(m.main)}</b> (the <code>LLM_*</code> settings in <code>.env</code>), where speed comes first. If a chosen model fails, Max uses the main one for that run, so nothing stops.</p>
${lists}<ul>${rows}</ul>
<details><summary class="meta">Providers (${ready.length - 1} set up)</summary><ul>${providers}</ul>
<p class="meta">Keys only go in <code>.env</code>, never on this page. Any OpenAI-compatible service works: set <code>CUSTOM_LLM_BASE_URL</code> (and <code>CUSTOM_LLM_API_KEY</code>) for your own; <code>OLLAMA_BASE_URL</code> for models on your own computer.</p></details></section>`;
}

export const MODELS_CSS = '.model{margin:8px 0 0}.model input[name=model]{flex:1;min-width:180px;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}';
