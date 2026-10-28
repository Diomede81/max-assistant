/**
 * Weekly meal plans: recipes for lunch and dinner (and breakfast if wanted) for everyone who eats,
 * within everyone's dietary requirements, with one shopping list for the week. The AI model writes
 * them as JSON; this checks the recipes against the requirements (a slip is caught, not served) and
 * turns the plan into text for email, WhatsApp, the screen and Max's voice.
 */

/** Someone who eats the meals (Health → Dietary requirements). */
export interface Eater {
  id: string;
  name: string;
  diet: keyof typeof DIETS;
  /** Never in any recipe (e.g. "peanuts, sesame"). */
  allergies?: string;
  /** Other needs and dislikes (e.g. "gluten-free", "no mushrooms"). */
  other?: string;
}

export const DIETS = {
  any: 'No restrictions',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian (fish, no meat)',
} as const;

export const GOALS = {
  lose: 'Lose weight',
  muscle: 'Build muscle',
  maintain: 'Keep my weight',
  healthy: 'Eat healthily',
} as const;
export type Goal = keyof typeof GOALS;

export type MealName = 'breakfast' | 'lunch' | 'dinner';
export const MEALS: MealName[] = ['breakfast', 'lunch', 'dinner'];

export interface Recipe {
  name: string;
  servings: number;
  minutes?: number;
  /** Per serving. */
  kcal?: number;
  protein?: number;
  ingredients: string[];
  steps: string[];
  /** Where it comes from (a website), if from one. */
  source?: string;
  tip?: string;
}

export interface MealDay {
  /** "YYYY-MM-DD". */
  date: string;
  day: string;
  meals: Partial<Record<MealName, Recipe>>;
}

export interface ShopItem {
  id: string;
  text: string;
  aisle: string;
  done: boolean;
  /** Added by the user (kept when a new week's plan arrives). */
  extra?: boolean;
  /** Products found at the chosen supermarket, and the one chosen. */
  found?: { title: string; url: string; price?: string }[];
  pick?: { title: string; url: string; price?: string };
  /** How many of the chosen product to buy (from the wording, or set on the list). */
  qty?: number;
}

export interface MealPlan {
  planId: string;
  at: string;
  title: string;
  notes?: string;
  days: MealDay[];
  /** Problems the check found (and couldn't fix): shown, so nothing unsafe goes unnoticed. */
  warnings: string[];
  /** The AI model's rough guess of the shopping cost (pounds), before any real prices are looked up. */
  estimatedCost?: number;
}

// ---------- Dietary checks ----------

const MEAT = ['chicken', 'beef', 'pork', 'bacon', 'ham', 'lamb', 'mutton', 'veal', 'turkey', 'duck', 'goose', 'venison', 'sausage', 'sausages', 'chorizo', 'salami', 'pepperoni', 'prosciutto', 'pancetta', 'guanciale', 'mince', 'steak', 'meatball', 'meatballs', 'burger', 'lard', 'suet', 'gelatine', 'gelatin', 'chicken stock', 'beef stock', 'bone broth'];
const FISH = ['fish', 'salmon', 'tuna', 'cod', 'haddock', 'mackerel', 'sardine', 'sardines', 'anchovy', 'anchovies', 'prawn', 'prawns', 'shrimp', 'crab', 'lobster', 'mussels', 'clams', 'squid', 'scallops', 'fish sauce', 'worcestershire'];
/** Cheeses made with animal rennet (not vegetarian unless a vegetarian version). */
const RENNET = ['parmesan', 'parmigiano', 'pecorino', 'grana padano', 'gorgonzola', 'manchego', 'gruyère', 'gruyere', 'emmental'];
const ANIMAL = ['milk', 'cheese', 'butter', 'cream', 'egg', 'eggs', 'yoghurt', 'yogurt', 'honey', 'ghee', 'mayonnaise', 'mayo', 'crème fraîche', 'creme fraiche', 'paneer', 'feta', 'mozzarella', 'ricotta', 'halloumi', 'mascarpone', 'quark', 'whey'];
/** Words that make an ingredient plant-based or vegetarian ("oat milk", "veggie sausages", "vegetarian hard cheese"). */
const SAFE = /\b(vegan|vegetarian|veggie|plant[- ]based|meat[- ]free|meatless|dairy[- ]free|soya|soy|oat|almond|coconut|cashew|rice|hemp|pea|quorn|tofu|seitan|tempeh|jackfruit|peanut|nut|apple|cocoa|shea|aubergine|mushroom|lentil|bean)\b/i;

const has = (text: string, word: string) => new RegExp(`(^|[^a-zà-ÿ])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-zà-ÿ])`, 'i').test(text);

