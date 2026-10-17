import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { SealedStore } from '../memory/sealed-store';

/** A device stays signed in this long after it was allowed (or until signed out / removed). */
const DEVICE_MS = 30 * 24 * 3600_000;
/** How long a sign-in waits for Allow on Max's screen. */
const APPROVAL_MS = 2 * 60_000;
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60_000;
const COOKIE = 'max_device';
const PENDING_COOKIE = 'max_signin';
const MIN_PASSWORD = 8;
/** The code Max shows on his screen to create the password (proves you're at home). */
const SETUP_CODE_MS = 5 * 60_000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

interface Saved {
  salt?: string;
  hash?: string;
}

/** A signed-in device: only a fingerprint of its key is kept. */
export interface PanelDevice {
  id: string;
  label: string;
  created: number;
  lastUsed: number;
  expires: number;
}
interface StoredDevice extends PanelDevice {
  hash: string;
}

export interface PanelAuthOptions {
  /** PANEL_PASSWORD from .env (wins over the one chosen on the panel). */
  envPassword: string;
  /** A password is required (on the box, where the panel is reachable from the home network). */
  required: boolean;
  /** Where the chosen password's fingerprint is kept. */
  dir: string;
  /** Shows the setup code on Max's screen. */
  showCode: (code: string, ttlMs: number) => void;
  /**
   * New devices are allowed on Max's screen after the password (on the box). Shows the request with
   * Allow / Deny; `answer` is called with the choice. Undefined: the password alone signs in.
   */
  askOnScreen?: (device: string, ttlMs: number, answer: (allowed: boolean) => void) => void;
}

/**
 * The control panel's password, since it shows Max's memory and can turn the box off.
 *
 * On the box it's required. The first visit asks to choose one, and to prove you're at home, to type
 * the 6-digit code Max shows on his screen at that moment (someone on the WiFi but not in the room
 * can't). PANEL_PASSWORD in .env works too, and wins. Only a scrypt fingerprint of a chosen password
 * is stored. Five wrong passwords pause sign-in from that device for five minutes.
 *
 * Signing in on a new phone or computer takes two steps: the password, then Allow on Max's screen
 * (something you know, and being at home). The device then stays signed in for 30 days: a random key
 * in an HttpOnly cookie, of which only a fingerprint is stored. Devices are listed in Settings >
 * Security, where they can be removed; changing the password signs out all the others.
 */
export class PanelAuth {
  private readonly log = new Logger('ControlPanel');
  private readonly envHash?: Buffer;
  private readonly store: SealedStore<Saved>;
  private saved: Saved = {};
  private readonly deviceStore: SealedStore<{ devices: StoredDevice[] }>;
  private devices: StoredDevice[] = [];
  /** Sign-ins waiting for Allow on the screen, by their own random id (in a short-lived cookie). */
  private readonly pending = new Map<string, { who: string; label: string; until: number; state: 'waiting' | 'allowed' | 'denied' }>();
  private readonly fails = new Map<string, { n: number; until: number }>();
  private setup?: { code: string; until: number; tries: number };

  constructor(private readonly opts: PanelAuthOptions) {
    if (opts.envPassword) this.envHash = sha(opts.envPassword);
    this.store = new SealedStore(opts.dir, 'panel-password');
    try {
      this.saved = this.store.load() ?? {};
    } catch {
      // none chosen yet
    }
    this.deviceStore = new SealedStore(opts.dir, 'panel-devices');
    try {
      this.devices = (this.deviceStore.load()?.devices ?? []).filter((d) => d.expires > Date.now());
    } catch {
      // none yet
    }
  }

  /** The panel asks for a password. */
  get enabled(): boolean {
    return Boolean(this.envHash || this.saved.hash);
  }

  /** Set in .env (then it can't be changed from the panel). */
  get fromEnv(): boolean {
    return Boolean(this.envHash);
  }

  /** Required but not chosen yet: the first visit creates it. */
  get needsSetup(): boolean {
    return this.opts.required && !this.enabled;
  }

  allowed(req: IncomingMessage): boolean {
    if (!this.enabled) return !this.opts.required;
    return Boolean(this.device(req));
  }

