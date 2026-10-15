import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { matchesAny } from '../mcp/glob';
import { Inject } from '@nestjs/common';
import { EXTERNAL_FLAG } from './builtin-actions.service';
import { ModesService } from '../memory/modes.service';
import { APP_CONFIG, AppConfig } from '../config';
import { BuiltinActionsService } from './builtin-actions.service';
import { ScreenToolsService } from './screen-tools.service';
import { LockService } from '../lock/lock.service';
import { MusicService } from '../music/music.service';
import { WebService } from '../web/web.service';
import { RoutinesService } from '../routines/routines.service';
import { UpdatesService } from '../updates/updates.service';
import { ComposioService, SERVER } from '../composio/composio.service';
import { EventEmitter } from 'node:events';
import { Activity, describeActivity } from './activity';

/** Emitted around every action: 'start' and 'end' (for the face and spoken "checking…" cues). */
export interface ActivityEvent extends Activity {
  id: number;
  name: string;
  ok?: boolean;
}

/** Actions that change something outside the house: sending, deleting, accepting... */
const RISKY = /(SEND|REPLY|FORWARD|DELETE|REMOVE|TRASH|ARCHIVE|MOVE|CREATE|UPDATE|ACCEPT|DECLINE|CANCEL|POST|INVITE|SHARE)/i;
const CONFIRM_WINDOW_MS = 3 * 60 * 1000;
const CONFIRM_PARAM = 'confirmed';
/** Facts saved this soon after reading emails/web pages are marked unverified (they may come from that content). */
const EXTERNAL_CONTENT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Every action Max can take, in one place: built-in actions (time, timers), Home
 * Assistant, and extra MCP servers (Composio apps such as Office 365, WhatsApp...).
 * Used by both voice modes.
 *
 * Safety: risky actions on external apps (sending email, deleting, accepting invites…)
 * are never run on the first request. Max must read the details back and get a "yes";
 * the action only runs when the same request comes back with confirmed=true within
 * 3 minutes. Voice is easy to mishear, so this is enforced here, not left to the AI.
 */
@Injectable()
export class ToolRouterService {
  private readonly log = new Logger(ToolRouterService.name);
  private readonly pending = new Map<string, number>();
  private externalContentAt = 0;

  constructor(
    private readonly modes: ModesService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly ha: HaMcpService,
    private readonly builtin: BuiltinActionsService,
    private readonly mcp: McpServersService,
    @Optional() private readonly music?: MusicService,
    @Optional() private readonly composio?: ComposioService,
    @Optional() private readonly web?: WebService,
    @Optional() private readonly routines?: RoutinesService,
    @Optional() private readonly updates?: UpdatesService,
    @Optional() private readonly screenTools?: ScreenToolsService,
    @Optional() private readonly lock?: LockService,
  ) {}

  /** Work apps (WORK_APPS) are only available in work mode. */
  /**
   * Personal and work accounts (two Composio logins): work mode uses the work ones, personal mode
   * the personal ones, guest mode neither (visitors shouldn't reach anyone's email). Until a work
   * account is connected, work mode keeps using the personal ones, as before.
   */
  isHiddenAccountSet(server: string): boolean {
    const mode = this.modes.mode;
    if (server === SERVER.work) return mode !== 'work';
    if (server === SERVER.personal) return mode === 'guest' || (mode === 'work' && Boolean(this.composio?.hasConnected('work')));
    return false;
  }

  /**
   * Work apps (WORK_APPS) are hidden outside work mode, personal apps (PERSONAL_APPS) in work mode.
   * These name rules can't tell two Outlooks apart, so once separate work accounts are connected
   * they no longer apply to the Composio account sets: those are already split by mode (your
   * personal Outlook in personal mode, the work one in work mode).
   */
  isLockedWorkApp(name: string, server?: string): boolean {
    if (server && (server === SERVER.personal || server === SERVER.work) && this.composio?.hasConnected('work')) return false;
    const n = name.toUpperCase();
    const mode = this.modes.mode;
    return (mode !== 'work' && matchesAny(n, this.cfg.memory.workApps)) || (mode === 'work' && matchesAny(n, this.cfg.memory.personalApps));
  }

  onModuleInit(): void {
    this.mcp.hide = (name, server) => this.isLockedWorkApp(name, server);
    this.mcp.serverHidden = (server) => this.isHiddenAccountSet(server);
  }

