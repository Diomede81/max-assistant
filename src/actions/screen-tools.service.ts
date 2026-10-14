import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { Card, CardLine, dismissCard, screen, showCard } from '../face/screen';

const MAX_LINES = 12;
const MAX_STEPS = 30;
const MAX_INGREDIENTS = 20;
const LIST_MS = 90_000;
const BIG_MS = 45_000;
/** Recipes and instructions stay up while you follow them. */
const STEPS_MS = 15 * 60_000;
/** The safety net looks at a reply once Max has been quiet this long. */
const REPLY_SETTLE_MS = 4000;

/**
 * Recipes, how-tos and step-by-step instructions: they must go on screen as steps. (A plain
 * "show me my email" isn't one: Max has to read the email first, so it isn't forced.)
 */
const WANTS_SCREEN =
  /\b(recipes?|ingredients|step[- ]by[- ]step|instructions|walk me through|how (do|can|should|would) (i|you|we) (make|cook|bake|prepare|do|fix|set up|install|clean|change|replace|build)|how to (make|cook|bake|prepare|do|fix|set up|install|clean|change|replace|build))\b/i;

export function wantsScreen(request: string): boolean {
  return WANTS_SCREEN.test(request);
}

/** The rule the AI gets whenever the screen is available (in both conversation modes). */
export const SCREEN_RULE =
  'You have a round screen, and show_on_screen puts things on it. RULE: for every recipe, how-to or step-by-step ' +
  'request, and whenever the user says "show me", you MUST call show_on_screen FIRST (a recipe: title, ingredients ' +
  'and steps, one step per item), and only then speak a short summary such as "The recipe is on my screen. First, ' +
  '...". Never read a whole recipe or long instructions out loud instead of showing them. Use it for other answers ' +
  'that are easier to see than hear too (lists, comparisons, forecasts). To show an email: first read it with the ' +
  'email app, then show_on_screen with title "Email", subtitle "From <sender> · <when>", big = the subject, and ' +
  'body = a 2-4 sentence summary of what it says and anything it asks of the user, in your own words.';

interface Steps {
  title: string;
  icon?: string;
  ingredients: string[];
  list: string[];
  /** Page on screen: 0 = ingredients (if any), then the steps. */
  at: number;
}

/**
 * "Cards for any answer": lets the AI put an answer on the box's round screen when it's easier
 * to see than to hear: a list, a comparison, a forecast, headlines, or step-by-step instructions
 * (a recipe: its ingredients, then one step at a time, with Back / Next and "next step" by voice).
 *
 * A safety net backs it up: when a recipe or how-to was asked for and the AI only talked, the
 * steps are built from what Max said and shown anyway.
 */
