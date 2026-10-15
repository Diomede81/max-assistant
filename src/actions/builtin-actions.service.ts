import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { describeNow, parseLocal, spokenDuration, spokenWhen } from './clock';
import { TimerService, describe } from './timer.service';
import { ConversationControl } from './conversation-control';
import { KINDS, Kind, MemoryService } from '../memory/memory.service';
import { Mode, ModesService, VaultName, VAULTS } from '../memory/modes.service';
import { ProjectsService } from '../memory/projects.service';
import { TodoItem, TodoService } from '../memory/todo.service';
import { TodoTicks } from '../face/todo-ticks';
import { RoutinesService } from '../routines/routines.service';
import { APP_CONFIG, AppConfig } from '../config';
import { requestPower } from '../face/power';
import { DeviceService, STEP } from '../device/device.service';
import { CardLine, showCard } from '../face/screen';
import { dueText, localToday } from '../memory/projects.service';
import { timeZone } from './clock';

type Handler = (args: Record<string, unknown>) => string | Promise<string>;

/** Set by the action router when the same conversation already read emails or web pages. */
export const EXTERNAL_FLAG = '__afterExternalContent';

/**
 * Actions Max can do on his own, without Home Assistant: tell the date/time, manage
 * timers and reminders, and remember things between conversations. Offered to the AI model next to the Home Assistant tools.
 */
@Injectable()
export class BuiltinActionsService implements OnModuleInit {
  @Optional() @Inject(ConversationControl) private readonly control?: ConversationControl;
  @Inject(APP_CONFIG) private readonly cfg!: AppConfig;
  @Optional() @Inject(DeviceService) private readonly device?: DeviceService;
  /** News briefings and other scheduled routines (optional). */
  @Optional() @Inject(RoutinesService) private readonly routines?: RoutinesService;
  private readonly handlers: Record<string, Handler>;
  readonly tools: ChatCompletionTool[];

