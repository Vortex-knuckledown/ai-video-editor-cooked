/* stage3d.js: the studio's real-3D graphics. One lit stage (studio light, a black mirror floor that really reflects,
 * the video's own footage blurred far behind, haze) and five components built on it: bars, stat, tier, paper, layers.
 * Needs only three.js (./three.module.js beside it) and the clip's paused GSAP timeline. Every frame is a pure
 * function of the timeline's time: tweens write plain numbers, one clock tween (added last) calls draw().
 * Ours, MIT like the rest of the studio. No requestAnimationFrame, no randomness, no wall clock.
 */
import * as THREE from "./three.module.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const FONT = '"SF Pro Display", -apple-system, "Helvetica Neue", "Inter", Arial, sans-serif';

/* ---------------------------------------------------------------- the stage */
export function makeStage(canvas, cfg) {
  const W = cfg.w, H = cfg.h, wide = W >= H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const accent = new THREE.Color(cfg.accent || "#4D8DFF"), ground = new THREE.Color(cfg.ground || "#0A0C12");
  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(ground.clone().multiplyScalar(0.55), 26, 60);

  // light to reflect: a small dark room with soft boxes, one of them in the accent, baked once into the environment
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(40, 24, 40), new THREE.MeshBasicMaterial({ color: 0x10141e, side: THREE.BackSide })));
  const box = (w, h, x, y, z, col, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m); };
  box(16, 9, 0, 11, 2, 0xffffff, 7.0);            // the key, overhead
  box(5, 12, -15, 4, 6, 0xdfe8ff, 3.2);           // a long strip left: the streak along chrome edges
  box(5, 12, 15, 5, -4, accent, 4.2);             // the accent, right and behind
  box(30, 12, 0, 6, 18, 0xeaf0ff, 1.15);         // a broad soft fill behind the camera, so chrome is never black
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(room, 0.035).texture;
  pm.dispose();

  const all = (o) => { o.layers.enableAll(); return o; };
  const key = all(new THREE.DirectionalLight(0xffffff, 2.6)); key.position.set(-5, 9, 7); scene.add(key);
  const rim = all(new THREE.DirectionalLight(accent, 1.9)); rim.position.set(7, 4, -8); scene.add(rim);
  scene.add(all(new THREE.AmbientLight(0x8fa3c8, 0.22)));
  const sweep = all(new THREE.PointLight(0xffffff, 0, 30, 1.6)); scene.add(sweep);   // a light that crosses the subject once

  // layers: 0 the world (reflected), 1 the floor, 2 the backdrop
  const world = new THREE.Group(); scene.add(world);
  const back = new THREE.Group(); scene.add(back);

  // the backdrop: the footage, blurred and darkened, far behind; else a soft glow in the ground colour
  const bcv = document.createElement("canvas"); bcv.width = 960; bcv.height = 540;
  const btex = new THREE.CanvasTexture(bcv); btex.colorSpace = THREE.SRGBColorSpace;
  const paintBack = (img) => {
    const c = bcv.getContext("2d");
    c.filter = "none"; c.fillStyle = "#" + ground.getHexString(); c.fillRect(0, 0, 960, 540);
    if (img && img.naturalWidth) {
      const s = Math.max(960 / img.naturalWidth, 540 / img.naturalHeight) * 1.12, w = img.naturalWidth * s, h = img.naturalHeight * s;
      c.filter = "blur(16px) brightness(0.62) saturate(0.85)"; c.drawImage(img, (960 - w) / 2, (540 - h) / 2, w, h); c.filter = "none";
    }
    let g = c.createRadialGradient(480, 600, 40, 480, 600, 620); g.addColorStop(0, "rgba(" + [accent.r, accent.g, accent.b].map((v) => Math.round(v * 255)).join(",") + ",0.42)"); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 960, 540);
    g = c.createRadialGradient(480, 240, 160, 480, 270, 640); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.72)");
    c.fillStyle = g; c.fillRect(0, 0, 960, 540);
    btex.needsUpdate = true;
  };
  paintBack(null);
  const bp = new THREE.Mesh(new THREE.PlaneGeometry(96, 54), new THREE.MeshBasicMaterial({ map: btex, fog: false, toneMapped: false, depthWrite: false }));
  bp.position.set(0, 14, -34); bp.layers.set(2); back.add(bp);

  // the floor: black glass. The world is drawn once upside down under it, then the floor over that, then the world.
  const fcv = document.createElement("canvas"); fcv.width = fcv.height = 512;
  { const c = fcv.getContext("2d"), g = c.createRadialGradient(256, 256, 30, 256, 256, 256);
    g.addColorStop(0, "rgba(4,5,9,0.34)"); g.addColorStop(0.3, "rgba(4,5,9,0.62)"); g.addColorStop(0.8, "rgba(3,4,7,1)"); g.addColorStop(1, "rgba(3,4,7,1)"); c.fillStyle = g; c.fillRect(0, 0, 512, 512); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fcv), transparent: true, fog: false, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2; floor.layers.set(1); scene.add(floor);

  const camera = new THREE.PerspectiveCamera(wide ? 30 : 44, W / H, 0.1, 200);
  const look = V3(0, 2.2, 0);
  camera.position.set(0, 3.2, 17); camera.lookAt(look);

  const S = { THREE, renderer, scene, world, camera, look, accent, ground, sweep, W, H, wide, mirror: true, paintBack, updates: [] };
  S.render = () => {
    for (const f of S.updates) f();
    camera.lookAt(look);
    renderer.clear();
    camera.layers.set(2); renderer.render(scene, camera);
    if (S.mirror) {
      world.scale.y = -1; world.updateMatrixWorld(true);
      camera.layers.set(0); renderer.clearDepth(); renderer.render(scene, camera);
      world.scale.y = 1; world.updateMatrixWorld(true);
    }
    renderer.clearDepth(); camera.layers.set(1); renderer.render(scene, camera);
    camera.layers.set(0); camera.layers.enable(2); camera.layers.enable(3); renderer.render(scene, camera);   // 3: type, never mirrored
  };
  return S;
}

