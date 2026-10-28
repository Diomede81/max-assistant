import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { MemoryService } from '../memory/memory.service';
import { ModesService } from '../memory/modes.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normaliseNumber } from '../whatsapp/contacts';
import { addDays, localToday } from '../memory/projects.service';
import { local } from '../routines/routines.service';

/** How close someone is, with how often you'd want to be in touch (days) by default. */
export const CIRCLES = {
  family: { label: 'Family', every: 7 },
  close: { label: 'Close friend', every: 14 },
  friend: { label: 'Friend', every: 30 },
  colleague: { label: 'Colleague', every: 60 },
  acquaintance: { label: 'Acquaintance', every: 90 },
} as const;
export type Circle = keyof typeof CIRCLES;

/** A way you were in touch. */
export const TOUCHES = { spoke: 'Spoke', called: 'Called', texted: 'Texted', met: 'Met', emailed: 'Emailed' } as const;
export type TouchKind = keyof typeof TOUCHES;

export interface Touch {
  at: string;
  kind: TouchKind;
  note?: string;
  /** Noticed by Max (a WhatsApp message) rather than logged by the user. */
  auto?: boolean;
}

/** Someone close to the user. */
export interface Person {
  id: string;
  name: string;
  circle: Circle;
  /** "wife", "mum", "old school friend"… */
  relation?: string;
  /** Keep in touch at least every N days (the circle's default unless set). */
  every?: number;
  phone?: string;
  email?: string;
  /** "YYYY-MM-DD" or "MM-DD". */
  birthday?: string;
  interests: string[];
  /** How they are doing lately, newest first (what they told you, what's going on in their life). */
  updates: { at: string; text: string }[];
  touches: Touch[];
  createdAt: string;
  /** "Later" on a nudge: no reminder about them before this day (YYYY-MM-DD). */
  snoozedUntil?: string;
}

/** The daily nudge about overdue catch-ups: out loud, on the screen, at this time. */
export interface NudgeSettings {
  speak: boolean;
  screen: boolean;
  time: string;
  /** "Later" puts a person off for this many days. */
  laterDays: number;
}

interface State {
  people: Person[];
  nudge?: Partial<NudgeSettings>;
  /** The day the nudge last went out (once a day). */
  nudgedOn?: string;
}

const NUDGE_DEFAULTS: NudgeSettings = { speak: true, screen: true, time: '18:00', laterDays: 3 };

const TOUCHES_KEPT = 40;
const UPDATES_KEPT = 20;
const DAY_MS = 86400_000;

/**
 * People close to the user, and keeping in touch with them: who they are (family, friends…), the
 * last time they spoke, texted or met, what they're into, and how they're doing. Logged by voice
 * ("I called Mum, her knee is better"), on the control panel, or noticed from WhatsApp (a message
 * to or from someone on the list counts as texting). Max nudges when it's been too long, in the
 * conversation, on the control panel and in the daily briefing. Personal: kept encrypted, and
 * only seen in personal mode.
 */
