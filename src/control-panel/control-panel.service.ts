import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { MusicService } from '../music/music.service';
import { WebService } from '../web/web.service';
import { COUNTRIES, LocationService } from '../location/location.service';
import { ABOUT_FIELDS, About, AboutService } from '../about/about.service';
import { MeetingsService } from '../meetings/meetings.service';
import { MeetingLiveService } from '../meetings/meeting-live.service';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { APP_CONFIG, AppConfig } from '../config';
import { ComposioService, Side } from '../composio/composio.service';
import { HaMcpService } from '../ha-mcp/ha-mcp.service';
import { McpServersService } from '../mcp/mcp-servers.service';
import { KINDS, Kind, MemoryService } from '../memory/memory.service';
import { Mode, ModesService, VaultName, VAULTS } from '../memory/modes.service';
import { PanelAuth } from './panel-auth';
import { localToday, ProjectsService, taskText } from '../memory/projects.service';
import { TodoService } from '../memory/todo.service';
import { daysText, RoutinesService } from '../routines/routines.service';
import { ModelsService, Task, TASKS } from '../models/models.service';
import { requestPower } from '../face/power';
import { DeviceService } from '../device/device.service';
import { UpdatesService } from '../updates/updates.service';
import { AmbientService, FACE_STYLES, FaceStyle } from '../face/ambient.service';
import { TrainsService } from '../trains/trains.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DIETS, GOALS, MealName } from '../health/meals';
import { ACTIVITY, FITNESS, HealthService, Part, PARTS, PART_IDS, PLAN_PARTS } from '../health/health.service';
import { local } from '../routines/routines.service';
import type { PanelHealth } from './health-page';
import { dismissCard, showCard } from '../face/screen';
import { LockService } from '../lock/lock.service';
import { RadioService } from '../music/radio.service';
import { AirPlayService } from '../music/airplay.service';
import { LIVE_VOICES, LiveVoiceService } from '../realtime/live-voice.service';
import { PanelData, renderPanel } from './page';
import { HomeService } from '../home/home.service';
import { MicrophoneService } from '../audio/microphone.service';
import { wakeLog } from '../wake-word/wake-log';
import { WakeWordService } from '../wake-word/wake-word.service';
import { AutomationsService } from '../home/automations.service';
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
  @Optional() @Inject(HomeService) private readonly home?: HomeService;
  @Optional() @Inject(MicrophoneService) private readonly mic?: MicrophoneService;
  @Optional() @Inject(AutomationsService) private readonly automations?: AutomationsService;
  @Optional() @Inject(WebService) private readonly web?: WebService;
  @Optional() @Inject(TrainsService) private readonly trains?: TrainsService;
  @Optional() @Inject(WhatsAppService) private readonly whatsapp?: WhatsAppService;
  @Optional() @Inject(HealthService) private readonly health?: HealthService;
  @Optional() @Inject(WakeWordService) private readonly wakeWords?: WakeWordService;
  @Optional() @Inject(LocationService) private readonly location?: LocationService;
  @Optional() @Inject(AboutService) private readonly about?: AboutService;
  @Optional() @Inject(MeetingsService) private readonly meetings?: MeetingsService;
  @Optional() @Inject(MeetingLiveService) private readonly meetingsLive?: MeetingLiveService;
  @Optional() @Inject(SoulService) private readonly soul?: SoulService;
  @Optional() @Inject(RoutinesService) private readonly routines?: RoutinesService;
  @Optional() @Inject(ModelsService) private readonly models?: ModelsService;
  @Optional() @Inject(DeviceService) private readonly device?: DeviceService;
  @Optional() @Inject(UpdatesService) private readonly updates?: UpdatesService;
  @Optional() @Inject(AmbientService) private readonly ambient?: AmbientService;
  @Optional() @Inject(LockService) private readonly lock?: LockService;
  @Optional() @Inject(RadioService) private readonly radio?: RadioService;
  @Optional() @Inject(AirPlayService) private readonly airplay?: AirPlayService;
  @Optional() @Inject(LiveVoiceService) private readonly liveVoice?: LiveVoiceService;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly composio: ComposioService,
    private readonly ha: HaMcpService,
    private readonly mcp: McpServersService,
    private readonly memory: MemoryService,
    private readonly modes: ModesService,
    private readonly projects: ProjectsService,
    private readonly todos: TodoService,
  ) {
    this.auth = new PanelAuth({
      envPassword: cfg.controlPanel.password,
      // On the box the panel is reachable from the home network: it always has a password.
      required: cfg.face.onBox,
      dir: cfg.memory.dir,
      showCode: (code, ttlMs) =>
        showCard({
          id: 'panel-code',
          kind: 'notice',
          icon: '🔐',
          title: 'Control panel',
          big: `${code.slice(0, 3)} ${code.slice(3)}`,
          body: "Someone is choosing the control panel's password: type this code there. If that isn't you, ignore it.",
          ttlMs,
        }),
      // On the box, a new device signs in with the password and then Allow on Max's screen.
      askOnScreen: cfg.face.onBox
        ? (device, ttlMs, answer) => {
            const done = (allowed: boolean) => () => {
              answer(allowed);
              dismissCard('panel-signin');
            };
            showCard(
              {
                id: 'panel-signin',
                kind: 'notice',
                icon: '🔐',
                title: 'Control panel sign-in',
                big: device,
                body: 'wants to open the control panel (the password was right). Allow it only if it is you.',
                actions: [
                  { id: 'allow', label: 'Allow', style: 'primary' },
                  { id: 'deny', label: 'Deny', style: 'danger' },
                ],
                ttlMs,
              },
              { allow: done(true), deny: done(false) },
            );
          }
        : undefined,
    });
    const extra = [cfg.controlPanel.publicUrl, ...cfg.controlPanel.allowedHosts];
    this.hosts = new Set(extra.map((h) => hostOf(h)).filter(Boolean));
  }

  private readonly auth: PanelAuth;
  /** Extra names the panel answers to (CONTROL_PANEL_URL's, CONTROL_PANEL_HOSTS). */
  private readonly hosts: Set<string>;

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
    // Never inside another website's frame (click tricks), no guessing of file types, no leaking addresses.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    // Only answer to the panel's own names (max.local, the box's address, localhost...): a website whose name
    // is made to point at the box ("DNS rebinding") could otherwise read the panel from the user's browser.
    if (!hostAllowed(req.headers.host, this.hosts)) {
      res.writeHead(421, { 'Content-Type': 'text/plain' }).end('Open the control panel by its own address, e.g. http://max.local:8099');
      return;
    }
    // Stop other websites open in the browser from posting to the panel (e.g. planting a "memory").
    if (req.method === 'POST' && !sameOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }
    // Password (PANEL_PASSWORD): everything except the login page needs a signed-in session.
    if (url.pathname === '/login' || url.pathname === '/login/wait') return this.auth.handleLogin(req, res, readForm);
    if (url.pathname === '/logout' && req.method === 'POST') return this.auth.logout(req, res);
    if (!this.auth.allowed(req)) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return this.redirect(res, '/login');
      res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Sign in first');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') return this.page(res, url, req);
    if (req.method === 'GET' && url.pathname === '/api/status') return this.json(res, await this.data());
    if (this.home?.enabled && (url.pathname.startsWith('/api/home') || url.pathname.startsWith('/home/'))) return this.homeRoute(req, res, url);
    if (req.method === 'POST' && (url.pathname === '/music/airplay' || url.pathname === '/music/airplay-code') && this.airplay) {
      const f = await readForm(req);
      const on = f.get('for') ?? 'off'; // minutes, 'always' or 'off'
      const msg = url.pathname === '/music/airplay-code'
        ? this.airplay.renewCode()
        : on === 'off' ? this.airplay.turnOff() : this.airplay.turnOn(on === 'always' ? undefined : Number(on) || 60);
      return this.redirect(res, `/?ok=${encodeURIComponent(msg)}#music`);
    }
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
      return this.redirect(res, failed ? '/?error=Sign-in%20was%20not%20completed' : '/?connected=1#apps');
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
    if (req.method === 'POST' && url.pathname.startsWith('/updates/') && this.updates) {
      const f = await readForm(req);
      const u = this.updates;
      let msg: string;
      let ok = true;
      if (url.pathname === '/updates/install') {
        msg = u.request('control panel');
        ok = msg.startsWith('Updating');
      } else if (url.pathname === '/updates/auto') {
        msg = u.setAuto(f.get('auto') === 'yes', f.get('time') ?? undefined);
        ok = !msg.startsWith('The time');
      } else {
        const a = await u.check(true);
        msg = !a ? 'The installed version is unknown.' : a.error ?? (a.behind ? `${a.behind} new change${a.behind === 1 ? '' : 's'} available.` : 'Max is up to date.');
        ok = Boolean(a && !a.error);
      }
      return this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#updates`);
    }
    if (req.method === 'POST' && url.pathname === '/device/level' && this.device) {
      const f = await readForm(req);
      const out = f.has('volume') ? await this.device.setVolume(Number(f.get('volume'))) : this.device.setBrightness(Number(f.get('brightness')));
      const what = f.has('volume') ? 'Volume' : 'Brightness';
      return this.redirect(res, `/?${typeof out === 'number' ? `ok=${encodeURIComponent(`${what} ${out}%.`)}` : `error=${encodeURIComponent(out)}`}#device`);
    }
    if (req.method === 'POST' && url.pathname === '/device/mute' && this.mic) {
      const f = await readForm(req);
      const msg = await this.mic.setMuted(f.get('on') === '1');
      const back = f.get('from') === 'home' ? '' : '#device';
      return this.redirect(res, `/?${/^Microphone (off|on)|already/.test(msg) ? 'ok' : 'error'}=${encodeURIComponent(msg)}${back}`);
    }
    if (req.method === 'POST' && url.pathname === '/device/sound' && this.device) {
      const f = await readForm(req);
      const msg = this.device.setTone(f.get('tone') ?? '');
      return this.redirect(res, `/?${msg.startsWith('Speaker sound:') ? 'ok' : 'error'}=${encodeURIComponent(msg)}#device`);
    }
    if (req.method === 'POST' && url.pathname === '/device/voice' && this.device) {
      const f = await readForm(req);
      const msg = this.device.setVoice({ greeting: f.get('greeting') ?? '', greetAgainMin: f.has('greetAgain') ? Number(f.get('greetAgain')) : undefined, startSound: f.get('startSound') === 'on' });
      void this.liveVoice?.ensure(this.device.greeting); // recorded in the live voice, ready for the next "Hey Max"
      return this.redirect(res, `/?ok=${encodeURIComponent(msg)}#device`);
    }
    if (req.method === 'POST' && (url.pathname === '/voice/save' || url.pathname === '/voice/try') && this.liveVoice) {
      const f = await readForm(req);
      const voice = f.get('voice') ?? '';
      const style = f.get('style') ?? '';
      if (url.pathname === '/voice/try') {
        const msg = await this.liveVoice.preview(voice, style);
        return this.redirect(res, `/?${msg.startsWith('That was') ? 'ok' : 'error'}=${encodeURIComponent(msg)}#device`);
      }
      const msg = this.liveVoice.save({ voice, style });
      if (msg.startsWith('Saved') && this.device?.greeting) void this.liveVoice.ensure(this.device.greeting);
      return this.redirect(res, `/?${msg.startsWith('Saved') ? 'ok' : 'error'}=${encodeURIComponent(msg)}#device`);
    }
    if (req.method === 'POST' && url.pathname === '/device/power') {
      const f = await readForm(req);
      const action = f.get('action') === 'reboot' ? 'reboot' : 'poweroff';
      if (f.get('confirm') !== 'yes') return this.redirect(res, '/?error=Tick%20the%20box%20to%20confirm.#device');
      if (!requestPower(this.cfg, action)) return this.redirect(res, '/?error=Only%20available%20on%20the%20Max%20box.#device');
      this.log.log(action === 'reboot' ? 'Restarting (asked from the control panel)' : 'Turning off (asked from the control panel)');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Max</title><body style="font:16px system-ui;margin:40px;max-width:520px">` +
          (action === 'reboot'
            ? '<h1>Restarting…</h1><p>Max will be back in about a minute. <a href="/">Open the control panel again</a>.</p>'
            : "<h1>Turning off</h1><p>When Max's screen goes dark it's safe to unplug. To turn him on again, press the power button on the Raspberry Pi.</p>"),
      );
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/models/') && this.models) {
      const f = await readForm(req);
      const task = (f.get('task') ?? '') as Task;
      if (!(task in TASKS)) return this.redirect(res, '/?error=Unknown%20job#models');
      const msg = url.pathname === '/models/test' ? await this.models.test(task) : this.models.assign(task, f.get('provider') ?? 'default', f.get('model') ?? '');
      const ok = !/failed|isn't set up|Choose|Unknown/.test(msg);
      return this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#models`);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/routines/') && this.routines) return this.routineAction(req, res, url.pathname.slice('/routines/'.length));
    if (req.method === 'POST' && url.pathname.startsWith('/todo/')) return this.todoAction(req, res, url.pathname.slice('/todo/'.length));
    if (req.method === 'POST' && url.pathname.startsWith('/projects/')) return this.projectAction(req, res, url.pathname.slice('/projects/'.length));
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      return this.json(res, this.projects.all().map((p) => ({ ...p, memory: this.memory.projectMemory(p).facts.map(({ vec, ...f }) => f) })));
    }
    if (req.method === 'GET' && url.pathname === '/api/memory/activity') return this.json(res, this.memory.recentActivity(500));
    if (req.method === 'POST' && url.pathname === '/activity/clear') {
      this.memory.clearActivity();
      return this.redirect(res, '/?ok=Activity%20log%20cleared.#activity');
    }
    if (req.method === 'POST' && url.pathname.startsWith('/lock/') && this.lock) {
      const f = await readForm(req);
      const action = url.pathname.slice('/lock/'.length);
      let out: { ok: boolean; message: string };
      if (action === 'set') {
        out = f.get('code') !== f.get('repeat') ? { ok: false, message: 'The two new codes are different.' } : this.lock.setCode(f.get('code') ?? '', f.get('current') ?? '');
      } else if (action === 'off') {
        out = this.lock.setCode(undefined, f.get('current') ?? '');
      } else if (action === 'reset' && this.auth.enabled && f.get('confirm') === 'yes') {
        out = this.lock.setCode(undefined, undefined, true);
      } else {
        out = { ok: false, message: this.auth.enabled ? 'Tick the box to confirm.' : 'Removing a forgotten code needs a password on this page (PANEL_PASSWORD).' };
      }
      return this.redirect(res, `/?${out.ok ? 'ok' : 'error'}=${encodeURIComponent(out.message)}#security`);
    }
    if (url.pathname.startsWith('/screen/') && this.ambient) return this.screenAction(req, res, url.pathname.slice('/screen/'.length));
    if (this.meetings && (url.pathname.startsWith('/meetings/'))) return this.meetingsRoute(req, res, url);
    if (this.automations?.enabled && req.method === 'POST' && url.pathname.startsWith('/automations/')) return this.automationsRoute(req, res, url);
    if (req.method === 'POST' && url.pathname === '/about' && this.about) {
      const f = await readForm(req);
      const values: About = {};
      for (const field of ABOUT_FIELDS) if (f.has(field.key)) values[field.key] = f.get(field.key) ?? '';
      const msg = await this.about.save(values);
      return this.redirect(res, `/?${msg.startsWith('Saved') ? 'ok' : 'error'}=${encodeURIComponent(msg)}#about-you`);
    }
    if (req.method === 'POST' && url.pathname === '/location' && this.location) {
      const f = await readForm(req);
      const msg = await this.location.save({ place: f.get('place') ?? '', postcode: f.get('postcode') ?? '', country: f.get('country') ?? '' });
      return this.redirect(res, `/?${msg.startsWith('Saved') ? 'ok' : 'error'}=${encodeURIComponent(msg)}#location`);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/health/') && this.health) return this.healthAction(req, res, url.pathname.slice('/health/'.length));
    if (url.pathname.startsWith('/whatsapp/') && this.whatsapp) {
      const w = this.whatsapp;
      if (req.method === 'GET' && url.pathname === '/whatsapp/status') {
        const st = await w.status();
        return this.json(res, { state: st.state, qrSvg: st.qrSvg });
      }
      if (req.method === 'POST') {
        const f = await readForm(req);
        let out: { ok: boolean; message: string } | undefined;
        if (url.pathname === '/whatsapp/link') out = { ok: true, message: await w.link() };
        else if (url.pathname === '/whatsapp/unlink') out = { ok: true, message: await w.unlink() };
        else if (url.pathname === '/whatsapp/allow') out = await w.allow(f.get('name') ?? '', f.get('number') ?? '');
        else if (url.pathname === '/whatsapp/disallow') out = { ok: true, message: w.disallow(f.get('number') ?? '') };
        else if (url.pathname === '/whatsapp/read-allow') out = w.allowReading({ name: f.get('name') ?? '', number: f.get('number') ?? undefined, group: f.get('group') ?? undefined });
        else if (url.pathname === '/whatsapp/chat') out = { ok: true, message: w.setChat(f.get('on') === 'yes') };
        else if (url.pathname === '/whatsapp/read-remove') out = { ok: true, message: w.stopReading(f.get('id') ?? '') };
        else if (url.pathname === '/whatsapp/groups') out = await w.loadGroups().then((message) => ({ ok: !/isn't connected/.test(message), message })).catch((err) => ({ ok: false, message: `Couldn't get your groups: ${(err as Error).message}` }));
        if (out) return this.redirect(res, `/?${out.ok ? 'ok' : 'error'}=${encodeURIComponent(out.message)}#whatsapp`);
      }
    }
    if (req.method === 'POST' && url.pathname === '/trains/home' && this.trains) {
      const msg = this.trains.setHome((await readForm(req)).get('station') ?? '');
      return this.redirect(res, `/?${/^Home station/.test(msg) ? 'ok' : 'error'}=${encodeURIComponent(msg)}#trains`);
    }
    if (req.method === 'POST' && url.pathname === '/device/wake-words' && this.wakeWords) {
      const f = await readForm(req);
      const msg = await this.wakeWords.setNames(f.getAll('names')).catch((err: Error) => `Couldn't change the wake words: ${err.message}`);
      return this.redirect(res, `/?${/^Max now/.test(msg) ? 'ok' : 'error'}=${encodeURIComponent(msg)}#device`);
    }
    if (req.method === 'POST' && url.pathname === '/security/device-remove') {
      const msg = this.auth.removeDevice(req, (await readForm(req)).get('id') ?? '');
      return this.redirect(res, `/?ok=${encodeURIComponent(msg)}#security`);
    }
    if (req.method === 'POST' && url.pathname === '/security/password') {
      const f = await readForm(req);
      const out = this.auth.change(req, f.get('current') ?? '', f.get('password') ?? '', f.get('again') ?? '');
      return this.redirect(res, `/?${out.ok ? 'ok' : 'error'}=${encodeURIComponent(out.message)}#security`);
    }
    if (req.method === 'POST' && url.pathname === '/mode') {
      const m = (await readForm(req)).get('mode') ?? '';
      if (['personal', 'work', 'guest', 'auto'].includes(m)) this.modes.set(m as Mode | 'auto');
      return this.redirect(res, '/?ok=Mode%20changed.#mode');
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
        return back(this.projects.addTask(p, { title: get('title'), due, assignee: get('assignee'), priority: get('priority'), criticality: get('criticality') }), p.id);
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

  private async modelsData(m: ModelsService): Promise<PanelData['models']> {
    const providers = await Promise.all(
      m.providers().map(async (p) => ({ ...p, ...(p.configured && p.id !== 'default' ? await m.available(p.id) : { models: [] as string[] }) })),
    );
    return {
      main: this.cfg.llm.model,
      providers,
      tasks: (Object.keys(TASKS) as Task[]).map((t) => ({ id: t, ...TASKS[t], ...m.assignment(t), describe: m.describe(t) })),
    };
  }

  /** The Health tab: each part with its last 14 days, and the plans. */
  private healthData(): PanelHealth | undefined {
    const h = this.health;
    if (!h) return undefined;
    const today = local().date;
    const days = [...Array(14)].map((_, i) => local(new Date(Date.now() - (13 - i) * 86_400_000)).date);
    const main: Record<Part, { key: string; label: string; unit: string; sum: boolean }> = {
      exercise: { key: 'minutes', label: 'Minutes of exercise', unit: 'min', sum: true },
      diet: { key: 'kcal', label: 'Calories', unit: 'kcal', sum: true },
      heart: { key: h.entries.some((e) => e.part === 'heart' && e.values.sys !== undefined) ? 'sys' : 'bpm', label: h.entries.some((e) => e.part === 'heart' && e.values.sys !== undefined) ? 'Blood pressure (top)' : 'Resting heart rate', unit: '', sum: false },
      sleep: { key: 'hours', label: 'Hours of sleep', unit: 'h', sum: false },
      weight: { key: 'kg', label: 'Weight', unit: 'kg', sum: false },
    };
    return {
      today,
      model: this.models?.describe('health') ?? 'the main model',
      emailTo: h.emailTo,
      profile: { ...h.profile, age: h.age(), summary: h.profileText() },
      fitnessLevels: FITNESS,
      activityLevels: ACTIVITY,
      goals: GOALS,
      eaters: h.eaters,
      diets: DIETS,
      meals: h.mealPlan,
      shopping: h.shopping,
      emailConnected: h.emailConnected,
      whatsappReady: h.whatsappReady,
      parts: PART_IDS.map((id) => {
        const m = main[id];
        const recent = h.recent(id, 14);
        return {
          id,
          ...PARTS[id],
          summary: h.summary(id),
          goal: h.goals[id],
          planable: PLAN_PARTS.includes(id),
          entries: h.entries.filter((e) => e.part === id).slice(-10).reverse(),
          chart: {
            label: m.label,
            unit: m.unit,
            days: days.map((date) => {
              const vs = recent.filter((e) => e.date === date && e.values[m.key] !== undefined).map((e) => e.values[m.key]);
              return { date, value: vs.length ? (m.sum ? Math.round(vs.reduce((a, b) => a + b, 0) * 10) / 10 : vs[vs.length - 1]) : undefined };
            }),
          },
        };
      }),
      plans: h.plans.map((p) => ({ ...p, running: h.running.has(p.id), latest: p.history[0] })),
    };
  }

  private async healthAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const h = this.health!;
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const back = (msg: string, ok = true, anchor = 'health') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#${anchor}`);
    const part = get('part') as Part;
    switch (action) {
      case 'log': {
        if (!(part in PARTS)) return back('Unknown part.', false);
        const values = Object.fromEntries(PARTS[part].fields.map((x) => [x.key, get(x.key)]));
        const r = h.add(part, { text: get('text'), values, date: get('date') });
        return back(r.message.split(' That ')[0], r.ok, `health-${part}`);
      }
      case 'delete':
        return back(h.remove(get('id')) ? 'Removed.' : 'Already gone.', true, 'health');
      case 'goal':
        return part in PARTS ? back(h.setGoal(part, get('goal')), true, `health-${part}`) : back('Unknown part.', false);
      case 'profile': {
        const r = h.saveProfile({ age: get('age'), sex: get('sex'), heightCm: get('height'), fitness: get('fitness'), activity: get('activity'), limits: get('limits'), goal: get('goal') });
        return back(r.message, r.ok, 'health-you');
      }
      case 'eater-add': {
        const r = h.addEater({ name: get('name'), diet: get('diet'), allergies: get('allergies'), other: get('other') });
        return back(r.message, r.ok, 'health-diet-needs');
      }
      case 'eater-remove':
        return back(h.removeEater(get('id')), true, 'health-diet-needs');
      case 'shop-add':
        return back(h.addShopping(get('item')), true, 'health-meals');
      case 'shop-tick':
        h.tickShopping(get('id'), get('done') === 'yes');
        return this.redirect(res, '/#health-meals');
      case 'shop-clear':
        return back(h.clearBought(), true, 'health-meals');
      case 'email': {
        const msg = h.setEmail(get('email'));
        return back(msg, !/doesn't look right/.test(msg), 'health-plans');
      }
      case 'plan-save': {
        const id = get('id');
        const r = h.savePlan(
          {
            name: get('name'),
            part: get('part') as Part,
            span: get('span') === 'week' ? 'week' : 'day',
            sourcesText: f.get('sources') ?? '',
            brief: get('brief'),
            time: get('time'),
            days: f.getAll('days').map(Number),
            email: f.get('email') === 'yes',
            whatsapp: f.get('whatsapp') === 'yes',
            meals: f.getAll('meals') as MealName[],
            daily: f.get('daily') === 'yes',
            ...(id ? { enabled: f.get('enabled') === 'yes' } : {}),
          },
          id || undefined,
        );
        return back(r.message, r.ok, r.plan ? `plan-${r.plan.id}` : 'health-plan-new');
      }
      case 'plan-run': {
        const id = get('id');
        if (!h.plans.some((p) => p.id === id)) return back('That plan no longer exists.', false, 'health-plans');
        void h.run(id);
        return back('Preparing the plan: it takes up to a minute (the page refreshes by itself).', true, `plan-${id}`);
      }
      case 'plan-toggle':
        return back(h.togglePlan(get('id')), true, `plan-${get('id')}`);
      case 'plan-delete':
        if (f.get('confirm') !== 'yes') return back('Tick the box to confirm.', false, `plan-${get('id')}`);
        return back(h.deletePlan(get('id')), true, 'health-plans');
    }
    return back('Unknown action.', false);
  }

  private async routineAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const r = this.routines!;
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const id = get('id');
    const back = (msg: string, ok = true, anchor = id ? `routine-${id}` : 'routines') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#${anchor}`);
    const routine = r.routines.find((x) => x.id === id);
    if (action !== 'save' && !routine) return back('That routine no longer exists.', false, 'routines');
    switch (action) {
      case 'save': {
        const msg = r.save(
          {
            name: get('name'),
            sourcesText: f.get('sources') ?? '',
            interests: get('interests'),
            avoid: get('avoid'),
            time: get('time'),
            days: f.getAll('days').map(Number),
            count: Number(get('count')),
            vault: get('vault') as VaultName,
            search: f.get('search') === 'yes',
            ...(id ? { enabled: f.get('enabled') === 'yes' } : {}),
          },
          id || undefined,
        );
        const ok = /^(Created|Saved)/.test(msg);
        const created = !id && ok ? r.routines[r.routines.length - 1] : undefined;
        // A new briefing with interests but no websites yet: start suggesting straight away.
        if (created && !created.sources.length) {
          void r.suggest(created.id);
          return back(`${msg} Max is now finding websites for your interests: tick the ones you want.`, true, `routine-${created.id}`);
        }
        return back(msg, ok, created ? `routine-${created.id}` : id ? `routine-${id}` : 'routine-new');
      }
      case 'feedback': {
        const msg = r.feedback(routine!.id, get('url'), get('vote') === 'up');
        return back(msg, msg.startsWith('Noted'));
      }
      case 'suggest': {
        void r.suggest(routine!.id);
        return back('Finding websites for your interests: about a minute.');
      }
      case 'add-suggested': {
        const msg = r.addSuggested(routine!.id, f.getAll('url'));
        return back(msg, msg.startsWith('Added'));
      }
      case 'run':
        void r.run(routine!.id, true);
        return back(`Gathering ${routine!.name}: it takes a minute or two. Refresh this page to see it.`);
      case 'toggle':
        return back(r.save({ enabled: !routine!.enabled }, routine!.id).replace(/^Saved/, routine!.enabled ? 'Resumed' : 'Paused'));
      case 'delete':
        if (get('confirm') !== 'yes') return back('Tick the box to confirm deleting the routine.', false);
        r.remove(routine!.id);
        return back(`Deleted ${routine!.name}.`, true, 'routines');
      default:
        res.writeHead(404).end();
    }
  }

  private async todoAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const back = (msg: string, ok = true) => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#myday`);
    const due = get('date') ? (get('time') ? `${get('date')}T${get('time')}` : get('date')) : '';
    const project = get('project') ? this.projects.byId(get('project')) : undefined;
    if (action === 'add') {
      const msg = this.todos.add({ title: get('title'), priority: get('priority'), criticality: get('criticality'), due: due || undefined, project, vault: get('vault'), assignee: get('assignee') }, true);
      return back(msg, msg.startsWith('Added'));
    }
    const item = this.todos.byId(get('id'));
    if (!item) return back('That to-do no longer exists.', false);
    switch (action) {
      case 'done':
        return back(this.todos.complete(item));
      case 'reopen':
        return back(this.todos.update(item, { reopen: true }, true));
      case 'delete':
        return back(this.todos.delete(item));
      case 'update': {
        const msg = this.todos.update(
          item,
          { priority: get('priority'), criticality: get('criticality'), due: f.has('date') ? due : undefined, moveTo: get('project') === 'none' ? 'none' : (project ?? undefined) },
          true,
        );
        return back(msg, msg.startsWith('Updated'));
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

  /** Settings → Screen: the glance and photo frame settings, and the pictures. */
  private async screenAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const a = this.ambient!;
    if (req.method === 'GET' && action.startsWith('photos/')) {
      const p = a.photo(action.slice('photos/'.length));
      if (!p) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      else res.writeHead(200, { 'Content-Type': p.type, 'Cache-Control': 'private, max-age=86400' }).end(p.data);
      return;
    }
    if (req.method !== 'POST') return this.redirect(res, '/#screen');
    if (action === 'photo') {
      const data = await readBody(req, MAX_PHOTO_BYTES);
      const out = data ? a.addPhoto(data) : { error: 'That picture is too large (15 MB at most).' };
      if (out.name) this.log.log('Photo added for the screen');
      return this.json(res, out);
    }
    const f = await readForm(req);
    if (action === 'photo-delete') {
      const ok = a.removePhoto(f.get('name') ?? '');
      return this.redirect(res, `/?${ok ? 'ok=Picture%20removed.' : 'error=Picture%20not%20found.'}#screen`);
    }
    if (action === 'save') {
      const msg = a.save({
        glance: f.get('glance') === 'on',
        frame: f.get('frame') === 'on',
        captions: f.get('captions') === 'on',
        dance: f.get('dance') === 'on',
        notifyBriefing: f.get('notifyBriefing') === 'on',
        notifyEmail: f.get('notifyEmail') === 'on',
        notifyTodos: f.get('notifyTodos') === 'on',
        faceStyle: ((f.get('faceStyle') ?? '') in FACE_STYLES ? f.get('faceStyle') : 'robot') as FaceStyle,
        ...(f.has('dimAfterSec') ? { dimAfterSec: Number(f.get('dimAfterSec')) } : {}),
        ...(f.has('dimLevel') ? { dimLevel: Number(f.get('dimLevel')) } : {}),
        frameFrom: f.get('frameFrom') ?? '',
        frameTo: f.get('frameTo') ?? '',
        frameEverySec: Number(f.get('frameEverySec') ?? 20),
      });
      return this.redirect(res, `/?${msg.startsWith('Saved') ? 'ok' : 'error'}=${encodeURIComponent(msg)}#screen`);
    }
    return this.redirect(res, '/#screen');
  }

  private async data(): Promise<PanelData> {
    const rt = this.cfg.realtime;
    const apps = this.composio.enabled ? await this.composio.apps('personal').catch(() => []) : [];
    const workApps = this.composio.enabled ? await this.composio.apps('work').catch(() => []) : [];
    const ha = await this.ha.status(0);
    return {
      homeDevices: this.home?.enabled ? { enabled: true } : undefined,
      music: this.music && {
        state: this.music.state,
        account: this.music.account,
        pairing: this.music.pairing,
        error: this.music.lastError,
        radio: this.radio && { available: this.radio.available, playing: this.radio.playing ? this.radio.current?.station.name : undefined },
        airplay: this.airplay && { onBox: this.airplay.onBox, enabled: this.airplay.enabled, mode: this.airplay.mode, until: this.airplay.until, code: this.airplay.code, locked: Boolean(this.lock?.locked), playing: this.airplay.active },
      },
      voice:
        this.cfg.voiceMode === 'realtime'
          ? `${rt.provider === 'gemini' ? 'Gemini Live' : 'OpenAI Realtime'} (${rt.model}, "${rt.voice}")`
          : `Pipeline (${this.cfg.llm.model})`,
      homeAssistant: { connected: ha.connected, tools: ha.tools, error: ha.error, where: this.ha.where },
      web: this.web?.status,
      trains: this.trains?.status,
      whatsapp: await this.whatsapp?.status(),
      health: this.healthData(),
      meetings: this.meetings && {
        enabled: this.meetings.enabled,
        live: Boolean(this.meetingsLive?.enabled),
        speaks: this.meetings.speaks(),
        projects: this.projects.all().filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: p.name })),
        settings: this.meetings.settingsView(),
        monthMinutes: this.meetings.monthMinutes(),
        list: this.meetings.list().map((m) => ({
          id: m.id,
          title: m.title,
          platform: m.platform,
          at: m.at,
          state: m.state,
          status: m.status,
          minutes: m.startedAt ? Math.max(0, Math.round((Date.parse(m.endedAt ?? new Date().toISOString()) - Date.parse(m.startedAt)) / 60_000)) : undefined,
          turns: m.transcript?.length ?? 0,
          project: m.projectId ? this.projects.byId(m.projectId)?.name : undefined,
          projectId: m.projectId,
          filed: m.filed ? this.projects.byId(m.filed.projectId)?.name : undefined,
          fileWhenReady: m.fileWhenReady ? this.projects.byId(m.fileWhenReady)?.name : undefined,
          answers: m.answers,
          liveOn: m.live,
          live: this.meetingsLive?.status(m.id),
        })),
      },
      about: this.about && { fields: ABOUT_FIELDS.map((f) => ({ ...f, value: this.about!.about[f.key] ?? '' })) },
      location: this.location && { ...(this.location.home ?? { place: '', country: this.location.country }), countries: COUNTRIES },
      routines: this.routines && this.memory.enabled
        ? {
            firecrawl: this.routines.firecrawl,
            list: this.routines.routines.map((x) => ({
              ...x,
              daysText: daysText(x.days),
              running: this.routines!.isRunning(x.id),
              briefing: this.routines!.briefings[x.id],
              suggestions: this.routines!.suggestions(x.id),
            })),
          }
        : undefined,
      models: this.models && (await this.modelsData(this.models)),
      onBox: this.cfg.face.onBox,
      device: this.device && { ...(await this.device.status()), mic: this.mic?.canMute ? { muted: this.mic.muted } : undefined },
      wakeUps: { list: wakeLog(), verify: this.cfg.wakeWord.verify, channel: this.cfg.audio.inputChannel },
      wakeWords: this.wakeWords && (await Promise.race([this.wakeWords.availableNames(), new Promise<string[]>((_, no) => setTimeout(() => no(new Error('no answer in 2 s')), 2000))]).then((available) => ({ available, active: this.wakeWords!.names })).catch((err: Error) => ({ available: [], active: [], error: err.message }))),
      liveVoice: this.liveVoice
        ? { active: this.liveVoice.active, provider: this.liveVoice.provider, voice: this.liveVoice.voice, style: this.liveVoice.style, voices: LIVE_VOICES[this.liveVoice.provider] }
        : undefined,
      lock: this.lock && this.cfg.face.enabled ? { enabled: this.lock.enabled, locked: this.lock.locked, canReset: this.auth.enabled } : undefined,
      screen: this.ambient && this.cfg.face.enabled
        ? { ...this.ambient.settings, photos: this.ambient.photos(), place: this.location?.home?.place || undefined }
        : undefined,
      updates: this.updates && {
        onBox: this.updates.onBox,
        version: this.updates.version(),
        state: this.updates.state(),
        available: this.updates.onBox ? await this.updates.check() : undefined,
        auto: this.updates.auto,
      },
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
            passwordFromEnv: this.auth.fromEnv,
            workApps: this.cfg.memory.workApps,
            activity: this.memory.recentActivity(60),
            today: localToday(),
            todos: this.todos.items(VAULTS, true)
              .filter((x) => x.task.status === 'open' || (x.task.doneAt ?? '') > new Date(Date.now() - 14 * 86400_000).toISOString())
              .map(({ task: t, vault, project }) => ({
                id: t.id,
                title: t.title,
                vault,
                projectId: project?.id,
                projectName: project?.name,
                priority: t.priority === 'normal' ? 'medium' : (t.priority ?? 'medium'),
                criticality: t.criticality ?? 'routine',
                due: t.due,
                assignee: t.assignee,
                done: t.status === 'done',
              })),
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
                meetings: (this.meetings?.list() ?? [])
                  .filter((m) => m.filed?.projectId === p.id)
                  .map((m) => ({ id: m.id, title: m.title, at: m.startedAt ?? m.at, notes: m.notes })),
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
        // Offers Home Assistant's own actions: another Home Assistant, whose device actions Max leaves out.
        duplicate: s.openAiTools.some((t) => t.type === 'function' && this.ha.has(t.function.name)),
        ...s.counts,
        error: s.lastError,
      })),
    };
  }

  private async page(res: ServerResponse, url: URL, req: IncomingMessage): Promise<void> {
    const d = await this.data();
    // Settings > Security: the signed-in devices (only on the page, never in /api/status).
    if (this.auth.enabled) d.devices = this.auth.listDevices(req);
    if (url.searchParams.has('connected')) d.notice = { kind: 'ok', text: 'Signed in. Max can use this app now.' };
    else if (url.searchParams.has('refreshed')) d.notice = { kind: 'ok', text: 'Refreshed.' };
    else if (url.searchParams.get('ok')) d.notice = { kind: 'ok', text: url.searchParams.get('ok')! };
    else if (url.searchParams.get('error')) d.notice = { kind: 'error', text: url.searchParams.get('error')! };
    if (d.memory) {
      d.memory.selected = (VAULTS.includes(url.searchParams.get('vault') as VaultName) ? url.searchParams.get('vault') : 'personal') as VaultName;
      d.memory.query = url.searchParams.get('q') ?? '';
      d.memory.project = url.searchParams.get('project') ?? undefined;
    }
    if (d.soul && SOUL_DOCS.includes(url.searchParams.get('doc') as SoulDoc)) d.soul.doc = url.searchParams.get('doc') as SoulDoc;
    // Home automations (Devices tab): read from Home Assistant only for the page itself.
    if (this.automations?.enabled && d.homeDevices?.enabled) {
      const draftId = url.searchParams.get('automation');
      const draft = draftId ? this.automations.draft(draftId) : undefined;
      try {
        d.automations = { ready: this.home?.state === 'ready', ...(this.home?.state === 'ready' ? await this.automations.list() : { automations: [], switches: [] }), draft };
      } catch (err) {
        d.automations = { ready: false, error: (err as Error).message, automations: [], switches: [], draft };
      }
    }
    const meetingId = url.searchParams.get('meeting');
    const meeting = meetingId ? this.meetings?.get(meetingId) : undefined;
    if (d.meetings && meeting) {
      d.meetings.selected = {
        id: meeting.id,
        title: meeting.title,
        platform: meeting.platform,
        at: meeting.at,
        status: meeting.status,
        lines: meeting.transcript ?? [],
        notes: meeting.notes,
        filed: meeting.filed ? this.projects.byId(meeting.filed.projectId)?.name : undefined,
      };
    }
    // Which tab opens first (a #section in the address, e.g. after saving, takes precedence in the browser).
    const q = url.searchParams;
    d.tab = q.get('tab') ?? (q.has('doc') ? 'max' : q.has('project') ? 'projects' : q.has('vault') || q.has('q') ? 'memory' : q.has('connected') ? 'connections' : undefined);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderPanel(d));
  }

  /** The Devices tab (Home Assistant on the box): its data and actions, all answered as JSON. */
  /** Home automations (Devices tab): describe one, save the draft, turn on or off, run, delete; on/off switches. */
  private async automationsRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const a = this.automations!;
    const f = await readForm(req);
    const back = (msg: string, ok = true, extra = '') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}${extra}#automations`);
    try {
      switch (url.pathname) {
        case '/automations/draft': {
          const r = await a.describe(f.get('text') ?? '', f.get('name') || undefined);
          return r.ok ? back('Here is the draft: check it, then save it.', true, `&automation=${r.draft.id}`) : back(r.message, false);
        }
        case '/automations/save':
          return back(await a.save(f.get('draft') ?? ''));
        case '/automations/discard':
          return back('Draft discarded.');
        case '/automations/on':
          return back(await a.setOn(f.get('entity') ?? '', f.get('on') === '1'));
        case '/automations/rename':
          return back(await a.rename(f.get('id') ?? '', f.get('name') ?? ''));
        case '/automations/run':
          return back(await a.run(f.get('entity') ?? ''));
        case '/automations/delete':
          if (f.get('confirm') !== 'yes') return back('Tick the box to confirm.', false);
          return back(f.get('id') ? await a.remove(f.get('id')!) : await a.removeSwitch(f.get('entity') ?? ''));
        case '/automations/switch':
          await a.ensureSwitch(f.get('name') ?? '');
          return back(`Switch "${(f.get('name') ?? '').trim()}" ready: automations can use it, and Max can turn it on and off.`);
        default:
          return back('Unknown action.', false);
      }
    } catch (err) {
      return back(`Couldn't do that: ${(err as Error).message}`, false);
    }
  }

  /** Meetings page: send Max to a meeting, make him leave, rename, delete, download a transcript. */
  private async meetingsRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const meetings = this.meetings!;
    const back = (msg: string, ok = true, hash = '#meetings', extra = '') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}${extra}${hash}`);
    if (req.method === 'GET' && url.pathname === '/meetings/transcript.txt') {
      const m = meetings.get(url.searchParams.get('id') ?? '');
      if (!m?.transcript) return back('No transcript for that meeting.', false);
      const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      const text = [`${m.title} (${m.platform}, ${new Date(m.at).toLocaleString('en-GB')})`, '', ...m.transcript.map((l) => `[${stamp(l.at)}] ${l.speaker}: ${l.text}`)].join('\n');
      const name = m.title.replace(/[^\w -]+/g, '').trim().slice(0, 60) || 'meeting';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.txt"` }).end(text);
      return;
    }
    if (req.method !== 'POST') return back('Not found.', false);
    const f = await readForm(req);
    switch (url.pathname) {
      case '/meetings/join': {
        const r = await meetings.join(f.get('link') ?? '', f.get('title') ?? '', f.get('project') || undefined);
        return back(r.message, r.ok);
      }
      case '/meetings/leave':
        return back(await meetings.leave(f.get('id') ?? ''));
      case '/meetings/rename': {
        const id = f.get('id') ?? '';
        return back(meetings.rename(id, f.get('title') ?? '') ? 'Renamed.' : 'Not renamed.', true, '#meetings', `&meeting=${encodeURIComponent(id)}`);
      }
      case '/meetings/delete':
        if (f.get('confirm') !== 'yes') return back('Tick the box to confirm.', false, '#meetings', `&meeting=${encodeURIComponent(f.get('id') ?? '')}`);
        return back(meetings.remove(f.get('id') ?? '') ? 'Meeting deleted.' : 'Meeting not found.');
      case '/meetings/file': {
        const id = f.get('id') ?? '';
        const r = await meetings.fileToProject(id, f.get('project') ?? '');
        return back(r.message, r.ok, '#meetings', f.get('from') === 'detail' ? `&meeting=${encodeURIComponent(id)}` : '');
      }
      case '/meetings/unfile':
        return back(meetings.cancelFiling(f.get('id') ?? '') ? "Won't be added to the project." : 'Nothing to cancel.');
      case '/meetings/summarise': {
        const id = f.get('id') ?? '';
        return back(await meetings.resummarise(id), true, '#meetings', `&meeting=${encodeURIComponent(id)}`);
      }
      case '/meetings/speak':
        return back(await meetings.setSpeaks(f.get('on') === '1'));
      case '/meetings/settings':
        return back(await meetings.saveSettings(f.get('owner') ?? '', f.get('bot') ?? ''));
      case '/meetings/check-live':
        return back((await this.meetingsLive?.check()) ?? 'Not set up.');
      case '/meetings/check':
        try {
          return back(await meetings.check());
        } catch (err) {
          return back((err as Error).message, false);
        }
      default:
        return back('Not found.', false);
    }
  }

  private async homeRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const home = this.home!;
    const p = url.pathname;
    try {
      if (req.method === 'GET') {
        if (p === '/api/home') return this.json(res, await home.overview());
        if (p === '/api/home/search') return this.json(res, await home.integrations(url.searchParams.get('q') ?? ''));
        if (p === '/api/home/flow') return this.json(res, await home.getFlow(url.searchParams.get('id') ?? ''));
      } else if (req.method === 'POST') {
        const f = await readForm(req);
        const value = f.get('value');
        if (p === '/home/act') return this.json(res, { message: await home.act(f.get('entity') ?? '', f.get('action') ?? '', value === null ? undefined : Number(value), value ?? undefined) });
        if (p === '/home/layout') {
          let ids: unknown = [];
          try {
            ids = JSON.parse(f.get('favourites') ?? '[]');
          } catch {
            /* nothing to save */
          }
          return this.json(res, { message: home.saveFavourites(ids) });
        }
        if (p === '/home/hide') return this.json(res, { message: await home.hideEntity(f.get('entity') ?? '', f.get('hide') === '1') });
        if (p === '/home/service/remove') return this.json(res, { message: await home.removeService(f.get('entry') ?? '') });
        if (p === '/home/allow') return this.json(res, { message: await home.allowMax(f.get('device') ?? '', f.get('on') === '1') });
        if (p === '/home/edit') return this.json(res, { message: await home.editDevice(f.get('device') ?? '', f.get('name') ?? undefined, f.get('room') ?? undefined) });
        if (p === '/home/update') return this.json(res, { message: await home.requestUpdate() });
        if (p === '/home/password') return this.json(res, { message: await home.resetPassword() });
        if (p === '/home/login') return this.json(res, { message: await home.login(f.get('username') ?? '', f.get('password') ?? '') });
        if (p === '/home/flow/start') return this.json(res, await home.startFlow(f.get('domain') ?? ''));
        if (p === '/home/flow/next') {
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(f.get('data') ?? '{}') as Record<string, unknown>;
          } catch {
            /* an empty step */
          }
          return this.json(res, await home.continueFlow(f.get('flow') ?? '', data));
        }
        if (p === '/home/flow/cancel') {
          await home.cancelFlow(f.get('flow') ?? '');
          return this.json(res, { ok: true });
        }
        if (p === '/home/ignore') {
          await home.ignoreFound(f.get('flow') ?? '');
          return this.json(res, { ok: true });
        }
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"message":"Not found"}');
    } catch (err) {
      const message = (err as Error).message;
      // A step that went wrong comes back as a "stopped" step, so the add-a-device box can say so.
      if (p.startsWith('/home/flow') || p === '/api/home/flow') return this.json(res, { kind: 'stopped', integration: '', title: "That didn't work", text: message });
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message }));
    }
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
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) return undefined;
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

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

/** The host name (no port) of a URL or a bare name. */
function hostOf(v: string): string {
  try {
    return new URL(v.includes('://') ? v : `http://${v}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

/**
 * The panel's own names: localhost, an IP address (how a home network reaches the box), a single-word
 * name or a .local one (max, max.local), plus CONTROL_PANEL_URL's and CONTROL_PANEL_HOSTS. A public
 * name (evil.example) pointed at the box by a website is refused.
 */
function hostAllowed(header: string | undefined, extra: Set<string>): boolean {
  const h = hostOf(header ?? '');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.local') || !h.includes('.') || extra.has(h)) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
}
