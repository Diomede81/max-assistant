/**
 * The control panel's Devices tab: Home Assistant on the Max box, made simple. Your devices by room with
 * their everyday controls, which ones Max may control, and adding new ones (found on your network, or by
 * brand) through Home Assistant's own setup steps shown as plain forms. Everything else is one link away
 * in the full Home Assistant ("Advanced"). Drawn in the browser from /api/home (HomeService).
 */
export function devicesPane(): string {
  return `<section id="devices"><h2>Devices</h2>
<p class="meta" id="hStatus">Loading…</p>
<form id="hLogin" class="stack" hidden><p class="meta">Sign in with your Home Assistant account once, so Max can manage it.</p>
<input name="username" placeholder="Home Assistant username" autocomplete="username" required>
<input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
<p id="hLoginMsg" class="meta" role="alert"></p>
<button class="btn" type="submit">Sign in</button></form>
<div id="hRooms" class="hrooms" role="tablist" aria-label="Rooms"></div>
<div id="hDevices" class="hgrid"></div>
</section>
<section id="devices-add"><h2>Add a device</h2>
<div id="hFound"></div>
<p class="meta">Most WiFi devices appear above by themselves once they're on your WiFi. Or search for the brand:</p>
<input id="hSearch" class="hsearch" type="search" placeholder="Search brands, e.g. Shelly, TP-Link, Philips Hue" autocomplete="off">
<ul id="hResults"></ul>
</section>
<section id="devices-advanced"><h2>Advanced</h2>
<p class="meta">For anything this page doesn't do (automations, energy, history), open the full Home Assistant running on your Max box.</p>
<div id="hAdvanced"></div>
</section>
<div class="hmodal" id="hFlow" hidden><div class="hdialog" role="dialog" aria-modal="true" aria-labelledby="hFlowTitle"><h3 id="hFlowTitle"></h3><div id="hFlowBody"></div></div></div>
<script>${SCRIPT}</script>`;
}

export const DEVICES_CSS = `
.hrooms{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 14px}.hrooms button{font:inherit;font-weight:600;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
.hrooms button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.hgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.hcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.hcard.dead{opacity:.6}.hcard .hn{font-weight:700;overflow-wrap:anywhere}.hcard .hr{font-size:12px;color:var(--muted)}
.hcard .hbig{font-size:22px;font-weight:700}.hcard .hctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hcard .hctl button{font:inherit;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--text);cursor:pointer}
.hcard .hctl button.on{background:var(--accent);border-color:var(--accent);color:#fff}.hcard .hctl button:disabled{opacity:.5;cursor:default}
.hcard input[type=range]{width:100%}.hcard .hmore{font-size:13px;color:var(--muted)}.hcard .hmore div{display:flex;justify-content:space-between;gap:8px}
.hcard .hfoot{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--line);padding-top:8px;font-size:13px}
.hcard .hfoot label{display:flex;gap:6px;align-items:center;cursor:pointer}.hcard .hfoot button{font:inherit;font-size:13px;border:0;background:none;color:var(--accent);cursor:pointer;padding:4px}
.hcard form{display:grid;gap:6px}.hcard form input{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
.hsearch{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);margin:4px 0 8px}
.hmodal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:30;display:grid;place-items:center;padding:16px}.hmodal[hidden]{display:none}
.hdialog{background:var(--card);border-radius:16px;padding:20px;width:min(460px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.25)}
.hdialog h3{margin:0 0 8px}.hdialog .htext{color:var(--muted);margin:0 0 12px;overflow-wrap:anywhere}.hdialog form{display:grid;gap:12px}
.hdialog label{display:grid;gap:4px;font-weight:600}.hdialog label small{font-weight:400;color:var(--muted)}
.hdialog input:not([type=checkbox]),.hdialog select{font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
.hdialog label.hcheck{display:flex;gap:8px;align-items:center}.hdialog .herr{background:var(--errbg);color:var(--err);padding:8px 10px;border-radius:8px}
.hdialog .hacts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px}.hdialog .hmenu{display:grid;gap:8px}
.hpw{font-family:ui-monospace,monospace}
@media (max-width:440px){.nav{gap:2px}.nav a,.nav .menu{padding:7px 10px;font-size:14px}.nav .menu{position:sticky;right:0;box-shadow:-10px 0 8px var(--bg)}}`;

