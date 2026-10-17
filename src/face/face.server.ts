import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DeviceService, STEP } from '../device/device.service';
import { UpdatesService } from '../updates/updates.service';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { FaceInfo, FaceService } from './face.service';
import type { Mouth } from './visemes';
import { renderFace } from './face.page';
import { AmbientService } from './ambient.service';
import { LockService } from '../lock/lock.service';
import { AirPlayService } from '../music/airplay.service';
import { ModesService } from '../memory/modes.service';

/** The 3D face's library (three.js), served from Max's own files: the screen needs no internet for it. */
const VENDOR: Record<string, string> = {
  '/vendor/three.module.min.js': 'build/three.module.min.js',
  '/vendor/RoomEnvironment.js': 'examples/jsm/environments/RoomEnvironment.js',
};
const vendorCache = new Map<string, Buffer>();
function vendorFile(path: string): Buffer | undefined {
  const rel = VENDOR[path];
  if (!rel) return undefined;
  if (!vendorCache.has(path)) {
    try {
      vendorCache.set(path, readFileSync(join(dirname(require.resolve('three')), '..', rel)));
    } catch {
      return undefined;
    }
  }
  return vendorCache.get(path);
}

/** Changes every time Max starts: an open face page from before an update reloads itself. */
const BOOT_ID = `${Date.now().toString(36)}-${process.pid}`;

/**
 * Serves the face page for the box's screen and streams Max's state to it (Server-Sent
 * Events): `info` when anything changes, `level` (mouth shape) 20 times a second while he talks.
 * Listens on this machine only (FACE_HOST / FACE_PORT, default 127.0.0.1:8098).
 */
