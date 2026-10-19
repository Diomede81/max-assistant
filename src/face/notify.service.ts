import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { timeZone } from '../actions/clock';
import { TimerService } from '../actions/timer.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { ModesService } from '../memory/modes.service';
import { addDays, dueEpoch, localToday } from '../memory/projects.service';
import { SealedStore } from '../memory/sealed-store';
import { TodoItem, TodoService } from '../memory/todo.service';
import { Briefing, Routine, RoutinesService } from '../routines/routines.service';
import { AmbientService } from './ambient.service';
import { extractEmails, MailItem } from './emails';
import { FaceService } from './face.service';
import { Card, CardHandlers, CardLine } from './screen';
import { TodoTicks } from './todo-ticks';
import { LockService } from '../lock/lock.service';

const TICK_MS = 15_000;
const TODO_MS = 60_000;
const EMAIL_MS = 10 * 60_000;
const NOTE_MS = 15 * 60_000;
/** Emails that arrived more than this long ago aren't news any more. */
const EMAIL_FRESH_MS = 60 * 60_000;
const SEEN_KEEP = 300;

interface Pending {
  card: Card;
  handlers: CardHandlers;
}

interface Seen {
  emails: string[];
  /** To-do id -> the day it was last shown as overdue. */
  todos: Record<string, string>;
}

/**
 * Notifications on the round screen, shown when something needs you even though you didn't
 * ask: your news briefing is ready, an important email arrived, a to-do is overdue. They wait
 * politely: never while you're talking to Max, never over a card you're using (a recipe, a
 * timer), never during his sleep hours, and never in guest mode (visitors don't see your mail).
 * Each one can be switched off on the control panel (Settings → Screen).
 */