// The page's own code (runs in the browser). Kept as plain JavaScript so it needs no build step.
const SCRIPT = String.raw`
(function () {
  var pane = document.getElementById('tab-devices');
  if (!pane) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // Home Assistant's help texts use a little Markdown: **bold**, [links](url) and line breaks.
  var md = function (t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  };
  var data = null, room = '', editing = '', busy = false, advDrawn = '';
  var post = function (path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
      .then(function (r) { return r.json(); });
  };

  // The browser's clipboard only works on https or localhost; on http://max.local fall back to the older way.
  function copy(text) {
    var done = function () { $('hPwMsg').textContent = 'Password copied.'; };
    var fail = function () { $('hPwMsg').textContent = "Couldn't copy: press Show instead."; };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, fail); return; }
    var box = document.createElement('textarea');
    box.value = text; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0';
    document.body.appendChild(box); box.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    box.remove();
    if (ok) done(); else fail();
  }

  function load() {
    return fetch('/api/home').then(function (r) { return r.json(); }).then(function (d) { data = d; render(); }).catch(function () { $('hStatus').textContent = "Couldn't reach Max."; });
  }

  function render() {
    var d = data;
    var used = d.areas.filter(function (a) { return d.devices.some(function (x) { return x.areaId === a.id; }); }).length;
    var st = { off: 'Home Assistant on the box is off.', starting: d.message || 'Home Assistant is starting… (a minute or two after the box starts)', 'needs-login': d.message, ready: d.devices.length + ' device' + (d.devices.length === 1 ? '' : 's') + (used ? ' in ' + used + ' room' + (used === 1 ? '' : 's') : '') };
    $('hStatus').textContent = st[d.state] || '';
    $('hLogin').hidden = d.state !== 'needs-login';
    var ready = d.state === 'ready';
    $('devices-add').hidden = !ready;
    // rooms
    var rooms = d.areas.filter(function (a) { return d.devices.some(function (x) { return x.areaId === a.id; }); });
    var none = d.devices.some(function (x) { return !x.areaId; });
    var chips = [['', 'All']].concat(rooms.map(function (a) { return [a.id, a.name]; }));
    if (none && rooms.length) chips.push(['-', 'No room']);
    $('hRooms').innerHTML = ready && rooms.length ? chips.map(function (c) { return '<button type="button" data-room="' + esc(c[0]) + '" class="' + (room === c[0] ? 'on' : '') + '">' + esc(c[1]) + '</button>'; }).join('') : '';
    var shown = d.devices.filter(function (x) { return !room || (room === '-' ? !x.areaId : x.areaId === room); });
    $('hDevices').innerHTML = ready ? (shown.length ? shown.map(card).join('') : '<p class="meta">No devices yet: add one below.</p>') : '';
    // found on the network
    $('hFound').innerHTML = d.found.length ? '<h3 style="margin:0 0 6px;font-size:15px">Found on your network</h3><ul>' + d.found.map(function (f) {
      return '<li class="row"><div><div class="name">' + esc(f.name) + (f.attention ? ' <span class="badge off">Sign in again</span>' : '') + '</div><div class="meta">' + esc(f.integration) + '</div></div>' +
        '<div style="display:flex;gap:6px"><button class="btn" type="button" data-found="' + esc(f.flowId) + '">' + (f.attention ? 'Fix' : 'Add') + '</button>' +
        (f.attention ? '' : '<button class="btn secondary" type="button" data-ignore="' + esc(f.flowId) + '">Not mine</button>') + '</div></li>';
    }).join('') + '</ul>' : '';
    // advanced
    var adv = '<p><a class="btn secondary" href="' + esc(d.url) + '" target="_blank" rel="noopener">Open the full Home Assistant</a></p>' +
      (d.login ? '<p class="meta">Its account (Max made it for you): username <b>' + esc(d.login.username) + '</b>, password <span class="hpw" id="hPw">••••••••</span> ' +
        '<button type="button" class="btn secondary" id="hShowPw">Show</button> <button type="button" class="btn secondary" id="hCopyPw">Copy</button> ' +
        '<button type="button" class="btn secondary" id="hNewPw">New password</button></p><p class="meta" id="hPwMsg" role="status"></p>' : '');
    // Only redraw when it changed, so a shown password and its messages stay put between refreshes.
    if (adv !== advDrawn) { $('hAdvanced').innerHTML = adv; advDrawn = adv; }
  }

  function card(x) {
    var main = x.entities.filter(function (e) { return e.control !== 'none'; })[0] || x.entities[0];
    var rest = x.entities.filter(function (e) { return e !== main; }).slice(0, 4);
    var dead = main && main.unavailable;
    var h = '<div class="hcard' + (dead ? ' dead' : '') + '" data-dev="' + esc(x.id) + '"><div><div class="hn">' + esc(x.name) + '</div><div class="hr">' + esc(x.area || 'No room') + (dead ? ' · Not responding' : '') + '</div></div>';
    if (editing === x.id) {
      h += '<form data-edit="' + esc(x.id) + '"><input name="name" value="' + esc(x.name) + '" aria-label="Name"><input name="room" value="' + esc(x.area || '') + '" list="hRoomList" placeholder="Room, e.g. Kitchen" aria-label="Room">' +
        '<datalist id="hRoomList">' + data.areas.map(function (a) { return '<option value="' + esc(a.name) + '">'; }).join('') + '</datalist>' +
        '<div class="hctl"><button type="submit" class="on">Save</button><button type="button" data-cancel-edit>Cancel</button></div></form></div>';
      return h;
    }
    if (main) h += control(main, dead);
    if (rest.length) h += '<div class="hmore">' + rest.map(function (e) { return '<div><span>' + esc(e.name) + '</span><b>' + esc(e.state) + '</b></div>'; }).join('') + '</div>';
    h += '<div class="hfoot"><label title="Max can control it, or tell you what it shows, when you ask him"><input type="checkbox" data-max="' + esc(x.id) + '"' + (x.max ? ' checked' : '') + '> Max can use</label><button type="button" data-edit-open="' + esc(x.id) + '">Edit</button></div></div>';
    return h;
  }

  function control(e, dead) {
    var b = function (action, label, on, extra) { return '<button type="button" data-act="' + esc(action) + '" data-id="' + esc(e.id) + '"' + (on ? ' class="on"' : '') + (dead ? ' disabled' : '') + (extra || '') + '>' + label + '</button>'; };
    var big = function (t) { return '<div class="hbig">' + esc(t) + '</div>'; };
    switch (e.control) {
      case 'toggle':
        return '<div class="hctl">' + b('toggle', e.on ? 'On' : 'Off', e.on) + '</div>' +
          (e.domain === 'light' && e.on && e.brightness != null ? '<input type="range" min="1" max="100" value="' + e.brightness + '" data-bright="' + esc(e.id) + '" aria-label="Brightness">' : '');
      case 'cover': return big(e.state) + '<div class="hctl">' + b('open', 'Open') + b('stop', 'Stop') + b('close', 'Close') + '</div>';
      case 'lock': return big(e.state) + '<div class="hctl">' + b('lock', 'Lock') + b('unlock', 'Unlock', false, ' data-confirm="Unlock it?"') + '</div>';
      case 'press': return '<div class="hctl">' + b(e.domain === 'scene' ? 'scene' : 'press', e.domain === 'scene' ? 'Activate' : 'Press') + '</div>';
      case 'media': return big(e.state) + '<div class="hctl">' + b('play', e.on ? 'Pause' : 'Play', e.on) + '</div>';
      case 'vacuum': return big(e.state) + '<div class="hctl">' + b('start', 'Start') + b('dock', 'Go home') + '</div>';
      case 'climate': return big(e.state) + '<div class="hctl">' + b('temp-', '−') + '<b>' + (e.target != null ? esc(e.target) + '°' : '–') + '</b>' + b('temp+', '+') + '</div>';
      default: return big(e.state);
    }
  }

  function act(id, action, value) {
    if (action === 'temp-' || action === 'temp+') {
      var ent = null;
      data.devices.forEach(function (x) { x.entities.forEach(function (e) { if (e.id === id) ent = e; }); });
      if (!ent || ent.target == null) return;
      value = ent.target + (action === 'temp+' ? 0.5 : -0.5);
      action = 'temperature';
    }
    var body = { entity: id, action: action };
    if (value != null) body.value = String(value);
    return post('/home/act', body).then(function () { setTimeout(load, 700); });
  }

  // ---------- adding a device: Home Assistant's own steps, as a plain form ----------
  var flow = null, waitTimer = 0, typed = {};
  function showStep(s) {
    // The same question again (e.g. "Failed to connect"): keep what you typed.
    if (!(s.kind === 'form' && s.error && flow && flow.flowId === s.flowId)) typed = {};
    flow = s; clearTimeout(waitTimer);
    $('hFlow').hidden = false;
    $('hFlowTitle').textContent = s.title;
    var h = s.text ? '<p class="htext">' + md(s.text) + '</p>' : '';
    if (s.error) h += '<p class="herr" role="alert">' + esc(s.error) + '</p>';
    if (s.kind === 'form') {
      h += '<form id="hStepForm">' + (s.fields || []).map(field).join('') + '<div class="hacts"><button type="button" class="btn secondary" data-flow-cancel>Cancel</button><button class="btn" type="submit">' + ((s.fields || []).length ? 'Next' : 'Add') + '</button></div></form>';
    } else if (s.kind === 'menu') {
      h += '<div class="hmenu">' + s.menu.map(function (m) { return '<button type="button" class="btn secondary" data-menu="' + esc(m.id) + '">' + esc(m.label) + '</button>'; }).join('') + '</div><div class="hacts"><button type="button" class="btn secondary" data-flow-cancel>Cancel</button></div>';
    } else if (s.kind === 'link') {
      h += '<div class="hacts"><button type="button" class="btn secondary" data-flow-cancel>Cancel</button><a class="btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the sign-in page</a><button type="button" class="btn secondary" data-flow-check>I\'ve signed in</button></div>';
    } else if (s.kind === 'wait') {
      h += '<p class="meta">Working on it…</p>';
      waitTimer = setTimeout(function () { fetch('/api/home/flow?id=' + encodeURIComponent(s.flowId)).then(function (r) { return r.json(); }).then(showStep); }, 2000);
    } else {
      h += '<div class="hacts"><button type="button" class="btn" data-flow-close>' + (s.kind === 'done' ? 'Done' : 'Close') + '</button></div>';
      if (s.kind === 'done') load();
    }
    $('hFlowBody').innerHTML = h;
    var first = $('hFlowBody').querySelector('input,select,button'); if (first) first.focus();
  }
  function field(f) {
    if (f.name in typed) f = Object.assign({}, f, { value: typed[f.name] });
    var id = 'hf_' + f.name, help = f.help ? '<small>' + md(f.help) + '</small>' : '', req = f.required ? ' required' : '';
    if (f.type === 'checkbox') return '<label class="hcheck"><input type="checkbox" name="' + esc(f.name) + '"' + (f.value ? ' checked' : '') + '> ' + esc(f.label) + '</label>' + help;
    if (f.type === 'select') return '<label for="' + id + '">' + esc(f.label) + help + '<select id="' + id + '" name="' + esc(f.name) + '"' + req + '>' + (f.options || []).map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(f.value) === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></label>';
    var type = f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text';
    return '<label for="' + id + '">' + esc(f.label) + help + '<input id="' + id + '" name="' + esc(f.name) + '" type="' + type + '"' + (type === 'number' ? ' step="any"' : '') + ' value="' + esc(f.value == null ? '' : f.value) + '"' + req + ' autocomplete="off"></label>';
  }
  function closeFlow(cancel) {
    clearTimeout(waitTimer);
    if (cancel && flow && flow.flowId) post('/home/flow/cancel', { flow: flow.flowId });
    flow = null; $('hFlow').hidden = true;
  }
  function start(domain) { busy = true; post('/home/flow/start', { domain: domain }).then(showStep).finally(function () { busy = false; }); }

  // ---------- events ----------
  pane.addEventListener('click', function (ev) {
    var t = ev.target.closest('button,[data-room]'); if (!t) return;
    if (t.dataset.room !== undefined) { room = t.dataset.room; render(); return; }
    if (t.dataset.act) { if (t.dataset.confirm && !confirm(t.dataset.confirm)) return; act(t.dataset.id, t.dataset.act); return; }
    if (t.dataset.editOpen) { editing = t.dataset.editOpen; render(); return; }
    if (t.hasAttribute('data-cancel-edit')) { editing = ''; render(); return; }
    if (t.dataset.found) { busy = true; fetch('/api/home/flow?id=' + encodeURIComponent(t.dataset.found)).then(function (r) { return r.json(); }).then(showStep).finally(function () { busy = false; }); return; }
    if (t.dataset.ignore) { post('/home/ignore', { flow: t.dataset.ignore }).then(load); return; }
    if (t.dataset.domain) { start(t.dataset.domain); return; }
    if (t.id === 'hCopyPw' && data && data.login) { copy(data.login.password); return; }
    if (t.id === 'hNewPw') { if (!confirm('Make a new password for this account? The old one stops working.')) return; post('/home/password', {}).then(function (r) { advDrawn = ''; load().then(function () { var m = $('hPwMsg'); if (m) m.textContent = r.message; }); }); return; }
    if (t.id === 'hShowPw' && data && data.login) { var pw = $('hPw'); var hidden = pw.textContent.indexOf('•') === 0; pw.textContent = hidden ? data.login.password : '••••••••'; t.textContent = hidden ? 'Hide' : 'Show'; return; }
    if (t.hasAttribute('data-flow-cancel')) { closeFlow(true); return; }
    if (t.hasAttribute('data-flow-close')) { closeFlow(false); return; }
    if (t.hasAttribute('data-flow-check')) { fetch('/api/home/flow?id=' + encodeURIComponent(flow.flowId)).then(function (r) { return r.json(); }).then(showStep); return; }
    if (t.dataset.menu) { post('/home/flow/next', { flow: flow.flowId, data: JSON.stringify({ next_step_id: t.dataset.menu }) }).then(showStep); return; }
  });
  pane.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset.max) post('/home/allow', { device: t.dataset.max, on: t.checked ? '1' : '0' }).then(load);
    if (t.dataset.bright) act(t.dataset.bright, 'brightness', t.value);
  });
  pane.addEventListener('submit', function (ev) {
    var f = ev.target; ev.preventDefault();
    if (f.id === 'hLogin') { $('hLoginMsg').textContent = 'Signing in…'; post('/home/login', { username: f.username.value, password: f.password.value }).then(function (r) { $('hLoginMsg').textContent = r.message; f.password.value = ''; if (/^Signed in/.test(r.message)) setTimeout(load, 3000); }); return; }
    if (f.dataset.edit) { post('/home/edit', { device: f.dataset.edit, name: f.name.value, room: f.room.value }).then(function () { editing = ''; load(); }); return; }
    if (f.id === 'hStepForm') {
      var out = {};
      (flow.fields || []).forEach(function (fl) {
        var el = f.elements[fl.name]; if (!el) return;
        if (fl.type === 'checkbox') out[fl.name] = el.checked;
        else if (fl.type === 'number') { if (el.value !== '') out[fl.name] = Number(el.value); }
        else if (el.value !== '' || fl.required) out[fl.name] = el.value;
      });
      typed = out;
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Checking…';
      post('/home/flow/next', { flow: flow.flowId, data: JSON.stringify(out) }).then(showStep).catch(function () { btn.disabled = false; btn.textContent = 'Next'; });
    }
  });
  var searchTimer = 0;
  $('hSearch').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = this.value;
    searchTimer = setTimeout(function () {
      if (!q.trim()) { $('hResults').innerHTML = ''; return; }
      fetch('/api/home/search?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (list) {
        $('hResults').innerHTML = list.length ? list.map(function (i) {
          return '<li class="row"><div><div class="name">' + esc(i.name) + (i.local ? '' : ' <span class="badge off">Uses the internet</span>') + '</div></div><button class="btn" type="button" data-domain="' + esc(i.domain) + '">Add</button></li>';
        }).join('') : '<li class="meta">Nothing found: try another spelling, or the full Home Assistant (Advanced).</li>';
      });
    }, 250);
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && flow) closeFlow(true); });

  // Live states: refresh every 5 s while this tab is open and you're not typing or editing.
  load();
  setInterval(function () {
    if (!pane.classList.contains('on') || document.hidden || editing || flow || busy) return;
    var a = document.activeElement; if (a && pane.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
    load();
  }, 5000);
})();
`;