@Injectable()
export class FaceServer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Face');
  private server?: Server;
  private readonly clients = new Set<ServerResponse>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly face: FaceService,
    @Optional() private readonly device?: DeviceService,
    @Optional() private readonly updates?: UpdatesService,
    @Optional() private readonly ambient?: AmbientService,
    @Optional() private readonly lock?: LockService,
    @Optional() private readonly airplay?: AirPlayService,
    @Optional() private readonly modes?: ModesService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.face.enabled) return;
    const { port, host } = this.cfg.face;
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.on('error', (err) => this.log.error(`Face screen server unavailable: ${err.message}`));
    this.server.listen(port, host, () => this.log.log(`Face screen: http://localhost:${port}`));
    this.face.on('info', (info: FaceInfo) => this.broadcast('info', info));
    const r = (v: number) => Math.round(v * 100) / 100;
    this.face.on('level', (m: Mouth) => this.broadcast('level', { o: r(m.o), w: r(m.w), r: r(m.r), s: r(m.s) }));
    this.heartbeat = setInterval(() => this.broadcast('info', this.face.info()), 15_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.end();
    this.server?.close();
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderFace(BOOT_ID));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      this.send(res, 'hello', { boot: BOOT_ID });
      this.clients.add(res);
      this.send(res, 'info', this.face.info());
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/vendor/')) {
      const f = vendorFile(url.pathname);
      if (!f) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      else res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400' }).end(f);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/photos/')) {
      // The evening photo frame's pictures (uploaded on the control panel).
      const p = this.ambient?.photo(url.pathname.slice('/photos/'.length));
      if (!p) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      else res.writeHead(200, { 'Content-Type': p.type, 'Cache-Control': 'max-age=86400' }).end(p.data);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/airplay-cover') {
      // The album art of what's playing over AirPlay (the music card). Nothing while Max is locked.
      const c = this.lock?.locked ? undefined : this.airplay?.cover;
      if (!c) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      else res.writeHead(200, { 'Content-Type': c.type, 'Cache-Control': 'max-age=3600' }).end(c.data);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (url.pathname === '/update' && this.updates) {
      // The screen menu's Update button: what's new (GET), install it (POST). Same origin only.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      const u = this.updates;
      const send = (data: unknown) => res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
      if (req.method === 'POST') {
        const message = u.request('screen');
        send({ ok: message.startsWith('Updating'), message });
        return;
      }
      void (async () => {
        const state = u.state();
        if (u.busy) return send({ onBox: u.onBox, busy: true, message: state?.message ?? 'An update is running.' });
        const a = u.onBox ? await u.check(true) : undefined;
        send({ onBox: u.onBox, behind: a?.behind ?? 0, changes: a?.changes ?? [], error: u.onBox && !a ? 'The installed version is unknown.' : a?.error });
      })();
      return;
    }
    if (url.pathname === '/device' && this.device) {
      // Volume and brightness from the screen's menu. Only the screen itself (same origin).
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      void (async () => {
        const d = this.device!;
        const v = url.searchParams.get('volume');
        const b = url.searchParams.get('brightness');
        if (req.method === 'POST' && v) await (v === 'up' ? d.changeVolume(STEP) : v === 'down' ? d.changeVolume(-STEP) : d.setVolume(Number(v)));
        if (req.method === 'POST' && b) b === 'up' ? d.changeBrightness(STEP) : b === 'down' ? d.changeBrightness(-STEP) : d.setBrightness(Number(b));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ...(await d.status()), onBox: this.cfg.face.onBox }));
      })();
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/card' || url.pathname === '/tap')) {
      // Buttons on a card, and a short tap on the face. Only the screen itself (same origin).
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      void (async () => {
        const ok = url.pathname === '/tap' ? (await this.face.tapped(), true) : await this.face.cardAction(url.searchParams.get('id') ?? '', url.searchParams.get('action') ?? '');
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/plain' }).end(ok ? 'ok' : 'gone');
      })();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dim') {
      // The page dims itself after a quiet spell; on the box the backlight goes down too. Same origin only.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      const backlight = this.device?.dim(url.searchParams.get('on') === '1', this.ambient?.settings.dimLevel ?? 20) ?? false;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ backlight }));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/unlock' || url.pathname === '/lock') && this.lock) {
      // The start-up code keypad, and the menu's Lock. Only the screen itself (same origin).
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      const lock = this.lock;
      void (async () => {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 200) break;
        }
        const out = url.pathname === '/lock' ? { ok: lock.lock(), message: '' } : lock.unlock(new URLSearchParams(body).get('code') ?? '');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(out));
        this.broadcast('info', this.face.info());
      })();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/guest/leave' && this.lock && this.modes) {
      // Leaving guest mode from the screen: only with the household's start-up code.
      if (!sameOrigin(req)) {
        res.writeHead(403).end();
        return;
      }
      const lock = this.lock;
      const modes = this.modes;
      void (async () => {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 200) break;
        }
        const out = lock.verify(new URLSearchParams(body).get('code') ?? '');
        if (out.ok) {
          modes.set('auto');
          this.log.log('Left guest mode with the start-up code');
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(out));
        this.broadcast('info', this.face.info());
      })();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/wifi-cancel') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      const ok = this.face.cancelWifiSetup();
      res.writeHead(ok ? 202 : 503, { 'Content-Type': 'text/plain' }).end(ok ? 'cancelled' : 'Only available on the Max box');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/power') {
      // Only the screen itself (same origin, and this port is only open on the box) may do this.
      const origin = req.headers.origin;
      const action = url.searchParams.get('action');
      if ((origin && new URL(origin).host !== req.headers.host) || (action !== 'poweroff' && action !== 'reboot')) {
        res.writeHead(403).end();
        return;
      }
      const ok = this.face.requestPower(action);
      res.writeHead(ok ? 202 : 503, { 'Content-Type': 'text/plain' }).end(ok ? 'requested' : 'Only available on the Max box');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/wifi-setup') {
      // Only the screen itself (same origin) may ask for WiFi setup.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403).end();
        return;
      }
      const ok = this.face.requestWifiSetup();
      res.writeHead(ok ? 202 : 503, { 'Content-Type': 'text/plain' }).end(ok ? 'requested' : 'WiFi setup is only available on the Max box');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }

  private broadcast(event: string, data: unknown): void {
    for (const c of this.clients) this.send(c, event, data);
  }

  private send(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/** The request comes from the screen itself (same origin), or from no page at all (curl on the box). */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false; // "null" or garbage
  }
}