/* ---------------------------------------------------------------- parts */
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/* a column with a rounded footprint, one unit tall, standing on y=0 (scale.y is its height) */
export function column(w, d, r) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth: 1, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); g.translate(0, 0, 0);
  return g;
}
/* a slab facing the camera: w x h, thickness t, soft edges */
export function slab(w, h, t, r) {
  const b = Math.min(t * 0.45, 0.08);
  const g = new THREE.ExtrudeGeometry(roundedRect(w - b * 2, h - b * 2, r), { depth: t - b * 2, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -(t - b * 2) / 2);
  return g;
}
export const chrome = (S, col, rough = 0.16) => new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.72, roughness: rough, envMapIntensity: 1.6, clearcoat: 0.6, clearcoatRoughness: 0.2 });
export const glass = (S, tint = 0xffffff, op = 1) => new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.2, transmission: 0.92, thickness: 0.9, ior: 1.42, envMapIntensity: 1.2,
  clearcoat: 1, clearcoatRoughness: 0.12, attenuationColor: S.accent, attenuationDistance: 9, transparent: op < 1, opacity: op });

/* text as a picture on a plane, so it sits in the scene's perspective. size: the height of a capital-ish em in world units.
 * room: the longest string it will ever show (the plane is sized for it). mesh.userData.set(str) redraws it. */
export function text(S, str, o = {}) {
  const em = 150, size = o.size || 0.5, weight = o.weight || 700, color = o.color || "#ffffff", align = o.align || "center";
  const font = `${o.italic ? "italic " : ""}${weight} ${em}px ${o.font || FONT}`;
  const probe = document.createElement("canvas").getContext("2d"); probe.font = font;
  const track = o.track || 0;
  const widthOf = (s) => probe.measureText(s).width + track * em * Math.max(0, s.length - 1);
  const wpx = Math.ceil(Math.max(widthOf(o.room || str), widthOf(str)) + em * 0.3), hpx = Math.ceil(em * 1.34);
  const cv = document.createElement("canvas"); cv.width = wpx; cv.height = hpx;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const paint = (s) => {
    const c = cv.getContext("2d"); c.clearRect(0, 0, wpx, hpx); c.font = font; c.textBaseline = "alphabetic"; c.fillStyle = color;
    c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = em * 0.05; c.shadowOffsetY = em * 0.02;      // a soft drop so type holds on any ground; never a glow
    const w = widthOf(s); let x = align === "left" ? em * 0.15 : align === "right" ? wpx - em * 0.15 - w : (wpx - w) / 2;
    if (!track) c.fillText(s, x, em * 1.02); else for (const ch of s) { c.fillText(ch, x, em * 1.02); x += probe.measureText(ch).width + track * em; }
    tex.needsUpdate = true;
  };
  paint(str);
  const k = size / em, m = new THREE.Mesh(new THREE.PlaneGeometry(wpx * k, hpx * k), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, fog: false }));
  if (align !== "center") m.geometry.translate((align === "left" ? 1 : -1) * (wpx * k / 2 - 0.15 * size), 0, 0);
  m.userData = { set: paint, w: wpx * k, h: hpx * k, last: str };
  m.renderOrder = 5; m.layers.set(3);
  return m;
}
const fmt = (v, dec, pre, post) => (pre || "") + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-US")) + (post || "");

