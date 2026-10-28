import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { ToolRouterService } from '../actions/tool-router.service';
import { TimerService } from '../actions/timer.service';
import { HealthService } from '../health/health.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { label, ModesService, VaultName, VAULTS } from '../memory/modes.service';
import { MemoryService } from '../memory/memory.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';
import { Assignment, ModelsService } from '../models/models.service';
import { sendPersonalEmail, selfEmailTool } from '../mcp/self-email';
import { daysText, local } from '../routines/routines.service';
import { dismissCard, showCard } from '../face/screen';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { said } from '../log-content';

/** How much work a task may take: steps (actions and thinking turns) and time. */
export const EFFORTS = {
  quick: { label: 'Quick', help: 'a look-up: about a minute', steps: 6, totalMs: 90_000 },
  normal: { label: 'Normal', help: 'a few steps: up to 4 minutes', steps: 14, totalMs: 4 * 60_000 },
  thorough: { label: 'Thorough', help: 'research and comparisons: up to 10 minutes', steps: 30, totalMs: 10 * 60_000 },
} as const;
export type Effort = keyof typeof EFFORTS;

/** A task Max does on his own at a set time: once, on chosen days, or on a day of the month. */
export interface Job {
  id: string;
  name: string;
  /** What to do, in the user's words. */
  brief: string;
  enabled: boolean;
  /** Whose it is: a work task is only spoken about in work mode. */
  vault: VaultName;
  /** Local time it runs, "HH:MM". */
  time: string;
  /** Days it runs, 1 = Monday … 7 = Sunday (when neither `once` nor `monthDay` is set). */
  days: number[];
  /** A one-off: the date (YYYY-MM-DD); it switches itself off after running. */
  once?: string;
  /** Monthly: the day of the month (1–31; past the month's end = its last day). */
  monthDay?: number;
  effort: Effort;
  /** Its own model (empty provider: the "Scheduled tasks" model from Settings → AI models). */
  provider: string;
  model: string;
  /** How the result reaches the user. */
  say: boolean;
  email: boolean;
  whatsapp: boolean;
  /** Other people to send the result to: email addresses, and WhatsApp numbers from the allowed list. Chosen on the control panel only. */
  emailTo: string[];
  whatsappTo: string[];
  lastRunDay?: string;
  lastError?: string;
  /** A retry is due at this time (epoch ms), after a run that failed or wasn't fully sent. */
  retryAt?: number;
  /** The latest results, newest first. */
  runs: JobRun[];
}

export interface JobRun {
  at: string;
  seconds: number;
  /** The task itself worked out (a result was found). */
  ok: boolean;
  /** ok: found and delivered; partial: found but not everything was sent; failed: no result. */
  status: 'ok' | 'partial' | 'failed';
  text: string;
  actions: number;
  sent: string[];
  failed: string[];
  /** What went wrong, in plain words, each with how to fix it. */
  problems: Problem[];
  /** 1 for the scheduled run, 2 and 3 for the retries. */
  attempt: number;
}

/** Something that went wrong in a run: what, how to fix it, and whether trying again may help. */
export interface Problem {
  what: string;
  fix: string;
  retry: boolean;
  /** Which delivery failed ('email', 'whatsapp', 'email:addr', 'wa:number'), for retrying just that. */
  channel?: string;
}

export interface JobInput {
  name?: string;
  brief?: string;
  enabled?: boolean;
  vault?: string;
  time?: string;
  days?: number[];
  once?: string;
  monthDay?: number;
  effort?: string;
  provider?: string;
  model?: string;
  say?: boolean;
  email?: boolean;
  whatsapp?: boolean;
  /** Comma-separated addresses (the control panel). */
  emailTo?: string;
  whatsappTo?: string[];
}

interface State {
  jobs: Job[];
}

const CHECK_MS = 60_000;
/** After a failure: try again after 10 minutes, then after 30 more; then give up until the next scheduled time. */
const RETRY_MS = [10 * 60_000, 30 * 60_000];
const RUNS_KEPT = 5;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const CARD_MS = 15 * 60_000;

