import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { timeZone } from '../actions/clock';

export type Mode = 'personal' | 'work' | 'guest';
export type VaultName = 'personal' | 'household' | 'work';
export const VAULTS: VaultName[] = ['personal', 'household', 'work'];

interface Slot {
  days: Set<number>; // 0 = Sunday
  from: number; // minutes after midnight
  to: number;
}

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_OVERRIDE_MS = 24 * 3600_000;

/**
 * Which part of Max's memory is open right now:
 *  - personal: Personal + Household (Work is locked)
 *  - work:     Work + Household (Personal is locked)
 *  - guest:    Household only
 * Personal and work never see each other's memories; Household is shared home matters.
 * Work mode follows WORK_HOURS automatically; "Max, work mode / personal mode / guest mode"
 * overrides it until the schedule next changes (guest mode until switched off, max 24 h).
 */
@Injectable()
export class ModesService {
  private readonly log = new Logger('Memory');
  private readonly slots: Slot[];
  private override?: { mode: Mode; until: number };
  private readonly file: string;
  /** Told about every switch (the memory activity log). */
  onChange?: (description: string) => void;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.slots = parseHours(cfg.memory.workHours);
    this.file = join(cfg.memory.dir, 'mode.json');
    try {
      const o = JSON.parse(readFileSync(this.file, 'utf8')) as { mode: Mode; until: number };
      if (o && ['personal', 'work', 'guest'].includes(o.mode) && o.until > Date.now()) this.override = o;
    } catch {
      // no saved override
    }
  }

  get mode(): Mode {
    if (this.override && this.override.until > Date.now()) return this.override.mode;
    this.override = undefined;
    return this.scheduled();
  }

  /** How the current mode was decided, for the panel and the AI. */
  describe(): string {
    const m = this.mode;
    if (this.override) return `${label(m)} (switched by hand until ${this.fmt(this.override.until)})`;
    return this.slots.length ? `${label(m)} (automatic: work hours ${this.cfg.memory.workHours})` : label(m);
  }

  readable(mode = this.mode): VaultName[] {
    return mode === 'guest' ? ['household'] : mode === 'work' ? ['work', 'household'] : ['personal', 'household'];
  }

  writable(mode = this.mode): VaultName[] {
    // New facts can be filed into any vault (a work detail mentioned in the evening, a personal one
    // at work): filing never reveals what's already in a locked vault.
    return mode === 'guest' ? ['household'] : [...VAULTS];
  }

  set(mode: Mode | 'auto'): string {
    if (mode === 'auto') {
      this.override = undefined;
    } else {
      const until = mode === 'guest' ? Date.now() + MAX_OVERRIDE_MS : this.nextChange();
      this.override = { mode, until };
    }
    this.save();
    this.log.log(`Mode: ${this.describe()}`);
    this.onChange?.(`Switched to ${this.describe()}`);
    return this.describe();
  }

  private scheduled(at = new Date()): Mode {
    if (!this.slots.length) return 'personal';
    const { day, minutes } = localParts(at);
    return this.slots.some((s) => s.days.has(day) && minutes >= s.from && minutes < s.to) ? 'work' : 'personal';
  }

  /** When the schedule next flips (searched minute by minute in 5-minute steps, up to 24 h). */
  private nextChange(): number {
    const now = Date.now();
    const cur = this.scheduled(new Date(now));
    for (let t = now + 5 * 60_000; t <= now + MAX_OVERRIDE_MS; t += 5 * 60_000) {
      if (this.scheduled(new Date(t)) !== cur) return t;
    }
    return now + MAX_OVERRIDE_MS;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.override ?? {}), 'utf8');
    } catch (err) {
      this.log.warn(`Could not save the mode: ${(err as Error).message}`);
    }
  }

  private fmt(ms: number): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
  }
}

export const label = (m: Mode) => ({ personal: 'Personal mode', work: 'Work mode', guest: 'Guest mode' })[m];

/** "Mon-Fri 09:00-17:30; Sat 10:00-12:00" -> slots. "off" or empty -> no schedule. */
export function parseHours(spec: string): Slot[] {
  if (!spec || /^off$/i.test(spec.trim())) return [];
  const slots: Slot[] = [];
  for (const part of spec.split(/[;,]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z]{3})(?:\s*-\s*([a-z]{3}))?\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/i.exec(part);
    if (!m) throw new Error(`WORK_HOURS: can't read "${part}" (expected e.g. "Mon-Fri 09:00-17:30")`);
    const a = DAY.indexOf(m[1].toLowerCase());
    const b = m[2] ? DAY.indexOf(m[2].toLowerCase()) : a;
    if (a < 0 || b < 0) throw new Error(`WORK_HOURS: unknown day in "${part}"`);
    const days = new Set<number>();
    for (let d = a; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === b) break;
    }
    slots.push({ days, from: +m[3] * 60 + +m[4], to: +m[5] * 60 + +m[6] });
  }
  return slots;
}

function localParts(at: Date): { day: number; minutes: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { day: DAY.indexOf(get('weekday').toLowerCase().slice(0, 3)), minutes: +get('hour') * 60 + +get('minute') };
}
