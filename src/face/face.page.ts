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
export function renderFace(bootId = ''): string {
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
.back { font: inherit; font-size: 3.6vmin; font-weight: 700; padding: 1.8vmin 6vmin; border-radius: 99vmin; border: .5vmin solid #2b4a45; background: #0f1b1a; color: #e9fff8; margin-top: 1vmin; }
.back:active { transform: scale(.97); }
/* Cards: under Max's small face at the top of the round screen. */
#cardEl { position: fixed; left: 50%; top: 24vh; bottom: 9vh; transform: translateX(-50%); width: 72vmin; display: flex; flex-direction: column; justify-content: center; gap: 1.6vmin;
  color: #e9fff8; text-align: center; transition: opacity .25s ease, transform .25s ease; }
#cardEl[hidden] { display: none; }
#cardEl.enter { opacity: 0; transform: translateX(-50%) translateY(3vmin); }
#cardEl .chead { font-size: 3vmin; color: var(--dim); letter-spacing: .08em; text-transform: uppercase; font-weight: 700; }
#cardEl .ctitle { font-size: 5vmin; font-weight: 800; line-height: 1.15; }
#cardEl .csub { font-size: 3.2vmin; color: #a9cfc6; margin-top: -.6vmin; }
#cardEl .cbig { font-size: 6vmin; font-weight: 800; line-height: 1.2; margin: 1vmin 0; }
#cardEl .cbody { flex: 0 1 auto; min-height: 0; overflow-y: auto; touch-action: pan-y; scrollbar-width: none; font-size: 3.5vmin; line-height: 1.4; color: #cfeee6; text-align: left; margin: 0 2vmin; }
#cardEl .cbody::-webkit-scrollbar { display: none; }
#cardEl .cimg { width: 26vmin; height: 26vmin; border-radius: 2.4vmin; object-fit: cover; margin: 0 auto; box-shadow: 0 1vmin 4vmin rgba(0,0,0,.5); }
#cardEl .clines { flex: 0 1 auto; min-height: 0; overflow-y: auto; touch-action: pan-y; scrollbar-width: none; text-align: left; display: grid; align-content: start; gap: 1.1vmin; margin: .6vmin 1vmin 0; }
#cardEl .clines::-webkit-scrollbar { display: none; }
#cardEl .cl { display: grid; grid-template-columns: 11vmin 1fr; gap: 1.6vmin; align-items: baseline; }
#cardEl .cl.act { grid-template-columns: 11vmin 1fr auto; align-items: center; }
#cardEl .cl .lact { font: inherit; font-size: 2.8vmin; font-weight: 700; padding: 1.2vmin 2.6vmin; border-radius: 99vmin; border: .4vmin solid #2f8a7a; background: #1d5d52; color: #e9fff8; }
#cardEl .cl.done .lact { background: transparent; border-color: #2b4a45; color: #a9cfc6; }
#cardEl .cl.done .x { text-decoration: line-through; }
#cardEl .cl .lact:active { transform: scale(.95); }
#cardEl .cl .t { font-size: 2.8vmin; color: #8fb8ae; font-variant-numeric: tabular-nums; text-align: right; font-weight: 700; }
#cardEl .cl .x { font-size: 3.3vmin; line-height: 1.25; }
#cardEl .cl .x small { display: block; font-size: 2.6vmin; color: var(--dim); margin-top: .2vmin; }
#cardEl .cl.done { opacity: .45; }
#cardEl .tag { display: inline-block; font-size: 2.2vmin; font-weight: 800; padding: .2vmin 1.2vmin; border-radius: 99vmin; margin-left: 1vmin; vertical-align: .3vmin; letter-spacing: .03em; }
#cardEl .tag.critical, #cardEl .tag.overdue { background: #4a1714; color: #ffb4a8; }
#cardEl .tag.important { background: #3d2c0c; color: #ffd27a; }
#cardEl .bar { height: .9vmin; border-radius: 1vmin; background: #1b2a28; overflow: hidden; margin: .4vmin 6vmin 0; }
#cardEl .bar i { display: block; height: 100%; background: var(--ink); width: 0; }
#cardEl .cacts { display: flex; gap: 2vmin; justify-content: center; margin-top: 1vmin; }
#cardEl .cacts button { font: inherit; font-size: 3.6vmin; font-weight: 700; padding: 1.8vmin 5vmin; border-radius: 99vmin; border: .5vmin solid #2b4a45; background: #0f1b1a; color: #e9fff8; }
#cardEl .cacts button.primary { background: #1d5d52; border-color: #2f8a7a; }
#cardEl .cacts button.icon { font-size: 5vmin; padding: 1.4vmin 3.4vmin; line-height: 1; }
#cardEl .cacts button:active, #cardEl .cback:active { transform: scale(.96); }
#cardEl .cback { font: inherit; font-size: 3vmin; font-weight: 700; background: transparent; border: 0; color: var(--dim); padding: 1vmin; }
/* Live captions under the face. */
#caption { position: fixed; left: 50%; bottom: 13vh; transform: translateX(-50%); width: 66vmin; text-align: center; font-size: 3.6vmin; line-height: 1.3;
  color: #dff7f0; max-height: 15vh; overflow: hidden; transition: opacity .3s; }
#caption[hidden] { display: none; }
#caption.you { color: #9fc7ff; }
#caption b { font-weight: 700; }
/* Evening photo frame: your pictures fading one into the next, with the clock. */
#frame { position: fixed; inset: 0; background: #000; }
#frame[hidden] { display: none; }
#frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 2.5s ease; }
#frame img.on { opacity: 1; }
#frame .fclock { position: absolute; left: 0; right: 0; bottom: 12vh; text-align: center; color: #fff; text-shadow: 0 .4vmin 2.4vmin rgba(0,0,0,.75);
  font-size: 10vmin; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
#frame .fclock small { display: block; font-size: 3.4vmin; font-weight: 600; margin-top: 1.2vmin; opacity: .9; }
#frame .fshade { position: absolute; left: 0; right: 0; bottom: 0; height: 40vh; background: linear-gradient(transparent, rgba(0,0,0,.55)); }
/* Start-up code keypad. */
#lock { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(4, 7, 10, .94); color: #e9fff8; text-align: center; }
#lock[hidden] { display: none; }
#lock .lk { display: grid; gap: 2vmin; justify-items: center; }
#lock .lt { font-size: 4.4vmin; font-weight: 700; }
#lock .dots { display: flex; gap: 2.4vmin; height: 4vmin; align-items: center; }
#lock .dots i { width: 2.8vmin; height: 2.8vmin; border-radius: 50%; border: .45vmin solid #5f8f86; box-sizing: border-box; }
#lock .dots i.on { background: var(--ink); border-color: var(--ink); }
#lock .dots.shake { animation: shake .35s; }
@keyframes shake { 25% { transform: translateX(-2vmin); } 75% { transform: translateX(2vmin); } }
#lock .lmsg { font-size: 3vmin; color: #ffb36b; min-height: 3.6vmin; }
#lock .pad { display: grid; grid-template-columns: repeat(3, 13vmin); gap: 2vmin 3vmin; }
#lock .pad button { font: inherit; font-size: 5.6vmin; font-weight: 600; width: 13vmin; height: 13vmin; border-radius: 50%; border: .4vmin solid #2b4a45; background: #0f1b1a; color: #e9fff8; }
#lock .pad button:active { background: #1d5d52; transform: scale(.95); }
#lock .pad button.blank { visibility: hidden; }
#lock .pad button.del { border-color: transparent; background: transparent; font-size: 4.6vmin; }
#lock.paused .pad button { opacity: .35; }
#menu { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(4, 7, 10, .96); text-align: center; color: #e9fff8; }
#menu[hidden] { display: none; }
#menu .list { width: 58vmin; display: grid; gap: 2.4vmin; }
#menu h1 { margin: 0 0 1vmin; font-size: 5vmin; font-weight: 700; }
#menu p { margin: 0; font-size: 3.4vmin; line-height: 1.35; color: #cfeee6; }
#menu button { font: inherit; font-size: 4.2vmin; font-weight: 700; padding: 2.6vmin 0; border-radius: 99vmin; border: .5vmin solid #2b4a45; background: #0f1b1a; color: #e9fff8; }
#menu button:active { transform: scale(.97); }
#menu button.off { background: #4a1714; border-color: #7a2a24; color: #ffd9d3; }
#menu button.quiet { background: transparent; border-color: transparent; color: var(--dim); }
#menu .list.main { gap: 1.8vmin; }
#menu .list.main button { font-size: 3.6vmin; padding: 1.9vmin 0; }
#menu .ctl { display: grid; grid-template-columns: 11vmin 1fr 11vmin; align-items: center; gap: 1.6vmin; }
#menu .ctl button { padding: 1.4vmin 0; font-size: 5vmin; line-height: 1; }
#menu .ctl .val { font-size: 3.4vmin; color: #cfeee6; }
#menu .ctl .val b { display: block; font-size: 4.4vmin; color: #ffffff; font-variant-numeric: tabular-nums; }
#menu .bar { height: .9vmin; border-radius: 1vmin; background: #1b2a28; margin-top: .8vmin; overflow: hidden; }
#menu .bar i { display: block; height: 100%; background: var(--ink); }
#menu .ctl.off { opacity: .45; }
#menu .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1.8vmin; }
#menu .changes { font-size: 3vmin; text-align: left; color: #cfeee6; margin: 0 2vmin; }
#menu .changes div { margin: .8vmin 0; }
#menu .rows { display: grid; gap: 2.6vmin; margin-bottom: 1.2vmin; }
</style></head>
<body>
<canvas id="c"></canvas>
<div id="setup" hidden><div class="card" id="card"></div></div>
<div id="cardEl" hidden></div>
<div id="caption" hidden></div>
<div id="lock" hidden><div class="lk"><div class="lt">🔒 Enter your code</div><div class="dots" id="lkDots"></div><div class="lmsg" id="lkMsg"></div><div class="pad" id="lkPad"></div></div></div>
<div id="frame" hidden><img id="fa" alt=""><img id="fb" alt=""><div class="fshade"></div><div class="fclock" id="fclock"></div></div>
<div id="menu" hidden><div class="list" id="menuList"></div></div>
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
    // Max restarted with a new version: load the new face (the old page would keep running).
    const BOOT = ${JSON.stringify(bootId)};
    es.addEventListener('hello', (e) => { const b = JSON.parse(e.data).boot; if (BOOT && b && b !== BOOT) location.reload(); });
    es.addEventListener('info', (e) => { info = JSON.parse(e.data); connected = true; lastMsg = Date.now(); renderSetup(); renderCard(); renderCaption(); renderFrame(); renderLock(); });
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
    ['thinking', 'neutral', 'Checking email'], ['idle', 'concerned', 'Could not finish'],
    ['speaking', 'neutral', 'Speaking'], ['speaking', 'happy', 'Speaking happy'], ['speaking', 'concerned', 'Speaking concerned'],
    ['idle', 'happy', 'Happy'], ['idle', 'curious', 'Curious'], ['idle', 'surprised', 'Surprised'], ['idle', 'concerned', 'Concerned'],
    ['idle', 'focused', 'Focused'], ['idle', 'sleepy', 'Sleepy'], ['sleeping', 'neutral', 'Asleep'], ['setup', 'neutral', 'WiFi setup'],
    ['idle', 'surprised', 'Card timer'], ['speaking', 'happy', 'Card music'], ['speaking', 'neutral', 'Card day'], ['listening', 'neutral', 'Captions'],
    ['idle', 'neutral', 'Glance'], ['idle', 'neutral', 'Photo frame'],
  ];
  const FOREVER = Date.now() + 1e10;
  const DEMO_CARDS = {
    'Card timer': { id: 'd1', kind: 'alert', icon: '⏲', title: 'Timer', big: 'Pasta timer done', actions: [{ id: 'ok', label: 'OK', style: 'primary' }, { id: 'again', label: 'Again' }], until: FOREVER },
    'Card music': { id: 'd2', kind: 'music', icon: '♪', title: 'Yellow', subtitle: 'Coldplay', progress: { position: 95000, duration: 266000, at: Date.now() }, actions: [{ id: 'p', label: '⏮', style: 'icon' }, { id: 'x', label: '⏸', style: 'icon' }, { id: 'n', label: '⏭', style: 'icon' }], until: FOREVER },
    'Card day': { id: 'd3', kind: 'list', icon: '☀', title: 'Your day', subtitle: 'Wednesday 14 October', until: FOREVER, lines: [
      { time: '08:30', text: 'Daily stand-up', sub: 'until 08:45 · Teams', tag: 'done' },
      { time: '10:00', text: 'Q4 planning', sub: 'until 11:00 · Room 2', tag: 'event' },
      { time: '12:30', text: 'Lunch with Marco', tag: 'event' },
      { time: '15:00', text: 'Call Mum', tag: 'reminder' },
      { time: 'late', text: 'Renew the car insurance', sub: 'was due Mon 12 Oct · Home admin', tag: 'overdue', action: { id: 'done-1', label: 'Done' } },
      { time: 'todo', text: 'Send the Q3 report', tag: 'critical', action: { id: 'done-2', label: 'Done' } },
      { time: '✓', text: 'Book the dentist', sub: 'Done', tag: 'done', action: { id: 'undo-3', label: 'Undo' } }] },
  };
  SCENES.push(['speaking', 'happy', 'Card steps'], ['speaking', 'neutral', 'Card answer'], ['speaking', 'neutral', 'Card news']);
  SCENES.push(['idle', 'neutral', 'Notify email'], ['idle', 'concerned', 'Notify todo']);
  DEMO_CARDS['Notify email'] = { id: 'd7', kind: 'notice', icon: '✉️', title: 'Important email', subtitle: 'From Anna Rossi', big: 'Contract signed: next steps for the Milan launch', until: FOREVER,
    actions: [{ id: 'read', label: 'Read it', style: 'primary' }, { id: 'ok', label: 'OK' }] };
  DEMO_CARDS['Notify todo'] = { id: 'd8', kind: 'alert', icon: '⏰', title: 'Overdue', big: 'Renew the car insurance', subtitle: 'Home admin · critical', until: FOREVER,
    actions: [{ id: 'done', label: 'Done', style: 'primary' }, { id: 'tomorrow', label: 'Tomorrow' }] };
  SCENES.push(['speaking', 'happy', 'Card ingredients']);
  DEMO_CARDS['Card ingredients'] = { id: 'd9', kind: 'list', icon: '🧀', title: 'Macaroni cheese', subtitle: 'Ingredients · then 6 steps', until: FOREVER,
    lines: [{ text: '300 g macaroni' }, { text: '50 g butter' }, { text: '50 g plain flour' }, { text: '600 ml milk' }, { text: '250 g mature cheddar' }],
    actions: [{ id: 'next', label: 'Start', style: 'primary' }] };
  SCENES.push(['speaking', 'neutral', 'Card email'], ['idle', 'neutral', 'Locked']);
  DEMO_CARDS['Card email'] = { id: 'd10', kind: 'list', icon: '✉️', title: 'Email', subtitle: 'From Anna Rossi · 09:42', big: 'Milan launch: venue confirmed', until: FOREVER,
    body: 'Anna confirms the venue for the Milan launch on 12 November and has signed the contract. She needs your final guest list by Friday, and asks whether you want the evening or the afternoon slot.' };
  DEMO_CARDS['Card steps'] = { id: 'd4', kind: 'notice', icon: '🍝', title: 'Carbonara', subtitle: 'Step 3 of 7', until: FOREVER,
    big: 'Fry the guanciale in a dry pan until golden, about 5 minutes',
    lines: [{ time: 'next', text: 'Whisk 3 egg yolks and 1 whole egg with 50 g pecorino', tag: 'done' }],
    actions: [{ id: 'previous', label: 'Back' }, { id: 'next', label: 'Next', style: 'primary' }] };
  DEMO_CARDS['Card answer'] = { id: 'd5', kind: 'list', icon: '🌦️', title: 'Weekend weather', subtitle: 'Clapham', until: FOREVER, lines: [
    { time: 'Sat', text: '☀️ 18° / 9°', sub: 'Sunny, light breeze' },
    { time: 'Sun', text: '🌧️ 14° / 8°', sub: 'Rain from midday, 80%' },
    { time: 'Mon', text: '⛅ 15° / 7°', sub: 'Cloudy spells' }] };
  DEMO_CARDS['Card news'] = { id: 'd6', kind: 'list', icon: '📰', title: 'Morning news', subtitle: '5 articles · today at 07:00', until: FOREVER, lines: [
    { time: '1', text: 'Bank of England holds rates as inflation eases', sub: 'BBC News' },
    { time: '2', text: 'New Raspberry Pi AI board doubles performance', sub: 'The Verge' },
    { time: '3', text: 'Serie A: Inter top the table after derby win', sub: 'Gazzetta' },
    { time: '4', text: 'London Underground strike called off', sub: 'Evening Standard' },
    { time: '5', text: 'Why sleep matters more than you think', sub: 'The Guardian' }] };
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
        activity: label === 'Checking email' ? { icon: '📧', label: 'Checking your email' } : undefined,
        notice: label === 'Could not finish' ? "Couldn't finish: checking your email" : undefined,
        music: label === 'Speaking' ? { title: 'Yellow', artist: 'Coldplay' } : undefined,
        wifi: state === 'setup' ? { state: 'setup', ssid: 'Max-Setup', password: '48213097', qrSvg: demoQr() } : undefined,
        card: DEMO_CARDS[label],
        caption: label === 'Captions' ? { who: 'you', text: "What's the weather like this afternoon?" } : undefined,
        glance: label === 'Glance' || label === 'Photo frame' ? {
          weather: { icon: '⛅', temp: 14, text: 'Partly cloudy', hi: 16, lo: 9, rain: 30 },
          next: { time: '10:00', title: 'Q4 planning', now: false },
          todos: { critical: 2, overdue: 1, today: 3 },
          frame: label === 'Photo frame' ? { photos: ['demo-1.jpg', 'demo-2.jpg', 'demo-3.jpg'], everySec: 6 } : undefined,
        } : undefined,
      };
      if (label === 'Locked') info.locked = { triesLeft: 5 };
      setTimeout(() => { renderCard(); renderCaption(); renderFrame(); renderLock(); }, 0); // after the card code below is set up
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

  // "Back to Max" on the WiFi screen: hide it at once (the box takes a few seconds to leave setup mode).
  let wifiBackUntil = 0;
  function renderSetup() {
    const w = info.wifi;
    const show = info.state === 'setup' && w && Date.now() > wifiBackUntil;
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
        '<div class="hint">Scan with your phone camera, then choose your WiFi on the page that opens.</div>' +
        '<button class="back" id="wifiBack">Back to Max</button>';
      const back = document.getElementById('wifiBack');
      if (back) back.onclick = (e) => {
        e.stopPropagation();
        wifiBackUntil = Date.now() + 15000;
        setupEl.hidden = true;
        fetch('/wifi-cancel', { method: 'POST' }).catch(() => undefined);
      };
    }
  }

  // ---------- cards (Max's face shrinks to the top while one shows) ----------
  const cardEl = document.getElementById('card' + 'El');
  const captionEl = document.getElementById('caption');
  let cardKey = '', cardGone = '';
  const escC = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function cardShown() { return info.card && info.card.id !== cardGone && info.card.until > Date.now() && info.state !== 'setup'; }
  function renderCard() {
    const c = cardShown() ? info.card : undefined;
    const key = c ? JSON.stringify(Object.assign({}, c, { until: 0 })) : '';
    if (key === cardKey) return;
    const fresh = !cardKey || (c && JSON.parse(cardKey || '{}').id !== c.id);
    cardKey = key;
    if (!c) { cardEl.hidden = true; cardEl.innerHTML = ''; return; }
    let h = '<div class="chead">' + escC((c.icon ? c.icon + '  ' : '') + c.title) + '</div>';
    if (c.kind === 'music') {
      h = (c.image ? '<img class="cimg" src="' + escC(c.image) + '" alt="">' : '<div class="chead">' + escC(c.icon || '') + '</div>') +
        '<div class="ctitle">' + escC(c.title) + '</div>' + (c.subtitle ? '<div class="csub">' + escC(c.subtitle) + '</div>' : '') +
        (c.progress ? '<div class="bar"><i id="cprog"></i></div>' : '');
    } else {
      if (c.subtitle) h += '<div class="csub">' + escC(c.subtitle) + '</div>';
      if (c.big) h += '<div class="cbig">' + escC(c.big) + '</div>';
      if (c.body) h += '<div class="cbody">' + escC(c.body) + '</div>';
      if (c.image) h += '<img class="cimg" src="' + escC(c.image) + '" alt="">';
      if (c.lines && c.lines.length) {
        h += '<div class="clines">' + c.lines.map((l) => '<div class="cl' + (l.tag === 'done' ? ' done' : '') + (l.action ? ' act' : '') + '"><div class="t">' + escC(l.time || '') + '</div><div class="x">' + escC(l.text) +
          (l.tag && l.tag !== 'event' && l.tag !== 'done' && l.tag !== 'reminder' ? '<span class="tag ' + l.tag + '">' + l.tag.toUpperCase() + '</span>' : '') +
          (l.tag === 'reminder' ? ' 🔔' : '') + (l.sub ? '<small>' + escC(l.sub) + '</small>' : '') + '</div>' +
          (l.action ? '<button class="lact" data-a="' + escC(l.action.id) + '">' + escC(l.action.label) + '</button>' : '') + '</div>').join('') + '</div>';
      }
    }
    if (c.actions && c.actions.length) h += '<div class="cacts">' + c.actions.map((a) => '<button class="' + (a.style || '') + '" data-a="' + escC(a.id) + '">' + escC(a.label) + '</button>').join('') + '</div>';
    h += '<button class="cback" data-a="dismiss">Back to Max</button>';
    cardEl.innerHTML = h;
    cardEl.hidden = false;
    if (fresh) { cardEl.classList.add('enter'); requestAnimationFrame(() => requestAnimationFrame(() => cardEl.classList.remove('enter'))); }
    for (const b of cardEl.querySelectorAll('button[data-a]')) {
      b.onpointerdown = (e) => e.stopPropagation();
      b.onclick = (e) => {
        e.stopPropagation();
        const a = b.getAttribute('data-a');
        if (a === 'dismiss') { cardGone = c.id; renderCard(); renderCaption(); }
        fetch('/card?id=' + encodeURIComponent(c.id) + '&action=' + encodeURIComponent(a), { method: 'POST' }).catch(() => undefined);
      };
    }
    renderCaption();
  }
  // Music position moves on its own between updates.
  setInterval(() => {
    const p = cardShown() && info.card.progress, bar = document.getElementById('cprog');
    if (!p || !bar) return;
    const pos = p.paused ? p.position : p.position + (Date.now() - p.at);
    bar.style.width = Math.min(100, (pos / p.duration) * 100) + '%';
    if (info.card && info.card.until <= Date.now()) renderCard();
  }, 500);
  setInterval(() => { if (cardKey && !cardShown()) renderCard(); if (!captionEl.hidden && !(info.caption)) renderCaption(); }, 1000);
  function renderCaption() {
    const c = info.caption;
    const show = c && !cardShown() && menuEl.hidden && info.state !== 'setup' && info.state !== 'sleeping';
    captionEl.hidden = !show;
    if (!show) return;
    captionEl.className = c.who === 'you' ? 'you' : '';
    captionEl.innerHTML = (c.who === 'you' ? '<b>You: </b>' : '') + escC(c.text);
  }

  // ---------- evening photo frame (while Max is idle; "Hey Max" or a touch brings him back) ----------
  const FRAME_IDLE_MS = 2 * 60000;
  const frameEl = document.getElementById('frame');
  const frameImgs = [document.getElementById('fa'), document.getElementById('fb')];
  const fclock = document.getElementById('fclock');
  let idleSince = demo ? 0 : Date.now(), frameIdx = -1, frameTop = 0, frameNext = 0;
  function demoPhoto(i) {
    const c = document.createElement('canvas'); c.width = 360; c.height = 360;
    const x = c.getContext('2d');
    const hues = [[210, 30], [25, 340], [140, 190]][i % 3];
    const gr = x.createLinearGradient(0, 0, 360, 360);
    gr.addColorStop(0, 'hsl(' + hues[0] + ',55%,45%)'); gr.addColorStop(1, 'hsl(' + hues[1] + ',60%,25%)');
    x.fillStyle = gr; x.fillRect(0, 0, 360, 360);
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(60 + k * 55, 120 + 60 * Math.sin(k + i), 30 + k * 6, 0, Math.PI * 2); x.fill(); }
    return c.toDataURL();
  }
  function renderFrame() {
    const f = info.glance && info.glance.frame;
    const busy = info.state !== 'idle' || cardShown() || !menuEl.hidden || !captionEl.hidden;
    if (busy) idleSince = Math.max(idleSince, Date.now());
    const want = f && f.photos && f.photos.length && !busy && Date.now() - idleSince >= (demo ? 0 : FRAME_IDLE_MS);
    if (!want) {
      if (!frameEl.hidden) { frameEl.hidden = true; for (const im of frameImgs) im.classList.remove('on'); frameIdx = -1; frameNext = 0; }
      return;
    }
    frameEl.hidden = false;
    const d = new Date();
    fclock.innerHTML = escC(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })) +
      '<small>' + escC(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })) + '</small>';
    if (Date.now() < frameNext) return;
    frameNext = Date.now() + Math.max(5, f.everySec || 20) * 1000;
    frameIdx = (frameIdx + 1) % f.photos.length;
    // Load the next picture behind the current one, then fade it in.
    const back = frameImgs[1 - frameTop];
    back.onload = () => { back.classList.add('on'); frameImgs[frameTop].classList.remove('on'); frameTop = 1 - frameTop; };
    back.src = demo ? demoPhoto(frameIdx) : '/photos/' + encodeURIComponent(f.photos[frameIdx]);
  }
  setInterval(renderFrame, 1000);

  // ---------- start-up code keypad (until the code is entered, Max shows nothing personal) ----------
  const lockEl = document.getElementById('lock');
  const lkDots = document.getElementById('lkDots'), lkMsg = document.getElementById('lkMsg'), lkPad = document.getElementById('lkPad');
  let lkCode = '', lkNote = '', lkBusy = false;
  lkPad.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
    '<button data-k="' + k + '" class="' + (k === '' ? 'blank' : k === 'del' ? 'del' : '') + '" aria-label="' + (k === 'del' ? 'Delete' : k) + '">' + (k === 'del' ? '⌫' : k) + '</button>').join('');
  for (const b of lkPad.querySelectorAll('button')) {
    b.onpointerdown = (e) => e.stopPropagation();
    b.onclick = (e) => { e.stopPropagation(); lkKey(b.getAttribute('data-k')); };
  }
  function lkPaused() { return info.locked && info.locked.pausedUntil && info.locked.pausedUntil > Date.now(); }
  function lkKey(k) {
    if (lkBusy || lkPaused() || !k) return;
    if (k === 'del') lkCode = lkCode.slice(0, -1);
    else if (lkCode.length < 6) lkCode += k;
    lkNote = '';
    renderLock();
    if (lkCode.length === 6) lkSubmit();
  }
  function lkWrong(message) {
    lkCode = ''; lkNote = message || 'Wrong code.';
    lkDots.classList.remove('shake'); void lkDots.offsetWidth; lkDots.classList.add('shake');
    renderLock();
  }
  function lkSubmit() {
    lkBusy = true;
    const code = lkCode;
    if (demo) {
      lkBusy = false;
      if (code === '246810') { info.locked = undefined; lkCode = ''; renderLock(); } else lkWrong('Wrong code.');
      return;
    }
    fetch('/unlock', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=' + encodeURIComponent(code) })
      .then((r) => r.json())
      .then((j) => { lkBusy = false; if (j.ok) { lkCode = ''; lkNote = ''; } else lkWrong(j.message); })
      .catch(() => { lkBusy = false; lkWrong('Could not check the code. Try again.'); });
  }
  function renderLock() {
    const show = Boolean(info.locked) && info.state !== 'setup';
    lockEl.hidden = !show;
    if (!show) { lkCode = ''; lkNote = ''; return; }
    lkDots.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => '<i class="' + (i < lkCode.length ? 'on' : '') + '"></i>').join('');
    const paused = lkPaused();
    lockEl.classList.toggle('paused', Boolean(paused));
    lkMsg.textContent = paused ? 'Too many tries. Wait ' + Math.ceil((info.locked.pausedUntil - Date.now()) / 1000) + ' s.'
      : lkNote || (info.locked.triesLeft < 5 ? info.locked.triesLeft + ' tries left' : '');
  }
  setInterval(() => { if (!lockEl.hidden) renderLock(); }, 1000); // the pause countdown

  // ---------- hold for 2 s: the options menu (turn off, restart, WiFi setup) ----------
  const HOLD_MS = 2000;
  const menuEl = document.getElementById('menu');
  const menuList = document.getElementById('menuList');
  let pressAt = 0, pressFired = false, toast = '', toastUntil = 0, menuIdle = 0, countdown = 0;
  let frameTouch = false;
  addEventListener('pointerdown', () => {
    if (!frameEl.hidden) { frameTouch = true; idleSince = Date.now() + (demo ? 15000 : 0); renderFrame(); return; }
    if (!menuEl.hidden) return;
    pressAt = performance.now(); pressFired = false;
  });
  // A short tap on the face (not a hold): Max shows what's useful (e.g. the music card).
  addEventListener('pointerup', () => {
    if (frameTouch) { frameTouch = false; pressAt = 0; return; }
    const quick = pressAt && performance.now() - pressAt < 350 && !pressFired && menuEl.hidden && !cardShown();
    pressAt = 0;
    if (quick && !demo) fetch('/tap', { method: 'POST' }).catch(() => undefined);
  });
  addEventListener('pointercancel', () => { pressAt = 0; });
  function checkPress(now) {
    if (!pressAt || pressFired || !menuEl.hidden) return 0;
    const p = (now - pressAt) / HOLD_MS;
    if (p >= 1) { pressFired = true; pressAt = 0; showMenu(); }
    return Math.min(1, p);
  }
  function menu(html, actions) {
    clearInterval(countdown);
    menuList.innerHTML = html;
    menuList.className = 'list' + (html.indexOf('class="rows"') >= 0 ? ' main' : '');
    menuEl.hidden = false;
    for (const [id, fn] of Object.entries(actions)) {
      const b = document.getElementById(id);
      if (b) b.onclick = (e) => { e.stopPropagation(); fn(); };
    }
    wireRows();
    clearTimeout(menuIdle);
    menuIdle = setTimeout(closeMenu, 20000); // nobody chose: back to the face
  }
  function closeMenu() { clearInterval(countdown); clearTimeout(menuIdle); menuEl.hidden = true; renderCaption(); }
  // Volume and brightness rows: − and + change them in steps of 10.
  const ctl = (id, label, v, enabled) => '<div class="ctl' + (enabled ? '' : ' off') + '"><button id="' + id + 'Down" aria-label="' + label + ' down">−</button>' +
    '<div class="val">' + label + '<b>' + (v === undefined || v === null ? '–' : v + '%') + '</b><div class="bar"><i style="width:' + (v || 0) + '%"></i></div></div>' +
    '<button id="' + id + 'Up" aria-label="' + label + ' up">+</button></div>';
  let device = {};
  function deviceRows() {
    return ctl('vol', 'Volume', device.volume, device.volume !== undefined) +
      ctl('bri', 'Brightness', device.onBox ? device.brightness : undefined, device.onBox && device.brightnessSupported !== false);
  }
  function deviceChange(what, dir) {
    fetch('/device?' + what + '=' + dir, { method: 'POST' }).then((r) => r.json()).then((d) => { device = d; refreshRows(); }).catch(() => undefined);
    clearTimeout(menuIdle); menuIdle = setTimeout(closeMenu, 20000);
  }
  function refreshRows() {
    const rows = menuList.querySelector('.rows');
    if (!rows) return;
    rows.innerHTML = deviceRows();
    wireRows();
  }
  function wireRows() {
    for (const [id, what] of [['vol', 'volume'], ['bri', 'brightness']]) {
      const up = document.getElementById(id + 'Up'), down = document.getElementById(id + 'Down');
      if (up) up.onclick = (e) => { e.stopPropagation(); deviceChange(what, 'up'); };
      if (down) down.onclick = (e) => { e.stopPropagation(); deviceChange(what, 'down'); };
    }
  }
  function showMenu() {
    if (info.locked) {
      // Locked: only turning off or restarting (whoever holds the box can pull the plug anyway).
      menu('<button class="off" id="mOff">Turn off</button><button id="mRestart">Restart</button><button class="quiet" id="mCancel">Back</button>', {
        mOff: () => confirmPower('poweroff'), mRestart: () => confirmPower('reboot'), mCancel: closeMenu,
      });
      return;
    }
    fetch('/device').then((r) => r.json()).then((d) => { device = d; refreshRows(); }).catch(() => undefined);
    menu('<div class="rows">' + deviceRows() + '</div><button class="off" id="mOff">Turn off</button><button id="mRestart">Restart</button>' +
      '<div class="pair"><button id="mWifi">WiFi setup</button><button id="mUpdate">Update</button></div>' +
      (info.canLock ? '<button id="mLock">🔒 Lock</button>' : '') + '<button class="quiet" id="mCancel">Back to Max</button>', {
      mUpdate: showUpdate,
      mLock: () => { closeMenu(); fetch('/lock', { method: 'POST' }).catch(() => undefined); if (demo) { info.locked = { triesLeft: 5 }; renderLock(); } },
      mOff: () => confirmPower('poweroff'),
      mRestart: () => confirmPower('reboot'),
      mWifi: () => {
        closeMenu();
        fetch('/wifi-setup', { method: 'POST' }).then((r) => {
          toast = r.ok ? 'Starting WiFi setup…' : 'WiFi setup only works on the Max box';
        }).catch(() => { toast = 'WiFi setup only works on the Max box'; });
        toast = 'Starting WiFi setup…'; toastUntil = performance.now() + 4000;
      },
      mCancel: closeMenu,
    });
  }
  // Update: check GitHub for a new version, show what's new, install on request.
  const escH = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const BACK = '<button class="quiet" id="uBack">Back to Max</button>';
  function showUpdate() {
    menu('<h1>Updates</h1><p>Checking for a new version…</p>' + BACK, { uBack: closeMenu });
    fetch('/update').then((r) => r.json()).then((d) => {
      if (menuEl.hidden) return;
      if (d.busy) return menu('<h1>Updating…</h1><p>' + escH(d.message) + '</p>' + BACK, { uBack: closeMenu });
      if (!d.onBox) return menu('<h1>Updates</h1><p>Updating from here only works on the Max box.</p>' + BACK, { uBack: closeMenu });
      if (d.error) return menu('<h1>Updates</h1><p>' + escH(d.error) + '</p>' + BACK, { uBack: closeMenu });
      if (!d.behind) return menu('<h1>Up to date</h1><p>Max has the latest version.</p>' + BACK, { uBack: closeMenu });
      const list = (d.changes || []).slice(0, 3).map((c) => '<div>• ' + escH(c) + '</div>').join('') +
        ((d.changes || []).length > 3 ? '<div>…and ' + (d.changes.length - 3) + ' more</div>' : '');
      menu('<h1>' + d.behind + ' new change' + (d.behind === 1 ? '' : 's') + '</h1><div class="changes">' + list + '</div>' +
        '<button id="uGo">Update now</button>' + BACK, {
        uBack: closeMenu,
        uGo: () => fetch('/update', { method: 'POST' }).then((r) => r.json()).then((x) => {
          menu(x.ok
            ? '<h1>Updating…</h1><p>Max downloads the new version and restarts by himself. Back in 5 to 15 minutes.</p>' + BACK
            : '<h1>Updates</h1><p>' + escH(x.message) + '</p>' + BACK, { uBack: closeMenu });
        }).catch(() => menu('<h1>Updates</h1><p>Could not start the update.</p>' + BACK, { uBack: closeMenu })),
      });
    }).catch(() => menu('<h1>Updates</h1><p>Could not check for updates.</p>' + BACK, { uBack: closeMenu }));
  }
  // A few seconds to change your mind, then the box is asked to turn off / restart.
  function confirmPower(action) {
    const off = action === 'poweroff';
    let left = 5;
    const draw = () => menu('<h1>' + (off ? 'Turning off' : 'Restarting') + ' in ' + left + '…</h1>' +
      '<button class="quiet" id="pCancel">Cancel: back to Max</button>', { pCancel: closeMenu });
    draw();
    countdown = setInterval(() => {
      left -= 1;
      if (left > 0) { const h = menuList.querySelector('h1'); if (h) h.textContent = (off ? 'Turning off' : 'Restarting') + ' in ' + left + '…'; return; }
      clearInterval(countdown);
      fetch('/power?action=' + action, { method: 'POST' }).then((r) => {
        if (!r.ok) throw new Error();
        menu(off
          ? '<h1>Goodbye for now</h1><p>When the screen goes dark it is safe to unplug.</p><p>To turn Max on again, press the power button on the Raspberry Pi.</p>'
          : '<h1>Restarting…</h1><p>Back in about a minute.</p>', {});
        clearTimeout(menuIdle);
        // If the box hasn't gone down after 30 s, something stopped it: offer the way back.
        setTimeout(() => {
          if (menuEl.hidden) return;
          menuList.insertAdjacentHTML('beforeend', '<button class="quiet" id="pBack">Back to Max</button>');
          const bb = document.getElementById('pBack');
          if (bb) bb.onclick = (e) => { e.stopPropagation(); closeMenu(); };
        }, 30000);
      }).catch(() => {
        menu('<h1>Not available</h1><p>Turning off and restarting only work on the Max box.</p><button class="quiet" id="pOk">Back to Max</button>', { pOk: closeMenu });
      });
    }, 1000);
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
    const state = offline ? 'offline' : info.state === 'setup' && Date.now() < wifiBackUntil ? 'idle' : info.state;
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
    // While a card shows, the face shrinks to the top (still blinking, looking and talking).
    const cmp = spring('cmp', cardShown() && menuEl.hidden ? 1 : 0, dt, 90, 0.95);
    const fy = cy - cmp * R * 0.69, fk = 1 - cmp * 0.7;

    drawBackground(P, rgb, s);
    if (state === 'setup') { drawChrome(now, s, rgb, state); requestAnimationFrame(frame); return; }

    // Head: gentle breathing, a nod with emphasis, tilt, and a slight turn towards where he looks.
    const breathe = Math.sin(now / 1300);
    g.save();
    g.translate(cx + P.lx * 7 * s * fk, fy + (breathe * 3 - P.mo * 4 + P.ly * 5) * s * fk);
    g.rotate((P.tilt * Math.PI) / 180);
    g.scale(s * fk * (1 + breathe * 0.005), s * fk * (1 + breathe * 0.005));
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
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.86 * (cmp > 0.5 ? 0.3 : 1), (cmp > 0.5 ? fy : cy) + Math.sin(a) * R * 0.86 * (cmp > 0.5 ? 0.3 : 1), 9 * s * (cmp > 0.5 ? 0.6 : 1), 0, Math.PI * 2); g.fill();
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
    drawChrome(now, s, rgb, state, cmp);
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

  function drawChrome(now, s, rgb, state, cmp = 0) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // mode badge
    if (info.mode && info.mode !== 'personal' && state !== 'setup' && cmp < 0.3) {
      const label = info.mode.toUpperCase();
      g.font = '700 ' + Math.round(22 * s) + 'px system-ui, sans-serif';
      const w = g.measureText(label).width + 36 * s;
      roundRect(cx - w / 2, cy - 290 * s, w, 40 * s, 20 * s);
      g.fillStyle = info.mode === 'work' ? 'rgba(255,196,120,0.18)' : 'rgba(150,140,220,0.2)'; g.fill();
      g.fillStyle = info.mode === 'work' ? '#ffc478' : '#b8b0f0'; g.fillText(label, cx, cy - 269 * s);
    }
    // weather at the top while idle
    const gl = info.glance || {};
    if (gl.weather && state === 'idle' && cmp < 0.3) {
      const w = gl.weather;
      g.font = '600 ' + Math.round(30 * s) + 'px system-ui, sans-serif'; g.fillStyle = rgb(0.8);
      const top = info.mode && info.mode !== 'personal' ? cy - 218 * s : cy - 262 * s;
      g.fillText(fit(w.icon + '  ' + w.temp + '°  ·  ' + w.text, 330 * s), cx, top);
      if (w.hi !== undefined) {
        g.font = '500 ' + Math.round(20 * s) + 'px system-ui, sans-serif'; g.fillStyle = rgb(0.45);
        g.fillText(w.lo + '° – ' + w.hi + '°' + (w.rain ? '  ·  ' + w.rain + '% rain' : ''), cx, top + 32 * s);
      }
    }
    // bottom line: timer, music, or the clock
    let text = '', sub = '', sub2 = '', sub2Warn = false;
    const timer = (info.timers || []).slice().sort((a, b) => a.endsAt - b.endsAt)[0];
    let noteColor = '';
    // A card or captions use the space under the face: the bottom line waits.
    if (state !== 'setup' && cmp < 0.3 && captionEl.hidden) {
      if (info.activity) {
        // Busy in the background: say what with, with a little "..." that keeps moving.
        const dots = '.'.repeat(1 + (Math.floor(now / 400) % 3));
        text = info.activity.icon + '  ' + info.activity.label + dots;
      } else if (info.notice) {
        const i = info.notice.indexOf(': ');
        text = i > 0 ? info.notice.slice(0, i) : info.notice;
        sub = i > 0 ? info.notice.slice(i + 2) : '';
        noteColor = '#ffb36b';
      } else if (timer) {
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
        if (state === 'offline') sub = info.updating ? 'Updating… back in a few minutes' : 'Reconnecting…';
        else if (info.updating) sub = 'Updating…';
        else if (state === 'idle' || state === 'sleeping') {
          // Under the clock: the next reminder, the next meeting and the to-dos that matter (two lines at most).
          const lines = [];
          if (info.reminder) {
            // Reminders aren't countdowns: just the next one, with a bell.
            const at = new Date(info.reminder.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
            lines.push(['🔔 ' + at + ' · ' + info.reminder.text.charAt(0).toUpperCase() + info.reminder.text.slice(1), false]);
          }
          if (gl.next && state === 'idle') lines.push(['📅 ' + (gl.next.now ? 'Now' : gl.next.time) + ' · ' + gl.next.title, false]);
          const t = gl.todos;
          if (t && state === 'idle') {
            const parts = [t.critical ? t.critical + ' critical' : '', t.overdue ? t.overdue + ' overdue' : '', t.today && !t.critical && !t.overdue ? t.today + ' due today' : ''].filter(Boolean);
            if (parts.length) lines.push(['✓ ' + parts.join(' · '), Boolean(t.critical || t.overdue)]);
          }
          if (lines[0]) sub = lines[0][0];
          if (lines[1]) { sub2 = lines[1][0]; sub2Warn = lines[1][1]; }
          if (lines[0] && lines[0][1] && !lines[1]) { sub = ''; sub2 = lines[0][0]; sub2Warn = true; }
        }
      }
    }
    if (text) {
      const small = Boolean(info.activity || noteColor);
      g.fillStyle = noteColor || rgb(state === 'sleeping' ? 0.35 : 0.8);
      g.font = '600 ' + Math.round((small ? 28 : 36) * s) + 'px system-ui, sans-serif';
      if (info.activity) g.textAlign = 'left';
      const tx = info.activity ? cx - g.measureText(fit(info.activity.icon + '  ' + info.activity.label + '...', 380 * s)).width / 2 : cx;
      g.fillText(fit(text, 380 * s), tx, cy + 238 * s);
      g.textAlign = 'center';
      if (sub) { g.font = '500 ' + Math.round(22 * s) + 'px system-ui, sans-serif'; g.fillStyle = rgb(0.5); g.fillText(fit(sub, 300 * s), cx, cy + 274 * s); }
      if (sub2) { g.font = '600 ' + Math.round(20 * s) + 'px system-ui, sans-serif'; g.fillStyle = sub2Warn ? '#ffb36b' : rgb(0.5); g.fillText(fit(sub2, 250 * s), cx, cy + (sub ? 304 : 274) * s); }
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
      g.fillText('Keep holding for options', cx, cy + 200 * s);
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
