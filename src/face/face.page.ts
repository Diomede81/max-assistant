/**
 * The face page shown full-screen on the box's round 720x720 display (kiosk browser).
 * Self-contained (no external fonts or scripts: it must work offline, e.g. during WiFi
 * setup). Live state arrives over /events; open /?demo to preview every expression.
 */
export function renderFace(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Max</title>
<style>
:root { --bg: #06090d; --ink: #8ff0d6; --dim: #5d7d76; --paper: #ffffff; --warn: #ffb36b; color-scheme: dark; }
html, body { margin: 0; height: 100%; background: var(--bg); overflow: hidden; cursor: none;
  font-family: ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-user-select: none; user-select: none; touch-action: none; }
canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
#setup { position: fixed; inset: 0; display: grid; place-items: center; color: var(--ink); text-align: center; }
#setup[hidden] { display: none; }
.card { width: min(76vmin, 560px); display: grid; gap: 2.2vmin; justify-items: center; }
.card h1 { margin: 0; font-size: 5vmin; font-weight: 700; color: #e9fff8; }
.qr { width: 34vmin; height: 34vmin; background: var(--paper); border-radius: 3vmin; padding: 2.2vmin; box-sizing: border-box; }
.qr svg { width: 100%; height: 100%; display: block; }
.line { font-size: 3.4vmin; color: #cfeee6; }
.line b { color: #ffffff; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
.hint { font-size: 2.8vmin; color: var(--dim); max-width: 46vmin; }
.err { font-size: 3vmin; color: var(--warn); max-width: 50vmin; }
.spinner { width: 10vmin; height: 10vmin; border-radius: 50%; border: 1.2vmin solid #1b2a28; border-top-color: var(--ink); animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
<canvas id="c"></canvas>
<div id="setup" hidden><div class="card" id="card"></div></div>
<script>
(() => {
  const cv = document.getElementById('c');
  const g = cv.getContext('2d');
  const setupEl = document.getElementById('setup');
  const card = document.getElementById('card');
  const demo = new URLSearchParams(location.search).has('demo');

  let info = { state: 'idle', mode: 'personal', timers: [], offline: false };
  let level = 0, shownLevel = 0, connected = demo, lastMsg = Date.now();
  let W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) / 2; cx = W / 2; cy = H / 2;
  }
  addEventListener('resize', resize); resize();

  // ---------- live data ----------
  if (!demo) {
    const es = new EventSource('/events');
    es.addEventListener('info', (e) => { info = JSON.parse(e.data); connected = true; lastMsg = Date.now(); renderSetup(); });
    es.addEventListener('level', (e) => { level = +e.data; lastMsg = Date.now(); });
    es.onerror = () => { connected = false; };
  } else {
    // Preview every expression, 4 s each.
    const states = ['idle', 'listening', 'thinking', 'speaking', 'sleeping', 'setup'];
    let i = 0;
    const next = () => {
      const s = states[i++ % states.length];
      info = {
        state: s, mode: s === 'thinking' ? 'work' : 'personal', offline: false,
        timers: s === 'idle' ? [{ label: '"pasta" timer', endsAt: Date.now() + 252000, total: 600000 }] : [],
        music: s === 'speaking' ? { title: 'Yellow', artist: 'Coldplay' } : undefined,
        wifi: s === 'setup' ? { state: 'setup', ssid: 'Max-Setup', password: '48213097', qrSvg: demoQr() } : undefined,
      };
      renderSetup();
    };
    next(); setInterval(next, 4000);
  }

  function demoQr() {
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" shape-rendering="crispEdges"><rect width="25" height="25" fill="#fff"/>';
    let seed = 7;
    for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
      seed = (seed * 9301 + 49297) % 233280;
      const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17);
      const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x % 6 > 1 && x % 6 < 5 && y % 6 > 1 && y % 6 < 5) || x === 24 || y === 24 || x === 18 || y === 18) : seed / 233280 > 0.55;
      if (on) s += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#0b0f14"/>';
    }
    return s + '</svg>';
  }

  function renderSetup() {
    const w = info.wifi;
    const show = info.state === 'setup' && w;
    setupEl.hidden = !show;
    if (!show) return;
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    if (w.state === 'connecting') {
      card.innerHTML = '<div class="spinner"></div><h1>Connecting…</h1><div class="line">to <b>' + esc(w.ssid) + '</b></div>';
    } else {
      card.innerHTML = '<h1>Connect me to WiFi</h1>' +
        (w.error ? '<div class="err">' + esc(w.error) + '</div>' : '') +
        '<div class="qr">' + (w.qrSvg || '') + '</div>' +
        '<div class="line">Network <b>' + esc(w.ssid) + '</b></div>' +
        '<div class="line">Password <b>' + esc(w.password) + '</b></div>' +
        '<div class="hint">Scan with your phone camera, then choose your WiFi on the page that opens.</div>';
    }
  }

  // ---------- long press (5 s) to start WiFi setup ----------
  let pressAt = 0, pressFired = false, toast = '', toastUntil = 0;
  addEventListener('pointerdown', () => { pressAt = performance.now(); pressFired = false; });
  addEventListener('pointerup', () => { pressAt = 0; });
  addEventListener('pointercancel', () => { pressAt = 0; });
  function checkPress(now) {
    if (!pressAt || pressFired) return 0;
    const p = (now - pressAt) / 5000;
    if (p >= 1) {
      pressFired = true; pressAt = 0;
      fetch('/wifi-setup', { method: 'POST' }).then((r) => {
        toast = r.ok ? 'Starting WiFi setup…' : 'WiFi setup only works on the Max box';
      }).catch(() => { toast = 'WiFi setup only works on the Max box'; });
      toast = 'Starting WiFi setup…'; toastUntil = now + 4000;
    }
    return Math.min(1, p);
  }

  // ---------- animation ----------
  const P = { eyeW: 92, eyeH: 150, eyeY: -40, gap: 92, lookX: 0, lookY: 0, blink: 0, mouthH: 0, mouthW: 110, smile: 0.6,
              ring: 0.15, bright: 1, hue: 0, dots: 0, zz: 0 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const COLORS = { idle: [143, 240, 214], listening: [120, 225, 255], thinking: [255, 196, 120], speaking: [143, 240, 214],
                   sleeping: [150, 140, 220], setup: [143, 240, 214], offline: [255, 150, 130] };
  let col = [143, 240, 214];
  let nextBlink = performance.now() + 3000, blinkStart = 0, nextGlance = 0, glance = [0, 0];

  function targets(state, now) {
    const t = { eyeW: 92, eyeH: 150, eyeY: -40, gap: 92, lookX: glance[0], lookY: glance[1], mouthH: 0, mouthW: 110, smile: 0.6, ring: 0.14, bright: 1, dots: 0, zz: 0 };
    if (state === 'listening') Object.assign(t, { eyeW: 100, eyeH: 178, eyeY: -48, lookX: 0, lookY: -4, smile: 0.25, ring: 0.65 + 0.25 * Math.sin(now / 260) });
    if (state === 'thinking') Object.assign(t, { eyeH: 104, eyeW: 96, lookX: 26, lookY: -26, smile: 0, ring: 0.45, dots: 1 });
    if (state === 'speaking') Object.assign(t, { eyeH: 150 + shownLevel * 10, lookX: glance[0] * 0.3, lookY: 0, mouthH: 10 + shownLevel * 92, mouthW: 118 - shownLevel * 24, smile: 0, ring: 0.25 + shownLevel * 0.6 });
    if (state === 'sleeping') Object.assign(t, { eyeH: 8, lookX: 0, lookY: 10, smile: 0.4, ring: 0.06 + 0.04 * Math.sin(now / 1500), bright: 0.45, zz: 1 });
    if (state === 'offline') Object.assign(t, { eyeH: 120, eyeW: 84, lookY: 10, smile: -0.5, ring: 0.3, bright: 0.8 });
    return t;
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function frame(now) {
    const state = !connected && !demo && Date.now() - lastMsg > 4000 ? 'offline' : info.state;
    if (demo && state === 'speaking') level = Math.max(0, 0.5 + 0.45 * Math.sin(now / 90) * Math.sin(now / 370));
    shownLevel = lerp(shownLevel, state === 'speaking' ? level : 0, 0.45);

    // blinking and glancing
    if (now > nextBlink && state !== 'sleeping') { blinkStart = now; nextBlink = now + 2500 + Math.random() * 4000; }
    const bt = (now - blinkStart) / 160;
    const blink = bt < 1 ? Math.sin(bt * Math.PI) : 0;
    if (now > nextGlance) { glance = Math.random() < 0.5 ? [0, 0] : [(Math.random() - 0.5) * 44, (Math.random() - 0.5) * 20]; nextGlance = now + 1800 + Math.random() * 2600; }

    const T = targets(state, now);
    const k = state === 'speaking' ? 0.35 : 0.12;
    for (const key of Object.keys(T)) P[key] = lerp(P[key], T[key], key === 'mouthH' ? 0.5 : k);
    const target = COLORS[state] || COLORS.idle;
    col = col.map((c, i) => lerp(c, target[i], 0.08));
    const rgb = (a) => 'rgba(' + col.map(Math.round).join(',') + ',' + a + ')';
    const s = R / 360; // design units: a 720 px circle

    g.clearRect(0, 0, W, H);
    g.fillStyle = '#06090d'; g.fillRect(0, 0, W, H);

    // edge ring glow
    const ringA = Math.max(0, Math.min(1, P.ring));
    const grad = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    grad.addColorStop(0, rgb(0)); grad.addColorStop(1, rgb(ringA * 0.55));
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    if (state === 'setup') { drawChrome(now, s, rgb); requestAnimationFrame(frame); return; }

    g.save();
    g.globalAlpha = P.bright;
    g.fillStyle = rgb(1);
    g.shadowColor = rgb(0.55); g.shadowBlur = 28 * s;

    // eyes
    const eh = Math.max(6, P.eyeH * (1 - blink * 0.94));
    for (const side of [-1, 1]) {
      const ex = cx + (side * P.gap + P.lookX) * s - (P.eyeW * s) / 2;
      const ey = cy + (P.eyeY + P.lookY) * s - (eh * s) / 2;
      if (state === 'sleeping') {
        g.lineWidth = 14 * s; g.lineCap = 'round'; g.strokeStyle = rgb(1);
        g.beginPath(); g.arc(cx + side * P.gap * s, cy + (P.eyeY + 10) * s, 40 * s, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      } else {
        roundRect(ex, ey, P.eyeW * s, eh * s, Math.min(46, P.eyeW / 2) * s); g.fill();
      }
    }

    // mouth
    const my = cy + 112 * s;
    if (P.mouthH > 6) {
      roundRect(cx - (P.mouthW * s) / 2, my - (P.mouthH * s) / 2, P.mouthW * s, P.mouthH * s, Math.min(P.mouthH, 44) * s / 1.4); g.fill();
    } else {
      g.lineWidth = 14 * s; g.lineCap = 'round'; g.strokeStyle = rgb(1);
      g.beginPath();
      const w = 52 * s, curve = P.smile * 34 * s;
      g.moveTo(cx - w, my - curve * 0.3); g.quadraticCurveTo(cx, my + curve, cx + w, my - curve * 0.3); g.stroke();
    }
    g.restore();

    // thinking dots orbiting the edge
    if (P.dots > 0.05) {
      for (let i = 0; i < 3; i++) {
        const a = now / 420 + i * 0.5;
        g.fillStyle = rgb(P.dots * (0.4 + 0.2 * i));
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86, 9 * s, 0, Math.PI * 2); g.fill();
      }
    }
    // sleeping Zs
    if (P.zz > 0.05) {
      g.fillStyle = rgb(0.6 * P.zz); g.font = '600 ' + Math.round(34 * s) + 'px system-ui, sans-serif';
      for (let i = 0; i < 3; i++) {
        const t = ((now / 2600 + i / 3) % 1);
        g.globalAlpha = Math.sin(t * Math.PI);
        g.fillText('z', cx + (120 + t * 70) * s, cy - (60 + t * 140) * s);
      }
      g.globalAlpha = 1;
    }
    drawChrome(now, s, rgb);
    requestAnimationFrame(frame);
  }

  function drawChrome(now, s, rgb) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const state = info.state;
    // mode badge
    if (info.mode && info.mode !== 'personal' && state !== 'setup') {
      const label = info.mode.toUpperCase();
      g.font = '700 ' + Math.round(22 * s) + 'px system-ui, sans-serif';
      const w = g.measureText(label).width + 36 * s;
      roundRect(cx - w / 2, cy - 268 * s, w, 40 * s, 20 * s);
      g.fillStyle = info.mode === 'work' ? 'rgba(255,196,120,0.18)' : 'rgba(150,140,220,0.2)'; g.fill();
      g.fillStyle = info.mode === 'work' ? '#ffc478' : '#b8b0f0'; g.fillText(label, cx, cy - 247 * s);
    }
    // bottom line: timer, music, or the clock
    let text = '', sub = '';
    const timer = (info.timers || []).slice().sort((a, b) => a.endsAt - b.endsAt)[0];
    if (state !== 'setup') {
      if (timer) {
        const left = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
        text = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        sub = timer.label.replace(/^"(.*)" timer$/, '$1').replace(/^reminder "(.*)"$/, '$1');
        const frac = timer.total ? Math.max(0, Math.min(1, (timer.endsAt - Date.now()) / timer.total)) : 0;
        g.lineWidth = 8 * s; g.lineCap = 'round'; g.strokeStyle = rgb(0.85);
        g.beginPath(); g.arc(cx, cy, R - 12 * s, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      } else if (info.music) {
        text = '♪  ' + info.music.title; sub = info.music.artist;
      } else if (state === 'idle' || state === 'sleeping' || state === 'offline') {
        text = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        if (state === 'offline') sub = 'Reconnecting…';
      }
    }
    if (text) {
      g.fillStyle = rgb(state === 'sleeping' ? 0.35 : 0.8);
      g.font = '600 ' + Math.round(40 * s) + 'px system-ui, sans-serif';
      g.fillText(fit(text, 380 * s), cx, cy + 222 * s);
      if (sub) { g.font = '500 ' + Math.round(24 * s) + 'px system-ui, sans-serif'; g.fillStyle = rgb(0.5); g.fillText(fit(sub, 320 * s), cx, cy + 262 * s); }
    }
    // long-press progress and toast
    const p = checkPress(now);
    if (p > 0.08) {
      g.lineWidth = 10 * s; g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.arc(cx, cy, R - 30 * s, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
      g.fillStyle = '#ffffff'; g.font = '600 ' + Math.round(26 * s) + 'px system-ui, sans-serif';
      g.fillText('Keep holding for WiFi setup', cx, cy + 180 * s);
    }
    if (toast && now < toastUntil) {
      g.fillStyle = '#ffffff'; g.font = '600 ' + Math.round(26 * s) + 'px system-ui, sans-serif';
      g.fillText(toast, cx, cy + 180 * s);
    }
  }

  function fit(t, maxW) {
    if (g.measureText(t).width <= maxW) return t;
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  requestAnimationFrame(frame);
})();
</script>
</body></html>`;
}
