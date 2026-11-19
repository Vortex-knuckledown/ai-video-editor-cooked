// World "suburb": a quiet suburban residential street on a sunny morning.
//
// Axes (metres): +x is EAST, +y up, +z SOUTH. The main street runs roughly along x and curves gently:
// its centreline is z = 9 * sin(x / 55). Everything is laid out across that curve by "d", the signed offset from
// the centreline along its normal (+d = the NEAR / south side, -d = the FAR / north side):
//   road |d| < 4 (two lanes: eastbound at d = +2, westbound at d = -2, kerb 0.15 high),
//   grass verge 4.25..5.6 (street trees, lamps), pavement 5.6..7.4 (top y = 0.17), front lawns from 7.4 (y = 0.15),
//   house fronts at |d| = 18 facing the street, back gardens with wooden fences to |d| = 48, a second row of houses
//   backing onto them, a parallel street at |d| 77.9..85.9 and a third row facing it. Lots every 26 m along the street.
// "s" is metres along the main street's centreline, s = 0 at x = 0 (the middle of the place).
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], extras = true}) -> world.
//   cast: library characters ("woman", "man", "robot", "soldier", "mannequin") or {id, outfit:{shirt, trousers}, as}
//   (man and woman only take an outfit); each is world.cast.<as || id>; the first is the main person.
//   extras: three background passers-by (two men, one woman) in coloured outfits (green/khaki, red/denim,
//   mustard/charcoal), never white-and-black, so they do not read as the main person. false = not loaded.
// Per frame: set world.camera (position, fov), then world.update(state), then world.render().
//
// state (every field optional):
//   time        seconds of the shot (drives the extras and the default animation clocks)
//   people      {<id>: {s, d, dir, x, z, heading, time, gait: {walk, run}, show}} one entry per cast member.
//               Either s (metres along the street) and d (offset, default +6.2 = the near pavement) with
//               dir +1 (walk east, default) or -1 (west): heading follows the curve; or x, z, heading (radians
//               about +y, 0 faces +z, PI/2 faces east). The feet are put on the ground (road 0, pavement 0.17,
//               lawn 0.15). Move s by world.gaitSpeed.<id>.walk * walk * dt so the feet never slide.
//               Default: the first at world.spot (s 0, near pavement, facing east), others 1.4 m behind.
//   extras      false hides the passers-by; or [{s, d, dir, gait, show}, ...] overrides one by index.
//               By default they walk the pavements from state.time (one comes towards the main person on the
//               near pavement, passing on her outside about 17 s in; the others are on the far pavement).
//   car         {s, lane: +1 eastbound (near lane, default) | -1 westbound, show} the moving car. Hidden unless given.
//   focus       {x, y, z} the centre of the sun's shadow box (default the main person)
//   shadowRadius metres of the shadow box (default from the camera's distance to the focus, 22..160)
//
// Exposes: world.cast.<id> (loadFigure results), world.person (the main person's Object3D), world.figure,
// world.gaitSpeed.<id> {walk, run} m/s (from the feet), world.extras ([{f, outfit}]), world.spot (Vector3),
// world.along(s, d) -> {x, z, heading, tx, tz} (a point on the street and its direction, east),
// world.roadZ(x) (centreline z), world.heightAt(x, z), world.houses ([{x, z, yaw, s, d, door: Vector3}]),
// world.car (the moving car Group), world.parked (parked car Groups), world.sun, world.sunDir,
// world.D {ROAD: 4, VERGE: 5.6, PAVE_IN: 5.6, PAVE_OUT: 7.4, FRONT: 18, BACK_FENCE: 48, LOT: 26}.
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], extras = true }) {
  if (typeof cast === "string") cast = [cast];
  if (!cast || !cast.length) cast = ["woman"];
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const LIB = new URL("../lib/", import.meta.url).href;

  // ------------------------------------------------------------------ renderer, camera
  const W0 = canvas.width || 1920, H0 = canvas.height || 1080;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
  renderer.setSize(W0, H0, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W0 / H0, 0.1, 4000);
  camera.position.set(-40, 14, 30); camera.lookAt(0, 1, 6);

  // ------------------------------------------------------------------ loading
  const TL = new THREE.TextureLoader();
  const tex = (url) => new Promise((res, rej) => TL.load(url, res, undefined, rej));
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`${K}pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const hdrL = new HDRLoader(); hdrL.setDataType(THREE.FloatType);
  const castSpec = cast.map((c) => (typeof c === "string" ? { id: c } : c));
  const EXTRAS = extras ? [
    { id: "man", outfit: { shirt: "#2f6b4f", trousers: "#c4ae84" } },
    { id: "woman", outfit: { shirt: "#b8323a", trousers: "#2c3e63" } },
    { id: "man", outfit: { shirt: "#d4a01f", trousers: "#34373c" } },
  ] : [];
  const [sky, BRICK, ASPH, CONC, ROCK, SAND, leafImg, barkD, barkN, potP, FIGS, XFIGS] = await Promise.all([
    hdrL.loadAsync(K + "sky/day.hdr"), pbrSet("brick"), pbrSet("asphalt"), pbrSet("concrete"), pbrSet("rock"), pbrSet("sand"),
    tex(LIB + "props/island_tree_01/textures/island_tree_01_leaves_diff_1k.jpg"),
    tex(LIB + "props/pine_tree_01/textures/pine_tree_01_bark_diff_1k.jpg"),
    tex(LIB + "props/pine_tree_01/textures/pine_tree_01_bark_nor_gl_1k.jpg"),
    loadProp({ THREE, id: "potted_plant_01" }).catch(() => null),
    Promise.all(castSpec.map((c) => loadFigure({ THREE, id: c.id, clips: ["idle", "walk", "run"], outfit: c.outfit || null }))),
    Promise.all(EXTRAS.map((c) => loadFigure({ THREE, id: c.id, clips: ["idle", "walk"], outfit: c.outfit }))),
  ]);

  // ------------------------------------------------------------------ deterministic random
  let seed = 7302114;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // ------------------------------------------------------------------ sky and sun
  sky.mapping = THREE.EquirectangularReflectionMapping;
  function analyseSky(t, targetAz) {
    const { data, width: W, height: H } = t.image;
    let best = -1, bi = 0; const hor = [0, 0, 0]; let hn = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4, L = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (L > best) { best = L; bi = r * W + c; }
      const el = ((1 - (r + 0.5) / H) - 0.5) * PI;
      if (el > 0.02 && el < 0.2 && L < 4) { hor[0] += data[i]; hor[1] += data[i + 1]; hor[2] += data[i + 2]; hn++; }
    }
    const r = Math.floor(bi / W), c = bi % W;
    let el = ((1 - (r + 0.5) / H) - 0.5) * PI; if (el < 0) el = -el;
    const phi = ((c + 0.5) / W - 0.5) * 2 * PI;
    const dTex = new V3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
    const a = Math.atan2(dTex.z, dTex.x) - targetAz;
    const sunDir = dTex.clone().applyEuler(new THREE.Euler(0, a, 0)).normalize();
    const fog = hn ? new THREE.Color(hor[0] / hn, hor[1] / hn, hor[2] / hn) : new THREE.Color(0.75, 0.82, 0.9);
    const m = Math.max(fog.r, fog.g, fog.b); if (m > 1.1) fog.multiplyScalar(1.1 / m);
    return { rot: a, sunDir, fog };
  }
  // the morning Sun in the north-east-ish quarter of the sky, so the near-side house fronts (facing north) and a person
  // seen from the road are lit, and shadows fall towards the near side
  const SK = analyseSky(sky, Math.atan2(-0.62, 0.78));
  {
    const az = Math.atan2(SK.sunDir.z, SK.sunDir.x), el = Math.min(Math.max(Math.asin(SK.sunDir.y), 0.5), 0.72);
    SK.light = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  }
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, SK.rot, 0); scene.environmentRotation.set(0, SK.rot, 0);
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(SK.fog.clone().lerp(new THREE.Color(0.78, 0.85, 0.93), 0.35), 0.0042);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xd4e4ff, 0x5d6b3e, 0.35); scene.add(hemi);

  // ------------------------------------------------------------------ canvas surfaces made from the kit's photographs
  const mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
  const canTex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  // lawn: blades of grass over the sand photograph
  const grassMap = (() => {
    const [c, g] = mkCanvas(1024, 1024);
    g.fillStyle = "#4f7a2c"; g.fillRect(0, 0, 1024, 1024);
    g.globalAlpha = 0.18; g.drawImage(SAND.map.image, 0, 0, 1024, 1024); g.globalAlpha = 1;
    for (let i = 0; i < 52000; i++) {
      const x = rnd() * 1024, y = rnd() * 1024, L = 5 + rnd() * 12, a = -PI / 2 + rr(-0.6, 0.6);
      g.strokeStyle = `hsl(${rr(78, 108)},${rr(38, 62)}%,${rr(18, 44)}%)`; g.lineWidth = rr(1, 2.2);
      for (const ox of [0, 1024, -1024]) for (const oy of [0, 1024, -1024]) {
        if (ox && (x + ox < -20 || x + ox > 1044)) continue; if (oy && (y + oy < -20 || y + oy > 1044)) continue;
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L); g.stroke();
      }
    }
    return canTex(c);
  })();
  // pavement: the concrete photograph cut into slabs
  const paveMap = (() => {
    const [c, g] = mkCanvas(1024, 1024);
    g.drawImage(CONC.map.image, 0, 0, 1024, 1024);
    g.fillStyle = "rgba(235,230,220,0.25)"; g.fillRect(0, 0, 1024, 1024);
    g.fillStyle = "rgba(40,36,32,0.55)"; g.fillRect(0, 0, 1024, 5); g.fillRect(0, 0, 5, 1024);
    g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(0, 5, 1024, 2); g.fillRect(5, 0, 2, 1024);
    return canTex(c);
  })();
  // roof shingles: the asphalt photograph in staggered rows of tabs
  const shingleMap = (() => {
    const [c, g] = mkCanvas(1024, 1024);
    g.drawImage(ASPH.map.image, 0, 0, 1024, 1024);
    const rows = 10, rh = 1024 / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 51;
      for (let x = -off; x < 1024; x += 102) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${rr(0.02, 0.14)})`; g.fillRect(x, r * rh, 102, rh);
        g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(x, r * rh + rh * 0.35, 3, rh * 0.65);
      }
      const gr = g.createLinearGradient(0, r * rh + rh - 14, 0, r * rh + rh);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.55)");
      g.fillStyle = gr; g.fillRect(0, r * rh + rh - 14, 1024, 14);
    }
    return canTex(c);
  })();
  // clapboard siding: horizontal boards over the concrete photograph (a painted wall)
  const sidingMap = (() => {
    const [c, g] = mkCanvas(512, 1024);
    g.fillStyle = "#f2f0ea"; g.fillRect(0, 0, 512, 1024);
    g.globalAlpha = 0.22; g.drawImage(CONC.map.image, 0, 0, 512, 1024); g.globalAlpha = 1;
    const n = 8, bh = 1024 / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
      gr.addColorStop(0, "rgba(0,0,0,0.0)"); gr.addColorStop(0.85, "rgba(0,0,0,0.06)"); gr.addColorStop(0.97, "rgba(0,0,0,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0.3)");
      g.fillStyle = gr; g.fillRect(0, i * bh, 512, bh);
    }
    return canTex(c);
  })();
  // garage door: four rows of raised panels
  const garageMap = (() => {
    const [c, g] = mkCanvas(512, 512);
    g.fillStyle = "#eeeeea"; g.fillRect(0, 0, 512, 512);
    g.globalAlpha = 0.12; g.drawImage(CONC.map.image, 0, 0, 512, 512); g.globalAlpha = 1;
    for (let r = 0; r < 4; r++) {
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, r * 128 + 125, 512, 3);
      for (let k = 0; k < 4; k++) {
        const x = 14 + k * 124, y = r * 128 + 16, w = 112, h = 96;
        g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(x, y + h - 5, w, 5); g.fillRect(x + w - 5, y, 5, h);
        g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(x, y, w, 4); g.fillRect(x, y, 4, h);
      }
    }
    return canTex(c);
  })();
  // fence boards: vertical planks over the sand photograph, stained
  const fenceMap = (() => {
    const [c, g] = mkCanvas(512, 512);
    g.fillStyle = "#9a7552"; g.fillRect(0, 0, 512, 512);
    g.globalAlpha = 0.35; g.drawImage(SAND.map.image, 0, 0, 512, 512); g.globalAlpha = 1;
    for (let x = 0; x < 512; x += 32) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,240,220"},${rr(0.03, 0.12)})`; g.fillRect(x, 0, 32, 512);
      g.fillStyle = "rgba(30,20,10,0.55)"; g.fillRect(x, 0, 2, 512);
    }
    return canTex(c);
  })();
  // leaves: the library's leaf photograph with its black cut away
  const leafMap = (() => {
    const W = 850, H = 1024; const [c, g] = mkCanvas(W, H);
    g.drawImage(leafImg.image, 0, 0, W, H, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = Math.max(p[i], p[i + 1], p[i + 2]); p[i + 3] = l < 18 ? 0 : 255; }
    g.putImageData(d, 0, 0);
    const t = canTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  })();
  // foliage: a mass of leaves for the inside of crowns and hedges
  const foliageMap = (() => {
    const [c, g] = mkCanvas(512, 512);
    g.fillStyle = "#24381a"; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 420; i++) {
      const x = rnd() * 512, y = rnd() * 512, s = rr(40, 90);
      g.save(); g.translate(x, y); g.rotate(rnd() * PI * 2); g.globalAlpha = rr(0.5, 0.95);
      g.filter = `brightness(${rr(0.45, 0.95)})`;
      g.drawImage(leafMap.image, -s / 2, -s / 2, s * 0.83, s); g.restore();
    }
    g.filter = "none";
    return canTex(c);
  })();
  barkD.colorSpace = THREE.SRGBColorSpace;
  for (const t of [barkD, barkN]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); t.anisotropy = 8; }

  // ------------------------------------------------------------------ materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    asphalt: std({ ...ASPH, color: 0x8c8c8c }),
    kerb: std({ ...CONC, color: 0xc9c5bd }),
    pave: std({ map: paveMap, normalMap: CONC.normalMap, roughnessMap: CONC.roughnessMap, color: 0xd9d4ca }),
    grass: std({ map: grassMap, normalMap: SAND.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95, color: 0xffffff, vertexColors: true }),
    drive: std({ map: paveMap, normalMap: CONC.normalMap, roughnessMap: CONC.roughnessMap, color: 0xe2ded6 }),
    brick: [std({ ...BRICK, color: 0xffffff }), std({ ...BRICK, color: 0xd6b4a0 }), std({ ...BRICK, color: 0xb88f7c }), std({ ...BRICK, color: 0xe6d6c4 })],
    siding: [0xf4f2ec, 0xe9dfc6, 0xc9d6dd, 0xb9c4b0, 0xd9d4cb, 0x9fb2c2, 0xe8d2b5].map((c) => std({ map: sidingMap, normalMap: CONC.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.75, color: c })),
    stucco: [std({ ...CONC, color: 0xf0e6d4 }), std({ ...CONC, color: 0xe4d2b8 })],
    roof: [0x4a4a4c, 0x5b4636, 0x3b4148, 0x6e5a4a, 0x7a3e30, 0x2d2f33].map((c) => std({ map: shingleMap, normalMap: ROCK.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.92, color: c })),
    trim: std({ color: 0xf3f1ea, roughness: 0.55 }),
    trimCream: std({ color: 0xe6dcc4, roughness: 0.55 }),
    plinth: std({ ...CONC, color: 0x9d988f }),
    glass: std({ color: 0x27313c, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.2 }),
    curtain: std({ color: 0xd8cdb6, roughness: 0.9 }),
    doors: [0x7a1f24, 0x1f3a5c, 0x2e4a32, 0x2a2a2a, 0x6d4a2b, 0xc79a2a].map((c) => std({ color: c, roughness: 0.45 })),
    shutters: [0x2c3f2e, 0x1e2b42, 0x1b1b1b, 0x5a1f22, 0x4a5a66].map((c) => std({ color: c, roughness: 0.6 })),
    garage: std({ map: garageMap, roughness: 0.55 }),
    gutter: std({ color: 0xe8e6e0, roughness: 0.5 }),
    chim: std({ ...BRICK, color: 0xb88f7c }),
    fence: std({ map: fenceMap, normalMap: SAND.normalMap, roughness: 0.85 }),
    post: std({ color: 0x7d5c40, roughness: 0.85 }),
    picket: std({ color: 0xf1efe8, roughness: 0.6 }),
    soil: std({ ...SAND, color: 0x5a4430, roughness: 1 }),
    bark: std({ map: barkD, normalMap: barkN, roughness: 0.95, color: 0xb8aa98 }),
    foliage: std({ map: foliageMap, roughness: 0.9, color: 0xb6c49e }),
    hedge: std({ map: foliageMap, roughness: 0.9, color: 0x9fb48a }),
    lamp: std({ color: 0x2a332c, roughness: 0.5, metalness: 0.5 }),
    lampGlass: std({ color: 0xf6f0de, emissive: 0x3a3426, roughness: 0.2 }),
    mailbox: std({ color: 0x1e2022, roughness: 0.4, metalness: 0.5 }),
    mailRed: std({ color: 0xb3221c, roughness: 0.5 }),
    binG: std({ color: 0x2f5a3a, roughness: 0.6 }), binB: std({ color: 0x23466e, roughness: 0.6 }), binK: std({ color: 0x1d1d1d, roughness: 0.7 }),
    hydrant: std({ color: 0xc2a12a, roughness: 0.5 }),
    stone: std({ map: paveMap, normalMap: CONC.normalMap, roughnessMap: CONC.roughnessMap, color: 0xd6cfc2 }),
  };

  // ------------------------------------------------------------------ static batching (one mesh per material)
  const bins = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();
  const mat4 = (x, y, z, ry = 0, rx = 0, rz = 0) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(1, 1, 1)).clone();
  function put(geo, mat, m4, cast = true, recv = true) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (m4) g.applyMatrix4(m4);
    const key = mat.uuid + (cast ? "c" : "") + (recv ? "r" : "");
    if (!bins.has(key)) bins.set(key, { mat, cast, recv, list: [] });
    bins.get(key).list.push(g);
  }
  function flush() {
    for (const b of bins.values()) {
      for (let i = 0; i < b.list.length; i += 3000) {
        const g = mergeGeometries(b.list.slice(i, i + 3000), false); if (!g) continue;
        const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.matrixAutoUpdate = false; scene.add(mesh);
      }
    }
    bins.clear();
  }
  // box-projected UVs in the geometry's own frame, `tile` metres per repeat
  function projUV(g, tile) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
      uv.setXY(i, u / tile, v / tile);
    }
    uv.needsUpdate = true; return g;
  }

  // ------------------------------------------------------------------ the street's curve
  const A = 9, L = 55;
  const roadZ = (x) => A * Math.sin(x / L);
  const slope = (x) => (A / L) * Math.cos(x / L);
  const XMIN = -520, XMAX = 520, DX = 0.25, NX = Math.round((XMAX - XMIN) / DX) + 1;
  const SX = new Float64Array(NX);
  for (let i = 1; i < NX; i++) { const x = XMIN + (i - 0.5) * DX; SX[i] = SX[i - 1] + DX * Math.sqrt(1 + slope(x) ** 2); }
  { const o = SX[Math.round(-XMIN / DX)]; for (let i = 0; i < NX; i++) SX[i] -= o; }
  const sOfX = (x) => { const f = (x - XMIN) / DX, i = Math.max(0, Math.min(NX - 2, Math.floor(f))); return SX[i] + (SX[i + 1] - SX[i]) * (f - i); };
  function xOfS(s) {
    let lo = 0, hi = NX - 1;
    if (s <= SX[0]) return XMIN; if (s >= SX[hi]) return XMAX;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (SX[m] <= s) lo = m; else hi = m; }
    return XMIN + (lo + (s - SX[lo]) / (SX[hi] - SX[lo])) * DX;
  }
  const curv = (x) => (-(A / (L * L)) * Math.sin(x / L)) / Math.pow(1 + slope(x) ** 2, 1.5);   // + bends towards +d
  function frameAt(x) { const k = slope(x), inv = 1 / Math.sqrt(1 + k * k); return { tx: inv, tz: k * inv }; }
  const P = (x, d) => { const { tx, tz } = frameAt(x); return { x: x - tz * d, z: roadZ(x) + tx * d, tx, tz }; };
  function along(s, d = 0) { const x = xOfS(s), p = P(x, d); return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, heading: Math.atan2(p.tx, p.tz) }; }
  function dOf(x, z) { const { tx } = frameAt(x); return (z - roadZ(x)) * tx; }
  function heightAt(x, z) {
    const u = Math.abs(dOf(x, z));
    if (u < 4 || (u > 77.85 && u < 85.85)) return 0;
    if ((u >= 5.6 && u <= 7.4) || (u >= 75.8 && u <= 77.6) || (u >= 86.1 && u <= 87.9)) return 0.17;
    return 0.15;
  }

  // ------------------------------------------------------------------ ground: ribbons across the curve
  const noise2 = (x, z) => Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * 0.5 + Math.sin(z * 0.13 + x * 0.05) * 0.3 + Math.sin(x * 0.37 - z * 0.29) * 0.2;
  function ribbon(dA, dB, yA, yB, mat, { tileU = 2, tileV = 2, across = 1, X0 = -500, X1 = 500, step = 2, tint = false, cast = false } = {}) {
    const nI = Math.round((X1 - X0) / step) + 1, nJ = across + 1;
    const pos = new Float32Array(nI * nJ * 3), uv = new Float32Array(nI * nJ * 2), col = new Float32Array(nI * nJ * 3);
    for (let i = 0; i < nI; i++) {
      const x = X0 + i * step, s = sOfX(x);
      for (let j = 0; j < nJ; j++) {
        const k = j / across, d = dA + (dB - dA) * k, y = yA + (yB - yA) * k, p = P(x, d), q = i * nJ + j;
        pos.set([p.x, y, p.z], q * 3);
        uv.set([s / tileU, (Math.abs(dB - dA) * k + (yB - yA) * k) / tileV + dA / tileV], q * 2);
        const n = tint ? noise2(p.x, p.z) : 0, m = 0.86 + n * 0.12 + (tint ? rr(-0.03, 0.03) : 0);
        col.set(tint ? [m * 0.95, m * (1.0 + n * 0.04), m * 0.85] : [1, 1, 1], q * 3);
      }
    }
    const idx = [];
    for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ - 1; j++) {
      const a = i * nJ + j, b = (i + 1) * nJ + j, c = i * nJ + j + 1, e = (i + 1) * nJ + j + 1;
      idx.push(a, c, b, b, c, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = cast; scene.add(mesh); return mesh;
  }
  const kerbFace = M.kerb.clone(); kerbFace.side = THREE.DoubleSide;
  ribbon(-4, 4, 0, 0, M.asphalt, { tileU: 5, tileV: 5, across: 2, X0: -510, X1: 510 });
  // a white dashed centre line, a little worn
  {
    const lineM = std({ color: 0xe8e4d8, roughness: 0.7, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let s = -500; s < 500; s += 9) { const a = along(s), b = along(s + 3.5); const g = new THREE.PlaneGeometry(0.12, Math.hypot(b.x - a.x, b.z - a.z)); g.rotateX(-PI / 2); put(g, lineM, mat4((a.x + b.x) / 2, 0.006, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z)), false, true); }
  }
  for (const sg of [1, -1]) {
    const R = (u0, u1, y0, y1, mat, o) => ribbon(sg > 0 ? u0 : -u1, sg > 0 ? u1 : -u0, sg > 0 ? y0 : y1, sg > 0 ? y1 : y0, mat, o);
    const face = (u, y0, y1) => ribbon(sg * u, sg * u, y0, y1, kerbFace, { tileU: 2, tileV: 2, X0: -510, X1: 510 });
    face(4, 0, 0.15); R(4, 4.25, 0.15, 0.15, M.kerb, { tileU: 2, tileV: 2, X0: -510, X1: 510 });
    R(4.25, 5.6, 0.15, 0.15, M.grass, { tint: true, X0: -510, X1: 510 });
    R(5.6, 7.4, 0.17, 0.17, M.pave, { tileU: 1.8, tileV: 1.8, X0: -510, X1: 510 });
    face(5.6, 0.15, 0.17); face(7.4, 0.15, 0.17);
    R(7.4, 75.8, 0.15, 0.15, M.grass, { tint: true, across: 17, X0: -510, X1: 510 });
    R(75.8, 77.6, 0.17, 0.17, M.pave, { tileU: 1.8, tileV: 1.8, X0: -510, X1: 510 }); face(75.8, 0.15, 0.17); face(77.6, 0.15, 0.17);
    R(77.6, 77.85, 0.15, 0.15, M.kerb, { X0: -510, X1: 510 }); face(77.85, 0, 0.15);
    R(77.85, 85.85, 0, 0, M.asphalt, { tileU: 5, tileV: 5, X0: -510, X1: 510 });
    face(85.85, 0, 0.15); R(85.85, 86.1, 0.15, 0.15, M.kerb, { X0: -510, X1: 510 });
    R(86.1, 87.9, 0.17, 0.17, M.pave, { tileU: 1.8, tileV: 1.8, X0: -510, X1: 510 }); face(86.1, 0.15, 0.17); face(87.9, 0.15, 0.17);
    R(87.9, 200, 0.15, 0.15, M.grass, { tint: true, across: 22, X0: -510, X1: 510, step: 4 });
  }
  {
    const g = new THREE.PlaneGeometry(5000, 5000); g.rotateX(-PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2500, uv.getY(i) * 2500);
    const c = new Float32Array(g.attributes.position.count * 3).fill(0.8); g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const far = new THREE.Mesh(g, M.grass); far.position.y = -0.03; far.receiveShadow = true; scene.add(far);
  }

  // ------------------------------------------------------------------ foliage: leaf cards (one instanced mesh)
  const LEAVES = [];   // {p, q, s, c}
  const _qq = new THREE.Quaternion(), _ee = new THREE.Euler();
  function leafCard(x, y, z, s, hue) {
    LEAVES.push({ p: new V3(x, y, z), q: new THREE.Quaternion().setFromEuler(_ee.set(rr(-PI, PI), rr(-PI, PI), rr(-PI, PI))), s, c: hue });
  }
  const noise3 = (x, y, z) => Math.sin(x * 1.9 + Math.sin(z * 1.3)) * 0.5 + Math.sin(y * 2.3 + x * 0.7) * 0.3 + Math.sin(z * 2.9 - y * 1.1) * 0.2;
  const blobGeo = [0, 1, 2].map((k) => {
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = new V3().fromBufferAttribute(p, i); const n = noise3(v.x * 2 + k, v.y * 2, v.z * 2 - k); v.multiplyScalar(0.88 + 0.14 * n); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); projUV(g, 0.5); return g;
  });
  const trees = [];
  function tree(x, z, { h = rr(2.4, 3.4), r = rr(2.2, 3.4), lod = 0, base = 0.15, kind = rnd() } = {}) {
    const trunkG = new THREE.CylinderGeometry(0.13 + r * 0.03, 0.2 + r * 0.04, h + r * 0.5, 9);
    trunkG.translate(0, (h + r * 0.5) / 2, 0);
    put(trunkG, M.bark, mat4(x, base, z, rnd() * PI, rr(-0.04, 0.04), rr(-0.04, 0.04)));
    const cy = base + h + r * 0.75, sy = r * (kind < 0.3 ? 1.15 : 0.82);
    // two or three lobes so the crown is not a ball
    const lobes = [[0, 0, 0, 1]];
    for (let k = 0; k < 2 + (kind > 0.6 ? 1 : 0); k++) { const a = rnd() * PI * 2; lobes.push([Math.cos(a) * r * 0.45, rr(-0.2, 0.35) * sy, Math.sin(a) * r * 0.45, rr(0.55, 0.75)]); }
    const hue = rr(-1, 1);
    for (const [ox, oy, oz, f] of lobes) {
      const rx = r * f, ry = sy * f;
      const g = blobGeo[Math.floor(rnd() * 3)].clone(); g.scale(rx * 0.92, ry * 0.92, rx * 0.92);
      put(g, M.foliage, mat4(x + ox, cy + oy, z + oz, rnd() * PI));
      const n = Math.round((lod ? 14 : 46) * rx * rx);
      for (let i = 0; i < n; i++) {
        const v = new V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)); if (v.lengthSq() > 1 || v.lengthSq() < 0.01) { i--; continue; }
        v.normalize().multiplyScalar(0.8 + Math.sqrt(rnd()) * 0.28);
        leafCard(x + ox + v.x * rx, cy + oy + v.y * ry, z + oz + v.z * rx, lod ? rr(0.9, 1.2) : rr(0.55, 0.8), hue);
      }
    }
    trees.push({ x, z, r, top: cy + sy });
  }
  function bush(x, y, z, r, hue = rr(-1, 1), lod = 0) {
    const g = blobGeo[Math.floor(rnd() * 3)].clone(); g.scale(r, r * 0.8, r);
    put(g, M.hedge, mat4(x, y + r * 0.55, z, rnd() * PI));
    if (lod) return;
    const n = Math.round(60 * r * r);
    for (let i = 0; i < n; i++) {
      const v = new V3(rr(-1, 1), rr(0, 1), rr(-1, 1)).normalize().multiplyScalar(rr(0.85, 1.08));
      leafCard(x + v.x * r, y + r * 0.55 + v.y * r * 0.8, z + v.z * r, rr(0.3, 0.45), hue);
    }
  }
  // a hedge: a leafy box from (x0,z0) to (x1,z1) in a frame m4, height h, depth dp
  function hedge(m4, x0, z0, x1, z1, h = 1.1, dp = 0.8, lod = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0) - PI / 2;
    const g = new THREE.BoxGeometry(len, h, dp, Math.max(2, Math.round(len * 2)), 3, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new V3().fromBufferAttribute(p, i), n = noise3(v.x * 1.7, v.y * 2.1, v.z * 1.9);
      const dir = new V3(v.x / (len / 2), v.y / (h / 2), v.z / (dp / 2));
      p.setXYZ(i, v.x + dir.x * 0.05 * n, v.y + Math.max(0, dir.y) * 0.08 * n, v.z + dir.z * 0.1 * n);
    }
    g.computeVertexNormals(); projUV(g, 0.6); g.translate(0, h / 2, 0);
    const local = mat4((x0 + x1) / 2, 0, (z0 + z1) / 2, ang), m = m4.clone().multiply(local);
    put(g, M.hedge, m);
    if (lod) return;
    const n = Math.round(len * 22), hue = rr(-1, 1);
    for (let i = 0; i < n; i++) {
      const side = rnd(), lx = rr(-len / 2, len / 2);
      const lv = side < 0.4 ? new V3(lx, h + rr(-0.05, 0.05), rr(-dp / 2, dp / 2)) : new V3(lx, rr(0.15, h), (side < 0.7 ? 1 : -1) * (dp / 2 + rr(-0.04, 0.05)));
      lv.applyMatrix4(m); leafCard(lv.x, lv.y, lv.z, rr(0.3, 0.42), hue);
    }
  }

  // ------------------------------------------------------------------ cars (shapes, from the street world)
  function carGeoms(type) {
    const H = type === "suv" ? 1.18 : 1, R = type === "suv" ? 0.37 : 0.33, Lc = type === "suv" ? 2.35 : 2.3;
    const y = (v) => 0.3 + (v - 0.3) * H;
    const s = new THREE.Shape();
    s.moveTo(-Lc, y(0.32)); s.lineTo(-1.88, y(0.32));
    s.absarc(-1.42, 0.34, R + 0.08, PI, 0, true); s.lineTo(1.0, y(0.32));
    s.absarc(1.42, 0.34, R + 0.08, PI, 0, true); s.lineTo(Lc - 0.05, y(0.32));
    s.quadraticCurveTo(Lc + 0.08, y(0.34), Lc + 0.06, y(0.62)); s.lineTo(Lc - 0.1, y(0.84));
    s.lineTo(0.95, y(0.96)); s.lineTo(-1.7, y(0.99)); s.lineTo(-Lc + 0.05, y(0.93));
    s.quadraticCurveTo(-Lc - 0.06, y(0.86), -Lc - 0.04, y(0.6)); s.lineTo(-Lc, y(0.32));
    const body = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 });
    body.translate(0, 0, -0.85);
    const gsh = new THREE.Shape(), rb = type === "suv" ? -2.0 : -1.62;
    gsh.moveTo(rb, y(0.96)); gsh.lineTo(type === "suv" ? -1.9 : -0.98, y(1.4)); gsh.lineTo(0.38, y(1.42)); gsh.lineTo(1.05, y(0.96)); gsh.lineTo(rb, y(0.96));
    const glass = new THREE.ExtrudeGeometry(gsh, { depth: 1.46, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
    glass.translate(0, 0, -0.73);
    const r0 = type === "suv" ? -1.95 : -0.92;
    const roof = new THREE.BoxGeometry(0.3 - r0, 0.07, 1.48); roof.translate((0.3 + r0) / 2, y(1.42) + 0.04, 0);
    const tires = [], rims = [], fl = [], rl = [], bump = [];
    for (const [wx, wz] of [[-1.42, -0.8], [-1.42, 0.8], [1.42, -0.8], [1.42, 0.8]]) {
      const t = new THREE.CylinderGeometry(R, R, 0.24, 20); t.rotateX(PI / 2); t.translate(wx, R, wz); tires.push(t);
      const r = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.25, 14); r.rotateX(PI / 2); r.translate(wx, R, wz); rims.push(r);
    }
    for (const sz of [-0.62, 0.62]) {
      const f = new THREE.BoxGeometry(0.06, 0.12, 0.34); f.translate(Lc + 0.07, y(0.7), sz); fl.push(f);
      const b = new THREE.BoxGeometry(0.06, 0.12, 0.34); b.translate(-Lc - 0.08, y(0.76), sz); rl.push(b);
    }
    for (const bx of [Lc + 0.06, -Lc - 0.06]) { const b = new THREE.BoxGeometry(0.14, 0.16, 1.82); b.translate(bx, y(0.42), 0); bump.push(b); }
    return { body, glass, roof, tires: mergeGeometries(tires), rims: mergeGeometries(rims), front: mergeGeometries(fl), rear: mergeGeometries(rl), bump: mergeGeometries(bump) };
  }
  const CG = { sedan: carGeoms("sedan"), suv: carGeoms("suv") };
  const paints = [0x1d1f22, 0xd8d9db, 0x8a8f96, 0x22344f, 0x6d1a1c, 0x3a3f36, 0xe9e7e2, 0x4b5358, 0x2f4f6f, 0x9a8a6a].map((c) => std({ color: c, roughness: 0.28, metalness: 0.65 }));
  const carGlass = std({ color: 0x141a20, roughness: 0.05, metalness: 0.9 }), rubber = std({ color: 0x141414, roughness: 0.9 });
  const chrome = std({ color: 0xb8bcc0, roughness: 0.25, metalness: 1 }), plastic = std({ color: 0x1a1a1a, roughness: 0.7 });
  const headL = std({ color: 0xf4f1e6, emissive: 0x403c30, roughness: 0.2 }), tailL = std({ color: 0x8a0d0d, emissive: 0x3a0000, roughness: 0.3 });
  function makeCar(type, paint) {
    const g = CG[type], car = new THREE.Group();
    for (const [geo, mat] of [[g.body, paint], [g.glass, carGlass], [g.roof, paint], [g.bump, plastic], [g.front, headL], [g.rear, tailL], [g.tires, rubber], [g.rims, chrome]]) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; car.add(m);
    }
    return car;
  }
  const parked = [];
  // a car whose length runs along `dir` (unit x,z), its middle at (x, y, z)
  function placeCar(car, x, y, z, dx, dz) { car.position.set(x, y, z); car.rotation.set(0, Math.atan2(-dz, dx), 0); scene.add(car); parked.push(car); return car; }

  // ------------------------------------------------------------------ houses
  const houses = [], DRIVES = [];
  let LM = new THREE.Matrix4();
  const Pm = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0, cast = true) => put(geo, mat, LM.clone().multiply(mat4(x, y, z, ry, rx, rz)), cast);
  const Bx = (mat, x, y, z, w, h, d, tile = 0, ry = 0, cast = true) => { const g = new THREE.BoxGeometry(w, h, d); if (tile) projUV(g, tile); Pm(g, mat, x, y, z, ry, 0, 0, cast); };
  // a window on a wall: centre (cx, cy) in the wall's own frame; `face` = {o: Vector3 origin, ux: along-wall unit (x,z), n: outward unit (x,z)}
  function windowOn(face, cx, cy, w, h, trim, shut, lod) {
    const at = (a, b, out) => [face.o.x + face.ux[0] * a + face.n[0] * out, b, face.o.z + face.ux[1] * a + face.n[1] * out];
    const ry = Math.atan2(face.n[0], face.n[1]);
    const box = (mat, a, b, out, ww, hh, dd) => { const [x, y, z] = at(a, b, out); Bx(mat, x, y, z, ww, hh, dd, 0, ry, false); };
    box(M.glass, cx, cy, 0.01, w, h, 0.04);
    if (!lod) box(M.curtain, cx - w * 0.36, cy + 0.02, -0.03, w * 0.26, h * 0.92, 0.03);
    const t = 0.09;
    box(trim, cx, cy + h / 2 + t / 2, 0.04, w + 2 * t, t, 0.08); box(trim, cx, cy - h / 2 - t / 2, 0.04, w + 2 * t, t, 0.08);
    box(trim, cx - w / 2 - t / 2, cy, 0.04, t, h, 0.08); box(trim, cx + w / 2 + t / 2, cy, 0.04, t, h, 0.08);
    box(trim, cx, cy - h / 2 - t - 0.03, 0.08, w + 0.36, 0.06, 0.16);
    if (!lod) { box(trim, cx, cy, 0.035, 0.045, h, 0.04); box(trim, cx, cy + h * 0.08, 0.035, w, 0.045, 0.04); }
    if (shut) for (const sg of [-1, 1]) box(shut, cx + sg * (w / 2 + t + 0.26), cy, 0.05, 0.46, h + 0.1, 0.05);
  }
  // a gable roof: ridge centred at (cx, H+R, cz), ridge along yaw-rotated x, half-span hs, overhang ov
  function gableRoof(cx, cz, yaw, len, hs, H, R, ov, mat) {
    const a = Math.atan2(R, hs), t = 0.14, Ls = (hs + ov) / Math.cos(a) + 0.04, c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const sg of [1, -1]) {
      const cm = sg * (hs + ov) / 2 + sg * Math.sin(a) * t / 2, ym = H + R - ((hs + ov) / 2) * Math.tan(a) + Math.cos(a) * t / 2;
      const g = projUV(new THREE.BoxGeometry(len + 2 * ov, t, Ls), 2.0);
      Pm(g, mat, cx + sn * cm, ym, cz + c * cm, yaw, sg * a);
      // gutter along the eave
      const ge = new THREE.BoxGeometry(len + 2 * ov, 0.12, 0.12), ez = sg * (hs + ov + 0.04);
      Pm(ge, M.gutter, cx + sn * ez, H - ov * Math.tan(a) - 0.04, cz + c * ez, yaw, 0, 0, false);
    }
    Pm(new THREE.BoxGeometry(len + 2 * ov, 0.1, 0.28), mat, cx, H + R + t / Math.cos(a) - 0.02, cz, yaw, 0, 0, false);
  }
  // a wall block: extruded house section with its gable, in house-local coords. type "side": ridge along x
  function block(type, x0, W, z0, D, H, R, wall) {
    const s = new THREE.Shape();
    let g;
    if (type === "side") {
      s.moveTo(0, 0); s.lineTo(D, 0); s.lineTo(D, H); s.lineTo(D / 2, H + R); s.lineTo(0, H); s.lineTo(0, 0);
      g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false });
      g.rotateY(-PI / 2); g.translate(x0 + W, 0, z0 - D);   // shape x -> world z, the extrusion -> world -x
    } else {
      s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, H); s.lineTo(0, H + R); s.lineTo(-W / 2, H); s.lineTo(-W / 2, 0);
      g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false });
      g.translate(x0 + W / 2, 0, z0 - D);
    }
    projUV(g, wall.map === BRICK.map ? 2.2 : 1.6);
    Pm(g, wall, 0, 0, 0);
  }
  function house(row, lod) {
    const two = rnd() < 0.7, H = two ? 5.7 : 3.1;
    const W = rr(9.5, 12), D = rr(8.2, 9.6), gW = rnd() < 0.55 ? 6.2 : 3.8, gD = 6.6;
    const gSide = rnd() < 0.5 ? 1 : -1, tot = W + gW, hx0 = gSide > 0 ? -tot / 2 : -tot / 2 + gW, gx0 = gSide > 0 ? -tot / 2 + W : -tot / 2;
    const wk = rnd(), wall = wk < 0.3 ? pick(M.brick) : wk < 0.85 ? pick(M.siding) : pick(M.stucco);
    const roof = pick(M.roof), trim = rnd() < 0.75 ? M.trim : M.trimCream, shut = rnd() < 0.45 ? pick(M.shutters) : null;
    const front = rnd() < 0.35 ? "front" : "side", pitch = rr(0.5, 0.68);
    // plinth
    Bx(M.plinth, hx0 + W / 2, 0.12, -D / 2, W + 0.12, 0.5, D + 0.12, 1.5);
    Bx(M.plinth, gx0 + gW / 2, 0.06, -gD / 2 + 0.4, gW + 0.12, 0.3, gD + 0.12, 1.5);
    // main block and roof
    if (front === "side") { const R = (D / 2) * Math.tan(pitch); block("side", hx0, W, 0, D, H, R, wall); gableRoof(hx0 + W / 2, -D / 2, 0, W, D / 2, H, R, 0.45, roof); }
    else { const R = (W / 2) * Math.tan(pitch); block("front", hx0, W, 0, D, H, R, wall); gableRoof(hx0 + W / 2, -D / 2, PI / 2, D, W / 2, H, R, 0.45, roof);
      windowOn({ o: new V3(hx0 + W / 2, 0, 0), ux: [1, 0], n: [0, 1] }, 0, H + R * 0.42, 0.7, 0.7, trim, null, lod); }
    // garage: a lower block with its own roof, 0.4 m proud of the house
    const gH = 2.9, gR = (gD / 2) * Math.tan(0.45);
    block("side", gx0, gW, 0.4, gD, gH, gR, wall); gableRoof(gx0 + gW / 2, 0.4 - gD / 2, 0, gW, gD / 2, gH, gR, 0.3, roof);
    const gdW = gW > 5 ? 4.9 : 2.7;
    const gdTex = new THREE.BoxGeometry(gdW, 2.2, 0.06); Pm(gdTex, M.garage, gx0 + gW / 2, 1.1 + 0.05, 0.42, 0, 0, 0, false);
    Bx(trim, gx0 + gW / 2, 2.3, 0.44, gdW + 0.24, 0.12, 0.08, 0, 0, false);
    for (const sg of [-1, 1]) Bx(trim, gx0 + gW / 2 + sg * (gdW / 2 + 0.06), 1.15, 0.44, 0.12, 2.3, 0.08, 0, 0, false);
    // front: door with a porch, windows in slots
    const slots = Math.max(2, Math.floor(W / 2.7)), sw = W / slots;
    const doorSlot = gSide > 0 ? slots - 1 : 0;   // the door beside the garage, by the driveway's path
    const F = { o: new V3(hx0, 0, 0), ux: [1, 0], n: [0, 1] };
    for (let k = 0; k < slots; k++) {
      const cx = (k + 0.5) * sw;
      if (k === doorSlot) {
        const dx = hx0 + cx, door = pick(M.doors);
        Bx(door, dx, 0.15 + 1.07, 0.03, 1.0, 2.14, 0.08, 0, 0, false);
        Bx(trim, dx, 2.36, 0.06, 1.3, 0.14, 0.1, 0, 0, false);
        for (const sg of [-1, 1]) Bx(trim, dx + sg * 0.57, 1.22, 0.06, 0.14, 2.14, 0.1, 0, 0, false);
        Bx(M.glass, dx, 1.75, 0.08, 0.36, 0.5, 0.02, 0, 0, false);
        Bx(M.stone, dx, 0.2, 0.75, 2.2, 0.1, 1.5, 1.2); Bx(M.stone, dx, 0.08, 1.7, 1.6, 0.16, 0.5, 1.2);
        if (!lod) {
          // porch canopy on two posts
          Bx(roof, dx, 2.75, 0.85, 2.4, 0.12, 1.8, 2); Bx(trim, dx, 2.65, 0.85, 2.3, 0.12, 1.7, 0, 0, false);
          for (const sg of [-1, 1]) Bx(trim, dx + sg * 1.05, 1.45, 1.6, 0.14, 2.45, 0.14);
          if (potP) { const pp = potP.clone(); pp.applyMatrix4(LM.clone().multiply(mat4(dx + 0.85, 0.25, 1.15))); scene.add(pp); }
        }
        houses[houses.length - 1].doorLocal = new V3(dx, 0, 1.7);
      } else windowOn(F, cx, 1.55, 1.25, 1.45, trim, shut, lod);
      if (two) windowOn(F, cx, 4.3, 1.15, 1.3, trim, shut, lod);
    }
    // back and sides
    const Bk = { o: new V3(hx0 + W, 0, -D), ux: [-1, 0], n: [0, -1] };
    for (let k = 0; k < slots; k++) { windowOn(Bk, (k + 0.5) * sw, 1.6, 1.3, 1.4, trim, null, 1); if (two) windowOn(Bk, (k + 0.5) * sw, 4.3, 1.1, 1.2, trim, null, 1); }
    const sideX = gSide > 0 ? hx0 : hx0 + W, sgn = gSide > 0 ? -1 : 1;
    const Sd = { o: new V3(sideX, 0, sgn > 0 ? 0 : -D), ux: [0, sgn > 0 ? -1 : 1], n: [sgn, 0] };
    if (!lod || rnd() < 0.5) { windowOn(Sd, D * 0.3, 1.6, 1.1, 1.3, trim, null, lod); windowOn(Sd, D * 0.7, 1.6, 1.1, 1.3, trim, null, lod); if (two) windowOn(Sd, D * 0.5, 4.3, 1.0, 1.1, trim, null, lod); }
    // chimney on the gable end away from the garage
    if (rnd() < 0.5) { const cxh = gSide > 0 ? hx0 + 0.7 : hx0 + W - 0.7; Bx(M.chim, cxh, H + 1.0, -D * 0.62, 0.8, H > 4 ? 6 : 5.0, 0.8, 1.6); Bx(M.stone, cxh, H + (H > 4 ? 4.05 : 3.55), -D * 0.62, 0.95, 0.12, 0.95); }
    // a flower bed along the front, with shrubs
    if (!lod) {
      const bx0 = gSide > 0 ? hx0 + 0.3 : hx0 + sw + 0.3, bx1 = gSide > 0 ? hx0 + W - sw - 0.3 : hx0 + W - 0.3;
      Bx(M.soil, (bx0 + bx1) / 2, 0.01, 0.75, bx1 - bx0, 0.06, 1.0, 1.5, 0, false);
      for (let x = bx0 + 0.6; x < bx1 - 0.4; x += rr(1.2, 1.9)) { const v = new V3(x, 0, 0.75).applyMatrix4(LM); bush(v.x, 0.15, v.z, rr(0.4, 0.62)); }
    }
    return { W, D, gW, gx0, gSide, tot, hx0, H };
  }

  // a row of lots along the street: u = |d| of the house fronts, sg = side, inward = faces the main street
  function row({ sg, u, inward, lotW, s0, s1, kerbDist, paveAt, lod, backFence, sideFenceTo, driveCars = 0.55 }) {
    for (let s = s0; s <= s1; s += lotW / Math.max(0.4, 1 - curv(xOfS(s)) * sg * u)) {
      const x = xOfS(s), p = P(x, sg * u);
      const nx = -p.tz, nz = p.tx, fx = (inward ? -sg : sg) * nx, fz = (inward ? -sg : sg) * nz, yaw = Math.atan2(fx, fz);
      LM = new THREE.Matrix4().compose(new V3(p.x, 0.15, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new V3(1, 1, 1));
      houses.push({ x: p.x, z: p.z, yaw, s, d: sg * u });
      const h = house(u, lod);
      const hrec = houses[houses.length - 1]; hrec.door = hrec.doorLocal ? hrec.doorLocal.clone().applyMatrix4(LM) : new V3(p.x, 0.15, p.z);
      // driveway from the garage to the kerb, crossing the pavement
      const gcx = h.gx0 + h.gW / 2, dW = h.gW > 5 ? 5.4 : 3.2, dl = kerbDist + 0.2 - 0.4;
      DRIVES.push(new V3(gcx, 0, kerbDist).applyMatrix4(LM));
      Bx(M.drive, gcx, 0.0, 0.4 + dl / 2, dW, 0.1, dl, 3, 0, false);
      // a path from the door to the pavement
      if (hrec.doorLocal) { const pl = paveAt - 1.95; Bx(M.stone, hrec.doorLocal.x, 0.0, 1.95 + pl / 2, 1.1, 0.08, pl, 1.2, 0, false); }
      // parked car(s) on the driveway, nose to the garage
      if (rnd() < driveCars) {
        const n = dW > 4 && rnd() < 0.4 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const off = n === 2 ? (k ? 1.3 : -1.3) : 0, cz = rr(3.6, 4.4), v = new V3(gcx + off, 0.05, cz).applyMatrix4(LM);
          const dir = new V3(0, 0, -1).transformDirection(LM);
          placeCar(makeCar(rnd() < 0.45 ? "suv" : "sedan", pick(paints)), v.x, 0.2, v.z, dir.x, dir.z);
        }
      }
      // mailbox by the driveway at the pavement
      const mx = gcx + (h.gSide > 0 ? -1 : 1) * (dW / 2 + 0.6), mz = paveAt - 0.4;
      Bx(M.picket, mx, 0.55, mz, 0.1, 1.1, 0.1, 0, 0, true);
      { const g = new THREE.CylinderGeometry(0.13, 0.13, 0.5, 14, 1, false, 0, PI); g.rotateZ(PI / 2); g.rotateY(PI / 2); Pm(g, M.mailbox, mx, 1.2, mz, 0); }
      Bx(M.mailbox, mx, 1.135, mz, 0.26, 0.13, 0.5);
      if (!lod) Bx(M.mailRed, mx + 0.14, 1.3, mz - 0.12, 0.02, 0.22, 0.05, 0, 0, false);
      // wheelie bins at the end of some driveways
      if (!lod && rnd() < 0.4) for (const [k, bm] of [[0, M.binG], [1, M.binB]]) {
        const bx = gcx + (h.gSide > 0 ? 1 : -1) * (dW / 2 + 0.45 + k * 0.72); Bx(bm, bx, 0.53, paveAt - 0.55, 0.58, 1.05, 0.7); Bx(M.binK, bx, 1.08, paveAt - 0.55, 0.62, 0.06, 0.74, 0, 0, false);
      }
      // garden: a tree on the open side of the lawn, a hedge or a picket fence on the lot line
      if (rnd() < (lod ? 0.55 : 0.75)) { const tx = -h.gSide * rr(6.5, 9.5), tz = rr(3.5, paveAt - 3.5), v = new V3(tx, 0, tz).applyMatrix4(LM); tree(v.x, v.z, { lod }); }
      const lx = lotW / 2 - 0.1;
      if (rnd() < 0.6) hedge(LM, lx, -2, lx, paveAt - 0.5, rr(0.9, 1.3), 0.8, lod);
      else for (let z = -1.5; z < paveAt - 0.6; z += 0.16) Bx(M.picket, lx, 0.45, z, 0.06, 0.9, 0.09, 0, 0, true);
      // back garden fences
      const fz0 = -Math.max(h.D, 7) - 0.8;
      if (sideFenceTo) for (let z = fz0; z > sideFenceTo + 0.1; z -= 2.4) { const len = Math.min(2.4, z - sideFenceTo); Bx(M.fence, lx, 0.9, z - len / 2, 0.06, 1.8, len, 2.4); Bx(M.post, lx, 0.95, z, 0.12, 1.9, 0.12); }
      if (backFence) for (let x = -lotW / 2; x < lotW / 2 - 0.1; x += 2.4) { const len = Math.min(2.4, lotW / 2 - x); Bx(M.fence, x + len / 2, 0.9, backFence, len, 1.8, 0.06, 2.4); Bx(M.post, x, 0.95, backFence, 0.12, 1.9, 0.12); }
      // a back-garden tree, a patio
      if (rnd() < 0.5 && sideFenceTo) { const v = new V3(rr(-lotW / 2 + 4, lotW / 2 - 4), 0, rr(sideFenceTo + 4, fz0 - 4)).applyMatrix4(LM); tree(v.x, v.z, { lod: 1, h: rr(2.5, 4) }); }
      if (!lod) Bx(M.stone, h.hx0 + h.W / 2, 0.0, -h.D - 2.2, Math.min(6, h.W - 1), 0.1, 4, 1.2, 0, false);
    }
  }
  const D = { ROAD: 4, VERGE: 5.6, PAVE_IN: 5.6, PAVE_OUT: 7.4, FRONT: 18, BACK_FENCE: 48, LOT: 26 };
  for (const sg of [1, -1]) {
    const off = sg > 0 ? 0 : 13;
    row({ sg, u: 18, inward: true, lotW: 26, s0: -312 + off, s1: 312, kerbDist: 18 - 4.25, paveAt: 18 - 7.4, lod: 0, backFence: -(48 - 18), sideFenceTo: -(48 - 18) });
    row({ sg, u: 67, inward: false, lotW: 24, s0: -270 + off, s1: 270, kerbDist: 77.6 - 67, paveAt: 75.8 - 67, lod: 1, backFence: 0, sideFenceTo: -(67 - 48) });
    row({ sg, u: 98.4, inward: true, lotW: 25, s0: -240 + off, s1: 240, kerbDist: 98.4 - 86.1, paveAt: 98.4 - 87.9, lod: 1, backFence: -(124 - 98.4), sideFenceTo: -(124 - 98.4) });
  }
  // street trees and lamps on the verges, between driveways
  for (const sg of [1, -1]) {
    const off = sg > 0 ? 0 : 13;
    for (let s = -312 + off + 13; s < 312; s += 26) {
      const p = along(s, sg * 4.92);
      if (Math.round((s - off) / 26) % 2 === 0) tree(p.x, p.z, { h: rr(3.2, 4.2), r: rr(2.6, 3.4) });
      else {
        const q = along(s + 1.2, sg * 4.75), yaw = Math.atan2(-q.tz, q.tx);
        LM = new THREE.Matrix4().compose(new V3(q.x, 0.15, q.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new V3(1, 1, 1));
        Pm(new THREE.CylinderGeometry(0.07, 0.11, 4.4, 10), M.lamp, 0, 2.2, 0);
        Pm(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), M.lamp, 0, 0.15, 0);
        Pm(new THREE.CylinderGeometry(0.06, 0.24, 0.22, 4), M.lamp, 0, 4.98, 0, PI / 4);
        Pm(new THREE.CylinderGeometry(0.2, 0.13, 0.5, 4), M.lampGlass, 0, 4.62, 0, PI / 4);
        Pm(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8), M.lamp, 0, 4.36, 0);
        if (Math.round((s - off) / 26) % 4 === 1) {   // a fire hydrant now and then
          Pm(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 12), M.hydrant, 1.6, 0.3, 0); Pm(new THREE.SphereGeometry(0.14, 12, 8, 0, PI * 2, 0, PI / 2), M.hydrant, 1.6, 0.6, 0);
          Pm(new THREE.CylinderGeometry(0.06, 0.06, 0.36, 8), M.hydrant, 1.6, 0.4, 0, 0, 0, PI / 2);
        }
      }
    }
    // a few family cars at the kerb, facing the way of their lane
    for (let s = -300; s < 300; s += rr(30, 70)) {
      const pd = along(s, sg * 2.95);
      if (DRIVES.some((q) => Math.hypot(q.x - pd.x, q.z - pd.z) < 5.6)) continue;
      placeCar(makeCar(rnd() < 0.4 ? "suv" : "sedan", pick(paints)), pd.x, 0, pd.z, sg * pd.tx, sg * pd.tz);
    }
  }
  // trees in the far band, so the edge of the place reads as more of it
  for (let k = 0; k < 60; k++) { const s = rr(-420, 420), u = rr(128, 190) * (rnd() < 0.5 ? 1 : -1), p = along(s, u); tree(p.x, p.z, { lod: 1, h: rr(3, 5), r: rr(3, 4.5) }); }
  for (let k = 0; k < 40; k++) { const s = rnd() < 0.5 ? rr(-470, -330) : rr(330, 470), u = (rnd() < 0.6 ? rr(10, 70) : rr(92, 125)) * (rnd() < 0.5 ? 1 : -1), p = along(s, u); tree(p.x, p.z, { lod: 1, h: rr(3, 5), r: rr(3, 4.5) }); }

  flush();

  // the leaf cards, one instanced mesh, cut out by alpha, casting cut-out shadows
  {
    const g = new THREE.PlaneGeometry(0.83, 1);
    const mat = std({ map: leafMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: 0xd8e2c8 });
    const mesh = new THREE.InstancedMesh(g, mat, LEAVES.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    LEAVES.forEach((l, i) => {
      mesh.setMatrixAt(i, m.compose(l.p, l.q, _s.set(l.s, l.s, l.s)));
      c.setHSL(0.24 + l.c * 0.03 + rr(-0.015, 0.015), 0.35 + rr(-0.08, 0.08), 0.6 + l.c * 0.06 + rr(-0.12, 0.1)); mesh.setColorAt(i, c);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: 0.5 });
    scene.add(mesh);
  }

  // the moving car
  const movingCar = makeCar("sedan", std({ color: 0x2a5d8f, roughness: 0.25, metalness: 0.7 }));
  movingCar.visible = false; scene.add(movingCar);

  // ------------------------------------------------------------------ people: the cast and the passers-by
  const norm = (n) => (n || "").toLowerCase().replace(/^mixamorig/, "").replace(/[^a-z0-9]/g, "");
  function boneOf(root, names) {
    const want = names.map(norm); let hit = null;
    root.traverse((o) => { if (!hit && o.isBone && want.includes(norm(o.name))) hit = o; });
    return hit;
  }
  function gaitSpeed(f, name, fallback) {
    const foot = boneOf(f.object, ["LeftFoot", "Foot.L"]);
    if (!f.actions[name] || !foot) return fallback;
    const o = f.object, T = f.durations[name]; let lo = 1e9, hi = -1e9;
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
    for (let i = 0; i <= 40; i++) { f.pose((i / 40) * T, name); o.updateMatrixWorld(true); const z = foot.getWorldPosition(new V3()).z; lo = Math.min(lo, z); hi = Math.max(hi, z); }
    const v = (2 * (hi - lo)) / T;
    return v > 0.2 && v < 12 ? v : fallback;
  }
  const CAST = {}, GAIT = {}, MEMBERS = [];
  FIGS.forEach((f, i) => {
    const id = castSpec[i].as || castSpec[i].id;
    f.object.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
    scene.add(f.object);
    const g = { walk: gaitSpeed(f, "walk", 1.35), run: gaitSpeed(f, "run", 3.4) };
    f.pose(0, "idle"); CAST[id] = f; GAIT[id] = g; MEMBERS.push({ id, f, g, i });
  });
  const XTRA = XFIGS.map((f, i) => {
    f.object.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
    scene.add(f.object);
    const v = gaitSpeed(f, "walk", 1.3);
    return { f, v, outfit: EXTRAS[i].outfit, id: EXTRAS[i].id };
  });
  // where the passers-by walk by default: [s at time 0, d, dir]
  const XPATH = [[-16, -6.3, 1], [24, 6.95, -1], [46, -6.7, -1]];
  const spot = (() => { const a = along(0, 6.2); return new V3(a.x, 0.17, a.z); })();
  const LEAD = MEMBERS[0];

  function placeFigure(f, p, def, time) {
    const o = f.object;
    let x, z, heading;
    if (p.s !== undefined || (p.x === undefined && def.s !== undefined)) {
      const s = p.s ?? def.s, d = p.d ?? def.d ?? 6.2, dir = p.dir ?? def.dir ?? 1, a = along(s, d);
      x = a.x; z = a.z; heading = p.heading ?? (dir < 0 ? a.heading + PI : a.heading);
    } else { x = p.x ?? def.x; z = p.z ?? def.z; heading = p.heading ?? def.heading ?? PI / 2; }
    const gt = p.gait || def.gait || {};
    const wk = clamp01(gt.walk ?? 0), rn = clamp01(gt.run ?? 0);
    const w = { idle: Math.max(0, 1 - wk - rn), walk: wk };
    if (f.actions.run) w.run = rn;
    f.pose(p.time ?? time, w);
    o.position.set(x, heightAt(x, z), z); o.rotation.set(0, heading, 0);
    o.visible = (p.show ?? def.show ?? true) !== false;
  }

  function update(st = {}) {
    const time = st.time || 0, people = st.people || {};
    for (const m of MEMBERS) {
      const a = along(-1.4 * m.i, 6.2);
      placeFigure(m.f, people[m.id] || {}, m.i === 0 ? { s: 0, d: 6.2, dir: 1 } : { s: -1.4 * m.i, d: 6.2, dir: 1 }, time);
    }
    const xs = st.extras;
    XTRA.forEach((e, i) => {
      const ov = Array.isArray(xs) ? (xs[i] || {}) : {};
      const [s0, d, dir] = XPATH[i];
      const walk = ov.gait ? clamp01(ov.gait.walk ?? 0) : 1;
      placeFigure(e.f, ov, { s: s0 + dir * e.v * walk * time, d, dir, gait: { walk }, show: xs !== false }, time + i * 0.37);
    });
    // the moving car
    const c = st.car;
    if (c && c.show !== false && c.s !== undefined) {
      const lane = c.lane ?? 1, a = along(c.s, lane * 2.0);
      movingCar.visible = true; movingCar.position.set(a.x, 0, a.z); movingCar.rotation.set(0, Math.atan2(-lane * a.tz, lane * a.tx), 0);
    } else movingCar.visible = false;
    // the sun's shadow box round the focus
    const f = st.focus || (LEAD.f.object.visible ? LEAD.f.object.position : spot);
    const R = st.shadowRadius || Math.min(160, Math.max(22, camera.position.distanceTo(_p.set(f.x, f.y || 0, f.z)) * 0.9));
    sun.position.set(f.x + SK.light.x * 250, (f.y || 0) + SK.light.y * 250, f.z + SK.light.z * 250);
    sun.target.position.set(f.x, f.y || 0, f.z); sun.target.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 50, far: 500 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = 0.02 + R * 0.0008;
  }
  update({});

  return {
    renderer, scene, camera, update, render: () => renderer.render(scene, camera),
    cast: CAST, figure: LEAD.f, person: LEAD.f.object, gaitSpeed: GAIT, extras: XTRA, spot,
    along, roadZ, heightAt, houses, car: movingCar, parked, sun, sunDir: SK.light.clone(), trees, D,
  };
}