/* the camera as keys: [[time, [x,y,z], [lookx,looky,lookz]], ...]; between keys it accelerates, travels, settles long */
function rig(S, keys) {
  const ease = (t) => (t < 0.2 ? 0.1 * (t / 0.2) * (t / 0.2) : t < 0.38 ? 0.1 + 0.65 * (t - 0.2) / 0.18 : 0.75 + 0.25 * (1 - Math.pow(1 - (t - 0.38) / 0.62, 3)));
  return (time) => {
    let i = 0; while (i < keys.length - 2 && time > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], t = ease(clamp((time - a[0]) / Math.max(0.001, b[0] - a[0])));
    S.camera.position.set(a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t);
    S.look.set(a[2][0] + (b[2][0] - a[2][0]) * t, a[2][1] + (b[2][1] - a[2][1]) * t, a[2][2] + (b[2][2] - a[2][2]) * t);
  };
}
/* a drift that never stops under the keys: a slow orbit of a few degrees over the whole clip */
function orbit(S, time, D, deg) {
  const a = (deg * Math.PI / 180) * (time / D - 0.5), p = S.camera.position, dx = p.x - S.look.x, dz = p.z - S.look.z;
  p.x = S.look.x + dx * Math.cos(a) + dz * Math.sin(a); p.z = S.look.z - dx * Math.sin(a) + dz * Math.cos(a);
}

/* ---------------------------------------------------------------- bars: chrome columns on the mirror floor */
function bars(S, tl, D, d) {
  const items = d.items.slice(0, 6), n = items.length, top = Math.max(...items.map((x) => Math.abs(x[1]))) || 1;
  const best = items.reduce((b, x, i) => (x[1] > items[b][1] ? i : b), 0);
  const bw = Math.min(1.7, 11 / n * 0.56), gap = Math.min(3.0, 12.5 / n), maxH = S.wide ? 4.2 : 6.4, x0 = -(n - 1) * gap / 2;
  const dec = items.some((x) => !Number.isInteger(x[1])) ? 1 : 0;
  const st = items.map(() => ({ h: 0.001, v: 0, lab: 0 }));
  const cols = items.map((it, i) => {
    const on = i === best, g = new THREE.Group(); g.position.set(x0 + i * gap, 0, 0); S.world.add(g);
    const bar = new THREE.Mesh(column(bw, bw * 0.72, bw * 0.12), on ? chrome(S, S.accent.clone().lerp(new THREE.Color(0xffffff), 0.08), 0.2) : chrome(S, 0xe3e9f4, 0.2));
    if (on) { bar.material.emissive = S.accent.clone(); bar.material.emissiveIntensity = 0.1; }
    g.add(bar);
    const val = text(S, fmt(0, dec, d.pre, d.unit), { size: on ? 0.95 : 0.7, room: fmt(it[1], dec, d.pre, d.unit) + "0", color: "#ffffff" });
    g.add(val);
    const name = text(S, String(it[0]), { size: 0.42, weight: on ? 700 : 500, color: on ? "#ffffff" : "#b9c2d6" });
    g.add(name);
    return { g, bar, val, name, on, H: Math.max(0.14, maxH * Math.abs(it[1]) / top), to: it[1] };
  });
  const each = Math.min(0.5, Math.max(0.22, (D - 2.0) / n)), t0 = 0.35, last = t0 + (n - 1) * each;
  cols.forEach((c, i) => {
    const at = t0 + i * each;
    tl.fromTo(st[i], { h: 0.001 }, { h: c.H, duration: 0.95, ease: "power3.out", immediateRender: false }, at);
    tl.fromTo(st[i], { v: 0 }, { v: c.to, duration: 0.95, ease: "power2.out", immediateRender: false }, at);
    tl.fromTo(st[i], { lab: 0 }, { lab: 1, duration: 0.45, ease: "power3.out", immediateRender: false }, Math.max(0, at - 0.12));
  });
  const sw = { x: -12, k: 0 };
  tl.fromTo(sw, { x: -11 }, { x: 11, duration: 1.3, ease: "power2.inOut", immediateRender: false }, Math.min(D - 1.4, last + 0.75));
  tl.fromTo(sw, { k: 0 }, { k: 1, duration: 0.3, ease: "power2.out", immediateRender: false }, Math.min(D - 1.4, last + 0.75));
  tl.fromTo(sw, { k: 1 }, { k: 0, duration: 0.4, ease: "power2.in", immediateRender: false }, Math.min(D - 0.5, last + 1.65));
  const bx = cols[best].g.position.x, span = (n - 1) * gap, dist = S.wide ? 14.5 + span * 0.45 : 21 + span * 0.6;
  const cam = rig(S, [[0, [x0 - 3.2, 2.9, dist * 0.62], [x0 + gap * 0.3, 1.5, 0]],
    [Math.min(D * 0.62, last + 0.7), [span * 0.16 + 1.5, 3.6, dist], [0, maxH * 0.6, 0]],
    [D, [bx * 0.5 + 2.6, 3.2, dist * 0.9], [bx * 0.3, maxH * 0.6, 0]]]);
  return (time) => {
    cols.forEach((c, i) => {
      c.bar.scale.y = st[i].h;
      c.val.userData.set(fmt(st[i].v, dec, d.pre, d.unit)); c.val.position.set(0, st[i].h + 0.62, 0); c.val.material.opacity = clamp(st[i].h / 0.3);
      c.name.material.opacity = st[i].lab; c.name.position.set(0, st[i].h + (c.on ? 1.42 : 1.2) - (1 - st[i].lab) * 0.2, 0);
      c.name.quaternion.copy(S.camera.quaternion).premultiply(c.g.getWorldQuaternion(new THREE.Quaternion()).invert());
      c.val.quaternion.copy(S.camera.quaternion).premultiply(c.g.getWorldQuaternion(new THREE.Quaternion()).invert());
    });
    S.sweep.position.set(sw.x, maxH * 0.7, 3.2); S.sweep.intensity = 60 * sw.k;
    cam(time); orbit(S, time, D, 7);
  };
}

