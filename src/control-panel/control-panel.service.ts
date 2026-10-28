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
import { localToday, ProjectsService, taskText, repeatText } from '../memory/projects.service';
import { TodoService } from '../memory/todo.service';
import { daysText, RoutinesService } from '../routines/routines.service';
import { EFFORTS, JobsService, scheduleText } from '../jobs/jobs.service';
import { describe as describeTimer, TimerService } from '../actions/timer.service';
import { CIRCLES, SocialService, TOUCHES } from '../social/social.service';
import { JournalService, MOODS } from '../journal/journal.service';
import { ModelsService, Task, TASKS } from '../models/models.service';
import { requestPower } from '../face/power';
import { DeviceService } from '../device/device.service';
import { UpdatesService } from '../updates/updates.service';
import { AmbientService, FACE_STYLES, FaceStyle } from '../face/ambient.service';
import { TrainsService } from '../trains/trains.service';
import { WhatsAppService, WhatsAppStatus } from '../whatsapp/whatsapp.service';
import { normaliseNumber } from '../whatsapp/contacts';
import { DIETS, GOALS, MealName } from '../health/meals';
import { GROCERS, packsNeeded } from '../health/grocers';
import { ACTIVITY, FITNESS, HealthService, Part, PARTS, PART_IDS, PLAN_PARTS } from '../health/health.service';
import { local } from '../routines/routines.service';
import type { PanelHealth } from './health-page';
import { dismissCard, showCard } from '../face/screen';
import { LockService } from '../lock/lock.service';
import { BackupService } from '../backup/backup.service';
import { RadioService } from '../music/radio.service';
import { AirPlayService } from '../music/airplay.service';
import { LIVE_VOICES, LiveVoiceService } from '../realtime/live-voice.service';
import { PanelData, renderPanel } from './page';
import { HomeService } from '../home/home.service';
import { MicrophoneService } from '../audio/microphone.service';
import { wakeLog } from '../wake-word/wake-log';
import { recentLog } from '../log-buffer';
import { looksLikeHtml } from '../mcp/self-email';
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
  @Optional() @Inject(JobsService) private readonly jobs?: JobsService;
  @Optional() @Inject(TimerService) private readonly timerService?: TimerService;
  @Optional() @Inject(SocialService) private readonly social?: SocialService;
  @Optional() @Inject(JournalService) private readonly journal?: JournalService;
  @Optional() @Inject(ModelsService) private readonly models?: ModelsService;
  @Optional() @Inject(DeviceService) private readonly device?: DeviceService;
  @Optional() @Inject(UpdatesService) private readonly updates?: UpdatesService;
  @Optional() @Inject(AmbientService) private readonly ambient?: AmbientService;
  @Optional() @Inject(LockService) private readonly lock?: LockService;
  @Optional() @Inject(BackupService) private readonly backup?: BackupService;
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
        this.log.error(`${req.method} ${req.url}: ${(err as Error).stack ?? (err as Error).message}`);
        if (res.headersSent) return res.end();
        // Drawing the page itself failed: say so on a plain page rather than redirecting to the page again (a loop).
        const url = req.url ?? '/';
        if (req.method !== 'POST' || /[?&]error=/.test(url)) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(`<!doctype html><meta charset="utf-8"><title>Max</title><body style="font:15px system-ui;padding:24px;max-width:640px"><h1 style="font-size:20px">This page couldn't be drawn</h1><p>${escapeHtml((err as Error).message)}</p><p>The log (Settings → Log, or <code>docker compose logs max</code> on the box) has the details. <a href="/">Try again</a></p></body>`);
        }
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
    if (req.method === 'GET' && url.pathname === '/report.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="max-report.txt"', 'Cache-Control': 'no-store' });
      res.end(await this.report());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/log.txt') {
      const text = recentLog().map((l) => `${new Date(l.at).toISOString()} ${l.level.toUpperCase().padEnd(5)} [${l.context}] ${l.message}`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="max-log.txt"', 'Cache-Control': 'no-store' });
      res.end(text + '\n');
      return;
    }
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
    if (url.pathname.startsWith('/backup/') && this.backup) return this.backupRoute(req, res, url);
    if (req.method === 'POST' && url.pathname === '/timers/cancel' && this.timerService) {
      const f = await readForm(req);
      const gone = this.timerService.cancelById(Number(f.get('id')));
      return this.redirect(res, `/?${gone ? 'ok=Cancelled.' : 'error=Already%20gone.'}#reminders`);
    }
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
    if (req.method === 'POST' && url.pathname === '/device/night' && this.device) {
      const f = await readForm(req);
      const msg = this.device.setNight({ on: f.get('on') === 'yes', from: f.get('from') ?? undefined, to: f.get('to') ?? undefined });
      return this.redirect(res, `/?${/^The /.test(msg) ? 'error' : 'ok'}=${encodeURIComponent(msg)}#device`);
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
    if (req.method === 'POST' && url.pathname.startsWith('/jobs/') && this.jobs) return this.jobAction(req, res, url.pathname.slice('/jobs/'.length));
    if (req.method === 'POST' && url.pathname.startsWith('/people/') && this.social) return this.peopleAction(req, res, url.pathname.slice('/people/'.length));
    if (req.method === 'POST' && url.pathname.startsWith('/journal/') && this.journal) return this.journalAction(req, res, url.pathname.slice('/journal/'.length));
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
        else if (url.pathname === '/whatsapp/read-allow') out = w.allowReading({ name: f.get('name') ?? '', number: f.get('number') ?? undefined, id: f.get('id') ?? undefined });
        else if (url.pathname === '/whatsapp/send-allow') out = w.allowSendingTo(f.get('id') ?? '');
        else if (url.pathname === '/whatsapp/rename') out = { ok: true, message: w.rename(f.get('id') ?? '', f.get('name') ?? '') };
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

  private journalData(jn: JournalService): PanelData['journal'] {
    const today = local().date;
    const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) - i * 86400_000).toISOString().slice(0, 10));
    const all = jn.entries('0000-01-01', today);
    return {
      today,
      days: dates
        .map((date) => {
          const entries = jn.day(date);
          const mood = [...entries].reverse().find((e) => e.mood)?.mood;
          return { date, label: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }), entries: entries.map((e) => ({ id: e.id, at: e.at, text: e.text, source: e.source, mood: e.mood })), mood };
        })
        .filter((d) => d.date === today || d.entries.length),
      reviews: jn.reviews,
      settings: jn.settings,
      moods: MOODS,
      emailReady: Boolean(this.health?.emailTo && this.jobs?.emailReady),
      whatsappReady: Boolean(this.whatsapp?.canMessageSelf),
      calendar: jn.calendarAvailable,
      meetings: Boolean(this.meetings?.enabled),
      personal: jn.open,
      counts: { entries: all.length, days: new Set(all.map((e) => e.date)).size },
    };
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
      shopping: h.shopping.map((i) => ({ ...i, link: h.searchLink(i), remembered: i.pick ? undefined : h.remembered(i), finding: h.finding.has(i.id), qty: i.qty ?? packsNeeded(i.text), cost: h.itemCost(i) })),
      basket: h.basket(),
      grocer: h.grocer,
      grocers: Object.fromEntries(Object.entries(GROCERS).map(([k, g]) => [k, g.name])),
      canFind: Boolean(this.web?.enabled),
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
        return back(h.addShopping(get('item')), true, 'health-shop');
      case 'shop-tick':
        h.tickShopping(get('id'), get('done') === 'yes');
        return this.redirect(res, '/#health-shop');
      case 'shop-add-meals': {
        const meal = get('meal') as MealName;
        return back(h.addIngredients({ date: /^\d{4}-\d{2}-\d{2}$/.test(get('date')) ? get('date') : undefined, meal: ['breakfast', 'lunch', 'dinner'].includes(meal) ? meal : undefined }), true, 'health-shop');
      }
      case 'grocer':
        return back(h.setGrocer(get('grocer')), true, 'health-shop');
      case 'shop-find': {
        const r = await h.findProducts(get('id'));
        return back(r.message, r.ok, 'health-shop');
      }
      case 'shop-find-all':
        return back(h.findAll(), true, 'health-shop');
      case 'shop-pick':
        return back(h.pickProduct(get('id'), get('url')), true, 'health-shop');
      case 'shop-qty':
        h.setQty(get('id'), Number(get('qty')));
        return this.redirect(res, '/#health-shop');
      case 'shop-unpick':
        return back(h.unpickProduct(get('id')), true, 'health-shop');
      case 'shop-clear':
        return back(h.clearBought(), true, 'health-shop');
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
            dailyTime: get('dailyTime') || undefined,
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
      case 'plan-today':
        return back(await h.sendToday(get('id')), true, `plan-${get('id')}`);
      case 'plan-delete':
        if (f.get('confirm') !== 'yes') return back('Tick the box to confirm.', false, `plan-${get('id')}`);
        return back(h.deletePlan(get('id')), true, 'health-plans');
    }
    return back('Unknown action.', false);
  }

  private async journalAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const jn = this.journal!;
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const back = (msg: string, ok = true, anchor = 'journal') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#${anchor}`);
    switch (action) {
      case 'add': {
        const msg = jn.add(get('text'), { date: get('date') || undefined, mood: get('mood') || undefined, source: 'panel' });
        return back(msg, msg.startsWith('Noted'), get('date') ? `journal-${get('date')}` : 'journal');
      }
      case 'delete':
        return back(jn.remove(get('id')));
      case 'review': {
        const period = get('period') === 'month' ? 'month' : 'week';
        const r = await jn.review(period, true);
        return back(typeof r === 'string' ? r : `Your ${period}ly review is written.`, typeof r !== 'string', 'journal-reviews');
      }
      case 'settings':
        return back(jn.saveSettings({ reviewDay: get('reviewDay'), reviewTime: get('reviewTime'), eventsTime: get('eventsTime'), monthly: f.get('monthly') === 'yes', email: f.get('email') === 'yes', whatsapp: f.get('whatsapp') === 'yes', captureMeetings: f.get('captureMeetings') === 'yes', captureEvents: f.get('captureEvents') === 'yes' }), true, 'journal-settings');
      default:
        res.writeHead(404).end();
    }
  }

  private async peopleAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const so = this.social!;
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const id = get('id');
    const back = (msg: string, ok = true, anchor = id ? `person-${id}` : 'people') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#${anchor}`);
    if (action === 'reminders') {
      const msg = so.saveNudge({ speak: f.get('speak') === 'yes', screen: f.get('screen') === 'yes', time: get('time') || undefined, laterDays: get('laterDays') });
      return back(msg, !/^(The time|"Later")/.test(msg), 'people-reminders');
    }
    if (action === 'save') {
      const msg = so.save({ name: get('name'), circle: get('circle'), relation: get('relation'), every: get('every'), phone: get('phone'), email: get('email'), birthday: get('birthday'), ...(id ? {} : { interests: get('interests') }) }, id || undefined);
      const ok = /^(Added|Updated)/.test(msg);
      const created = !id && ok ? so.people[so.people.length - 1] : undefined;
      return back(msg, ok, created ? `person-${created.id}` : id ? `person-${id}` : 'person-new');
    }
    const p = so.byId(id);
    if (!p) return back('That person is no longer on the list.', false, 'people');
    switch (action) {
      case 'log':
        return back(so.touch(p, get('kind') || 'spoke', get('text') || undefined, get('date') || undefined));
      case 'news':
        return back(so.addUpdate(p, get('text')));
      case 'interests':
        return back(so.addInterests(p, get('text')));
      case 'update-remove':
        so.removeUpdate(p, get('at'));
        return back('Removed.');
      case 'later':
        return back(so.snooze(p), true, 'people');
      case 'delete':
        if (get('confirm') !== 'yes') return back('Tick the box to confirm.', false);
        return back(so.remove(p.id), true, 'people');
      default:
        res.writeHead(404).end();
    }
  }

  private async jobAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const js = this.jobs!;
    const f = await readForm(req);
    const get = (k: string) => (f.get(k) ?? '').trim();
    const id = get('id');
    const back = (msg: string, ok = true, anchor = id ? `job-${id}` : 'jobs') => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#${anchor}`);
    const job = js.jobs.find((x) => x.id === id);
    if (action !== 'save' && !job) return back('That scheduled task no longer exists.', false, 'jobs');
    switch (action) {
      case 'save': {
        const kind = get('kind');
        const msg = js.save(
          {
            name: get('name'),
            brief: get('brief'),
            time: get('time'),
            days: kind === 'days' ? f.getAll('days').map(Number) : undefined,
            once: kind === 'once' ? get('once') : undefined,
            monthDay: kind === 'month' ? Number(get('monthDay')) : undefined,
            effort: get('effort'),
            provider: get('provider'),
            model: get('model'),
            say: f.get('say') === 'yes',
            email: f.get('email') === 'yes',
            whatsapp: f.get('whatsapp') === 'yes',
            emailTo: get('emailTo'),
            whatsappTo: f.getAll('whatsappTo'),
            vault: get('vault'),
            ...(id ? { enabled: f.get('enabled') === 'yes' } : {}),
          },
          id || undefined,
        );
        const ok = /^(Created|Saved)/.test(msg);
        const created = !id && ok ? js.jobs[js.jobs.length - 1] : undefined;
        return back(msg, ok, created ? `job-${created.id}` : id ? `job-${id}` : 'job-new');
      }
      case 'sources':
        return back(js.setSources(job!.id, f.getAll('url')));
      case 'test-email':
        return back(await js.testEmail(job!.id));
      case 'run':
        void js.run(job!.id, true);
        return back(`Running ${job!.name}: ${EFFORTS[job!.effort].help}. Refresh this page to see the result.`);
      case 'toggle':
        return back(js.save({ enabled: !job!.enabled }, job!.id).replace(/^Saved/, job!.enabled ? 'Paused' : 'Resumed'));
      case 'delete':
        if (get('confirm') !== 'yes') return back('Tick the box to confirm deleting the task.', false);
        js.remove(job!.id);
        return back(`Deleted ${job!.name}.`, true, 'jobs');
      default:
        res.writeHead(404).end();
    }
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
      const msg = this.todos.add({ title: get('title'), priority: get('priority'), criticality: get('criticality'), due: due || undefined, project, vault: get('vault'), assignee: get('assignee'), repeat: get('repeat') || undefined }, true);
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
          { priority: get('priority'), criticality: get('criticality'), due: f.has('date') ? due : undefined, moveTo: get('project') === 'none' ? 'none' : (project ?? undefined), repeat: f.has('repeat') ? get('repeat') || 'none' : undefined },
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
      whatsapp: await this.whatsappStatus(),
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
      journal: this.journal && this.memory.enabled && this.modes.mode !== 'guest' ? this.journalData(this.journal) : undefined,
      people: this.social && this.memory.enabled && this.modes.mode !== 'guest'
        ? {
            list: this.social.people.map((x) => {
              const bday = this.social!.birthdaysSoon(366).find((b) => b.person.id === x.id);
              return {
                id: x.id, name: x.name, circle: x.circle, circleLabel: CIRCLES[x.circle]?.label ?? x.circle, relation: x.relation, every: this.social!.every(x), everySet: x.every !== undefined,
                phone: x.phone, email: x.email, birthday: x.birthday, birthdayInDays: bday?.inDays, snoozedUntil: x.snoozedUntil && x.snoozedUntil > localToday() ? x.snoozedUntil : undefined, interests: x.interests, updates: x.updates,
                touches: x.touches.map((t) => ({ ...t, kindLabel: TOUCHES[t.kind] ?? t.kind })), daysSince: this.social!.daysSince(x), overdue: this.social!.overdueDays(x),
              };
            }),
            circles: Object.entries(CIRCLES).map(([id, c]) => ({ id, label: c.label, every: c.every })),
            touches: Object.entries(TOUCHES).map(([id, label]) => ({ id, label })),
            whatsapp: Boolean(this.whatsapp?.canMessageSelf),
            chats: this.whatsapp?.knownPeople ?? [],
            personal: this.social.open,
            nudge: this.social.nudge,
            screen: this.cfg.face.enabled,
          }
        : undefined,
      timers: this.timerService?.list().map((t) => ({ id: t.id, text: describeTimer(t).replace(/^reminder "(.*)"$/, 'Reminder: $1'), at: t.endsAt, missed: t.missed })),
      jobs: this.jobs && this.memory.enabled && this.models
        ? {
            list: this.jobs.jobs.map((x) => ({ ...x, modelText: this.jobs!.modelText(x), scheduleText: scheduleText(x), running: this.jobs!.isRunning(x.id), retryAt: x.retryAt })),
            providers: this.models.providers().map((p) => ({ id: p.id, label: p.label, configured: p.configured, setting: p.setting })),
            defaultModel: this.models.describe('jobs'),
            efforts: Object.entries(EFFORTS).map(([id, e]) => ({ id, label: e.label, help: e.help })),
            emailReady: this.jobs.emailReady,
            emailTo: this.health?.emailTo,
            whatsappReady: this.jobs.whatsappReady,
            people: this.whatsapp ? (await this.whatsapp.status()).allowed.map((a) => ({ name: a.name, number: a.number, shown: a.shown })) : [],
          }
        : undefined,
      models: this.models && (await this.modelsData(this.models)),
      onBox: this.cfg.face.onBox,
      device: this.device && { ...(await this.device.status()), mic: this.mic?.canMute ? { muted: this.mic.muted } : undefined },
      log: recentLog(),
      wakeUps: { list: wakeLog(), verify: this.cfg.wakeWord.verify, channel: this.cfg.audio.inputChannel },
      wakeWords: this.wakeWords && (await Promise.race([this.wakeWords.availableNames(), new Promise<string[]>((_, no) => setTimeout(() => no(new Error('no answer in 2 s')), 2000))]).then((available) => ({ available, active: this.wakeWords!.names })).catch((err: Error) => ({ available: [], active: [], error: err.message }))),
      liveVoice: this.liveVoice
        ? { active: this.liveVoice.active, provider: this.liveVoice.provider, voice: this.liveVoice.voice, style: this.liveVoice.style, voices: LIVE_VOICES[this.liveVoice.provider] }
        : undefined,
      lock: this.lock && this.cfg.face.enabled ? { enabled: this.lock.enabled, locked: this.lock.locked, canReset: this.auth.enabled } : undefined,
      backup: this.backup?.status(),
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
                repeat: t.repeat ? `${t.repeat.unit}:${t.repeat.every}` : undefined,
                repeatText: t.repeat ? repeatText(t.repeat) : undefined,
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

  private async backupRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const b = this.backup!;
    const p = url.pathname;
    const back = (msg: string, ok: boolean) => this.redirect(res, `/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}#backup`);
    try {
      if (req.method === 'GET' && p === '/backup/download') {
        const { name, data } = b.make();
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
        res.end(data);
        return;
      }
      if (req.method !== 'POST') return this.redirect(res, '/#backup');
      if (p === '/backup/restore') {
        const data = await readBody(req, MAX_BACKUP_BYTES);
        if (!data) return this.json(res, { error: 'That file is too large (1 GB at most).' });
        const out = b.restore(data);
        return this.json(res, out.ok ? { files: out.files, home: out.home } : { error: out.error });
      }
      if (p === '/backup/key') return this.json(res, { key: b.secret() });
      const f = await readForm(req);
      if (p === '/backup/now') {
        const msg = b.toFolder();
        return back(msg, msg.startsWith('Backup saved'));
      }
      if (p === '/backup/auto') {
        const msg = b.setAuto(f.get('auto') === 'yes', f.get('time') ?? undefined, f.get('keep') ?? undefined);
        return back(msg, !/^(The time|Keep)/.test(msg));
      }
      res.writeHead(404).end();
    } catch (err) {
      const message = (err as Error).message;
      this.log.error(`Backup: ${message}`);
      if (p === '/backup/restore' || p === '/backup/key') return this.json(res, { error: message, message });
      return back(message, false);
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
        if (p === '/home/password/show') return this.json(res, home.showPassword() ?? { message: 'Max did not make this account, so it has no password to show.' });
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

  /**
   * One text file with what's needed to look into a problem: the version, the mode, each scheduled
   * task's last run (status, problems, how the result starts), the WhatsApp and connection state, and
   * the log. No API keys, no message text, no memory.
   */
  private async report(): Promise<string> {
    const v = this.updates?.version();
    const out: string[] = [
      `Max support report · ${new Date().toISOString()}`,
      `Version: ${v ? `${v.subject} (${v.sha.slice(0, 7)}, ${v.date}, ${v.branch})` : 'unknown'}`,
      `Mode: ${this.modes.mode} · on the box: ${this.cfg.face.onBox} · voice: ${this.cfg.voiceMode} · memory: ${this.memory.enabled}`,
      `Main model: ${this.cfg.llm.model} at ${this.cfg.llm.baseUrl.replace(/\/v1\/?$/, '')}`,
      '',
    ];
    if (this.models) {
      out.push('Model assignments:');
      for (const t of Object.keys(TASKS) as Task[]) out.push(`  ${TASKS[t].label}: ${this.models.describeAssignment(this.models.assignment(t))}`);
      out.push('');
    }
    if (this.jobs) {
      out.push('Scheduled tasks:');
      for (const j of this.jobs.jobs) {
        out.push(`  ${j.name} · ${j.enabled ? 'on' : 'paused'} · effort ${j.effort}${j.provider ? ` · ${j.provider} ${j.model ?? ''}` : ''} · say ${j.say} email ${j.email} whatsapp ${j.whatsapp} · also to ${[...j.emailTo, ...j.whatsappTo].join(', ') || 'nobody'}`);
        out.push(`    brief: ${j.brief.replace(/\s+/g, ' ').slice(0, 300)}`);
        for (const r of j.runs.slice(0, 3)) {
          out.push(`    run ${r.at}: ${r.status} in ${r.seconds}s, ${r.actions} actions, attempt ${r.attempt}; sent: ${r.sent.join(', ') || 'nothing'}; failed: ${r.failed.join(', ') || 'nothing'}`);
          for (const p of r.problems) out.push(`      problem: ${p.what} | fix: ${p.fix}`);
          out.push(`      result: ${r.text.length} chars, ${looksLikeHtml(r.text) ? 'HTML' : 'text'}, starts: ${r.text.replace(/\s+/g, ' ').slice(0, 200)} … ends: ${r.text.replace(/\s+/g, ' ').slice(-120)}`);
        }
      }
      out.push('');
    }
    if (this.whatsapp) {
      const w = await this.whatsapp.status();
      out.push(`WhatsApp: ${w.state}${w.note ? ` · ${w.note}` : ''} · chat with Max ${w.chat}`);
      out.push(`  sees: ${w.readable.map((r) => `${r.name} (${r.group ? 'group' : r.shown})`).join(', ') || 'only your own chat'}`);
      out.push(`  sends to: ${w.allowed.map((a) => `${a.name} (${a.shown})`).join(', ') || 'nobody'}`);
      if (w.received) out.push(`  since start: ${w.received.messages} received, ${w.received.unreadable} unreadable, ${w.received.ignored} dropped, ${w.received.kept} kept in ${w.received.chats} chats; latest: ${w.received.recent.map((c) => `${c.name} (${c.messages})`).join(', ')}`);
      const trace = (w as { trace?: { at: number; chat: string; via: string; what: string }[] }).trace;
      if (trace?.length) for (const t of trace.slice(0, 40)) out.push(`  ${new Date(t.at).toISOString()} ${t.chat} · ${t.via} · ${t.what}`);
      out.push('');
    }
    out.push(`Apps: ${this.composio.enabled ? 'Composio on' : 'Composio off'}${this.composio.lastError ? ` (${this.composio.lastError})` : ''} · Home Assistant: ${this.ha.openAiTools.length} actions · MCP servers: ${this.mcp.tools.length} tools`);
    out.push('', 'Log:');
    for (const l of recentLog()) out.push(`${new Date(l.at).toISOString()} ${l.level.toUpperCase().padEnd(5)} [${l.context}] ${l.message}`);
    return `${out.join('\n')}\n`;
  }

  /** The WhatsApp page's data, with the names from your People list filled in where WhatsApp only has a number or an initial. */
  private async whatsappStatus(): Promise<WhatsAppStatus | undefined> {
    const w = await this.whatsapp?.status();
    if (!w || !this.social) return w;
    const byNumber = new Map<string, string>();
    for (const p of this.social.people) {
      const n = p.phone && normaliseNumber(p.phone);
      if (n) byNumber.set(n, p.name);
    }
    for (const k of w.known) {
      const mine = k.sendId && !k.group ? byNumber.get(k.sendId) : undefined;
      if (mine && (k.name.length <= 2 || /^(\+|Someone)/.test(k.name) || k.name === k.shown)) k.name = `${mine}`;
    }
    return w;
  }

  private json(res: ServerResponse, body: unknown): void {
    // Never cached: these answers carry personal data (and the dashboard always wants the latest anyway).
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body, null, 2));
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
const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