@Injectable()
export class NotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Notify');
  private readonly store: SealedStore<Seen>;
  private seen: Seen = { emails: [], todos: {} };
  private pending: Pending[] = [];
  private timers: NodeJS.Timeout[] = [];
  private emailPrimed = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly face: FaceService,
    private readonly ambient: AmbientService,
    @Optional() private readonly todos?: TodoService,
    @Optional() private readonly modes?: ModesService,
    @Optional() private readonly mcp?: McpServersService,
    @Optional() private readonly routines?: RoutinesService,
    @Optional() private readonly timerService?: TimerService,
    @Optional() private readonly lock?: LockService,
  ) {
    this.store = new SealedStore(cfg.memory.dir, 'notifications');
  }

  onModuleInit(): void {
    if (!this.cfg.face.enabled) return;
    try {
      this.seen = { ...this.seen, ...(this.store.load() ?? {}) };
    } catch {
      // start afresh
    }
    this.routines?.on('ready', (r: Routine, b: Briefing) => this.briefingReady(r, b));
    this.timers.push(setInterval(() => this.deliver(), TICK_MS));
    this.timers.push(setInterval(() => this.checkTodos(), TODO_MS));
    this.timers.push(setInterval(() => void this.checkEmail(), EMAIL_MS));
    setTimeout(() => void this.checkEmail(), 45_000);
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  private get settings() {
    return this.ambient.settings;
  }

  private get guest(): boolean {
    return this.modes?.mode === 'guest';
  }

  // ---------- Showing them, politely ----------

  /** Queue a notification (a newer one with the same id replaces the older). */
  notify(card: Card, handlers: CardHandlers = {}): void {
    this.pending = [...this.pending.filter((p) => p.card.id !== card.id), { card: { ttlMs: NOTE_MS, ...card }, handlers }];
    this.deliver();
  }

  /** Shows the next waiting notification if now is a good moment. */
  deliver(): void {
    if (this.lock?.locked) return; // kept until the start-up code is entered
    if (this.guest) {
      const shown = this.face.info().card?.id;
      if (shown?.startsWith('notify-')) this.face.dismissCard(shown); // switched to guest mode while one showed
      this.pending = []; // never shown to visitors
      return;
    }
    if (!this.pending.length) return;
    const info = this.face.info();
    if (info.state !== 'idle') return; // talking, asleep, or setting up the WiFi
    const c = info.card;
    if (c && c.id !== 'music' && !c.id.startsWith('notify-')) return; // you're using a card
    if (c?.id.startsWith('notify-')) return; // one at a time: the next when this one is gone
    const next = this.pending.shift()!;
    this.face.showCard(next.card, next.handlers);
  }

  // ---------- News briefing ready ----------

  private briefingReady(r: Routine, b: Briefing): void {
    if (!this.settings.notifyBriefing || !b.articles.length) return;
    if (!this.routines?.visible().some((x) => x.id === r.id)) return; // another mode's briefing
    const id = 'notify-news';
    this.notify(
      {
        id,
        kind: 'notice',
        icon: '📰',
        title: 'News',
        big: `Your ${r.name} is ready`,
        subtitle: `${b.articles.length} article${b.articles.length === 1 ? '' : 's'} · say "Hey Max, what's the news?"`,
        actions: [{ id: 'headlines', label: 'Headlines', style: 'primary' }, { id: 'ok', label: 'Later' }],
      },
      { headlines: () => this.routines?.showHeadlines(r, b, 5 * 60_000), ok: () => this.face.dismissCard(id) },
    );
  }

  // ---------- Overdue to-dos ----------

  /** Once a day per to-do: when its due date has passed (or, with a time, as soon as it passes). */
  checkTodos(now = Date.now()): void {
    if (!this.settings.notifyTodos || !this.todos || this.guest || this.lock?.locked) return;
    const today = localToday();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', hourCycle: 'h23' }).format(now));
    const overdue = this.todos.items().filter(({ task }) => {
      if (!task.due || this.seen.todos[task.id] === today) return false;
      if (task.due.includes('T')) return !task.remind && (dueEpoch(task.due) ?? Infinity) < now; // with a reminder, Max already says it
      return task.due.slice(0, 10) < today && hour >= 8; // date only: a morning nudge
    });
    if (!overdue.length) return;
    for (const { task } of overdue) this.seen.todos[task.id] = today;
    this.save();
    if (overdue.length === 1) return this.todoCard(overdue[0]);
    this.overdue = overdue.slice(0, 12);
    this.ticks?.reset();
    this.overdueCard(false);
  }

  /** Several overdue to-dos: one list, each with Done (ticked ones stay, struck through, with Undo). */
  private overdueCard(redraw: boolean): void {
    const today = localToday();
    this.ticks ??= new TodoTicks(this.todos!, () => this.overdueCard(true));
    const lines: CardLine[] = [
      ...this.overdue
        .filter(({ task }) => this.todos?.byId(task.id)?.task.status === 'open')
        .map((item) => this.ticks!.line(item, { text: item.task.title, sub: [`was due ${item.task.due!.slice(0, 10) === today ? item.task.due!.slice(11, 16) : item.task.due!.slice(0, 10)}`, item.project?.name ?? ''].filter(Boolean).join(' · '), tag: 'overdue' as const })),
      ...this.ticks.doneLines(),
    ];
    const left = lines.filter((l) => l.tag !== 'done').length;
    const card: Card = { id: 'notify-todos', kind: 'list', icon: '⏰', title: 'Overdue', subtitle: left ? `${left} to-do${left === 1 ? '' : 's'}` : 'All done 🎉', lines, actions: [{ id: 'ok', label: 'OK', style: 'primary' }], ttlMs: NOTE_MS };
    const handlers = { ...this.ticks.handlers(lines), ok: () => this.face.dismissCard('notify-todos') };
    if (redraw) this.face.showCard(card, handlers);
    else this.notify(card, handlers);
  }
  private overdue: TodoItem[] = [];
  private ticks?: TodoTicks;

  private todoCard(item: TodoItem): void {
    const id = 'notify-todo';
    const { task, project } = item;
    this.notify(
      {
        id,
        kind: 'alert',
        icon: '⏰',
        title: 'Overdue',
        big: task.title,
        subtitle: [project?.name ?? '', task.criticality === 'critical' ? 'critical' : ''].filter(Boolean).join(' · ') || undefined,
        actions: [{ id: 'done', label: 'Done', style: 'primary' }, { id: 'tomorrow', label: 'Tomorrow' }],
      },
      {
        done: () => {
          this.todos?.complete(item);
          this.face.dismissCard(id);
        },
        tomorrow: () => {
          this.todos?.update(item, { due: addDays(localToday(), 1) }, true);
          this.face.dismissCard(id);
        },
      },
    );
  }

  // ---------- Important email ----------

  /**
   * Asks the current mode's email app for unread important email, without the AI model: Gmail's
   * "important" marker, Outlook's high importance. New ones become a card; the first check after
   * a start only notes what's already there (except mail from the last few minutes).
   */
  async checkEmail(now = Date.now()): Promise<void> {
    if (!this.settings.notifyEmail || !this.mcp || this.guest || this.lock?.locked) return;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < 7 || hour >= 22) return;
    const pick = this.emailAction();
    if (!pick) return;
    let mails: MailItem[];
    try {
      mails = extractEmails(await this.mcp.serverFor(pick.name)!.call(pick.name, pick.args));
    } catch (err) {
      this.log.debug(`Email check failed (${pick.name}): ${(err as Error).message}`);
      return;
    }
    const known = new Set(this.seen.emails);
    const primed = this.emailPrimed;
    this.emailPrimed = true;
    const fresh = mails.filter((m) => !known.has(m.id) && (m.at ? now - m.at < (primed ? EMAIL_FRESH_MS : 10 * 60_000) : primed));
    if (mails.some((m) => !known.has(m.id))) {
      this.seen.emails = [...this.seen.emails, ...mails.map((m) => m.id).filter((i) => !known.has(i))].slice(-SEEN_KEEP);
      this.save();
    }
    if (!fresh.length) return;
    if (fresh.length === 1) return this.emailCard(fresh[0]);
    this.notify({
      id: 'notify-email',
      kind: 'list',
      icon: '✉️',
      title: 'Important email',
      subtitle: `${fresh.length} new`,
      lines: fresh.slice(0, 8).map((m) => ({ text: m.subject, sub: m.from || undefined, tag: 'important' as const })),
      actions: [{ id: 'ok', label: 'OK', style: 'primary' }],
    }, { ok: () => this.face.dismissCard('notify-email') });
  }

  private emailCard(m: MailItem): void {
    const id = 'notify-email';
    this.notify(
      { id, kind: 'notice', icon: '✉️', title: 'Important email', subtitle: m.from ? `From ${m.from}` : undefined, big: m.subject, actions: [{ id: 'read', label: 'Read it', style: 'primary' }, { id: 'ok', label: 'OK' }] },
      {
        // Read out as it is (not given to the AI): who, the subject and the first lines.
        read: () => {
          this.face.dismissCard(id);
          this.timerService?.announce(`Email${m.from ? ` from ${m.from}` : ''}: ${m.subject}.${m.snippet ? ` It says: ${m.snippet}` : ''}`);
        },
        ok: () => this.face.dismissCard(id),
      },
    );
  }

  /** The email app's "list messages" action with an unread-and-important search, if one is connected. */
  emailAction(): { name: string; args: Record<string, unknown> } | undefined {
    const tools = (this.mcp?.tools ?? []).filter((t): t is Extract<ChatCompletionTool, { type: 'function' }> => t.type === 'function');
    const candidates = tools.filter((t) => /^(GMAIL|OUTLOOK)_/i.test(t.function.name) && /(FETCH|LIST|GET)_?(EMAILS|MESSAGES|MAILS?)$/i.test(t.function.name) && !/(SEND|REPLY|DRAFT|DELETE|MOVE|FORWARD|ATTACHMENT|THREAD|LABEL)/i.test(t.function.name));
    for (const t of candidates) {
      const gmail = /^GMAIL_/i.test(t.function.name);
      const schema = (t.function.parameters ?? {}) as { properties?: Record<string, { type?: string }>; required?: string[] };
      const props = schema.properties ?? {};
      const args: Record<string, unknown> = {};
      let search = false;
      for (const key of Object.keys(props)) {
        const k = key.toLowerCase().replace(/[^a-z]/g, '');
        if (gmail && (k === 'query' || k === 'q')) {
          args[key] = 'is:unread is:important newer_than:1d';
          search = true;
        } else if (!gmail && k === 'filter') {
          args[key] = "isRead eq false and importance eq 'high'";
          search = true;
        } else if (/^(maxresults|top|limit|count)$/.test(k) && props[key].type !== 'string') args[key] = 10;
        else if (k === 'userid' && props[key].type === 'string') args[key] = 'me';
        else if (k === 'includepayload' && props[key].type === 'boolean') args[key] = false;
      }
      const missing = (schema.required ?? []).filter((r) => !(r in args));
      if (search && !missing.length) return { name: t.function.name, args };
    }
    return undefined;
  }

  private save(): void {
    this.store.save(this.seen).catch((err) => this.log.warn(`Could not save: ${(err as Error).message}`));
  }
}
