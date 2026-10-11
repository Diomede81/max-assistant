import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Composio } from '@composio/core';
import { APP_CONFIG, AppConfig } from '../config';
import { McpServersService } from '../mcp/mcp-servers.service';

export interface AppStatus {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
  toolsOffered: number;
}

/**
 * Office 365, WhatsApp and other apps through Composio. Composio holds the logins
 * (OAuth); Max talks to it through one MCP endpoint per session, created with only the
 * apps listed in COMPOSIO_TOOLKITS and with tools exposed directly (no search step),
 * which keeps voice answers fast. Connect apps from the control panel.
 */
@Injectable()
export class ComposioService implements OnModuleInit {
  private readonly log = new Logger('Composio');
  private composio?: Composio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session?: any;
  lastError?: string;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mcp: McpServersService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.cfg.composio.apiKey);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    this.composio = new Composio({ apiKey: this.cfg.composio.apiKey });
    void this.start();
  }

  /** Creates the session and registers its MCP endpoint, offering only connected apps' tools. */
  async start(): Promise<void> {
    if (!this.composio) return;
    const { userId, toolkits } = this.cfg.composio;
    try {
      this.session = await this.composio.sessions.create(userId, {
        toolkits,
        sessionPreset: 'direct_tools',
        manageConnections: false,
        mcp: true,
      } as never);
      this.lastError = undefined;
      await this.registerTools();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log.error(`Could not start a Composio session: ${this.lastError}. Check COMPOSIO_API_KEY`);
    }
  }

  private async registerTools(): Promise<void> {
    const connected = (await this.apps()).filter((a) => a.connected).map((a) => a.slug.toUpperCase());
    // Only offer tools for apps that are actually connected, and only the allowed ones.
    const patterns = this.cfg.composio.allowedTools.filter((p) =>
      connected.some((slug) => p.toUpperCase().startsWith(`${slug}_`) || p === '*'),
    );
    const conn = await this.mcp.register({
      name: 'composio',
      url: this.session.mcp.url,
      headers: this.session.mcp.headers ?? {},
      allowedTools: patterns.length ? patterns : ['__none__'],
    });
    this.log.log(
      connected.length
        ? `Connected apps: ${connected.join(', ')}; ${conn.counts.offered} tools offered`
        : `No apps connected yet - open the control panel (${this.cfg.controlPanel.publicUrl}) to connect them`,
    );
  }

  /** Connection status for every configured app. */
  async apps(): Promise<AppStatus[]> {
    if (!this.session) return [];
    const { items } = await this.session.toolkits({ toolkits: this.cfg.composio.toolkits });
    const tools = this.mcp.list.find((s) => s.config.name === 'composio')?.openAiTools ?? [];
    return (items as Array<{ slug: string; name: string; logo?: string; isNoAuth: boolean; connection?: { isActive: boolean } }>).map(
      (t) => ({
        slug: t.slug,
        name: t.name,
        logo: t.logo,
        connected: t.isNoAuth || Boolean(t.connection?.isActive),
        toolsOffered: tools.filter((x) => x.type === 'function' && x.function.name.startsWith(`${t.slug.toUpperCase()}_`)).length,
      }),
    );
  }

  /** Starts a login for an app; returns the URL to send the browser to. */
  async loginUrl(toolkit: string): Promise<string> {
    if (!this.session) await this.start();
    if (!this.session) throw new Error(this.lastError ?? 'Composio is not configured');
    const req = await this.session.authorize(toolkit, { callbackUrl: this.cfg.composio.callbackUrl });
    if (!req.redirectUrl) throw new Error('Composio did not return a login link for this app');
    return req.redirectUrl;
  }

  /** Called after a login completes: re-read connections and tools. */
  async refresh(): Promise<void> {
    if (!this.session) return this.start();
    await this.registerTools().catch((err) => {
      this.lastError = (err as Error).message;
      this.log.error(`Refresh failed: ${this.lastError}`);
    });
  }
}