  constructor(
    private readonly timers: TimerService,
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
    private readonly projects: ProjectsService,
    private readonly todos: TodoService,
  ) {
    // Project tasks falling due are announced like timer reminders.
    projects.on('reminder', (text: string) => timers.announce(text));
    this.tools = [
      tool('get_current_datetime', 'Get the current local date, day of the week and time.', {}),
      tool(
        'end_conversation',
        'Go quiet and stop listening until the wake word. Call it, and say nothing else, when the user tells you to ' +
          'stop or that they are done ("stop", "that\'s all", "never mind"), or when what you just heard was clearly NOT ' +
          'said to you: people talking to each other, a phone call, the TV. If unsure whether it was meant for you, answer normally.',
        {},
      ),
      tool(
        'set_timer',
        'Start a countdown TIMER, e.g. "set a timer for 10 minutes", "pasta timer for 8 minutes". Only for countdowns: ' +
          'when the user says "remind me" or "reminder", use set_reminder instead. Max announces it when it finishes.',
        {
          hours: { type: 'number', description: 'Hours (optional)' },
          minutes: { type: 'number', description: 'Minutes (optional)' },
          seconds: { type: 'number', description: 'Seconds (optional)' },
          name: { type: 'string', description: 'Short timer name, e.g. "pasta" (optional)' },
        },
      ),
      tool(
        'set_reminder',
        'Set a REMINDER: whenever the user says "remind me" or asks for a reminder. A reminder needs two things: WHAT it is ' +
          'for and WHEN. If the user hasn\'t said what it is for, ask ("What should I remind you about?"); if they haven\'t ' +
          'said when, ask ("When would you like the reminder?"). Only call this once you know both. Then confirm both ' +
          'back briefly. Reminders are saved, survive restarts and can be up to a year ahead.',
        {
          about: { type: 'string', description: 'What to remind the user about, in their words, e.g. "call Mum"' },
          at: { type: 'string', description: 'Local date and time, YYYY-MM-DDTHH:MM (use this OR a delay)' },
          days: { type: 'number', description: 'Delay in days (optional)' },
          hours: { type: 'number', description: 'Delay in hours (optional)' },
          minutes: { type: 'number', description: 'Delay in minutes (optional)' },
        },
      ),
      tool('list_timers', 'List the running timers and the upcoming reminders.', {}),
      tool(
        'device_settings',
        "Your own speaker volume (your voice and everything you play) and your screen's brightness. For \"louder\", " +
          '"quieter", "volume to 30%", "turn the screen down", "brighter". While music is playing and the user means the ' +
          'music only, use music_control instead. Steps are 10%.',
        {
          action: { type: 'string', enum: ['volume_up', 'volume_down', 'set_volume', 'brightness_up', 'brightness_down', 'set_brightness', 'status'] },
          level: { type: 'number', description: '0-100, for set_volume or set_brightness' },
        },
        ['action'],
      ),
      tool(
        'device_power',
        'Turn this device (the Max box) off, or restart it. ONLY when the user clearly asks to turn you off, shut down, ' +
          'power off or restart the device. Ask "Are you sure?" first and call with confirmed=true only after they say yes. ' +
          'Not for "stop" or "go to sleep" (that is end_conversation), and not for other devices (lights, TV: Home Assistant).',
        {
          action: { type: 'string', enum: ['off', 'restart'] },
          confirmed: { type: 'boolean', description: 'True only after the user confirmed' },
        },
        ['action'],
      ),
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
              'Switch mode. personal: personal + household memory, work locked. work: work + household memory, personal locked. guest: only household info, ' +
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
              'todo',
              "The user's to-do list (also every project's tasks). Each item has a PRIORITY (high, medium, low: how soon it " +
                'should be done) and a CRITICALITY (critical, important, routine: what is at stake if it slips), and can belong ' +
                'to a project. add: needs the item, its priority and its criticality; if the user did not say them, ask once, ' +
                'in one short question, before adding ("How soon, and how critical is it?"). Optional: due date, project, who ' +
                'does it. complete, update (change priority, criticality, due date; move it to a project with move_to, or ' +
                'move_to "none"), delete, list (when: today, week, overdue, critical or all; optionally one project).',
              {
                action: { type: 'string', enum: ['add', 'complete', 'update', 'delete', 'list'] },
                item: { type: 'string', description: 'For add: the to-do, e.g. "renew the car insurance". Otherwise: words from it' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How soon it should be done' },
                criticality: { type: 'string', enum: ['critical', 'important', 'routine'], description: 'What is at stake if it slips' },
                due: { type: 'string', description: 'YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time (household time zone) (optional)' },
                project: { type: 'string', description: 'For add: the project it belongs to (optional). For other actions: only look in this project' },
                move_to: { type: 'string', description: 'For update: the project to move it to, or "none" to take it out of its project' },
                list: { type: 'string', enum: ['personal', 'work', 'household'], description: 'For add without a project: which list (default: the current mode\'s own; household = shared)' },
                assignee: { type: 'string', description: 'Who does it (optional)' },
                remind: { type: 'boolean', description: 'Say it out loud when due (default: yes when a time is given)' },
                when: { type: 'string', enum: ['today', 'week', 'overdue', 'critical', 'all'], description: 'For list (default all)' },
                rename: { type: 'string', description: 'For update: new wording' },
                reopen: { type: 'boolean', description: 'For update: mark a finished to-do as open again' },
              },
              ['action'],
            ),
            tool(
              'my_day',
              'Brief the user on their day: call it when they ask "what\'s going on today", "what\'s my day like", "brief me", ' +
                '"what have I got on". Returns today\'s reminders and to-dos (overdue, due today, critical). In the SAME step, ' +
                'also fetch today\'s calendar events with the connected calendar app, if you have one: use the CALENDAR VIEW ' +
                'action for a date range (e.g. Outlook\'s calendar view, not "list events": only the view includes each ' +
                'occurrence of recurring meetings), from today 00:00 to 23:59 in the household time zone, and read every ' +
                'event it returns. Then brief in this ' +
                'order: events in time order; what is overdue (say clearly it should already have been done) and what is ' +
                'critical; the rest of today\'s to-dos. Keep it short and natural; offer details rather than reading everything.',
              {},
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
            todo: (a: Record<string, unknown>) => this.todoAction(a),
            // Older name, in case a saved conversation still uses it.
            task: (a: Record<string, unknown>) => this.todoAction({ ...a, item: a.item ?? a.task }),
            my_day: () => this.myDay(),
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
      device_settings: async (a) => {
        const d = this.device;
        if (!d) return 'Not available.';
        const pct = (v: number | string, what: string) => (typeof v === 'string' ? `Not changed: ${v}.` : `${what} is now ${v}%.`);
        switch (String(a.action)) {
          case 'volume_up':
            return pct(await d.changeVolume(STEP), 'Volume');
          case 'volume_down':
            return pct(await d.changeVolume(-STEP), 'Volume');
          case 'set_volume':
            return typeof a.level === 'number' ? pct(await d.setVolume(a.level), 'Volume') : 'Which volume, 0 to 100?';
          case 'brightness_up':
            return pct(d.changeBrightness(STEP), 'Screen brightness');
          case 'brightness_down':
            return pct(d.changeBrightness(-STEP), 'Screen brightness');
          case 'set_brightness':
            return typeof a.level === 'number' ? pct(d.setBrightness(a.level), 'Screen brightness') : 'Which brightness, 5 to 100?';
          default: {
            const s = await d.status();
            return `Volume ${s.volume ?? 'unknown'}%, screen brightness ${s.brightness}%.`;
          }
        }
      },
      device_power: (a) => {
        const off = a.action !== 'restart';
        if (this.modes.mode === 'guest') return 'Not done: in guest mode the box can only be turned off by the household (the screen menu, or the power button).';
        if (a.confirmed !== true) return `Not done yet: ask the user to confirm ("Shall I ${off ? 'turn off' : 'restart'}?"), then call again with confirmed=true.`;
        if (!this.cfg.face.onBox) return 'Turning off and restarting only work on the Max box, not on this computer.';
        // A few seconds to say goodbye before the box goes down.
        setTimeout(() => requestPower(this.cfg, off ? 'poweroff' : 'reboot'), 6000);
        return off
          ? 'Turning off in a few seconds. Say a very short goodbye, and that pressing the power button on the Pi turns you on again.'
          : 'Restarting in a few seconds. Say you will be back in about a minute.';
      },
      end_conversation: () => {
        this.control?.requestEnd();
        return 'Conversation ended. Say nothing.';
      },
      set_timer: (a) => {
        const total = num(a.hours) * 3600 + num(a.minutes) * 60 + num(a.seconds);
        if (total <= 0) return 'No duration given: ask the user how long the timer should be.';
        const t = this.timers.start(total, str(a.name));
        return `Started ${describe(t)} for ${spokenDuration(t.durationSeconds)}; it ends ${spokenWhen(t.endsAt)}.`;
      },
      set_reminder: (a) => {
        const about = str(a.about);
        const when = str(a.at);
        const delay = num(a.days) * 86400 + num(a.hours) * 3600 + num(a.minutes) * 60;
        // Models sometimes skip the question: refuse until both parts are known, and say what to ask.
        if (!about && !when && delay <= 0) return 'Not set yet: ask the user what the reminder is for and when they want it.';
        if (!about) return 'Not set yet: ask the user what the reminder is for ("What should I remind you about?"), then call again with "about".';
        if (!when && delay <= 0) return `Not set yet: ask the user when they want to be reminded to ${about}, then call again.`;
        let at: number | undefined;
        if (when) {
          at = parseLocal(when);
          if (at === undefined) return 'That date and time could not be understood; use YYYY-MM-DDTHH:MM.';
        }
        const t = this.timers.start(delay, undefined, about, at);
        return `Reminder set: "${t.reminder}" ${spokenWhen(t.endsAt)}. Confirm both to the user.`;
      },
      list_timers: () => {
        const all = this.timers.list();
        const timers = all.filter((t) => !t.reminder);
        const reminders = all.filter((t) => t.reminder);
        if (!all.length) return 'There are no timers or reminders.';
        return [
          timers.length ? `Timers: ${timers.map((t) => `${describe(t)}, ${spokenDuration(this.timers.remainingSeconds(t))} left`).join('; ')}.` : 'No timers.',
          reminders.length ? `Reminders: ${reminders.map((t) => `"${t.reminder}" ${spokenWhen(t.endsAt)}`).join('; ')}.` : 'No reminders.',
        ].join(' ');
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

  private todoAction(a: Record<string, unknown>): string {
    const action = str(a.action) ?? '';
    const t = this.todos;
    if (action === 'add') {
      return t.add({
        title: str(a.item) ?? '',
        priority: str(a.priority),
        criticality: str(a.criticality),
        due: str(a.due),
        project: str(a.project),
        vault: str(a.list),
        assignee: str(a.assignee),
        remind: typeof a.remind === 'boolean' ? a.remind : undefined,
      });
    }
    let project;
    if (str(a.project)) {
      const found = this.projects.find(str(a.project));
      if ('error' in found) return found.error;
      project = found.project;
    }
    if (action === 'list') return t.list(str(a.when) ?? 'all', project, str(a.assignee));
    const words = str(a.item);
    if (!words) return 'Which to-do?';
    const matches = t.find(words, project, action === 'update' && a.reopen === true);
    if (!matches.length) return `No open to-do matching "${words}"${project ? ` on ${project.name}` : ''}.`;
    if (matches.length > 1) return `Several to-dos match: ${matches.map((m) => `${m.task.title}${m.project ? ` (${m.project.name})` : ''}`).join('; ')}. Ask which one.`;
    const item = matches[0];
    switch (action) {
      case 'complete':
        return t.complete(item);
      case 'update':
        return t.update(item, {
          title: str(a.rename),
          due: typeof a.due === 'string' ? a.due : undefined,
          assignee: typeof a.assignee === 'string' ? a.assignee : undefined,
          priority: str(a.priority),
          criticality: str(a.criticality),
          reopen: a.reopen === true,
          moveTo: str(a.move_to),
        });
      case 'delete':
        return t.delete(item);
      default:
        return `Unknown to-do action "${action}".`;
    }
  }

  /** "What's my day": today's date, reminders still to come, and the to-do briefing. Calendar events come from the calendar app. */
  private myDay(): string {
    const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date(ms));
    const today = day(Date.now());
    const reminders = this.timers
      .list()
      .filter((x) => x.reminder && day(x.endsAt) === today)
      .sort((x, y) => x.endsAt - y.endsAt)
      .map((x) => `- "${x.reminder}" ${spokenWhen(x.endsAt)}`);
    this.dayCard();
    return [
      `Today is ${describeNow()}.`,
      reminders.length ? `Reminders still to come today:\n${reminders.join('\n')}` : 'No more reminders today.',
      `To-dos:\n${this.todos.dayBriefing()}`,
      this.routines?.pendingLine() ?? '',
      "Calendar: not included here. Get today's events from the calendar app if one is connected; if none is, don't mention the calendar.",
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * "Your day" on the screen: reminders and to-dos now; calendar events join it when Max reads the
   * calendar. Tapping the face shows it too, with the events and weather the screen already knows.
   */
  dayCard(extra: { events?: CardLine[]; weather?: string } = {}, redraw = false): void {
    // Done buttons on the to-dos: ticking one redraws the card (kept struck through, with Undo).
    if (!redraw) this.dayTicks.reset();
    this.dayExtra = extra;
    const tz = timeZone();
    const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
    const hm = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    const today = localToday();
    const lines: CardLine[] = this.timers
      .list()
      .filter((x) => x.reminder && day(x.endsAt) === today)
      .sort((x, y) => x.endsAt - y.endsAt)
      .map((x) => ({ time: hm(x.endsAt), text: x.reminder!.charAt(0).toUpperCase() + x.reminder!.slice(1), tag: 'reminder' as const }));
    lines.unshift(...(extra.events ?? []));
    for (const { task, project } of this.todos.items()) {
      const d = task.due?.slice(0, 10);
      const overdue = !!d && d < today;
      if (!overdue && d !== today && task.criticality !== 'critical') continue;
      lines.push(this.dayTicks.line({ task, project } as TodoItem, {
        time: overdue ? 'late' : d === today ? (task.due!.includes('T') ? task.due!.slice(11, 16) : 'today') : 'todo',
        text: task.title,
        sub: [overdue ? `was due ${dueText(task.due!)}` : '', project?.name ?? ''].filter(Boolean).join(' · ') || undefined,
        tag: overdue ? 'overdue' : task.criticality === 'critical' ? 'critical' : task.criticality === 'important' ? 'important' : undefined,
      }));
    }
    lines.push(...this.dayTicks.doneLines());
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const shown = lines.length ? lines : [{ text: 'Nothing due today', sub: 'Calendar events appear here as Max reads them' }];
    showCard({
      id: 'my-day',
      kind: 'list',
      icon: '☀',
      title: 'Your day',
      subtitle: extra.weather ? `${date} · ${extra.weather}` : date,
      lines: shown,
      ttlMs: 60_000,
    }, this.dayTicks.handlers(shown));
  }
  private dayExtra: { events?: CardLine[]; weather?: string } = {};
  /** What "Your day" was last drawn with (calendar events, weather). */
  get dayInfo(): { events?: CardLine[]; weather?: string } {
    return this.dayExtra;
  }
  private ticks?: TodoTicks;
  private get dayTicks(): TodoTicks {
    return (this.ticks ??= new TodoTicks(this.todos, () => this.dayCard(this.dayExtra, true)));
  }

  onModuleInit(): void {
    // A briefing someone asked for ("get me fresh news") is announced when it's ready.
    this.routines?.on('ready', (r: { name: string }, b: { articles: unknown[] }, manual: boolean) => {
      if (manual) this.timers.announce(b.articles.length ? `Your ${r.name} is ready, with ${b.articles.length} articles. Ask me "what's the news?"` : `I couldn't find anything new for your ${r.name}.`);
    });
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
