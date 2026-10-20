import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { AboutService } from '../about/about.service';
import { MemoryService } from '../memory/memory.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';
import { RecallBot, RecallClient, TranscriptLine } from './recall.client';

export type MeetingState = 'joining' | 'lobby' | 'in-call' | 'recording' | 'ended' | 'ready' | 'failed';

export interface Meeting {
  id: string;
  /** Recall.ai's bot for this meeting. */
  botId: string;
  url: string;
  platform: 'Teams' | 'Zoom' | 'Google Meet';
  title: string;
  /** When you sent Max. */
  at: string;
  state: MeetingState;
  /** What's happening, in plain words ("Waiting in the lobby: let Max in"). */
  status: string;
  startedAt?: string;
  endedAt?: string;
  transcript?: TranscriptLine[];
}

/** Recall.ai's bot statuses, as Max says them. */
const STATUS: Record<string, [MeetingState, string]> = {
  ready: ['joining', 'Getting ready to join'],
  joining_call: ['joining', 'Joining the meeting'],
  in_waiting_room: ['lobby', 'Waiting in the lobby: let Max in'],
  in_call_not_recording: ['in-call', 'In the meeting, not taking notes yet'],
  recording_permission_allowed: ['in-call', 'Allowed to take notes'],
  recording_permission_denied: ['in-call', "The host didn't allow notes to be taken"],
  in_call_recording: ['recording', 'Taking notes'],
  call_ended: ['ended', 'The meeting has ended: preparing the transcript'],
  recording_done: ['ended', 'Preparing the transcript'],
  done: ['ended', 'Preparing the transcript'],
  analysis_done: ['ended', 'Preparing the transcript'],
  fatal: ['failed', "Couldn't join the meeting"],
  media_expired: ['failed', 'The recording expired at Recall.ai'],
};

/** Why Max couldn't join or left early (Recall.ai's sub codes), in plain words. */
const WHY: Record<string, string> = {
  bot_kicked_from_waiting_room: 'he was turned away from the lobby',
  bot_kicked_from_call: 'he was removed from the meeting',
  timeout_exceeded_waiting_room: 'nobody let him in from the lobby',
  meeting_not_found: 'the meeting link was not found',
  meeting_not_started: "the meeting hadn't started",
  meeting_requires_sign_in: 'the meeting only lets signed-in people join',
  meeting_link_expired: 'the meeting link has expired',
  meeting_password_incorrect: 'the meeting password is wrong',
  call_ended_by_host: 'the host ended the meeting',
  call_ended_by_platform_idle: 'the meeting was idle',
  timeout_exceeded_everyone_left: 'everyone else left',
};

const ACTIVE: MeetingState[] = ['joining', 'lobby', 'in-call', 'recording', 'ended'];
/** How often Max checks on a meeting while it's on (Recall.ai is asked; nothing is sent to the box). */
const POLL_MS = 20_000;
/** A meeting still not finished after this long is given up on (Recall.ai stops long before). */
const GIVE_UP_MS = 8 * 3_600_000;

/**
 * Meetings: Max joins your online meetings (Teams, Zoom, Google Meet) as a notetaker through Recall.ai, and brings
 * back the transcript of who said what. Kept encrypted next to his memory. Joining is always asked for (control
 * panel, or by voice later): Max never joins because an email or message said so.
 */
