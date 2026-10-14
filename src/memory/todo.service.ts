import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MemoryService, normalise, Project, Task } from './memory.service';
import { label, ModesService, VaultName, VAULTS } from './modes.service';
import { addDays, byUrgency, criticalityOf, dueText, localToday, priorityOf, ProjectsService, taskText, validDue } from './projects.service';

/** One to-do, wherever it lives: on its own in a vault, or as a task of a project. */
export interface TodoItem {
  task: Task;
  vault: VaultName;
  project?: Project;
}

export interface TodoInput {
  title: string;
  priority?: string;
  criticality?: string;
  due?: string;
  assignee?: string;
  remind?: boolean;
  /** Project name (voice) or the project itself (control panel). */
  project?: string | Project;
  vault?: string;
}

const SOON_DAYS = 7;
const PROMPT_ITEMS = 12;

/**
 * The to-do list ("My Day"). Every item has a priority (how soon: high, medium, low) and a
 * criticality (what's at stake if it slips: critical, important, routine), and can belong to a
 * project. Items with a project are that project's tasks (so the project shows them too);
 * the rest are kept on their own in a vault. Either way they follow the vault rules: work
 * to-dos are encrypted with the Work vault and only visible in work mode.
 */
@Injectable()
export class TodoService {
  private readonly log = new Logger('Todo');

  constructor(
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
    private readonly projects: ProjectsService,
  ) {
    if (memory.enabled) memory.sections.push((open) => this.promptSection(open));
  }

  // ---------- Reading ----------

  /** Every item in these vaults (open ones by default), most pressing first. */
  items(vaults: VaultName[] = this.modes.readable(), includeDone = false): TodoItem[] {
    const loose = this.memory.todosIn(vaults).map(({ vault, task }) => ({ vault, task }));
    const tasks = this.memory
      .projectsIn(vaults)
      .filter((p) => p.status !== 'done')
      .flatMap((project) => project.tasks.map((task) => ({ vault: project.vault, task, project })));
    return [...loose, ...tasks].filter((x) => includeDone || x.task.status === 'open').sort((a, b) => byUrgency(a.task, b.task));
  }

  /** Any item by id, in any vault (control panel). */
  byId(id: string): TodoItem | undefined {
    return this.items(VAULTS, true).find((x) => x.task.id === id);
  }

  find(words: string, project?: Project, includeDone = false): TodoItem[] {
    const q = normalise(words);
    const qw = q.split(' ').filter((w) => w.length > 2);
    const scored = this.items(undefined, includeDone)
      .filter((x) => !project || x.project?.id === project.id)
      .map((x) => {
        const n = normalise(x.task.title);
        const hits = qw.filter((w) => n.includes(w)).length;
        return { x, score: n === q ? 2 : n.includes(q) ? 1.5 : hits / Math.max(1, qw.length) };
      })
      .filter((s) => s.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score === scored[0]?.score).map((s) => s.x);
  }

  // ---------- Changing ----------

  /** fromPanel: the control panel may add to any vault, whatever the mode. */
  add(input: TodoInput, fromPanel = false): string {
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) return 'What is the to-do?';
    const priority = priorityOf(input.priority);
    const criticality = criticalityOf(input.criticality);
    if (!fromPanel && (!priority || !criticality)) {
      const missing = [!priority ? 'priority (high, medium or low: how soon)' : '', !criticality ? 'criticality (critical, important or routine: what happens if it slips)' : '']
        .filter(Boolean)
        .join(' and ');
      return `Not added yet: ask the user, in one short question, for the ${missing} of "${title}", then call again. If they say it doesn't matter, use medium and routine.`;
    }
    const due = validDue(input.due);
    if (input.due && !due) return `I couldn't read the due date "${input.due}". Use YYYY-MM-DD, optionally with THH:MM.`;

    const project = this.resolveProject(input.project);
    if (typeof project === 'string') return project;
    if (project) {
      if (!fromPanel && !this.modes.writable().includes(project.vault)) return `${project.name} is in the ${project.vault} vault, which is read-only in ${label(this.modes.mode).toLowerCase()}.`;
      return this.projects.addTask(project, { title, due, assignee: input.assignee, priority, criticality, remind: input.remind });
    }