  /** Tool definitions in Chat Completions format. */
  get tools(): ChatCompletionTool[] {
    const external = this.mcp.tools.map((t) => (t.type === 'function' && this.needsConfirmation(t.function.name) ? withConfirmParam(t) : t));
    return [...this.builtin.tools, ...(this.web?.tools ?? []), ...(this.routines?.tools ?? []), ...(this.updates?.tools ?? []), ...(this.screenTools?.tools ?? []), ...(this.music?.tools ?? []), ...this.ha.openAiTools, ...external];
  }

  get homeAssistantConnected(): boolean {
    return this.ha.openAiTools.length > 0;
  }

  needsConfirmation(name: string): boolean {
    const server = this.mcp.serverFor(name);
    if (!server) return false; // built-in and Home Assistant actions run straight away
    return RISKY.test(name) || matchesAny(name, server.config.confirmTools);
  }

  /** 'start' / 'end' (ActivityEvent) around every action that isn't instant. */
  readonly activity = new EventEmitter();
  private activityId = 0;

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    // Belt and braces: nothing runs while the start-up code hasn't been entered.
    if (this.lock?.locked) return 'Not done: Max is locked. The start-up code has to be entered on his screen first.';
    const what = describeActivity(name);
    if (!what) return this.run(name, args);
    const ev: ActivityEvent = { id: ++this.activityId, name, ...what };
    this.activity.emit('start', ev);
    const out = await this.run(name, args);
    this.activity.emit('end', { ...ev, ok: !/^Error:|^Could not do that/.test(out) });
    this.activity.emit('result', { name, out });
    return out;
  }

  private async run(name: string, args: Record<string, unknown>): Promise<string> {
    this.log.log(`tool ${name} ${JSON.stringify(args)}`);
    if (name === 'remember' && Date.now() - this.externalContentAt < EXTERNAL_CONTENT_WINDOW_MS) {
      args = { ...args, [EXTERNAL_FLAG]: true };
    }
    try {
      if (this.builtin.has(name)) return this.builtin.call(name, args);
      if (this.web?.has(name)) {
        this.externalContentAt = Date.now(); // facts from web pages are marked unverified
        return await this.web.call(name, args);
      }
      if (this.routines?.has(name)) {
        if (name === 'news_briefing') this.externalContentAt = Date.now(); // summaries of web pages
        return await this.routines.call(name, args);
      }
      if (this.updates?.has(name)) return await this.updates.call(name, args);
      if (this.screenTools?.has(name)) return await this.screenTools.call(name, args);
      if (this.music?.has(name)) return await this.music.call(name, args);
      const server = this.mcp.serverFor(name);
      if (!server) return await this.ha.call(name, args);
      if (this.isLockedWorkApp(name, server.config.name)) {
        return this.modes.mode === 'work'
          ? 'Personal apps are locked in work mode. The user can say "personal mode" to unlock them.'
          : 'Work apps are locked outside work mode. The user can say "work mode" to unlock them.';
      }
      this.externalContentAt = Date.now();

      if (this.needsConfirmation(name)) {
        const { [CONFIRM_PARAM]: confirmed, ...rest } = args;
        const key = `${name}:${stableJson(rest)}`;
        const askedAt = this.pending.get(key);
        if (confirmed !== true || !askedAt || Date.now() - askedAt > CONFIRM_WINDOW_MS) {
          this.pending.set(key, Date.now());
          this.log.log(`${name} needs a spoken confirmation first`);
          return (
            'NOT DONE YET - this action needs the user\'s confirmation. Read the key details back in one short ' +
            'sentence (who/what/when) and ask "Shall I go ahead?". Only if the user clearly says yes, call ' +
            `${name} again with exactly the same arguments plus "${CONFIRM_PARAM}": true. If they say no, drop it.`
          );
        }
        this.pending.delete(key);
        return await server.call(name, rest);
      }
      return await server.call(name, args);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }
}

function withConfirmParam(t: ChatCompletionTool): ChatCompletionTool {
  if (t.type !== 'function') return t;
  const params = (t.function.parameters ?? { type: 'object', properties: {} }) as {
    properties?: Record<string, unknown>;
  };
  return {
    ...t,
    function: {
      ...t.function,
      description: `${t.function.description ?? ''} (Needs the user's spoken confirmation: see "${CONFIRM_PARAM}".)`.trim(),
      parameters: {
        ...params,
        properties: {
          ...(params.properties ?? {}),
          [CONFIRM_PARAM]: {
            type: 'boolean',
            description: 'Set to true ONLY after reading the details back to the user and hearing them say yes.',
          },
        },
      },
    },
  };
}

/** JSON with sorted keys, so the same request always produces the same key. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