  /** The signed-in device making this request (its cookie's key matches a remembered, unexpired device). */
  private device(req: IncomingMessage): StoredDevice | undefined {
    const token = cookie(req, COOKIE);
    if (!token) return undefined;
    const hash = sha(token).toString('base64');
    const d = this.devices.find((x) => x.hash === hash);
    if (!d || d.expires < Date.now()) return undefined;
    if (Date.now() - d.lastUsed > 3600_000) {
      d.lastUsed = Date.now();
      this.saveDevices();
    }
    return d;
  }

  async handleLogin(req: IncomingMessage, res: ServerResponse, readForm: (r: IncomingMessage) => Promise<URLSearchParams>): Promise<void> {
    if (this.needsSetup) return this.handleSetup(req, res, readForm);
    if (!this.enabled) {
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/login/wait') return this.wait(req, res);
    if (req.method === 'POST') {
      const who = client(req);
      const paused = this.paused(who);
      if (paused) return page(res, `Too many attempts. Try again in ${Math.ceil(paused / 60_000)} min.`);
      const pw = (await readForm(req)).get('password') ?? '';
      if (!this.matches(pw)) {
        this.failed(who);
        return page(res, 'Wrong password.');
      }
      this.fails.delete(who);
      const label = deviceName(req.headers['user-agent']);
      if (!this.opts.askOnScreen) return this.trust(res, label);
      return this.askOnScreen(res, who, label);
    }
    return page(res);
  }

  /** The password was right: Max's screen asks Allow / Deny, and this page waits for the answer. */
  private askOnScreen(res: ServerResponse, who: string, label: string): void {
    for (const [id, p] of this.pending) if (p.who === who || p.until < Date.now()) this.pending.delete(id); // one at a time per device
    const id = randomBytes(24).toString('base64url');
    const request = { who, label, until: Date.now() + APPROVAL_MS, state: 'waiting' as 'waiting' | 'allowed' | 'denied' };
    this.pending.set(id, request);
    this.opts.askOnScreen!(label, APPROVAL_MS, (allowed) => {
      if (this.pending.get(id) !== request || request.until < Date.now()) return;
      request.state = allowed ? 'allowed' : 'denied';
      this.log.log(`Control panel sign-in from ${label} (${who}) ${allowed ? 'allowed' : 'denied'} on the screen`);
    });
    res.setHeader('Set-Cookie', `${PENDING_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/login; Max-Age=${APPROVAL_MS / 1000}`);
    waitingPage(res, label);
  }

  /** The waiting page asks every two seconds: allowed (the device is signed in), denied, or still waiting. */
  private wait(req: IncomingMessage, res: ServerResponse): void {
    const id = cookie(req, PENDING_COOKIE) ?? '';
    const p = this.pending.get(id);
    const json = (state: string, extra: Record<string, string> = {}): void => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }).end(JSON.stringify({ state }));
    };
    if (!p || p.until < Date.now() || p.who !== client(req)) {
      if (p) this.pending.delete(id);
      return json('expired');
    }
    if (p.state === 'waiting') return json('waiting');
    this.pending.delete(id);
    if (p.state === 'denied') return json('denied');
    const token = this.addDevice(p.label);
    json('allowed', { 'Set-Cookie': deviceCookie(token) });
  }

  private trust(res: ServerResponse, label: string): void {
    const token = this.addDevice(label);
    res.writeHead(302, { Location: '/', 'Set-Cookie': deviceCookie(token) }).end();
  }

  private addDevice(label: string): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.devices = this.devices.filter((d) => d.expires > now);
    this.devices.push({ id: randomBytes(6).toString('hex'), hash: sha(token).toString('base64'), label, created: now, lastUsed: now, expires: now + DEVICE_MS });
    if (this.devices.length > 30) this.devices = this.devices.slice(-30);
    this.saveDevices();
    return token;
  }

  private saveDevices(): void {
    this.deviceStore.save({ devices: this.devices }).catch((err) => this.log.error(`Could not save the signed-in devices: ${(err as Error).message}`));
  }

  /** Settings > Security: the signed-in devices (which one is this). */
  listDevices(req: IncomingMessage): (PanelDevice & { current: boolean })[] {
    const me = this.device(req);
    return this.devices
      .filter((d) => d.expires > Date.now())
      .map(({ hash: _h, ...d }) => ({ ...d, current: d.id === me?.id }))
      .sort((a, b) => b.lastUsed - a.lastUsed);
  }

  /** Settings > Security: sign a device out ("all": every one except this). */
  removeDevice(req: IncomingMessage, id: string): string {
    const me = this.device(req);
    const before = this.devices.length;
    this.devices = id === 'all' ? this.devices.filter((d) => d.id === me?.id) : this.devices.filter((d) => d.id !== id);
    this.saveDevices();
    const n = before - this.devices.length;
    return id === 'all' ? `Signed out ${n} other device${n === 1 ? '' : 's'}.` : n ? 'Device signed out.' : 'That device was already signed out.';
  }

  /** Settings > Security: a new password (the current one first). */
  change(req: IncomingMessage, current: string, next: string, again: string): { ok: boolean; message: string } {
    if (this.envHash) return { ok: false, message: 'The password is set in .env (PANEL_PASSWORD): change it there.' };
    if (!this.matches(current)) return { ok: false, message: 'The current password is wrong.' };
    const bad = weak(next, again);
    if (bad) return { ok: false, message: bad };
    const me = this.device(req);
    this.choose(next);
    // Every other device signs in again with the new password.
    this.devices = this.devices.filter((d) => d.id === me?.id);
    this.saveDevices();
    return { ok: true, message: 'Password changed. Other devices will need to sign in again.' };
  }

  logout(req: IncomingMessage, res: ServerResponse): void {
    const me = this.device(req);
    if (me) {
      this.devices = this.devices.filter((d) => d.id !== me.id);
      this.saveDevices();
    }
    res.writeHead(302, { Location: '/login', 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }).end();
  }

  // ---------- First visit on the box: choose a password, with the code shown on Max's screen ----------

  private async handleSetup(req: IncomingMessage, res: ServerResponse, readForm: (r: IncomingMessage) => Promise<URLSearchParams>): Promise<void> {
    const who = client(req);
    if (req.method !== 'POST') {
      this.newSetupCode();
      return setupPage(res);
    }
    const paused = this.paused(who);
    if (paused) return setupPage(res, `Too many attempts. Try again in ${Math.ceil(paused / 60_000)} min.`);
    const f = await readForm(req);
    const s = this.setup;
    const code = (f.get('code') ?? '').replace(/\D/g, '');
    if (!s || Date.now() > s.until) {
      this.newSetupCode();
      return setupPage(res, 'That code has expired: Max is showing a new one.');
    }
    if (code.length !== 6 || !timingSafeEqual(sha(code), sha(s.code))) {
      this.failed(who);
      if (++s.tries >= MAX_FAILS) this.newSetupCode();
      return setupPage(res, 'Wrong code. Type the 6 digits Max is showing on his screen.');
    }
    const pw = f.get('password') ?? '';
    const bad = weak(pw, f.get('again') ?? '');
    if (bad) return setupPage(res, bad);
    this.setup = undefined;
    this.fails.delete(who);
    this.choose(pw);
    this.log.log('Control panel password chosen (with the code on the screen)');
    return this.trust(res, deviceName(req.headers['user-agent']));
  }

  private newSetupCode(): void {
    if (this.setup && Date.now() < this.setup.until - 60_000) {
      this.opts.showCode(this.setup.code, this.setup.until - Date.now()); // still valid: show it again
      return;
    }
    this.setup = { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), until: Date.now() + SETUP_CODE_MS, tries: 0 };
    this.opts.showCode(this.setup.code, SETUP_CODE_MS);
  }

  // ---------- Helpers ----------

  private matches(pw: string): boolean {
    if (this.envHash) return timingSafeEqual(sha(pw), this.envHash);
    if (!this.saved.hash || !this.saved.salt) return false;
    const want = Buffer.from(this.saved.hash, 'base64');
    const got = scryptSync(pw, Buffer.from(this.saved.salt, 'base64'), want.length, SCRYPT);
    return timingSafeEqual(got, want);
  }

  private choose(pw: string): void {
    const salt = randomBytes(16);
    this.saved = { salt: salt.toString('base64'), hash: scryptSync(pw, salt, 32, SCRYPT).toString('base64') };
    this.store.save(this.saved).catch((err) => this.log.error(`Could not save the control panel password: ${(err as Error).message}`));
  }

  /** Wrong tries are counted per device, so nobody can lock the household out. */
  private failed(who: string): void {
    const f = this.fails.get(who) ?? { n: 0, until: 0 };
    f.n++;
    if (f.n >= MAX_FAILS) {
      f.n = 0;
      f.until = Date.now() + LOCKOUT_MS;
      this.log.warn(`Control panel: ${MAX_FAILS} wrong tries from ${who}, paused for ${LOCKOUT_MS / 60_000} min`);
    }
    this.fails.set(who, f);
    if (this.fails.size > 1000) this.fails.delete(this.fails.keys().next().value!);
  }

  private paused(who: string): number {
    const left = (this.fails.get(who)?.until ?? 0) - Date.now();
    return left > 0 ? left : 0;
  }
}