@Injectable()
export class ScreenToolsService {
  private readonly log = new Logger('ScreenCards');
  private steps?: Steps;
  /** The conversation turn being watched by the safety net. */
  private turn?: { request: string; at: number; reply: { text: string; at: number }[]; shownAt: number };
  private lastShownAt = 0;
  private settle?: NodeJS.Timeout;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    // Tapping "Back to Max" on the steps card ends the recipe.
    screen.on('dismiss', (id: string) => {
      if (id === 'steps') this.steps = undefined;
    });
  }

  get tools(): ChatCompletionTool[] {
    if (!this.cfg.face.enabled) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'show_on_screen',
          description:
            'Put an answer on your round screen. REQUIRED for recipes, how-tos and step-by-step instructions (title, ' +
            'ingredients, steps: shown one at a time) and whenever the user says "show me"; also for lists, ' +
            'comparisons, several numbers or times, a forecast, headlines, an address. Call it BEFORE you speak, then ' +
            'say a short summary ("The recipe is on my screen. First, ..."), never the whole thing. For "next step" / ' +
            '"go back" / "step 4" while steps are showing, call with move or step only. clear removes the card.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short heading, e.g. "Macaroni cheese" or "Weekend weather"' },
              icon: { type: 'string', description: 'One emoji, e.g. 🍝 🧀 🌦️ 📰 🛒' },
              subtitle: { type: 'string', description: 'One short line under the title, e.g. "Serves 4 · 30 min" (optional)' },
              big: { type: 'string', description: 'One large line, for a single key fact or an email subject (optional)' },
              body: { type: 'string', description: 'A short paragraph, e.g. a summary of an email in your own words (optional, up to ~4 sentences)' },
              ingredients: { type: 'array', items: { type: 'string' }, description: 'For a recipe: what you need, one item each, e.g. "300 g macaroni"' },
              steps: { type: 'array', items: { type: 'string' }, description: 'Instructions in order, one short step each' },
              lines: {
                type: 'array',
                description: `Other answers: up to ${MAX_LINES} rows`,
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Short left column (max 8 characters): a time, day, price, number' },
                    text: { type: 'string' },
                    sub: { type: 'string', description: 'Smaller second line (optional)' },
                  },
                  required: ['text'],
                },
              },
              move: { type: 'string', enum: ['next', 'previous'], description: 'Move through the steps on screen' },
              step: { type: 'integer', description: 'Jump to this step number (1 = first step)' },
              image: { type: 'string', description: 'A picture URL (https) from a web result, optional' },
              clear: { type: 'boolean', description: 'Remove the card from the screen' },
            },
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return this.cfg.face.enabled && name === 'show_on_screen';
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    this.lastShownAt = Date.now();
    if (this.turn) this.turn.shownAt = Date.now();
    if (a.clear === true) {
      for (const id of ['answer', 'steps']) dismissCard(id);
      this.steps = undefined;
      return 'Cleared the screen.';
    }
    const steps = list(a.steps, 300, MAX_STEPS);
    const ingredients = list(a.ingredients, 120, MAX_INGREDIENTS);
    if (steps.length) {
      this.steps = { title: clean(a.title, 60) || 'Steps', icon: emoji(a.icon), ingredients, list: steps, at: 0 };
      const start = typeof a.step === 'number' ? this.stepPage(a.step) : 0;
      return `${this.showPage(start)} Now give a short spoken summary; don't read every step.`;
    }
    if (a.move === 'next' || a.move === 'previous' || typeof a.step === 'number') {
      if (!this.steps) return 'No steps are on the screen. To show some, call with steps.';
      const to = typeof a.step === 'number' ? this.stepPage(a.step) : this.steps.at + (a.move === 'next' ? 1 : -1);
      return this.showPage(to);
    }
    const title = clean(a.title, 60);
    const lines: CardLine[] = (Array.isArray(a.lines) ? a.lines : [])
      .slice(0, MAX_LINES)
      .map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>) : ({ text: l } as Record<string, unknown>)))
      .map((l) => ({ time: clean(l.label, 8) || undefined, text: clean(l.text, 160), sub: clean(l.sub, 160) || undefined }))
      .filter((l) => l.text);
    if (!lines.length && ingredients.length) lines.push(...ingredients.map((text) => ({ text })));
    const big = clean(a.big, 140);
    const body = clean(a.body, 700);
    if (!title && !lines.length && !big && !body) return 'Nothing to show: give a title, lines, big, body or steps.';
    const image = typeof a.image === 'string' && /^https:\/\/[^\s"'<>]+$/.test(a.image) ? a.image : undefined;
    showCard({
      id: 'answer',
      kind: 'list',
      icon: emoji(a.icon),
      title: title || 'Max',
      subtitle: clean(a.subtitle, 100) || undefined,
      big: big || undefined,
      body: body || undefined,
      image,
      lines: lines.length ? lines : undefined,
      ttlMs: lines.length > 3 || body ? LIST_MS : BIG_MS,
    });
    return `Shown on the screen${lines.length ? ` (${lines.length} rows)` : ''}.`;
  }

  /** Step number (1 = first step) -> page (the ingredients page comes first). */
  private stepPage(n: number): number {
    return n - 1 + (this.steps?.ingredients.length ? 1 : 0);
  }

  /** The steps card: the ingredients, then one step at a time, big, with Back / Next. */
  private showPage(page: number): string {
    const s = this.steps!;
    const offset = s.ingredients.length ? 1 : 0;
    const pages = s.list.length + offset;
    s.at = Math.max(0, Math.min(pages - 1, page));
    const last = s.at === pages - 1;
    const actions = [
      ...(s.at > 0 ? [{ id: 'previous', label: 'Back' }] : []),
      last ? { id: 'finish', label: 'Done', style: 'primary' as const } : { id: 'next', label: s.at === 0 && offset ? 'Start' : 'Next', style: 'primary' as const },
    ];
    let card: Card;
    let said: string;
    if (offset && s.at === 0) {
      card = { id: 'steps', kind: 'list', icon: s.icon, title: s.title, subtitle: `Ingredients · then ${s.list.length} steps`, lines: s.ingredients.map((text) => ({ text })), actions, ttlMs: STEPS_MS };
      said = `Showing the ingredients (${s.ingredients.length}), then ${s.list.length} steps.`;
    } else {
      const i = s.at - offset;
      card = {
        id: 'steps',
        kind: 'notice',
        icon: s.icon,
        title: s.title,
        subtitle: `Step ${i + 1} of ${s.list.length}`,
        big: s.list[i],
        lines: last ? undefined : [{ time: 'next', text: s.list[i + 1], tag: 'done' }],
        actions,
        ttlMs: STEPS_MS,
      };
      said = `Showing step ${i + 1} of ${s.list.length}: ${s.list[i]}${last ? ' (the last step)' : ''}`;
    }
    showCard(card, {
      next: () => void this.showPage(s.at + 1),
      previous: () => void this.showPage(s.at - 1),
      finish: () => {
        this.steps = undefined;
        dismissCard('steps');
      },
    });
    return said;
  }

  // ---------- Safety net: a recipe asked for, only talked about ----------

  /** What the user just said (from the conversation, via the face). */
  userSaid(text: string): void {
    if (!this.cfg.face.enabled) return;
    const now = Date.now();
    // Live voice transcribes you a moment after Max starts answering: keep his words from just now
    // (only those not already part of an earlier question's turn).
    const reply = (this.turn && !this.turn.request ? this.turn.reply : []).filter((r) => now - r.at < 8000);
    this.turn = { request: text, at: now, reply, shownAt: now - this.lastShownAt < 8000 ? this.lastShownAt : 0 };
  }

  /** A sentence Max said. Once he has been quiet a moment, the turn is checked. */
  maxSaid(text: string): void {
    if (!this.cfg.face.enabled) return;
    if (!this.turn) this.turn = { request: '', at: Date.now(), reply: [], shownAt: 0 };
    this.turn.reply.push({ text, at: Date.now() });
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.checkTurn(), REPLY_SETTLE_MS);
  }

  /** If a recipe / how-to was asked for and nothing went on screen, build the card from his words. */
  checkTurn(): boolean {
    const t = this.turn;
    this.turn = undefined; // this turn is settled either way
    if (!t?.request || t.shownAt || !wantsScreen(t.request)) return false;
    const card = stepsFromSpeech(t.reply.map((r) => r.text).join(' '), t.request);
    if (!card) return false;
    this.log.log(`Safety net: showing ${card.list.length} steps that were only spoken`);
    this.steps = { ...card, at: 0 };
    this.showPage(0);
    this.lastShownAt = Date.now();
    return true;
  }
}

