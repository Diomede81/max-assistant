#!/usr/bin/env python3
"""
Max box WiFi setup.

Watches the network. If the box has been offline for a minute (new router, moved house,
changed password), or someone chooses WiFi setup in the screen's menu (hold the screen for 2 seconds), it starts its own temporary
WiFi network "Max-Setup" with a random password. The face screen shows a QR code for it
(this service writes the details to /run/max/wifi.json, which Max reads). Joining that
network opens a setup page on the phone (a captive portal, like hotel WiFi), where you
pick your home network and type its password. The box then joins it, and Max says so.

Runs as root under systemd (max-wifi.service). Uses NetworkManager (nmcli), the network
manager in Raspberry Pi OS Bookworm and later. Standard library only.

Settings (environment): MAX_RUN_DIR (/run/max), MAX_WIFI_IFACE (wlan0),
MAX_WIFI_OFFLINE_S (60), MAX_WIFI_SETUP_TIMEOUT_S (600), MAX_WIFI_PORTAL_PORT (80),
MAX_WIFI_PORTAL_BIND (10.42.0.1, NetworkManager's hotspot address).
"""
import html
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RUN_DIR = os.environ.get('MAX_RUN_DIR', '/run/max')
IFACE = os.environ.get('MAX_WIFI_IFACE', 'wlan0')
OFFLINE_S = int(os.environ.get('MAX_WIFI_OFFLINE_S', '60'))
SETUP_TIMEOUT_S = int(os.environ.get('MAX_WIFI_SETUP_TIMEOUT_S', '600'))
PORTAL_PORT = int(os.environ.get('MAX_WIFI_PORTAL_PORT', '80'))
PORTAL_BIND = os.environ.get('MAX_WIFI_PORTAL_BIND', '10.42.0.1')
AP_SSID = 'Max-Setup'
AP_CON = 'max-setup'
STATUS = os.path.join(RUN_DIR, 'wifi.json')
REQUEST = os.path.join(RUN_DIR, 'wifi-request')
CANCEL = os.path.join(RUN_DIR, 'wifi-cancel')  # "Back to Max" on the screen
CANCEL_PAUSE_S = int(os.environ.get('MAX_WIFI_CANCEL_PAUSE_S', '300'))
TICK_S = 3


def log(msg):
    print(time.strftime('%H:%M:%S'), msg, flush=True)