/* ---------------------------------------------------------------- stat: one number on a slab of glass */
function stat(S, tl, D, d) {
  const g = new THREE.Group(); S.world.add(g);
  const valS = String(d.value), size = clamp(8.6 / Math.max(2.4, valS.length * 0.62), 1.1, 3.0);
  const num = text(S, d.n ? fmt(0, d.n[2], d.n[0], d.n[3]) : valS, { size, weight: 800, room: valS + "0", track: -0.03 });
  const lab = d.label ? text(S, String(d.label), { size: 0.5, weight: 500, color: "#dfe6f5" }) : null;
  const note = d.note ? text(S, String(d.note), { size: 0.3, weight: 500, color: "#9aa6bf" }) : null;
  const w = Math.max(num.userData.w, lab ? lab.userData.w : 0, note ? note.userData.w : 0) + 2.0, h = size * 1.42 + (lab ? 0.95 : 0) + (note ? 0.55 : 0) + 0.75;
  const cy = h / 2 + 0.75;
  const pane = new THREE.Mesh(slab(w, h, 0.36, 0.42), glass(S)); pane.position.y = cy; g.add(pane);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: S.accent, toneMapped: false })); g.add(bar);
  let y = cy + h / 2 - 0.42 - size * 0.62; num.position.set(0, y, 0.3); g.add(num);
  y -= size * 0.62 + 0.2; bar.position.set(0, y, 0.3);
  if (lab) { y -= 0.52; lab.position.set(0, y, 0.3); g.add(lab); }
  if (note) { y -= 0.55; note.position.set(0, y, 0.3); g.add(note); }
  const st = { in: 0, v: 0, bar: 0, lab: 0, note: 0, sx: -1.2, sk: 0 };
  tl.fromTo(st, { in: 0 }, { in: 1, duration: 0.9, ease: "power3.out", immediateRender: false }, 0.1);
  if (d.n) tl.fromTo(st, { v: 0 }, { v: d.n[1], duration: Math.min(1.3, D * 0.3), ease: "power2.out", immediateRender: false }, 0.45);
  const t1 = 0.45 + Math.min(1.3, D * 0.3);
  tl.fromTo(st, { bar: 0 }, { bar: 1, duration: 0.6, ease: "power3.out", immediateRender: false }, t1 - 0.25);
  tl.fromTo(st, { lab: 0 }, { lab: 1, duration: 0.5, ease: "power3.out", immediateRender: false }, t1);
  tl.fromTo(st, { note: 0 }, { note: 1, duration: 0.5, ease: "power3.out", immediateRender: false }, Math.min(D - 0.8, t1 + 0.7));
  const ts = Math.min(D - 1.2, t1 + 0.5);
  tl.fromTo(st, { sx: -1.1 }, { sx: 1.1, duration: 1.0, ease: "power2.inOut", immediateRender: false }, ts);
  tl.fromTo(st, { sk: 0 }, { sk: 0.5, duration: 0.3, ease: "power2.out", immediateRender: false }, ts);
  tl.fromTo(st, { sk: 0.5 }, { sk: 0, duration: 0.4, ease: "power2.in", immediateRender: false }, ts + 0.6);
  const dist = Math.max(S.wide ? 11.5 : 17, w * (S.wide ? 1.3 : 2.4), h * (S.wide ? 3.0 : 2.2));
  const cam = rig(S, [[0, [-5.2, cy - 1.0, dist * 0.72], [0.4, cy, 0]], [Math.min(D * 0.55, t1 + 0.4), [1.0, cy + 0.5, dist], [0, cy, 0]], [D, [2.6, cy + 0.2, dist * 0.9], [0, cy, 0]]]);
  return (time) => {
    g.rotation.y = (1 - st.in) * -0.75; g.position.set((1 - st.in) * -2.2, (1 - st.in) * -0.6, (1 - st.in) * -5);
    pane.material.opacity = 1; num.material.opacity = clamp(st.in * 1.4 - 0.2);
    if (d.n) num.userData.set(fmt(st.v, d.n[2], d.n[0], d.n[3]));
    bar.scale.x = Math.max(0.001, st.bar * (w - 2.0)); bar.material.opacity = st.bar;
    if (lab) { lab.material.opacity = st.lab; lab.position.x = (1 - st.lab) * -0.5; }
    if (note) note.material.opacity = st.note;
    S.sweep.intensity = 0;      // no crossing light on glass: it shows as a dot on the clear coat
    cam(time); orbit(S, time, D, 8);
  };
}

