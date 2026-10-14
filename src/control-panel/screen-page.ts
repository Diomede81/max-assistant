/** The "Screen" section of the Settings tab: what the round screen shows when Max is idle, and the evening photo frame. */
export interface PanelScreen {
  glance: boolean;
  frame: boolean;
  frameFrom: string;
  frameTo: string;
  frameEverySec: number;
  captions: boolean;
  notifyBriefing: boolean;
  notifyEmail: boolean;
  notifyTodos: boolean;
  photos: { name: string; size: number }[];
  /** The home location's name (the weather is for it), if set. */
  place?: string;
}

type Esc = (s: unknown) => string;

export const SCREEN_CSS = `
.photos { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
.photos figure { margin: 0; position: relative; }
.photos img { width: 96px; height: 96px; object-fit: cover; border-radius: 10px; display: block; background: #0002; }
.photos form { position: absolute; top: 4px; right: 4px; }
.photos button { border: 0; border-radius: 99px; width: 26px; height: 26px; background: #000a; color: #fff; font-size: 14px; cursor: pointer; }
label.tick { display: block; margin: 8px 0; }
.upload { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
`;

export function screenSection(s: PanelScreen, esc: Esc): string {
  const photos = s.photos
    .map(
      (p) => `<figure><img src="/screen/photos/${esc(p.name)}" loading="lazy" alt=""><form method="post" action="/screen/photo-delete" onsubmit="return confirm('Remove this picture?')"><input type="hidden" name="name" value="${esc(p.name)}"><button type="submit" title="Remove" aria-label="Remove">✕</button></form></figure>`,
    )
    .join('');
  return `<section id="screen"><h2>Screen</h2>
<p class="meta">What Max's round screen shows. Tap his face to see your day. In guest mode visitors only see the time and the weather.</p>
<form class="stack" method="post" action="/screen/save">
<label class="meta tick"><input type="checkbox" name="captions" value="on" ${s.captions ? 'checked' : ''}> <b>Captions</b>: show the words on screen, what Max heard you say and what he's answering</label>
<label class="meta tick"><input type="checkbox" name="glance" value="on" ${s.glance ? 'checked' : ''}> <b>Glance</b>: the weather${s.place ? ` in ${esc(s.place)}` : ' (set your home location above)'}, your next meeting and the to-dos that matter, around his face</label>
<label class="meta tick"><input type="checkbox" name="frame" value="on" ${s.frame ? 'checked' : ''}> <b>Evening photo frame</b>: your pictures, one fading into the next, with the clock (after 2 minutes of quiet; "Hey Max" or a touch brings him back)</label>
<div class="addfact"><label class="meta" for="ff">From</label><input id="ff" type="time" name="frameFrom" value="${esc(s.frameFrom)}" required>
<label class="meta" for="ft">to</label><input id="ft" type="time" name="frameTo" value="${esc(s.frameTo)}" required>
<label class="meta" for="fe">next picture every</label><input id="fe" type="number" name="frameEverySec" min="5" max="600" value="${s.frameEverySec}" style="width:5em"><span class="meta">seconds</span></div>
<p class="meta"><b>Notifications</b>: a card on the screen when something needs you (never while you're talking to Max, during his sleep hours, or in guest mode):</p>
<label class="meta tick"><input type="checkbox" name="notifyBriefing" value="on" ${s.notifyBriefing ? 'checked' : ''}> Your news briefing is ready</label>
<label class="meta tick"><input type="checkbox" name="notifyEmail" value="on" ${s.notifyEmail ? 'checked' : ''}> An important email arrives (marked important in Gmail, or high importance in Outlook; checked every 10 minutes, 07:00–22:00)</label>
<label class="meta tick"><input type="checkbox" name="notifyTodos" value="on" ${s.notifyTodos ? 'checked' : ''}> A to-do is overdue (once a day each, with Done and Tomorrow buttons)</label>
<div><button class="btn" type="submit">Save</button></div>
</form>
<h3>Pictures (${s.photos.length})</h3>
<div class="photos">${photos || '<p class="meta">No pictures yet.</p>'}</div>
<div class="upload"><input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="meta" id="photoMsg">JPEG, PNG or WebP, up to 15 MB each. Kept on the box only.</span></div>
<script>
(function () {
  var input = document.getElementById('photoFiles'), msg = document.getElementById('photoMsg');
  input.addEventListener('change', async function () {
    var files = Array.prototype.slice.call(input.files), done = 0, failed = [];
    for (var i = 0; i < files.length; i++) {
      msg.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
      try {
        var r = await fetch('/screen/photo', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: files[i] });
        var j = await r.json();
        if (j.error) failed.push(files[i].name + ': ' + j.error); else done++;
      } catch (e) { failed.push(files[i].name + ': upload failed'); }
    }
    if (failed.length) { msg.textContent = failed.join(' · '); if (done) setTimeout(function () { location.hash = 'screen'; location.reload(); }, 2500); }
    else { location.hash = 'screen'; location.reload(); }
  });
})();
</script>
</section>`;
}
