/**
 * The face page shown full-screen on the box's round 720x720 display (kiosk browser).
 * Self-contained (no external fonts or scripts: it must work offline, e.g. during WiFi
 * setup). Live state arrives over /events: the state, his expression (emotion) and, while he
 * talks, the mouth shape 20 times a second. Open /?demo to preview every expression, or
 * /?demo=happy (any scene name, see SCENES) to hold one; add &mouth=a (e, i, o, u, s, m) to hold a
 * mouth shape.
 *
 * Everything is drawn from a handful of numbers (lid heights, brow angles, mouth opening...)
 * that spring towards targets, so any expression blends smoothly into any other. A designed
 * character (e.g. a Rive animation) could replace this later and use the same signals.
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
  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');

  let info = { state: 'idle', mode: 'personal', timers: [], offline: false, emotion: 'neutral' };
  let mouth = { o: 0, w: 0, r: 0, s: 0 };
  let connected = demo, lastMsg = Date.now(), lastMouth = 0;
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
    es.addEventListener('level', (e) => {
      const d = JSON.parse(e.data);
      mouth = typeof d === 'number' ? { o: d, w: 0, r: 0, s: 0 } : d;
      lastMsg = lastMouth = Date.now();
    });
    es.onerror = () => { connected = false; };
  }

  // ---------- demo: every state and expression ----------
  const SCENES = [
    ['idle', 'neutral', 'Idle'], ['listening', 'neutral', 'Listening'], ['thinking', 'neutral', 'Thinking'],
    ['speaking', 'neutral', 'Speaking'], ['speaking', 'happy', 'Speaking happy'], ['speaking', 'concerned', 'Speaking concerned'],
    ['idle', 'happy', 'Happy'], ['idle', 'curious', 'Curious'], ['idle', 'surprised', 'Surprised'], ['idle', 'concerned', 'Concerned'],
    ['idle', 'focused', 'Focused'], ['idle', 'sleepy', 'Sleepy'], ['sleeping', 'neutral', 'Asleep'], ['setup', 'neutral', 'WiFi setup'],
  ];
  const slug = (t) => t.toLowerCase().replace(/[^a-z]+/g, '-');
  let demoLabel = '';
  if (demo) {
    const want = params.get('demo');
    const fixed = SCENES.find((sc) => want && slug(sc[2]) === want);
    let i = 0;
    const show = (sc) => {
      const [state, emotion, label] = sc;
      demoLabel = label;
      info = {
        state, emotion, mode: state === 'thinking' ? 'work' : 'personal', offline: false,
        timers: label === 'Idle' ? [{ label: '"pasta" timer', endsAt: Date.now() + 252000, total: 600000 }] : [],
        reminder: label === 'Happy' ? { text: 'call Mum', at: Date.now() + 2 * 3600000 } : undefined,
        music: label === 'Speaking' ? { title: 'Yellow', artist: 'Coldplay' } : undefined,
        wifi: state === 'setup' ? { state: 'setup', ssid: 'Max-Setup', password: '48213097', qrSvg: demoQr() } : undefined,
      };
      renderSetup();
    };
    if (fixed) show(fixed);
    else { show(SCENES[0]); setInterval(() => show(SCENES[++i % SCENES.length]), 3500); }
  }
  // Pretend speech for the demo: mouth shapes for each letter of a sentence.
  const SHAPES = { a: [0.8, 0, 0, 0], e: [0.45, 0.65, 0, 0], i: [0.25, 0.95, 0, 0], o: [0.5, 0, 0.7, 0], u: [0.3, 0, 0.95, 0],
                   s: [0.12, 0.3, 0, 1], m: [0, 0, 0, 0], x: [0.35, 0.2, 0, 0.2] };
  const LINE = 'hello im max   what can i do for you today   sure thats done   ';
  const letterShape = (c) => SHAPES[/[aeiou]/.test(c) ? c : /[y]/.test(c) ? 'i' : /[w]/.test(c) ? 'u' : /[sfzctjh]/.test(c) ? 's' : /[mbp ]/.test(c) ? 'm' : 'x'];
  function demoMouth(now) {
    const held = SHAPES[params.get('mouth') || ''];
    if (held) return { o: held[0], w: held[1], r: held[2], s: held[3] };
    const k = Math.floor(now / 85) % LINE.length;
    const sh = letterShape(LINE[k]);
    const loud = 0.75 + 0.25 * Math.sin(now / 230);
    return { o: sh[0] * loud, w: sh[1] * loud, r: sh[2] * loud, s: sh[3] };
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

  // ---------- expressions ----------
  // lidT: upper lid lowered (0 open .. 1 shut); lidA: lid slant (+ determined, - worried);
  // lidB: lower lid raised (happy "smiling eyes"); brow*: height, slant, left-brow lift;
  // eye: eye size; pupil: pupil size; smile: -1 frown .. 1 big smile; open/round: idle mouth;
  // cheek: blush glow; tilt: head tilt in degrees.
  const EMO = {
    neutral:   { lidT: 0.1,  lidA: 0,     lidB: 0.06, browY: 0,  browA: 0,     browL: 0,  eye: 1,    pupil: 0.55, smile: 0.35, open: 0,    round: 0,   cheek: 0,   tilt: 0 },
    happy:     { lidT: 0.03, lidA: -0.05, lidB: 0.46, browY: 10, browA: -0.1,  browL: 0,  eye: 1.03, pupil: 0.66, smile: 1,    open: 0.1,  round: 0,   cheek: 1,   tilt: -4 },
    curious:   { lidT: 0.03, lidA: 0,     lidB: 0.04, browY: 6,  browA: 0.04,  browL: 18, eye: 1.07, pupil: 0.7,  smile: 0.2,  open: 0,    round: 0,   cheek: 0,   tilt: 9 },
    concerned: { lidT: 0.22, lidA: -0.4,  lidB: 0.1,  browY: 8,  browA: -0.34, browL: 0,  eye: 0.95, pupil: 0.5,  smile: -0.55, open: 0,   round: 0,   cheek: 0,   tilt: -5 },
    surprised: { lidT: 0,    lidA: 0,     lidB: 0,    browY: 26, browA: -0.04, browL: 0,  eye: 1.16, pupil: 0.3,  smile: 0,    open: 0.32, round: 0.8, cheek: 0,   tilt: 0 },
    sleepy:    { lidT: 0.55, lidA: -0.06, lidB: 0.12, browY: -5, browA: -0.06, browL: 0,  eye: 0.97, pupil: 0.5,  smile: 0.2,  open: 0,    round: 0,   cheek: 0.3, tilt: 6 },
    focused:   { lidT: 0.33, lidA: 0.18,  lidB: 0.18, browY: -8, browA: 0.2,   browL: 0,  eye: 0.98, pupil: 0.36, smile: 0.05, open: 0,    round: 0,   cheek: 0,   tilt: 0 },
  };
  const COLORS = { idle: [110, 225, 255], listening: [120, 205, 255], thinking: [255, 190, 110], speaking: [110, 225, 255],
                   sleeping: [150, 140, 230], setup: [110, 225, 255], offline: [255, 145, 125] };
  const TINT = { happy: [120, 240, 205], concerned: [150, 175, 255] };

  // Every animated number is a spring: it moves towards its target with a little overshoot,
  // which is what makes the face feel alive rather than mechanical.
  const SP = {};
  function spring(name, target, dt, k, zeta) {
    const sp = SP[name] || (SP[name] = { x: target, v: 0 });
    const c = 2 * Math.sqrt(k) * zeta;
    for (let i = 0; i < 2; i++) {
      const h = dt / 2;
      sp.v += (k * (target - sp.x) - c * sp.v) * h;
      sp.x += sp.v * h;
    }
    return sp.x;
  }

  let col = [110, 225, 255];
  let last = performance.now();
  let nextBlink = last + 2500, blinkAt = -1e9, doubleBlink = false;
  let nextLook = 0, look = [0, 0], lastEmotion = 'neutral', lastState = 'idle';

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const offline = !connected && !demo && Date.now() - lastMsg > 4000;
    const state = offline ? 'offline' : info.state;
    let emotion = offline ? 'concerned' : (info.emotion || 'neutral');
    if (state === 'thinking' && emotion === 'neutral') emotion = 'focused';

    // Mouth shape: live from the audio (or the demo), closed otherwise.
    let m = { o: 0, w: 0, r: 0, s: 0 };
    if (state === 'speaking') m = demo ? demoMouth(now) : (Date.now() - lastMouth < 300 ? mouth : m);

    // Blinks: random, sometimes double, and whenever the expression changes.
    if (emotion !== lastEmotion || (state !== lastState && state !== 'speaking')) { blinkAt = now; }
    lastEmotion = emotion; lastState = state;
    if (now > nextBlink && state !== 'sleeping') {
      blinkAt = now; doubleBlink = Math.random() < 0.2;
      nextBlink = now + 2200 + Math.random() * 4200;
    }
    let bt = now - blinkAt;
    if (doubleBlink && bt > 300 && bt < 600) bt -= 300;
    const blink = bt < 120 ? bt / 120 : bt < 300 ? 1 - (bt - 120) / 180 : 0;

    // Where he looks: quick darting glances (saccades) that depend on what he's doing.
    if (now > nextLook) {
      const r = Math.random;
      if (state === 'listening') { look = [(r() - 0.5) * 0.16, (r() - 0.5) * 0.12]; nextLook = now + 400 + r() * 900; }
      else if (state === 'thinking') { look = [0.45 + r() * 0.3, -0.5 - r() * 0.25]; nextLook = now + 450 + r() * 700; }
      else if (state === 'speaking') { look = r() < 0.75 ? [(r() - 0.5) * 0.12, (r() - 0.5) * 0.1] : [(r() - 0.5) * 0.7, (r() - 0.5) * 0.3]; nextLook = now + 700 + r() * 1600; }
      else if (state === 'sleeping') { look = [0, 0.2]; nextLook = now + 3000; }
      else { look = r() < 0.45 ? [(r() - 0.5) * 0.08, 0] : [(r() - 0.5) * 1.2, (r() - 0.5) * 0.7]; nextLook = now + 900 + r() * 2600; }
    }

    // Targets: the expression, adjusted for what he's doing.
    const e = Object.assign({}, EMO[emotion] || EMO.neutral);
    if (state === 'listening') { e.lidT = Math.min(e.lidT, 0.03); e.eye *= 1.06; e.pupil += 0.15; e.browY += 7; e.tilt += 6; }
    if (state === 'sleeping') Object.assign(e, { lidT: 1, lidA: -0.05, lidB: 0.12, browY: -6, browA: -0.05, browL: 0, smile: 0.3, open: 0, round: 0, cheek: 0.2, tilt: 5 });
    if (state === 'speaking') e.browY += m.o * 7;
    const lidT = Math.min(1, e.lidT + (1 - e.lidT) * blink);

    const K = 170, Z = 0.62; // expression springs: soft with a little bounce
    const P = {
      lidT: blink > 0 ? lidT : spring('lidT', lidT, dt, K, 0.8),
      lidA: spring('lidA', e.lidA, dt, K, Z), lidB: spring('lidB', e.lidB + blink * 0.1, dt, K, 0.8),
      browY: spring('browY', e.browY, dt, K, Z), browA: spring('browA', e.browA, dt, K, Z), browL: spring('browL', e.browL, dt, K, Z),
      eye: spring('eye', e.eye, dt, K, 0.5), pupil: spring('pupil', e.pupil, dt, 90, 0.9),
      smile: spring('smile', e.smile, dt, K, Z), cheek: spring('cheek', e.cheek, dt, 60, 1),
      tilt: spring('tilt', e.tilt, dt, 60, 0.55),
      lx: spring('lx', look[0], dt, 700, 0.85), ly: spring('ly', look[1], dt, 700, 0.85),
      mo: spring('mo', state === 'speaking' ? m.o : e.open, dt, 1100, 0.8),
      mw: spring('mw', m.w, dt, 1100, 0.8), mr: spring('mr', state === 'speaking' ? m.r : e.round, dt, 1100, 0.8),
      ms: spring('ms', m.s, dt, 1100, 0.8),
      bright: spring('bright', state === 'sleeping' ? 0.5 : offline ? 0.8 : 1, dt, 20, 1),
      ring: spring('ring', state === 'listening' ? 0.65 + 0.25 * Math.sin(now / 260) : state === 'thinking' ? 0.45 : state === 'speaking' ? 0.25 + m.o * 0.5 : state === 'sleeping' ? 0.06 : 0.14, dt, 120, 0.9),
    };
    const target = (state === 'idle' || state === 'speaking' || state === 'listening') && TINT[emotion] ? TINT[emotion] : COLORS[state] || COLORS.idle;
    col = col.map((c, i) => c + (target[i] - c) * Math.min(1, dt * 4));
    const rgb = (a, mix) => {
      const c = mix ? col.map((v) => v + (255 - v) * mix) : col;
      return 'rgba(' + c.map(Math.round).join(',') + ',' + a + ')';
    };
    const s = R / 360; // design units: a 720 px circle

    drawBackground(P, rgb, s);
    if (state === 'setup') { drawChrome(now, s, rgb, state); requestAnimationFrame(frame); return; }

    // Head: gentle breathing, a nod with emphasis, tilt, and a slight turn towards where he looks.
    const breathe = Math.sin(now / 1300);
    g.save();
    g.translate(cx + P.lx * 7 * s, cy + (breathe * 3 - P.mo * 4 + P.ly * 5) * s);
    g.rotate((P.tilt * Math.PI) / 180);
    g.scale(s * (1 + breathe * 0.005), s * (1 + breathe * 0.005));
    g.globalAlpha = P.bright;
    drawCheeks(P);
    for (const side of [-1, 1]) drawEye(side, P, rgb);
    for (const side of [-1, 1]) drawBrow(side, P, rgb);
    drawMouth(P, rgb);
    g.restore();

    if (state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = now / 420 + i * 0.5;
        g.fillStyle = rgb(0.4 + 0.2 * i);
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86, 9 * s, 0, Math.PI * 2); g.fill();
      }
    }
    if (state === 'sleeping') {
      g.fillStyle = rgb(0.6); g.font = '600 ' + Math.round(34 * s) + 'px system-ui, sans-serif';
      for (let i = 0; i < 3; i++) {
        const t = ((now / 2600 + i / 3) % 1);
        g.globalAlpha = Math.sin(t * Math.PI);
        g.fillText('z', cx + (130 + t * 70) * s, cy - (90 + t * 140) * s);
      }
      g.globalAlpha = 1;
    }
    drawChrome(now, s, rgb, state);
    requestAnimationFrame(frame);
  }

  // ---------- drawing ----------
  function drawBackground(P, rgb, s) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#04070b'; g.fillRect(0, 0, W, H);
    // the face plate: a softly lit dark glass dome
    const bg = g.createRadialGradient(cx, cy - R * 0.25, R * 0.05, cx, cy, R);
    bg.addColorStop(0, '#111c27'); bg.addColorStop(0.7, '#0a1119'); bg.addColorStop(1, '#05080c');
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // coloured glow at the edge (pulses while listening)
    const ringA = Math.max(0, Math.min(1, P.ring));
    const grad = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    grad.addColorStop(0, rgb(0)); grad.addColorStop(1, rgb(ringA * 0.55));
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // glass reflection along the top-left
    g.save();
    g.beginPath(); g.arc(cx, cy, R * 0.93, Math.PI * 1.08, Math.PI * 1.42); g.lineWidth = 10 * s; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.stroke();
    g.restore();
  }

  function drawCheeks(P) {
    if (P.cheek < 0.02) return;
    for (const side of [-1, 1]) {
      const x = side * 150, y = 62;
      const gr = g.createRadialGradient(x, y, 0, x, y, 52);
      gr.addColorStop(0, 'rgba(255,130,170,' + (0.32 * P.cheek) + ')'); gr.addColorStop(1, 'rgba(255,130,170,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, 56, 40, 0, 0, Math.PI * 2); g.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  const EYE = { gap: 110, y: -32, w: 132, h: 156 };
  // Upper and lower lid edges at u (-1 outer .. 1 inner side of the eye), in eye-relative units.
  function lidTop(u, P, hh) { return -hh + P.lidT * hh * 2.04 + P.lidA * u * hh * 0.7 - (1 - u * u) * hh * 0.1 * P.lidT; }
  function lidBot(u, P, hh) { return hh - P.lidB * hh * 2 * (0.55 + 0.45 * (1 - u * u)); }

  function drawEye(side, P, rgb) {
    const hw = (EYE.w / 2) * P.eye, hh = (EYE.h / 2) * P.eye;
    const ex = side * EYE.gap + P.lx * 12, ey = EYE.y + P.ly * 9;
    const inner = -side; // +u is towards the middle of the face
    const N = 14;
    const pathLid = (fn, far) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = -hw - 4 + ((2 * hw + 8) * i) / N;
        const u = Math.max(-1, Math.min(1, x / hw)) * inner;
        const y = fn(u, P, hh);
        if (i === 0) g.moveTo(ex + x, ey + y); else g.lineTo(ex + x, ey + y);
      }
      g.lineTo(ex + hw + 4, ey + far); g.lineTo(ex - hw - 4, ey + far); g.closePath();
    };
    // How open the eye is in the middle (to fade to a closed-eye line).
    const gapMid = lidBot(0, P, hh) - lidTop(0, P, hh);
    const openFrac = Math.max(0, Math.min(1, gapMid / (hh * 2)));

    // soft glow behind the eye
    const glow = g.createRadialGradient(ex, ey, hh * 0.2, ex, ey, hh * 1.5);
    glow.addColorStop(0, rgb(0.22 * openFrac)); glow.addColorStop(1, rgb(0));
    g.fillStyle = glow; g.beginPath(); g.arc(ex, ey, hh * 1.5, 0, Math.PI * 2); g.fill();

    if (openFrac > 0.02) {
      g.save();
      roundRect(ex - hw, ey - hh, hw * 2, hh * 2, hw * 0.96); g.clip();
      pathLid(lidTop, hh * 3); g.clip();
      pathLid(lidBot, -hh * 3); g.clip();
      // the lens: bright centre, deeper colour at the rim
      const base = g.createRadialGradient(ex - hw * 0.15, ey - hh * 0.2, hh * 0.1, ex, ey, hh * 1.15);
      base.addColorStop(0, rgb(1, 0.35)); base.addColorStop(0.55, rgb(1)); base.addColorStop(1, rgb(0.55));
      g.fillStyle = base; g.fillRect(ex - hw - 5, ey - hh - 5, hw * 2 + 10, hh * 2 + 10);
      // iris and pupil, following the gaze
      const ir = Math.min(hw, hh) * 0.62;
      const px = ex + P.lx * (hw - ir * 0.7) * 0.8, py = ey + P.ly * (hh - ir * 0.7) * 0.8;
      const iris = g.createRadialGradient(px, py, ir * 0.3, px, py, ir);
      iris.addColorStop(0, rgb(1, 0.15)); iris.addColorStop(0.8, rgb(1, 0.5)); iris.addColorStop(1, rgb(0.9, 0.7));
      g.fillStyle = iris; g.beginPath(); g.arc(px, py, ir, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.45)'; g.stroke();
      const pr = ir * (0.3 + 0.42 * P.pupil);
      const pupil = g.createRadialGradient(px, py, pr * 0.2, px, py, pr);
      pupil.addColorStop(0, '#02060a'); pupil.addColorStop(0.85, '#06121c'); pupil.addColorStop(1, rgb(0.6));
      g.fillStyle = pupil; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      // reflections
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath(); g.ellipse(px - ir * 0.36, py - ir * 0.4, ir * 0.24, ir * 0.18, -0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(px + ir * 0.3, py + ir * 0.32, ir * 0.09, 0, Math.PI * 2); g.fill();
      // shade under the upper lid for depth
      const lt = lidTop(0, P, hh);
      const shade = g.createLinearGradient(0, ey + lt, 0, ey + lt + 26);
      shade.addColorStop(0, 'rgba(0,10,20,0.45)'); shade.addColorStop(1, 'rgba(0,10,20,0)');
      g.fillStyle = shade; g.fillRect(ex - hw - 5, ey + lt - 2, hw * 2 + 10, 30);
      g.restore();
    }
    // a closed (or nearly closed) eye is a soft curved line
    if (openFrac < 0.12) {
      const a = 1 - openFrac / 0.12;
      const y = ey + (lidTop(0, P, hh) + lidBot(0, P, hh)) / 2;
      g.lineWidth = 11; g.lineCap = 'round'; g.strokeStyle = rgb(a);
      g.beginPath(); g.moveTo(ex - hw * 0.75, y - 6); g.quadraticCurveTo(ex, y + 16, ex + hw * 0.75, y - 6); g.stroke();
    }
  }

  function drawBrow(side, P, rgb) {
    const hh = (EYE.h / 2) * P.eye;
    const x = side * EYE.gap + P.lx * 10;
    const y = EYE.y - hh - 30 - P.browY - (side < 0 ? P.browL : 0) + P.lidT * 18 + P.ly * 6;
    g.save();
    g.translate(x, y);
    g.rotate(-side * P.browA);
    g.lineWidth = 13; g.lineCap = 'round'; g.strokeStyle = rgb(0.85);
    g.beginPath(); g.moveTo(-40, 5); g.quadraticCurveTo(0, -7, 40, 5); g.stroke();
    g.restore();
  }

  function drawMouth(P, rgb) {
    const y0 = 128 + P.ly * 4, x0 = P.lx * 6;
    const smile = P.smile * (1 - Math.min(1, P.mo * 1.4) * 0.5);
    const hw = 52 * (1 + 0.55 * P.mw - 0.5 * P.mr) + P.mo * 6 + Math.max(0, smile) * 8;
    const oh = P.mo * 80 + P.mr * 18 + P.ms * 10;
    const lift = smile * 17;
    const k = 0.5 + P.mr * 0.45;
    const topC = y0 - oh * 0.35 + smile * 5;
    const botC = y0 + oh * 0.95 + smile * 16;
    const cy0 = y0 - lift;
    const path = () => {
      g.beginPath();
      g.moveTo(x0 - hw, cy0);
      g.bezierCurveTo(x0 - hw * k, topC, x0 + hw * k, topC, x0 + hw, cy0);
      g.bezierCurveTo(x0 + hw * k, botC, x0 - hw * k, botC, x0 - hw, cy0);
      g.closePath();
    };
    const topMid = 0.25 * cy0 + 0.75 * topC, botMid = 0.25 * cy0 + 0.75 * botC;
    if (botMid - topMid > 4) {
      g.save();
      path();
      const inside = g.createLinearGradient(0, topMid, 0, botMid);
      inside.addColorStop(0, '#03060a'); inside.addColorStop(1, '#0b1a26');
      g.fillStyle = inside; g.fill();
      g.clip();
      // tongue
      if (P.mo > 0.15) {
        g.fillStyle = 'rgba(255,120,150,' + Math.min(0.85, (P.mo - 0.15) * 2) + ')';
        g.beginPath(); g.ellipse(x0, botMid - 2, hw * 0.55, Math.max(4, (botMid - topMid) * 0.3), 0, 0, Math.PI * 2); g.fill();
      }
      // teeth: show on "s"/"f" sounds and wide-open vowels
      const teeth = 4 + P.ms * 13 + P.mo * 7;
      g.fillStyle = 'rgba(235,250,255,0.92)';
      g.fillRect(x0 - hw, topMid - 20, hw * 2, 20 + teeth);
      if (P.ms > 0.3) { g.fillRect(x0 - hw, botMid - P.ms * 9, hw * 2, 20); }
      g.fillStyle = 'rgba(0,20,30,0.18)';
      for (let i = -2; i <= 2; i++) g.fillRect(x0 + i * hw * 0.3 - 1, topMid - 20, 2, 20 + teeth);
      g.restore();
    }
    // lips: a glowing outline
    path();
    g.lineWidth = 9; g.lineJoin = 'round'; g.strokeStyle = rgb(1);
    g.shadowColor = rgb(0.6); g.shadowBlur = 16;
    g.stroke();
    g.shadowBlur = 0;
  }

  function drawChrome(now, s, rgb, state) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // mode badge
    if (info.mode && info.mode !== 'personal' && state !== 'setup') {
      const label = info.mode.toUpperCase();
      g.font = '700 ' + Math.round(22 * s) + 'px system-ui, sans-serif';
      const w = g.measureText(label).width + 36 * s;
      roundRect(cx - w / 2, cy - 290 * s, w, 40 * s, 20 * s);
      g.fillStyle = info.mode === 'work' ? 'rgba(255,196,120,0.18)' : 'rgba(150,140,220,0.2)'; g.fill();
      g.fillStyle = info.mode === 'work' ? '#ffc478' : '#b8b0f0'; g.fillText(label, cx, cy - 269 * s);
    }
    // bottom line: timer, music, or the clock
    let text = '', sub = '';
    const timer = (info.timers || []).slice().sort((a, b) => a.endsAt - b.endsAt)[0];
    if (state !== 'setup') {
      if (timer) {
        const left = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
        const mm = Math.floor(left / 60) % 60, ss = String(left % 60).padStart(2, '0');
        text = left >= 3600 ? Math.floor(left / 3600) + ':' + String(mm).padStart(2, '0') + ':' + ss : Math.floor(left / 60) + ':' + ss;
        sub = timer.label.replace(/^"(.*)" timer$/, '$1');
        const frac = timer.total ? Math.max(0, Math.min(1, (timer.endsAt - Date.now()) / timer.total)) : 0;
        g.lineWidth = 8 * s; g.lineCap = 'round'; g.strokeStyle = rgb(0.85);
        g.beginPath(); g.arc(cx, cy, R - 12 * s, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      } else if (info.music) {
        text = '♪  ' + info.music.title; sub = info.music.artist;
      } else if (state === 'idle' || state === 'sleeping' || state === 'offline') {
        text = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        if (state === 'offline') sub = 'Reconnecting…';
        else if (info.reminder) {
          // Reminders aren't countdowns: just the next one, with a bell, under the clock.
          const at = new Date(info.reminder.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
          sub = '🔔 ' + at + ' · ' + info.reminder.text.charAt(0).toUpperCase() + info.reminder.text.slice(1);
        }
      }
    }
    if (text) {
      g.fillStyle = rgb(state === 'sleeping' ? 0.35 : 0.8);
      g.font = '600 ' + Math.round(36 * s) + 'px system-ui, sans-serif';
      g.fillText(fit(text, 360 * s), cx, cy + 238 * s);
      if (sub) { g.font = '500 ' + Math.round(22 * s) + 'px system-ui, sans-serif'; g.fillStyle = rgb(0.5); g.fillText(fit(sub, 300 * s), cx, cy + 274 * s); }
    }
    if (demo && demoLabel && state !== 'setup') {
      g.font = '600 ' + Math.round(18 * s) + 'px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillText('DEMO · ' + demoLabel.toUpperCase(), cx, cy - 318 * s);
    }
    // long-press progress and toast
    const p = checkPress(now);
    if (p > 0.08) {
      g.lineWidth = 10 * s; g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.arc(cx, cy, R - 30 * s, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
      g.fillStyle = '#ffffff'; g.font = '600 ' + Math.round(26 * s) + 'px system-ui, sans-serif';
      g.fillText('Keep holding for WiFi setup', cx, cy + 200 * s);
    }
    if (toast && now < toastUntil) {
      g.fillStyle = '#ffffff'; g.font = '600 ' + Math.round(26 * s) + 'px system-ui, sans-serif';
      g.fillText(toast, cx, cy + 200 * s);
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
