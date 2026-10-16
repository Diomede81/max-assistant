/**
 * The 3D robot face (three.js, WebGL): a glossy white rounded head with a dark glass visor, two
 * glowing "ear" pods and a small antenna. Max's eyes, brows and mouth are drawn exactly as on the
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
  const R3 = { on: false, wanted: false, frames: 0, time: 0, lowered: false };
  const VW = 768, VH = 675, VS = 1.5, VC = 20; // visor texture size, pixels per design unit, design y of its centre
  const visorCv = document.createElement('canvas'); visorCv.width = VW; visorCv.height = VH;
  const vg = visorCv.getContext('2d');
  /** Half the screen height in 3D units: the head (radius 1) fills about half the screen, leaving room above and below for the clock and glance. */
  const VIEW_HALF = 1.72;

  function wantRobot() {
    const p = params.get('face');
    if (p) return p !== 'classic';
    return (info.faceStyle || 'robot') !== 'classic';
  }

  async function startRobot() {
    R3.wanted = true;
    let THREE, RoomEnvironment;
    try {
      THREE = await import('/vendor/three.module.min.js');
      RoomEnvironment = (await import('/vendor/RoomEnvironment.js')).RoomEnvironment;
    } catch (e) { console.warn('3D face: library not available, using the classic face', e); return; }
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

    // Ear pods with a glowing ring, and a little antenna with a glowing tip (they take Max's colour).
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ee1ff, emissiveIntensity: 1.6 });
    const tipGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ee1ff, emissiveIntensity: 2 });
    for (const sd of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.18, 48), shell);
      ear.rotation.z = Math.PI / 2; ear.position.set(sd * 0.96, -0.04, 0); head.add(ear);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 16, 48), glow);
      ring.rotation.y = Math.PI / 2; ring.position.set(sd * 1.055, -0.04, 0); head.add(ring);
    }
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.14, 16), shell);
    stalk.position.set(0, 0.97, 0); head.add(stalk);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), tipGlow);
    tip.position.set(0, 1.06, 0); head.add(tip);

    function resize3() {
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize3); resize3();

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
    console.warn('3D face off: ' + why + '; using the classic face');
    R3.on = false;
    if (R3.c3) R3.c3.remove();
    if (R3.renderer) R3.renderer.dispose();
  }
`;
