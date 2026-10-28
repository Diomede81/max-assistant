import type { BackupStatus } from '../backup/backup.service';
import { mb } from '../backup/backup.service';

type Esc = (s: unknown) => string;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Settings › Backup: one encrypted file with everything Max keeps, to download or copied daily into a folder. */
export function backupSection(b: BackupStatus, esc: Esc): string {
  const daysAgo = b.lastAt ? Math.floor((Date.now() - new Date(b.lastAt).getTime()) / 86_400_000) : undefined;
  const last = b.lastAt
    ? `Last backup: <b>${esc(when(b.lastAt))}</b>${b.lastSize ? ` · ${esc(mb(b.lastSize))}` : ''} · ${b.lastWhere === 'folder' ? 'into the folder' : 'downloaded'}${daysAgo !== undefined && daysAgo >= 14 ? ' <span class="badge warn">a while ago</span>' : ''}`
    : '<b>No backup yet.</b>';
  const files = b.files.slice(0, 5).map((f) => `<li class="row"><div><div class="name">${esc(f.name)}</div><div class="meta">${esc(when(f.at))} · ${esc(mb(f.size))}</div></div></li>`).join('');
  return `<section id="backup"><h2>Backup</h2>
${b.restarting ? '<p class="hint">Restoring: Max restarts in a moment and comes back with the backup\'s data. <span data-updating></span></p>' : ''}
<p class="meta">${last}${b.lastError ? ` <span class="badge warn">problem</span> ${esc(b.lastError)}` : ''}</p>
<p class="meta">A backup is one encrypted file with everything Max keeps: memory, people, journal, health, routines, scheduled tasks, WhatsApp, Home Assistant's login${b.withHome ? ' and Home Assistant\'s own settings (devices, rooms, automations)' : ''}. Only Max's encryption key opens it, and the key is never inside it, so the file is safe on a laptop, a USB stick, a cloud drive or in an email to yourself.</p>
<div class="acts" style="margin:12px 0"><a class="btn" href="/backup/download" download>Download a backup</a>
<form method="post" action="/backup/now"><button class="btn secondary" type="submit" ${b.folder ? '' : 'disabled title="The backup folder is missing"'}>Save one into the folder now</button></form></div>
<form class="addfact" method="post" action="/backup/auto"><label class="meta"><input type="checkbox" name="auto" value="yes" ${b.auto ? 'checked' : ''}> Save a backup into the folder every day at</label><input type="time" name="time" value="${esc(b.time)}"><label class="meta">keeping the last <input type="number" name="keep" min="1" max="60" value="${b.keep}" style="width:4em"></label><button class="btn secondary" type="submit">Save</button></form>
<p class="meta">${b.folder ? `The folder is <code>backups</code> next to Max on the box${files ? ':' : ' (empty so far).'}` : 'The backup folder is missing on the box: run the setup again, or see docs/BACKUP.md.'}</p>
${files ? `<ul>${files}</ul>` : ''}
<p class="meta">To keep the daily backups off the box, point a sync tool at that folder (a USB stick, a NAS, or rclone to a cloud drive): docs/BACKUP.md shows how.</p>
<h3>Your encryption key</h3>
<p class="meta">A backup is useless without the key. Keep a copy in your password manager: <span class="hpw" id="bKey">••••••••••••</span> <button type="button" class="btn secondary" id="bShowKey">Show</button> <button type="button" class="btn secondary" id="bCopyKey">Copy</button> <span id="bKeyMsg" role="status"></span></p>
<h3>Restore</h3>
<p class="meta">On a new box (or after a mishap): put the key back first (<code>MEMORY_KEY</code> in <code>.env</code>, or <code>data/memory.key</code>), then choose the backup file here. Max replaces what he has with the backup and restarts.${b.withHome ? ' Home Assistant\'s own settings land in <code>data/home-assistant-restore</code> for copying over by hand (docs/BACKUP.md).' : ''}</p>
<div class="upload"><input id="bFile" type="file" accept=".maxbak"><span class="meta" id="bMsg"></span></div>
<script>
(function () {
  var post = function (path) { return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' }).then(function (r) { return r.json(); }); };
  var key = document.getElementById('bKey'), msg = document.getElementById('bKeyMsg');
  document.getElementById('bShowKey').addEventListener('click', function () {
    if (key.textContent.indexOf('•') !== 0) { key.textContent = '••••••••••••'; this.textContent = 'Show'; return; }
    var btn = this;
    post('/backup/key').then(function (r) { if (r.key) { key.textContent = r.key; btn.textContent = 'Hide'; } else msg.textContent = r.message || 'No key.'; });
  });
  document.getElementById('bCopyKey').addEventListener('click', function () {
    post('/backup/key').then(function (r) {
      if (!r.key) { msg.textContent = r.message || 'No key.'; return; }
      var done = function () { msg.textContent = 'Key copied.'; }, fail = function () { msg.textContent = "Couldn't copy: press Show instead."; };
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(r.key).then(done, fail); return; }
      var box = document.createElement('textarea'); box.value = r.key; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0';
      document.body.appendChild(box); box.select();
      try { document.execCommand('copy') ? done() : fail(); } catch (e) { fail(); }
      document.body.removeChild(box);
    });
  });
  var input = document.getElementById('bFile'), out = document.getElementById('bMsg');
  input.addEventListener('change', async function () {
    var f = input.files[0];
    if (!f) return;
    if (!confirm('Replace everything Max has with this backup (' + f.name + ')? Max restarts afterwards.')) { input.value = ''; return; }
    out.textContent = 'Restoring…';
    try {
      var r = await fetch('/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
      var j = await r.json();
      if (j.error) { out.textContent = j.error; return; }
      out.textContent = 'Restored ' + j.files + ' files' + (j.home ? ' (and ' + j.home + ' Home Assistant files)' : '') + '. Max is restarting: this page comes back in a minute.';
      setTimeout(function () { location.hash = 'backup'; location.reload(); }, 20000);
    } catch (e) { out.textContent = 'The restore failed: ' + e; }
  });
})();
</script></section>`;
}
