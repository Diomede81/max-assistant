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
    // Only offer tools for apps that are actually connected. Apps with their own patterns in
    // COMPOSIO_ALLOWED_TOOLS are narrowed to those; any other connected app gets all its tools,
    // so adding an app never silently gives Max zero actions.
    const patterns = connected.flatMap((slug) => {
      const own = this.cfg.composio.allowedTools.filter((p) => p === '*' || p.toUpperCase().startsWith(`${slug}_`));
      return own.length ? own : [`${slug}_*`];
    });
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
    const d = await this.diagnostics();
    if (d.notEnabled.length) {
      this.log.warn(`Connected in Composio but not enabled in Max: ${d.notEnabled.join(', ')}. Add to COMPOSIO_TOOLKITS in .env and restart`);
    }
    if (d.otherUser.length) {
      this.log.warn(
        `Connected in Composio under a different user than Max's ("${this.cfg.composio.userId}"): ${d.otherUser.join(', ')}. ` +
          'Connect them from Max\'s control panel instead, or set COMPOSIO_USER_ID to that user',
      );
    }
  }

  /**
   * Apps connected in the Composio project that Max can't use: connected for Max's user
   * but missing from COMPOSIO_TOOLKITS, or connected only under another user ID (e.g. via
   * Composio's own dashboard).
   */
  async diagnostics(): Promise<{ notEnabled: string[]; otherUser: string[] }> {
    if (!this.composio) return { notEnabled: [], otherUser: [] };
    try {
      const active = { statuses: ['ACTIVE'], limit: 100 } as never;
      const mine = await this.composio.connectedAccounts.list({ ...(active as object), userIds: [this.cfg.composio.userId] } as never);
      const all = await this.composio.connectedAccounts.list(active);
      const mineIds = new Set(mine.items.map((a) => a.id));
      const slugs = (items: { toolkit: { slug: string } }[]) => [...new Set(items.map((a) => a.toolkit.slug.toLowerCase()))];
      const enabled = new Set(this.cfg.composio.toolkits);
      return {
        notEnabled: slugs(mine.items).filter((s) => !enabled.has(s)),
        otherUser: slugs(all.items.filter((a) => !mineIds.has(a.id))).filter((s) => !slugs(mine.items).includes(s)),
      };
    } catch {
      return { notEnabled: [], otherUser: [] };
    }
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
