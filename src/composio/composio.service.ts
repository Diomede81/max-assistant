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

/** Personal and work accounts are kept apart: separate logins, offered only in their own mode. */
export type Side = 'personal' | 'work';
export const SIDES: Side[] = ['personal', 'work'];

/** The MCP server name each side is registered under (the action router hides one per mode). */
export const SERVER: Record<Side, string> = { personal: 'composio', work: 'composio-work' };

/**
 * Office 365, Gmail, WhatsApp, LinkedIn and other apps through Composio. Composio holds the
 * logins (OAuth); Max keeps two separate sets of them, as two Composio "users":
 *  - personal (COMPOSIO_USER_ID, apps in COMPOSIO_TOOLKITS): used in personal mode
 *  - work (COMPOSIO_WORK_USER_ID, apps in COMPOSIO_WORK_TOOLKITS): used in work mode
 * so the same app (e.g. Outlook) can be connected twice: your own mailbox and your work one.
 * Each side is one MCP endpoint offering only its connected apps' tools, exposed directly (no
 * search step) to keep voice answers fast. Connect apps from the control panel.
 */
@Injectable()
export class ComposioService implements OnModuleInit {
  private readonly log = new Logger('Composio');
  private composio?: Composio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sessions: Partial<Record<Side, any>> = {};
  private readonly errors: Partial<Record<Side, string>> = {};
  private readonly connectedCount: Record<Side, number> = { personal: 0, work: 0 };

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mcp: McpServersService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.cfg.composio.apiKey);
  }

  get lastError(): string | undefined {
    return this.errors.personal ?? this.errors.work;
  }

  /** The Composio user and apps for a side. */
  account(side: Side): { userId: string; toolkits: string[] } {
    const c = this.cfg.composio;
    return side === 'work' ? { userId: c.workUserId, toolkits: c.workToolkits } : { userId: c.userId, toolkits: c.toolkits };
  }

  /** Whether any work app is connected (until then, work mode keeps using the personal accounts). */
  hasConnected(side: Side): boolean {
    return this.connectedCount[side] > 0;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    this.composio = new Composio({ apiKey: this.cfg.composio.apiKey });
    void this.start();
  }

  /** Creates the sessions and registers their MCP endpoints, offering only connected apps' tools. */
  async start(only?: Side): Promise<void> {
    if (!this.composio) return;
    await Promise.all(
      SIDES.filter((s) => (!only || s === only) && this.account(s).toolkits.length).map(async (side) => {
        const { userId, toolkits } = this.account(side);
        try {
          this.sessions[side] = await this.composio!.sessions.create(userId, {
            toolkits,
            sessionPreset: 'direct_tools',
            manageConnections: false,
            mcp: true,
          } as never);
          this.errors[side] = undefined;
          await this.registerTools(side);
        } catch (err) {
          this.errors[side] = (err as Error).message;
          this.log.error(`Could not start the ${side} Composio session: ${this.errors[side]}. Check COMPOSIO_API_KEY`);
        }
      }),
    );
  }

  private async registerTools(side: Side): Promise<void> {
    const session = this.sessions[side];
    if (!session) return;
    const connected = (await this.apps(side)).filter((a) => a.connected).map((a) => a.slug.toUpperCase());
    this.connectedCount[side] = connected.length;
    // Only offer tools for apps that are actually connected. Apps with their own patterns in
    // COMPOSIO_ALLOWED_TOOLS are narrowed to those; any other connected app gets all its tools,
    // so adding an app never silently gives Max zero actions.
    const patterns = connected.flatMap((slug) => {
      const own = this.cfg.composio.allowedTools.filter((p) => p === '*' || p.toUpperCase().startsWith(`${slug}_`));
      return own.length ? own : [`${slug}_*`];
    });
    const conn = await this.mcp.register({
      name: SERVER[side],
      url: session.mcp.url,
      headers: session.mcp.headers ?? {},
      allowedTools: patterns.length ? patterns : ['__none__'],
    });
    this.log.log(
      connected.length
        ? `${label(side)} apps connected: ${connected.join(', ')}; ${conn.counts.offered} tools offered`
        : `No ${side} apps connected yet - open the control panel (${this.cfg.controlPanel.publicUrl}) to connect them`,
    );
    if (side !== 'personal') return;
    const d = await this.diagnostics();
    if (d.notEnabled.length) {
      this.log.warn(`Connected in Composio but not enabled in Max: ${d.notEnabled.join(', ')}. Add to COMPOSIO_TOOLKITS / COMPOSIO_WORK_TOOLKITS in .env and restart`);
    }
    if (d.otherUser.length) {
      this.log.warn(
        `Connected in Composio under a user Max doesn't use: ${d.otherUser.join(', ')}. ` +
          'Connect them from Max\'s control panel instead (Personal or Work)',
      );
    }
  }

  /**
   * Apps connected in the Composio project that Max can't use: connected for one of Max's
   * users but missing from that side's app list, or connected only under another user ID
   * (e.g. via Composio's own dashboard).
   */
  async diagnostics(): Promise<{ notEnabled: string[]; otherUser: string[] }> {
    if (!this.composio) return { notEnabled: [], otherUser: [] };
    try {
      const active = { statuses: ['ACTIVE'], limit: 100 } as never;
      const slugs = (items: { toolkit: { slug: string } }[]) => [...new Set(items.map((a) => a.toolkit.slug.toLowerCase()))];
      const notEnabled: string[] = [];
      const mineIds = new Set<string>();
      const mineSlugs = new Set<string>();
      for (const side of SIDES) {
        const { userId, toolkits } = this.account(side);
        const mine = await this.composio.connectedAccounts.list({ ...(active as object), userIds: [userId] } as never);
        for (const a of mine.items) mineIds.add(a.id);
        for (const s of slugs(mine.items)) {
          mineSlugs.add(s);
          if (!toolkits.includes(s)) notEnabled.push(`${s} (${side})`);
        }
      }
      const all = await this.composio.connectedAccounts.list(active);
      return {
        notEnabled,
        otherUser: slugs(all.items.filter((a) => !mineIds.has(a.id))).filter((s) => !mineSlugs.has(s)),
      };
    } catch {
      return { notEnabled: [], otherUser: [] };
    }
  }

  /** Connection status for every configured app on one side. */
  async apps(side: Side = 'personal'): Promise<AppStatus[]> {
    const session = this.sessions[side];
    if (!session) return [];
    const { items } = await session.toolkits({ toolkits: this.account(side).toolkits });
    const tools = this.mcp.list.find((s) => s.config.name === SERVER[side])?.openAiTools ?? [];
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

  /** Starts a login for an app on one side; returns the URL to send the browser to. */
  async loginUrl(toolkit: string, side: Side = 'personal'): Promise<string> {
    if (!this.sessions[side]) await this.start(side);
    const session = this.sessions[side];
    if (!session) throw new Error(this.errors[side] ?? 'Composio is not configured');
    const req = await session.authorize(toolkit, { callbackUrl: this.cfg.composio.callbackUrl });
    if (!req.redirectUrl) throw new Error('Composio did not return a login link for this app');
    return req.redirectUrl;
  }

  /** Called after a login completes: re-read connections and tools on both sides. */
  async refresh(): Promise<void> {
    await Promise.all(
      SIDES.filter((s) => this.account(s).toolkits.length).map((side) =>
        !this.sessions[side]
          ? this.start(side)
          : this.registerTools(side).catch((err) => {
              this.errors[side] = (err as Error).message;
              this.log.error(`Refresh failed (${side}): ${this.errors[side]}`);
            }),
      ),
    );
  }
}

const label = (s: Side) => (s === 'work' ? 'Work' : 'Personal');