/**
 * Scheduled tasks: anything Max can do with his actions (look things up on the web, check trains or
 * the calendar, read the news, compare prices…), done at a set time, once or regularly, with the
 * effort and the AI model you choose. The result is kept here, and spoken, emailed or sent by
 * WhatsApp to the user themselves. A task never sends to anyone else, deletes or books anything:
 * it finds out and reports. Missed runs (Max was off) happen as soon as he's back, the same day.
 * Encrypted on disk. Emits 'done' (job, run).
 */
@Injectable()
export class JobsService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Scheduled tasks');
  private state: State = { jobs: [] };
  private store?: SealedStore<State>;
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly router: ToolRouterService,
    private readonly timers: TimerService,
    private readonly modes: ModesService,
    private readonly models: ModelsService,
    @Optional() private readonly mcp?: McpServersService,
    @Optional() private readonly health?: HealthService,
    @Optional() private readonly whatsapp?: WhatsAppService,
    @Optional() memory?: MemoryService,
  ) {
    super();
    if (memory?.enabled) memory.sections.push(() => this.promptLine());
  }

  onModuleInit(): void {
    this.store = new SealedStore(this.cfg.memory.dir, 'jobs', memorySecret(this.cfg));
    try {
      const s = this.store.load();
      if (s) this.state = { jobs: (s.jobs ?? []).map((j) => ({ ...j, retryAt: undefined, runs: (j.runs ?? []).map((r) => ({ ...r, status: r.status ?? (r.ok ? (r.failed?.length ? 'partial' : 'ok') : 'failed'), problems: r.problems ?? [], attempt: r.attempt ?? 1 })), emailTo: j.emailTo ?? [], whatsappTo: j.whatsappTo ?? [] })) };
    } catch (err) {
      this.log.error(`Could not read the scheduled tasks (${(err as Error).message}); starting without them`);
    }
    this.router.jobs = this;
    this.timer = setInterval(() => this.tick(), CHECK_MS);
    setTimeout(() => this.tick(), 30_000);
    if (this.state.jobs.length) this.log.log(`${this.state.jobs.length} scheduled task(s): ${this.state.jobs.map((j) => `${j.name} (${scheduleText(j)})`).join(', ')}`);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  // ---------- Reading ----------

  get jobs(): Job[] {
    return this.state.jobs;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** Tasks Max may talk about right now (their vault is open in this mode). */
  visible(): Job[] {
    const open = this.modes.readable();
    return this.state.jobs.filter((j) => open.includes(j.vault));
  }

  get emailReady(): boolean {
    return Boolean(this.health?.emailTo && selfEmailTool(this.mcp));
  }

  get whatsappReady(): boolean {
    return Boolean(this.whatsapp?.canMessageSelf);
  }

  // ---------- Changing ----------

  /** Creates or updates a task from the control panel or by voice. Returns a message. */
  save(input: JobInput, id?: string): string {
    const existing = id ? this.state.jobs.find((j) => j.id === id) : undefined;
    if (id && !existing) return 'That scheduled task no longer exists.';
    const j: Job = existing ?? {
      id: randomUUID(),
      name: '',
      brief: '',
      enabled: true,
      vault: this.modes.mode === 'work' ? 'work' : 'personal',
      time: '07:00',
      days: ALL_DAYS,
      effort: 'normal',
      provider: '',
      model: '',
      say: true,
      email: false,
      whatsapp: false,
      emailTo: [],
      whatsappTo: [],
      runs: [],
    };
    if (input.brief !== undefined) j.brief = input.brief.replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!j.brief) return 'What should the task do? Say it in a sentence or two.';
    if (input.name !== undefined) j.name = input.name.trim().slice(0, 60);
    if (!j.name) j.name = j.brief.split(/[.!?\n]/)[0].slice(0, 40).trim() || 'Task';
    if (input.vault && VAULTS.includes(input.vault as VaultName)) j.vault = input.vault as VaultName;
    if (input.time !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return 'The time must be like 06:30.';
      if (input.time !== j.time) j.lastRunDay = undefined; // a new time today should still run today
      j.time = input.time;
    }
    if (input.once !== undefined || input.monthDay !== undefined || input.days !== undefined) {
      j.once = undefined;
      j.monthDay = undefined;
      if (input.once) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.once) || Number.isNaN(Date.parse(`${input.once}T00:00:00Z`))) return 'The date must be like 2026-11-03.';
        if (input.once < local().date) return 'That date has passed: pick a day from today on.';
        j.once = input.once;
        j.lastRunDay = undefined;
      } else if (input.monthDay) {
        const d = Math.round(input.monthDay);
        if (d < 1 || d > 31) return 'The day of the month must be 1 to 31.';
        j.monthDay = d;
      } else if (input.days) {
        j.days = [...new Set(input.days.filter((d) => d >= 1 && d <= 7))].sort();
        if (!j.days.length) return 'Pick at least one day.';
      }
    }
    if (input.effort !== undefined) {
      if (!(input.effort in EFFORTS)) return 'The effort must be quick, normal or thorough.';
      j.effort = input.effort as Effort;
    }
    if (input.provider !== undefined) {
      const provider = input.provider.trim();
      if (provider && provider !== 'default') {
        const p = this.models.providers().find((x) => x.id === provider);
        if (!p) return 'Unknown model provider.';
        if (!p.configured) return `${p.label} isn't set up: add ${p.setting} to .env and restart Max.`;
        if (!input.model?.trim()) return `Choose which model to use from ${p.label.replace(/ \(.*\)$/, '')}.`;
        j.provider = provider;
        j.model = input.model.trim().slice(0, 120);
      } else {
        j.provider = '';
        j.model = '';
      }
    }
    if (input.say !== undefined) j.say = input.say;
    if (input.email !== undefined) j.email = input.email;
    if (input.whatsapp !== undefined) j.whatsapp = input.whatsapp;
    if (input.emailTo !== undefined) {
      const list = [...new Set(input.emailTo.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
      const bad = list.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
      if (bad.length) return `These don't look like email addresses: ${bad.join(', ')}.`;
      j.emailTo = list.slice(0, 10);
    }
    if (input.whatsappTo !== undefined) {
      const people = this.whatsapp?.allowedPeople ?? [];
      const chosen = input.whatsappTo.filter((n) => people.some((a) => a.number === n));
      if (chosen.length < input.whatsappTo.length) return 'Only people on the WhatsApp allowed list (Connections → WhatsApp) can be chosen.';
      j.whatsappTo = [...new Set(chosen)];
    }
    if (input.enabled !== undefined) j.enabled = input.enabled;
    if (!existing) this.state.jobs.push(j);
    this.persist();
    this.log.log(`${existing ? 'Updated' : 'Created'} scheduled task "${j.name}" (${j.vault}, ${scheduleText(j)}, ${j.effort}, ${this.modelText(j)})`);
    return `${existing ? 'Saved' : 'Created'} ${j.name}: ${scheduleText(j)}, ${EFFORTS[j.effort].label.toLowerCase()} effort, result ${deliveryText(j)}.`;
  }

  remove(id: string): boolean {
    const before = this.state.jobs.length;
    this.state.jobs = this.state.jobs.filter((j) => j.id !== id);
    this.persist();
    return this.state.jobs.length < before;
  }

  modelText(j: Job): string {
    return this.models.describeAssignment(this.models.assignment('jobs', this.assignment(j)));
  }

  private assignment(j: Job): Assignment | undefined {
    return j.provider ? { provider: j.provider, model: j.model } : undefined;
  }

  // ---------- Running ----------

  private tick(): void {
    const now = local();
    for (const j of this.state.jobs) {
      if (j.retryAt && j.retryAt <= Date.now() && !this.running.has(j.id)) {
        j.retryAt = undefined;
        void this.retry(j);
        continue;
      }
      if (!j.enabled || this.running.has(j.id) || j.lastRunDay === now.date || now.time < j.time) continue;
      if (!runsOn(j, now.date, now.weekday)) continue;
      void this.run(j.id);
    }
  }

  /** Runs a task now and delivers the result. manual: someone asked. */
  async run(id: string, manual = false, attempt = 1): Promise<JobRun | undefined> {
    const j = this.state.jobs.find((x) => x.id === id);
    if (!j || this.running.has(id)) return undefined;
    j.retryAt = undefined;
    const agent = this.router.taskAgent;
    if (!agent) {
      j.lastError = 'The task runner is not available.';
      return undefined;
    }
    this.running.add(id);
    const started = Date.now();
    j.lastRunDay = local().date;
    if (j.once) j.enabled = false; // a one-off: done once
    this.persist();
    try {
      const effort = EFFORTS[j.effort] ?? EFFORTS.normal;
      const r = await agent.work(j.brief, { job: 'jobs', assignment: this.assignment(j), maxSteps: effort.steps, totalMs: effort.totalMs, written: true, label: `scheduled task "${j.name}"` });
      const run: JobRun = {
        at: new Date().toISOString(),
        seconds: Math.round((Date.now() - started) / 1000),
        ok: !r.error && !r.timedOut && Boolean(r.text),
        status: 'ok',
        text: r.error ? `The AI model failed: ${r.error}` : r.timedOut ? `${r.text || 'Nothing yet.'}\n\n(Stopped: it ran out of time.)` : r.text || 'Nothing found.',
        actions: r.actions,
        sent: [],
        failed: [],
        problems: [],
        attempt,
      };
      if (r.error) run.problems.push(diagnose('model', r.error));
      else if (r.timedOut) run.problems.push(diagnose('time', `${effort.label.toLowerCase()} effort, ${Math.round(effort.totalMs / 60000)} min`));
      else if (!r.text) run.problems.push(diagnose('empty', ''));
      for (const f of r.failedActions) run.problems.push(diagnose('action', f));
      await this.deliver(j, run, manual);
      this.finish(j, run, manual);
      return run;
    } catch (err) {
      j.lastError = (err as Error).message;
      this.log.error(`"${j.name}" failed: ${j.lastError}`);
      return undefined;
    } finally {
      this.running.delete(id);
      this.persist();
    }
  }

  /** Works out how the run went, records it, says so, and plans a retry when one may help. */
  private finish(j: Job, run: JobRun, manual: boolean, redelivery = false): void {
    run.status = !run.ok ? 'failed' : run.failed.length ? 'partial' : 'ok';
    // A result found: only a delivery that failed is worth retrying. No result: the task itself (not a single action).
    const retryable = run.problems.filter((p) => p.retry && (run.ok ? Boolean(p.channel) : !p.channel && !p.what.startsWith('The action ')));
    const canRetry = retryable.length > 0 && run.attempt <= RETRY_MS.length && !j.once;
    if (canRetry) j.retryAt = Date.now() + RETRY_MS[run.attempt - 1];
    j.lastError = run.status === 'ok' ? undefined : run.problems.map((p) => p.what).join('; ') || (run.ok ? 'Not everything was sent' : 'Nothing found');
    if (redelivery) j.runs = [run, ...j.runs.filter((r) => r.at !== run.at)].slice(0, RUNS_KEPT);
    else j.runs = [run, ...j.runs].slice(0, RUNS_KEPT);
    this.log[run.status === 'ok' ? 'log' : 'warn'](
      `"${j.name}" ${run.status === 'ok' ? 'done' : run.status === 'partial' ? 'done but not fully sent' : 'failed'} (attempt ${run.attempt}) in ${run.seconds}s, ${run.actions} action${run.actions === 1 ? '' : 's'}${run.sent.length ? `; sent by ${run.sent.join(', ')}` : ''}${run.problems.length ? `; problems: ${run.problems.map((p) => `${p.what} → ${p.fix}`).join(' | ')}` : ''}${j.retryAt ? `; retrying at ${new Date(j.retryAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
    );
    this.announce(j, run, manual);
    this.emit('done', j, run);
  }

  /** The planned retry: the whole task again when it failed; only the deliveries that failed when it worked out. */
  private async retry(j: Job): Promise<void> {
    const last = j.runs[0];
    if (!last || last.status === 'ok') return;
    if (last.status === 'failed') {
      this.log.log(`"${j.name}": trying again (attempt ${last.attempt + 1})`);
      await this.run(j.id, false, last.attempt + 1);
      return;
    }
    this.running.add(j.id);
    try {
      const run: JobRun = { ...last, attempt: last.attempt + 1, failed: [], problems: last.problems.filter((p) => !p.channel) };
      const channels = new Set(last.problems.filter((p) => p.channel).map((p) => p.channel!));
      this.log.log(`"${j.name}": sending again (attempt ${run.attempt}): ${[...channels].join(', ')}`);
      await this.deliver(j, run, false, channels);
      this.finish(j, run, false, true);
    } finally {
      this.running.delete(j.id);
      this.persist();
    }
  }

  private async deliver(j: Job, run: JobRun, manual: boolean, only?: Set<string>): Promise<void> {
    const title = `${j.name} · ${new Date(run.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    const want = (channel: string) => !only || only.has(channel);
    const attempt = async (channel: string, label: string, kind: 'email' | 'whatsapp', send: () => Promise<unknown>) => {
      if (!want(channel)) return;
      try {
        await send();
        run.sent.push(label);
        this.log.log(`"${j.name}": sent by ${label}`);
      } catch (err) {
        run.failed.push(`${label} (${(err as Error).message})`);
        run.problems.push({ ...diagnose(kind, (err as Error).message), channel });
        this.log.warn(`"${j.name}": not sent by ${label}: ${(err as Error).message}`);
      }
    };
    if (j.email) await attempt('email', 'email', 'email', () => sendPersonalEmail(this.mcp, this.health?.emailTo, `Max: ${title}`, run.text));
    if (j.whatsapp) {
      await attempt('whatsapp', 'WhatsApp', 'whatsapp', async () => {
        if (!this.whatsapp?.canMessageSelf) throw new Error('WhatsApp isn\'t linked');
        await this.whatsapp.sendToSelf(`${title}\n\n${run.text}`);
      });
    }
    // Other people, chosen (typed) on the control panel: never anyone the user didn't pick there, and only a real result.
    if (run.ok) {
      for (const to of j.emailTo) await attempt(`email:${to}`, `email to ${to}`, 'email', () => sendPersonalEmail(this.mcp, to, `${j.name} (from Max) · ${title.split(' · ')[1]}`, run.text));
      for (const number of j.whatsappTo) {
        const who = this.whatsapp?.allowedPeople.find((a) => a.number === number)?.name ?? number;
        await attempt(`wa:${number}`, `WhatsApp to ${who}`, 'whatsapp', async () => {
          if (!this.whatsapp) throw new Error('WhatsApp isn\'t set up');
          await this.whatsapp.sendToAllowed(number, `${j.name} (from Max)\n\n${run.text}`);
        });
      }
    }
  }

  /** Says how it went (only when its vault is open: a work task waits for work mode), and shows it on the screen. */
  private announce(j: Job, run: JobRun, manual: boolean): void {
    if (!(j.say || manual) || !this.modes.readable().includes(j.vault) || this.modes.mode === 'guest') return;
    const first = run.text.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2).join('. ').replace(/^- /, '').slice(0, 220);
    const others = run.sent.filter((x) => / to /.test(x)).map((x) => x.replace(/^email to |^WhatsApp to /, ''));
    const where = [run.sent.includes('email') ? 'your email' : '', run.sent.includes('WhatsApp') ? 'WhatsApp' : '', others.length ? `sent to ${others.join(', ')}` : ''].filter(Boolean);
    const retry = j.retryAt ? ` I'll try again at ${new Date(j.retryAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : '';
    const notSent = run.problems.filter((p) => p.channel);
    const text =
      run.status === 'failed'
        ? `Your task "${j.name}" didn't work out: ${run.problems[0]?.what ?? 'nothing found'}. ${run.problems[0]?.fix ?? ''}${retry} The details are on the control panel.`
        : `Your task "${j.name}" is done. ${first}${first.endsWith('.') ? '' : '.'}${where.length ? ` It's in ${where.join(' and ')}.` : ''}${
            notSent.length ? ` But I couldn't send it by ${notSent.map((p) => p.channel!.replace(/^email.*/, 'email').replace(/^wa.*|^whatsapp$/, 'WhatsApp')).filter((v, i, a) => a.indexOf(v) === i).join(' or ')}: ${notSent[0].what}. ${notSent[0].fix}${retry}` : ''
          } The full result is on the control panel.`;
    this.timers.announce(text);
    this.log.log(`Announced: ${said(text)}`);
    const id = `job-${j.id}`;
    showCard(
      {
        id,
        kind: 'notice',
        icon: run.status === 'ok' ? '🗓️' : '⚠️',
        title: j.name,
        subtitle: run.status === 'ok' ? `${run.seconds}s · ${run.actions} action${run.actions === 1 ? '' : 's'}` : run.status === 'partial' ? 'Done, but not everything was sent' : 'Did not work out',
        body: (run.problems.length ? `${run.problems.map((p) => `${p.what}: ${p.fix}`).join('\n')}\n\n` : '') + run.text.slice(0, 1500),
        actions: [{ id: 'ok', label: 'OK', style: 'primary' }],
        ttlMs: CARD_MS,
      },
      { ok: () => dismissCard(id) },
    );
  }

  // ---------- Voice ----------

  get tools(): ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'scheduled_task',
          description:
            'Tasks Max does on his own at a set time, once or regularly, with his actions (web, trains, calendar, news, memory, ' +
            'health…), and reports back (out loud and on the control panel; by email or WhatsApp to the user if asked). For ' +
            '"every morning at 7, check…", "on the 1st of each month, look up…", "on Friday, find me…". add needs task (what to ' +
            'do, in full), time, and when: days (e.g. [1,2,3,4,5] = weekdays; every day if left out), or date (once), or month_day. ' +
            'effort: quick (a look-up), normal, thorough (research). Results go to the user; sending them to other people is set on the control panel, not by voice. Not for to-dos or simple reminders (use todo / set_reminder). ' +
            'list shows them with their latest result; result reads one out; run does one now; delete removes it.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'list', 'result', 'run', 'delete'] },
              name: { type: 'string', description: 'A short name, e.g. "Flight prices". For result/run/delete: words from its name' },
              task: { type: 'string', description: 'For add: what to do, in full, with everything known (places, dates, preferences)' },
              time: { type: 'string', description: 'For add: HH:MM, household time zone' },
              days: { type: 'array', items: { type: 'integer' }, description: 'For add: days of the week, 1 = Monday … 7 = Sunday' },
              date: { type: 'string', description: 'For add: YYYY-MM-DD, to do it once on that day' },
              month_day: { type: 'integer', description: 'For add: day of the month, for a monthly task' },
              effort: { type: 'string', enum: ['quick', 'normal', 'thorough'] },
              email: { type: 'boolean', description: 'Also email the result to the user' },
              whatsapp: { type: 'boolean', description: 'Also WhatsApp the result to the user' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return name === 'scheduled_task';
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const action = str(a.action) ?? 'list';
    if (action === 'add') {
      const days = Array.isArray(a.days) ? a.days.map(Number).filter((n) => n >= 1 && n <= 7) : undefined;
      const msg = this.save({
        name: str(a.name),
        brief: str(a.task) ?? '',
        time: str(a.time),
        days: days?.length ? days : undefined,
        once: str(a.date),
        monthDay: typeof a.month_day === 'number' ? a.month_day : undefined,
        effort: str(a.effort),
        email: typeof a.email === 'boolean' ? a.email : undefined,
        whatsapp: typeof a.whatsapp === 'boolean' ? a.whatsapp : undefined,
      });
      if (!str(a.time)) return 'Not added yet: ask the user what time it should run, then call again with everything.';
      return msg + (msg.startsWith('Created') ? ' Tell the user briefly; the control panel (Routines → Scheduled tasks) has the details and the results.' : '');
    }
    const jobs = this.visible();
    if (action === 'list') {
      if (!jobs.length) return `No scheduled tasks yet.${this.lockedHint()}`;
      return jobs.map((j) => `- ${j.name}: ${scheduleText(j)}${j.enabled ? '' : ' (paused)'}; ${j.runs[0] ? `last run ${ago(j.runs[0].at)}: ${statusText(j.runs[0])}` : 'not run yet'}${j.runs[0]?.problems.length ? ` (${j.runs[0].problems.map((p) => `${p.what}; fix: ${p.fix}`).join(' / ')})` : ''}${j.retryAt ? `; retrying at ${new Date(j.retryAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`).join('\n') + this.lockedHint();
    }
    const words = (str(a.name) ?? '').toLowerCase();
    const found = words ? jobs.filter((j) => j.name.toLowerCase().includes(words) || words.includes(j.name.toLowerCase())) : jobs;
    if (!found.length) return `No scheduled task matching "${words}".`;
    if (found.length > 1 && action !== 'list') return `Several match: ${found.map((j) => j.name).join(', ')}. Ask which one.`;
    const j = found[0];
    switch (action) {
      case 'result':
        return j.runs[0]
          ? `${j.name}, ${ago(j.runs[0].at)}: ${statusText(j.runs[0])}.${j.runs[0].problems.length ? `\nProblems: ${j.runs[0].problems.map((p) => `${p.what}. Fix: ${p.fix}`).join(' ')}` : ''}\n${j.runs[0].text}\n(Tell the user the gist, and any problem with its fix; the whole text is on the control panel.)`
          : `${j.name} hasn't run yet (${scheduleText(j)}). Say "run it now" to do it now.`;
      case 'run':
        if (this.running.has(j.id)) return `${j.name} is running now.`;
        void this.run(j.id, true);
        return `Started ${j.name}: it takes ${EFFORTS[j.effort].help}. I'll say when it's done.`;
      case 'delete':
        this.remove(j.id);
        return `Deleted the scheduled task ${j.name}.`;
      default:
        return `Unknown action "${action}".`;
    }
  }

  /** For the start of a conversation: the tasks that ran today, so Max can mention them. */
  promptLine(): string {
    const today = local().date;
    const ran = this.visible().filter((j) => j.runs[0] && j.runs[0].at.slice(0, 10) === today);
    if (!ran.length) return '';
    return `Scheduled tasks done today (scheduled_task result reads one out): ${ran.map((j) => `${j.name}${j.runs[0].ok ? '' : ' (failed)'}`).join(', ')}.`;
  }

  private lockedHint(): string {
    const closed = VAULTS.filter((v) => !this.modes.readable().includes(v));
    const n = this.state.jobs.filter((j) => closed.includes(j.vault)).length;
    return n ? ` (${n} more in ${label(this.modes.mode).toLowerCase()} is locked.)` : '';
  }

  private persist(): void {
    this.store?.save(this.state).catch((err) => this.log.error(`Could not save the scheduled tasks: ${(err as Error).message}`));
  }
}

