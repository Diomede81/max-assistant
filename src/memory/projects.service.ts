import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { timeZone } from '../actions/clock';
import { MemoryService, normalise, Project, ProjectPerson, Task } from './memory.service';
import { label, ModesService, VaultName, VAULTS } from './modes.service';

const SCAN_MS = 30_000;
const STALE_REMINDER_MS = 12 * 3600_000;

export type FindResult = { project: Project } | { error: string };

/**
 * Projects: a named piece of work or life ("Milan launch", "Kitchen renovation", "Sofia's
 * party") with its people, its tasks (due dates, assignee, priority, spoken reminders) and
 * its own memory (facts and conversation notes tagged to it).
 *
 * A project lives in one vault, so it follows the same rules as the rest of memory: a Work
 * project is encrypted with the Work vault and locked outside work mode, including its
 * reminders (they wait until work mode). Emits 'reminder' (text) when a task falls due.
 */
@Injectable()
export class ProjectsService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Projects');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
  ) {
    super();
    if (memory.enabled) memory.sections.push((open) => this.promptSection(open));
  }

  onModuleInit(): void {
    if (!this.memory.enabled) return;
    this.timer = setInterval(() => this.scanReminders(), SCAN_MS);
    setTimeout(() => this.scanReminders(), 5_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  // ---------- Finding ----------

  /** Projects Max may use right now (open vaults). */
  visible(): Project[] {
    return this.memory.projectsIn(this.modes.readable());
  }

  find(name: string | undefined, pool = this.visible()): FindResult {
    const q = normalise(name ?? '');
    if (!q) {
      const active = pool.filter((p) => p.status === 'active');
      return active.length === 1 ? { project: active[0] } : { error: `Which project? Active ones: ${names(active) || 'none yet'}.` };
    }
    const exact = pool.filter((p) => normalise(p.name) === q);
    if (exact.length === 1) return { project: exact[0] };
    const words = q.split(' ').filter((w) => w.length > 1 && w !== 'project');
    const scored = pool
      .map((p) => {
        const n = normalise(p.name);
        const hits = words.filter((w) => n.split(' ').includes(w)).length;
        return { p, score: n.includes(q) || q.includes(n) ? 1 : hits / Math.max(1, words.length) };
      })
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) {
      const closed = VAULTS.filter((v) => !this.modes.readable().includes(v));
      // Guests aren't told that a private project exists at all.
      const locked = this.modes.mode === 'guest' ? undefined : this.memory.projectsIn(closed).find((p) => normalise(p.name).includes(q));
      const switchTo = locked?.vault === 'work' ? 'work mode' : 'personal mode';
      return { error: locked ? `That's a ${locked.vault} project, and ${switchTo} is off. Say "${switchTo}" to open it.` : `No project called "${name}". Projects: ${names(pool) || 'none yet'}.` };
    }
    if (scored.length > 1 && scored[1].score === scored[0].score) {
      return { error: `Several projects match: ${scored.filter((x) => x.score === scored[0].score).map((x) => x.p.name).join(', ')}. Ask which one.` };
    }
    return { project: scored[0].p };
  }

  // ---------- Projects ----------

  /** Any project by id, whatever the mode (control panel). */
  byId(id: string): Project | undefined {
    return this.memory.projectsIn(VAULTS).find((p) => p.id === id);
  }

  all(): Project[] {
    return this.memory.projectsIn(VAULTS);
  }

  create(name: string, vault: VaultName, description?: string, people?: string, fromPanel = false): string {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!clean) return 'The project needs a name.';
    if (!VAULTS.includes(vault)) vault = 'personal';
    if (!fromPanel && !this.modes.writable().includes(vault)) return `In ${label(this.modes.mode).toLowerCase()} new projects can only go in the household vault.`;
    if (this.memory.projectsIn([vault]).some((p) => normalise(p.name) === normalise(clean))) return `There is already a project called ${clean}.`;
    const now = new Date().toISOString();
    const p: Project = {
      id: randomUUID(),
      vault,
      name: clean,
      description: description?.trim().slice(0, 500) || undefined,
      status: 'active',
      people: parsePeople(people),
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    if (!this.memory.addProject(p)) return `The ${vault} vault can't be opened right now, so the project wasn't created.`;
    this.memory.activity('saved', `Created project ${p.name}`, [vault], p.people.map(personText));
    this.log.log(`Created project "${p.name}" in ${vault} with ${p.people.length} people`);
    return `Created the ${vault} project ${p.name}${p.people.length ? ` with ${p.people.map((x) => x.name).join(', ')}` : ''}.`;
  }

  /** Spoken overview: people, open tasks, latest project memory. */
  show(p: Project): string {
    const open = p.tasks.filter((t) => t.status === 'open').sort(byDue);
    const done = p.tasks.length - open.length;
    const mem = this.memory.projectMemory(p);
    this.memory.activity('shared', `Project overview: ${p.name}`, [p.vault], [...mem.facts.slice(0, 8).map((f) => f.text)]);
    return [
      `Project ${p.name} (${p.vault}, ${statusText(p.status)})${p.description ? `: ${p.description}` : ''}.`,
      p.people.length ? `People: ${p.people.map(personText).join('; ')}.` : 'No people added yet.',
      open.length ? `Open tasks (${open.length}${done ? `, ${done} done` : ''}): ${open.slice(0, 10).map(taskText).join('; ')}.` : `No open tasks${done ? ` (${done} done)` : ''}.`,
      mem.facts.length ? `Project notes: ${mem.facts.slice(0, 8).map((f) => f.text).join('; ')}.` : '',
      mem.notes.length ? `Last discussed: ${mem.notes[0].summary}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  list(status?: string): string {
    const all = this.visible().filter((p) => (status ? p.status === status : p.status !== 'done'));
    if (!all.length) return status ? `No ${statusText(status as Project['status'])} projects.` : 'No active projects.' + this.lockedHint();
    return all
      .map((p) => {
        const open = p.tasks.filter((t) => t.status === 'open').sort(byDue);
        return `${p.name} (${p.vault}, ${statusText(p.status)}): ${plural(p.people.length, 'person', 'people')}, ${plural(open.length, 'open task')}${open[0]?.due ? `, next due ${dueText(open[0].due)}` : ''}`;
      })
      .join('\n') + this.lockedHint();
  }

  update(p: Project, changes: { status?: string; description?: string; rename?: string }): string {
    const done: string[] = [];
    if (changes.status && ['active', 'on_hold', 'done'].includes(changes.status)) {
      p.status = changes.status as Project['status'];
      done.push(`status ${statusText(p.status)}`);
    }
    if (changes.description?.trim()) {
      p.description = changes.description.trim().slice(0, 500);
      done.push('description');
    }
    if (changes.rename?.trim()) {
      p.name = changes.rename.trim().slice(0, 80);
      done.push(`name ${p.name}`);
    }
    if (!done.length) return 'Nothing to change.';
    this.memory.touchProject(p);
    this.memory.activity('updated', `Project ${p.name}: ${done.join(', ')}`, [p.vault]);
    return `Updated ${p.name}: ${done.join(', ')}.`;
  }

  addPeople(p: Project, people: string): string {
    const added: ProjectPerson[] = [];
    for (const person of parsePeople(people)) {
      const existing = p.people.find((x) => normalise(x.name) === normalise(person.name));
      if (existing) Object.assign(existing, { role: person.role ?? existing.role, contact: person.contact ?? existing.contact });
      else p.people.push(person);
      added.push(person);
    }
    if (!added.length) return 'Who should I add?';
    this.memory.touchProject(p);
    this.memory.activity('saved', `Project ${p.name}: people added or updated`, [p.vault], added.map(personText));
    return `${p.name} people: ${p.people.map(personText).join('; ')}.`;
  }

  removePerson(p: Project, name: string): string {
    const before = p.people.length;
    p.people = p.people.filter((x) => normalise(x.name) !== normalise(name) && !normalise(x.name).startsWith(`${normalise(name)} `));
    if (p.people.length === before) return `${name} isn't on ${p.name}.`;
    this.memory.touchProject(p);
    this.memory.activity('forgot', `Project ${p.name}: removed ${name}`, [p.vault]);
    return `Removed ${name} from ${p.name}.`;
  }

  // ---------- Tasks ----------

  addTask(p: Project, t: { title: string; due?: string; assignee?: string; priority?: string; criticality?: string; remind?: boolean }): string {
    const title = t.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) return 'What is the task?';
    const due = validDue(t.due);
    if (t.due && !due) return `I couldn't read the due date "${t.due}". Use YYYY-MM-DD, optionally with THH:MM.`;
    const task: Task = {
      id: randomUUID(),
      title,
      due,
      assignee: t.assignee?.trim() || undefined,
      priority: priorityOf(t.priority),
      criticality: criticalityOf(t.criticality),
      status: 'open',
      remind: t.remind ?? (!!due && due.includes('T')),
      createdAt: new Date().toISOString(),
    };
    p.tasks.push(task);
    if (task.assignee && !p.people.some((x) => normalise(x.name) === normalise(task.assignee!))) p.people.push({ name: task.assignee });
    this.memory.touchProject(p);
    this.memory.activity('saved', `Project ${p.name}: new task`, [p.vault], [taskText(task)]);
    return `Added to ${p.name}: ${taskText(task)}${task.remind && due ? ' (I will remind you when it is due)' : ''}.`;
  }

  /** Tasks matching some words, in one project or across visible projects. */
  findTask(words: string, p?: Project, includeDone = false): { project: Project; task: Task }[] {
    const q = normalise(words);
    const qw = q.split(' ').filter((w) => w.length > 2);
    const pool = (p ? [p] : this.visible()).flatMap((project) => project.tasks.filter((t) => includeDone || t.status === 'open').map((task) => ({ project, task })));
    const scored = pool
      .map((x) => {
        const n = normalise(x.task.title);
        const hits = qw.filter((w) => n.includes(w)).length;
        return { ...x, score: n === q ? 2 : n.includes(q) ? 1.5 : hits / Math.max(1, qw.length) };
      })
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    return scored.filter((x) => x.score === scored[0]?.score);
  }

  completeTask(project: Project, task: Task): string {
    task.status = 'done';
    task.doneAt = new Date().toISOString();
    this.memory.touchProject(project);
    this.memory.activity('updated', `Project ${project.name}: task done`, [project.vault], [task.title]);
    const left = project.tasks.filter((t) => t.status === 'open').length;
    return `Done: ${task.title}. ${left} open task${left === 1 ? '' : 's'} left on ${project.name}.`;
  }

  updateTask(project: Project, task: Task, c: { title?: string; due?: string; assignee?: string; priority?: string; criticality?: string; reopen?: boolean }): string {
    if (c.due !== undefined) {
      const due = validDue(c.due);
      if (c.due && !due) return `I couldn't read the due date "${c.due}".`;
      task.due = due;
      task.reminded = false;
      if (due?.includes('T')) task.remind = true;
    }
    if (c.title?.trim()) task.title = c.title.trim().slice(0, 200);
    if (c.assignee !== undefined) task.assignee = c.assignee.trim() || undefined;
    if (priorityOf(c.priority)) task.priority = priorityOf(c.priority);
    if (criticalityOf(c.criticality)) task.criticality = criticalityOf(c.criticality);
    if (c.reopen) {
      task.status = 'open';
      task.doneAt = undefined;
    }
    this.memory.touchProject(project);
    this.memory.activity('updated', `Project ${project.name}: task changed`, [project.vault], [taskText(task)]);
    return `Updated: ${taskText(task)}.`;
  }

  deleteTask(project: Project, task: Task): string {
    project.tasks = project.tasks.filter((t) => t.id !== task.id);
    this.memory.touchProject(project);
    this.memory.activity('forgot', `Project ${project.name}: task deleted`, [project.vault], [task.title]);
    return `Deleted the task ${task.title}.`;
  }

  /** Open tasks across visible projects: today, this week, overdue or all; optionally one person's. */
  agenda(when: string = 'week', assignee?: string, p?: Project): string {
    const today = localToday();
    const horizon = when === 'today' ? today : addDays(today, when === 'week' ? 7 : 3650);
    const rows = (p ? [p] : this.visible().filter((x) => x.status === 'active'))
      .flatMap((project) => project.tasks.filter((t) => t.status === 'open').map((task) => ({ project, task })))
      .filter(({ task }) => !assignee || normalise(task.assignee ?? '').includes(normalise(assignee)))
      .filter(({ task }) => {
        const d = task.due?.slice(0, 10);
        if (when === 'overdue') return !!d && d < today;
        if (when === 'all') return true;
        return !!d && d <= horizon;
      })
      .sort((a, b) => byDue(a.task, b.task));
    if (!rows.length) return `Nothing ${when === 'overdue' ? 'overdue' : when === 'today' ? 'due today' : when === 'all' ? 'open' : 'due this week'}${assignee ? ` for ${assignee}` : ''}.` + this.lockedHint();
    return rows.slice(0, 20).map(({ project, task }) => `${project.name}: ${taskText(task)}`).join('\n') + this.lockedHint();
  }

  // ---------- Standing memory & reminders ----------

  /** "Active projects" and "tasks due soon" for the start of each conversation (open vaults only). */
  promptSection(open: VaultName[]): string {
    const projects = this.memory.projectsIn(open).filter((p) => p.status === 'active');
    if (!projects.length) return '';
    // Tasks due soon are listed with the rest of the to-do list (TodoService).
    return [
      `Active projects (use the project action for details, the todo action for their tasks): ${projects
        .slice(0, 12)
        .map((p) => `${p.name} [${p.vault}; ${p.people.map((x) => x.name).slice(0, 6).join(', ') || 'no people'}; ${plural(p.tasks.filter((t) => t.status === 'open').length, 'open task')}]`)
        .join('; ')}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Announces tasks that have fallen due. Work tasks wait for work mode; very old ones are skipped. */
  scanReminders(now = Date.now()): void {
    const open = this.modes.readable();
    for (const vault of VAULTS) {
      const lists: { name: string; tasks: Task[]; save: () => void }[] = [
        ...this.memory.projectsIn([vault]).map((p) => ({ name: p.name, tasks: p.tasks, save: () => this.memory.touchProject(p) })),
        { name: '', tasks: this.memory.todosIn([vault]).map((x) => x.task), save: () => this.memory.touchVault(vault) },
      ];
      for (const p of lists) {
        let changed = false;
        for (const t of p.tasks) {
          if (t.status !== 'open' || !t.remind || t.reminded || !t.due) continue;
          const at = dueEpoch(t.due);
          if (at === undefined || at > now) continue;
          if (now - at > STALE_REMINDER_MS) {
            t.reminded = true;
            changed = true;
            continue;
          }
          if (!open.includes(vault)) continue; // e.g. a work task outside work mode: wait
          t.reminded = true;
          changed = true;
          const text = `Reminder: ${p.name ? `${p.name}: ` : ''}${t.title}${t.assignee ? ` (${t.assignee})` : ''} is due now.`;
          this.log.log(`Reminder: ${text}`);
          this.memory.activity('shared', 'Task reminder announced', [vault], [text]);
          this.emit('reminder', text);
        }
        if (changed) p.save();
      }
    }
  }

  private lockedHint(): string {
    if (this.modes.mode === 'guest') return ''; // not even a count for visitors
    const hidden = this.memory.projectsIn(VAULTS.filter((v) => !this.modes.readable().includes(v))).filter((p) => p.status !== 'done').length;
    return hidden ? `\n(${hidden} more project${hidden === 1 ? ' is' : 's are'} locked in ${label(this.modes.mode).toLowerCase()}.)` : '';
  }
}

// ---------- helpers ----------

const names = (ps: Project[]) => ps.map((p) => p.name).join(', ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const statusText = (s: Project['status']) => ({ active: 'active', on_hold: 'on hold', done: 'finished' })[s] ?? s;
const personText = (p: ProjectPerson) => `${p.name}${p.role ? ` (${p.role})` : ''}${p.contact ? `, ${p.contact}` : ''}`;

/** "Marco Rossi (supplier, marco@acme.com), Anna; Tom - designer" -> people. */
const CONTACT = /@|^\+?\d[\d\s-]{6,}$/;

export function parsePeople(s?: string): ProjectPerson[] {
  if (!s) return [];
  // A bare email or phone after a comma belongs to the person before it ("Tom - finance, +44 7700 900123").
  const parts: string[] = [];
  for (const x of s.split(/[;\n]|,(?![^()]*\))/).map((y) => y.trim()).filter(Boolean)) {
    if (CONTACT.test(x) && !/\s[a-z]{2,}\s/i.test(x) && parts.length) parts[parts.length - 1] += /\(.*\)$/.test(parts[parts.length - 1]) ? '' : `, ${x}`;
    else parts.push(x);
  }
  return parts
    .map((x) => {
      const m = /^(.+?)\s*\((.+)\)\s*$/.exec(x) ?? /^(.+?)\s+[-–]\s+(.+)$/.exec(x) ?? /^([^,]+?),\s*(.+)$/.exec(x);
      const name = (m ? m[1] : x).trim().slice(0, 80);
      const extra = (m?.[2] ?? '').split(',').map((y) => y.trim()).filter(Boolean);
      const contact = extra.find((y) => /@|\+?\d[\d\s-]{6,}/.test(y));
      const role = extra.filter((y) => y !== contact).join(', ') || undefined;
      return { name, role: role?.slice(0, 80), contact: contact?.slice(0, 120) };
    })
    .filter((p) => p.name);
}

export function validDue(s?: string): string | undefined {
  if (!s) return undefined;
  const v = s.trim().replace(' ', 'T');
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v);
  if (!m || Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`))) return undefined;
  return m[2] ? `${m[1]}T${m[2]}` : m[1];
}