/** What in a recipe breaks someone's diet or allergies: "Lasagne: pancetta (not vegetarian: Magda)". */
export function checkRecipe(r: Recipe, eaters: Eater[]): string[] {
  /** "line (why)" → who: one problem per ingredient and reason, naming everyone it affects. */
  const found = new Map<string, string[]>();
  const lines = [r.name, ...r.ingredients];
  for (const e of eaters) {
    const banned: { words: string[]; why: string }[] = [];
    if (e.diet === 'vegetarian' || e.diet === 'vegan') banned.push({ words: [...MEAT, ...FISH], why: e.diet }, { words: RENNET, why: `${e.diet} (made with animal rennet: use a vegetarian hard cheese)` });
    if (e.diet === 'pescatarian') banned.push({ words: MEAT, why: 'pescatarian' });
    if (e.diet === 'vegan') banned.push({ words: ANIMAL, why: 'vegan' });
    const allergens = (e.allergies ?? '').split(/[,;/]|\band\b/).map((a) => a.trim().toLowerCase().replace(/s$/, '')).filter((a) => a.length >= 3);
    if (allergens.length) banned.push({ words: allergens.flatMap((a) => [a, `${a}s`]), why: 'allergy' });
    for (const line of lines) {
      for (const b of banned) {
        const hit = b.words.find((w) => has(line, w));
        if (!hit) continue;
        // "vegetarian sausages", "oat milk", "vegan mayo": fine, except for an allergy
        if (b.why !== 'allergy' && SAFE.test(line) && !RENNET.includes(hit)) continue;
        if (b.why !== 'allergy' && RENNET.includes(hit) && /\bvegetarian\b/i.test(line)) continue;
        const key = `${r.name}: "${line}" (${b.why}`;
        const who = found.get(key) ?? [];
        if (!who.includes(e.name)) who.push(e.name);
        found.set(key, who);
      }
    }
  }
  return [...found].map(([k, who]) => `${k}: ${who.join(', ')})`);
}

// ---------- Targets ----------

/** Daily calories and protein for the user from their profile and goal (Mifflin-St Jeor), when known. */
export function targets(p: { age?: number; sex?: string; heightCm?: number; activity?: string; goal?: Goal }, kg?: number): { kcal?: number; protein?: number } {
  if (!p.age || !p.heightCm || !kg) return {};
  const bmr = 10 * kg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'female' ? -161 : p.sex === 'male' ? 5 : -78);
  const factor = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 }[p.activity ?? ''] ?? 1.375;
  const delta = p.goal === 'lose' ? -500 : p.goal === 'muscle' ? 250 : 0;
  const kcal = Math.round((bmr * factor + delta) / 50) * 50;
  const protein = Math.round(kg * (p.goal === 'muscle' ? 1.8 : p.goal === 'lose' ? 1.4 : 1));
  return { kcal: Math.max(1200, kcal), protein };
}

// ---------- The AI model's answer ----------

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : typeof v === 'string' && /^\d+/.test(v) ? parseInt(v, 10) : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(typeof x === 'object' && x ? (x as { text?: unknown }).text ?? '' : x)).filter(Boolean).slice(0, 40) : []);

function recipe(v: unknown, servings: number): Recipe | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name).slice(0, 120);
  const ingredients = list(o.ingredients);
  const steps = list(o.steps);
  if (!name || !ingredients.length || !steps.length) return undefined;
  return { name, servings: n(o.servings) || servings, minutes: n(o.minutes), kcal: n(o.kcal), protein: n(o.protein), ingredients, steps, source: str(o.source).slice(0, 200) || undefined, tip: str(o.tip).slice(0, 300) || undefined };
}

/** The plan from the model's JSON (days in order from `start`), or undefined if it isn't usable. */
export function parsePlan(reply: string, meals: MealName[], start: { date: string; weekday: number }, servings: number, dayCount = 7): { title: string; notes?: string; days: MealDay[]; shopping: { aisle: string; items: string[] }[]; cost?: number } | undefined {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const raw = Array.isArray(j.days) ? (j.days as Record<string, unknown>[]) : [];
  const days: MealDay[] = [];
  for (let i = 0; i < Math.min(dayCount, raw.length); i++) {
    const date = addDays(start.date, i);
    const dm: Partial<Record<MealName, Recipe>> = {};
    for (const m of meals) {
      const r = recipe(raw[i]?.[m], servings);
      if (r) dm[m] = r;
    }
    if (Object.keys(dm).length) days.push({ date, day: WEEKDAYS[(start.weekday - 1 + i) % 7], meals: dm });
  }
  if (days.length < Math.min(3, dayCount)) return undefined;
  const shopping = (Array.isArray(j.shopping) ? (j.shopping as Record<string, unknown>[]) : [])
    .map((g) => ({ aisle: str(g?.aisle).slice(0, 40) || 'Other', items: list(g?.items) }))
    .filter((g) => g.items.length);
  // no shopping list in the answer: made from the recipes' ingredients (so the list is never empty)
  if (!shopping.length) shopping.push({ aisle: 'From the recipes', items: ingredientsOf(days) });
  const cost = typeof j.cost === 'number' ? j.cost : typeof j.cost === 'string' ? parseFloat(j.cost.replace(/[^\d.]/g, '')) : NaN;
  return { title: str(j.title).slice(0, 120) || 'This week\'s meals', notes: str(j.notes).slice(0, 600) || undefined, days, shopping, cost: Number.isFinite(cost) && cost > 0 && cost < 1000 ? Math.round(cost) : undefined };
}