/** Steps (and ingredients) from a spoken recipe or how-to; undefined if it isn't one. */
export function stepsFromSpeech(text: string, request = ''): Omit<Steps, 'at'> | undefined {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 120) return undefined;
  let ingredients: string[] = [];
  let parts: string[];
  const numbered = t.split(/(?:^|\s)(?:step\s*)?\d{1,2}[.)]\s+|(?:^|\s)step (?:one|two|three|four|five|six|seven|eight|nine|ten)[:,]?\s+/i).map((x) => x.trim()).filter(Boolean);
  parts = numbered.length >= 3 ? numbered : t.split(/(?<=[.!?])\s+/);
  parts = parts.map((p) => p.trim()).filter(Boolean);
  // "You'll need 300 g macaroni, 50 g butter and 500 ml milk." -> the ingredients page.
  const needIdx = parts.findIndex((p) => /\b(you('| wi)ll need|you need|ingredients( are)?|grab)\b/i.test(p));
  if (needIdx >= 0) {
    const after = parts[needIdx].replace(/^.*?\b(you('| wi)ll need|you need|ingredients( are)?|grab)\b[:,]?\s*/i, '').replace(/[.!]$/, '');
    ingredients = after.split(/,\s*|\s+and\s+/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, MAX_INGREDIENTS);
    parts.splice(needIdx, 1);
  }
  // Drop chatter ("Sure!", "Here's how", "Enjoy!", "on my screen").
  parts = parts.filter((p) => p.length > 12 && !/^(sure|of course|okay|ok|great|here'?s|here is|enjoy|bon appetit|let me know|happy cooking)\b/i.test(p) && !/on (my|the) screen/i.test(p));
  // Very short sentences join the next one (numbered steps stay as they are).
  const steps: string[] = [];
  for (const p of parts) {
    if (numbered.length < 3 && steps.length && steps[steps.length - 1].length < 25) steps[steps.length - 1] += ` ${p}`;
    else steps.push(p);
  }
  if (steps.length < 3) return undefined;
  const m = /(?:recipe for|how (?:do|can|should|would) (?:i|you|we) (?:make|cook|bake|prepare)|how to (?:make|cook|bake|prepare)|make me)\s+(?:a |an |some |the )?(.+?)[?.!]*$/i.exec(request.trim());
  const title = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : 'Steps';
  const cooking = /\b(recipe|cook|bake|make|ingredients|oven|pan|boil)\b/i.test(request + ' ' + t);
  return { title: title.slice(0, 60), icon: cooking ? '🍳' : '📋', ingredients, list: steps.slice(0, MAX_STEPS).map((s) => s.slice(0, 300)) };
}

function list(v: unknown, max: number, count: number): string[] {
  return Array.isArray(v) ? v.map((s) => clean(s, max)).filter(Boolean).slice(0, count) : [];
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
}

/** A short icon (an emoji or two), never a sentence. */
function emoji(v: unknown): string | undefined {
  const s = clean(v, 8);
  return s && !/[a-z]{3}/i.test(s) ? s : undefined;
}
