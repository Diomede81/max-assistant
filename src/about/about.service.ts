import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { MemoryService } from '../memory/memory.service';
import type { Mode } from '../memory/modes.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';

export type AboutKey =
  | 'name'
  | 'callMe'
  | 'birthday'
  | 'origin'
  | 'languages'
  | 'home'
  | 'family'
  | 'people'
  | 'work'
  | 'education'
  | 'likes'
  | 'avoid'
  | 'health'
  | 'notes';

export interface AboutField {
  key: AboutKey;
  label: string;
  /** How Max is told it ("Lives with: …"); none: not listed (what to call them is said separately). */
  ai?: string;
  /** Example shown in the empty box. */
  hint: string;
  /** One line, a date, or a few lines of text. */
  kind: 'line' | 'date' | 'text';
  max: number;
  /** The modes in which Max is told it (guest mode: only the name). */
  modes: Mode[];
}

const ALL: Mode[] = ['personal', 'work', 'guest'];
const PW: Mode[] = ['personal', 'work'];
const P: Mode[] = ['personal'];

export const ABOUT_FIELDS: AboutField[] = [
  { key: 'name', ai: 'Name', label: 'Your name', hint: 'e.g. Luca Licata', kind: 'line', max: 80, modes: ALL },
  { key: 'callMe', label: 'What Max calls you', hint: 'e.g. Luca (empty: your first name)', kind: 'line', max: 40, modes: PW },
  { key: 'birthday', ai: 'Birthday', label: 'Birthday', hint: '', kind: 'date', max: 10, modes: P },
  { key: 'origin', ai: 'Where they are from', label: 'Where you were born and grew up', hint: 'e.g. born in Palermo, grew up in Milan, in London since 2010', kind: 'text', max: 300, modes: PW },
  { key: 'languages', ai: 'Languages', label: 'Languages you speak', hint: 'e.g. Italian and English', kind: 'line', max: 120, modes: PW },
  { key: 'home', ai: 'Lives with', label: 'Who you live with', hint: 'e.g. my partner Anna, our daughter Sofia (7) and Milo the cat', kind: 'text', max: 400, modes: P },
  { key: 'family', ai: 'Family', label: 'Family', hint: 'e.g. my parents Rosa and Pino live in Palermo; my sister Chiara (35) is in Rome', kind: 'text', max: 500, modes: P },
  { key: 'people', ai: 'Important people', label: 'Important people', hint: 'e.g. Marco, my business partner at Acme; Giulia, my best friend since school', kind: 'text', max: 600, modes: PW },
  { key: 'work', ai: 'Work', label: 'Your work', hint: 'e.g. product manager at Acme, mostly from home on Mondays and Fridays', kind: 'text', max: 400, modes: PW },
  { key: 'education', ai: 'Schools and studies', label: 'Schools and studies', hint: 'e.g. Liceo Scientifico in Palermo; Economics at Bocconi, Milan (2003)', kind: 'text', max: 400, modes: PW },
  { key: 'likes', ai: 'Likes and interests', label: 'Likes and interests', hint: 'e.g. Juventus, cooking, sci-fi films, cycling at weekends', kind: 'text', max: 500, modes: P },
  { key: 'avoid', ai: 'Avoid', label: 'What Max should avoid', hint: "e.g. don't call me mate; no spoilers", kind: 'text', max: 400, modes: PW },
  { key: 'health', ai: 'Health and food', label: 'Health and food', hint: 'e.g. vegetarian, allergic to nuts', kind: 'text', max: 300, modes: P },
  { key: 'notes', ai: 'Other things to know', label: 'Anything else Max should know', hint: 'e.g. I prefer short answers in the morning', kind: 'text', max: 800, modes: P },
];

export type About = Partial<Record<AboutKey, string>>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * About you: the person Max supports, in their own words (control panel → About you, or by telling Max).
 * Kept encrypted next to the memory. Max is told it at the start of every conversation, each mode seeing only
 * its part: work mode doesn't get your family or health, guest mode only gets your name.
 */
@Injectable()
export class AboutService implements OnModuleInit {
  private readonly log = new Logger('About you');
  private saved: About = {};
  private store?: SealedStore<About>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    // Injected so the memory key exists before this is opened.
    @Optional() private readonly memory?: MemoryService,
  ) {}

  onModuleInit(): void {
    this.store = new SealedStore(this.cfg.memory.dir, 'about-you', memorySecret(this.cfg));
    try {
      this.saved = this.store.load() ?? {};
    } catch (err) {
      this.log.warn(`Could not read "About you" (${(err as Error).message})`);
    }
    this.log.log(this.saved.name ? `Supporting ${this.saved.name}` : 'No name yet: add it on the control panel (About you), or tell Max');
  }

  get about(): About {
    return { ...this.saved };
  }

  /** Saves the fields given (an empty value clears that field). Returns what to tell the user. */
  async save(values: About): Promise<string> {
    const next: About = { ...this.saved };
    for (const f of ABOUT_FIELDS) {
      if (!(f.key in values)) continue;
      const v = clean(values[f.key] ?? '', f);
      if (v === undefined) return f.kind === 'date' ? 'The birthday should be a date, e.g. 1981-03-14.' : `Check "${f.label}".`;
      if (v) next[f.key] = v;
      else delete next[f.key];
    }
    this.saved = next;
    await this.store?.save(this.saved);
    this.log.log('About you updated');
    return 'Saved. Max uses it from the next conversation.';
  }

  /** For the start of each conversation: only what this mode may see. */
  promptBlock(mode: Mode): string {
    const s = this.saved;
    if (mode === 'guest') {
      return s.name
        ? `The person you support is ${s.name}. Guest mode is on, so you may be talking with visitors: don't share anything personal about ${first(s.name)}.`
        : '';
    }
    const lines: string[] = [];
    for (const f of ABOUT_FIELDS) {
      const v = s[f.key];
      if (!v || !f.ai || !f.modes.includes(mode)) continue;
      lines.push(`- ${f.ai}: ${f.key === 'birthday' ? spokenDate(v) : v}`);
    }
    const call = s.callMe || (s.name ? first(s.name) : '');
    if (!lines.length && !call) {
      return 'You don\'t know the name of the person you support yet. Early in a relaxed moment, ask what they\'d like to be called, then save it with the about_you action.';
    }
    return (
      `About the person you support, in their own words (use it naturally; don't recite it). ` +
      `It's theirs to share with you in this mode, so answer from it freely when they ask, work details and the people listed ` +
      `included: the rules about locked vaults and modes are about your stored memories, not this page. ` +
      `${call ? `Call them ${call}. ` : ''}When they tell you something new about themselves that belongs here (their name, ` +
      `birthday, where they're from, family, the important people in their life, work, studies, likes, what to avoid, ` +
      `health or food), save it with the about_you action.\n${lines.join('\n')}`
    );
  }
}

function clean(raw: string, f: AboutField): string | undefined {
  const v = (f.kind === 'text' ? raw.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : raw.replace(/\s+/g, ' ')).trim().slice(0, f.max);
  if (f.kind === 'date' && v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return undefined;
  }
  return v;
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0];
}

/** "1981-03-14" → "14 March 1981". */
function spokenDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`.trim();
}
