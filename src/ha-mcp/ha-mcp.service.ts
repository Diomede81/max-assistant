import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';

/**
 * Connects to Home Assistant's built-in "Model Context Protocol Server" integration
 * (`/api/mcp`, Streamable HTTP, long-lived access token). The tools it exposes
 * (HassTurnOn, HassLightSet, GetLiveContext, ...) are handed to the LLM as-is.
 * Only entities you expose to Assist in Home Assistant are reachable.
 */
@Injectable()
export class HaMcpService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(HaMcpService.name);
  private client?: Client;
  private tools: ChatCompletionTool[] = [];

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.ha.token) {
      this.log.warn('HA_TOKEN not set: Home Assistant tools disabled');
      return;
    }
    const transport = new StreamableHTTPClientTransport(new URL(this.cfg.ha.mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${this.cfg.ha.token}` } },
    });
    this.client = new Client({ name: 'jarvis-home', version: '0.1.0' });
    await this.client.connect(transport);
    await this.refreshTools();
  }

  /** Re-read the tool list, e.g. after exposing new entities in Home Assistant. */
  async refreshTools(): Promise<void> {
    if (!this.client) return;
    const { tools } = await this.client.listTools();
    this.tools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));
    this.log.log(`Loaded ${this.tools.length} Home Assistant tools: ${tools.map((t) => t.name).join(', ')}`);
  }

  get openAiTools(): ChatCompletionTool[] {
    return this.tools;
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) return 'Home Assistant is not connected.';
    const started = Date.now();
    const result = await this.client.callTool({ name, arguments: args });
    this.log.debug(`${name} took ${Date.now() - started} ms`);
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') || 'ok';
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }
}
