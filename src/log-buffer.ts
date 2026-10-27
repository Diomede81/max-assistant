import { ConsoleLogger, LogLevel } from '@nestjs/common';

/** One line of Max's log. */
export interface LogLine {
  at: number;
  level: 'log' | 'warn' | 'error' | 'debug';
  context: string;
  message: string;
}

const MAX_LINES = 1000;
const lines: LogLine[] = [];

/** The last lines of Max's log, newest last (for the control panel's Log page). */
export function recentLog(): LogLine[] {
  return [...lines];
}

/**
 * Max's logger: prints as before (the Docker log), and keeps the last 1000 lines in memory so the
 * control panel can show them (Settings → Log): no need to log in to the box to see what happened.
 * The lines are the same as in the Docker log: never message content (see log-content.ts).
 */
export class BufferLogger extends ConsoleLogger {
  constructor(levels: LogLevel[]) {
    super();
    this.setLogLevels(levels);
  }

  private keep(level: LogLine['level'], message: unknown, rest: unknown[]): void {
    if (!this.isLevelEnabled(level)) return;
    const context = typeof rest[rest.length - 1] === 'string' ? String(rest[rest.length - 1]) : this.context ?? '';
    const text = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
    lines.push({ at: Date.now(), level, context, message: String(text).slice(0, 1000) });
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.keep('log', message, rest);
    super.log(message, ...(rest as [string]));
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.keep('warn', message, rest);
    super.warn(message, ...(rest as [string]));
  }

  error(message: unknown, ...rest: unknown[]): void {
    // Nest passes (message, stack, context) for errors
    this.keep('error', message, rest);
    super.error(message, ...(rest as [string]));
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.keep('debug', message, rest);
    super.debug(message, ...(rest as [string]));
  }
}
