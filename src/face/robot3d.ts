/**
 * The 3D robot face (three.js, WebGL): a glossy white rounded head with a dark glass visor, two
 * glowing "ear" pods and a small antenna; or one of the other characters (an astro droid, a golden
 * droid, a rolling droid, a blue alien), which share the head and visor and differ in their shell,
 * colours and accessories. Max's eyes, brows and mouth are drawn exactly as on the
 * classic face (same expressions, blinks, gaze and lip-sync), onto the visor, and the whole head
 * moves in 3D: it turns to look around, tilts, nods as he speaks and droops when he sleeps.
 *
 * This is browser code inserted into the face page's script (same scope: g, W, H, cx, cy, R, info,
 * params, demo, roundRect...). It's in the page's template string, so: no backticks, no dollar-brace
 * and no backslashes in it. If WebGL or the library isn't available, or the box can't draw it
 * smoothly, the page falls back to the classic face on its own.
 */
export const ROBOT3D_JS = String.raw`
  // ---------- 3D robot face ----------
  const R3 = { on: false, wanted: false, frames: 0, time: 0, lowered: false, gen: 0 };
  const VW = 768, VH = 675, VS = 1.5, VC = 20; // visor texture size, pixels per design unit, design y of its centre
  const visorCv = document.createElement('canvas'); visorCv.width = VW; visorCv.height = VH;
  const vg = visorCv.getContext('2d');
  /** Half the screen height in 3D units: the head (radius 1) fills about half the screen, leaving room above and below for the clock and glance. */
  const VIEW_HALF = 1.82;

  /** Which face: 'classic' (flat) or a 3D character (robot, astro, golden, rolling, alien). */
  const CHARACTERS = ['robot', 'astro', 'golden', 'rolling', 'alien'];
  function faceChoice() {
    const p = params.get('face') || info.faceStyle || 'robot';
    return p === 'classic' || CHARACTERS.indexOf(p) >= 0 ? p : 'robot';
  }
  function wantRobot() {
    return faceChoice() !== 'classic';
  }

  async function startRobot() {
    R3.wanted = true;
    R3.style = faceChoice();
    const gen = ++R3.gen; // a newer start or a stop makes this one give up
    let THREE, RoomEnvironment;
    try {
      THREE = await import('/vendor/three.module.min.js');
      RoomEnvironment = (await import('/vendor/RoomEnvironment.js')).RoomEnvironment;
    } catch (e) { console.warn('3D face: library not available, using the classic face', e); return; }
    if (gen !== R3.gen) return;
    const c3 = document.createElement('canvas');
    c3.id = 'c3';
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: c3, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { console.warn('3D face: no WebGL, using the classic face', e); return; }
    document.body.insertBefore(c3, cv);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0, 0, VIEW_HALF / Math.tan((14 * Math.PI) / 180));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-3.6, 3.4, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd8ff, 1.4); rim.position.set(2.6, 1.2, -3); scene.add(rim);

    const head = new THREE.Group();
    scene.add(head);
    // Standard materials (lighter than 'physical' ones on the Pi's graphics chip): glossy white shell.
    const shell = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.22, metalness: 0, envMapIntensity: 1.15 });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), shell);
    skull.scale.set(1, 0.94, 0.92);
    head.add(skull);

    // The visor: a curved sheet hugging the front of the head, painted every frame with the eyes and mouth.
    const vgeo = new THREE.PlaneGeometry(1.6, 1.4, 48, 42);
    const pos = vgeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const q = 1 - x * x - (y * y) / (0.94 * 0.94);
      pos.setZ(i, 0.92 * Math.sqrt(Math.max(0, q)) + 0.03); // just proud of the shell, so it never dips into it
    }
    vgeo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(visorCv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const visorMat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.25,
      transparent: true, alphaTest: 0.04, roughness: 0.65, metalness: 0,
    });
    visorMat.envMapIntensity = 0; // the room reflects in his shell, not across his face (the glass sheen is painted)
    const visor = new THREE.Mesh(vgeo, visorMat);
    head.add(visor);

    // Max's colour (it follows his mood): glowing rings, lenses and tips on every character.
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ee1ff, emissiveIntensity: 1.6 });
    const tipGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ee1ff, emissiveIntensity: 2 });
    const mat = (color, roughness, metalness, env) => new THREE.MeshStandardMaterial({ color: color, roughness: roughness, metalness: metalness || 0, envMapIntensity: env === undefined ? 1.15 : env });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); head.add(o); return o; };
    const deg = Math.PI / 180;
    // A point on the head's surface (around: 0 = front, 90 = his left; up: 0 = eye level, 90 = top), facing outwards.
    const onShell = (o, around, up, out) => {
      const r = 1 + (out || 0), a = around * deg, e = up * deg;
      o.position.set(Math.sin(a) * Math.cos(e) * r, Math.sin(e) * 0.94 * r, Math.cos(a) * Math.cos(e) * 0.92 * r);
      o.lookAt(o.position.clone().multiplyScalar(2));
      head.add(o);
      return o;
    };
    // A ring around the top of the head, just above the visor.
    const crownRing = (m, up, tube) => {
      const e = up * deg;
      const ring = add(new THREE.TorusGeometry(Math.cos(e) * 1.005, tube, 12, 96), m, 0, Math.sin(e) * 0.94, 0);
      ring.rotation.x = Math.PI / 2; ring.scale.set(1, 0.92, 1);
      return ring;
    };
    const ears = (m) => {
      for (const sd of [-1, 1]) {
        const ear = add(new THREE.CylinderGeometry(0.25, 0.27, 0.18, 48), m, sd * 0.96, -0.04, 0);
        ear.rotation.z = Math.PI / 2;
        const ring = add(new THREE.TorusGeometry(0.16, 0.03, 16, 48), glow, sd * 1.055, -0.04, 0);
        ring.rotation.y = Math.PI / 2;
      }
    };
    const antenna = (m, x, z, height) => {
      add(new THREE.CylinderGeometry(0.016, 0.024, height, 12), m, x, 0.9 + height / 2, z);
      add(new THREE.SphereGeometry(0.05, 20, 14), tipGlow, x, 0.92 + height, z);
    };

    if (R3.style === 'astro') {
      // Astro droid: a silver dome with blue panels, a big lens on top and a little projector.
      skull.material = mat(0xc9ced6, 0.3, 0.85, 1.3);
      const white = mat(0xf2f5f8, 0.25), blue = mat(0x2456c4, 0.35, 0.1);
      crownRing(blue, 50, 0.035);
      crownRing(blue, 70, 0.022);
      // Blue panels between the two rings, all around the dome (the front ones above the visor).
      for (const a of [-38, 38, -80, 80, 125, -125, 180]) onShell(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.05), blue), a, 60, 0.012);
      for (const a of [-90, 90]) onShell(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.05), white), a, 5, 0.01);
      const lens = onShell(new THREE.Group(), 0, 61, 0.02);
      const lensBody = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.12, 32), mat(0x111317, 0.3, 0.4));
      lensBody.rotation.x = Math.PI / 2; lens.add(lensBody);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), tipGlow); eye.position.z = 0.06; lens.add(eye);
      const proj = onShell(new THREE.Group(), 40, 18, 0);
      const projBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 24), white);
      projBody.rotation.x = Math.PI / 2; proj.add(projBody);
      const projLens = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), glow); projLens.position.z = 0.06; proj.add(projLens);
    } else if (R3.style === 'golden') {
      // Golden droid: polished gold, round ear plates and a brow over the visor.
      const gold = mat(0xd8a83c, 0.26, 1, 1.4);
      skull.material = gold;
      for (const sd of [-1, 1]) {
        const plate = add(new THREE.CylinderGeometry(0.24, 0.26, 0.1, 48), gold, sd * 0.97, -0.02, -0.02);
        plate.rotation.z = Math.PI / 2;
        const inner = add(new THREE.CylinderGeometry(0.13, 0.13, 0.11, 32), mat(0x3a3020, 0.5, 0.6), sd * 0.985, -0.02, -0.02);
        inner.rotation.z = Math.PI / 2;
        const dot = add(new THREE.SphereGeometry(0.05, 16, 12), glow, sd * 1.03, -0.02, -0.02);
        dot.scale.x = 0.6;
      }
      onShell(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.08), gold), 0, 50, 0.005);
      crownRing(mat(0xb08428, 0.3, 1, 1.4), 62, 0.025);
    } else if (R3.style === 'rolling') {
      // Rolling droid: white with orange rings, silver discs on the sides and two antennas.
      const orange = mat(0xf0782a, 0.35, 0.05), silver = mat(0xb8bec7, 0.3, 0.85, 1.3);
      crownRing(orange, 52, 0.04);
      crownRing(mat(0x9aa0a8, 0.3, 0.8, 1.3), 58, 0.018);
      for (const sd of [-1, 1]) {
        const ring = add(new THREE.TorusGeometry(0.28, 0.045, 16, 64), orange, sd * 0.94, -0.06, 0);
        ring.rotation.y = Math.PI / 2;
        const disc = add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 40), silver, sd * 0.955, -0.06, 0);
        disc.rotation.z = Math.PI / 2;
        const lamp = add(new THREE.SphereGeometry(0.06, 16, 12), glow, sd * 0.99, -0.06, 0);
        lamp.scale.x = 0.6;
      }
      for (const a of [-140, 140, 180]) onShell(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.04), orange), a, 20, 0.01);
      antenna(silver, 0.16, -0.1, 0.34);
      antenna(silver, 0.3, -0.12, 0.14);
    } else if (R3.style === 'alien') {
      // Blue alien: soft blue fur, big pointy ears with pink insides and a tuft on top.
      const fur = mat(0x3f6fd8, 0.85, 0, 0.5), pink = mat(0xe88aa8, 0.8, 0, 0.4), dark = mat(0x2b4fa8, 0.85, 0, 0.5);
      skull.material = fur;
      for (const sd of [-1, 1]) {
        const ear = new THREE.Group();
        const outer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 32), fur);
        outer.scale.z = 0.42;
        const inside = new THREE.Mesh(new THREE.ConeGeometry(0.29, 1.0, 32), pink);
        inside.scale.z = 0.2; inside.position.set(0, -0.08, 0.09);
        ear.add(outer); ear.add(inside);
        ear.position.set(sd * 1.12, 0.36, -0.08);
        ear.rotation.z = -sd * 58 * deg;
        ear.rotation.y = -sd * 14 * deg;
        head.add(ear);
      }
      for (const [x, tilt, len] of [[-0.09, 18, 0.22], [0, 0, 0.28], [0.09, -18, 0.22]]) {
        const tuft = add(new THREE.ConeGeometry(0.045, len, 12), dark, x, 0.92 + len / 2 - 0.04, -0.05);
        tuft.rotation.z = tilt * deg;
      }
    } else {
      // Max: the white robot with glowing ear pods and a little antenna.
      ears(shell);
      add(new THREE.CylinderGeometry(0.02, 0.028, 0.14, 16), shell, 0, 0.97, 0);
      add(new THREE.SphereGeometry(0.06, 24, 16), tipGlow, 0, 1.06, 0);
    }

    function resize3() {
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize3); resize3();
    R3.resize = resize3;

    R3.c3 = c3; R3.renderer = renderer; R3.scene = scene; R3.camera = camera; R3.head = head;
    R3.tex = tex; R3.visorMat = visorMat; R3.glow = glow; R3.tipGlow = tipGlow; R3.key = key; R3.THREE = THREE;
    R3.on = true;
  }

  /** Paints the visor (dark glass with the eyes, brows and mouth) using the classic face's drawing. */
  function paintVisor(drawFeatures) {
    vg.setTransform(1, 0, 0, 1, 0, 0);
    vg.clearRect(0, 0, VW, VH);
    vg.translate(VW / 2, VH / 2 - VC * VS);
    vg.scale(VS, VS);
    const keep = g;
    g = vg;
    roundRect(-200, -170, 400, 372, 150);
    const glass = vg.createLinearGradient(0, -170, 0, 202);
    glass.addColorStop(0, '#0d1620'); glass.addColorStop(1, '#03060a');
    vg.fillStyle = glass; vg.fill();
    vg.save();
    roundRect(-200, -170, 400, 372, 150); vg.clip();
    drawFeatures();
    // the glass: a soft curved reflection along the upper left
    vg.lineCap = 'round';
    vg.strokeStyle = 'rgba(255,255,255,0.10)'; vg.lineWidth = 16;
    vg.beginPath(); vg.arc(30, 70, 225, Math.PI * 1.08, Math.PI * 1.36); vg.stroke();
    vg.strokeStyle = 'rgba(255,255,255,0.07)'; vg.lineWidth = 6;
    vg.beginPath(); vg.arc(30, 70, 200, Math.PI * 1.12, Math.PI * 1.22); vg.stroke();
    vg.restore();
    g = keep;
  }

  /** Moves the head and draws the 3D scene for this frame. */
  function renderRobot(P, now, cmp, state, rgbCol) {
    const T = R3.THREE, h = R3.head;
    const breathe = Math.sin(now / 1300);
    h.rotation.y = P.lx * 0.34 + Math.sin(now / 3900) * 0.025;
    h.rotation.x = P.ly * 0.24 + P.mo * 0.06 + (state === 'sleeping' ? 0.22 : 0);
    h.rotation.z = (-P.tilt * Math.PI) / 180;
    // While a card shows, the head moves up and shrinks (like the classic face).
    const sc = (1 - cmp * 0.68) * (1 + breathe * 0.006);
    h.scale.set(sc, sc, sc);
    h.position.y = breathe * 0.012 + cmp * VIEW_HALF * 0.72;
    const c = new T.Color().setRGB(rgbCol[0] / 255, rgbCol[1] / 255, rgbCol[2] / 255, T.SRGBColorSpace);
    R3.glow.emissive.copy(c);
    R3.tipGlow.emissive.copy(c);
    R3.tipGlow.emissiveIntensity = 1.2 + Math.max(0, P.ring) * 3;
    R3.glow.emissiveIntensity = 1 + Math.max(0, P.ring) * 1.5;
    R3.visorMat.emissiveIntensity = 1.25 * P.bright;
    R3.key.intensity = 0.7 + 0.8 * P.bright;
    if (R3.paint) R3.tex.needsUpdate = true;
    R3.renderer.render(R3.scene, R3.camera);
    // The box can't keep up: lower the detail, then fall back to the classic face.
    if (params.get('perf') === 'off') return;
    R3.frames++;
    if (!R3.started) R3.started = now;
    const spent = now - R3.started;
    if (spent > 4000) {
      const fps = (R3.frames * 1000) / spent;
      R3.frames = 0; R3.started = now;
      if (fps < 20 && !R3.lowered) { R3.lowered = true; R3.renderer.setPixelRatio(0.6); console.warn('3D face: lowered detail (' + fps.toFixed(1) + ' fps)'); }
      else if (fps < 13 && R3.lowered) { stopRobot('too slow (' + fps.toFixed(1) + ' fps)'); }
    }
  }

  function stopRobot(why) {
    console.warn('3D face off: ' + why);
    R3.gen++;
    R3.on = false;
    if (R3.resize) removeEventListener('resize', R3.resize);
    if (R3.c3) R3.c3.remove();
    if (R3.renderer) R3.renderer.dispose();
    R3.c3 = undefined; R3.renderer = undefined; R3.resize = undefined;
    R3.frames = 0; R3.started = 0; R3.lowered = false;
  }

  /** Shows the chosen face: swaps the 3D character (or to and from the classic face) in place, no reload. */
  function applyFace() {
    const want = wantRobot() ? faceChoice() : 'classic';
    const have = R3.wanted ? R3.style : 'classic';
    if (want === have) return;
    if (R3.wanted) { stopRobot('switching to ' + want); R3.wanted = false; }
    if (want !== 'classic') startRobot();
  }
`;