/* ---------------------------------------------------------------- tier: ranked rows of glass, each with a chrome chip */
function tier(S, tl, D, d) {
  const rows = d.tiers.slice(0, 6), n = rows.length, rh = S.wide ? Math.min(1.15, 6.6 / n) : Math.min(1.5, 9 / n), gap = rh * 0.16, bw = S.wide ? 10.4 : 8.2;
  const board = new THREE.Group(); S.world.add(board);
  const total = n * rh + (n - 1) * gap, baseY = 0.8;
  const st = rows.map((r) => ({ in: 0, it: r[1].map(() => 0) }));
  const each = Math.min(0.75, Math.max(0.35, (D - 1.4) / n));
  const built = rows.map((r, i) => {
    const y = baseY + total - rh / 2 - i * (rh + gap), g = new THREE.Group(); g.position.y = y; board.add(g);
    const strip = new THREE.Mesh(slab(bw, rh, 0.22, rh * 0.24), glass(S)); g.add(strip);
    const hue = S.accent.clone().lerp(new THREE.Color(0xc9d2e3), n > 1 ? i / (n - 1) : 0);
    const chip = new THREE.Mesh(slab(rh * 0.92, rh * 0.8, 0.34, rh * 0.2), chrome(S, hue, 0.2)); chip.position.set(-bw / 2 + rh * 0.62, 0, 0.16); g.add(chip);
    if (i === 0) { chip.material.emissive = S.accent.clone(); chip.material.emissiveIntensity = 0.1; }
    const letter = text(S, String(r[0]).slice(0, 2), { size: rh * 0.5, weight: 800, color: "#ffffff" }); letter.position.set(chip.position.x, 0, 0.36); g.add(letter);
    let x = -bw / 2 + rh * 1.35;
    const its = r[1].slice(0, 5).map((s) => {
      const m = text(S, String(s), { size: rh * 0.32, weight: i === 0 ? 700 : 500, color: i === 0 ? "#ffffff" : "#d5dcec", align: "left" });
      m.position.set(x, 0, 0.2); x += m.userData.w + rh * 0.3; g.add(m); return m;
    });
    const at = 0.25 + i * each;
    tl.fromTo(st[i], { in: 0 }, { in: 1, duration: 0.6, ease: "power3.out", immediateRender: false }, at);
    its.forEach((m, k) => tl.fromTo(st[i].it, { [k]: 0 }, { [k]: 1, duration: 0.4, ease: "power3.out", immediateRender: false }, at + 0.22 + k * 0.07));
    return { g, strip, chip, letter, its, y };
  });
  board.rotation.y = -0.2;
  const cy = baseY + total / 2, dist = S.wide ? 17.5 : 24;
  const end = 0.25 + (n - 1) * each + 0.7;
  const cam = rig(S, [[0, [-3.4, baseY + total + 0.2, dist * 0.62], [-1.5, baseY + total - rh, 0]], [Math.min(D * 0.7, end), [1.6, cy + 0.6, dist], [0.9, cy - 0.2, 0]], [D, [3.0, cy + 0.2, dist * 0.9], [1.1, cy - 0.2, 0]]]);
  return (time) => {
    built.forEach((b, i) => {
      const k = st[i].in; b.g.position.set((1 - k) * 3.2, b.y, (1 - k) * -2.5); b.g.rotation.x = (1 - k) * 0.5;
      b.g.visible = k > 0.001; b.letter.material.opacity = k;
      b.its.forEach((m, j) => { const q = st[i].it[j] || 0; m.material.opacity = q; m.position.y = (1 - q) * -0.14; });
    });
    cam(time); orbit(S, time, D, 6);
  };
}

