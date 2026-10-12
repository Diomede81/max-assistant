import { Injectable } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { describeNow, spokenDuration, timeZone } from './clock';
import { TimerService, describe } from './timer.service';
import { KINDS, Kind, MemoryService } from '../memory/memory.service';
import { Mode, ModesService, VaultName, VAULTS } from '../memory/modes.service';

type Handler = (args: Record<string, unknown>) => string | Promise<string>;

/** Set by the action router when the same conversation already read emails or web pages. */
export const EXTERNAL_FLAG = '__afterExternalContent';

/**
 * Actions Max can do on his own, without Home Assistant: tell the date/time, manage
 * timers and reminders, and remember things between conversations. Offered to the AI model next to the Home Assistant tools.
 */
@Injectable()
export class BuiltinActionsService {
  private readonly handlers: Record<string, Handler>;
  readonly tools: ChatCompletionTool[];

  constructor(
    private readonly timers: TimerService,
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
  ) {
    this.tools = [
      tool('get_current_datetime', 'Get the current local date, day of the week and time.', {}),
      tool(
        'set_timer',
        'Start a countdown timer or a reminder. Give the duration as hours/minutes/seconds (any combination). ' +
          'Use "name" for a timer ("pasta"), or "reminder" for what to remind the user about ("call Mum"). ' +
          'Max announces it out loud when it finishes.',
        {
          hours: { type: 'number', description: 'Hours (optional)' },
          minutes: { type: 'number', description: 'Minutes (optional)' },
          seconds: { type: 'number', description: 'Seconds (optional)' },
          name: { type: 'string', description: 'Short timer name, e.g. "pasta" (optional)' },
          reminder: { type: 'string', description: 'What to remind the user about, e.g. "call Mum" (optional)' },
        },
      ),
      tool('list_timers', 'List running timers and reminders with the time left on each.', {}),
      tool(
        'cancel_timer',
        'Cancel a running timer or reminder by its name or reminder text, or all of them.',
        {
          name: { type: 'string', description: 'Name or reminder text of the timer to cancel (optional)' },
          all: { type: 'boolean', description: 'Cancel every timer and reminder (optional)' },
        },
      ),
      ...(memory.enabled
        ? [
            tool(
              'remember',
              'Save a lasting fact to long-term memory: people, preferences, routines, important dates, work projects. ' +
                'One short self-contained sentence with real names and dates, e.g. "Sofia\'s birthday is 14 March".',
              {
                fact: { type: 'string', description: 'The fact to remember' },
                vault: {
                  type: 'string',
                  enum: [...VAULTS],
                  description: 'work = job matters; household = shared home info (bins, appliances, house rules); personal = everything else',
                },
                kind: { type: 'string', enum: [...KINDS], description: 'What sort of fact it is (optional)' },
                subject: { type: 'string', description: 'Who or what it is about, e.g. "Sofia" or "Acme" (optional)' },
                date: { type: 'string', description: 'The date it is about: YYYY-MM-DD, or MM-DD for yearly dates like birthdays (optional)' },
              },
              ['fact', 'vault'],
            ),
            tool('forget', 'Remove a fact from long-term memory.', {
              about: { type: 'string', description: 'Words from the fact to forget, e.g. "boiler service"' },
              all: { type: 'boolean', description: 'Forget every matching fact (optional)' },
            }),
            tool('recall', 'Search long-term memory: all saved facts and notes from past conversations (open vaults only).', {
              query: { type: 'string', description: 'What to look for, e.g. "supplier delay" or "Sofia birthday"' },
            }),
            tool(
              'set_mode',
              'Switch memory mode. personal: work memory locked. work: everything open. guest: only household info, ' +
                'for when visitors are around. auto: follow the work-hours schedule again.',
              { mode: { type: 'string', enum: ['personal', 'work', 'guest', 'auto'] } },
              ['mode'],
            ),
          ]
        : []),
    ];

    this.handlers = {
      ...(memory.enabled
        ? {
            remember: async (a: Record<string, unknown>) =>
              (
                await memory.remember({
                  text: str(a.fact) ?? '',
                  vault: VAULTS.includes(a.vault as VaultName) ? (a.vault as VaultName) : 'personal',
                  kind: KINDS.includes(a.kind as Kind) ? (a.kind as Kind) : undefined,
                  subject: str(a.subject),
                  date: str(a.date),
                  source: 'you',
                  unverified: a[EXTERNAL_FLAG] === true,
                })
              ).message,
            forget: (a: Record<string, unknown>) => memory.forget(str(a.about) ?? '', a.all === true),
            recall: (a: Record<string, unknown>) => memory.recall(str(a.query) ?? ''),
            set_mode: (a: Record<string, unknown>) => {
              const m = String(a.mode ?? '');
              if (!['personal', 'work', 'guest', 'auto'].includes(m)) return 'Unknown mode.';
              return `Now in ${this.modes.set(m as Mode | 'auto')}.`;
            },
          }
        : {}),
      get_current_datetime: () => `It is ${describeNow()}.`,
      set_timer: (a) => {
        const total = num(a.hours) * 3600 + num(a.minutes) * 60 + num(a.seconds);
        const t = this.timers.start(total, str(a.name), str(a.reminder));
        const at = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit' }).format(t.endsAt);
        return `Started ${describe(t)} for ${spokenDuration(t.durationSeconds)}; it ends at ${at}.`;
      },
      list_timers: () => {
        const all = this.timers.list();
        if (!all.length) return 'There are no timers or reminders running.';
        return all.map((t) => `${describe(t)}: ${spokenDuration(this.timers.remainingSeconds(t))} left`).join('; ');
      },
      cancel_timer: (a) => {
        const running = this.timers.list();
        if (!running.length) return 'There are no timers or reminders to cancel.';
        const cancelled = this.timers.cancel(str(a.name), a.all === true);
        if (cancelled.length) return `Cancelled: ${cancelled.map(describe).join(', ')}.`;
        return `No single match. Running: ${running.map(describe).join(', ')}. Ask the user which one to cancel.`;
      },
    };
  }

  has(name: string): boolean {
    return name in this.handlers;
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      return await this.handlers[name](args);
    } catch (err) {
      return `Could not do that: ${(err as Error).message}.`;
    }
  }
}

function tool(name: string, description: string, properties: Record<string, unknown>, required?: string[]): ChatCompletionTool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, ...(required ? { required } : {}) } } };
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : 0) || 0;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