@Injectable()
export class SocialService implements OnModuleInit {
  private readonly log = new Logger('People');
  private state: State = { people: [] };
  private store?: SealedStore<State>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly modes: ModesService,
    @Optional() private readonly whatsapp?: WhatsAppService,
    @Optional() memory?: MemoryService,
  ) {
    if (memory?.enabled) memory.sections.push((open) => (open.includes('personal') ? this.promptSection() : ''));
  }

  onModuleInit(): void {
    this.store = new SealedStore(this.cfg.memory.dir, 'people', memorySecret(this.cfg));
    try {
      const s = this.store.load();
      if (s) this.state = { ...s, people: (s.people ?? []).map((p) => ({ ...p, interests: p.interests ?? [], updates: p.updates ?? [], touches: p.touches ?? [] })) };
    } catch (err) {
      this.log.error(`Could not read the people (${(err as Error).message}); starting without them`);
    }
    if (this.state.people.length) this.log.log(`${this.state.people.length} people close to you`);
  }

  /** Only in personal mode (and household: family is shared), never for guests or at work. */
  get open(): boolean {
    return this.modes.readable().includes('personal');
  }

  // ---------- Reading ----------

  get people(): Person[] {
    this.noticeWhatsApp();
    return this.state.people;
  }

  /** Days since the last contact of any kind, or undefined when never. */
  daysSince(p: Person): number | undefined {
    const last = this.lastTouch(p);
    return last ? Math.floor((Date.now() - Date.parse(last.at)) / DAY_MS) : undefined;
  }

  lastTouch(p: Person, kind?: TouchKind): Touch | undefined {
    return p.touches.filter((t) => !kind || t.kind === kind).sort((a, b) => b.at.localeCompare(a.at))[0];
  }

  every(p: Person): number {
    return p.every ?? CIRCLES[p.circle]?.every ?? 30;
  }

  /** How many days overdue a catch-up is (0 or less: fine). Never been in touch: counts from when they were added. */
  overdueDays(p: Person): number {
    const last = this.lastTouch(p)?.at ?? p.createdAt;
    return Math.floor((Date.now() - Date.parse(last)) / DAY_MS) - this.every(p);
  }

  /** The people it's been too long with, most overdue first. */
  dueForCatchUp(): Person[] {
    return this.people.filter((p) => this.overdueDays(p) > 0).sort((a, b) => this.overdueDays(b) - this.overdueDays(a));
  }

  // ---------- The daily nudge ----------

  get nudge(): NudgeSettings {
    return { ...NUDGE_DEFAULTS, ...(this.state.nudge ?? {}) };
  }

  saveNudge(input: { speak: boolean; screen: boolean; time?: string; laterDays?: string | number }): string {
    if (input.time !== undefined && !/^\d{2}:\d{2}$/.test(input.time)) return 'The time should look like 18:00.';
    const later = input.laterDays === undefined || input.laterDays === '' ? this.nudge.laterDays : Number(input.laterDays);
    if (!Number.isInteger(later) || later < 1 || later > 30) return '"Later" should put someone off by 1 to 30 days.';
    this.state.nudge = { speak: input.speak, screen: input.screen, time: input.time ?? this.nudge.time, laterDays: later };
    this.persist();
    const n = this.nudge;
    return !n.speak && !n.screen ? 'Reminders are off: Max only mentions overdue catch-ups when you ask.' : `Max reminds you at ${n.time}${n.speak && n.screen ? ', out loud and on the screen' : n.speak ? ', out loud' : ', on the screen'}.`;
  }

  /** The overdue people to remind about now: not put off with "Later". */
  nudgeList(): Person[] {
    const today = localToday();
    return this.dueForCatchUp().filter((p) => !p.snoozedUntil || p.snoozedUntil <= today);
  }

  /** Whether the daily nudge is due now (its time has come today, and it hasn't gone out yet). */
  nudgeDue(now = new Date()): boolean {
    const n = this.nudge;
    if (!this.open || (!n.speak && !n.screen)) return false;
    const { date, time } = local(now);
    return time === n.time && this.state.nudgedOn !== date;
  }

  /** Marks today's nudge as done (whatever was shown or said). */
  nudged(): void {
    this.state.nudgedOn = localToday();
    this.persist();
  }

  /** What Max says: who, how long, and what they were last up to. */
  nudgeText(list = this.nudgeList()): string {
    if (!list.length) return '';
    const one = (p: Person) => `${this.daysSince(p) === undefined ? 'you haven\'t been in touch with' : `${this.daysSince(p)} days since you ${TOUCHES[this.lastTouch(p)!.kind].toLowerCase()}`} ${p.name}`;
    const top = list.slice(0, 3);
    const more = list.length - top.length;
    return `It's been a while: ${top.map(one).join(', ')}${more ? `, and ${more} more` : ''}. ${top[0].updates[0] ? `Last you heard from ${top[0].name}: ${top[0].updates[0].text.replace(/\.$/, '')}. ` : ''}Worth a ${top[0].phone ? 'message or a ' : ''}call?`;
  }

  /** "Later": no reminder about them for a few days (the setting), or until a given day. */
  snooze(p: Person, days = this.nudge.laterDays): string {
    p.snoozedUntil = addDays(localToday(), days);
    this.persist();
    return `OK, nothing about ${p.name} for ${days} day${days === 1 ? '' : 's'}.`;
  }

  /** Birthdays in the next `days` days (today first). */
  birthdaysSoon(days = 14): { person: Person; inDays: number }[] {
    const today = localToday();
    const out: { person: Person; inDays: number }[] = [];
    for (const p of this.people) {
      const md = p.birthday?.match(/(\d{2})-(\d{2})$/);
      if (!md) continue;
      const year = Number(today.slice(0, 4));
      for (const y of [year, year + 1]) {
        const d = `${y}-${md[1]}-${md[2]}`;
        const inDays = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
        if (inDays >= 0 && inDays <= days) {
          out.push({ person: p, inDays });
          break;
        }
      }
    }
    return out.sort((a, b) => a.inDays - b.inDays);
  }

  find(words: string): Person[] {
    const q = words.trim().toLowerCase();
    if (!q) return [];
    const all = this.people;
    const exact = all.filter((p) => p.name.toLowerCase() === q || (p.relation ?? '').toLowerCase() === q);
    if (exact.length) return exact;
    return all.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q) || q.startsWith(w)) || (p.relation ?? '').toLowerCase().includes(q));
  }

  byId(id: string): Person | undefined {
    return this.state.people.find((p) => p.id === id);
  }

  // ---------- Changing ----------

  /** Adds or updates someone. Returns a message. */
  save(input: { name?: string; circle?: string; relation?: string; every?: number | string; phone?: string; email?: string; birthday?: string; interests?: string }, id?: string): string {
    const existing = id ? this.byId(id) : undefined;
    if (id && !existing) return 'That person is no longer on the list.';
    const p: Person = existing ?? { id: randomUUID(), name: '', circle: 'friend', interests: [], updates: [], touches: [], createdAt: new Date().toISOString() };
    if (input.name !== undefined) p.name = input.name.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!p.name) return 'Who? Give their name.';
    const dup = !existing ? this.find(p.name).find((x) => x.name.toLowerCase() === p.name.toLowerCase()) : undefined;
    if (dup) return `${dup.name} is already on the list.`;
    if (input.circle !== undefined) {
      const c = circleOf(input.circle);
      if (!c) return 'The circle must be family, close friend, friend, colleague or acquaintance.';
      p.circle = c;
    }
    if (input.relation !== undefined) p.relation = input.relation.trim().slice(0, 60) || undefined;
    if (input.every !== undefined && input.every !== '') {
      const n = Math.round(Number(input.every));
      if (!n || n < 1 || n > 365) return 'Keep in touch every how many days? 1 to 365.';
      p.every = n;
    } else if (input.every === '') p.every = undefined;
    if (input.phone !== undefined) {
      const n = input.phone.trim() ? normaliseNumber(input.phone) : undefined;
      if (input.phone.trim() && !n) return `I couldn't read the phone number "${input.phone}".`;
      p.phone = n;
    }
    if (input.email !== undefined) {
      const e = input.email.trim().toLowerCase();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return `"${e}" doesn't look like an email address.`;
      p.email = e || undefined;
    }
    if (input.birthday !== undefined) {
      const b = input.birthday.trim();
      if (b && !/^(\d{4}-)?\d{2}-\d{2}$/.test(b)) return 'The birthday must be like 1981-03-14 or 03-14.';
      p.birthday = b || undefined;
    }
    if (input.interests !== undefined) p.interests = splitList(input.interests);
    if (!existing) this.state.people.push(p);
    this.persist();
    this.log.log(`${existing ? 'Updated' : 'Added'} ${p.name} (${CIRCLES[p.circle].label})`);
    return `${existing ? 'Updated' : 'Added'} ${p.name}: ${CIRCLES[p.circle].label.toLowerCase()}${p.relation ? ` (${p.relation})` : ''}, keep in touch every ${this.every(p)} days.`;
  }

  remove(id: string): string {
    const p = this.byId(id);
    if (!p) return 'That person is no longer on the list.';
    this.state.people = this.state.people.filter((x) => x.id !== id);
    this.persist();
    return `Removed ${p.name}.`;
  }

  /** Logs a contact: "I called Mum today" (optionally with how they are). */
  touch(p: Person, kind: string, note?: string, when?: string): string {
    const k = touchOf(kind);
    if (!k) return 'How were you in touch: spoke, called, texted, met or emailed?';
    const at = when && /^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T12:00:00.000Z` : new Date().toISOString();
    p.touches = [{ at, kind: k, note: note?.trim().slice(0, 300) || undefined }, ...p.touches].slice(0, TOUCHES_KEPT);
    if (note?.trim()) this.addUpdate(p, note);
    this.persist();
    return `Noted: ${TOUCHES[k].toLowerCase()} ${p.name}${when ? ` on ${when}` : ''}.${this.nextHint(p)}`;
  }

  /** Adds "how they are" (what's going on in their life), newest first. */
  addUpdate(p: Person, text: string): string {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!t) return 'What is the news about them?';
    if (p.updates[0]?.text.toLowerCase() === t.toLowerCase()) return `Already noted about ${p.name}.`;
    p.updates = [{ at: new Date().toISOString(), text: t }, ...p.updates].slice(0, UPDATES_KEPT);
    this.persist();
    return `Noted about ${p.name}: ${t}`;
  }

  addInterests(p: Person, text: string): string {
    const add = splitList(text).filter((i) => !p.interests.some((x) => x.toLowerCase() === i.toLowerCase()));
    if (!add.length) return `${p.name}'s interests already include that.`;
    p.interests = [...p.interests, ...add].slice(0, 30);
    this.persist();
    return `${p.name} is into ${p.interests.join(', ')}.`;
  }

  removeUpdate(p: Person, at: string): void {
    p.updates = p.updates.filter((u) => u.at !== at);
    this.persist();
  }

  // ---------- WhatsApp: texting counts ----------

  /** A WhatsApp message to or from someone on the list (a chat Max may see) is a "texted" touch. */
  private noticeWhatsApp(): void {
    if (!this.whatsapp) return;
    let changed = false;
    for (const p of this.state.people) {
      if (!p.phone) continue;
      const last = this.whatsapp.lastContact(p.phone);
      if (!last) continue;
      const at = new Date(last.at).toISOString();
      const known = this.lastTouch(p, 'texted');
      if (known && known.at >= at) continue;
      p.touches = [{ at, kind: 'texted' as const, auto: true, note: last.mine ? 'you wrote' : 'they wrote' }, ...p.touches].slice(0, TOUCHES_KEPT);
      changed = true;
    }
    if (changed) this.persist();
  }

  // ---------- Max ----------

  /** What Max knows at the start of a conversation (personal mode): the list, who's overdue, birthdays. */
  promptSection(): string {
    const people = this.people;
    if (!people.length) return '';
    const line = (p: Person) => {
      const days = this.daysSince(p);
      const over = this.overdueDays(p);
      return `- ${p.name} [${CIRCLES[p.circle].label.toLowerCase()}${p.relation ? `, ${p.relation}` : ''}]: ${days === undefined ? 'never in touch yet' : `last in touch ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} (${TOUCHES[this.lastTouch(p)!.kind].toLowerCase()})`}${over > 0 ? `, OVERDUE by ${over} days` : ''}${p.interests.length ? `; into ${p.interests.slice(0, 5).join(', ')}` : ''}${p.updates[0] ? `; latest: ${p.updates[0].text}` : ''}`;
    };
    const bdays = this.birthdaysSoon(14).map((b) => `${b.person.name}'s birthday ${b.inDays === 0 ? 'is today' : b.inDays === 1 ? 'is tomorrow' : `in ${b.inDays} days`}`);
    return [
      'People close to the user (use the people action to log contact, news or interests; when they say they spoke to, called, texted or met someone on this list, log it; when they share news about them, note it). Gently suggest catching up with anyone overdue when it fits.',
      ...people.slice(0, 25).map(line),
      bdays.length ? `Birthdays: ${bdays.join('; ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** A line for the daily briefing and the control panel: who to catch up with. */
  dayLine(): string {
    if (!this.open) return '';
    const due = this.dueForCatchUp().slice(0, 4);
    const bdays = this.birthdaysSoon(7);
    const parts = [
      due.length ? `Worth catching up with: ${due.map((p) => `${p.name} (${this.daysSince(p) === undefined ? 'not yet' : `${this.daysSince(p)} days`})`).join(', ')}.` : '',
      bdays.length ? `Birthdays: ${bdays.map((b) => `${b.person.name} ${b.inDays === 0 ? 'today' : b.inDays === 1 ? 'tomorrow' : `in ${b.inDays} days`}`).join(', ')}.` : '',
    ].filter(Boolean);
    return parts.join(' ');
  }

  private nextHint(p: Person): string {
    const bday = this.birthdaysSoon(7).find((b) => b.person.id === p.id);
    return bday ? ` (${p.name}'s birthday is ${bday.inDays === 0 ? 'today' : bday.inDays === 1 ? 'tomorrow' : `in ${bday.inDays} days`}.)` : '';
  }

  get tools(): ChatCompletionTool[] {
    if (!this.open) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'people',
          description:
            'The people close to the user and keeping in touch with them. log: the user spoke to, called, texted, met or ' +
            'emailed someone ("I called Mum", "had lunch with Marco"), with any news they share (how they are). news: ' +
            'something about a person without a contact ("Marco got a new job"). interests: what they are into. who: ' +
            'everything about one person (before suggesting a gift, a topic, a catch-up). catch_up: who it has been too long ' +
            'with, and birthdays coming. add: a new person (name, circle: family, close friend, friend, colleague, acquaintance; ' +
            'relation such as "my sister"). update: change circle, relation, how often to keep in touch (every_days), phone, email, birthday. remove. ' +
            'later: stop reminding about someone for a few days ("remind me about Marco next week": days).',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['log', 'news', 'interests', 'who', 'catch_up', 'add', 'update', 'remove', 'later'] },
              days: { type: 'integer', description: 'For later: how many days (default: the setting)' },
              name: { type: 'string', description: 'Who (name or relation, e.g. "Mum")' },
              kind: { type: 'string', enum: ['spoke', 'called', 'texted', 'met', 'emailed'], description: 'For log: how' },
              date: { type: 'string', description: 'For log: YYYY-MM-DD if not today' },
              text: { type: 'string', description: 'For log/news: how they are, what is going on. For interests: comma-separated' },
              circle: { type: 'string', enum: ['family', 'close', 'friend', 'colleague', 'acquaintance'] },
              relation: { type: 'string' },
              every_days: { type: 'integer', description: 'Keep in touch at least every N days' },
              phone: { type: 'string' },
              email: { type: 'string' },
              birthday: { type: 'string', description: 'YYYY-MM-DD or MM-DD' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return name === 'people' && this.open;
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const action = str(a.action) ?? 'catch_up';
    if (action === 'catch_up') {
      const due = this.dueForCatchUp();
      const bdays = this.birthdaysSoon(14);
      if (!due.length && !bdays.length) return `Nobody is overdue: you're in touch with everyone on the list (${this.people.length}).`;
      return [
        due.length ? `Worth catching up with:\n${due.map((p) => `- ${p.name} (${CIRCLES[p.circle].label.toLowerCase()}): ${this.daysSince(p) === undefined ? 'not in touch yet' : `${this.daysSince(p)} days since you ${TOUCHES[this.lastTouch(p)!.kind].toLowerCase()}`}, you'd like every ${this.every(p)}${p.updates[0] ? `; latest: ${p.updates[0].text}` : ''}`).join('\n')}` : '',
        bdays.length ? `Birthdays: ${bdays.map((b) => `${b.person.name} ${b.inDays === 0 ? 'today' : b.inDays === 1 ? 'tomorrow' : `in ${b.inDays} days`}`).join(', ')}.` : '',
      ].filter(Boolean).join('\n');
    }
    if (action === 'add') {
      const msg = this.save({ name: str(a.name), circle: str(a.circle) ?? 'friend', relation: str(a.relation), every: typeof a.every_days === 'number' ? a.every_days : undefined, phone: str(a.phone), email: str(a.email), birthday: str(a.birthday), interests: str(a.text) });
      return msg;
    }
    const who = str(a.name);
    if (!who) return 'Who?';
    const found = this.find(who);
    if (!found.length) return `${who} isn't on the list. Ask if they should be added (people add), with their circle (family, close friend, friend…).`;
    if (found.length > 1) return `Several people match "${who}": ${found.map((p) => p.name).join(', ')}. Ask which.`;
    const p = found[0];
    switch (action) {
      case 'log':
        return this.touch(p, str(a.kind) ?? 'spoke', str(a.text), str(a.date));
      case 'news':
        return this.addUpdate(p, str(a.text) ?? '');
      case 'interests':
        return this.addInterests(p, str(a.text) ?? '');
      case 'who':
        return this.describe(p);
      case 'update':
        return this.save({ circle: str(a.circle), relation: str(a.relation), every: typeof a.every_days === 'number' ? a.every_days : undefined, phone: str(a.phone), email: str(a.email), birthday: str(a.birthday) }, p.id);
      case 'remove':
        return this.remove(p.id);
      case 'later':
        return this.snooze(p, typeof a.days === 'number' && a.days > 0 ? Math.min(30, a.days) : undefined);
      default:
        return `Unknown action "${action}".`;
    }
  }

  describe(p: Person): string {
    const days = this.daysSince(p);
    const recent = p.touches.slice(0, 5).map((t) => `${t.at.slice(0, 10)}: ${TOUCHES[t.kind].toLowerCase()}${t.note ? ` (${t.note})` : ''}`);
    return [
      `${p.name}: ${CIRCLES[p.circle].label.toLowerCase()}${p.relation ? `, ${p.relation}` : ''}. Keep in touch every ${this.every(p)} days; ${days === undefined ? 'not in touch yet' : `last in touch ${days} day${days === 1 ? '' : 's'} ago`}${this.overdueDays(p) > 0 ? ` (overdue by ${this.overdueDays(p)})` : ''}.`,
      p.birthday ? `Birthday: ${p.birthday}.` : '',
      p.interests.length ? `Into: ${p.interests.join(', ')}.` : '',
      p.updates.length ? `How they are (newest first):\n${p.updates.slice(0, 5).map((u) => `- ${u.at.slice(0, 10)}: ${u.text}`).join('\n')}` : '',
      recent.length ? `Recent contact:\n${recent.map((r) => `- ${r}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private persist(): void {
    this.store?.save(this.state).catch((err) => this.log.error(`Could not save the people: ${(err as Error).message}`));
  }
}

export function circleOf(s: string): Circle | undefined {
  const t = s.toLowerCase().trim();
  if (t in CIRCLES) return t as Circle;
  if (/famil|relativ|parent|mum|mom|dad|sister|brother|wife|husband|partner|son|daughter|cousin|aunt|uncle|grand/.test(t)) return 'family';
  if (/close|best/.test(t)) return 'close';
  if (/colleag|work|boss|client/.test(t)) return 'colleague';
  if (/acquaint|neighbou?r|contact/.test(t)) return 'acquaintance';
  if (/friend|mate|pal/.test(t)) return 'friend';
  return undefined;
}

export function touchOf(s: string): TouchKind | undefined {
  const t = s.toLowerCase().trim();
  if (t in TOUCHES) return t as TouchKind;
  if (/call|phone|rang|ring/.test(t)) return 'called';
  if (/text|messag|whatsapp|chat/.test(t)) return 'texted';
  if (/met|meet|saw|see|lunch|dinner|coffee|visit|drink/.test(t)) return 'met';
  if (/mail/.test(t)) return 'emailed';
  if (/spoke|speak|talk/.test(t)) return 'spoke';
  return undefined;
}

function splitList(s: string): string[] {
  return [...new Set(s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 40)))];
}