/* ---------------------------------------------------------------- paper: a document in perspective, one line marked */
function wrap(c, s, maxW) { const out = []; let ln = ""; for (const w of String(s).split(/\s+/)) { const t = ln ? ln + " " + w : w; if (c.measureText(t).width > maxW && ln) { out.push(ln); ln = w; } else ln = t; } if (ln) out.push(ln); return out; }
function paper(S, tl, D, d) {
  const PW = 1000, PH = 1300, cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
  const c = cv.getContext("2d"); c.fillStyle = "#f4f1ea"; c.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 2600; i++) { const x = (i * 7919) % PW, y = (i * 104729) % PH; c.fillStyle = `rgba(60,50,30,${0.012 + ((i * 31) % 7) * 0.004})`; c.fillRect(x, y, 2, 2); }
  const M = 86; let y = 120;
  c.fillStyle = "#8a8578"; c.font = `600 22px ${FONT}`; c.fillText(String(d.kicker || d.source || "DOCUMENT").toUpperCase().split("").join(" ").slice(0, 80), M, y); y += 26;
  c.fillStyle = "#c9c4b8"; c.fillRect(M, y, PW - M * 2, 2); y += 64;
  c.fillStyle = "#16171b"; c.font = `700 52px Georgia, "Times New Roman", serif`;
  for (const ln of wrap(c, d.title || "", PW - M * 2).slice(0, 3)) { c.fillText(ln, M, y); y += 62; }
  if (d.by) { c.fillStyle = "#6b675d"; c.font = `400 24px ${FONT}`; c.fillText(String(d.by).slice(0, 70), M, y + 6); y += 44; }
  y += 30;
  const greys = (k) => { for (let i = 0; i < k; i++) { c.fillStyle = "#cfcabd"; c.fillRect(M, y, (PW - M * 2) * (i === k - 1 ? 0.62 : 0.9 + ((i * 37) % 10) / 100), 13); y += 40; } };
  greys(4); y += 16;
  c.font = `600 36px Georgia, "Times New Roman", serif`;
  const hl = wrap(c, d.highlight || d.title || "", PW - M * 2).slice(0, 4), marks = [];
  for (const ln of hl) { marks.push([M - 8, y - 34, c.measureText(ln).width + 16, 48]); c.fillStyle = "#16171b"; c.fillText(ln, M, y); y += 54; }
  y += 22; greys(Math.max(2, Math.min(9, Math.floor((PH - 110 - y) / 40))));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const pw = 6.2, ph = pw * PH / PW, geo = new THREE.PlaneGeometry(pw, ph, 40, 52), base = geo.attributes.position.array.slice();
  const sheet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.35 }));
  const g = new THREE.Group(); S.world.add(g); g.add(sheet);
  const py = (v) => ph / 2 - (v / PH) * ph, px = (u) => -pw / 2 + (u / PW) * pw;
  const mk = marks.map((r) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, r[3] / PH * ph), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.5, blending: THREE.MultiplyBlending, premultipliedAlpha: true, toneMapped: false, depthWrite: false }));
    m.geometry.translate(0.5, 0, 0); m.position.set(px(r[0]), py(r[1] + r[3] / 2), 0.012); m.userData.w = r[2] / PW * pw; sheet.add(m); return m; });
  const hy = marks.length ? py(marks[0][1] + (marks.length * 54) / 2) : 0;
  let card = null, cnum = null, ctx2 = null; const cs = { in: 0, v: 0 };
  if (d.finding || d.finding_value) {
    card = new THREE.Group(); S.world.add(card);
    const fn = d.fn;
    cnum = d.finding_value ? text(S, fn ? fmt(0, fn[2], fn[0], fn[3]) : String(d.finding_value), { size: 1.25, weight: 800, room: String(d.finding_value) + "0", align: "left" }) : null;
    const lines = (() => { const p = document.createElement("canvas").getContext("2d"); p.font = `600 100px ${FONT}`; return wrap(p, d.finding || "", 1500).slice(0, 3); })();
    ctx2 = lines.map((s) => text(S, s, { size: 0.36, weight: 600, color: "#eef2fb", align: "left" }));
    const kick = text(S, String(d.finding_kicker || "Key finding").toUpperCase(), { size: 0.2, weight: 600, color: "#9fb0d0", align: "left", track: 0.18 });
    const cw = Math.max(cnum ? cnum.userData.w : 0, ...ctx2.map((m) => m.userData.w), kick.userData.w) + 1.0, ch = 0.9 + (cnum ? 1.55 : 0) + lines.length * 0.5 + 0.3;
    const pane = new THREE.Mesh(slab(cw, ch, 0.3, 0.3), glass(S)); card.add(pane);
    let yy = ch / 2 - 0.5; kick.position.set(-cw / 2 + 0.5, yy, 0.22); card.add(kick);
    if (cnum) { yy -= 0.95; cnum.position.set(-cw / 2 + 0.5, yy, 0.22); card.add(cnum); yy -= 0.5; }
    ctx2.forEach((m) => { yy -= 0.5; m.position.set(-cw / 2 + 0.5, yy, 0.22); card.add(m); });
    card.userData = { cw, ch, kick };
  }
  const st = { in: 0, curl: 0.2, m: marks.map(() => 0) };
  tl.fromTo(st, { in: 0 }, { in: 1, duration: 0.9, ease: "power3.out", immediateRender: false }, 0.05);
  tl.fromTo(st, { curl: 1 }, { curl: 0.25, duration: 1.6, ease: "power2.out", immediateRender: false }, 0.05);
  const tm = Math.min(1.25, D * 0.28);
  marks.forEach((_, i) => tl.fromTo(st.m, { [i]: 0 }, { [i]: 1, duration: 0.75, ease: "power2.inOut", immediateRender: false }, tm + i * 0.7));
  const tEnd = tm + marks.length * 0.7 + 0.2, tc = Math.min(D - 1.3, tEnd + 0.15);
  if (card) { tl.fromTo(cs, { in: 0 }, { in: 1, duration: 0.7, ease: "power3.out", immediateRender: false }, tc); if (d.fn) tl.fromTo(cs, { v: 0 }, { v: d.fn[1], duration: 0.9, ease: "power2.out", immediateRender: false }, tc + 0.15); }
  const cy = ph / 2 + 0.55, dist = S.wide ? 17 : 21, side = card ? -2.9 : 0;
  g.position.set(side, cy, 0);
  const cam = rig(S, [[0, [side - 2.5, cy + 1.6, dist * 0.92], [side, cy + 0.3, 0]], [Math.min(D * 0.5, tEnd), [side + 0.9, cy + hy + 0.3, dist * 0.52], [side + 0.1, cy + hy, 0]],
    [D, [card ? 1.1 : side + 1.6, cy + hy * 0.5 + 0.2, dist * (card ? 0.82 : 0.6)], [card ? 0.5 : side, cy + hy * 0.5, 0]]]);
  return (time) => {
    const k = st.in; g.rotation.set(-0.12 - (1 - k) * 0.7, 0.3 - (1 - k) * 0.5, 0.035); g.position.y = cy - (1 - k) * 2.2; g.position.z = (1 - k) * -3;
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { const u = (base[i] + pw / 2) / pw, v = (ph / 2 - base[i + 1]) / ph, q = Math.max(0, u + v - 1.25); p[i + 2] = q * q * 2.6 * st.curl + Math.sin(u * 3.1) * 0.05 * st.curl; }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    mk.forEach((m, i) => { m.scale.x = Math.max(0.0001, st.m[i] * m.userData.w); m.visible = st.m[i] > 0.001; });
    if (card) { const q = cs.in; card.position.set(2.7 + (1 - q) * 2.6, cy + hy * 0.4 - 0.2, 1.6 + (1 - q) * -1.5); card.rotation.y = -0.34 - (1 - q) * 0.5; card.visible = q > 0.001;
      card.traverse((o) => { if (o.material && o.material.map) o.material.opacity = q; }); if (cnum && d.fn) cnum.userData.set(fmt(cs.v, d.fn[2], d.fn[0], d.fn[3])); }
    cam(time); orbit(S, time, D, 6);
  };
}

