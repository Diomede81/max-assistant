import { Injectable } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { describeNow, spokenDuration, timeZone } from './clock';
import { TimerService, describe } from './timer.service';

type Handler = (args: Record<string, unknown>) => string;

/**
 * Actions Max can do on his own, without Home Assistant: tell the date/time and manage
 * timers and reminders. Offered to the AI model next to the Home Assistant tools.
 */
@Injectable()
export class BuiltinActionsService {
  private readonly handlers: Record<string, Handler>;
  readonly tools: ChatCompletionTool[];

  constructor(private readonly timers: TimerService) {
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
    ];

    this.handlers = {
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

  call(name: string, args: Record<string, unknown>): string {
    try {
      return this.handlers[name](args);
    } catch (err) {
      return `Could not do that: ${(err as Error).message}.`;
    }
  }
}

function tool(name: string, description: string, properties: Record<string, unknown>): ChatCompletionTool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties } } };
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : 0) || 0;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