    const where = this.vaultFor(input.vault, fromPanel);
    if (!VAULTS.includes(where as VaultName)) return where;
    const vault = where as VaultName;
    const task: Task = {
      id: randomUUID(),
      title,
      due,
      assignee: input.assignee?.trim() || undefined,
      priority,
      criticality,
      status: 'open',
      remind: input.remind ?? (!!due && due.includes('T')),
      createdAt: new Date().toISOString(),
    };
    if (!this.memory.addTodo(vault, task)) return `The ${vault} vault can't be opened right now, so the to-do wasn't saved.`;
    this.memory.activity('saved', 'New to-do', [vault], [taskText(task)]);
    this.log.log(`To-do added (${vault}): ${taskText(task)}`);
    return `Added to your ${vault === 'household' ? 'household' : vault} to-do list: ${taskText(task)}${task.remind && due ? ' (I will remind you when it is due)' : ''}.`;
  }

  complete(item: TodoItem): string {
    item.task.status = 'done';
    item.task.doneAt = new Date().toISOString();
    this.save(item);
    this.memory.activity('updated', 'To-do done', [item.vault], [item.task.title]);
    const left = this.items().length;
    return `Done: ${item.task.title}. ${left} open to-do${left === 1 ? '' : 's'} left.`;
  }

  update(
    item: TodoItem,
    c: { title?: string; due?: string; assignee?: string; priority?: string; criticality?: string; reopen?: boolean; moveTo?: string | Project },
    fromPanel = false,
  ): string {
    const t = item.task;
    if (c.due !== undefined) {
      const due = validDue(c.due);
      if (c.due && !due) return `I couldn't read the due date "${c.due}".`;
      t.due = due;
      t.reminded = false;
      if (due?.includes('T')) t.remind = true;
    }
    if (c.title?.trim()) t.title = c.title.trim().slice(0, 200);
    if (c.assignee !== undefined) t.assignee = c.assignee.trim() || undefined;
    if (priorityOf(c.priority)) t.priority = priorityOf(c.priority);
    if (criticalityOf(c.criticality)) t.criticality = criticalityOf(c.criticality);
    if (c.reopen) {
      t.status = 'open';
      t.doneAt = undefined;
    }
    let moved = '';
    if (c.moveTo !== undefined && c.moveTo !== '') {
      const none = typeof c.moveTo === 'string' && /^(none|no project|remove|nothing)$/i.test(c.moveTo.trim());
      const target = none ? undefined : this.resolveProject(c.moveTo);
      if (typeof target === 'string') return target;
      if (target?.id !== item.project?.id) {
        const vault = target?.vault ?? item.vault;
        if (!fromPanel && !this.modes.writable().includes(vault)) return `The ${vault} vault is read-only in ${label(this.modes.mode).toLowerCase()}.`;
        this.detach(item);
        if (target) {
          target.tasks.push(t);
          this.memory.touchProject(target);
        } else if (!this.memory.addTodo(vault, t)) {
          return `The ${vault} vault can't be opened right now.`;
        }
        moved = target ? ` Now part of ${target.name}.` : ' No longer part of a project.';
        item = { task: t, vault, project: target };
      }
    }
    this.save(item);
    this.memory.activity('updated', 'To-do changed', [item.vault], [taskText(t)]);
    return `Updated: ${taskText(t)}.${moved}`;
  }

  delete(item: TodoItem): string {
    this.detach(item);
    this.memory.activity('forgot', 'To-do deleted', [item.vault], [item.task.title]);
    return `Deleted the to-do ${item.task.title}.`;
  }

  // ---------- Speaking ----------

  /** The to-do list for voice: today, this week, overdue, critical or everything. */
  list(when = 'all', project?: Project, assignee?: string): string {
    const today = localToday();
    const horizon = when === 'today' ? today : when === 'week' ? addDays(today, 7) : '9999';
    const rows = this.items()
      .filter((x) => !project || x.project?.id === project.id)
      .filter((x) => !assignee || normalise(x.task.assignee ?? '').includes(normalise(assignee)))
      .filter(({ task }) => {
        const d = task.due?.slice(0, 10);
        if (when === 'overdue') return !!d && d < today;
        if (when === 'critical') return task.criticality === 'critical';
        if (when === 'all') return true;
        // Today / this week: what's due by then, plus anything critical without a date.
        return (!!d && d <= horizon) || (!d && task.criticality === 'critical');
      });
    const what = { overdue: 'overdue', critical: 'critical', today: 'due today', week: 'due this week' }[when] ?? 'on the list';
    if (!rows.length) return `Nothing ${what}${project ? ` for ${project.name}` : ''}.${this.lockedHint()}`;
    return `${rows.length} to-do${rows.length === 1 ? '' : 's'} ${what} (most pressing first):\n${rows.slice(0, 25).map((x) => `- ${line(x, today)}`).join('\n')}${rows.length > 25 ? `\n(${rows.length - 25} more)` : ''}${this.lockedHint()}`;
  }

  /** The to-do part of "what's my day": overdue, today's, critical, then a count of the rest. */
  dayBriefing(): string {
    const today = localToday();
    const all = this.items();
    const overdue = all.filter((x) => x.task.due && x.task.due.slice(0, 10) < today);
    const dueToday = all.filter((x) => x.task.due?.slice(0, 10) === today);
    const critical = all.filter((x) => x.task.criticality === 'critical' && !overdue.includes(x) && !dueToday.includes(x));
    const rest = all.length - overdue.length - dueToday.length - critical.length;
    const block = (title: string, xs: TodoItem[]) => (xs.length ? `${title}:\n${xs.map((x) => `- ${line(x, today)}`).join('\n')}` : '');
    return (
      [
        block('OVERDUE (should already have been done)', overdue),
        block('Due today', dueToday),
        block('Critical, not due today', critical),
        rest > 0 ? `Plus ${rest} other open to-do${rest === 1 ? '' : 's'} for later (not urgent; mention only the count).` : '',
      ]
        .filter(Boolean)
        .join('\n') || 'No open to-dos.'
    ) + this.lockedHint();
  }

  /** Standing memory: what's overdue, due this week or critical (open vaults only). */
  promptSection(open: VaultName[]): string {
    const today = localToday();
    const soon = addDays(today, SOON_DAYS);
    const rows = this.items(open).filter((x) => x.task.criticality === 'critical' || (x.task.due && x.task.due.slice(0, 10) <= soon));
    if (!rows.length) return '';
    return `To-do list (use the todo action to change it; my_day for a briefing). Overdue, due in the next ${SOON_DAYS} days, or critical:\n${rows
      .slice(0, PROMPT_ITEMS)
      .map((x) => `- ${line(x, today)}`)
      .join('\n')}`;
  }

  // ---------- helpers ----------

  private resolveProject(p?: string | Project): Project | undefined | string {
    if (!p) return undefined;
    if (typeof p !== 'string') return p;
    const found = this.projects.find(p);
    return 'error' in found ? found.error : found.project;
  }

  /** Where a new to-do without a project goes: the mode's own vault unless the user said otherwise. */
  private vaultFor(asked: string | undefined, fromPanel: boolean): VaultName | string {
    const v = (asked === 'shared' || asked === 'home' ? 'household' : asked) as VaultName | undefined;
    if (v && VAULTS.includes(v)) {
      if (!fromPanel && !this.modes.writable().includes(v)) return `In ${label(this.modes.mode).toLowerCase()} the ${v} list is read-only.`;
      return v;
    }
    const mode = this.modes.mode;
    return mode === 'work' ? 'work' : mode === 'guest' ? 'household' : 'personal';
  }

  private detach(item: TodoItem): void {
    if (item.project) {
      item.project.tasks = item.project.tasks.filter((t) => t.id !== item.task.id);
      this.memory.touchProject(item.project);
    } else {
      this.memory.removeTodo(item.vault, item.task.id);
    }
  }

  private save(item: TodoItem): void {
    if (item.project) this.memory.touchProject(item.project);
    else this.memory.touchVault(item.vault);
  }

  private lockedHint(): string {
    if (this.modes.mode === 'guest') return '';
    const closed = VAULTS.filter((v) => !this.modes.readable().includes(v));
    const n = this.items(closed).length;
    return n ? `\n(${n} more to-do${n === 1 ? ' is' : 's are'} locked in ${label(this.modes.mode).toLowerCase()}.)` : '';
  }
}

function line(x: TodoItem, today: string): string {
  const t = x.task;
  const late = t.due && t.due.slice(0, 10) < today ? `OVERDUE since ${dueText(t.due)}: ` : '';
  const crit = t.criticality ?? 'routine';
  const prio = t.priority === 'normal' ? 'medium' : (t.priority ?? 'medium');
  return `${late}${t.title}${t.due && !late ? ` (due ${dueText(t.due)})` : ''} [${crit}, ${prio} priority${x.project ? `, project ${x.project.name}` : ''}${t.assignee ? `, ${t.assignee}` : ''}]`;
}