/* ---------------------------------------------------------------- layers: a stack of plates that comes apart */
function layers(S, tl, D, d) {
  const items = d.items.slice(0, 5), n = items.length, mark = clamp(d.mark | 0, 0, n - 1), pw = 5.4, pd = 3.6, th = 0.2;
  const g = new THREE.Group(); S.world.add(g); g.position.x = S.wide ? -3.0 : 0; g.rotation.y = 0.62;
  const st = { open: 0, in: 0, l: items.map(() => 0) };
  const plates = items.map((it, i) => {
    const on = i === mark, geo = slab(pw, pd, th, 0.36); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, on ? chrome(S, S.accent.clone(), 0.24) : glass(S, 0xdfe7f7));
    if (on) { m.material.emissive = S.accent.clone(); m.material.emissiveIntensity = 0.12; }
    g.add(m);
    const lab = text(S, String(it[0]), { size: 0.46, weight: on ? 700 : 600, color: "#ffffff", align: "left" });
    const sub = it[1] ? text(S, String(it[1]), { size: 0.3, weight: 500, color: "#c3cbdc", align: "left" }) : null;
    const line = new THREE.Mesh(new THREE.BoxGeometry(1, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: on ? S.accent : 0x8794ad, toneMapped: false }));
    line.geometry.translate(0.5, 0, 0);
    S.world.add(lab); if (sub) S.world.add(sub); S.world.add(line);
    return { m, lab, sub, line, on };
  });
  tl.fromTo(st, { in: 0 }, { in: 1, duration: 0.8, ease: "power3.out", immediateRender: false }, 0.05);
  tl.fromTo(st, { open: 0 }, { open: 1, duration: Math.min(1.6, D * 0.4), ease: "power3.inOut", immediateRender: false }, 0.5);
  const tl0 = 0.5 + Math.min(1.6, D * 0.4) * 0.45, each = Math.min(0.5, Math.max(0.22, (D - tl0 - 1.0) / n));
  plates.forEach((p, i) => tl.fromTo(st.l, { [i]: 0 }, { [i]: 1, duration: 0.5, ease: "power3.out", immediateRender: false }, tl0 + i * each));
  const sp = S.wide ? Math.min(1.3, 5.2 / Math.max(1, n - 1)) : Math.min(1.6, 7 / Math.max(1, n - 1));
  const y0 = 1.5, cy = y0 + (n - 1) * sp / 2 - 0.3, dist = S.wide ? 14.5 : 23;
  const cam = rig(S, [[0, [-1.2, 3.0, dist * 0.62], [g.position.x, 1.6, 0]], [Math.min(D * 0.6, tl0 + n * each), [1.0, cy + 2.6, dist], [0.6, cy, 0]], [D, [2.2, cy + 2.0, dist * 0.92], [0.8, cy, 0]]]);
  const tmp = V3(0, 0, 0);
  return (time) => {
    plates.forEach((p, i) => {
      const y = y0 + (n - 1 - i) * (th * 1.15 + (sp - th * 1.15) * st.open) - (1 - st.in) * 0.4;
      p.m.position.y = y; p.m.material.opacity = 1; p.m.visible = st.in > 0.001;
      const q = st.l[i]; tmp.set(pw / 2, y, pd / 2).applyMatrix4(g.matrixWorld);
      const lx = S.wide ? 1.6 : tmp.x + 0.4;
      p.line.position.set(tmp.x, y, tmp.z); p.line.scale.x = Math.max(0.001, (lx - tmp.x - 0.15) * q); p.line.visible = q > 0.001;
      p.line.lookAt(tmp.x, y, tmp.z + 1); p.line.rotation.set(0, Math.atan2(-(1.2 - tmp.z), lx - tmp.x), 0);
      p.lab.position.set(lx, y + (p.sub ? 0.16 : 0), 1.2 + (1 - q) * -0.3); p.lab.material.opacity = q;
      if (p.sub) { p.sub.position.set(lx, y - 0.3, 1.2); p.sub.material.opacity = q; }
    });
    g.rotation.y = 0.62 + st.open * 0.14;
    cam(time); orbit(S, time, D, 9);
  };
}

