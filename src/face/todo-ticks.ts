import type { TodoItem, TodoService } from '../memory/todo.service';
import type { CardHandlers, CardLine } from './screen';

/**
 * Done buttons for to-dos on a screen card ("Your day", the overdue list). A ticked to-do stays on
 * the card, struck through, with Undo in case of a slip of the finger; the card is redrawn each time.
 */
export class TodoTicks {
  /** Ticked on this card: id -> title. */
  private readonly ticked = new Map<string, string>();

  constructor(
    private readonly todos: TodoService,
    private readonly redraw: () => void,
  ) {}

  /** A new card: forget what was ticked on the previous one. */
  reset(): void {
    this.ticked.clear();
  }

  /** An open to-do's line, with a Done button. */
  line(item: TodoItem, base: CardLine): CardLine {
    return { ...base, action: { id: `done-${item.task.id}`, label: 'Done' } };
  }

  /** The to-dos ticked on this card (struck through, with Undo). */
  doneLines(): CardLine[] {
    return [...this.ticked].map(([id, title]) => ({ time: '✓', text: title, sub: 'Done', tag: 'done' as const, action: { id: `undo-${id}`, label: 'Undo' } }));
  }

  /** What the Done / Undo buttons on these lines do. */
  handlers(lines: CardLine[]): CardHandlers {
    const out: CardHandlers = {};
    for (const l of lines) {
      const a = l.action?.id;
      if (!a) continue;
      const id = a.replace(/^(done|undo)-/, '');
      if (a.startsWith('done-')) {
        out[a] = () => {
          const item = this.todos.byId(id);
          if (item && item.task.status === 'open') this.todos.complete(item);
          this.ticked.set(id, item?.task.title ?? l.text);
          this.redraw();
        };
      } else if (a.startsWith('undo-')) {
        out[a] = () => {
          const item = this.todos.byId(id);
          if (item && item.task.status === 'done') this.todos.update(item, { reopen: true }, true);
          this.ticked.delete(id);
          this.redraw();
        };
      }
    }
    return out;
  }
}
