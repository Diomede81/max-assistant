import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { APP_CONFIG, AppConfig } from '../config';

const TOOL_REFRESH_MS = 5 * 60 * 1000;

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
  private refreshTimer?: NodeJS.Timeout;
  private lastError?: string;
  private markFirstAttempt!: () => void;
  /** Resolves once the first connection attempt has finished, successfully or not. */
  private readonly firstAttempt = new Promise<void>((r) => (this.markFirstAttempt = r));

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.ha.token) {
      this.lastError = 'HA_TOKEN is not set in .env';
      this.log.warn('HA_TOKEN not set: Home Assistant tools disabled');
      this.markFirstAttempt();
      return;
    }
    // Don't block start-up on Home Assistant: connect (and reconnect) in the background,
    // and re-read the tools periodically so newly exposed devices appear without a restart.
    void this.connect();
    this.refreshTimer = setInterval(() => void this.refreshOrReconnect(), TOOL_REFRESH_MS);
  }

  private async connect(): Promise<void> {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(this.cfg.ha.mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${this.cfg.ha.token}` } },
      });
      const client = new Client({ name: 'max-assistant', version: '0.1.0' });
      await client.connect(transport);
      this.client = client;
      await this.refreshTools();
      this.lastError = undefined;
    } catch (err) {
      this.client = undefined;
      this.lastError = explainConnectionError(err, this.cfg.ha.mcpUrl);
      this.log.error(`Home Assistant NOT connected: ${this.lastError}. Retrying in 10s`);
      setTimeout(() => void this.connect(), 10_000);
    } finally {
      this.markFirstAttempt();
    }
  }

  /** Waits (up to `timeoutMs`) for the first connection attempt, then reports the outcome. */
  async status(timeoutMs = 10_000): Promise<{ connected: boolean; tools: number; error?: string }> {
    await Promise.race([this.firstAttempt, new Promise((r) => setTimeout(r, timeoutMs))]);
    const connected = Boolean(this.client) && this.tools.length > 0;
    return { connected, tools: this.tools.length, error: connected ? undefined : this.lastError ?? 'still connecting' };
  }

  private async refreshOrReconnect(): Promise<void> {
    if (!this.client) return; // a connect() retry is already scheduled
    try {
      await this.refreshTools();
    } catch {
      this.client = undefined;
      void this.connect();
    }
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
    clearInterval(this.refreshTimer);
    await this.client?.close();
  }
}

/** Turns low-level connection errors into an actionable sentence. */
function explainConnectionError(err: unknown, url: string): string {
  const e = err as { message?: string; code?: number; cause?: { code?: string } };
  const msg = e.message ?? String(err);
  const cause = e.cause?.code ?? '';
  if (e.code === 401 || e.code === 403 || /401|unauthori[sz]ed/i.test(msg)) return 'the token was rejected (401). Create a new long-lived access token and set HA_TOKEN';
  if (e.code === 404 || /404|not found/i.test(msg)) return `nothing at ${url} (404). Add the "Model Context Protocol Server" integration in Home Assistant and check the URL ends in /api/mcp`;
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') return `cannot resolve the address in HA_MCP_URL (${url}). Use the IP address, e.g. http://192.168.1.50:8123/api/mcp`;
  if (cause === 'ECONNREFUSED' || cause === 'EHOSTUNREACH' || cause === 'ETIMEDOUT' || /fetch failed/i.test(msg)) {
    return `cannot reach ${url} (${cause || msg}). Check the IP address and port 8123`;
  }
  return msg;
}