export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date());
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

/** Epoch ms of a local "YYYY-MM-DDTHH:MM" (or 09:00 for a date only) in the household time zone. */
export function dueEpoch(due: string): number | undefined {
  const [d, t = '09:00'] = due.split('T');
  const naive = Date.parse(`${d}T${t}:00Z`);
  if (Number.isNaN(naive)) return undefined;
  // Find the zone offset at that moment and correct for it.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(naive));
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
  const asLocal = Date.parse(`${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:00Z`);
  return naive - (asLocal - naive);
}

export function dueText(due: string): string {
  const [d, t] = due.split('T');
  const today = localToday();
  const day =
    d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return t ? `${day} at ${t}` : day;
}

export function taskText(t: Task): string {
  const level = [t.criticality && t.criticality !== 'routine' ? t.criticality : '', t.priority === 'high' || t.priority === 'low' ? `${t.priority} priority` : '']
    .filter(Boolean)
    .join(', ');
  return `${t.title}${t.due ? `, due ${dueText(t.due)}` : ''}${t.assignee ? `, ${t.assignee}` : ''}${level ? `, ${level}` : ''}${t.status === 'done' ? ' (done)' : ''}`;
}

const CRIT_RANK = { critical: 0, important: 1, routine: 2 };
const PRIO_RANK = { high: 0, medium: 1, normal: 1, low: 2 };

