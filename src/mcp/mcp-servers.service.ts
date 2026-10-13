import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { McpConnection, McpServerConfig } from './mcp-connection';

/** Where extra MCP servers are listed (same idea as Claude Desktop's config). */
export const MCP_CONFIG_PATH = process.env.MCP_CONFIG ?? 'config/mcp-servers.json';

interface ConfigFile {
  mcpServers?: Record<string, Omit<McpServerConfig, 'name'> & { enabled?: boolean }>;
}

/**
 * Extra MCP servers beyond Home Assistant: from config/mcp-servers.json, plus servers
 * registered at runtime (e.g. the Composio session for Office 365 / WhatsApp).
 */
@Injectable()
export class McpServersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MCP');
  private readonly servers = new Map<string, McpConnection>();

  async onModuleInit(): Promise<void> {
    for (const cfg of this.readConfigFile()) void this.register(cfg);
  }

  private readConfigFile(): McpServerConfig[] {
    if (!existsSync(MCP_CONFIG_PATH)) return [];
    try {
      const raw = readFileSync(MCP_CONFIG_PATH, 'utf8').replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] ?? '');
      const file = JSON.parse(raw) as ConfigFile;
      return Object.entries(file.mcpServers ?? {})
        .filter(([, c]) => c.enabled !== false && c.url)
        .map(([name, c]) => ({ name, ...c }));
    } catch (err) {
      this.log.error(`Could not read ${MCP_CONFIG_PATH}: ${(err as Error).message}`);
      return [];
    }
  }

  /** Adds (or replaces) a server and connects to it. */
  async register(cfg: McpServerConfig): Promise<McpConnection> {
    await this.servers.get(cfg.name)?.close();
    const conn = new McpConnection(cfg);
    this.servers.set(cfg.name, conn);
    await conn.connect();
    return conn;
  }

  get list(): McpConnection[] {
    return [...this.servers.values()];
  }

  /** Actions to leave out right now (set by the action router, e.g. work apps outside work mode). */
  hide?: (name: string, serverName: string) => boolean;
  /** Whole servers to leave out right now (e.g. the work accounts in personal mode). */
  serverHidden?: (serverName: string) => boolean;

  get tools(): ChatCompletionTool[] {
    const seen = new Set<string>();
    const out: ChatCompletionTool[] = [];
    for (const s of this.servers.values()) {
      if (this.serverHidden?.(s.config.name)) continue;
      for (const t of s.openAiTools) {
        if (t.type !== 'function' || seen.has(t.function.name) || this.hide?.(t.function.name, s.config.name)) continue;
        seen.add(t.function.name);
        out.push(t);
      }
    }
    return out;
  }

  serverFor(toolName: string): McpConnection | undefined {
    return this.list.find((s) => !this.serverHidden?.(s.config.name) && s.has(toolName));
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.list.map((s) => (s.connected ? s.refresh().catch(() => undefined) : s.connect())));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.list.map((s) => s.close()));
  }
}
