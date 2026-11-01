import { ModelsService, Task } from '../models/models.service';

/** A better wording for what someone wrote on a form: the rewritten field(s) and why. Nothing is saved by it. */
export interface Wording {
  fields: Record<string, string>;
  why: string[];
}

/** What each form's wording helper knows about how Max does that job, and which fields it rewrites. */
const KINDS = {
  plan: {
    task: 'health' as Task,
    fields: ['brief'],
    labels: { brief: 'BRIEF' },
    system:
      'You help someone word what they want from a health plan that Max, a home assistant, writes for them on a schedule and sends by email or WhatsApp. How Max works:\n' +
      '- He opens the websites they listed (programmes, pages of exercises or recipes) and picks the pages that fit the brief, different ones each time; with no websites he uses general knowledge.\n' +
      '- The brief is the only description of the person he reads for the plan, next to their profile (age, fitness, limits) and their recent log. He follows it literally.\n' +
      '- An exercise plan: one day, or the week ahead day by day, with warm-up, exercises, sets, reps or minutes, and what to watch. After each session the user can say how it went and the rest of the week is adjusted.\n' +
      '- A meal plan: the week\'s meals (the meals ticked on the form) with recipes step by step and an ingredient list with supermarket names, one day\'s recipes sent each day.\n' +
      'Rewrite the brief in the user\'s language into the most useful one for that, keeping every detail they gave and adding only what the plan needs to fit them, as plain sentences: their level and goal; equipment and where; time per session and how many sessions a week; what they like and dislike; injuries, conditions or foods to avoid; how progress should go (gently, or push); the shape wanted (how many exercises, how long the warm-up; for meals: cuisines, cooking time, budget, batch cooking, who eats). Where something important is unknown, do not invent it: write a short bracketed prompt like "[time per session?]" for them to fill in. Nothing Max cannot do (no shopping, no booking). At most 900 characters, no headings or bullet lists.\n' +
      'Answer in exactly this form:\nBRIEF:\n<the rewritten brief>\nWHY:\n- <one short reason per line, at most four>',
  },
  news: {
    task: 'news' as Task,
    fields: ['interests', 'avoid'],
    labels: { interests: 'INTERESTS', avoid: 'AVOID' },
    system:
      'You help someone word the interests for a news briefing that Max, a home assistant, gathers on a schedule and reads out. How Max works:\n' +
      '- He reads the recent headlines of the websites they listed (and, if research is on, runs one news search per interest), has a model score each article 1-10 for how well it matches the interests, keeps the best few, reads them and writes a short summary of each.\n' +
      '- Vague interests ("technology", "sport") match everything and crowd out what they care about; specific ones (a team, a company, a person, a place, a topic phrased the way headlines phrase it) work best. Each interest also becomes a search, so each should stand on its own.\n' +
      '- "Leave out" removes whole kinds of story (celebrity gossip, shopping guides, a sport they do not follow).\n' +
      'Rewrite the interests as a comma-separated list of specific ones in the user\'s language (keep every one they gave, made specific where vague, split where two were joined; 4 to 12 items), and the leave-out list the same way (keep theirs; add only what their interests clearly imply they would not want, at most 5). Do not invent interests they did not imply.\n' +
      'Answer in exactly this form:\nINTERESTS:\n<comma-separated>\nAVOID:\n<comma-separated, or nothing>\nWHY:\n- <one short reason per line, at most four>',
  },
} as const;
export type WordingKind = keyof typeof KINDS;

/** Asks the job's own model for a better wording of a form's text; the caller shows it, the user decides. */
export async function suggestWording(models: ModelsService, kind: WordingKind, input: Record<string, string>, context: string): Promise<Wording> {
  const k = KINDS[kind];
  const text = k.fields.map((f) => `${k.labels[f as keyof typeof k.labels]}: ${(input[f] ?? '').trim().slice(0, 2000)}`).join('\n');
  const out = await models.complete(k.task, { system: k.system, user: `${context ? `${context}\n` : ''}As written:\n${text}`, maxTokens: 1200, temperature: 0.2, timeoutMs: 90_000 });
  return parseWording(out, k.fields.map((f) => [f, k.labels[f as keyof typeof k.labels]]));
}

/** "LABEL:\n…" sections in the order given, then WHY; a reply without labels is taken as the first field. */
export function parseWording(out: string, fields: readonly (readonly [string, string])[]): Wording {
  const labels = [...fields.map(([, l]) => l), 'WHY'];
  const re = new RegExp(`^\\s*(${labels.join('|')}):\\s*`, 'im');
  const result: Wording = { fields: {}, why: [] };
  let rest = out.trim();
  const parts: { label: string; text: string }[] = [];
  let m = re.exec(rest);
  if (!m) return { fields: { [fields[0][0]]: rest.replace(/^["'`]+|["'`]+$/g, '').slice(0, 1500) }, why: [] };
  rest = rest.slice(m.index);
  while (rest) {
    const head = re.exec(rest);
    if (!head) break;
    const after = rest.slice(head.index + head[0].length);
    const next = new RegExp(`\\n\\s*(${labels.join('|')}):`, 'i').exec(after);
    parts.push({ label: head[1].toUpperCase(), text: (next ? after.slice(0, next.index) : after).trim() });
    rest = next ? after.slice(next.index + 1) : '';
  }
  for (const [field, label] of fields) {
    const p = parts.find((x) => x.label === label.toUpperCase());
    if (p) result.fields[field] = p.text.replace(/^["'`]+|["'`]+$/g, '').replace(/^nothing\.?$/i, '').slice(0, 1500);
  }
  const why = parts.find((x) => x.label === 'WHY');
  if (why) result.why = why.text.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 4);
  return result;
}

/** The suggestion under a form: a read-only copy per field, the reasons, and one button that fills the form in. */
export function wordingBlock(w: Wording | undefined, fields: { name: string; label: string; rows?: number }[], esc: (s: string) => string): string {
  if (!w || !fields.some((f) => w.fields[f.name])) return '';
  const copies = fields.filter((f) => w.fields[f.name] !== undefined).map((f) => `<label class="meta">${esc(f.label)}<textarea rows="${f.rows ?? 3}" readonly data-for="${esc(f.name)}">${esc(w.fields[f.name] ?? '')}</textarea></label>`).join('');
  return `<div class="suggest"><p class="meta"><strong>Suggested wording.</strong> Use it as it is, edit it, or keep your own. Nothing changes until you press Save.</p>${copies}
${w.why.length ? `<ul class="meta">${w.why.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<div class="acts"><button class="btn secondary" type="button" onclick="var f=this.closest('form');this.closest('.suggest').querySelectorAll('textarea[data-for]').forEach(function(t){var e=f.elements[t.getAttribute('data-for')];if(e){e.value=t.value}});f.querySelector('[name=${esc(fields[0].name)}]').focus()">Use this wording</button></div></div>`;
}

/** The button that asks for a suggestion, next to Save: posts the form as it stands, without validating it. */
export function wordingButton(action: string, esc: (s: string) => string): string {
  return `<button class="btn secondary" type="submit" formaction="${esc(action)}" formnovalidate title="Max rewrites what you wrote into the wording that works best for this job. Nothing is saved until you press Save.">Improve the wording</button>`;
}