@Injectable()
export class MeetingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Meetings');
  private readonly recall: RecallClient;
  private store?: SealedStore<Meeting[]>;
  private meetings: Meeting[] = [];
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    // Injected so the memory key exists before the meetings are opened.
    @Optional() private readonly memory?: MemoryService,
    @Optional() private readonly about?: AboutService,
  ) {
    this.recall = new RecallClient(cfg.meetings.recallKey, cfg.meetings.recallRegion, cfg.meetings.recallBaseUrl);
  }

  get enabled(): boolean {
    return Boolean(this.cfg.meetings.recallKey);
  }

  onModuleInit(): void {
    this.store = new SealedStore(this.cfg.memory.dir, 'meetings', memorySecret(this.cfg));
    try {
      this.meetings = (this.store.load() ?? []).filter((m) => m && m.id && m.botId);
    } catch (err) {
      this.log.error(`Could not read the meetings (${(err as Error).message})`);
    }
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref();
    void this.poll();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Newest first. */
  list(): Meeting[] {
    return [...this.meetings].sort((a, b) => b.at.localeCompare(a.at));
  }

  get(id: string): Meeting | undefined {
    return this.meetings.find((m) => m.id === id);
  }

  /** Checks the Recall.ai key (and finds the account's region). */
  async check(): Promise<string> {
    return `Connected to Recall.ai (${await this.recall.check()}).`;
  }

  /** Sends Max to a meeting. Returns what to tell the user. */
  async join(link: string, title = ''): Promise<{ ok: boolean; message: string; meeting?: Meeting }> {
    if (!this.enabled) return { ok: false, message: 'Meetings need a Recall.ai key: set RECALL_API_KEY in .env.' };
    const platform = platformOf(link);
    if (!platform) return { ok: false, message: 'That isn\'t a Teams, Zoom or Google Meet meeting link.' };
    if (this.meetings.some((m) => m.url === link.trim() && ACTIVE.includes(m.state) && m.state !== 'ended')) {
      return { ok: false, message: 'Max is already in that meeting.' };
    }
    const who = this.about?.about.name?.trim().split(/\s+/)[0];
    const name = this.cfg.meetings.botName || (who ? `Max (${who}'s notetaker)` : 'Max (notetaker)');
    const chat = `Hi, I'm Max, ${who ? `${who}'s` : 'an'} AI notetaker. I'm transcribing this meeting so ${who ?? 'my owner'} gets the notes.`;
    let bot: RecallBot;
    try {
      bot = await this.recall.createBot(link.trim(), name, chat);
    } catch (err) {
      return { ok: false, message: `Couldn't send Max: ${(err as Error).message}` };
    }
    const m: Meeting = {
      id: randomUUID(),
      botId: bot.id,
      url: link.trim(),
      platform,
      title: title.trim().slice(0, 120) || `${platform} meeting`,
      at: new Date().toISOString(),
      state: 'joining',
      status: 'Joining the meeting',
    };
    this.apply(m, bot);
    this.meetings.push(m);
    this.persist();
    this.log.log(`Joining a ${platform} meeting (${m.title})`);
    return { ok: true, message: `Max is joining the ${platform} meeting. If there's a lobby, let him in.`, meeting: m };
  }

  async leave(id: string): Promise<string> {
    const m = this.get(id);
    if (!m) return 'Meeting not found.';
    if (!['joining', 'lobby', 'in-call', 'recording'].includes(m.state)) return "Max isn't in that meeting.";
    try {
      await this.recall.leave(m.botId);
    } catch (err) {
      return `Couldn't make Max leave: ${(err as Error).message}`;
    }
    m.status = 'Leaving the meeting';
    this.persist();
    void this.poll();
    return 'Max is leaving the meeting. The transcript follows in a few minutes.';
  }

  /** Forgets a meeting and its transcript (here; Recall.ai deletes its copy on its own schedule). */
  remove(id: string): boolean {
    const before = this.meetings.length;
    this.meetings = this.meetings.filter((m) => m.id !== id);
    if (this.meetings.length === before) return false;
    this.persist();
    return true;
  }

  rename(id: string, title: string): boolean {
    const m = this.get(id);
    if (!m || !title.trim()) return false;
    m.title = title.trim().slice(0, 120);
    this.persist();
    return true;
  }

  /** Meeting time this month, for the cost shown on the page. */
  monthMinutes(): number {
    const month = new Date().toISOString().slice(0, 7);
    return Math.round(
      this.meetings
        .filter((m) => m.at.startsWith(month) && m.startedAt)
        .reduce((sum, m) => sum + (Date.parse(m.endedAt ?? new Date().toISOString()) - Date.parse(m.startedAt!)) / 60_000, 0),
    );
  }

  /** Checks on every meeting that's on: its status, and the transcript once it's ready. */
  async poll(): Promise<void> {
    if (this.polling || !this.enabled) return;
    this.polling = true;
    try {
      let changed = false;
      for (const m of this.meetings.filter((x) => ACTIVE.includes(x.state))) {
        if (Date.now() - Date.parse(m.at) > GIVE_UP_MS) {
          Object.assign(m, { state: 'failed', status: 'No transcript came back from Recall.ai' });
          changed = true;
          continue;
        }
        try {
          const bot = await this.recall.getBot(m.botId);
          const before = `${m.state}|${m.status}`;
          this.apply(m, bot);
          if (bot.transcriptUrl && (bot.code === 'done' || bot.code === 'analysis_done' || bot.code === 'recording_done' || bot.code === 'call_ended')) {
            const lines = await this.recall.transcript(bot.transcriptUrl);
            // Recall.ai can offer the link a moment before the transcript is complete: wait for "done".
            if (lines.length || bot.code === 'done' || bot.code === 'analysis_done') {
              m.transcript = lines;
              m.state = 'ready';
              m.status = lines.length ? 'Transcript ready' : 'Nobody spoke: the transcript is empty';
              this.log.log(`Transcript ready: ${m.title} (${lines.length} turns)`);
            }
          }
          // Finished but no transcript (e.g. nobody let Max in): say so instead of waiting.
          if (m.state === 'ended' && !bot.transcriptUrl && bot.code === 'done' && Date.now() - Date.parse(m.endedAt ?? m.at) > 15 * 60_000) {
            m.state = 'failed';
            m.status = 'Recall.ai finished without a transcript' + why(bot.subCode);
          }
          if (`${m.state}|${m.status}` !== before || m.state === 'ready') changed = true;
        } catch (err) {
          this.log.warn(`Couldn't check on "${m.title}": ${(err as Error).message}`);
        }
      }
      if (changed) this.persist();
    } finally {
      this.polling = false;
    }
  }

  private apply(m: Meeting, bot: RecallBot): void {
    const [state, status] = STATUS[bot.code] ?? ['joining', bot.code.replace(/_/g, ' ')];
    m.state = state;
    m.status = status + (state === 'failed' || bot.code === 'call_ended' ? why(bot.subCode) : '');
    if (bot.startedAt) m.startedAt = bot.startedAt;
    if (bot.endedAt) m.endedAt = bot.endedAt;
  }

  private persist(): void {
    this.store?.save(this.meetings).catch((err) => this.log.error(`Could not save the meetings: ${(err as Error).message}`));
  }
}

function why(sub?: string): string {
  if (!sub) return '';
  const w = WHY[sub];
  return w ? ` (${w})` : '';
}

/** Teams, Zoom or Google Meet, from a meeting link; nothing for any other address. */
export function platformOf(link: string): Meeting['platform'] | undefined {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:') return undefined;
  const h = u.hostname.toLowerCase();
  if (h === 'teams.microsoft.com' || h === 'teams.live.com' || h === 'teams.microsoft.us' || h === 'gov.teams.microsoft.us') return 'Teams';
  if (h === 'zoom.us' || h.endsWith('.zoom.us') || h === 'zoomgov.com' || h.endsWith('.zoomgov.com')) return 'Zoom';
  if (h === 'meet.google.com') return 'Google Meet';
  return undefined;
}
