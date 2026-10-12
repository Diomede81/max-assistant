import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SESSION_MS = 12 * 3600_000;
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60_000;
const COOKIE = 'max_session';

/**
 * Optional password for the control panel (PANEL_PASSWORD), since it shows Max's memory.
 * Sessions are random tokens kept in memory (signing in again after a restart is fine),
 * sent as an HttpOnly cookie. Five wrong passwords lock sign-in for five minutes.
 */
export class PanelAuth {
  private readonly sessions = new Map<string, number>();
  private readonly hash?: Buffer;
  private fails = 0;
  private lockedUntil = 0;

  constructor(password: string) {
    if (password) this.hash = sha(password);
  }

  get enabled(): boolean {
    return !!this.hash;
  }

  allowed(req: IncomingMessage): boolean {
    if (!this.hash) return true;
    const token = cookie(req, COOKIE);
    const until = token ? this.sessions.get(token) : undefined;
    if (!until || until < Date.now()) {
      if (token) this.sessions.delete(token);
      return false;
    }
    return true;
  }

  async handleLogin(req: IncomingMessage, res: ServerResponse, readForm: (r: IncomingMessage) => Promise<URLSearchParams>): Promise<void> {
    if (!this.hash) {
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (req.method === 'POST') {
      if (Date.now() < this.lockedUntil) return page(res, 'Too many attempts. Try again in a few minutes.');
      const pw = (await readForm(req)).get('password') ?? '';
      if (timingSafeEqual(sha(pw), this.hash)) {
        this.fails = 0;
        const token = randomBytes(32).toString('base64url');
        this.sessions.set(token, Date.now() + SESSION_MS);
        res
          .writeHead(302, {
            Location: '/',
            'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`,
          })
          .end();
        return;
      }
      if (++this.fails >= MAX_FAILS) {
        this.fails = 0;
        this.lockedUntil = Date.now() + LOCKOUT_MS;
      }
      return page(res, 'Wrong password.');
    }
    return page(res);
  }

  logout(req: IncomingMessage, res: ServerResponse): void {
    const token = cookie(req, COOKIE);
    if (token) this.sessions.delete(token);
    res.writeHead(302, { Location: '/login', 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }).end();
  }
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

function page(res: ServerResponse, error?: string): void {
  res.writeHead(error ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Max Control Panel</title>
<style>:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--muted:#5d6670;--line:#e3e6ea;--accent:#2f6fed;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--text:#e8eaed;--muted:#9aa3ad;--line:#2b3138;--accent:#6e9bff;--err:#ff8a80}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:360px;margin:12vh auto;padding:0 16px}form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:22px;margin:0 0 12px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);margin-bottom:12px}
button{width:100%;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px;font:inherit;font-weight:600;cursor:pointer}.err{color:var(--err);margin:0 0 12px}</style></head>
<body><main><form method="post" action="/login"><h1>Max</h1>${error ? `<p class="err">${error}</p>` : ''}
<input type="password" name="password" placeholder="Control panel password" autofocus required autocomplete="current-password"><button type="submit">Sign in</button></form></main></body></html>`);
}
