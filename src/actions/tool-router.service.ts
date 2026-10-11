import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { BuiltinActionsService } from './builtin-actions.service';

/**
 * Every action Max can take, in one place: built-in actions (time, timers) plus whatever
 * Home Assistant exposes. Used by both voice modes (text pipeline and OpenAI Realtime).
 */
@Injectable()
export class ToolRouterService {
  private readonly log = new Logger(ToolRouterService.name);

  constructor(
    private readonly ha: HaMcpService,
    private readonly builtin: BuiltinActionsService,
  ) {}

  /** Tool definitions in Chat Completions format. */
  get tools(): ChatCompletionTool[] {
    return [...this.builtin.tools, ...this.ha.openAiTools];
  }

  get homeAssistantConnected(): boolean {
    return this.ha.openAiTools.length > 0;
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    this.log.log(`tool ${name} ${JSON.stringify(args)}`);
    try {
      return this.builtin.has(name) ? this.builtin.call(name, args) : await this.ha.call(name, args);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }
}