/** Every ingredient of these days' recipes (or one meal), once each. */
export function ingredientsOf(days: MealDay[], meal?: MealName): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of days) {
    for (const m of MEALS) {
      if (meal && m !== meal) continue;
      for (const i of d.meals[m]?.ingredients ?? []) {
        const k = i.toLowerCase().trim();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(i);
        }
      }
    }
  }
  return out;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- Text ----------

const line = (r: Recipe) => [r.minutes ? `${r.minutes} min` : '', r.kcal ? `${r.kcal} kcal` : '', r.protein ? `${r.protein} g protein` : ''].filter(Boolean).join(', ');

export function recipeText(meal: string, r: Recipe): string {
  return [
    `${meal}: ${r.name}${line(r) ? ` (${line(r)}, each)` : ''}, serves ${r.servings}`,
    'Ingredients:',
    ...r.ingredients.map((i) => `- ${i}`),
    'Method:',
    ...r.steps.map((s, i) => `${i + 1}. ${s}`),
    r.tip ? `Tip: ${r.tip}` : '',
    r.source ? `From: ${r.source}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A recipe as a WhatsApp message: bold name, the ingredients, then the steps numbered one per line. */
export function recipeWhatsApp(meal: string, r: Recipe): string {
  return [
    `*${meal}: ${r.name}*`,
    [r.minutes ? `${r.minutes} min` : '', `serves ${r.servings}`, r.kcal ? `${r.kcal} kcal each` : '', r.protein ? `${r.protein} g protein` : ''].filter(Boolean).join(' · '),
    '',
    '*Ingredients*',
    ...r.ingredients.map((i) => `• ${i}`),
    '',
    '*Method*',
    ...r.steps.map((st, i) => `${i + 1}. ${st}`),
    r.tip ? `\n_Tip: ${r.tip}_` : '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Ingredients a supermarket search would understand (a quantity first, a product name), and steps worth
 * following (enough of them, not one-word): what's off is sent back to the model to fix.
 */
export function checkFormat(r: Recipe): string[] {
  const out: string[] = [];
  const vague = r.ingredients.filter((i) => !/^\s*(\d|½|¼|¾|a |an |one |two |three |half |pinch|handful|bunch|splash|drizzle|juice of|zest of)/i.test(i) || /\b(some|of choice|to taste|as needed|your favourite|any)\b/i.test(i));
  if (vague.length) out.push(`${r.name}: ingredient${vague.length === 1 ? '' : 's'} without a clear quantity or product: ${vague.slice(0, 3).map((v) => `"${v}"`).join(', ')}`);
  if (r.steps.length < 3) out.push(`${r.name}: only ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}: write the method out, one action per step`);
  else if (r.steps.filter((st) => st.split(/\s+/).length < 3).length > 1) out.push(`${r.name}: some steps are too short to follow`);
  return out;
}

export function dayText(d: MealDay): string {
  return MEALS.filter((m) => d.meals[m])
    .map((m) => recipeText(cap(m), d.meals[m]!))
    .join('\n\n');
}

/** The week at a glance: one line per meal. */
export function overview(p: Pick<MealPlan, 'days'>): string {
  return p.days
    .map((d) => `${d.day}: ${MEALS.filter((m) => d.meals[m]).map((m) => `${m} ${d.meals[m]!.name}`).join(' · ')}`)
    .join('\n');
}

export function shoppingText(items: ShopItem[]): string {
  const left = items.filter((i) => !i.done);
  if (!left.length) return 'Nothing left to buy.';
  const aisles = [...new Set(left.map((i) => i.aisle))];
  return aisles.map((a) => `${a}:\n${left.filter((i) => i.aisle === a).map((i) => `- ${i.text}`).join('\n')}`).join('\n\n');
}

/** The whole plan as an email: the week, every recipe, the shopping list. */
export function emailText(p: MealPlan, items: ShopItem[]): string {
  return [
    p.title,
    p.notes ?? '',
    p.warnings.length ? `Please check: ${p.warnings.join('; ')}` : '',
    'The week',
    overview(p),
    'Shopping list',
    shoppingText(items),
    ...p.days.map((d) => `${d.day} ${d.date}\n\n${dayText(d)}`),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