/** Most pressing first: critical before important before routine, then by due date, then priority. */
export function byUrgency(a: Task, b: Task): number {
  return (
    CRIT_RANK[a.criticality ?? 'routine'] - CRIT_RANK[b.criticality ?? 'routine'] ||
    (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
    PRIO_RANK[a.priority ?? 'medium'] - PRIO_RANK[b.priority ?? 'medium']
  );
}

export function byDue(a: Task, b: Task): number {
  return (a.due ?? '9999').localeCompare(b.due ?? '9999') || PRIO_RANK[a.priority ?? 'medium'] - PRIO_RANK[b.priority ?? 'medium'];
}

/** "high" / "medium" / "low" from what the user or the AI said ("urgent", "normal"...). */
export function priorityOf(s?: string): Task['priority'] {
  const v = (s ?? '').toLowerCase().trim();
  if (/^(high|urgent|asap|top)/.test(v)) return 'high';
  if (/^(medium|normal|mid|moderate)/.test(v)) return 'medium';
  if (/^(low|whenever|someday)/.test(v)) return 'low';
  return undefined;
}

export function criticalityOf(s?: string): Task['criticality'] {
  const v = (s ?? '').toLowerCase().trim();
  if (/^(critical|crit|must|essential|vital)/.test(v)) return 'critical';
  if (/^(important|high|major|significant)/.test(v)) return 'important';
  if (/^(routine|low|minor|normal|nice|optional)/.test(v)) return 'routine';
  return undefined;
}
