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
  /** About the user (Health → You), and the choices for its lists. */
  profile: { age?: number; sex?: string; heightCm?: number; fitness?: string; activity?: string; limits?: string; goal?: string; summary: string };
  fitnessLevels: Record<string, string>;
  activityLevels: Record<string, string>;
  goals: Record<string, string>;
  /** Who eats the meals, with their requirements; the diets to choose from. */
  eaters: { id: string; name: string; diet: string; allergies?: string; other?: string }[];
  diets: Record<string, string>;
  /** This week's meals, and the shopping list. */
  meals?: { title: string; notes?: string; at: string; warnings: string[]; estimatedCost?: number; days: { date: string; day: string; meals: Record<string, MealRecipe | undefined> }[] };
  shopping: ShopRow[];
  /** The online supermarket chosen, the ones to choose from, and whether products can be looked up (Firecrawl). */
  grocer: string;
  grocers: Record<string, string>;
  canFind: boolean;
  /** What the list costs (pence): chosen products, and an estimate for everything still to buy. */
  basket: { chosen: number; chosenItems: number; estimate: number; estimatedItems: number; open: number; unknown: number };
}

export interface ShopRow {
  id: string;
  text: string;
  aisle: string;
  done: boolean;
  extra?: boolean;
  /** The supermarket's search for this item. */
  link: string;
  found?: Product[];
  pick?: Product;
  /** The product chosen for this kind of item before (suggested). */
  remembered?: Product;
  finding: boolean;
  /** How many of the chosen product, and what they cost (pence). */
  qty: number;
  cost?: number;
}

interface Product {
  title: string;
  url: string;
  price?: string;
}

export interface MealRecipe {
  name: string;
  servings: number;
  minutes?: number;
  kcal?: number;
  protein?: number;
  ingredients: string[];
  steps: string[];
  source?: string;
  tip?: string;
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
  latest?: { at: string; text: string; sent: string[]; failed: string[]; used?: { url: string; title: string }[] };
  meals?: string[];
  daily?: boolean;
  dailyTime?: string;
}

type Esc = (s: unknown) => string;

/** One part of the Health area (its own entry in the sub-menu). `one`: its sections show one at a time. */
export interface HealthPart {
  id: string;
  label: string;
  html: string;
  one?: boolean;
}
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The Health area as parts for the sub-menu: Overview, Meals & shopping, Plans, Track, You & diet. */
export function healthParts(h: PanelHealth, esc: Esc): HealthPart[] {
  const tiles = h.parts
    .map((p) => `<a class="htile" href="#health-${p.id}"><span class="hicon">${p.icon}</span><b>${esc(p.label)}</b><span class="meta">${esc(p.summary)}</span>${p.goal ? `<span class="meta">Goal: ${esc(p.goal)}</span>` : ''}</a>`)
    .join('');
  const today = h.meals?.days.find((d) => d.date === h.today);
  const meals = today ? ['breakfast', 'lunch', 'dinner'].filter((x) => today.meals[x]).map((x) => `<b>${esc(x.charAt(0).toUpperCase() + x.slice(1))}:</b> ${esc(today.meals[x]!.name)}`) : [];
  const toBuy = h.shopping.filter((i) => !i.done).length;
  const next = h.plans.filter((p) => p.enabled).map((p) => `${esc(p.name)} (${esc(p.span === 'week' ? `every ${DAY[(p.days[0] ?? 1) - 1]}` : p.days.length === 7 ? 'every day' : p.days.map((d) => DAY[d - 1]).join(', '))} at ${esc(p.time)})`);
  const overview = `<section id="health"><h2>Health</h2>
<p class="meta">Keep track of your exercise, diet, heart, sleep and weight, here or just by telling Max ("I ran 5 km in 30 minutes", "my blood pressure is 128 over 82", "I slept 7 hours"). Ask "how am I doing this week?". Max isn't a doctor: for anything worrying, talk to your GP.</p>
<div class="htiles">${tiles}</div></section>
<section id="health-today"><h2>Today</h2>
<ul><li class="row"><div><div class="name">Meals</div><div class="meta">${meals.length ? meals.join(' · ') : h.meals ? 'Nothing planned for today.' : 'No meal plan yet.'}</div></div><a class="btn secondary" href="#health-meals">${h.meals ? 'This week' : 'Plan meals'}</a></li>
<li class="row"><div><div class="name">Shopping list</div><div class="meta">${toBuy ? `${toBuy} to buy` : 'Nothing to buy'}</div></div><a class="btn secondary" href="#health-shop">Open</a></li>
<li class="row"><div><div class="name">Plans</div><div class="meta">${next.length ? next.join(' · ') : 'No routine or meal plan is scheduled.'}</div></div><a class="btn secondary" href="#health-plans">${next.length ? 'See' : 'Create'}</a></li></ul>
<p class="meta">Everything here stays on the box, encrypted, and only in personal mode.</p></section>`;
  return [
    { id: 'overview', label: 'Overview', html: overview },
    { id: 'meals', label: 'Meals & shopping', html: mealsSection(h, esc), one: true },
    { id: 'plans', label: 'Plans', html: plansSection(h, esc) },
    { id: 'track', label: 'Track', html: h.parts.map((p) => partSection(p, h.today, esc)).join(''), one: true },
    { id: 'you', label: 'You & diet', html: profileSection(h, esc) + needsSection(h, esc) },
  ];
}