/** Does the task run on this date? */
export function runsOn(j: Job, date: string, weekday: number): boolean {
  if (j.once) return j.once === date;
  if (j.monthDay) {
    const [y, m, d] = date.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d === Math.min(j.monthDay, last);
  }
  return j.days.includes(weekday);
}

export function scheduleText(j: Job): string {
  if (j.once) return `once, ${new Date(`${j.once}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} at ${j.time}`;
  if (j.monthDay) return `the ${ordinal(j.monthDay)} of each month at ${j.time}`;
  return `${daysText(j.days)} at ${j.time}`;
}

export function deliveryText(j: Job): string {
  const ways = [j.say ? 'spoken' : '', j.email ? 'emailed' : '', j.whatsapp ? 'on WhatsApp' : '', j.emailTo.length ? `emailed to ${j.emailTo.join(', ')}` : '', j.whatsappTo.length ? `on WhatsApp to ${j.whatsappTo.length} ${j.whatsappTo.length === 1 ? 'person' : 'people'}` : ''].filter(Boolean);
  return ways.length ? ways.join(' and ') : 'kept on the control panel';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0];
  return `${n}${s}`;
}

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  if (min < 36 * 60) return `${Math.round(min / 60)} hours ago`;
  return `${Math.round(min / 1440)} days ago`;
}

/** "done", "done, but not sent by email", "failed". */
export function statusText(r: JobRun): string {
  if (r.status === 'ok') return `done${r.sent.length ? ` and sent by ${r.sent.join(', ')}` : ''}`;
  if (r.status === 'partial') return `done, but not sent by ${r.failed.map((f) => f.replace(/ \(.*$/, '')).join(', ')}`;
  return 'failed';
}

/**
 * A problem in plain words, with how to fix it and whether a retry may help: the AI model, running out
 * of time, an empty answer, a failed action, or email/WhatsApp not sending.
 */
export function diagnose(kind: 'model' | 'time' | 'empty' | 'action' | 'email' | 'whatsapp', message: string): Problem {
  const m = message.toLowerCase();
  if (kind === 'model') {
    if (/401|403|invalid api key|incorrect api key|unauthori[sz]ed|authentication/.test(m)) return { what: `The AI model refused the key (${message.slice(0, 80)})`, fix: 'Check the provider\'s key in .env (Settings → AI models shows which are set up) and restart Max.', retry: false };
    if (/429|rate limit|quota|insufficient|balance|credit/.test(m)) return { what: `The AI provider is out of credit or rate-limited (${message.slice(0, 80)})`, fix: 'Top up or wait; or pick another model for this task.', retry: true };
    if (/404|not found|does not exist|unknown model|no such model/.test(m)) return { what: `The model name isn't known to the provider (${message.slice(0, 80)})`, fix: 'Pick the model from the list in the task\'s settings.', retry: false };
    if (/used all its room|tokens/.test(m)) return { what: 'The AI model ran out of room before answering', fix: 'Pick a non-thinking model for this task, or ask for less.', retry: false };
    if (/timeout|timed out|econnreset|network|fetch failed|enotfound|503|502|overloaded/.test(m)) return { what: `The AI provider didn't answer (${message.slice(0, 80)})`, fix: 'Usually temporary: it is retried. If it keeps happening, pick another model.', retry: true };
    return { what: `The AI model failed (${message.slice(0, 120)})`, fix: 'Press Test next to the model under Settings → AI models; if it fails there too, pick another model.', retry: true };
  }
  if (kind === 'time') return { what: `It ran out of time (${message})`, fix: 'Give the task more effort (Thorough), or ask for less in one task.', retry: false };
  if (kind === 'empty') return { what: 'The AI model gave back nothing', fix: 'Try another model for this task, or reword what to do.', retry: true };
  if (kind === 'action') {
    const name = message.split(':')[0];
    if (/took too long|timed out|timeout/.test(m)) return { what: `The action ${name} took too long`, fix: 'Usually temporary. If it keeps happening, the service behind it is slow or down.', retry: true };
    if (/not (set up|connected|linked)|needs .* key|add .* to \.env/.test(m)) return { what: `The action ${name} isn't set up (${message.slice(name.length + 1, name.length + 100).trim()})`, fix: 'Set it up under Connections, or reword the task so it doesn\'t need it.', retry: false };
    return { what: `The action ${name} failed (${message.slice(name.length + 1, name.length + 100).trim()})`, fix: 'The result may be incomplete: check it. If it keeps happening, check that service under Connections.', retry: false };
  }
  if (kind === 'email') {
    if (/no email address/.test(m)) return { what: 'No email address is set', fix: 'Add your address under Health → Plans → Send plans to.', retry: false };
    if (/no email account/.test(m)) return { what: 'No email account is connected', fix: 'Connect Gmail or Outlook under Connections → Apps.', retry: false };
    if (/doesn't look like/.test(m)) return { what: message, fix: 'Correct the address in the task\'s settings.', retry: false };
    if (/unauthori[sz]ed|expired|invalid.*(token|grant)|scope|permission|re-?connect|401|403/.test(m)) return { what: `The email account needs signing in again (${message.slice(0, 100)})`, fix: 'Press Reconnect next to Gmail or Outlook under Connections → Apps.', retry: false };
    if (/quota|limit|429/.test(m)) return { what: `The email service is limiting sending (${message.slice(0, 100)})`, fix: 'Wait a while; it is retried.', retry: true };
    return { what: `Email didn't go (${message.slice(0, 140)})`, fix: 'It is retried. If it keeps happening, press Reconnect next to Gmail or Outlook under Connections → Apps.', retry: true };
  }
  if (/isn't linked|isn't set up|not linked/.test(m)) return { what: 'WhatsApp isn\'t linked', fix: 'Link a phone under Connections → WhatsApp.', retry: false };
  if (/allowed list/.test(m)) return { what: message, fix: 'Add them again under Connections → WhatsApp, or remove them from the task.', retry: false };
  return { what: `WhatsApp didn't send (${message.slice(0, 140)})`, fix: 'It is retried. If WhatsApp shows "not linked" under Connections → WhatsApp, link the phone again.', retry: true };
}
