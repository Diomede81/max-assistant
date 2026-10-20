/**
 * The control panel's Devices tab: Home Assistant on the Max box, made simple. Your devices by room with
 * their everyday controls, which ones Max may control, and adding new ones (found on your network, or by
 * brand) through Home Assistant's own setup steps shown as plain forms. Everything else is one link away
 * in the full Home Assistant ("Advanced"). Drawn in the browser from /api/home (HomeService).
 */
export function devicesPane(): string {
  return `<section id="devices"><h2>Devices</h2>
<p class="meta" id="hStatus">Loading…</p>
<p id="hMsg" role="status" hidden></p>
<div id="hUpdate" class="hnote" hidden></div>
<form id="hLogin" class="stack" hidden><p class="meta">Sign in with your Home Assistant account once, so Max can manage it.</p>
<input name="username" placeholder="Home Assistant username" autocomplete="username" required>
<input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
<p id="hLoginMsg" class="meta" role="alert"></p>
<button class="btn" type="submit">Sign in</button></form>
<div id="hRooms" class="hrooms" role="tablist" aria-label="Rooms"></div>
<div id="hFilter" class="hfilter" hidden><input id="hFind" type="search" placeholder="Find a device" autocomplete="off" aria-label="Find a device">
<label><input type="checkbox" id="hOnlyCtl"> Only things I can control</label><label><input type="checkbox" id="hShowHidden"> Show hidden</label></div>
<div id="hDevices" class="hgrid"></div>
<div id="hParts"></div>
</section>
<section id="devices-add"><h2>Add devices and services</h2>
<div id="hFound"></div>
<p class="meta">Most WiFi devices appear above by themselves once they're on your WiFi. Or search for the brand or service (Tado, Shelly, Philips Hue, Sonos…) and answer a few questions:</p>
<input id="hSearch" class="hsearch" type="search" placeholder="Search brands and services, e.g. Tado, Shelly, Philips Hue" autocomplete="off">
<ul id="hResults"></ul>
<div id="hServices"></div>
</section>
<section id="devices-advanced"><h2>Advanced</h2>
<p class="meta">For anything this page doesn't do (automations, energy, history), open the full Home Assistant running on your Max box.</p>
<div id="hAdvanced"></div>
</section>
<div class="hmodal" id="hFlow" hidden><div class="hdialog" role="dialog" aria-modal="true" aria-labelledby="hFlowTitle"><h3 id="hFlowTitle"></h3><div id="hFlowBody"></div></div></div>
<script>${SCRIPT}</script>`;
}