def nmcli(*args, timeout=30):
    """Runs nmcli with an argument list (never a shell), returns (ok, stdout)."""
    try:
        r = subprocess.run(['nmcli', *args], capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, (r.stdout or '') + (r.stderr or '')
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return False, str(e)


def split_terse(line):
    """nmcli -t output: fields separated by ':' with '\\:' escaping."""
    out, cur, esc = [], '', False
    for ch in line:
        if esc:
            cur += ch
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == ':':
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return out


def online():
    """True when any device (WiFi or cable) is connected to a network other than our hotspot."""
    ok, out = nmcli('-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device')
    if not ok:
        return False
    for line in out.splitlines():
        f = split_terse(line)
        if len(f) >= 4 and f[1] in ('wifi', 'ethernet') and f[2] == 'connected' and f[3] != AP_CON:
            return True
    return False


def scan():
    """Visible networks, strongest first, without duplicates."""
    nmcli('device', 'wifi', 'rescan', 'ifname', IFACE, timeout=15)
    time.sleep(2)
    ok, out = nmcli('-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', IFACE)
    nets = {}
    for line in out.splitlines() if ok else []:
        f = split_terse(line)
        if len(f) < 3 or not f[0] or f[0] == AP_SSID:
            continue
        sig = int(f[1]) if f[1].isdigit() else 0
        if f[0] not in nets or nets[f[0]]['signal'] < sig:
            nets[f[0]] = {'ssid': f[0], 'signal': sig, 'secure': bool(f[2] and f[2] != '--')}
    return sorted(nets.values(), key=lambda n: -n['signal'])


def write_status(data):
    os.makedirs(RUN_DIR, exist_ok=True)
    tmp = STATUS + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({**data, 'at': int(time.time() * 1000)}, f)
    os.chmod(tmp, 0o644)
    os.replace(tmp, STATUS)


def clear_status():
    try:
        os.remove(STATUS)
    except FileNotFoundError:
        pass


class Setup:
    """The setup session: hotspot up, portal serving, waiting for the user's choice."""

    def __init__(self):
        self.active = False
        self.password = ''
        self.networks = []
        self.started = 0.0
        self.last_activity = 0.0
        self.error = ''
        self.connecting = False
        self.lock = threading.Lock()

    def start(self, error=''):
        with self.lock:
            if self.active and not error:
                return
            log('Starting WiFi setup mode')
            self.networks = scan()  # scan first: a single radio can't scan well while hosting
            if not self.password:
                self.password = ''.join(secrets.choice('0123456789') for _ in range(8))
            nmcli('connection', 'delete', AP_CON)
            ok, out = nmcli('device', 'wifi', 'hotspot', 'ifname', IFACE, 'con-name', AP_CON,
                            'ssid', AP_SSID, 'password', self.password)
            if not ok:
                log(f'Could not start the setup network: {out.strip()}')
                write_status({'state': 'failed', 'error': 'Could not start the setup network'})
                return
            nmcli('connection', 'modify', AP_CON, 'connection.autoconnect', 'no')
            self.active = True
            self.started = self.last_activity = time.time()
            self.error = error
            write_status({'state': 'setup', 'ssid': AP_SSID, 'password': self.password,
                          'url': f'http://{PORTAL_BIND}/', 'error': error or None})

    def stop(self, reason):
        with self.lock:
            if not self.active:
                return
            log(f'Stopping WiFi setup mode ({reason})')
            nmcli('connection', 'down', AP_CON)
            nmcli('connection', 'delete', AP_CON)
            self.active = False
            self.password = ''

    def connect(self, ssid, password):
        """Runs in a thread: leave setup mode, try the network, come back on failure."""
        self.connecting = True
        write_status({'state': 'connecting', 'ssid': ssid})
        time.sleep(2)  # let the phone receive the "connecting" page first
        with self.lock:
            nmcli('connection', 'down', AP_CON)
            nmcli('connection', 'delete', AP_CON)
            self.active = False
        args = ['device', 'wifi', 'connect', ssid, 'ifname', IFACE]
        if password:
            args += ['password', password]
        ok, out = nmcli(*args, timeout=60)
        if ok and wait_online(30):
            log(f'Connected to {ssid}')
            self.password = ''
            write_status({'state': 'connected', 'ssid': ssid})
        else:
            log(f'Could not connect to {ssid}: {out.strip()[:200]}')
            # Don't keep a broken profile around (e.g. wrong password).
            nmcli('connection', 'delete', ssid)
            reason = 'wrong password?' if 'secrets' in out.lower() or 'password' in out.lower() else 'network not reachable'
            self.start(error=f'Could not join {ssid} ({reason})')
        self.connecting = False


def wait_online(seconds):
    end = time.time() + seconds
    while time.time() < end:
        if online():
            return True
        time.sleep(2)
    return False


SETUP = Setup()

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up Max</title>
<style>
:root{{--bg:#f4f6f5;--card:#fff;--ink:#14201d;--muted:#5b6b66;--line:#dfe6e3;--accent:#1f7a64;--warn:#a4521a}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0d1312;--card:#151d1b;--ink:#e6f2ee;--muted:#93a7a1;--line:#24302d;--accent:#7fd8bd;--warn:#f2a36b}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
main{{max-width:440px;margin:0 auto;padding:24px 16px 40px}}h1{{font-size:24px;margin:0 0 4px}}p{{color:var(--muted);margin:0 0 18px}}
.err{{color:var(--warn);font-weight:600}}
form{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:12px}}
label{{font-weight:600;font-size:14px}}
.nets{{display:grid;gap:6px;max-height:300px;overflow:auto}}
.net{{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}}
.net input{{margin:0}}.net span{{flex:1;min-width:0;overflow-wrap:anywhere}}.net .sig{{flex:none;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}}
input[type=text],input[type=password]{{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}}
button{{font:inherit;font-weight:700;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}}
small{{color:var(--muted)}}
</style></head><body><main>
<h1>Connect Max to WiFi</h1>
<p>Choose your home network and enter its password.</p>
{error}
<form method="post" action="/connect">
<label>Network</label>
<div class="nets">{networks}</div>
<label for="other">Or type a network name (hidden networks)</label>
<input type="text" id="other" name="other" autocomplete="off" autocapitalize="none" spellcheck="false">
<label for="pw">Password</label>
<input type="password" id="pw" name="password" autocomplete="off">
<button type="submit">Connect</button>
<small>Max will say when he's connected. This page will stop working then, which is normal.</small>
</form></main></body></html>"""

DONE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting</title>
<style>body{{margin:0;font:17px/1.5 system-ui,-apple-system,sans-serif;background:#f4f6f5;color:#14201d}}
@media (prefers-color-scheme:dark){{body{{background:#0d1312;color:#e6f2ee}}}}main{{max-width:440px;margin:0 auto;padding:40px 16px}}</style>
</head><body><main><h1>Connecting to {ssid}…</h1>
<p>Max will tell you when he's online, and his face will come back. If the password was wrong, the setup
network appears again in a minute: just scan the code on his screen again.</p></main></body></html>"""

# What phones and laptops ask to detect a captive portal: all get sent to the setup page.
PROBES = {'/hotspot-detect.html', '/library/test/success.html', '/generate_204', '/gen_204',
          '/connecttest.txt', '/ncsi.txt', '/redirect', '/canonical.html', '/success.txt'}


class Portal(BaseHTTPRequestHandler):
    server_version = 'MaxSetup'

    def log_message(self, *args):
        pass

    def send_page(self, code, body):
        data = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        SETUP.last_activity = time.time()
        path = urllib.parse.urlparse(self.path).path
        host = (self.headers.get('Host') or '').split(':')[0]
        if path in PROBES or (host and host not in (PORTAL_BIND, 'localhost', '127.0.0.1')):
            self.send_response(302)
            self.send_header('Location', f'http://{PORTAL_BIND}/')
            self.end_headers()
            return
        nets = ''.join(
            f'<label class="net"><input type="radio" name="ssid" value="{html.escape(n["ssid"], True)}"'
            f'{" checked" if i == 0 else ""}><span>{html.escape(n["ssid"])}{" 🔒" if n["secure"] else ""}</span>'
            f'<span class="sig">{n["signal"]}%</span></label>'
            for i, n in enumerate(SETUP.networks)
        ) or '<small>No networks found. Type the name below.</small>'
        err = f'<p class="err">{html.escape(SETUP.error)}</p>' if SETUP.error else ''
        self.send_page(200, PAGE.format(networks=nets, error=err))

    def do_POST(self):
        SETUP.last_activity = time.time()
        if urllib.parse.urlparse(self.path).path != '/connect':
            self.send_page(404, 'Not found')
            return
        length = min(int(self.headers.get('Content-Length') or 0), 4096)
        form = urllib.parse.parse_qs(self.rfile.read(length).decode('utf-8', 'replace'))
        ssid = (form.get('other', [''])[0].strip() or form.get('ssid', [''])[0]).strip()[:32]
        password = form.get('password', [''])[0][:63]
        if not ssid or SETUP.connecting:
            self.send_response(303)
            self.send_header('Location', '/')
            self.end_headers()
            return
        log(f'Setup page: connecting to {ssid}')
        self.send_page(200, DONE.format(ssid=html.escape(ssid)))
        threading.Thread(target=SETUP.connect, args=(ssid, password), daemon=True).start()


def serve_portal():
    """Serves the setup page on the hotspot address; retries until the address exists."""
    while True:
        try:
            httpd = ThreadingHTTPServer((PORTAL_BIND, PORTAL_PORT), Portal)
            log(f'Setup page listening on http://{PORTAL_BIND}:{PORTAL_PORT}/')
            httpd.serve_forever()
        except OSError:
            time.sleep(3)  # the hotspot isn't up yet, so its address doesn't exist


def main():
    os.makedirs(RUN_DIR, exist_ok=True)
    threading.Thread(target=serve_portal, daemon=True).start()
    offline_since = None
    cooldown_until = 0.0
    clear_status()
    # A leftover hotspot from before a restart: remove it so known networks can reconnect.
    nmcli('connection', 'delete', AP_CON)
    log('Watching the network')
    while True:
        requested = os.path.exists(REQUEST)
        if requested:
            try:
                os.remove(REQUEST)
            except OSError:
                pass
        cancelled = os.path.exists(CANCEL)
        if cancelled:
            try:
                os.remove(CANCEL)
            except OSError:
                pass
        if SETUP.connecting:
            pass
        elif cancelled and SETUP.active:
            # "Back to Max" on the screen: leave setup mode and try the known networks again. If the
            # box is still offline, setup mode only comes back by itself after a pause.
            SETUP.stop('cancelled from the screen')
            clear_status()
            nmcli('device', 'connect', IFACE)
            offline_since = None
            cooldown_until = time.time() + CANCEL_PAUSE_S
        elif SETUP.active:
            idle = time.time() - SETUP.last_activity
            if idle > SETUP_TIMEOUT_S:
                SETUP.stop('nobody used it')
                clear_status()
                nmcli('device', 'connect', IFACE)  # let NetworkManager try known networks again
                offline_since = None
                cooldown_until = time.time() + 120
        elif requested:
            SETUP.start()
        elif online():
            offline_since = None
            try:
                with open(STATUS) as f:
                    st = json.load(f)
                if st.get('state') == 'connected' and time.time() * 1000 - st.get('at', 0) > 60_000:
                    clear_status()
            except (OSError, ValueError):
                pass
        else:
            offline_since = offline_since or time.time()
            if time.time() - offline_since > OFFLINE_S and time.time() > cooldown_until:
                SETUP.start()
        time.sleep(TICK_S)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
