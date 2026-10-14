import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';
import { SealedStore } from '../memory/sealed-store';
import { local } from '../routines/routines.service';

/** What's installed on the box (written by max-update.py at every start and after updates). */
export interface Version {
  sha: string;
  date: string;
  subject: string;
  repo: string;
  branch: string;
}

/** The box's updater, as it goes (max-update.py writes /run/max/update.json). */
export interface UpdateState {
  state: 'checking' | 'updating' | 'rebooting' | 'done' | 'uptodate' | 'failed';
  message: string;
  at: number;
}

export interface Available {
  /** Number of changes on GitHub that the box doesn't have yet. */
  behind: number;
  /** What they are, in plain words: the titles of the merged changes. */
  changes: string[];
  checkedAt: number;
  error?: string;
}

interface Settings {
  auto: boolean;
  /** Local time for automatic updates, "HH:MM". */
  time: string;
  lastAutoDay?: string;
}

const CHECK_CACHE_MS = 30 * 60_000;
const TICK_MS = 60_000;

/**
 * Updates from GitHub, without the Mac: Max checks GitHub for changes the box doesn't have
 * yet (the control panel lists them), and "Update now", "Max, update yourself" or the nightly
 * automatic update ask the box to install them. Max runs in a container, so he leaves a note
 * (/run/max/update-request); the box's max-update service downloads, sets up and restarts.
 */
@Injectable()
export class UpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Updates');
  private readonly store: SealedStore<Settings>;
  private settings: Settings = { auto: false, time: '03:30' };
  private cached?: Available;
  private timer?: NodeJS.Timeout;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.store = new SealedStore(cfg.memory.dir, 'updates');
  }

  onModuleInit(): void {
    try {
      this.settings = { ...this.settings, ...(this.store.load() ?? {}) };
    } catch {
      // defaults
    }
    if (!this.cfg.face.onBox) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (this.settings.auto) this.log.log(`Automatic updates at ${this.settings.time}`);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  get onBox(): boolean {
    return this.cfg.face.onBox;
  }

  get auto(): { auto: boolean; time: string } {
    return { auto: this.settings.auto, time: this.settings.time };
  }

  version(): Version | undefined {
    return this.readJson<Version>('version.json');
  }

  state(): UpdateState | undefined {
    const s = this.readJson<UpdateState>('update.json');
    // An update that started over an hour ago and never finished: the box restarted meanwhile.
    if (s && (s.state === 'updating' || s.state === 'checking') && Date.now() - s.at > 3600_000) return undefined;
    return s;
  }

  get busy(): boolean {
    const s = this.state()?.state;
    return s === 'checking' || s === 'updating' || s === 'rebooting';
  }

  /** Changes on GitHub the box doesn't have yet (cached for 30 minutes). */
  async check(force = false): Promise<Available | undefined> {
    const v = this.version();
    if (!v?.repo) return undefined;
    if (!force && this.cached && Date.now() - this.cached.checkedAt < CHECK_CACHE_MS) return this.cached;
    try {
      const res = await fetch(`https://api.github.com/repos/${v.repo}/compare/${v.sha}...${encodeURIComponent(v.branch || 'main')}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'max-assistant' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const d = (await res.json()) as { ahead_by: number; commits: { commit: { message: string } }[] };
      const messages = d.commits.map((c) => c.commit.message);
      // Merged pull requests read best ("Calendar: Max now sees every event"); otherwise each change's first line.
      const merges = messages.filter((m) => /^Merge pull request #\d+/.test(m)).map((m) => m.split('\n').filter(Boolean)[1] ?? m.split('\n')[0]);
      const changes = (merges.length ? merges : messages.map((m) => m.split('\n')[0])).reverse().slice(0, 20);
      this.cached = { behind: merges.length || d.ahead_by, changes, checkedAt: Date.now() };
    } catch (err) {
      this.cached = { behind: 0, changes: [], checkedAt: Date.now(), error: `Couldn't check GitHub (${(err as Error).message})` };
    }
    return this.cached;
  }

  /** Asks the box to install the latest version. Returns a message for the user. */
  request(why = 'asked'): string {
    if (!this.onBox) return 'Updates from here only work on the Max box.';
    if (this.busy) return 'An update is already running.';
    try {
      writeFileSync(join(this.cfg.face.runDir, 'update-request'), why);
    } catch (err) {
      return `Couldn't start the update (${(err as Error).message}).`;
    }
    this.cached = undefined;
    this.log.log(`Update requested (${why})`);
    return 'Updating: Max downloads the new version and restarts on his own, in 5 to 15 minutes.';
  }

  setAuto(auto: boolean, time?: string): string {
    if (time !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'The time must be like 03:30.';
      this.settings.time = time;
    }
    this.settings.auto = auto;
    this.store.save(this.settings).catch((err) => this.log.warn(`Could not save the update settings: ${(err as Error).message}`));
    return auto ? `Automatic updates on: Max installs new versions at ${this.settings.time}.` : 'Automatic updates off.';
  }

  /** Nightly automatic update: once a day, at the chosen time, if there's something new. */
  private async tick(): Promise<void> {
    if (!this.settings.auto || this.busy) return;
    const now = local();
    if (now.time < this.settings.time || this.settings.lastAutoDay === now.date) return;
    this.settings.lastAutoDay = now.date;
    this.store.save(this.settings).catch(() => undefined);
    const a = await this.check(true);
    if (a && !a.error && a.behind > 0) this.request('automatic, at night');
  }

  // ---------- For Max ----------

  get tools(): ChatCompletionTool[] {
    if (!this.onBox) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'software_update',
          description:
            'Your own software updates (from GitHub). check: is there a new version, and what\'s new. install: update ' +
            'yourself, ONLY after the user confirmed ("Shall I update now? I\'ll restart for a few minutes"): call with ' +
            'confirmed=true. Also: auto_on / auto_off for automatic updates at night.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['check', 'install', 'auto_on', 'auto_off'] },
              confirmed: { type: 'boolean' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return this.onBox && name === 'software_update';
  }

  async call(_name: string, a: Record<string, unknown>): Promise<string> {
    switch (String(a.action)) {
      case 'install':
        if (a.confirmed !== true) return 'Not started: ask the user to confirm first (you restart for 5 to 15 minutes), then call again with confirmed=true.';
        return `${this.request('asked by voice')} Tell the user, briefly.`;
      case 'auto_on':
        return this.setAuto(true);
      case 'auto_off':
        return this.setAuto(false);
      default: {
        const s = this.state();
        if (s && this.busy) return `An update is running: ${s.message}`;
        const av = await this.check(true);
        if (!av) return 'The installed version is unknown (run the setup once on the box).';
        if (av.error) return av.error;
        if (!av.behind) return 'You are up to date.';
        return `${av.behind} new change${av.behind === 1 ? '' : 's'} on GitHub: ${av.changes.slice(0, 6).join('; ')}. Offer to update now (install).`;
      }
    }
  }

  private readJson<T>(name: string): T | undefined {
    try {
      return JSON.parse(readFileSync(join(this.cfg.face.runDir, name), 'utf8')) as T;
    } catch {
      return undefined;
    }
  }
}