function weak(pw: string, again: string): string | undefined {
  if (pw.length < MIN_PASSWORD) return `Choose a password of at least ${MIN_PASSWORD} characters.`;
  if (pw !== again) return "The two passwords don't match.";
  return undefined;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();
const deviceCookie = (token: string) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEVICE_MS / 1000}`;

/** "iPhone (Safari)", "Mac (Chrome)", "Windows (Edge)"... from the browser's description of itself. */
export function deviceName(ua = ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} (${browser})`;
}
const client = (req: IncomingMessage) => req.socket.remoteAddress ?? 'unknown';

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

const STYLE = `<style>:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--muted:#5d6670;--line:#e3e6ea;--accent:#2f6fed;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--text:#e8eaed;--muted:#9aa3ad;--line:#2b3138;--accent:#6e9bff;--err:#ff8a80}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:380px;margin:10vh auto;padding:0 16px}form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:22px;margin:0 0 12px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}label{display:block;font-size:14px;margin-bottom:4px}
input{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);margin-bottom:12px}
button{width:100%;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px;font:inherit;font-weight:600;cursor:pointer}.err{color:var(--err)}</style>`;

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Max Control Panel</title>${STYLE}</head>
<body><main>${body}</main></body></html>`);
}

/** Error texts are fixed strings from this file (never user input). */
function page(res: ServerResponse, error?: string): void {
  send(res, error ? 401 : 200, `<form method="post" action="/login"><h1>Max</h1>${error ? `<p class="err">${error}</p>` : ''}
