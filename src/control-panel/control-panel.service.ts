import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { MusicService } from '../music/music.service';
import { WebService } from '../web/web.service';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { APP_CONFIG, AppConfig } from '../config';
import { ComposioService, Side } from '../composio/composio.service';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { KINDS, Kind, MemoryService } from '../memory/memory.service';
import { Mode, ModesService, VaultName, VAULTS } from '../memory/modes.service';
import { PanelAuth } from './panel-auth';
import { ProjectsService, taskText } from '../memory/projects.service';
import { PanelData, renderPanel } from './page';
import { SOUL_DOCS, SOUL_MAX_CHARS, SoulDoc, SoulService } from '../soul/soul.service';

/**
 * A small web page (default http://localhost:8099) to see what Max is connected to and
 * to sign in to apps through Composio. Only reachable from this computer by default.
 */
@Injectable()
export class ControlPanelService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ControlPanel');
  private server?: Server;
  @Optional() @Inject(MusicService) private readonly music?: MusicService;
  @Optional() @Inject(WebService) private readonly web?: WebService;
  @Optional() @Inject(SoulService) private readonly soul?: SoulService;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly composio: ComposioService,
    private readonly ha: HaMcpService,
    private readonly mcp: McpServersService,
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
    private readonly projects: ProjectsService,
  ) {
    this.auth = new PanelAuth(cfg.controlPanel.password);
  }

  private readonly auth: PanelAuth;

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
    // Password (PANEL_PASSWORD): everything except the login page needs a signed-in session.
    if (url.pathname === '/login') return this.auth.handleLogin(req, res, readForm);
    if (url.pathname === '/logout' && req.method === 'POST') return this.auth.logout(req, res);
    if (!this.auth.allowed(req)) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return this.redirect(res, '/login');
      res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Sign in first');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') return this.page(res, url);
    if (req.method === 'GET' && url.pathname === '/api/status') return this.json(res, await this.data());
    if (req.method === 'POST' && url.pathname === '/music/check') {
      await this.music?.poll();
      return this.redirect(res, '/#music');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/connect/')) {
      const toolkit = decodeURIComponent(url.pathname.slice('/connect/'.length));
      const side: Side = url.searchParams.get('side') === 'work' ? 'work' : 'personal';
      if (!this.composio.account(side).toolkits.includes(toolkit)) return this.redirect(res, '/?error=Unknown%20app');
      this.log.log(`Starting sign-in for ${toolkit} (${side})`);
      return this.redirect(res, await this.composio.loginUrl(toolkit, side));
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      await this.composio.refresh();
      const failed = url.searchParams.get('status') === 'failed' || url.searchParams.has('error');
      return this.redirect(res, failed ? '/?error=Sign-in%20was%20not%20completed' : '/?connected=1');
    }
    if (req.method === 'POST' && url.pathname === '/refresh') {
      await Promise.all([this.mcp.refreshAll(), this.composio.refresh(), this.music?.poll(), this.web?.check()]);
      return this.redirect(res, '/?refreshed=1');
    }
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      return this.json(res, this.memory.snapshot().map((v) => ({ ...v, items: v.items.map(({ vec, ...i }) => i), episodes: v.episodes.map(({ vec, ...e }) => e) })));
    }
    if (req.method === 'POST' && url.pathname.startsWith('/memory/')) return this.memoryAction(req, res, url.pathname.slice('/memory/'.length));
    if (req.method === 'POST' && url.pathname.startsWith('/soul/')) return this.soulAction(req, res, url.pathname.slice('/soul/'.length));
    if (req.method === 'POST' && url.pathname.startsWith('/projects/')) return this.projectAction(req, res, url.pathname.slice('/projects/'.length));
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      return this.json(res, this.projects.all().map((p) => ({ ...p, memory: this.memory.projectMemory(p).facts.map(({ vec, ...f }) => f) })));
    }
    if (req.method === 'GET' && url.pathname === '/api/memory/activity') return this.json(res, this.memory.recentActivity(500));
    if (req.method === 'POST' && url.pathname === '/activity/clear') {
      this.memory.clearActivity();
      return this.redirect(res, '/?ok=Activity%20log%20cleared.#activity');
    }
    if (req.method === 'POST' && url.pathname === '/mode') {
      const m = (await readForm(req)).get('mode') ?? '';
      if (['personal', 'work', 'guest', 'auto'].includes(m)) this.modes.set(m as Mode | 'auto');
      return this.redirect(res, '/#memory');
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }

  private async projectAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const back = (msg: string, id?: string, ok = true) =>
      this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}${id ? `&project=${encodeURIComponent(id)}` : ''}#projects`);
    if (action === 'create') {
      const vault = (VAULTS.includes(get('vault') as VaultName) ? get('vault') : 'personal') as VaultName;
      const msg = this.projects.create(get('name'), vault, get('description'), get('people'), true);
      const created = this.projects.all().find((p) => p.name.toLowerCase() === get('name').toLowerCase() && p.vault === vault);
      return back(msg, created?.id, msg.startsWith('Created'));
    }
    const p = this.projects.byId(get('id'));
    if (!p) return back('Project not found.', undefined, false);
    const task = p.tasks.find((t) => t.id === get('task'));
    switch (action) {
      case 'update':
        return back(this.projects.update(p, { status: get('status'), description: get('description'), rename: get('rename') }), p.id);
      case 'delete':
        if (get('confirm') !== 'yes') return back('Tick the box to confirm deleting the project.', p.id, false);
        this.memory.deleteProject(p.id);
        this.memory.activity('forgot', `Deleted project ${p.name} with its tasks and memory`, [p.vault]);
        return back(`Deleted ${p.name}.`);
      case 'person-add':
        return back(this.projects.addPeople(p, get('people')), p.id);
      case 'person-remove':
        return back(this.projects.removePerson(p, get('name')), p.id);
      case 'task-add': {
        const due = get('date') ? (get('time') ? `${get('date')}T${get('time')}` : get('date')) : undefined;
        return back(this.projects.addTask(p, { title: get('title'), due, assignee: get('assignee'), priority: get('priority') }), p.id);
      }
      case 'task-done':
        return task ? back(this.projects.completeTask(p, task), p.id) : back('Task not found.', p.id, false);
      case 'task-reopen':
        return task ? back(this.projects.updateTask(p, task, { reopen: true }), p.id) : back('Task not found.', p.id, false);
      case 'task-delete':
        return task ? back(this.projects.deleteTask(p, task), p.id) : back('Task not found.', p.id, false);
      case 'note-add': {
        const r = await this.memory.remember({ text: get('fact'), vault: p.vault, projectId: p.id, source: 'panel' });
        return back(r.ok ? 'Saved to the project memory.' : r.message, p.id, r.ok);
      }
      default:
        res.writeHead(404).end();
    }
  }

  private async soulAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    // The soul can be a page or two of text: allow a bigger form for it.
    const f = await readForm(req, SOUL_MAX_CHARS * 4 + 1024);
    const doc = (SOUL_DOCS.includes(f.get('doc') as SoulDoc) ? f.get('doc') : 'soul') as SoulDoc;
    const back = (msg: string, ok = true) => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}&doc=${doc}#soul`);
    if (!this.soul) return back('Not available.', false);
    switch (action) {
      case 'save': {
        const msg = this.soul.save(f.get('text') ?? '', doc);
        return back(msg, msg.startsWith('Saved'));
      }
      case 'reset':
        if (f.get('confirm') !== 'yes') return back('Tick the box to confirm going back to the starter version.', false);
        this.soul.reset(doc);
        return back('Back to the starter version.');
      case 'journal-add':
        return this.soul.addEntry(f.get('text') ?? '', 'panel', f.get('mode') === 'work' ? 'work' : 'personal') ? back('Added to Max\'s journal.') : back('Nothing added (empty, or already there).', false);
      case 'journal-delete':
        return back(this.soul.removeEntry(f.get('id') ?? '') ? 'Removed from Max\'s journal.' : 'Could not find that entry.');
      default:
        res.writeHead(404).end();
    }
  }

  private async memoryAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const f = await readForm(req);
    const id = f.get('id') ?? '';
    const vault = (VAULTS.includes(f.get('vault') as VaultName) ? f.get('vault') : 'personal') as VaultName;
    const back = (msg: string, ok = true) => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}&vault=${vault}#memory`);
    switch (action) {
      case 'add': {
        const kind = KINDS.includes(f.get('kind') as Kind) ? (f.get('kind') as Kind) : undefined;
        const r = await this.memory.remember({ text: f.get('fact') ?? '', vault, kind, date: f.get('date') || undefined, source: 'panel' });
        return back(r.ok ? 'Saved to memory.' : r.message, r.ok);
      }
      case 'delete':
        if (f.get('type') === 'note') this.memory.deleteEpisode(id);
        else this.memory.deleteItem(id);
        return back('Removed from memory.');
      case 'move':
        return back(this.memory.moveItem(id, (f.get('to') as VaultName) ?? vault) ? 'Moved.' : 'Could not move that.');
      case 'confirm':
        return back(this.memory.confirmItem(id) ? 'Confirmed.' : 'Could not confirm that.');
      default:
        res.writeHead(404).end();
    }
  }

  private async data(): Promise<PanelData> {
    const rt = this.cfg.realtime;
    const apps = this.composio.enabled ? await this.composio.apps('personal').catch(() => []) : [];
    const workApps = this.composio.enabled ? await this.composio.apps('work').catch(() => []) : [];
    const ha = await this.ha.status(0);
    return {
      music: this.music && {
        state: this.music.state,
        account: this.music.account,
        pairing: this.music.pairing,
        error: this.music.lastError,
      },
      voice:
        this.cfg.voiceMode === 'realtime'
          ? `${rt.provider === 'gemini' ? 'Gemini Live' : 'OpenAI Realtime'} (${rt.model}, "${rt.voice}")`
          : `Pipeline (${this.cfg.llm.model})`,
      homeAssistant: { connected: ha.connected, tools: ha.tools, error: ha.error },
      web: this.web?.status,
      composio: {
        configured: this.composio.enabled,
        error: this.composio.lastError,
        apps,
        workApps,
        ...(await this.composio.diagnostics()),
        userId: this.cfg.composio.userId,
      },
      memory: this.memory.enabled
        ? {
            mode: this.modes.mode,
            modeText: this.modes.describe(),
            readable: this.modes.readable(),
            vaults: this.memory.snapshot().map((v) => ({
              name: v.name,
              status: v.status,
              error: v.error,
              facts: [...v.items].reverse(),
              notes: [...v.episodes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
              totalNotes: v.episodes.length,
            })),
            autoLearn: this.cfg.memory.autoLearn,
            passwordSet: this.auth.enabled,
            workApps: this.cfg.memory.workApps,
            activity: this.memory.recentActivity(60),
            projects: this.projects.all().map((p) => {
              const mem = this.memory.projectMemory(p);
              return {
                id: p.id,
                name: p.name,
                vault: p.vault,
                status: p.status,
                description: p.description,
                people: p.people,
                tasks: p.tasks.map((t) => ({ ...t, text: taskText(t) })),
                facts: mem.facts.slice(0, 50).map((x) => ({ id: x.id, text: x.text, updatedAt: x.updatedAt })),
                notes: mem.notes.slice(0, 10).map((x) => ({ id: x.id, summary: x.summary, at: x.at })),
              };
            }),
          }
        : undefined,
      soul: this.soul && {
        docs: Object.fromEntries(SOUL_DOCS.map((d) => [d, this.soul!.read(d)])) as Record<SoulDoc, string>,
        doc: 'soul',
        maxChars: SOUL_MAX_CHARS,
        journal: this.memory.enabled ? this.soul.entries() : undefined,
      },
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
    else if (url.searchParams.get('ok')) d.notice = { kind: 'ok', text: url.searchParams.get('ok')! };
    if (d.memory) {
      d.memory.selected = (VAULTS.includes(url.searchParams.get('vault') as VaultName) ? url.searchParams.get('vault') : 'personal') as VaultName;
      d.memory.query = url.searchParams.get('q') ?? '';
      d.memory.project = url.searchParams.get('project') ?? undefined;
    }
    if (d.soul && SOUL_DOCS.includes(url.searchParams.get('doc') as SoulDoc)) d.soul.doc = url.searchParams.get('doc') as SoulDoc;
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

async function readForm(req: IncomingMessage, maxBytes = MAX_FORM_BYTES): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error('Form too large');
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
