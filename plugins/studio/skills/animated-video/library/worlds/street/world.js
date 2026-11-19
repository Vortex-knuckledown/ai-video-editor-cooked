// World "street": a New York side street on a clear morning.
//
// Axes (metres): +x is EAST (screen right for a camera looking north, -z), +y up, +z SOUTH (towards the
// "near" side). The main street runs along x: road z -6..6 (one-way eastbound, parking lanes at z = +-4.9),
// pavements 7.5 m wide (z 6..13.5 near, -13.5..-6 far), pavement top at y = 0.15, building fronts at z = +-13.5.
// Cross streets every 150 m (centres x = -440, -290, -140, 10, 160, 310, 460, road 12 m wide). Sam's corner is the
// near-west corner of the cross street at x = 10: crosswalks across the cross street (x 4..16, z 7.2..10.8) and
// across the main street (x 0.3..3.7). Parallel streets at z = +-(62..74) and a further row of taller blocks.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"]}) -> world. cast names the library characters to load
// (../lib/figure.js loadFigure: "woman", "man", "soldier", "robot", "mannequin"); the first one is "Sam". Per frame: set world.camera, then world.update(state),
// then world.render() (or world.renderer.render(world.scene, world.camera)).
//
// state (every field optional):
//   time        seconds of the shot (drives idle flutter and Sam's animation clock by default)
//   people      {<id>: {x, z, heading, time, gait: {walk, run}, show, phone, look, lift, tilt}} one entry per cast
//               member (same meanings as sam below; time = its animation clock). The first cast member also reads
//               state.sam, so shots written for the old one-person world still work (people.<id> wins per key).
//               Cast members after the first stand 1.2 m west of each other at Sam's spot unless placed.
//   sam         {x, z, heading, walk, run, t, phone, look, lift, tilt, show}  (drives the first cast member)
//               x,z position (default 3.3, 8.6 = at the kerb of the cross-street crosswalk, facing east);
//               heading radians about +y, 0 faces +z (south), PI/2 faces east (default), PI faces north;
//               walk, run 0..1 gait weights (idle gets the rest); move x by world.gaitSpeed.walk * walk * dt so
//               feet never slide; t = animation clock (default time; hold it still to freeze mid-stride);
//               phone 0..1 raises a phone in the right hand and bows the head; look radians head turn (+ = left);
//               lift metres off the ground; tilt radians lean (+ = forward); show false hides Sam.
//   car         {x, z} the moving taxi on the main street (default far out of sight). Wheels turn with x.
//   signal      0 = Sam's walk signal (across the cross street) shows the orange hand, main street red;
//               1 = WALK for Sam, main street green
//   wind        0..1 how hard the wind lifts things (leaves, litter, dust off the ground, trees bend east)
//   windTime    seconds of wind blown so far; debris travels east with it. Hold it constant to freeze in mid-air.
//   debrisX     x the loose debris field is centred on (default Sam's x); it spans +-70 m
//   dustWall    0..1 opacity of the wall of dust and debris streaking east past the buildings
//   lurch       metres parked cars and litter bins are thrown east (bins tip over, cars rock)
//   burst       seconds since the stop: dust jumps off the pavement at Sam's feet towards the east (null = none)
//   arrow       0..1 a glowing arrow along the main street pointing east (grows and fades in)
//   contrail    0..1 a jet crossing high above the street from west to east, drawing a contrail
//   sunLow      0 = morning sun (day sky), 1 = Sun fixed low in the east over the rooftops (low-sun sky, long shadows)
//   shadowRadius metres of the shadow box round the focus (default from the camera's distance)
//   focus       {x,y,z} the shadow box centre (default Sam)
//
// Exposes: world.cast.<id> (each a loadFigure result: object, pose, actions, durations, height),
// world.person (the first cast member's root Object3D, also world.sam; world.figure is its loadFigure result),
// world.bones {head, hips, rightHand, leftFoot, rightFoot} (the first's), world.gaitSpeed.<id> {walk, run} m/s
// measured from each figure's feet (world.gaitSpeed.walk / .run are the first's, as before),
// world.phone, world.sun (DirectionalLight), world.sunDir (unit vector to the Sun), world.car (moving taxi),
// world.arrow, world.jet, world.spot (Sam's default spot, Vector3),
// world.crosswalk {x0, x1, z0, z1} (across the cross street), world.signalPole (Vector3, the walk signal Sam checks),
// world.PAVE (0.15), world.KERB_Z (6), world.FRONT_Z (13.5), world.parked (array of parked car groups),
// world.trees, world.bins.
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"] }) {
  if (typeof cast === "string") cast = [cast];
  if (!cast || !cast.length) cast = ["woman"];
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;

  // ---------------------------------------------------------------- renderer, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(canvas.width || 1920, canvas.height || 1080, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, (canvas.width || 1920) / (canvas.height || 1080), 0.05, 9000);
  camera.position.set(-30, 8, 10); camera.lookAt(3, 1.5, 8);

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f) => new Promise((res, rej) => TL.load(K + f, res, undefined, rej));
  const hdr = (f) => { const l = new HDRLoader(); l.setDataType(THREE.FloatType); return l.loadAsync(K + f); };
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const [skyDay, skyLow, BRICK, ASPH, CONC, ROCK, FIGS] = await Promise.all([
    hdr("sky/day.hdr"), hdr("sky/sunset.hdr"), pbrSet("brick"), pbrSet("asphalt"), pbrSet("concrete"), pbrSet("rock"),
    Promise.all(cast.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] }))),
  ]);

  // ---------------------------------------------------------------- deterministic random
  let seed = 20261119;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  // ---------------------------------------------------------------- sky: find the Sun in each HDR
  function analyseSky(t, targetAz) {
    const { data, width: W, height: H } = t.image;
    let best = -1, bi = 0;
    const hor = [0, 0, 0]; let hn = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4, L = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (L > best) { best = L; bi = r * W + c; }
      const v = 1 - (r + 0.5) / H, el = (v - 0.5) * PI;
      if (el > 0.02 && el < 0.2 && L < 4) { hor[0] += data[i]; hor[1] += data[i + 1]; hor[2] += data[i + 2]; hn++; }
    }
    const r = Math.floor(bi / W), c = bi % W;
    const u = (c + 0.5) / W, v = 1 - (r + 0.5) / H;
    let el = (v - 0.5) * PI; if (el < 0) el = -el;
    const phi = (u - 0.5) * 2 * PI;
    const dTex = new V3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
    const a = Math.atan2(dTex.z, dTex.x) - targetAz;           // rotate the sky so its Sun sits at targetAz
    const sunDir = dTex.clone().applyEuler(new THREE.Euler(0, a, 0)).normalize();
    const fog = new THREE.Color(hor[0] / hn, hor[1] / hn, hor[2] / hn);
    const m = Math.max(fog.r, fog.g, fog.b); if (m > 1.2) fog.multiplyScalar(1.2 / m);
    return { rot: a, sunDir, el, fog };
  }
  for (const s of [skyDay, skyLow]) s.mapping = THREE.EquirectangularReflectionMapping;
  // morning: the Sun to the east-south-east; low: the Sun in the east, down the street over the rooftops
  const SKY = [
    Object.assign(analyseSky(skyDay, Math.atan2(0.5, 0.86)), { tex: skyDay }),
    Object.assign(analyseSky(skyLow, Math.atan2(0.22, 0.97)), { tex: skyLow }),
  ];
  // light direction: the sky's own Sun, but never higher than 42 degrees (a morning) and at least 7 degrees
  for (const s of SKY) {
    const az = Math.atan2(s.sunDir.z, s.sunDir.x);
    const el = Math.min(Math.max(Math.asin(s.sunDir.y), 0.12), 0.73);
    s.light = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  }
  scene.fog = new THREE.FogExp2(SKY[0].fog.clone(), 0.0032);

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.1);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6b5a48, 0.25); scene.add(hemi);
  let skyIndex = -1;
  function setSky(i) {
    if (i === skyIndex) return; skyIndex = i;
    const s = SKY[i];
    scene.background = s.tex; scene.environment = s.tex;
    scene.backgroundRotation.set(0, s.rot, 0); scene.environmentRotation.set(0, s.rot, 0);
    scene.backgroundBlurriness = 0.0; scene.backgroundIntensity = 1.0;
    scene.environmentIntensity = i ? 0.75 : 1.0;
    scene.fog.color.copy(s.fog);
    sun.color.set(i ? 0xffb37a : 0xfff0dc); sun.intensity = i ? 2.6 : 3.1;
    hemi.intensity = i ? 0.12 : 0.25;
  }
  setSky(0);

  // ---------------------------------------------------------------- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const surf = (set, color, extra = {}) => std({ ...set, color, ...extra });
  const M = {
    brick: [surf(BRICK, 0xffffff), surf(BRICK, 0xc89c86), surf(BRICK, 0x9a7262), surf(BRICK, 0xe8cdb8), surf(BRICK, 0x8d6a5c)],
    stone: [surf(CONC, 0xe6dbc2), surf(CONC, 0xcdbfa6), surf(CONC, 0xb9b3a8)],
    asphalt: surf(ASPH, 0x9a9a9a),
    pave: surf(CONC, 0xd2cec6),
    kerb: surf(ROCK, 0x9d9a94),
    roof: surf(CONC, 0x6f6a64, { roughness: 1 }),
    tank: surf(ROCK, 0x7a5638),
    bark: surf(ROCK, 0x5a4a3c),
    trimLight: std({ color: 0xe9e3d6, roughness: 0.6 }),
    trimDark: std({ color: 0x2a2724, roughness: 0.55, metalness: 0.2 }),
    trimGreen: std({ color: 0x26392f, roughness: 0.5, metalness: 0.3 }),
    sill: surf(CONC, 0xe0d6c4),
    glass: [std({ color: 0x27323e, roughness: 0.06, metalness: 0.9 }), std({ color: 0x3a3f44, roughness: 0.12, metalness: 0.8 }),
            std({ color: 0xa89878, roughness: 0.7, metalness: 0.1 }), std({ color: 0x1c2229, roughness: 0.04, metalness: 0.95 })],
    shopGlass: std({ color: 0x1e2830, roughness: 0.05, metalness: 0.85 }),
    iron: std({ color: 0x1b1b1c, roughness: 0.55, metalness: 0.6 }),
    pole: std({ color: 0x3c4042, roughness: 0.45, metalness: 0.7 }),
    paint: std({ color: 0xe9e8e2, roughness: 0.85 }),
    soil: std({ color: 0x3b2e25, roughness: 1 }),
    door: std({ color: 0x3a2618, roughness: 0.6 }),
    awn: [std({ color: 0x1f4d36, roughness: 0.9 }), std({ color: 0x7c1f24, roughness: 0.9 }), std({ color: 0x1d2a4a, roughness: 0.9 }), std({ color: 0x2a2a2a, roughness: 0.9 })],
    sign: [std({ color: 0xd9c9a3, roughness: 0.5 }), std({ color: 0x1b1b1b, roughness: 0.4 }), std({ color: 0x8c2b1f, roughness: 0.5 }), std({ color: 0x24445e, roughness: 0.5 })],
    lampLens: new THREE.MeshBasicMaterial({ color: 0xfff1cf }),
    hydrant: std({ color: 0xb8241c, roughness: 0.5 }),
  };

  // ---------------------------------------------------------------- static batching
  const bins = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();
  const mat4 = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(sx, sy, sz)).clone();
  function put(geo, mat, m4, cast = true, recv = true) {
    const g = geo.clone(); if (m4) g.applyMatrix4(m4);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    const key = mat.uuid + (g.index ? "i" : "n") + (cast ? "c" : "") + (recv ? "r" : "");
    if (!bins.has(key)) bins.set(key, { mat, cast, recv, list: [] });
    bins.get(key).list.push(g);
  }
  function flush() {
    for (const b of bins.values()) {
      for (let i = 0; i < b.list.length; i += 4000) {
        const g = mergeGeometries(b.list.slice(i, i + 4000), false);
        const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
        mesh.matrixAutoUpdate = false; scene.add(mesh);
      }
    }
    bins.clear();
  }
  // a box whose UVs are in metres / tile, so one tiling material fits any size
  function box(w, h, d, tile = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile) {
      const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
      }
    }
    return g;
  }
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const UNITP = new THREE.PlaneGeometry(1, 1);
  const putBox = (mat, x, y, z, w, h, d, ry = 0, cast = true, rx = 0, rz = 0) => put(UNIT, mat, mat4(x, y, z, ry, rx, rz, w, h, d), cast);

  // ---------------------------------------------------------------- layout
  const PAVE = 0.15, KERB_Z = 6, FRONT_Z = 13.5;
  const XC = [-440, -290, -140, 10, 160, 310, 460];          // cross street centres
  const ZB = [[6, 62], [74, 150]];                              // block z ranges on the +z side (mirrored for -z)
  // the city floor is asphalt; every block is a raised concrete slab with a granite kerb
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), M.asphalt);
  { const uv = ground.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1000, uv.getY(i) * 1000); }
  ground.rotation.x = -PI / 2; ground.receiveShadow = true; scene.add(ground);
  const blocks = [];
  for (let i = -1; i < XC.length; i++) {
    const xa = i < 0 ? -900 : XC[i] + 6, xb = i + 1 >= XC.length ? 900 : XC[i + 1] - 6;
    for (const sz of [1, -1]) for (const [za, zb] of ZB) {
      const z0 = sz > 0 ? za : -zb, z1 = sz > 0 ? zb : -za;
      put(box(xb - xa, PAVE, z1 - z0, 2.2), M.pave, mat4((xa + xb) / 2, PAVE / 2, (z0 + z1) / 2), false);
      // kerb stones along the edges near the action
      if (Math.abs(xa + xb) < 1400) {
        for (const zk of [z0 + 0.14, z1 - 0.14]) put(box(xb - xa, PAVE + 0.012, 0.3, 1.2), M.kerb, mat4((xa + xb) / 2, (PAVE + 0.012) / 2, zk), false);
        for (const xk of [xa + 0.14, xb - 0.14]) put(box(0.3, PAVE + 0.012, z1 - z0, 1.2), M.kerb, mat4(xk, (PAVE + 0.012) / 2, (z0 + z1) / 2), false);
      }
      blocks.push({ xa, xb, z0, z1, sz, inner: za === 6 });
    }
  }
  // pavement joints on the main street near the action
  for (const sz of [1, -1]) for (let x = -200; x < 220; x += 1.6) {
    if (XC.some((c) => Math.abs(x - c) < 6.2)) continue;
    put(UNITP, M.trimDark, mat4(x, PAVE + 0.002, sz * 9.75, 0, -PI / 2, 0, 0.025, 7.4, 1), false);
  }

  // ---------------------------------------------------------------- buildings
  const FL = 3.3, GF = 4.4;
  let o_far = false;
  function windowsOnFace(o, t, n, L, floors, opts) {
    if (o_far) return { cols: 1, pitch: L, at: () => new V3(), ang: 0 };
    // o: bottom-left corner on the face (Vector3), t: unit along the face, n: outward normal
    const ang = Math.atan2(n.x, n.z);
    const cols = Math.max(1, Math.floor(L / opts.pitch));
    const pitch = L / cols;
    const gl = pick(M.glass);
    const at = (u, y, off) => new V3(o.x + t.x * u + n.x * off, o.y + y, o.z + t.z * u + n.z * off);
    for (let f = 0; f < floors; f++) {
      const y = GF + f * FL + 1.55;
      for (let c = 0; c < cols; c++) {
        if (opts.skip && opts.skip((c + 0.5) * pitch)) continue;
        const p = at((c + 0.5) * pitch, y, 0);
        const ww = opts.ww, wh = opts.wh;
        put(UNIT, opts.frame, mat4(p.x + n.x * 0.04, p.y, p.z + n.z * 0.04, ang, 0, 0, ww + 0.18, wh + 0.18, 0.08), false);
        const g = rnd() < 0.22 ? pick(M.glass) : gl;
        put(UNITP, g, mat4(p.x + n.x * 0.085, p.y, p.z + n.z * 0.085, ang, 0, 0, ww, wh, 1), false, false);
        if (opts.detail) {
          put(UNIT, opts.frame, mat4(p.x + n.x * 0.1, p.y + 0.12, p.z + n.z * 0.1, ang, 0, 0, ww, 0.06, 0.04), false);
          put(UNIT, M.sill, mat4(p.x + n.x * 0.1, p.y - wh / 2 - 0.14, p.z + n.z * 0.1, ang, 0, 0, ww + 0.34, 0.12, 0.2), false);
          put(UNIT, opts.lintel, mat4(p.x + n.x * 0.06, p.y + wh / 2 + 0.2, p.z + n.z * 0.06, ang, 0, 0, ww + 0.3, 0.22, 0.12), false);
        }
      }
    }
    return { cols, pitch, at, ang };
  }
  function fireEscape(face, floors, colA) {
    const { at, ang, pitch } = face, w = pitch * 2 - 0.4, u0 = (colA + 1) * pitch;
    for (let f = 0; f < floors; f++) {
      const y = GF + f * FL - 0.05;
      const p = at(u0, y, 0.62);
      put(UNIT, M.iron, mat4(p.x, p.y, p.z, ang, 0, 0, w, 0.05, 1.2));
      const top = at(u0, y + 1.0, 1.2);
      put(UNIT, M.iron, mat4(top.x, top.y, top.z, ang, 0, 0, w, 0.04, 0.04));
      for (let k = 0; k <= Math.floor(w / 0.35); k++) {
        const b = at(u0 - w / 2 + k * (w / Math.floor(w / 0.35)), y + 0.5, 1.2);
        put(UNIT, M.iron, mat4(b.x, b.y, b.z, ang, 0, 0, 0.022, 1.0, 0.022), true);
      }
      // stair down to the floor below
      if (f > 0) {
        const s = at(u0 + (f % 2 ? 0.6 : -0.6) * (w / 2 - 0.5), y - FL / 2, 0.62);
        put(UNIT, M.iron, mat4(s.x, s.y, s.z, ang, 0, (f % 2 ? 1 : -1) * 0.95, 0.5, 4.0, 0.05));
      }
    }
  }
  function storefront(face, L, H, frameMat) {
    const { at, ang } = face;
    const bays = Math.max(1, Math.round(L / 4.6)), bw = L / bays;
    const awn = pick(M.awn), sign = pick(M.sign);
    for (let b = 0; b < bays; b++) {
      const u = (b + 0.5) * bw;
      const door = b === Math.floor(bays / 2) && rnd() < 0.7;
      const p = at(u, 1.75, 0.05);
      put(UNIT, frameMat, mat4(p.x, p.y, p.z, ang, 0, 0, bw - 0.3, 3.1, 0.1), false);
      const gp = at(u, door ? 1.85 : 1.9, 0.105);
      put(UNITP, door ? M.door : M.shopGlass, mat4(gp.x, gp.y, gp.z, ang, 0, 0, door ? 1.3 : bw - 0.6, door ? 2.6 : 2.7, 1), false, false);
      if (door) { const d2 = at(u, 0.04, 0.5); put(UNIT, M.sill, mat4(d2.x, PAVE + 0.04, d2.z, ang, 0, 0, 1.8, 0.08, 0.6), false); }
      const sp = at(u, 3.65, 0.1);
      put(UNIT, sign, mat4(sp.x, sp.y, sp.z, ang, 0, 0, bw - 0.2, 0.7, 0.14), false);
    }
    if (rnd() < 0.55) {
      const ap = at(L / 2, 3.05, 0.65);
      put(UNIT, awn, mat4(ap.x, ap.y, ap.z, ang, 0.38, 0, L - 0.6, 0.04, 1.35));
    }
  }
  function rooftop(x0, x1, z0, z1, H, big) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = Math.abs(z1 - z0);
    put(box(w - 0.1, 0.12, d - 0.1, 3), M.roof, mat4(cx, H + 0.06, cz), false);
    // parapet
    for (const zz of [Math.min(z0, z1) + 0.12, Math.max(z0, z1) - 0.12]) put(UNIT, M.trimDark, mat4(cx, H + 0.45, zz, 0, 0, 0, w, 0.8, 0.24));
    for (const xx of [x0 + 0.12, x1 - 0.12]) put(UNIT, M.trimDark, mat4(xx, H + 0.45, cz, 0, 0, 0, 0.24, 0.8, d));
    if (rnd() < (big ? 0.45 : 0.3) && w > 8) {
      const tx = rr(x0 + 3, x1 - 3), tz = cz + rr(-d / 4, d / 4), r = rr(1.6, 2.2), th = rr(3.2, 4.2), lh = rr(2.4, 3.4);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(UNIT, M.iron, mat4(tx + lx * r * 0.62, H + lh / 2, tz + lz * r * 0.62, 0, 0, 0, 0.14, lh, 0.14));
      put(UNIT, M.iron, mat4(tx, H + lh, tz, 0, 0, 0, r * 1.9, 0.12, r * 1.9));
      put(new THREE.CylinderGeometry(r, r, th, 18), M.tank, mat4(tx, H + lh + th / 2 + 0.06, tz));
      for (let k = 0; k < 3; k++) put(new THREE.TorusGeometry(r + 0.02, 0.03, 4, 24), M.iron, mat4(tx, H + lh + 0.6 + k * (th - 1.2) / 2, tz, 0, PI / 2));
      put(new THREE.ConeGeometry(r + 0.1, 1.3, 18), M.tank, mat4(tx, H + lh + th + 0.65, tz));
    }
    if (rnd() < 0.7) { const bx = rr(x0 + 2, x1 - 2), bz = cz + rr(-d / 3, d / 3); put(box(3, 2.6, 3.4, 2.2), pick(M.brick), mat4(bx, H + 1.3, bz)); }
    for (let k = 0; k < Math.floor(rr(0, 4)); k++) put(UNIT, M.trimLight, mat4(rr(x0 + 1.5, x1 - 1.5), H + 0.6, cz + rr(-d / 3, d / 3), 0, 0, 0, 1.6, 1.0, 1.1));
  }
  function building(x0, x1, zFace, zBack, floors, o) {
    const w = x1 - x0, d = Math.abs(zBack - zFace), sz = Math.sign(zFace - zBack); // sz: +1 face looks south
    const stone = o.stone, wall = stone ? pick(M.stone) : pick(M.brick);
    const H = PAVE + GF + floors * FL + 0.5;
    put(box(w, H - PAVE, d, stone ? 2.6 : 1.9), wall, mat4((x0 + x1) / 2, PAVE + (H - PAVE) / 2, (zFace + zBack) / 2));
    const frame = stone ? (rnd() < 0.5 ? M.trimDark : M.trimGreen) : (rnd() < 0.6 ? M.trimLight : M.trimDark);
    const lintel = stone ? wall : M.sill;
    const pitch = stone ? rr(2.2, 2.7) : rr(2.4, 3.0);
    const wopt = { pitch, ww: stone ? 1.2 : rr(1.0, 1.25), wh: rr(1.7, 2.0), frame, lintel, detail: o.detail };
    // front
    const n = new V3(0, 0, sz), t = new V3(-sz, 0, 0);
    const o0 = new V3(sz > 0 ? x1 : x0, PAVE, zFace);
    const face = windowsOnFace(o0, t, n, w, floors, wopt);
    // cornice and ground floor band
    put(UNIT, stone ? M.sill : M.trimLight, mat4((x0 + x1) / 2, H - 0.45, zFace + sz * 0.3, 0, 0, 0, w + 0.3, 0.6, 0.6));
    put(UNIT, stone ? M.sill : lintel, mat4((x0 + x1) / 2, PAVE + GF - 0.25, zFace + sz * 0.12, 0, 0, 0, w, 0.45, 0.24));
    if (o.shop && !o_far) storefront(face, w, H, rnd() < 0.5 ? M.trimDark : M.trimGreen);
    else if (!o_far) {
      // ground floor: a row of windows and an entrance
      const g = { ...wopt, detail: false };
      windowsOnFace(new V3(o0.x, PAVE - 3.7, o0.z), t, n, w, 1, { ...g, skip: (u) => Math.abs(u - w / 2) < 1.6 });
      const dp = face.at(w / 2, 1.3, 0.06);
      put(UNIT, M.door, mat4(dp.x, PAVE + 1.25, dp.z, face.ang, 0, 0, 1.4, 2.5, 0.12), false);
    }
    if (!o_far && !stone && o.escape && floors >= 3 && face.cols >= 3) fireEscape(face, floors, Math.floor(rr(0, face.cols - 2)));
    // side faces where they look onto a cross street
    for (const side of o.sides || []) {
      const ns = new V3(side, 0, 0), ts = new V3(0, 0, side * sz);
      const os = new V3(side > 0 ? x1 : x0, PAVE, side > 0 ? zFace - sz * 0 : zFace);
      // start the side run at the face corner going back
      const oo = new V3(os.x, PAVE, side > 0 ? zBack : zFace);
      const tt = side > 0 ? new V3(0, 0, sz) : new V3(0, 0, -sz);
      windowsOnFace(side > 0 ? oo : os, side > 0 ? tt : tt, ns, d, floors, { ...wopt, detail: false });
      void ts;
    }
    rooftop(x0, x1, zFace, zBack, H, floors > 6);
    return H;
  }
  // rows of buildings in every block
  for (const b of blocks) {
    const near = Math.abs((b.xa + b.xb) / 2) < 700, far = Math.abs((b.xa + b.xb) / 2) > 600;
    if (!near) continue;
    let x = b.xa + 4;
    const xEnd = b.xb - 4;
    const faceIn = b.sz > 0 ? b.z0 + 7.5 : b.z1 - 7.5;         // face onto the street at the block's inner edge
    const faceOut = b.sz > 0 ? b.z1 - 7.5 : b.z0 + 7.5;        // face onto the street at its outer edge
    const main = b.inner;
    while (x < xEnd - 1) {
      let w = rr(8, 21); if (xEnd - (x + w) < 8) w = xEnd - x;
      const x0 = x, x1 = x + w; x = x1;
      const first = x0 <= b.xa + 4.01, last = x1 >= xEnd - 0.01;
      const sides = [...(first ? [-1] : []), ...(last ? [1] : [])];
      const mid = Math.abs((x0 + x1) / 2) < 260; o_far = far;
      if (main) {
        const depth = rr(15, 24), split = faceIn + b.sz * depth;
        const fl = rnd() < 0.08 ? Math.floor(rr(9, 13)) : Math.floor(rr(3, 7.99));
        building(x0, x1, faceIn, split, fl, { stone: rnd() < 0.3, shop: rnd() < 0.65, escape: rnd() < 0.55, detail: mid, sides });
        const fb = Math.floor(rr(4, 11.99));
        building(x0, x1, faceOut, split, fb, { stone: rnd() < 0.35, shop: false, escape: rnd() < 0.4, detail: false, sides });
      } else {
        const fl = rnd() < 0.18 ? Math.floor(rr(18, 34)) : Math.floor(rr(5, 14));
        building(x0, x1, faceIn, faceOut, fl, { stone: fl > 15 || rnd() < 0.4, shop: false, escape: false, detail: false, sides });
      }
    }
  }

  // ---------------------------------------------------------------- road markings
  const mark = (x, z, w, d, ry = 0) => put(UNITP, M.paint, mat4(x, 0.012, z, ry, -PI / 2, 0, w, d, 1), false);
  for (const xc of XC) {
    // crosswalks across the main street (both sides of each intersection) and across the cross street (both sides)
    for (const xs of [xc - 8, xc + 8]) for (let k = 0; k < 11; k++) mark(xs, -5.25 + k * 1.05, 3.2, 0.55);
    for (const zs of [9, -9]) for (let k = 0; k < 11; k++) mark(xc - 5.25 + k * 1.05, zs, 0.55, 3.2);
    mark(xc - 10.6, 0, 0.4, 11.6);                                  // stop line for eastbound traffic
    // parking lane lines between intersections
  }
  for (let x = -600; x < 600; x += 6) { if (XC.some((c) => Math.abs(x - c) < 12)) continue; for (const zz of [3.55, -3.55]) mark(x, zz, 3.0, 0.12); }

  // ---------------------------------------------------------------- street lamps, trees, hydrant, signals
  const lampGeo = (() => {
    const curve = new THREE.QuadraticBezierCurve3(new V3(0, 6.8, 0), new V3(0, 8.1, 0), new V3(0, 8.0, -2.2));
    return { pole: new THREE.CylinderGeometry(0.075, 0.13, 7.0, 12), arm: new THREE.TubeGeometry(curve, 16, 0.06, 8), head: new THREE.CylinderGeometry(0.22, 0.32, 0.9, 12) };
  })();
  const lampXs = [];
  for (let x = -420; x < 440; x += 32) {
    for (const sz of [1, -1]) {
      const lx = x + (sz > 0 ? 0 : 16), z = sz * 6.45;
      if (XC.some((c) => Math.abs(lx - c) < 12)) continue;
      lampXs.push(lx);
      const ry = sz > 0 ? 0 : PI;
      put(lampGeo.pole, M.pole, mat4(lx, PAVE + 3.5, z));
      put(UNIT, M.pole, mat4(lx, PAVE + 0.25, z, 0, 0, 0, 0.36, 0.5, 0.36));
      put(lampGeo.arm, M.pole, mat4(lx, PAVE, z, ry));
      put(lampGeo.head, M.pole, mat4(lx, PAVE + 8.0, z - sz * 2.4, ry, PI / 2, 0, 1, 1, 0.5));
      put(UNITP, M.lampLens, mat4(lx, PAVE + 7.82, z - sz * 2.4, ry, PI / 2, 0, 0.3, 0.7, 1), false, false);
    }
  }
  // signals at Sam's intersection (and plainer ones at the others)
  const canvasTex = (w, h, fn) => { const c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const handTex = canvasTex(128, 128, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#ff7a1a";
    g.beginPath(); g.roundRect(40, 58, 50, 48, 12); g.fill();
    for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(40 + i * 13, 24 + (i === 0 || i === 3 ? 8 : 0), 10, 44, 5); g.fill(); }
    g.beginPath(); g.roundRect(84, 58, 24, 10, 5); g.fill();
  });
  const walkTex = canvasTex(128, 128, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#f2f6ff"; g.strokeStyle = "#f2f6ff"; g.lineCap = "round";
    g.beginPath(); g.arc(66, 22, 10, 0, 7); g.fill();
    g.lineWidth = 13; g.beginPath(); g.moveTo(64, 38); g.lineTo(58, 76); g.stroke();
    g.lineWidth = 10; g.beginPath(); g.moveTo(58, 76); g.lineTo(44, 110); g.moveTo(58, 76); g.lineTo(78, 108); g.moveTo(63, 44); g.lineTo(44, 66); g.moveTo(63, 44); g.lineTo(84, 64); g.stroke();
  });
  const pedHand = new THREE.MeshBasicMaterial({ map: handTex, toneMapped: false });
  const pedWalk = new THREE.MeshBasicMaterial({ map: walkTex, toneMapped: false });
  const lens = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  const LIGHT = { red: lens(0xff2a1a), amber: lens(0x332200), green: lens(0x0a3320), redOff: 0x3a0806, redOn: 0xff2a1a, greenOn: 0x2dff9a, greenOff: 0x07261a };
  const housing = std({ color: 0x2b2d22, roughness: 0.5, metalness: 0.4 });
  const signalHeads = [];
  const disc = new THREE.CircleGeometry(0.1, 16);
  function signalPole(x, z, carFace, pedFaces) {
    put(new THREE.CylinderGeometry(0.1, 0.13, 5.2, 12), M.pole, mat4(x, PAVE + 2.6, z));
    if (carFace !== null) {
      const ang = carFace, hx = x + Math.sin(ang) * 0.22, hz = z + Math.cos(ang) * 0.22;
      put(UNIT, housing, mat4(hx, PAVE + 4.3, hz, ang, 0, 0, 0.36, 1.05, 0.3));
      const cols = [LIGHT.red, LIGHT.amber, LIGHT.green];
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(disc, cols[k]); m.position.set(x + Math.sin(ang) * 0.38, PAVE + 4.62 - k * 0.32, z + Math.cos(ang) * 0.38); m.rotation.y = ang; scene.add(m);
      }
    }
    pedFaces.forEach((ang, k) => {
      const hy = PAVE + 2.95 - k * 0.55;
      const hx = x + Math.sin(ang) * 0.24, hz = z + Math.cos(ang) * 0.24;
      put(UNIT, housing, mat4(hx, hy, hz, ang, 0, 0, 0.42, 0.42, 0.24));
      const hand = new THREE.Mesh(UNITP, pedHand); hand.scale.set(0.34, 0.34, 1);
      hand.position.set(x + Math.sin(ang) * 0.365, hy, z + Math.cos(ang) * 0.365); hand.rotation.y = ang; scene.add(hand);
      const walk = hand.clone(); walk.material = pedWalk; walk.visible = false; scene.add(walk);
      signalHeads.push({ hand, walk, crossesCross: Math.abs(Math.sin(ang)) > 0.5 });
    });
  }
  for (const xc of XC) {
    const W = xc - 6.6, E = xc + 6.6;
    signalPole(E, 6.7, -PI / 2, [-PI / 2, 0]);      // near-east corner: car head faces west; ped heads face west and south
    signalPole(W, 6.7, null, [PI / 2, 0]);
    signalPole(E, -6.7, -PI / 2, [-PI / 2, PI]);
    signalPole(W, -6.7, null, [PI / 2, PI]);
  }
  const signalPos = new V3(XC[3] + 6.6, PAVE + 2.95, 6.7);

  // hydrant near Sam's corner
  put(new THREE.CylinderGeometry(0.14, 0.16, 0.62, 14), M.hydrant, mat4(-5.5, PAVE + 0.31, 6.55));
  put(new THREE.SphereGeometry(0.15, 12, 8, 0, PI * 2, 0, PI / 2), M.hydrant, mat4(-5.5, PAVE + 0.62, 6.55));
  put(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), M.hydrant, mat4(-5.5, PAVE + 0.42, 6.55, 0, 0, PI / 2));

  // trees: a trunk and a crown of leaf cards, on the pavements; they bend east with the wind
  const leafTex = canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 240; i++) {
      const a = rnd() * PI * 2, r = Math.sqrt(rnd()) * 100, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      const l = 30 + rnd() * 30; g.fillStyle = `hsl(${88 + rnd() * 30},${38 + rnd() * 20}%,${l * 0.55}%)`;
      g.save(); g.translate(x, y); g.rotate(rnd() * 7); g.beginPath(); g.ellipse(0, 0, 9, 4.5, 0, 0, 7); g.fill(); g.restore();
    }
  });
  const crownMat = std({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.17, 3.6, 10); trunkGeo.translate(0, 1.8, 0);
  const branchGeo = new THREE.CylinderGeometry(0.035, 0.07, 1.8, 6);
  const crownGeos = [0, 1, 2].map(() => {
    const parts = [];
    for (let i = 0; i < 70; i++) {
      const g = new THREE.PlaneGeometry(1.5, 1.5);
      const a = rnd() * PI * 2, r = Math.sqrt(rnd()) * 1.9, y = rr(-1.2, 1.6) * (1 - r / 3.5);
      g.applyMatrix4(mat4(Math.cos(a) * r, y + 1.3, Math.sin(a) * r, rnd() * PI, rr(-1, 1), rr(-1, 1)));
      parts.push(g);
    }
    for (let i = 0; i < 5; i++) { const g = branchGeo.clone(); g.applyMatrix4(mat4(0, 0.5, 0, rnd() * 7, rr(0.5, 0.9), 0)); parts.push(g); }
    return mergeGeometries(parts.map((g) => { const h = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(h.attributes)) if (!["position", "normal", "uv"].includes(k)) h.deleteAttribute(k); return h; }), false);
  });
  const trees = [];
  for (const sz of [1, -1]) for (let x = -330; x < 340; x += rr(8, 11)) {
    if (XC.some((c) => Math.abs(x - c) < 13)) continue;
    if (lampXs.some((l) => Math.abs(l - x) < 2.2)) continue;
    if (sz > 0 && x > -9 && x < 4) continue;                // keep Sam's corner open
    const z = sz * 7.35;
    put(UNIT, M.soil, mat4(x, PAVE + 0.006, z, 0, 0, 0, 1.3, 0.012, 1.3), false);
    put(UNIT, M.iron, mat4(x, PAVE + 0.2, z + 0.66, 0, 0, 0, 1.36, 0.04, 0.03)); put(UNIT, M.iron, mat4(x, PAVE + 0.2, z - 0.66, 0, 0, 0, 1.36, 0.04, 0.03));
    const tree = new THREE.Group(); tree.position.set(x, PAVE, z);
    const trunk = new THREE.Mesh(trunkGeo, M.bark); trunk.castShadow = true;
    const pivot = new THREE.Group(); pivot.position.y = 3.4;
    const crown = new THREE.Mesh(crownGeos[trees.length % 3], crownMat); crown.castShadow = true; crown.receiveShadow = true;
    const s = rr(0.85, 1.2); crown.scale.set(s, s * rr(0.9, 1.15), s); crown.rotation.y = rnd() * 7;
    pivot.add(crown); tree.add(trunk, pivot); scene.add(tree);
    trees.push({ tree, trunk, pivot, phase: rnd() * 7 });
  }

  // ---------------------------------------------------------------- cars
  function carGeoms(type) {
    const H = type === "suv" ? 1.18 : 1, R = type === "suv" ? 0.37 : 0.33, L = type === "suv" ? 2.35 : 2.3;
    const y = (v) => 0.3 + (v - 0.3) * H;
    const s = new THREE.Shape();
    s.moveTo(-L, y(0.32)); s.lineTo(-1.88, y(0.32));
    s.absarc(-1.42, 0.34, R + 0.08, PI, 0, true); s.lineTo(1.0, y(0.32));
    s.absarc(1.42, 0.34, R + 0.08, PI, 0, true); s.lineTo(L - 0.05, y(0.32));
    s.quadraticCurveTo(L + 0.08, y(0.34), L + 0.06, y(0.62)); s.lineTo(L - 0.1, y(0.84));
    s.lineTo(0.95, y(0.96)); s.lineTo(-1.7, y(0.99)); s.lineTo(-L + 0.05, y(0.93));
    s.quadraticCurveTo(-L - 0.06, y(0.86), -L - 0.04, y(0.6)); s.lineTo(-L, y(0.32));
    const body = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 });
    body.translate(0, 0, -0.85);
    const gsh = new THREE.Shape(), rb = type === "suv" ? -2.0 : -1.62;
    gsh.moveTo(rb, y(0.96)); gsh.lineTo(type === "suv" ? -1.9 : -0.98, y(1.4)); gsh.lineTo(0.38, y(1.42)); gsh.lineTo(1.05, y(0.96)); gsh.lineTo(rb, y(0.96));
    const glass = new THREE.ExtrudeGeometry(gsh, { depth: 1.46, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
    glass.translate(0, 0, -0.73);
    const roofL = (0.3 - (type === "suv" ? -1.95 : -0.92));
    const roof = new THREE.BoxGeometry(roofL, 0.07, 1.48); roof.translate((0.3 + (type === "suv" ? -1.95 : -0.92)) / 2, y(1.42) + 0.04, 0);
    const tires = [], rims = [], fl = [], rl = [], bump = [];
    for (const [wx, wz] of [[-1.42, -0.8], [-1.42, 0.8], [1.42, -0.8], [1.42, 0.8]]) {
      const t = new THREE.CylinderGeometry(R, R, 0.24, 20); t.rotateX(PI / 2); t.translate(wx, R, wz); tires.push(t);
      const r = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.25, 14); r.rotateX(PI / 2); r.translate(wx, R, wz); rims.push(r);
    }
    for (const sz of [-0.62, 0.62]) {
      const f = new THREE.BoxGeometry(0.06, 0.12, 0.34); f.translate(L + 0.07, y(0.7), sz); fl.push(f);
      const b = new THREE.BoxGeometry(0.06, 0.12, 0.34); b.translate(-L - 0.08, y(0.76), sz); rl.push(b);
    }
    for (const bx of [L + 0.06, -L - 0.06]) { const b = new THREE.BoxGeometry(0.14, 0.16, 1.82); b.translate(bx, y(0.42), 0); bump.push(b); }
    return { body, glass, roof, tires: mergeGeometries(tires), rims: mergeGeometries(rims), front: mergeGeometries(fl), rear: mergeGeometries(rl), bump: mergeGeometries(bump), R };
  }
  const CG = { sedan: carGeoms("sedan"), suv: carGeoms("suv") };
  const paints = [0x1d1f22, 0xd8d9db, 0x8a8f96, 0x22344f, 0x6d1a1c, 0x3a3f36, 0xe9e7e2, 0x4b5358].map((c) => std({ color: c, roughness: 0.28, metalness: 0.65 }));
  const taxiPaint = std({ color: 0xf3b707, roughness: 0.3, metalness: 0.45 });
  const carGlass = std({ color: 0x141a20, roughness: 0.05, metalness: 0.9 });
  const rubber = std({ color: 0x121212, roughness: 0.9 });
  const chrome = std({ color: 0xb8bcc0, roughness: 0.25, metalness: 1 });
  const plastic = std({ color: 0x1a1a1a, roughness: 0.7 });
  const headL = new THREE.MeshBasicMaterial({ color: 0xf4f1e6 }), tailL = std({ color: 0x8a0d0d, emissive: 0x5a0000, roughness: 0.3 });
  const signTaxi = std({ color: 0xf6f3e8, emissive: 0x332a10, roughness: 0.4 });
  function makeCar(type, paint, taxi) {
    const g = CG[type], car = new THREE.Group();
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; car.add(m); return m; };
    add(g.body, paint); add(g.glass, carGlass); add(g.roof, paint); add(g.bump, plastic); add(g.front, headL); add(g.rear, tailL);
    const wheels = new THREE.Group(); wheels.add(new THREE.Mesh(g.tires, rubber), new THREE.Mesh(g.rims, chrome)); wheels.children.forEach((m) => (m.castShadow = true)); car.add(wheels);
    if (taxi) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.26, 0.3), signTaxi); s.position.set(-0.3, 1.58, 0); s.castShadow = true; car.add(s); }
    car.userData = { R: g.R, wheels };
    return car;
  }
  const parked = [];
  for (const sz of [1, -1]) {
    let x = -400;
    while (x < 400) {
      const L = 4.9;
      const nearCorner = XC.some((c) => x + L > c - 15 && x < c + 13) || (sz > 0 && x > -9 && x < -2);
      if (!nearCorner && rnd() < 0.86) {
        const type = rnd() < 0.3 ? "suv" : "sedan", taxi = rnd() < 0.1;
        const car = makeCar(type, taxi ? taxiPaint : pick(paints), taxi);
        car.position.set(x + L / 2, 0, sz * 4.85); car.rotation.y = rr(-0.015, 0.015);
        car.userData.base = car.position.clone(); car.userData.k = rr(0.75, 1.05); car.userData.ph = rnd() * 7;
        scene.add(car); parked.push(car);
      }
      x += L + rr(0.8, 2.4);
    }
  }
  // a few cars on the other streets, for the views from above
  for (const xc of XC) for (let k = 0; k < 6; k++) {
    const z = rr(16, 130) * (rnd() < 0.5 ? 1 : -1);
    if (Math.abs(Math.abs(z) - 68) < 8) continue;
    const car = makeCar(rnd() < 0.3 ? "suv" : "sedan", pick(paints), rnd() < 0.2); car.position.set(xc + 4.85 * (rnd() < 0.5 ? 1 : -1), 0, z); car.rotation.y = PI / 2; scene.add(car);
  }
  for (const zs of [68, -68]) for (let k = 0; k < 40; k++) {
    const x = rr(-430, 430); if (XC.some((c) => Math.abs(x - c) < 14)) continue;
    const car = makeCar(rnd() < 0.3 ? "suv" : "sedan", pick(paints), rnd() < 0.15); car.position.set(x, 0, zs + (rnd() < 0.5 ? 4.85 : -4.85)); scene.add(car);
  }
  const movingCar = makeCar("sedan", taxiPaint, true); movingCar.position.set(-2000, 0, 0.6); scene.add(movingCar);

  // litter baskets by the corners
  const binMat = std({ color: 0x2f4a3a, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  const binGeo = new THREE.CylinderGeometry(0.33, 0.27, 0.86, 16, 1, true);
  const bins2 = [];
  for (const [bx, bz] of [[-3.2, 6.75], [18.4, 6.75], [-3.8, -6.75], [18.8, -6.75], [-38, 6.75], [-60, -6.75], [44, 6.75]]) {
    const b = new THREE.Group(); const c = new THREE.Mesh(binGeo, binMat); c.position.y = 0.43; c.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 20), binMat); rim.rotation.x = PI / 2; rim.position.y = 0.86;
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), std({ color: 0x111111, roughness: 0.35 })); bag.position.y = 0.7; bag.scale.y = 0.6;
    b.add(c, rim, bag); b.position.set(bx, PAVE, bz); scene.add(b); bins2.push({ b, base: b.position.clone() });
  }

  flush();

  // ---------------------------------------------------------------- the cast (library characters; the first is Sam)
  const norm = (n) => (n || "").toLowerCase().replace(/^mixamorig/, "").replace(/[^a-z0-9]/g, "");
  function boneOf(root, names) {
    const want = names.map(norm); let hit = null, any = null;
    root.traverse((o) => { const n = norm(o.name); if (!want.includes(n)) return; if (o.isBone && !hit) hit = o; if (!any) any = o; });
    return hit || any;
  }
  const CAST = {}, GAIT = {}, MEMBERS = [];
  // how far each gait carries the body per second, from the feet, so a shot can move a figure without sliding
  function gaitSpeed(f, B, name, fallback) {
    if (!f.actions[name] || !B.leftFoot) return fallback;
    const o = f.object, T = f.durations[name]; let lo = 1e9, hi = -1e9;
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
    for (let i = 0; i <= 40; i++) { f.pose((i / 40) * T, name); o.updateMatrixWorld(true); const z = B.leftFoot.getWorldPosition(new V3()).z; lo = Math.min(lo, z); hi = Math.max(hi, z); }
    const v = (2 * (hi - lo)) / T;
    return v > 0.2 && v < 12 ? v : fallback;
  }
  FIGS.forEach((f, i) => {
    const o = f.object;
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
    scene.add(o);
    const B = {
      head: boneOf(o, ["Head"]), headTop: boneOf(o, ["HeadTop_End", "Head_end"]), neck: boneOf(o, ["Neck"]), hips: boneOf(o, ["Hips"]),
      rArm: boneOf(o, ["RightArm", "UpperArm.R"]), rFore: boneOf(o, ["RightForeArm", "LowerArm.R"]), rHand: boneOf(o, ["RightHand", "Hand.R"]),
      leftFoot: boneOf(o, ["LeftFoot", "Foot.L"]), rightFoot: boneOf(o, ["RightFoot", "Foot.R"]),
    };
    const g = { walk: gaitSpeed(f, B, "walk", 1.35), run: gaitSpeed(f, B, "run", 3.4) };
    f.pose(0, "idle");
    const id = cast[i];
    CAST[id] = f; GAIT[id] = g;
    MEMBERS.push({ id, f, B, g, i });
  });
  const LEAD = MEMBERS[0];
  const person = LEAD.f.object, B = LEAD.B;
  GAIT.walk = LEAD.g.walk; GAIT.run = LEAD.g.run;   // the old one-person names
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.148, 0.009), std({ color: 0x0d0e10, roughness: 0.25, metalness: 0.6 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.136), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, toneMapped: false }));
  screen.position.z = 0.0048; phone.add(screen); phone.castShadow = true; phone.visible = false; scene.add(phone);

  const _a = new V3(), _b = new V3(), _dq = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb2 = new THREE.Quaternion(), _qid = new THREE.Quaternion();
  function aim(bn, child, dir, w) {
    bn.getWorldPosition(_a); child.getWorldPosition(_b);
    const cur = _b.sub(_a).normalize();
    _qa.setFromUnitVectors(cur, dir); _dq.slerpQuaternions(_qid, _qa, w);
    bn.getWorldQuaternion(_qa); bn.parent.getWorldQuaternion(_qb2);
    bn.quaternion.copy(_qb2.invert().multiply(_dq.multiply(_qa)));
    bn.updateMatrixWorld(true);
  }
  function turn(bn, angle) {
    _dq.setFromAxisAngle(new V3(0, 1, 0), angle);
    bn.getWorldQuaternion(_qa); bn.parent.getWorldQuaternion(_qb2);
    bn.quaternion.copy(_qb2.invert().multiply(_dq.multiply(_qa))); bn.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- arrow, jet and contrail
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, -1.6); arrowShape.lineTo(52, -1.6); arrowShape.lineTo(52, -4.2); arrowShape.lineTo(66, 0); arrowShape.lineTo(52, 4.2); arrowShape.lineTo(52, 1.6); arrowShape.lineTo(0, 1.6); arrowShape.lineTo(0, -1.6);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffa93a, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, fog: false });
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), arrowMat); arrow.rotation.x = -PI / 2; arrow.position.set(-26, 0.06, 0); scene.add(arrow);
  const glowTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const arrowGlowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff9a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const arrowGlow = new THREE.Mesh(UNITP, arrowGlowMat); arrowGlow.rotation.x = -PI / 2; arrowGlow.scale.set(90, 22, 1); arrowGlow.position.set(7, 0.05, 0); scene.add(arrowGlow);

  const jet = new THREE.Group();
  { const jm = std({ color: 0xdfe3e8, roughness: 0.4, metalness: 0.5, fog: false });
    const f = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 38, 10), jm); f.rotation.z = PI / 2;
    const w = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 36), jm);
    jet.add(f, w); }
  scene.add(jet);
  const trailTex = canvasTex(256, 8, (g) => { const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,0.75)"); gr.addColorStop(0.97, "rgba(255,255,255,0.95)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 256, 8); });
  const trailMat = new THREE.MeshBasicMaterial({ map: trailTex, transparent: true, depthWrite: false, fog: false, color: 0xf2f5fa });
  const trailGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); trailGeo.rotateZ(-PI / 2);
  // cylinder UV v runs along its axis; swap so the gradient (u) runs along the trail
  { const uv = trailGeo.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); } }
  const trail = new THREE.Mesh(trailGeo, trailMat); scene.add(trail);
  const JET_Y = 1400, JET_Z = -700;

  // ---------------------------------------------------------------- wind-blown debris
  const NL = 1400, NLIT = 160;
  const leafGeo = new THREE.PlaneGeometry(0.11, 0.075); leafGeo.rotateX(-PI / 2);
  const leaves = new THREE.InstancedMesh(leafGeo, std({ side: THREE.DoubleSide, roughness: 0.8 }), NL);
  const litterGeo = new THREE.PlaneGeometry(0.26, 0.2); litterGeo.rotateX(-PI / 2);
  const litter = new THREE.InstancedMesh(litterGeo, std({ side: THREE.DoubleSide, roughness: 0.9 }), NLIT);
  const leafCols = [0x6b4a22, 0x8a5a24, 0xa8742c, 0x5c6a2a, 0x7d3a1c, 0x9c8a3a], litCols = [0xf1efe8, 0xd9d4c6, 0xc7b48e, 0xe8e2d0, 0x9fb7c9];
  const D = { leaf: [], lit: [] };
  const groundAt = (z) => (Math.abs(z) > KERB_Z ? PAVE : 0) + 0.006;
  function seedDebris(arr, n, mesh, cols) {
    for (let i = 0; i < n; i++) {
      let z; const r = rnd();
      if (r < 0.35) z = (rnd() < 0.5 ? 1 : -1) * rr(5.6, 6.0);                // gutters
      else if (r < 0.75) z = (rnd() < 0.5 ? 1 : -1) * rr(6.3, 13.2);         // pavements
      else z = rr(-5.5, 5.5);
      arr.push({ x: rr(-70, 70), z, sp: rr(9, 26), h: rnd(), yaw: rnd() * 7, spin: rr(4, 14), ph: rnd() * 7 });
      mesh.setColorAt(i, new THREE.Color(pick(cols)).multiplyScalar(rr(0.75, 1.1)));
    }
    mesh.instanceColor.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
  }
  seedDebris(D.leaf, NL, leaves, leafCols); seedDebris(D.lit, NLIT, litter, litCols);

  const dustTex = canvasTex(128, 128, (g) => {
    for (let i = 0; i < 26; i++) { const x = rr(28, 100), y = rr(28, 100), r = rr(14, 34); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  });
  const NW = 220;
  const wallMat = new THREE.MeshBasicMaterial({ map: dustTex, color: 0xcdb898, transparent: true, opacity: 0, depthWrite: false });
  const wall = new THREE.InstancedMesh(UNITP, wallMat, NW); wall.frustumCulled = false; scene.add(wall);
  const W = [];
  for (let i = 0; i < NW; i++) W.push({ x: rr(-130, 130), y: rr(0.5, 24), z: rr(-10, 10), s: rr(5, 16), sp: rr(28, 55), rot: rnd() * 7 });
  const NB = 260;
  const burstMat = new THREE.MeshBasicMaterial({ map: dustTex, color: 0xc9b493, transparent: true, opacity: 0, depthWrite: false });
  const burst = new THREE.InstancedMesh(UNITP, burstMat, NB); burst.frustumCulled = false; scene.add(burst);
  const BU = [];
  for (let i = 0; i < NB; i++) { const a = rnd() * 7, r = Math.sqrt(rnd()) * 1.6; BU.push({ dx: Math.cos(a) * r, dz: Math.sin(a) * r * 0.8, vx: rr(4, 16), vy: rr(0.4, 2.8), vz: rr(-0.8, 0.8), s: rr(0.15, 0.5), rot: rnd() * 7 }); }
  const NP = 2600, dustPos = new Float32Array(NP * 3), DP = [];
  for (let i = 0; i < NP; i++) DP.push({ x: rr(-60, 60), y: rnd(), z: rr(-13, 13), sp: rr(15, 40) });
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTex, color: 0xd8c4a0, size: 0.07, transparent: true, opacity: 0, depthWrite: false }));
  dustPts.frustumCulled = false; scene.add(dustPts);

  // ---------------------------------------------------------------- update
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const wrap = (v, c, half) => c + ((((v - c + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
  const _o = new THREE.Object3D(), _c = new V3();
  const spot = new V3(3.3, PAVE, 8.6);
  function update(st = {}) {
    const time = st.time || 0;
    // sky and sun
    const low = (st.sunLow || 0) >= 0.5 ? 1 : 0; setSky(low);
    const sd = SKY[low].light;
    // the cast: the first reads state.sam (the old keys) and state.people.<id>; the rest state.people.<id>
    const people = st.people || {};
    let sx = spot.x, szz = spot.z, phoneUsed = false;
    for (const m of MEMBERS) {
      const sam = m.i === 0 ? (st.sam || {}) : {};
      const p = people[m.id] || {};
      const pick = (k, d) => (p[k] !== undefined ? p[k] : sam[k] !== undefined ? sam[k] : d);
      const o = m.f.object;
      const x = pick("x", spot.x - 1.2 * m.i), z = pick("z", spot.z);
      if (m.i === 0) { sx = x; szz = z; }
      o.visible = pick("show", true) !== false;
      const gt = p.gait || {};
      const wk = clamp01(gt.walk ?? p.walk ?? sam.walk ?? 0), rn = clamp01(gt.run ?? p.run ?? sam.run ?? 0);
      m.f.pose(p.time ?? p.t ?? sam.t ?? time, { idle: Math.max(0, 1 - wk - rn), walk: wk, run: rn });
      o.position.set(x, PAVE + (pick("lift", 0) || 0), z);
      o.rotation.set(pick("tilt", 0) || 0, pick("heading", PI / 2), 0, "YXZ");
      o.updateMatrixWorld(true);
      const Bm = m.B, ph = clamp01(pick("phone", 0) || 0);
      if (ph > 0 && Bm.rArm && Bm.rFore && Bm.rHand && Bm.head && Bm.headTop) {
        const q = o.getWorldQuaternion(new THREE.Quaternion());
        aim(Bm.rArm, Bm.rFore, new V3(-0.18, -0.93, 0.32).normalize().applyQuaternion(q), ph);
        aim(Bm.rFore, Bm.rHand, new V3(0.42, 0.55, 0.72).normalize().applyQuaternion(q), ph);
        aim(Bm.head, Bm.headTop, new V3(0, 0.86, 0.5).normalize().applyQuaternion(q), ph * 0.9);
        if (!phoneUsed) {
          const hp = Bm.rHand.getWorldPosition(new V3()), fd = hp.clone().sub(Bm.rFore.getWorldPosition(new V3())).normalize();
          phone.position.copy(hp).addScaledVector(fd, 0.08).add(new V3(0, 0.02, 0));
          phone.lookAt(Bm.head.getWorldPosition(new V3()));
          phone.visible = ph > 0.5 && o.visible; phoneUsed = true;
        }
      }
      const lk = pick("look", 0);
      if (lk && Bm.head) turn(Bm.head, lk);
    }
    if (!phoneUsed) phone.visible = false;
    // moving car
    const c = st.car || {};
    movingCar.position.set(c.x ?? -2000, 0, c.z ?? 0.6);
    // signals
    const walkOn = (st.signal || 0) >= 0.5;
    for (const h of signalHeads) { const on = h.crossesCross ? walkOn : !walkOn; h.walk.visible = on; h.hand.visible = !on; }
    LIGHT.red.color.set(walkOn ? LIGHT.redOff : LIGHT.redOn); LIGHT.green.color.set(walkOn ? LIGHT.greenOn : LIGHT.greenOff);
    // wind: trees, debris, dust
    const wind = clamp01(st.wind || 0), wt = st.windTime || 0, lurch = st.lurch || 0;
    for (const t of trees) {
      const fl = Math.sin(time * 6 + t.phase) * 0.06 * wind + Math.sin(time * 1.3 + t.phase) * 0.015;
      const tr = wind * 0.3 - fl * 0.3;
      t.trunk.rotation.z = -tr; t.pivot.rotation.z = -wind * 1.05 + fl;
      t.pivot.position.set(Math.sin(tr) * 3.4, Math.cos(tr) * 3.4, 0);
    }
    const dcx = st.debrisX ?? sx;
    const lift = (i, d) => wind * (0.15 + d.h * d.h * 5.5) * clamp01(wt * 2.5 - d.h);
    const placeDebris = (arr, mesh) => {
      for (let i = 0; i < arr.length; i++) {
        const d = arr[i];
        const moved = wt * d.sp * (0.35 + 0.65 * wind) + lurch * 1.8 * (0.6 + d.h);
        const x = wrap(d.x + moved, dcx, 70);
        const air = moved > 0.001 ? lift(i, d) + Math.abs(Math.sin(wt * 3 + d.ph)) * 0.4 * wind : 0;
        _o.position.set(x, groundAt(d.z) + air, d.z + (moved > 0 ? Math.sin(wt * 2 + d.ph) * 0.6 * wind : 0));
        _o.rotation.set(air > 0.02 ? wt * d.spin : 0, d.yaw + wt * d.spin * 0.5, air > 0.02 ? wt * d.spin * 0.7 : 0);
        _o.scale.setScalar(1); _o.updateMatrix(); mesh.setMatrixAt(i, _o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    placeDebris(D.leaf, leaves); placeDebris(D.lit, litter);
    for (let i = 0; i < NP; i++) {
      const d = DP[i]; const x = wrap(d.x + wt * d.sp, dcx, 60);
      dustPos[i * 3] = x; dustPos[i * 3 + 1] = groundAt(d.z) + d.y * (0.3 + 5 * wind) * clamp01(wt * 3) + 0.02; dustPos[i * 3 + 2] = d.z;
    }
    dustGeo.attributes.position.needsUpdate = true; dustPts.material.opacity = wind * clamp01(wt * 3) * 0.75;
    const dw = clamp01(st.dustWall || 0); wallMat.opacity = dw * 0.55; wall.visible = dw > 0;
    if (dw > 0) for (let i = 0; i < NW; i++) {
      const d = W[i]; _o.position.set(wrap(d.x + wt * d.sp, dcx + 40, 130), d.y, d.z);
      _o.quaternion.copy(camera.quaternion); _o.rotateZ(d.rot + wt * 0.3); _o.scale.set(d.s * 1.6, d.s, 1); _o.updateMatrix(); wall.setMatrixAt(i, _o.matrix);
    }
    wall.instanceMatrix.needsUpdate = true;
    // dust jumping off the pavement at Sam's feet
    const bt = st.burst;
    if (bt !== null && bt !== undefined && bt >= 0) {
      burst.visible = true; burstMat.opacity = Math.max(0, 1 - bt / 2.2) * 0.6;
      for (let i = 0; i < NB; i++) {
        const d = BU[i], k = (1 - Math.exp(-bt * 1.6)) / 1.6;
        const y = Math.max(PAVE + 0.03, PAVE + 0.03 + d.vy * k - 0.8 * bt * bt * 0.2);
        _o.position.set(sx + d.dx + d.vx * k, y + d.s * 0.4 * (1 + bt), szz + d.dz + d.vz * k);
        _o.quaternion.copy(camera.quaternion); _o.rotateZ(d.rot + bt); _o.scale.setScalar(d.s * (1 + bt * 1.8)); _o.updateMatrix(); burst.setMatrixAt(i, _o.matrix);
      }
      burst.instanceMatrix.needsUpdate = true;
    } else burst.visible = false;
    // lurch: parked cars rock and slide east, bins tip over
    for (const car of parked) {
      const b = car.userData.base, k = car.userData.k;
      car.position.set(b.x + lurch * k, b.y, b.z); car.rotation.z = -Math.min(0.12, lurch * 0.04) * k * Math.cos(time * 3 + car.userData.ph) ** 2;
    }
    for (const bi of bins2) { bi.b.position.set(bi.base.x + lurch * 1.4, bi.base.y, bi.base.z); bi.b.rotation.z = -Math.min(1, lurch / 2) * (PI / 2 - 0.3); bi.b.position.y = bi.base.y + Math.min(1, lurch / 2) * 0.3; }
    // arrow
    const ar = clamp01(st.arrow || 0); arrowMat.opacity = ar * 0.92; arrowGlowMat.opacity = ar * 0.45;
    arrow.visible = arrowGlow.visible = ar > 0; arrow.scale.set(0.25 + 0.75 * ar, 1, 1);
    // jet and contrail
    const ct = st.contrail;
    if (ct !== undefined && ct !== null && ct >= 0) {
      const jx = -2600 + ct * 5200; jet.visible = trail.visible = true;
      jet.position.set(jx, JET_Y, JET_Z);
      const len = Math.min(4200, jx + 2600 + 1), tail = jx - len;
      trail.position.set((jx - 30 + tail) / 2, JET_Y, JET_Z); trail.scale.set(len, 5, 5);
    } else jet.visible = trail.visible = false;
    // shadows follow the focus
    const f = st.focus ? _c.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : _c.set(sx, 0, szz);
    const R = st.shadowRadius ?? Math.min(240, Math.max(22, camera.position.distanceTo(f) * 1.3));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 1400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sd, 600);
    sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: CAST, figure: LEAD.f, person, sam: person, bones: { head: B.head, hips: B.hips, rightHand: B.rHand, leftFoot: B.leftFoot, rightFoot: B.rightFoot },
    phone, sun, get sunDir() { return SKY[skyIndex].light.clone(); }, car: movingCar, arrow, jet, gaitSpeed: GAIT, spot,
    crosswalk: { x0: XC[3] - 6, x1: XC[3] + 6, z0: 7.2, z1: 10.8 }, signalPole: signalPos, PAVE, KERB_Z, FRONT_Z, parked, trees, bins: bins2,
  };
}
