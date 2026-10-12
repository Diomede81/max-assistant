import { Injectable } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { describeNow, spokenDuration, timeZone } from './clock';
import { TimerService, describe } from './timer.service';
import { KINDS, Kind, MemoryService } from '../memory/memory.service';
import { Mode, ModesService, VaultName, VAULTS } from '../memory/modes.service';
import { ProjectsService } from '../memory/projects.service';

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
    private readonly projects: ProjectsService,
  ) {
    // Project tasks falling due are announced like timer reminders.
    projects.on('reminder', (text: string) => timers.announce(text));
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
                project: { type: 'string', description: "Project name, to file it in that project's own memory (optional)" },
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
            tool(
              'project',
              'Projects: each has people, tasks and its own memory. create (name, vault, optional description and people), ' +
                'list, show (people, open tasks, project notes), update (status, description or rename), add_people, remove_person.',
              {
                action: { type: 'string', enum: ['create', 'list', 'show', 'update', 'add_people', 'remove_person'] },
                name: { type: 'string', description: 'Project name (for create, or to pick the project)' },
                vault: { type: 'string', enum: [...VAULTS], description: 'For create: work, personal or household' },
                description: { type: 'string', description: 'What the project is about (optional)' },
                people: { type: 'string', description: 'People, comma-separated, each optionally with role/contact in brackets: "Marco (supplier, marco@acme.com), Anna (designer)"' },
                person: { type: 'string', description: 'For remove_person: who' },
                status: { type: 'string', enum: ['active', 'on_hold', 'done'], description: 'For update (or to filter list)' },
                rename: { type: 'string', description: 'For update: new name' },
              },
              ['action'],
            ),
            tool(
              'task',
              'Project tasks with due dates. add (project, title, optional due/assignee/priority), complete, update, delete, ' +
                'list (when: today, week, overdue or all; optionally one project or one person).',
              {
                action: { type: 'string', enum: ['add', 'complete', 'update', 'delete', 'list'] },
                project: { type: 'string', description: 'Project name (optional when only one project is active, or when the task title is unique)' },
                task: { type: 'string', description: 'For add: the task. Otherwise: words from the task title' },
                due: { type: 'string', description: 'YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time (household time zone)' },
                assignee: { type: 'string', description: 'Who does it (optional)' },
                priority: { type: 'string', enum: ['high', 'normal', 'low'] },
                remind: { type: 'boolean', description: 'Say it out loud when due (default: yes when a time is given)' },
                when: { type: 'string', enum: ['today', 'week', 'overdue', 'all'], description: 'For list (default week)' },
                rename: { type: 'string', description: 'For update: new task title' },
                reopen: { type: 'boolean', description: 'For update: mark a finished task as open again' },
              },
              ['action'],
            ),
          ]
        : []),
    ];

    this.handlers = {
      ...(memory.enabled
        ? {
            remember: async (a: Record<string, unknown>) => {
              let project: { id: string; vault: VaultName } | undefined;
              if (str(a.project)) {
                const r = projects.find(str(a.project));
                if ('error' in r) return r.error;
                project = r.project;
              }
              return (
                await memory.remember({
                  text: str(a.fact) ?? '',
                  projectId: project?.id,
                  vault: project?.vault ?? (VAULTS.includes(a.vault as VaultName) ? (a.vault as VaultName) : 'personal'),
                  kind: KINDS.includes(a.kind as Kind) ? (a.kind as Kind) : undefined,
                  subject: str(a.subject),
                  date: str(a.date),
                  source: 'you',
                  unverified: a[EXTERNAL_FLAG] === true,
                })
              ).message;
            },
            project: (a: Record<string, unknown>) => this.projectAction(a),
            task: (a: Record<string, unknown>) => this.taskAction(a),
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

  private projectAction(a: Record<string, unknown>): string {
    const p = this.projects;
    const action = str(a.action) ?? '';
    if (action === 'create') {
      return p.create(str(a.name) ?? '', (VAULTS.includes(a.vault as VaultName) ? a.vault : 'personal') as VaultName, str(a.description), str(a.people));
    }
    if (action === 'list') return p.list(str(a.status));
    const found = p.find(str(a.name));
    if ('error' in found) return found.error;
    const project = found.project;
    switch (action) {
      case 'show':
        return p.show(project);
      case 'update':
        return p.update(project, { status: str(a.status), description: str(a.description), rename: str(a.rename) });
      case 'add_people':
        return p.addPeople(project, str(a.people) ?? str(a.person) ?? '');
      case 'remove_person':
        return p.removePerson(project, str(a.person) ?? str(a.people) ?? '');
      default:
        return `Unknown project action "${action}".`;
    }
  }

  private taskAction(a: Record<string, unknown>): string {
    const p = this.projects;
    const action = str(a.action) ?? '';
    let project;
    if (str(a.project) || action === 'add') {
      const found = p.find(str(a.project));
      if ('error' in found) return found.error;
      project = found.project;
    }
    if (action === 'add') {
      return p.addTask(project!, { title: str(a.task) ?? '', due: str(a.due), assignee: str(a.assignee), priority: str(a.priority), remind: typeof a.remind === 'boolean' ? a.remind : undefined });
    }
    if (action === 'list') return p.agenda(str(a.when) ?? 'week', str(a.assignee), project);
    const words = str(a.task);
    if (!words) return 'Which task?';
    const matches = p.findTask(words, project, action === 'update' && a.reopen === true);
    if (!matches.length) return `No open task matching "${words}"${project ? ` on ${project.name}` : ''}.`;
    if (matches.length > 1) return `Several tasks match: ${matches.map((m) => `${m.task.title} (${m.project.name})`).join('; ')}. Ask which one.`;
    const { project: proj, task } = matches[0];
    switch (action) {
      case 'complete':
        return p.completeTask(proj, task);
      case 'update':
        return p.updateTask(proj, task, { title: str(a.rename), due: typeof a.due === 'string' ? a.due : undefined, assignee: typeof a.assignee === 'string' ? a.assignee : undefined, priority: str(a.priority), reopen: a.reopen === true });
      case 'delete':
        return p.deleteTask(proj, task);
      default:
        return `Unknown task action "${action}".`;
    }
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