/* ---------------------------------------------------------------- time
 * The components describe their moves with fromTo(target, {k: a}, {k: b, duration, ease}, at), as on a GSAP timeline,
 * but nothing is handed to GSAP: the moves are kept here and every value is worked out from the time alone, in one
 * place, before the frame is drawn. (GSAP renders children in start order, so a drawing tween at 0 would draw before
 * the later ones had moved.) */
const EASES = { none: (t) => t, "power2.out": (t) => 1 - (1 - t) ** 2, "power3.out": (t) => 1 - (1 - t) ** 3, "power2.in": (t) => t * t,
  "power2.inOut": (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2), "power3.inOut": (t) => (t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3) };
function tracks() {
  const list = [];
  return {
    fromTo(obj, from, to, at) { for (const k of Object.keys(from)) list.push({ obj, k, a: from[k], b: to[k], at: at || 0, dur: Math.max(0.0001, to.duration || 0.5), ease: EASES[to.ease] || EASES["power3.out"] }); },
    apply(time) {
      const seen = new Map();
      for (const tr of [...list].sort((x, y) => x.at - y.at)) {
        let ks = seen.get(tr.obj); if (!ks) { ks = new Set(); seen.set(tr.obj, ks); }
        if (time >= tr.at) tr.obj[tr.k] = tr.a + (tr.b - tr.a) * tr.ease(clamp((time - tr.at) / tr.dur));
        else if (!ks.has(tr.k)) tr.obj[tr.k] = tr.a;
        ks.add(tr.k);
      }
    },
  };
}

/* ---------------------------------------------------------------- start */
const KINDS = { bars, versus: bars, stat, tier, paper, source: paper, layers };
export function run(cfg) {
  const canvas = document.getElementById(cfg.canvas || "k3");
  const tl = window.__timelines[cfg.id] || window.__timelines[Object.keys(window.__timelines)[0]], D = cfg.dur;
  const S = makeStage(canvas, cfg);
  const rec = tracks();
  const part = KINDS[cfg.kind](S, rec, D, cfg.data);
  const frame = (time) => { rec.apply(time); part(time); };
  // one clock on the clip's timeline; its property is a setter, so a seek draws even when callbacks are suppressed
  const clock = { _t: 0, get t() { return this._t; }, set t(v) { this._t = v; frame(v); S.render(); } };
  const draw = () => { frame(clock._t); S.render(); };
  tl.fromTo(clock, { t: 0 }, { t: D, duration: D, ease: "none", immediateRender: false }, 0);
  const img = cfg.bg ? document.getElementById("k3bg") : null;
  if (img) { const go = () => { S.paintBack(img); draw(); }; if (img.complete && img.naturalWidth) go(); else img.addEventListener("load", go); }
  frame(0); S.render();
  window.__stage3d = { S, draw, tl };
}