/** Health → You: age, fitness level and the rest, used by every plan. */
function profileSection(h: PanelHealth, esc: Esc): string {
  const p = h.profile;
  const opts = (list: Record<string, string>, cur?: string) =>
    `<option value="" ${cur ? '' : 'selected'}>Choose…</option>${Object.entries(list).map(([k, v]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  return `<section id="health-you"><h2>You</h2>
<p class="meta">${p.summary ? esc(p.summary) : 'Tell Max about yourself so your plans suit your age and fitness: a beginner of 60 and a runner of 30 need very different workouts.'}</p>
<form class="stack" method="post" action="/health/profile">
<div class="addfact wrap">
<label class="inline">Age<input type="number" name="age" min="12" max="110" value="${p.age ?? ''}" style="width:5em"></label>
<label class="inline">Sex <span class="meta">(optional)</span><select name="sex"><option value="" ${p.sex ? '' : 'selected'}>Prefer not to say</option><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option></select></label>
<label class="inline">Height <span class="meta">cm</span><input type="number" name="height" min="100" max="250" value="${p.heightCm ?? ''}" style="width:5em"></label>
</div>
<div class="addfact wrap">
<label class="inline">Fitness level<select name="fitness">${opts(h.fitnessLevels, p.fitness)}</select></label>
<label class="inline">Day to day<select name="activity">${opts(h.activityLevels, p.activity)}</select></label>
<label class="inline">Goal<select name="goal">${opts(h.goals, p.goal)}</select></label>
</div>
<label>Injuries, conditions or limits <span class="meta">(optional: Max plans around them, e.g. "bad left knee, no jumping", "asthma", "pregnant")</span>
<textarea name="limits" rows="2" maxlength="500">${esc(p.limits ?? '')}</textarea></label>
<div class="acts"><button class="btn" type="submit">Save</button></div>
<p class="meta">Your weight comes from the Weight log. Your age goes up by itself each year. If you have a heart condition or another health problem, check with your GP before starting a new routine.</p>
</form></section>`;
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
  return `<section id="health-${esc(p.id)}"><h2>${esc(p.label)}</h2>
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
  return `<section id="health-plans"><h2>Plans</h2>
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
    ? `<p class="meta">Made ${esc(when(p.latest.at))}${p.latest.sent.length ? ` · sent by ${esc(p.latest.sent.join(' and '))}` : ''}${p.latest.failed.length ? ` · <span class="warntext">not sent: ${esc(p.latest.failed.join('; '))}</span>` : ''}</p>${
        p.latest.used?.length
          ? `<p class="meta">Built from: ${p.latest.used.map((u) => `<a href="${esc(u.url)}" target="_blank" rel="noopener noreferrer">${esc(u.title || u.url)}</a>`).join(' · ')}</p>`
          : ''
      }<pre class="hplan">${esc(p.latest.text)}</pre>`
    : `<p class="empty">Not made yet: it's made at the next scheduled time, or press Make now.</p>`;
  return `<section id="plan-${esc(p.id)}"><h2>${esc(p.name)} ${status}</h2>
<p class="meta">${p.span === 'week' ? 'The week ahead' : 'The day'} · ${esc(days)} at ${esc(p.time)} · sent by ${esc(to)} · ${p.sources.length ? `following ${esc(p.sources.map(host).join(', '))}` : 'no websites (general advice)'}</p>
${p.lastError && !p.running ? `<p class="hint">Last time: ${esc(p.lastError)}</p>` : ''}
${p.running ? '<span data-wait></span>' : ''}${latest}
<div class="acts" style="margin-top:12px">
<form method="post" action="/health/plan-run"><input type="hidden" name="id" value="${esc(p.id)}"><button class="btn" type="submit" ${p.running ? 'disabled' : ''}>Make now</button></form>${p.part === 'diet' && p.span === 'week' && p.daily ? `<form method="post" action="/health/plan-today"><input type="hidden" name="id" value="${esc(p.id)}"><button class="btn secondary" type="submit">Send today's recipes</button></form>` : ''}
<form method="post" action="/health/plan-toggle"><input type="hidden" name="id" value="${esc(p.id)}"><button class="btn secondary" type="submit">${p.enabled ? 'Pause' : 'Resume'}</button></form></div>
<details><summary class="meta">Settings</summary>${planForm(p, esc)}
<form class="addfact danger" method="post" action="/health/plan-delete"><input type="hidden" name="id" value="${esc(p.id)}"><label class="meta"><input type="checkbox" name="confirm" value="yes"> Delete this plan</label><button class="btn secondary" type="submit">Delete</button></form></details>
</section>`;
}

/** Health → Dietary requirements: who eats, and what every recipe must respect. */
function needsSection(h: PanelHealth, esc: Esc): string {
  const rows = h.eaters
    .map(
      (e) => `<div class="addfact"><span class="meta"><b>${esc(e.name)}</b> · ${esc(h.diets[e.diet] ?? e.diet)}${e.allergies ? ` · <span class="warntext">allergic to ${esc(e.allergies)}</span>` : ''}${e.other ? ` · ${esc(e.other)}` : ''}</span>
<form method="post" action="/health/eater-remove"><input type="hidden" name="id" value="${esc(e.id)}"><button class="btn secondary" type="submit">Remove</button></form></div>`,
    )
    .join('');
  return `<section id="health-diet-needs"><h2>Dietary requirements</h2>
<p class="meta">Everyone who eats the meals Max plans. Every recipe has to suit everyone on this list, and Max checks each one himself (meat or fish in a vegetarian meal, an allergen, a cheese made with animal rennet): a slip is sent back to be fixed, and anything left is flagged on the plan. The number of people sets the portions.</p>
${rows || '<p class="empty">Nobody yet: add yourself (and whoever eats with you).</p>'}
<form class="stack" method="post" action="/health/eater-add"><div class="addfact wrap">
<label class="inline">Name<input name="name" maxlength="40" required placeholder="Me, Magda…"></label>
<label class="inline">Diet<select name="diet">${Object.entries(h.diets).map(([k, v]) => `<option value="${esc(k)}" ${k === 'vegetarian' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
<label class="inline">Allergies <span class="meta">(never used)</span><input name="allergies" maxlength="200" placeholder="e.g. peanuts, sesame"></label>
<label class="inline">Other <span class="meta">(needs, dislikes)</span><input name="other" maxlength="300" placeholder="e.g. gluten-free, no mushrooms"></label>
<button class="btn" type="submit">Add</button></div></form></section>`;
}

/** Health → This week's meals: each day's recipes, and the shopping list to tick off in the shop. */
function mealsSection(h: PanelHealth, esc: Esc): string {
  const m = h.meals;
  const facts = (r: MealRecipe) => [r.minutes ? `${r.minutes} min` : '', r.kcal ? `${r.kcal} kcal` : '', r.protein ? `${r.protein} g protein` : '', `serves ${r.servings}`].filter(Boolean).join(' · ');
  const addForm = (label: string, date?: string, meal?: string) =>
    `<form method="post" action="/health/shop-add-meals">${date ? `<input type="hidden" name="date" value="${esc(date)}">` : ''}${meal ? `<input type="hidden" name="meal" value="${esc(meal)}">` : ''}<button class="btn secondary small" type="submit">🛒 ${esc(label)}</button></form>`;
  const recipe = (meal: string, r: MealRecipe, date: string) => `<details class="recipe"><summary><b>${esc(meal.charAt(0).toUpperCase() + meal.slice(1))}:</b> ${esc(r.name)} <span class="meta">${esc(facts(r))}</span></summary>
<div class="cols"><div><b class="meta">Ingredients</b><ul>${r.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div><div><b class="meta">Method</b><ol>${r.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div></div>
${addForm('Add these ingredients to the shopping list', date, meal)}
${r.tip ? `<p class="meta">Tip: ${esc(r.tip)}</p>` : ''}${r.source ? `<p class="meta">From ${/^https?:\/\//.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(r.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>` : esc(r.source)}</p>` : ''}</details>`;
  const week = m
    ? `<p class="meta">${esc(m.notes ?? '')} Made ${esc(when(m.at))}. Say "what's for dinner tonight?" and Max puts the recipe on his screen, step by step.</p>
${m.warnings.length ? `<p class="hint"><b>Please check:</b> ${esc(m.warnings.join('; '))}</p>` : ''}
<div class="acts">${addForm(m.days.length > 1 ? "Add all the week's ingredients to the shopping list" : "Add all the ingredients to the shopping list")}</div>
${m.days.map((d) => `<h3${d.date === h.today ? ' class="today"' : ''}>${esc(d.day)} <span class="meta">${esc(d.date.slice(8))}/${esc(d.date.slice(5, 7))}${d.date === h.today ? ' · today' : ''}</span></h3>${['breakfast', 'lunch', 'dinner'].filter((x) => d.meals[x]).map((x) => recipe(x, d.meals[x]!, d.date)).join('')}`).join('')}`
    : '<p class="empty">No meal plan yet: create a weekly meal plan (Plans → New plan: "Meal plan", "the week ahead").</p>';
  const aisles = [...new Set(h.shopping.map((i) => i.aisle))];
  const left = h.shopping.filter((i) => !i.done).length;
  const shopName = h.grocers[h.grocer] ?? h.grocer;
  const product = (i: ShopRow, p: Product, chosen: boolean) =>
    `<div class="prod${chosen ? ' chosen' : ''}"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>${p.price ? ` <b>${esc(p.price)}</b>` : ''}${
      chosen
        ? ` <span class="qty"><form method="post" action="/health/shop-qty"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="qty" value="${i.qty - 1}"><button class="linkbtn" type="submit" aria-label="One fewer" ${i.qty <= 1 ? 'disabled' : ''}>−</button></form><b>${i.qty}</b><form method="post" action="/health/shop-qty"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="qty" value="${i.qty + 1}"><button class="linkbtn" type="submit" aria-label="One more">+</button></form></span>${i.cost !== undefined ? ` <b class="cost">${esc(gbp(i.cost))}</b>` : ''} <form method="post" action="/health/shop-unpick"><input type="hidden" name="id" value="${esc(i.id)}"><button class="linkbtn" type="submit">change</button></form>`
        : ` <form method="post" action="/health/shop-pick"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="url" value="${esc(p.url)}"><button class="btn secondary small" type="submit">Choose</button></form>`
    }</div>`;
  const row = (i: ShopRow) => {
    const extra = i.done
      ? ''
      : i.pick
        ? product(i, i.pick, true)
        : `${i.remembered ? `<div class="meta">Last time: </div>${product(i, i.remembered, false)}` : ''}${(i.found ?? []).map((p) => product(i, p, false)).join('')}`;
    const find = i.done || i.pick ? '' : i.finding ? '<span class="meta">looking…</span><span data-wait></span>' : h.canFind ? `<form method="post" action="/health/shop-find"><input type="hidden" name="id" value="${esc(i.id)}"><button class="linkbtn" type="submit">${i.found ? 'find again' : 'find products'}</button></form>` : '';
    return `<li class="${i.done ? 'done' : ''}"><div class="line"><form method="post" action="/health/shop-tick"><input type="hidden" name="id" value="${esc(i.id)}"><input type="hidden" name="done" value="${i.done ? 'no' : 'yes'}"><button class="tick" type="submit" aria-label="${i.done ? 'Not bought' : 'Bought'}">${i.done ? '☑' : '☐'}</button></form><span>${esc(i.text)}</span>${i.done ? '' : ` <a class="meta" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">🔍 ${esc(shopName)}</a> ${find}`}</div>${extra ? `<div class="prods">${extra}</div>` : ''}</li>`;
  };
  const b = h.basket;
  const totals = b.chosenItems || b.estimatedItems
    ? `<div class="totals">${b.chosenItems ? `<div><b>${esc(gbp(b.chosen))}</b> <span class="meta">for the ${b.chosenItems} product${b.chosenItems === 1 ? '' : 's'} chosen</span></div>` : ''}${b.estimatedItems > b.chosenItems || b.unknown ? `<div><b>about ${esc(gbp(b.estimate))}</b> <span class="meta">for ${b.estimatedItems} of the ${b.open} items to buy (the cheapest found where none is chosen)${b.unknown ? `; ${b.unknown} without a price yet: find products for them` : ''}</span></div>` : ''}</div>`
    : m?.estimatedCost
      ? `<div class="totals"><div><b>roughly £${m.estimatedCost}</b> <span class="meta">the AI's estimate for the week's shopping; find products for ${esc(shopName)}'s real prices</span></div></div>`
      : '';
  const shop = `<section id="health-shop"><h2>Shopping list <span class="meta">${left} to buy</span></h2>
${totals}
<form class="addfact" method="post" action="/health/grocer"><label class="meta" for="grocer">I shop at</label><select id="grocer" name="grocer">${Object.entries(h.grocers).map(([k, v]) => `<option value="${esc(k)}" ${k === h.grocer ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><button class="btn secondary" type="submit">Save</button>${h.canFind && left ? '<span></span>' : ''}</form>
${h.canFind && h.shopping.some((i) => !i.done && !i.pick) ? `<form method="post" action="/health/shop-find-all"><button class="btn secondary small" type="submit">Find products at ${esc(shopName)} for everything</button></form>` : ''}
${aisles.map((a) => `<p class="meta"><b>${esc(a)}</b></p><ul class="shop">${h.shopping.filter((i) => i.aisle === a).map(row).join('')}</ul>`).join('') || '<p class="empty">Empty: add the meal plan\'s ingredients with the 🛒 buttons on the Meals tab.</p>'}
<form class="addfact" method="post" action="/health/shop-add"><input name="item" maxlength="120" placeholder="Add something, e.g. oat milk" aria-label="Item"><button class="btn secondary" type="submit">Add</button></form>
${h.shopping.some((i) => i.done) ? '<form method="post" action="/health/shop-clear"><button class="btn secondary" type="submit">Clear ticked items</button></form>' : ''}
<p class="meta">🔍 opens ${esc(shopName)}'s search for that item. ${h.canFind ? `"Find products" lists what ${esc(shopName)} has, with prices: choose one and next week Max suggests the same. Max can't put things in your basket (supermarkets don't allow it), so tap a product to open it on ${esc(shopName)} and add it there.` : 'With Firecrawl set up (Connections → Web & trains), Max can also list the products and prices for each item.'} Tick things off as you buy them, or tell Max: "add oat milk", "I've got the spinach", "add tonight's dinner ingredients".</p>`;
  return `<section id="health-meals"><h2>${esc(m?.title ?? "This week's meals")}</h2>${week}</section>${shop}</section>`;
}

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

function planForm(p: PanelHealthPlan | undefined, esc: Esc): string {
  const days = p?.days ?? [1, 2, 3, 4, 5, 6, 7];
  const opt = (v: string, label: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return `<form class="stack" method="post" action="/health/plan-save">${p ? `<input type="hidden" name="id" value="${esc(p.id)}">` : ''}
<div class="addfact wrap"><label class="inline">Name<input name="name" maxlength="60" value="${esc(p?.name ?? '')}" placeholder="Morning workout"></label>
<label class="inline">For <select name="part">${opt('exercise', 'Exercise routine', p?.part ?? 'exercise')}${opt('diet', 'Meal plan', p?.part ?? 'exercise')}</select></label>
<label class="inline">Covers <select name="span">${opt('day', 'the day', p?.span ?? 'day')}${opt('week', 'the week ahead', p?.span ?? 'day')}</select></label></div>
<label>Websites to follow <span class="meta">(one per line, up to 5: a programme, a page of exercises or recipes, or a whole list of them, e.g. menshealth.com/uk/workouts: Max opens the ones that fit you, different ones each time)</span>
<textarea name="sources" rows="3" placeholder="nhs.uk/live-well/exercise/strength-exercises&#10;darebee.com/programs">${esc((p?.sources ?? []).join('\n'))}</textarea></label>
<label>What you want <span class="meta">(your level, goal, equipment, time you have, injuries or foods to avoid)</span>
<textarea name="brief" rows="3" required placeholder="Intermediate, want to get stronger and run 10 km. Dumbbells at home, 30–40 minutes on weekdays, longer at weekends. Bad left knee: no jumping.">${esc(p?.brief ?? '')}</textarea></label>
<div class="addfact wrap"><label class="inline">Time <input type="time" name="time" required value="${esc(p?.time ?? '06:45')}"></label>
<label class="check"><input type="checkbox" name="email" value="yes" ${p?.email ?? true ? 'checked' : ''}> Email it to me</label>
<label class="check"><input type="checkbox" name="whatsapp" value="yes" ${p?.whatsapp ? 'checked' : ''}> WhatsApp it to me</label></div>
<div class="addfact wrap"><span class="meta">For a weekly meal plan:</span>${['breakfast', 'lunch', 'dinner'].map((m) => `<label class="check"><input type="checkbox" name="meals" value="${m}" ${(p?.meals?.length ? p.meals : ['lunch', 'dinner']).includes(m) ? 'checked' : ''}> ${m.charAt(0).toUpperCase() + m.slice(1)}</label>`).join('')}
<label class="check"><input type="checkbox" name="daily" value="yes" ${p?.daily ?? true ? 'checked' : ''}> Each day, WhatsApp me that day's recipes step by step at</label><input type="time" name="dailyTime" value="${esc(p?.dailyTime ?? '12:00')}"></div>
<div class="days">${DAY.map((d, i) => `<label class="day"><input type="checkbox" name="days" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
<p class="meta">Days: when it's made and sent. For a weekly plan, the first day ticked (e.g. Sunday evening or Monday morning).</p>
${p ? `<label class="check"><input type="checkbox" name="enabled" value="yes" ${p.enabled ? 'checked' : ''}> On</label>` : ''}
<div class="acts"><button class="btn" type="submit">${p ? 'Save' : 'Create'}</button></div></form>`;
}

export const HEALTH_CSS =
  '.totals{display:flex;flex-direction:column;gap:2px;margin:6px 0 10px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)}.totals b{font-size:17px}.qty{display:inline-flex;gap:4px;align-items:center}.qty .linkbtn{font-size:17px;padding:0 4px}.cost{white-space:nowrap}' +
  '.shop li{flex-direction:column;align-items:stretch!important}.shop .line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.prods{margin:2px 0 6px 28px;display:flex;flex-direction:column;gap:3px}.prod{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:14px}.prod.chosen a{font-weight:600}.btn.small{padding:3px 10px;font-size:13px}' +
  '.recipe{border-top:1px solid var(--line);padding:8px 0}.recipe summary{cursor:pointer}.recipe .cols{display:grid;grid-template-columns:1fr 1.4fr;gap:16px;margin-top:8px}@media(max-width:640px){.recipe .cols{grid-template-columns:1fr}}.recipe ul,.recipe ol{margin:4px 0;padding-left:20px}' +
  'h3.today{color:var(--accent)}.shop{list-style:none;padding:0;margin:0 0 8px}.shop li{display:flex;gap:8px;align-items:center;padding:2px 0}.shop li.done span{text-decoration:line-through;opacity:.55}.tick{background:none;border:0;font-size:20px;cursor:pointer;line-height:1;padding:0;color:var(--text)}' +
  '.htiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:12px}' +
  '.htile{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:inherit;background:var(--card)}.htile:hover{border-color:var(--accent)}.hicon{font-size:22px}' +
  '.hchart{margin:8px 0}.hchart svg{width:100%;max-width:420px;height:auto;display:block}.hchart rect{fill:var(--accent);opacity:.8}.hchart text{font-size:9px;fill:var(--muted);text-anchor:middle}' +
  '.hlist{list-style:none;padding:0;margin:0}.hlist li{display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);padding:6px 0}.hlist form{margin-left:auto}' +
  '.linkbtn{background:none;border:0;color:var(--muted);cursor:pointer;font-size:14px}' +
  '.hplan{white-space:pre-wrap;font:inherit;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;max-height:420px;overflow:auto}';
