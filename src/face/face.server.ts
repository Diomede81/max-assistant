import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { APP_CONFIG, AppConfig } from '../config';
import { FaceInfo, FaceService } from './face.service';
import type { Mouth } from './visemes';
import { renderFace } from './face.page';

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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderFace());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      this.clients.add(res);
      this.send(res, 'info', this.face.info());
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
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
