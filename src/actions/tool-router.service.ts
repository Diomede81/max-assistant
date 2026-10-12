import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { matchesAny } from '../mcp/glob';
import { BuiltinActionsService } from './builtin-actions.service';
import { MusicService } from '../music/music.service';

/** Actions that change something outside the house: sending, deleting, accepting... */
const RISKY = /(SEND|REPLY|FORWARD|DELETE|REMOVE|TRASH|ARCHIVE|MOVE|CREATE|UPDATE|ACCEPT|DECLINE|CANCEL|POST|INVITE|SHARE)/i;
const CONFIRM_WINDOW_MS = 3 * 60 * 1000;
const CONFIRM_PARAM = 'confirmed';

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

  constructor(
    private readonly ha: HaMcpService,
    private readonly builtin: BuiltinActionsService,
    private readonly mcp: McpServersService,
    @Optional() private readonly music?: MusicService,
  ) {}

  /** Tool definitions in Chat Completions format. */
  get tools(): ChatCompletionTool[] {
    const external = this.mcp.tools.map((t) => (t.type === 'function' && this.needsConfirmation(t.function.name) ? withConfirmParam(t) : t));
    return [...this.builtin.tools, ...(this.music?.tools ?? []), ...this.ha.openAiTools, ...external];
  }

  get homeAssistantConnected(): boolean {
    return this.ha.openAiTools.length > 0;
  }

  needsConfirmation(name: string): boolean {
    const server = this.mcp.serverFor(name);
    if (!server) return false; // built-in and Home Assistant actions run straight away
    return RISKY.test(name) || matchesAny(name, server.config.confirmTools);
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    this.log.log(`tool ${name} ${JSON.stringify(args)}`);
    try {
      if (this.builtin.has(name)) return this.builtin.call(name, args);
      if (this.music?.has(name)) return await this.music.call(name, args);
      const server = this.mcp.serverFor(name);
      if (!server) return await this.ha.call(name, args);

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