<input type="password" name="password" placeholder="Control panel password" autofocus required autocomplete="current-password"><button type="submit">Sign in</button></form>`);
}

function setupPage(res: ServerResponse, error?: string): void {
  send(res, error ? 401 : 200, `<form method="post" action="/login"><h1>Protect Max's control panel</h1>
<p class="muted">This page shows Max's memory and can turn him off, and anyone on your WiFi can open it. Choose a password.
To show you're at home, type the 6-digit code Max is showing on his screen now (if he's locked, unlock him first).</p>
${error ? `<p class="err">${error}</p>` : ''}
<label for="code">Code on Max's screen</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus>
<label for="pw">New password (at least ${MIN_PASSWORD} characters)</label><input id="pw" type="password" name="password" minlength="${MIN_PASSWORD}" required autocomplete="new-password">
<label for="pw2">Same password again</label><input id="pw2" type="password" name="again" minlength="${MIN_PASSWORD}" required autocomplete="new-password">
<button type="submit">Save and sign in</button>
<p class="muted" style="margin:12px 0 0">You can also set <code>PANEL_PASSWORD</code> in <code>.env</code> on the box instead.</p></form>`);
}

/** After the password: "tap Allow on Max's screen", then signed in (the page checks every 2 seconds). */
function waitingPage(res: ServerResponse, device: string): void {
  send(res, 200, `<form onsubmit="return false"><h1>Allow on Max's screen</h1>
<p>Max is asking on his screen whether <b>${device.replace(/[<>&"]/g, '')}</b> may open the control panel. Tap <b>Allow</b> there.</p>
<p class="muted" id="st">Waiting… (if Max is locked, unlock him first)</p>
<p class="muted">This device then stays signed in for 30 days.</p></form>
<script>
(function () {
  var st = document.getElementById('st');
  function check() {
    fetch('/login/wait', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.state === 'allowed') { location.href = '/'; return; }
      if (j.state === 'denied') { st.textContent = 'Not allowed on the screen.'; st.className = 'err'; return; }
      if (j.state === 'expired') { st.innerHTML = 'Nobody answered on the screen in time. <a href="/login">Try again</a>'; return; }
      setTimeout(check, 2000);
    }).catch(function () { setTimeout(check, 3000); });
  }
  setTimeout(check, 1500);
})();
</script>`);
}
