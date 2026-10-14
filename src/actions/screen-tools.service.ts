import { Inject, Injectable } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { Card, CardLine, dismissCard, screen, showCard } from '../face/screen';

const MAX_LINES = 12;
const MAX_STEPS = 30;
const LIST_MS = 90_000;
const BIG_MS = 45_000;
/** Recipes and instructions stay up while you follow them. */
const STEPS_MS = 15 * 60_000;

/**
 * "Cards for any answer": lets the AI put an answer on the box's round screen when it's easier
 * to see than to hear: a list, a comparison, a forecast, headlines, or step-by-step instructions
 * (a recipe), shown one step at a time with Back / Next buttons and "next step" by voice.
 */
@Injectable()
export class ScreenToolsService {
  private steps?: { title: string; icon?: string; list: string[]; at: number };

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
            'You have a round screen. When an answer is easier to SEE than hear, also put it on screen: lists (shopping, ' +
            'options, results), comparisons, several numbers or times, a forecast, headlines, an address, or ' +
            'step-by-step instructions such as a recipe (pass steps: shown one at a time). Still answer out loud, ' +
            'briefly ("Here are the steps on my screen; first, ..."). For "next step" / "go back" / "step 4" while ' +
            'steps are showing, call with move or step only. clear removes the card. Not for one-line answers.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short heading, e.g. "Carbonara" or "Weekend weather"' },
              icon: { type: 'string', description: 'One emoji, e.g. 🍝 🌦️ 📰 🛒' },
              subtitle: { type: 'string', description: 'One short line under the title (optional)' },
              big: { type: 'string', description: 'One large line, for a single key fact (optional)' },
              lines: {
                type: 'array',
                description: `Up to ${MAX_LINES} rows`,
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
              steps: { type: 'array', items: { type: 'string' }, description: 'Instructions in order, one step each (shown one at a time)' },
              move: { type: 'string', enum: ['next', 'previous'], description: 'Move through the steps on screen' },
              step: { type: 'integer', description: 'Jump to this step number (1 = first)' },
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
    if (a.clear === true) {
      for (const id of ['answer', 'steps']) dismissCard(id);
      this.steps = undefined;
      return 'Cleared the screen.';
    }
    const steps = Array.isArray(a.steps) ? a.steps.map((s) => clean(s, 300)).filter(Boolean).slice(0, MAX_STEPS) : [];
    if (steps.length) {
      this.steps = { title: clean(a.title, 60) || 'Steps', icon: emoji(a.icon), list: steps, at: 0 };
      return this.showStep(typeof a.step === 'number' ? a.step - 1 : 0);
    }
    if (a.move === 'next' || a.move === 'previous' || typeof a.step === 'number') {
      if (!this.steps) return 'No steps are on the screen. To show some, call with steps.';
      const to = typeof a.step === 'number' ? a.step - 1 : this.steps.at + (a.move === 'next' ? 1 : -1);
      return this.showStep(to);
    }
    const title = clean(a.title, 60);
    const lines: CardLine[] = (Array.isArray(a.lines) ? a.lines : [])
      .slice(0, MAX_LINES)
      .map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>) : ({ text: l } as Record<string, unknown>)))
      .map((l) => ({ time: clean(l.label, 8) || undefined, text: clean(l.text, 160), sub: clean(l.sub, 160) || undefined }))
      .filter((l) => l.text);
    const big = clean(a.big, 140);
    if (!title && !lines.length && !big) return 'Nothing to show: give a title, lines, big or steps.';
    const image = typeof a.image === 'string' && /^https:\/\/[^\s"'<>]+$/.test(a.image) ? a.image : undefined;
    showCard({
      id: 'answer',
      kind: 'list',
      icon: emoji(a.icon),
      title: title || 'Max',
      subtitle: clean(a.subtitle, 100) || undefined,
      big: big || undefined,
      image,
      lines: lines.length ? lines : undefined,
      ttlMs: lines.length > 3 ? LIST_MS : BIG_MS,
    });
    return `Shown on the screen${lines.length ? ` (${lines.length} rows)` : ''}.`;
  }

  /** The steps card: one step, big, with Back / Next. */
  private showStep(i: number): string {
    const s = this.steps!;
    s.at = Math.max(0, Math.min(s.list.length - 1, i));
    const last = s.at === s.list.length - 1;
    const card: Card = {
      id: 'steps',
      kind: 'notice',
      icon: s.icon,
      title: s.title,
      subtitle: `Step ${s.at + 1} of ${s.list.length}`,
      big: s.list[s.at],
      lines: last ? undefined : [{ time: 'next', text: s.list[s.at + 1], tag: 'done' }],
      actions: [
        ...(s.at > 0 ? [{ id: 'previous', label: 'Back' }] : []),
        last ? { id: 'finish', label: 'Done', style: 'primary' as const } : { id: 'next', label: 'Next', style: 'primary' as const },
      ],
      ttlMs: STEPS_MS,
    };
    showCard(card, {
      next: () => void this.showStep(s.at + 1),
      previous: () => void this.showStep(s.at - 1),
      finish: () => {
        this.steps = undefined;
        dismissCard('steps');
      },
    });
    return `Showing step ${s.at + 1} of ${s.list.length}: ${s.list[s.at]}${last ? ' (the last step)' : ''}`;
  }
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
}

/** A short icon (an emoji or two), never a sentence. */
function emoji(v: unknown): string | undefined {
  const s = clean(v, 8);
  return s && !/[a-z]{3}/i.test(s) ? s : undefined;
}