export const DEVICES_CSS = `#hMsg{background:var(--errbg);color:var(--err);padding:8px 10px;border-radius:8px}.hnote{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}.hnote code{font-size:13px;word-break:break-all}

.hrooms{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 14px}.hrooms button{font:inherit;font-weight:600;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
.hrooms button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.hgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.hcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.hcard.dead{opacity:.6}.hcard .hn{font-weight:700;overflow-wrap:anywhere}.hcard .hr{font-size:12px;color:var(--muted)}
.hcard .hbig{font-size:22px;font-weight:700}.hcard .hctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hcard .hctl button{font:inherit;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--text);cursor:pointer}
.hcard .hctl button.on{background:var(--accent);border-color:var(--accent);color:#fff}.hcard .hctl button:disabled{opacity:.5;cursor:default}
.hfilter{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin:0 0 10px}.hfilter input[type=search]{flex:1 1 180px;min-width:0;font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}.hfilter label{display:flex;gap:6px;align-items:center;font-size:14px}
.hparts summary{cursor:pointer;font-weight:600;margin:12px 0 6px}.hcard .hmore button{padding:2px 10px;font-size:13px}.hcard .hhid{opacity:.55}.hedit-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;margin:4px 0}
.hhead{display:flex;justify-content:space-between;gap:6px;align-items:flex-start}.htools{display:flex;gap:2px;flex:none}.hcard .htools button{border:0;background:none;color:var(--muted);font-size:19px;line-height:1;padding:4px 6px;border-radius:6px;cursor:pointer}.hcard .htools button[aria-pressed=true]{color:#f5a524}.hdrag{cursor:grab;touch-action:none}.hcard.hdragging{opacity:.55;outline:2px dashed var(--accent)}
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
    return esc(t).replace(/\x60{3}([^\x60]+)\x60{3}/g, '<code>$1</code>').replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // bare web addresses (e.g. Tado's sign-in page) become links too
      .replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>').replace(/\n/g, '<br>');
  };
  // Your filters on this page, remembered on this device.
  var pref = { find: '', onlyCtl: false, showHidden: false, room: null };
  try { pref = Object.assign(pref, JSON.parse(localStorage.getItem('max-devices-filter') || '{}')); } catch (e) { /* private window */ }
  function savePref() { try { localStorage.setItem('max-devices-filter', JSON.stringify(pref)); } catch (e) { /* private window */ } }
  var data = null, room = null, editing = '', busy = false, drag = null, advDrawn = '', updDrawn = '';
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
    var st = { off: 'Home Assistant on the box is off.', starting: d.message || 'Home Assistant is starting… (a minute or two after the box starts)', 'needs-login': d.message, ready: d.message || d.devices.length + ' device' + (d.devices.length === 1 ? '' : 's') + (used ? ' in ' + used + ' room' + (used === 1 ? '' : 's') : '') };
    $('hStatus').textContent = st[d.state] || '';
    $('hLogin').hidden = d.state !== 'needs-login';
    // Home Assistant updates: offered here, installed only when you press Update now
    var u = d.update, uh = '', updating = Boolean(u && u.progress && u.progress.state === 'updating');
    if (updating) uh = '<p><b>Updating Home Assistant:</b> ' + esc(u.progress.message) + '…</p>';
    else if (u && u.progress) uh = '<p>' + (u.progress.state === 'failed' ? '<b>Update didn\'t finish:</b> ' : '') + esc(u.progress.message) + '</p>';
    if (u && u.latest && !updating) {
      uh += '<p><b>Home Assistant ' + esc(u.latest) + ' is available</b>' + (u.installed ? ' (you have ' + esc(u.installed) + ')' : '') +
        '. <a href="https://github.com/home-assistant/core/releases" target="_blank" rel="noopener">What\'s new</a></p>' +
        (u.canInstall ? '<p><button class="btn" type="button" data-ha-update>Update now</button> <span class="meta">Your devices are unavailable for a few minutes while it restarts.</span></p>'
          : '<p class="meta">To update, run in the project folder: <code>docker compose pull homeassistant &amp;&amp; docker compose up -d homeassistant</code></p>');
    }
    uh += '<p class="meta" id="hUpdateMsg" role="status"></p>';
    if (uh !== updDrawn) { $('hUpdate').innerHTML = uh; updDrawn = uh; }
    $('hUpdate').hidden = !(u && (u.latest || u.progress));
    var ready = d.state === 'ready';
    $('devices-add').hidden = !ready;
    // rooms
    var rooms = d.areas.filter(function (a) { return d.devices.some(function (x) { return x.areaId === a.id; }); });
    var none = d.devices.some(function (x) { return !x.areaId; });
    var favs = d.favourites || [];
    // My dashboard opens first once it has something on it (or wherever you were last time).
    if (room === null) room = pref.room !== null && pref.room !== undefined ? pref.room : favs.length ? '*' : '';
    var chips = [['*', '★ My dashboard'], ['', 'All']].concat(rooms.map(function (a) { return [a.id, a.name]; }));
    if (none && rooms.length) chips.push(['-', 'No room']);
    $('hRooms').innerHTML = ready && d.devices.length ? chips.map(function (c) { return '<button type="button" data-room="' + esc(c[0]) + '" class="' + (room === c[0] ? 'on' : '') + '">' + esc(c[1]) + '</button>'; }).join('') : '';
    $('hFilter').hidden = !ready || !d.devices.length;
    var q = pref.find.trim().toLowerCase();
    // Starred devices first everywhere, in your order; My dashboard shows only them.
    var pos = function (id) { var i = favs.indexOf(id); return i < 0 ? 1e6 : i; };
    var shown = d.devices
      .filter(function (x) { return !room || (room === '*' ? favs.indexOf(x.id) >= 0 : room === '-' ? !x.areaId : x.areaId === room); })
      .map(function (x, i) { return [x, i]; }).sort(function (a, b) { return pos(a[0].id) - pos(b[0].id) || a[1] - b[1]; }).map(function (p) { return p[0]; })
      .filter(function (x) { return !q || (x.name + ' ' + (x.area || '')).toLowerCase().indexOf(q) >= 0; })
      .map(function (x) {
        var ents = x.entities.filter(function (e) { return (pref.showHidden || !e.hidden) && (!pref.onlyCtl || e.control !== 'none'); });
        return Object.assign({}, x, { entities: ents });
      })
      .filter(function (x) { return x.entities.length || editing === x.id; });
    var empty = room === '*' && !q ? 'Your dashboard is empty: tap ☆ on any device (under All, or a room) to put it here, then drag ⠿ to put the most useful first.'
      : d.devices.length ? 'Nothing matches: change the filters above.' : 'No devices yet: add one below.';
    $('hDevices').innerHTML = ready ? (shown.length ? shown.map(card).join('') : '<p class="meta">' + empty + '</p>') : '';
    // hardware that only reports its battery and connection (e.g. radiator valves: you control the room)
    var parts = ready ? (d.parts || []) : [], bad = parts.filter(function (x) { return !x.ok; }).length;
    $('hParts').innerHTML = parts.length ? '<details class="hparts"' + (bad ? ' open' : '') + '><summary>Batteries and connections: ' + (bad ? bad + ' need' + (bad === 1 ? 's' : '') + ' attention' : 'all fine') + ' (' + parts.length + ')</summary>' +
      '<p class="meta">Hardware such as radiator valves and bridges: you control the room or device it belongs to above.</p><ul>' +
      parts.map(function (x) { return '<li class="row"><div><div class="name">' + esc(x.name) + (x.ok ? '' : ' <span class="badge off">Check it</span>') + '</div><div class="meta">' + esc((x.area ? x.area + ' · ' : '') + x.states) + '</div></div></li>'; }).join('') + '</ul></details>' : '';
    // what's connected (Tado, Shelly...): whether it works, and a way to remove it
    var sv = ready ? (d.services || []) : [];
    $('hServices').innerHTML = sv.length ? '<h3 style="margin:16px 0 6px;font-size:15px">Connected</h3><ul>' + sv.map(function (x) {
      var nm = x.name === x.domain ? (x.title || x.name) : x.name;
      return '<li class="row"><div><div class="name">' + esc(nm) + (x.title && x.title !== nm ? ' <span class="meta">' + esc(x.title) + '</span>' : '') + ' <span class="badge' + (x.ok ? '' : ' off') + '">' + esc(x.status) + '</span></div>' +
        (x.removable ? '' : '<div class="meta">How Max talks to Home Assistant</div>') + '</div>' +
        (x.removable ? '<button class="btn secondary" type="button" data-remove-entry="' + esc(x.id) + '" data-label="' + esc(x.title || x.name) + '">Remove</button>' : '') + '</li>';
    }).join('') + '</ul>' : '';
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
    // The server puts the main control first (the heating before a room's child lock).
    var main = x.entities[0];
    var rest = x.entities.slice(1, 6);
    var dead = main && main.unavailable;
    var star = (data.favourites || []).indexOf(x.id) >= 0;
    var h = '<div class="hcard' + (dead ? ' dead' : '') + '" data-dev="' + esc(x.id) + '"><div class="hhead"><div><div class="hn">' + esc(x.name) + '</div><div class="hr">' + esc(x.area || 'No room') + (dead ? ' · Not responding' : '') + '</div></div>' +
      '<div class="htools">' + (room === '*' ? '<button type="button" class="hdrag" data-drag="' + esc(x.id) + '" aria-label="Move ' + esc(x.name) + ' (drag, or use the arrow keys)" title="Drag to move">⠿</button>' : '') +
      '<button type="button" data-fav="' + esc(x.id) + '" aria-pressed="' + star + '" aria-label="' + (star ? 'Take off My dashboard' : 'Put on My dashboard') + '" title="' + (star ? 'On My dashboard' : 'Put on My dashboard') + '">' + (star ? '★' : '☆') + '</button></div></div>';
    if (editing === x.id) {
      var all = (data.devices.filter(function (d) { return d.id === x.id; })[0] || x).entities;
      h += '<form data-edit="' + esc(x.id) + '"><input name="name" value="' + esc(x.name) + '" aria-label="Name"><input name="room" value="' + esc(x.area || '') + '" list="hRoomList" placeholder="Room, e.g. Kitchen" aria-label="Room">' +
        '<datalist id="hRoomList">' + data.areas.map(function (a) { return '<option value="' + esc(a.name) + '">'; }).join('') + '</datalist>' +
        '<div class="hctl"><button type="submit" class="on">Save</button><button type="button" data-cancel-edit>Cancel</button></div></form>' +
        (all.length ? '<p class="meta" style="margin:8px 0 2px">What this card shows (hidden items are hidden in Home Assistant too; hide them all to hide the device):</p>' + all.map(function (e) {
          return '<div class="hedit-row' + (e.hidden ? ' hhid' : '') + '"><span>' + esc(e.name) + '</span><button type="button" data-hide="' + esc(e.id) + '" data-on="' + (e.hidden ? '0' : '1') + '">' + (e.hidden ? 'Show' : 'Hide') + '</button></div>';
        }).join('') : '') + '</div>';
      return h;
    }
    if (main) h += control(main, dead);
    if (rest.length) h += '<div class="hmore">' + rest.map(function (e) {
      // a second switch (e.g. a radiator's child lock) gets its own small button
      var v = e.control === 'toggle' ? '<button type="button" data-act="toggle" data-id="' + esc(e.id) + '"' + (e.on ? ' class="on"' : '') + (e.unavailable ? ' disabled' : '') + '>' + (e.on ? 'On' : 'Off') + '</button>' : '<b>' + esc(e.state) + '</b>';
      return '<div' + (e.hidden ? ' class="hhid"' : '') + '><span>' + esc(e.name) + '</span>' + v + '</div>';
    }).join('') + '</div>';
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
      case 'climate':
        return big(e.state) +
          (e.modes && e.modes.length > 1 ? '<div class="hctl">' + e.modes.map(function (m) { return b('mode', esc(MODE[m] || m.replace(/_/g, ' ')), m === e.mode, ' data-mode="' + esc(m) + '"'); }).join('') + '</div>' : '') +
          (e.target != null ? '<div class="hctl">' + b('temp-', '−') + '<b>' + esc(e.target) + '°</b>' + b('temp+', '+') + '</div>' : '');
      default: return big(e.state);
    }
  }

  var MODE = { off: 'Off', heat: 'Heat', auto: 'Auto', cool: 'Cool', heat_cool: 'Heat & cool', dry: 'Dry', fan_only: 'Fan', eco: 'Eco', electric: 'Electric', gas: 'Gas', heat_pump: 'Heat pump', performance: 'Boost', high_demand: 'Boost' };
  var msgTimer = 0;
  // What Home Assistant said when a tap didn't work (e.g. the device's own service refused it).
  function say(text) {
    var m = $('hMsg'); m.textContent = text; m.hidden = !text;
    clearTimeout(msgTimer); if (text) msgTimer = setTimeout(function () { m.hidden = true; }, 8000);
  }
  function act(id, action, value) {
    if (action === 'temp-' || action === 'temp+') {
      var ent = null;
      data.devices.forEach(function (x) { x.entities.forEach(function (e) { if (e.id === id) ent = e; }); });
      if (!ent || ent.target == null) return;
      var step = ent.step || 0.5;
      value = Math.round((ent.target + (action === 'temp+' ? step : -step)) * 10) / 10;
      action = 'temperature';
    }
    var body = { entity: id, action: action };
    if (value != null) body.value = String(value);
    return post('/home/act', body).then(function (r) {
      say(r && r.message && r.message !== 'Done' ? "That didn't work: " + r.message : '');
      setTimeout(load, 700);
    }, function () { say("That didn't work: Max couldn't reach Home Assistant."); });
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
      if (s.url) h += '<div class="hacts"><a class="btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the sign-in page</a></div>';
      h += '<p class="meta">Working on it…' + (s.url ? ' This continues by itself once you\'ve signed in.' : '') + '</p>';
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
    if (t.dataset.room !== undefined) { room = t.dataset.room; pref.room = room; savePref(); render(); return; }
    if (t.dataset.fav) {
      var f = (data.favourites || []).slice(), i = f.indexOf(t.dataset.fav);
      if (i >= 0) f.splice(i, 1); else f.push(t.dataset.fav);
      data.favourites = f; saveLayout(); render(); return;
    }
    if (t.dataset.drag) return;
    if (t.dataset.act) { if (t.dataset.confirm && !confirm(t.dataset.confirm)) return; act(t.dataset.id, t.dataset.act, t.dataset.mode); return; }
    if (t.dataset.editOpen) { editing = t.dataset.editOpen; render(); return; }
    if (t.hasAttribute('data-cancel-edit')) { editing = ''; render(); return; }
    if (t.dataset.found) { busy = true; fetch('/api/home/flow?id=' + encodeURIComponent(t.dataset.found)).then(function (r) { return r.json(); }).then(showStep).finally(function () { busy = false; }); return; }
    if (t.dataset.ignore) { post('/home/ignore', { flow: t.dataset.ignore }).then(load); return; }
    if (t.dataset.hide) { post('/home/hide', { entity: t.dataset.hide, hide: t.dataset.on }).then(function (r) { say(r.message === 'Hidden.' || r.message === 'Shown again.' ? '' : "That didn't work: " + r.message); load(); }); return; }
    if (t.dataset.removeEntry) {
      if (!confirm('Remove ' + t.dataset.label + ' and its devices from Home Assistant? You can add it again later.')) return;
      t.disabled = true;
      post('/home/service/remove', { entry: t.dataset.removeEntry }).then(function (r) { say(/^Removed/.test(r.message) ? '' : "That didn't work: " + r.message); load(); });
      return;
    }
    if (t.dataset.domain) { start(t.dataset.domain); return; }
    if (t.id === 'hCopyPw' && data && data.login) { copy(data.login.password); return; }
    if (t.hasAttribute('data-ha-update')) { if (!confirm('Update Home Assistant now? It restarts, so your devices are unavailable for a few minutes.')) return; t.disabled = true; post('/home/update', {}).then(function (r) { updDrawn = ''; load().then(function () { var m = $('hUpdateMsg'); if (m) m.textContent = r.message; }); }); return; }
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
    var f = ev.target;
    // The Automations section's forms are ordinary ones (they post and reload): only the device forms are handled here.
    if (f.closest('#automations')) return;
    ev.preventDefault();
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
  // ---------- My dashboard: star cards, drag them into your order (mouse, finger or arrow keys) ----------
  function saveLayout() { post('/home/layout', { favourites: JSON.stringify(data.favourites || []) }); }
  function orderFromPage() {
    var onPage = [].slice.call($('hDevices').querySelectorAll('.hcard')).map(function (c) { return c.dataset.dev; });
    // starred devices not on the page right now (filtered out, hidden) keep their place at the end
    data.favourites = onPage.concat((data.favourites || []).filter(function (id) { return onPage.indexOf(id) < 0; }));
    saveLayout();
  }
  var grid = $('hDevices');
  grid.addEventListener('pointerdown', function (ev) {
    var hd = ev.target.closest('[data-drag]'); if (!hd) return;
    ev.preventDefault();
    drag = hd.closest('.hcard'); busy = true; drag.classList.add('hdragging');
    try { hd.setPointerCapture(ev.pointerId); } catch (e) { /* older browsers */ }
  });
  grid.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var over = document.elementFromPoint(ev.clientX, ev.clientY); over = over && over.closest('.hcard');
    if (!over || over === drag || over.parentNode !== grid) return;
    var cards = [].slice.call(grid.children);
    grid.insertBefore(drag, cards.indexOf(drag) < cards.indexOf(over) ? over.nextSibling : over);
  });
  var drop = function () { if (!drag) return; drag.classList.remove('hdragging'); drag = null; busy = false; orderFromPage(); };
  grid.addEventListener('pointerup', drop);
  grid.addEventListener('pointercancel', drop);
  grid.addEventListener('keydown', function (ev) {
    var hd = ev.target.closest('[data-drag]'); if (!hd) return;
    var back = ev.key === 'ArrowUp' || ev.key === 'ArrowLeft', fwd = ev.key === 'ArrowDown' || ev.key === 'ArrowRight';
    if (!back && !fwd) return;
    ev.preventDefault();
    var c = hd.closest('.hcard'), sib = back ? c.previousElementSibling : c.nextElementSibling;
    if (!sib) return;
    grid.insertBefore(c, back ? sib : sib.nextSibling);
    orderFromPage(); hd.focus();
  });

  $('hFind').value = pref.find; $('hOnlyCtl').checked = pref.onlyCtl; $('hShowHidden').checked = pref.showHidden;
  $('hFind').addEventListener('input', function () { pref.find = this.value; savePref(); if (data) render(); });
  $('hOnlyCtl').addEventListener('change', function () { pref.onlyCtl = this.checked; savePref(); if (data) render(); });
  $('hShowHidden').addEventListener('change', function () { pref.showHidden = this.checked; savePref(); if (data) render(); });
  load();
  setInterval(function () {
    if (!pane.classList.contains('on') || document.hidden || editing || flow || busy) return;
    var a = document.activeElement; if (a && pane.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
    load();
  }, 5000);
})();
`;
