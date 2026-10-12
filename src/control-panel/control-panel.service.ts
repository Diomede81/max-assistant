import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { APP_CONFIG, AppConfig } from '../config';
import { ComposioService } from '../composio/composio.service';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { MemoryService } from '../memory/memory.service';
import { PanelData, renderPanel } from './page';

/**
 * A small web page (default http://localhost:8099) to see what Max is connected to and
 * to sign in to apps through Composio. Only reachable from this computer by default.
 */
@Injectable()
export class ControlPanelService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ControlPanel');
  private server?: Server;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly composio: ComposioService,
    private readonly ha: HaMcpService,
    private readonly mcp: McpServersService,
    private readonly memory: MemoryService,
  ) {}

  onModuleInit(): void {
    const { port, host, publicUrl } = this.cfg.controlPanel;
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.log.error((err as Error).message);
        this.redirect(res, `/?error=${encodeURIComponent((err as Error).message)}`);
      });
    });
    this.server.on('error', (err) => this.log.error(`Control panel unavailable: ${err.message}`));
    this.server.listen(port, host, () => this.log.log(`Control panel: ${publicUrl}`));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Stop other websites open in the browser from posting to the panel (e.g. planting a "memory").
    if (req.method === 'POST' && !sameOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') return this.page(res, url);
    if (req.method === 'GET' && url.pathname === '/api/status') return this.json(res, await this.data());
    if (req.method === 'GET' && url.pathname.startsWith('/connect/')) {
      const toolkit = decodeURIComponent(url.pathname.slice('/connect/'.length));
      if (!this.cfg.composio.toolkits.includes(toolkit)) return this.redirect(res, '/?error=Unknown%20app');
      this.log.log(`Starting sign-in for ${toolkit}`);
      return this.redirect(res, await this.composio.loginUrl(toolkit));
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      await this.composio.refresh();
      const failed = url.searchParams.get('status') === 'failed' || url.searchParams.has('error');
      return this.redirect(res, failed ? '/?error=Sign-in%20was%20not%20completed' : '/?connected=1');
    }
    if (req.method === 'POST' && url.pathname === '/refresh') {
      await Promise.all([this.mcp.refreshAll(), this.composio.refresh()]);
      return this.redirect(res, '/?refreshed=1');
    }
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      return this.json(res, { facts: this.memory.facts, conversations: this.memory.conversations });
    }
    if (req.method === 'POST' && url.pathname === '/memory/add') {
      const form = await readForm(req);
      const r = this.memory.remember(form.get('fact') ?? '', 'panel');
      return this.redirect(res, r.ok ? '/?remembered=1#memory' : `/?error=${encodeURIComponent(r.message)}#memory`);
    }
    if (req.method === 'POST' && url.pathname === '/memory/delete') {
      const form = await readForm(req);
      const id = form.get('id') ?? '';
      if (form.get('kind') === 'conversation') this.memory.deleteConversation(id);
      else this.memory.deleteFact(id);
      return this.redirect(res, '/?forgot=1#memory');
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }

  private async data(): Promise<PanelData> {
    const rt = this.cfg.realtime;
    const apps = this.composio.enabled ? await this.composio.apps().catch(() => []) : [];
    const ha = await this.ha.status(0);
    return {
      voice:
        this.cfg.voiceMode === 'realtime'
          ? `${rt.provider === 'gemini' ? 'Gemini Live' : 'OpenAI Realtime'} (${rt.model}, "${rt.voice}")`
          : `Pipeline (${this.cfg.llm.model})`,
      homeAssistant: { connected: ha.connected, tools: ha.tools, error: ha.error },
      composio: {
        configured: this.composio.enabled,
        error: this.composio.lastError,
        apps,
        ...(await this.composio.diagnostics()),
        userId: this.cfg.composio.userId,
      },
      memory: this.memory.enabled
        ? {
            facts: [...this.memory.facts].reverse(),
            conversations: [...this.memory.conversations].reverse().slice(0, 20),
            totalConversations: this.memory.conversations.length,
            autoLearn: this.cfg.memory.autoLearn,
          }
        : undefined,
      servers: this.mcp.list.map((s) => ({
        name: s.config.name,
        connected: s.connected,
        ...s.counts,
        error: s.lastError,
      })),
    };
  }

  private async page(res: ServerResponse, url: URL): Promise<void> {
    const d = await this.data();
    if (url.searchParams.has('connected')) d.notice = { kind: 'ok', text: 'Signed in. Max can use this app now.' };
    else if (url.searchParams.has('refreshed')) d.notice = { kind: 'ok', text: 'Refreshed.' };
    else if (url.searchParams.has('remembered')) d.notice = { kind: 'ok', text: 'Saved to memory.' };
    else if (url.searchParams.has('forgot')) d.notice = { kind: 'ok', text: 'Removed from memory.' };
    else if (url.searchParams.get('error')) d.notice = { kind: 'error', text: url.searchParams.get('error')! };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderPanel(d));
  }

  private json(res: ServerResponse, body: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body, null, 2));
  }

  private redirect(res: ServerResponse, to: string): void {
    if (res.headersSent) return;
    res.writeHead(302, { Location: to }).end();
  }

  onModuleDestroy(): void {
    this.server?.close();
  }
}

const MAX_FORM_BYTES = 16 * 1024;

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_FORM_BYTES) throw new Error('Form too large');
  }
  return new URLSearchParams(body);
}

/** Browsers send Origin on form posts; it must be this panel's own address. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin';
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
