// World "laboratory": a modern science laboratory on an upper floor, by day, bright even ceiling light.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. Floor at y = 0, ceiling at y = 3.0 (world.H).
// The lab is x -14..14, z -9..8. Its SOUTH side (z = 8) is a glass wall (aluminium mullions, a frosted band,
// a door at x 9.6..10.8) onto a CORRIDOR (z 8..11, x -30..30) whose far wall has windows to the sky.
// Three long white island BENCHES run east-west (worktop 0.92 high, 1.6 deep, a steel reagent shelf of bottles
// along each centre line):  N bench z = -4.4 (x -10..9),  S bench z = 0.4 (x -10..9),  S2 bench z = 4.4 (x -10..9).
// The MAIN AISLE runs along x between N and S benches: clear for z -3.45..-0.55, walk line z = -2.0 (world.aisle).
// On the benches: microscopes, chemistry glassware, beakers and flasks, pipettes and tip boxes, centrifuges,
// balances, small screens, sinks at the west ends; metal stools tucked under the bench edges.
// NORTH wall (z = -9): a wall counter and a WALL OF MONITORS with charts (2 rows of 4, centre world.monitors).
// WEST wall (x = -14): three FUME CUPBOARDS (z -6.6, -4.6, -2.6) with lit interiors and glass sashes, then tall
// cabinets, a safety shower and a coat rack. EAST wall (x = 14): steel SHELVES OF BOTTLES (z -8..-2), an upright
// fridge, a wall clock. Recessed ceiling panel lights in a grid; they hide when the camera rises above y = 2.95
// (the ceiling is one-sided, so a camera above it looking down sees the whole floor as a cutaway).
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], crowd}) -> world.
//   cast:  library characters, each "id" or {id, outfit: {shirt, trousers}, as}; each is world.cast.<as || id>.
//   crowd: background people, [{id, outfit, x, z, heading, clip, walk: {x0, x1, z, phase}}]. A crowd member with
//          `walk` walks the corridor (or any line) from x0 towards x1 at its measured gait speed, wrapping.
//          Default: four people in outfits unlike the main person's white shirt (blue at the S bench, teal at the
//          S2 bench, grey at a fume cupboard, a rust-shirted man walking the corridor). crowd: [] for none.
// Per frame: set world.camera, then world.update(state), then world.render().
//
// state (every field optional):
//   time         seconds of the shot (animation clock)
//   people       {<cast key>: {x, z, heading, time, gait: {walk, run, jog, talk}, clip, show}}
//                heading radians about +y: 0 faces +z (south), PI faces north (the N bench from the aisle),
//                PI/2 faces east (+x, along the aisle). gait weights 0..1, idle takes the rest. Move a walker by
//                world.gaitSpeed.<key>.walk * walk * dt so the feet never slide. Default: cast[0] stands at the
//                N bench microscope, x = -2, z = -3.2, facing north (world.spot); later cast members beside it.
//   crowd        {<index>: {x, z, heading, time, clip, show}} overrides; crowd: false hides them all
//   ceiling      true/false forces the ceiling fixtures on or off
//   focus        {x, y, z} centre of the light's shadow box (default: cast[0])
//   shadowRadius metres of the shadow box (default from the camera's distance to the focus)
//
// Exposes: world.cast.<key>, world.person (cast[0].object), world.crowd, world.gaitSpeed.<key> {walk, run, jog} m/s,
// world.spot (Vector3), world.microscope (Vector3, the one at the spot), world.aisle {z, x0, x1, halfWidth},
// world.benches [{name, x0, x1, z, depth, top}], world.fumeCupboards [Vector3], world.monitors (Vector3 centre),
// world.shelves (Vector3), world.corridor {z, x0, x1, glassZ}, world.door {x, z}, world.sun, world.sunDir,
// world.H (3.0), world.bounds {x0, x1, z0, z1}, world.ceilingGroup.
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], crowd } = {}) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const W = canvas.width || 1920, Hh = canvas.height || 1080;

  // ---------------------------------------------------------------- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, Hh, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe6ebef, 22, 160);
  const camera = new THREE.PerspectiveCamera(40, W / Hh, 0.05, 2000);
  camera.position.set(12, 2.4, -2); camera.lookAt(-6, 1.1, -2);

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f, srgb) => new Promise((res, rej) => TL.load(K + f, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); }, undefined, rej));
  const pbrSet = async (n) => { const [d, no, r] = await Promise.all([tex(`pbr/${n}_diff.jpg`, true), tex(`pbr/${n}_nor.jpg`), tex(`pbr/${n}_rough.jpg`)]); return { d, no, r }; };
  const castList = cast.map((c) => (typeof c === "string" ? { id: c } : c));
  const castKeys = castList.map((c) => c.as || c.id);
  const crowdList = crowd ?? [
    { id: "man", outfit: { shirt: "#3f6e9e", trousers: "#2b303b" }, x: 4.4, z: -0.78, heading: 0, clip: "idle" },
    { id: "woman", outfit: { shirt: "#2f8a7e", trousers: "#3a3844" }, x: -5.2, z: 5.58, heading: PI, clip: "idle" },
    { id: "man", outfit: { shirt: "#62666e", trousers: "#22252b" }, x: -12.55, z: -4.6, heading: -PI / 2, clip: "idle" },
    { id: "man", outfit: { shirt: "#9a5038", trousers: "#2f3036" }, walk: { x0: -26, x1: 26, z: 9.7, phase: 0.42 } },
  ];
  const clipsFor = (id) => ({ man: ["idle", "walk", "run", "jog", "talk"], woman: ["idle", "walk", "run", "jog", "talk"], robot: ["idle", "walk", "run", "wave"] }[id] || ["idle", "walk", "run"]);
  const [sky, concrete, scope, chemset, stool, clock, plant, ...figs] = await Promise.all([
    new HDRLoader().loadAsync(K + "sky/day.hdr"), pbrSet("concrete"),
    loadProp({ THREE, id: "industrial_microscope" }), loadProp({ THREE, id: "chemistry_set" }), loadProp({ THREE, id: "metal_stool_02" }),
    loadProp({ THREE, id: "wall_clock" }), loadProp({ THREE, id: "potted_plant_01" }),
    ...castList.map((c) => loadFigure({ THREE, id: c.id, clips: clipsFor(c.id), outfit: c.outfit || null })),
    ...crowdList.map((c) => loadFigure({ THREE, id: c.id, clips: clipsFor(c.id), outfit: c.outfit || null })),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.environmentIntensity = 0.55; scene.backgroundIntensity = 1.0;

  // ---------------------------------------------------------------- helpers
  let seed = 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const std = (o) => new THREE.MeshStandardMaterial(o);
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  // a kit surface on a box with its texture at a real size (tile metres), never stretched
  function boxUV(geo, w, h, d, tu, tv = tu) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tu, uv.getY(k) * dims[f][1] / tv); }
    return geo;
  }
  const box = (w, h, d, tu) => (tu ? boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tu) : new THREE.BoxGeometry(w, h, d));
  const cyl = (r0, r1, h, n = 16, open = false) => new THREE.CylinderGeometry(r0, r1, h, n, 1, open);
  const _e = new THREE.Euler(), _q = new THREE.Quaternion();
  const M = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), new V3(s, s, s));
  const I = new THREE.Matrix4();
  const bins = new Map();
  function put(geo, mat, m = I, { cast: cs = true, recv = true, group = "static", order = 0 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const key = `${mat.uuid}|${cs}|${recv}|${group}|${order}`;
    if (!bins.has(key)) bins.set(key, { mat, cs, recv, group, order, list: [] });
    bins.get(key).list.push(g.applyMatrix4(m));
  }
  const groups = { static: new THREE.Group(), ceiling: new THREE.Group() };
  for (const g of Object.values(groups)) scene.add(g);
  function flush() {
    for (const b of bins.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(b.list, false), b.mat);
      mesh.castShadow = b.cs; mesh.receiveShadow = b.recv; mesh.renderOrder = b.order; groups[b.group].add(mesh);
    }
    bins.clear();
  }
  // a library prop scaled to a height (or to fit a footprint), standing on y
  function prop(src, { h, fit, x, y = 0, z, ry = 0 }) {
    const o = src.clone(true); const bb = new THREE.Box3().setFromObject(src), sz = bb.getSize(new V3());
    let s = h ? h / Math.max(0.01, sz.y) : 1; if (fit) s = Math.min(s, fit / Math.max(sz.x, sz.z));
    o.scale.setScalar(s); o.rotation.y = ry;
    const c = bb.getCenter(new V3());
    const off = new V3(-c.x * s, -bb.min.y * s, -c.z * s).applyAxisAngle(new V3(0, 1, 0), ry);
    o.position.set(x + off.x, y + off.y, z + off.z);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); scene.add(o); return o;
  }

  // ---------------------------------------------------------------- materials
  const H = 3.0, X0 = -14, X1 = 14, Z0 = -9, Z1 = 8, CZ1 = 11, CX = 30;
  const mkPbr = (set, o = {}) => std({ map: set.d, normalMap: set.no, roughnessMap: set.r, ...o });
  const floorM = mkPbr(concrete, { roughness: 0.42, normalScale: new THREE.Vector2(0.25, 0.25) }); floorM.color.setRGB(1.45, 1.52, 1.6);
  const corrFloorM = mkPbr(concrete, { roughness: 0.55, normalScale: new THREE.Vector2(0.3, 0.3) }); corrFloorM.color.setRGB(0.95, 0.93, 0.9);
  const ceilTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = "#efefec"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    g.fillStyle = "#c9c9c4"; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); });
  const ceilM = std({ map: ceilTex, roughness: 0.95, emissive: 0x9c9c98 });
  const plasterM = std({ color: 0xeceeee, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 1, normalScale: new THREE.Vector2(0.2, 0.2) });
  const accentM = std({ color: 0x5f8fa8, normalMap: concrete.no, roughness: 0.9, normalScale: new THREE.Vector2(0.2, 0.2) });
  const columnM = mkPbr(concrete, { roughness: 1 }); columnM.color.setRGB(1.7, 1.7, 1.68);
  const cabM = std({ color: 0xf1f2f0, roughness: 0.4 });
  const topM = std({ color: 0xf6f7f6, roughness: 0.3, normalMap: concrete.no, normalScale: new THREE.Vector2(0.06, 0.06) });
  const plinthM = std({ color: 0x4a4f55, roughness: 0.6 });
  const handleM = std({ color: 0x9aa1a7, roughness: 0.3, metalness: 0.9 });
  const steel = std({ color: 0xc7cbcf, roughness: 0.28, metalness: 0.9 });
  const alu = std({ color: 0xb4b9bd, roughness: 0.35, metalness: 0.85 });
  const darkM = std({ color: 0x202327, roughness: 0.5, metalness: 0.3 });
  const greyM = std({ color: 0x8f959b, roughness: 0.45, metalness: 0.2 });
  const whiteP = std({ color: 0xe9ebea, roughness: 0.35 });
  const resinM = std({ color: 0x2a2d31, roughness: 0.35 });
  const glassM = new THREE.MeshStandardMaterial({ color: 0xdfeef3, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  const labGlass = new THREE.MeshStandardMaterial({ color: 0xe8f4f7, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const frostM = new THREE.MeshStandardMaterial({ color: 0xf4f7f8, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const lightM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.2, 2.2, 2.1) });
  const liquidM = ["#3d8fd6", "#e0a531", "#55b36a", "#d0485a", "#9b6ad6", "#f0eee2"].map((c) => std({ color: c, roughness: 0.15, transparent: true, opacity: 0.78, emissive: c, emissiveIntensity: 0.12 }));
  const amberM = std({ color: 0x7a3e12, roughness: 0.12, metalness: 0.1 });
  const clearBotM = std({ color: 0xcfe2e6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.6 });
  const capM = ["#2a62b8", "#c23b2f", "#f1f1ef", "#1e1f22", "#e3b51c", "#2d8a4f"].map((c) => std({ color: c, roughness: 0.4 }));
  const tipM = ["#2f7fd1", "#e8c22a", "#f2f2f0"].map((c) => std({ color: c, roughness: 0.3, transparent: true, opacity: 0.85 }));

  // screens: charts, a heatmap, a spectrum, a molecule, a dashboard
  const scr = (f) => { const m = std({ map: canvasTex(640, 380, f), roughness: 0.2 }); m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0.85; m.color.setRGB(0.25, 0.25, 0.25); return m; };
  const axes = (g, w, h) => { g.strokeStyle = "rgba(220,230,245,0.35)"; g.lineWidth = 1; for (let y = 60; y < h - 30; y += 40) { g.beginPath(); g.moveTo(50, y); g.lineTo(w - 24, y); g.stroke(); }
    g.fillStyle = "#e8eef7"; g.fillRect(24, 18, 190, 14); g.fillStyle = "#7d8ba3"; g.fillRect(24, 38, 120, 8); };
  const screenM = [
    (g, w, h) => { g.fillStyle = "#0d1624"; g.fillRect(0, 0, w, h); axes(g, w, h);
      for (const [c, o] of [["#4cc3ff", 0], ["#ffb547", 50], ["#7ee08a", 100]]) { g.strokeStyle = c; g.lineWidth = 3; g.beginPath();
        for (let x = 0; x <= w - 80; x += 12) { const y = h - 60 - o * 0.6 - x * 0.25 - Math.sin(x * 0.03 + o) * 30 - rnd() * 14; x ? g.lineTo(54 + x, y) : g.moveTo(54, y); } g.stroke(); } },
    (g, w, h) => { g.fillStyle = "#0f1a2b"; g.fillRect(0, 0, w, h); axes(g, w, h);
      for (let i = 0; i < 12; i++) { const bh = 40 + rnd() * 230; g.fillStyle = i % 4 === 3 ? "#ff7a59" : "#3aa0ff"; g.fillRect(60 + i * 46, h - 34 - bh, 30, bh); } },
    (g, w, h) => { g.fillStyle = "#0b1220"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) for (let j = 0; j < 8; j++) { const v = Math.sin(i * 0.5 + j * 0.8) * 0.5 + 0.5 * rnd(); g.fillStyle = `hsl(${220 - v * 200},80%,${35 + v * 25}%)`; g.fillRect(40 + i * 40, 60 + j * 36, 38, 34); }
      g.fillStyle = "#e8eef7"; g.fillRect(40, 20, 170, 14); },
    (g, w, h) => { g.fillStyle = "#101826"; g.fillRect(0, 0, w, h); axes(g, w, h); g.strokeStyle = "#b388ff"; g.lineWidth = 2.5; g.beginPath();
      for (let x = 0; x <= w - 80; x += 3) { let y = 8; for (const p of [110, 230, 300, 420, 470]) y += 210 * Math.exp(-((x - p) ** 2) / (2 * (6 + (p % 7)) ** 2)) * (0.5 + (p % 5) / 8); x ? g.lineTo(54 + x, h - 40 - y) : g.moveTo(54, h - 40 - y); } g.stroke(); },
    (g, w, h) => { g.fillStyle = "#0e1522"; g.fillRect(0, 0, w, h); const pts = [];
      for (let i = 0; i < 18; i++) pts.push([w / 2 + Math.cos(i * 1.7) * (60 + (i % 5) * 26), h / 2 + Math.sin(i * 1.3) * (50 + (i % 4) * 24)]);
      g.strokeStyle = "rgba(200,220,255,0.6)"; g.lineWidth = 3; for (let i = 1; i < pts.length; i++) { g.beginPath(); g.moveTo(...pts[i - 1]); g.lineTo(...pts[i]); g.stroke(); }
      for (const [i, p] of pts.entries()) { g.fillStyle = ["#ff5a5a", "#5ad1ff", "#f2f2f2", "#ffd25a"][i % 4]; g.beginPath(); g.arc(p[0], p[1], 12, 0, 7); g.fill(); } },
    (g, w, h) => { g.fillStyle = "#f3f5f8"; g.fillRect(0, 0, w, h); g.fillStyle = "#1c3557"; g.fillRect(0, 0, w, 34);
      for (let i = 0; i < 3; i++) { g.fillStyle = "#fff"; g.fillRect(24 + i * 202, 52, 188, 90); g.fillStyle = ["#2f80ed", "#27ae60", "#eb5757"][i]; g.fillRect(40 + i * 202, 100, 60 + rnd() * 90, 20); }
      g.fillStyle = "#fff"; g.fillRect(24, 160, w - 48, 196); g.strokeStyle = "#2f80ed"; g.lineWidth = 3; g.beginPath();
      for (let x = 0; x <= w - 90; x += 20) { const y = 330 - x * 0.22 - rnd() * 60; x ? g.lineTo(44 + x, y) : g.moveTo(44, y); } g.stroke(); },
  ].map(scr);
  const signM = (draw) => std({ map: canvasTex(256, 256, draw), roughness: 0.6 });
  const hazardSign = signM((g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#f2c200"; g.beginPath(); g.moveTo(128, 24); g.lineTo(236, 210); g.lineTo(20, 210); g.closePath(); g.fill();
    g.strokeStyle = "#111"; g.lineWidth = 10; g.stroke(); g.fillStyle = "#111"; g.fillRect(118, 80, 20, 80); g.fillRect(118, 172, 20, 20); });
  const greenSign = signM((g, w, h) => { g.fillStyle = "#1c8a3e"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.fillRect(100, 40, 56, 176); g.fillRect(40, 100, 176, 56); });

  // ---------------------------------------------------------------- the room shell
  put(box(X1 - X0, 0.1, Z1 - Z0, 3), floorM, M(0, -0.05, (Z0 + Z1) / 2), { cast: false });
  put(box(2 * CX, 0.1, CZ1 - Z1, 3), corrFloorM, M(0, -0.05, (Z1 + CZ1) / 2), { cast: false });
  { const cg = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0); const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0) / 0.6, uv.getY(i) * (Z1 - Z0) / 0.6);
    const ceil = new THREE.Mesh(cg, ceilM); ceil.rotation.x = PI / 2; ceil.position.set(0, H, (Z0 + Z1) / 2); groups.ceiling.add(ceil);
    const cc = new THREE.PlaneGeometry(2 * CX, CZ1 - Z1); const uv2 = cc.attributes.uv; for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * 2 * CX / 0.6, uv2.getY(i) * (CZ1 - Z1) / 0.6);
    const c2 = new THREE.Mesh(cc, ceilM); c2.rotation.x = PI / 2; c2.position.set(0, H, (Z1 + CZ1) / 2); groups.ceiling.add(c2); }
  // north wall, with a blue accent band; west and east walls; corridor end walls
  put(box(X1 - X0 + 0.4, H, 0.2, 3), plasterM, M(0, H / 2, Z0 - 0.1));
  put(box(0.2, H, Z1 - Z0, 3), plasterM, M(X0 - 0.1, H / 2, (Z0 + Z1) / 2));
  put(box(0.2, H, Z1 - Z0, 3), plasterM, M(X1 + 0.1, H / 2, (Z0 + Z1) / 2));
  put(box(X1 - X0, 0.36, 0.02), accentM, M(0, 2.55, Z0 + 0.01), { cast: false });
  for (const sx of [-1, 1]) put(box(0.2, H, CZ1 - Z1 + 0.2, 3), plasterM, M(sx * (CX + 0.1), H / 2, (Z1 + CZ1) / 2));
  // skirting all round
  put(box(X1 - X0, 0.1, 0.02), plinthM, M(0, 0.05, Z0 + 0.01), { cast: false });
  for (const sx of [-1, 1]) put(box(0.02, 0.1, Z1 - Z0), plinthM, M(sx * (X1 - 0.01), 0.05, (Z0 + Z1) / 2), { cast: false });
  // columns in the corners of the bench zone
  const COLS = [];
  for (const cx of [-10.9, 10.6]) for (const cz of [-6.8, 2.4]) { put(box(0.5, H, 0.5, 3), columnM, M(cx, H / 2, cz)); COLS.push(new V3(cx, 0, cz)); }

  // ---------------------------------------------------------------- the glass wall to the corridor (z = Z1), with a door
  const DOOR = { x0: 9.6, x1: 10.8 };
  {
    const panes = [];
    let x = X0; const stops = [];
    while (x < X1 - 0.01) { stops.push(x); x += 1.4; } stops.push(X1);
    for (const sx of stops) put(box(0.06, H, 0.12), alu, M(sx, H / 2, Z1));
    put(box(X1 - X0, 0.1, 0.14), alu, M(0, 0.05, Z1)); put(box(X1 - X0, 0.1, 0.14), alu, M(0, H - 0.05, Z1));
    put(box(X1 - X0, 0.05, 0.1), alu, M(0, 2.3, Z1));
    // panes, with the door gap left open between DOOR.x0..x1 below the transom
    const gp = (a, b, y0, y1) => { const g = new THREE.PlaneGeometry(b - a, y1 - y0); g.applyMatrix4(M((a + b) / 2, (y0 + y1) / 2, Z1)); panes.push(g); };
    gp(X0, DOOR.x0, 0.1, 2.3); gp(DOOR.x1, X1, 0.1, 2.3); gp(X0, X1, 2.3, H - 0.1);
    const pm = new THREE.Mesh(mergeGeometries(panes, false), glassM); pm.renderOrder = 3; scene.add(pm);
    // frosted manifestation band at eye height (not across the door)
    for (const [a, b] of [[X0, DOOR.x0], [DOOR.x1, X1]]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.14), frostM); f.position.set((a + b) / 2, 1.42, Z1 + 0.005); f.renderOrder = 4; scene.add(f); }
    // the door: an open glass leaf swung into the corridor, a steel handle
    const leaf = new THREE.Group(); leaf.position.set(DOOR.x0, 0, Z1);
    const lg = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 2.18), glassM); lg.position.set(0.58, 1.12, 0); lg.renderOrder = 3; leaf.add(lg);
    const lf = [box(1.2, 0.08, 0.05), box(1.2, 0.08, 0.05), box(0.06, 2.2, 0.05), box(0.06, 2.2, 0.05)].map((g) => new THREE.Mesh(g, alu));
    lf[0].position.set(0.6, 0.04, 0); lf[1].position.set(0.6, 2.22, 0); lf[2].position.set(0.03, 1.12, 0); lf[3].position.set(1.17, 1.12, 0);
    const hd = new THREE.Mesh(cyl(0.015, 0.015, 0.8, 8), steel); hd.position.set(1.05, 1.05, 0.06);
    leaf.add(...lf, hd); leaf.rotation.y = -1.1; leaf.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(leaf);
    // door sign
    put(box(0.3, 0.3, 0.01), hazardSign, M(DOOR.x1 + 0.35, 1.75, Z1 - 0.07), { cast: false });
  }

  // ---------------------------------------------------------------- the corridor: far wall with windows, lights, a bench, a plant
  {
    const WZ = CZ1;
    put(box(2 * CX, 0.9, 0.25, 3), plasterM, M(0, 0.45, WZ + 0.12));
    put(box(2 * CX, 0.6, 0.25, 3), plasterM, M(0, H - 0.3, WZ + 0.12));
    put(box(2 * CX, 0.04, 0.32), whiteP, M(0, 0.92, WZ - 0.02));
    const panes = [];
    for (let x = -CX; x <= CX + 0.01; x += 2.5) put(box(0.2, H, 0.27, 3), plasterM, M(x, H / 2, WZ + 0.12));
    for (let x = -CX + 1.25; x < CX; x += 2.5) { put(box(0.05, 1.5, 0.08), alu, M(x, 1.65, WZ + 0.12)); const g = new THREE.PlaneGeometry(2.3, 1.5); g.applyMatrix4(M(x, 1.65, WZ + 0.14)); panes.push(g); }
    const pm = new THREE.Mesh(mergeGeometries(panes, false), new THREE.MeshStandardMaterial({ color: 0xd8e6ee, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    pm.renderOrder = 2; scene.add(pm);
    for (let x = -CX + 2; x < CX; x += 3) { put(box(1.2, 0.03, 0.3), lightM, M(x, H - 0.01, (Z1 + CZ1) / 2), { cast: false, group: "ceiling" }); }
    // a bench and plants along the corridor window
    for (const x of [-6, 6]) { put(box(1.6, 0.06, 0.45), std({ color: 0xb98d5f, roughness: 0.6 }), M(x, 0.45, WZ - 0.42)); for (const e of [-0.7, 0.7]) put(box(0.05, 0.42, 0.4), darkM, M(x + e, 0.21, WZ - 0.42)); }
    prop(plant, { h: 1.3, x: -2.2, z: WZ - 0.4 }); prop(plant, { h: 1.15, x: 3.1, z: WZ - 0.4, ry: 1.7 });
    // a fire extinguisher by the door
    put(cyl(0.08, 0.08, 0.5, 14), std({ color: 0xc8241c, roughness: 0.35 }), M(DOOR.x1 + 1.2, 0.35, Z1 + 0.2));
    put(box(0.3, 0.3, 0.01), greenSign, M(-4, 2.0, WZ - 0.02), { cast: false });
  }
  // outside the corridor windows: the campus far below, other blocks, all softened by haze
  {
    const GY = -14;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1200, 800), std({ color: 0x7d8a6a, roughness: 1 })); g.rotation.x = -PI / 2; g.position.set(0, GY, 300); scene.add(g);
    const facade = canvasTex(256, 256, (c, w, h) => { c.fillStyle = "#d8d6cf"; c.fillRect(0, 0, w, h); for (let y = 10; y < h; y += 32) for (let x = 8; x < w; x += 32) { c.fillStyle = `rgb(${60 + rnd() * 40},${80 + rnd() * 40},${100 + rnd() * 40})`; c.fillRect(x, y, 22, 18); } });
    for (let i = 0; i < 26; i++) { const w = rr(18, 40), hgt = rr(14, 50), d = rr(16, 30), x = rr(-220, 220), z = rr(70, 360);
      const geo = box(w, hgt, d); const m = std({ map: facade, roughness: 0.8 }); m.map = facade.clone(); m.map.repeat.set(w / 8, hgt / 8); m.map.needsUpdate = true;
      const b = new THREE.Mesh(geo, m); b.position.set(x, GY + hgt / 2, z); scene.add(b); }
    for (let i = 0; i < 40; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(rr(3, 6), 10, 8), std({ color: 0x4f6b3a, roughness: 1 })); t.position.set(rr(-200, 200), GY + 3, rr(30, 200)); scene.add(t); }
    // the building's own facade below the corridor so the floor never floats from outside
    put(box(2 * CX + 0.4, 14, 0.3), columnM, M(0, -7, CZ1 + 0.2), { cast: false });
  }

  // ---------------------------------------------------------------- benches
  const TOP = 0.92;
  const benches = [
    { name: "N", x0: -10, x1: 9, z: -4.4, depth: 1.6, top: TOP },
    { name: "S", x0: -10, x1: 9, z: 0.4, depth: 1.6, top: TOP },
    { name: "S2", x0: -10, x1: 9, z: 4.4, depth: 1.6, top: TOP },
  ];
  const SPOT = new V3(-2, 0, -3.2);
  const sinkX = -9.2;
  const glassRows = [];   // positions for glass items, filled below
  for (const b of benches) {
    const L = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, D = b.depth;
    put(box(L, 0.1, D - 0.16), plinthM, M(cx, 0.05, b.z));
    put(box(L, TOP - 0.14, D - 0.08), cabM, M(cx, 0.1 + (TOP - 0.14) / 2, b.z));
    put(box(L + 0.04, 0.04, D + 0.04), topM, M(cx, TOP - 0.02, b.z));
    // cabinet doors, drawers and handles on both long faces
    for (const sz of [-1, 1]) for (let x = b.x0 + 0.3; x < b.x1 - 0.2; x += 0.6) {
      const fz = b.z + sz * (D / 2 - 0.035);
      put(box(0.004, TOP - 0.2, 0.01), greyM, M(x - 0.3, 0.1 + (TOP - 0.14) / 2, fz), { cast: false });
      put(box(0.16, 0.015, 0.02), handleM, M(x, TOP - 0.17, fz + sz * 0.01), { cast: false });
      put(box(0.56, 0.004, 0.01), greyM, M(x, TOP - 0.24, fz), { cast: false });
    }
    // the central reagent shelf: steel uprights, two shelves, a service spine with sockets
    put(box(L - 0.2, 0.22, 0.14), whiteP, M(cx, TOP + 0.11, b.z));
    for (let x = b.x0 + 0.6; x < b.x1 - 0.3; x += 1.2) for (const sz of [-1, 1]) put(box(0.07, 0.04, 0.005), darkM, M(x, TOP + 0.13, b.z + sz * 0.072), { cast: false });
    for (let x = b.x0 + 0.15; x <= b.x1 - 0.1; x += (L - 0.3) / 6) put(box(0.04, 1.0, 0.04), steel, M(x, TOP + 0.5, b.z));
    for (const y of [TOP + 0.5, TOP + 0.92]) put(box(L - 0.2, 0.025, 0.34), steel, M(cx, y, b.z));
    // bottles on the shelves
    for (const y of [TOP + 0.5, TOP + 0.92]) for (let x = b.x0 + 0.25; x < b.x1 - 0.25; x += rr(0.12, 0.3)) {
      if (rnd() < 0.2) { x += 0.3; continue; }
      const kind = rnd(), r = rr(0.035, 0.055), h = rr(0.12, 0.24), z = b.z + rr(-0.09, 0.09);
      const mat = kind < 0.45 ? amberM : kind < 0.8 ? clearBotM : whiteP;
      put(cyl(r, r, h, 12), mat, M(x, y + 0.0125 + h / 2, z));
      put(cyl(r * 0.45, r * 0.6, 0.03, 10), mat, M(x, y + 0.0125 + h + 0.015, z), { cast: false });
      put(cyl(r * 0.5, r * 0.5, 0.03, 10), pick(capM), M(x, y + 0.0125 + h + 0.045, z), { cast: false });
    }
    // a sink at the west end of each bench, on the aisle side of N and S
    for (const sz of [-1, 1]) {
      const sxz = b.z + sz * 0.42;
      put(box(0.5, 0.015, 0.42), resinM, M(sinkX, TOP + 0.002, sxz), { cast: false });
      put(cyl(0.015, 0.015, 0.36, 8), steel, M(sinkX, TOP + 0.18, b.z + sz * 0.12));
      put(new THREE.TorusGeometry(0.1, 0.014, 8, 16, PI), steel, M(sinkX, TOP + 0.36, b.z + sz * 0.22, PI / 2));
      put(cyl(0.012, 0.012, 0.05, 8), steel, M(sinkX, TOP + 0.33, b.z + sz * 0.32));
    }
  }

  // ---------------------------------------------------------------- bench equipment (in slots along each side, never overlapping)
  const scopes = [], chemsets = [], stools = [];
  function centrifuge(x, z, ry) {
    put(box(0.42, 0.26, 0.48), whiteP, M(x, TOP + 0.13, z, ry));
    put(cyl(0.17, 0.17, 0.03, 24), greyM, M(x, TOP + 0.275, z, ry));
    const f = new V3(0, 0, 0.241).applyAxisAngle(new V3(0, 1, 0), ry);
    put(box(0.2, 0.07, 0.005), screenM[2], M(x + f.x, TOP + 0.17, z + f.z, ry), { cast: false });
    put(box(0.36, 0.02, 0.44), plinthM, M(x, TOP + 0.01, z, ry), { cast: false });
  }
  function glassware(x, z) {
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const gx = x + (i - (n - 1) / 2) * 0.13 + rr(-0.02, 0.02), gz = z + rr(-0.12, 0.12), lq = pick(liquidM);
      if (rnd() < 0.5) {   // beaker
        const r = rr(0.035, 0.06), h = rr(0.09, 0.16), f = rr(0.3, 0.7);
        put(cyl(r, r, h, 18, true), labGlass, M(gx, TOP + h / 2, gz), { cast: false, order: 5 });
        put(cyl(r * 0.94, r * 0.94, h * f, 18), lq, M(gx, TOP + h * f / 2 + 0.002, gz), { cast: false, order: 4 });
      } else {             // conical flask
        const r = rr(0.05, 0.07), h = rr(0.12, 0.16);
        put(cyl(0.02, r, h, 18, true), labGlass, M(gx, TOP + h / 2, gz), { cast: false, order: 5 });
        put(cyl(0.02, 0.02, 0.06, 12, true), labGlass, M(gx, TOP + h + 0.03, gz), { cast: false, order: 5 });
        const lh = h * 0.45; put(cyl(r - (r - 0.02) * 0.45, r * 0.95, lh, 18), lq, M(gx, TOP + lh / 2 + 0.002, gz), { cast: false, order: 4 });
      }
    }
  }
  function pipettes(x, z, ry) {
    put(box(0.28, 0.03, 0.08), greyM, M(x, TOP + 0.3, z, ry)); put(box(0.04, 0.3, 0.08), greyM, M(x + 0.12 * Math.cos(ry), TOP + 0.15, z - 0.12 * Math.sin(ry), ry));
    put(box(0.3, 0.015, 0.14), greyM, M(x, TOP + 0.008, z, ry), { cast: false });
    for (let k = 0; k < 4; k++) { const o = new V3(-0.1 + k * 0.06, 0, 0).applyAxisAngle(new V3(0, 1, 0), ry);
      put(cyl(0.012, 0.004, 0.24, 8), whiteP, M(x + o.x, TOP + 0.2, z + o.z), { cast: false });
      put(cyl(0.014, 0.014, 0.03, 8), capM[k % capM.length], M(x + o.x, TOP + 0.33, z + o.z), { cast: false }); }
    for (let k = 0; k < 2; k++) { const o = new V3(0.24 + k * 0.14, 0, 0.04).applyAxisAngle(new V3(0, 1, 0), ry);
      put(box(0.12, 0.08, 0.09), tipM[k % 3], M(x + o.x, TOP + 0.04, z + o.z, ry), { cast: false });
      put(box(0.125, 0.012, 0.095), tipM[(k + 1) % 3], M(x + o.x, TOP + 0.086, z + o.z, ry), { cast: false }); }
  }
  function balance(x, z, ry) {
    put(box(0.26, 0.08, 0.34), whiteP, M(x, TOP + 0.04, z, ry));
    put(box(0.22, 0.22, 0.22), labGlass, M(x, TOP + 0.19, z, ry), { cast: false, order: 5 });
    put(cyl(0.06, 0.06, 0.01, 18), steel, M(x, TOP + 0.09, z), { cast: false });
  }
  function smallScreen(x, z, ry) {
    put(box(0.56, 0.34, 0.03), darkM, M(x, TOP + 0.36, z, ry));
    const f = new V3(0, 0, 0.016).applyAxisAngle(new V3(0, 1, 0), ry);
    put(new THREE.PlaneGeometry(0.53, 0.31), pick(screenM), M(x + f.x, TOP + 0.36, z + f.z, ry), { cast: false });
    put(box(0.04, 0.18, 0.04), darkM, M(x - f.x * 2, TOP + 0.1, z - f.z * 2)); put(box(0.22, 0.012, 0.16), darkM, M(x, TOP + 0.006, z));
    const k = new V3(0, 0, 0.26).applyAxisAngle(new V3(0, 1, 0), ry); put(box(0.4, 0.015, 0.13), darkM, M(x + k.x, TOP + 0.008, z + k.z, ry), { cast: false });
  }
  for (const b of benches) for (const sz of [-1, 1]) {
    const z = b.z + sz * 0.45, ry = sz > 0 ? 0 : PI;           // items face the side they are worked from
    for (let x = b.x0 + 1.8; x < b.x1 - 0.5; x += 1.5) {
      const atSpot = b.name === "N" && sz > 0 && Math.abs(x - SPOT.x) < 0.76;
      let kind = atSpot ? "scope" : pick(["scope", "glass", "centrifuge", "pipettes", "glass", "screen", "balance", "chem", "scope", "none"]);
      const xx = atSpot ? SPOT.x : x + rr(-0.15, 0.15);
      if (kind === "scope") scopes.push({ x: xx, z, ry });
      else if (kind === "chem") chemsets.push({ x: xx, z: b.z + sz * 0.4, ry });
      else if (kind === "glass") glassware(xx, z);
      else if (kind === "centrifuge") centrifuge(xx, z, ry);
      else if (kind === "pipettes") pipettes(xx, z, ry);
      else if (kind === "balance") balance(xx, z, ry);
      else if (kind === "screen") smallScreen(xx, z - sz * 0.05, ry);
      // a stool tucked under the edge, except where someone stands
      const sx = xx + 0.55, stZ = b.z + sz * (b.depth / 2 + 0.05);
      if (!atSpot && rnd() < 0.6) stools.push({ x: sx, z: stZ });
    }
  }

  // ---------------------------------------------------------------- north wall: counter and the wall of monitors
  const MON = new V3(0, 1.85, Z0 + 0.08);
  {
    put(box(16, TOP - 0.1, 0.7), cabM, M(0, 0.1 + (TOP - 0.1) / 2 - 0.05, Z0 + 0.35));
    put(box(16.04, 0.04, 0.74), topM, M(0, TOP - 0.02, Z0 + 0.37));
    put(box(15.9, 0.1, 0.6), plinthM, M(0, 0.05, Z0 + 0.33), { cast: false });
    for (let x = -7.7; x < 8; x += 0.6) { put(box(0.004, TOP - 0.2, 0.01), greyM, M(x, 0.47, Z0 + 0.705), { cast: false }); put(box(0.16, 0.015, 0.02), handleM, M(x + 0.3, TOP - 0.17, Z0 + 0.715), { cast: false }); }
    put(box(5.4, 1.36, 0.06), darkM, M(MON.x, MON.y, Z0 + 0.03));
    let k = 0;
    for (const r of [0, 1]) for (let c = 0; c < 4; c++) { const x = MON.x - 2.01 + c * 1.34, y = MON.y - 0.33 + r * 0.66;
      put(box(1.3, 0.62, 0.04), darkM, M(x, y, Z0 + 0.08));
      put(new THREE.PlaneGeometry(1.26, 0.58), screenM[k++ % screenM.length], M(x, y, Z0 + 0.101), { cast: false }); }
    // two desk screens and a printer on the counter, glassware at the east end
    smallScreen(-5.5, Z0 + 0.32, 0); smallScreen(5.2, Z0 + 0.32, 0);
    put(box(0.5, 0.3, 0.42), whiteP, M(-7.0, TOP + 0.15, Z0 + 0.32)); put(box(0.4, 0.02, 0.2), greyM, M(-7.0, TOP + 0.31, Z0 + 0.42), { cast: false });
    glassware(6.9, Z0 + 0.34); centrifuge(3.2, Z0 + 0.32, 0);
    // signs on the wall
    put(box(0.3, 0.3, 0.01), hazardSign, M(-7.5, 1.8, Z0 + 0.01), { cast: false });
  }

  // ---------------------------------------------------------------- west wall: three fume cupboards, tall cabinets, safety shower
  const fumes = [];
  for (const fz of [-6.6, -4.6, -2.6]) {
    const fx = X0, W2 = 1.8, Dd = 0.9, front = fx + Dd;
    put(box(Dd, 0.85, W2), cabM, M(fx + Dd / 2, 0.425, fz));
    put(box(Dd + 0.04, 0.05, W2), resinM, M(fx + Dd / 2 + 0.02, 0.875, fz));
    for (const s of [-1, 1]) put(box(Dd, 2.4 - 0.9, 0.08), whiteP, M(fx + Dd / 2, 0.9 + 0.75, fz + s * (W2 / 2 - 0.04)));
    put(box(Dd, 0.5, W2), whiteP, M(fx + Dd / 2, 2.15, fz));
    put(box(0.04, 1.5, W2 - 0.16), std({ color: 0xdfe3e4, roughness: 0.6 }), M(fx + 0.02, 1.65, fz), { cast: false });
    put(box(0.02, 0.03, W2 - 0.2), lightM, M(front - 0.2, 1.88, fz), { cast: false });
    // sash: glass in a white frame, half raised
    put(box(0.04, 0.05, W2 - 0.16), whiteP, M(front - 0.02, 1.35, fz));
    put(box(0.04, 0.05, W2 - 0.16), whiteP, M(front - 0.02, 1.88, fz));
    put(new THREE.PlaneGeometry(W2 - 0.16, 0.52), labGlass, M(front - 0.02, 1.615, fz, PI / 2), { cast: false, order: 5 });
    put(cyl(0.012, 0.012, W2 - 0.4, 8), steel, M(front + 0.02, 1.33, fz, 0, PI / 2), { cast: false });
    put(box(0.02, 0.12, 0.3), darkM, M(front, 2.15, fz), { cast: false });
    put(box(0.004, 0.06, 0.1), screenM[2], M(front + 0.012, 2.16, fz), { cast: false });
    put(cyl(0.16, 0.16, H - 2.4, 18), alu, M(fx + 0.35, 2.4 + (H - 2.4) / 2, fz), { group: "ceiling" });
    glassware(fx + 0.45, fz + 0.1);
    fumes.push(new V3(front, 0, fz));
  }
  {
    // tall storage cabinets, a safety shower with its sign, a coat rack with lab coats
    for (const cz of [0.2, 1.2]) { put(box(0.6, 2.1, 0.98), cabM, M(X0 + 0.3, 1.05, cz)); put(box(0.02, 0.3, 0.02), handleM, M(X0 + 0.61, 1.1, cz + 0.4), { cast: false }); }
    put(cyl(0.02, 0.02, 2.3, 8), std({ color: 0x2f9a47, roughness: 0.4 }), M(X0 + 0.15, 1.15, 3.2));
    put(cyl(0.16, 0.05, 0.1, 18), std({ color: 0x2f9a47, roughness: 0.4 }), M(X0 + 0.45, 2.28, 3.2));
    put(box(0.3, 0.02, 0.02), std({ color: 0x2f9a47, roughness: 0.4 }), M(X0 + 0.3, 2.32, 3.2), { cast: false });
    put(box(0.01, 0.3, 0.3), greenSign, M(X0 + 0.01, 1.9, 3.75), { cast: false });
    put(box(0.04, 0.04, 1.6), steel, M(X0 + 0.06, 1.7, 5.6));
    for (let k = 0; k < 4; k++) { const z = 5.0 + k * 0.4; put(box(0.22, 0.95, 0.38), whiteP, M(X0 + 0.16, 1.2, z)); put(box(0.2, 0.2, 0.3), whiteP, M(X0 + 0.15, 1.62, z), { cast: false }); }
    put(box(0.5, 0.75, 0.4), std({ color: 0xe3e5e3, roughness: 0.5 }), M(X0 + 0.3, 0.375, 7.1));
    put(box(0.52, 0.02, 0.42), std({ color: 0xd23a2e, roughness: 0.5 }), M(X0 + 0.3, 0.76, 7.1), { cast: false });
  }

  // ---------------------------------------------------------------- east wall: steel shelves of bottles, a fridge, a clock
  {
    for (const sz of [-6.8, -4.6, -2.4]) {
      const sx = X1 - 0.25, W2 = 2.0;
      for (const e of [-1, 1]) for (const f of [-1, 1]) put(box(0.03, 2.2, 0.03), steel, M(sx + f * 0.2, 1.1, sz + e * (W2 / 2 - 0.02)));
      for (const y of [0.15, 0.6, 1.05, 1.5, 1.95]) {
        put(box(0.44, 0.02, W2), steel, M(sx, y, sz));
        for (let z = sz - W2 / 2 + 0.08; z < sz + W2 / 2 - 0.08; z += rr(0.09, 0.16)) {
          if (rnd() < 0.12) { z += 0.15; continue; }
          const big = rnd() < 0.25, r = big ? rr(0.06, 0.08) : rr(0.03, 0.05), h = big ? rr(0.22, 0.32) : rr(0.1, 0.2), x = sx + rr(-0.1, 0.1);
          const mat = rnd() < 0.5 ? amberM : rnd() < 0.6 ? clearBotM : whiteP;
          put(cyl(r, r, h, 12), mat, M(x, y + 0.01 + h / 2, z), { cast: rnd() < 0.3 });
          put(cyl(r * 0.55, r * 0.55, 0.035, 10), pick(capM), M(x, y + 0.01 + h + 0.017, z), { cast: false });
          z += r;
        }
      }
    }
    put(box(0.75, 1.95, 0.8), std({ color: 0xf2f3f3, roughness: 0.35 }), M(X1 - 0.4, 0.975, 0.4));
    put(box(0.02, 0.9, 0.04), handleM, M(X1 - 0.78, 1.2, 0.72), { cast: false });
    put(box(0.005, 0.16, 0.26), screenM[1], M(X1 - 0.78, 1.75, 0.35), { cast: false });
    put(box(0.75, 1.95, 0.8), std({ color: 0xe6e8ea, roughness: 0.35 }), M(X1 - 0.4, 0.975, 1.25));
    put(box(0.02, 0.9, 0.04), handleM, M(X1 - 0.78, 1.2, 1.57), { cast: false });
    put(box(0.01, 0.3, 0.3), hazardSign, M(X1 - 0.01, 1.85, 3.2), { cast: false });
    const c = prop(clock, { h: 0.34, x: 0, y: 0, z: 0 });
    const bb = new THREE.Box3().setFromObject(c), sz = bb.getSize(new V3());
    // the clock's thin axis turned to face west from the east wall
    if (sz.x > sz.z) c.rotation.y += PI / 2;
    c.position.set(0, 0, 0); c.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(c), c2 = b2.getCenter(new V3());
    c.position.set(X1 - 0.02 - b2.max.x, 2.45 - c2.y, 4.8 - c2.z);
  }

  // ---------------------------------------------------------------- ceiling: recessed panel lights, vents, sprinklers, a duct over the fume cupboards
  for (let x = -12; x <= 12.01; x += 2.4) for (let z = -7.8; z <= 7.0; z += 2.4) {
    put(box(1.2, 0.02, 0.6), lightM, M(x, H - 0.01, z), { cast: false, group: "ceiling" });
    put(box(1.26, 0.012, 0.66), alu, M(x, H - 0.004, z), { cast: false, group: "ceiling" });
  }
  for (let x = -10.8; x < 12; x += 4.8) for (const z of [-1.8, 6.2]) { put(box(0.6, 0.01, 0.6), greyM, M(x, H - 0.005, z), { cast: false, group: "ceiling" }); for (let k = -2; k <= 2; k++) put(box(0.5, 0.012, 0.02), darkM, M(x, H - 0.01, z + k * 0.1), { cast: false, group: "ceiling" }); }
  for (let x = -13; x < 14; x += 3) for (const z of [-6.6, -0.6, 5.4]) put(cyl(0.025, 0.012, 0.06, 8), steel, M(x, H - 0.03, z), { cast: false, group: "ceiling" });

  flush();

  // ---------------------------------------------------------------- library props: microscopes, chemistry sets, stools
  for (const s of scopes) prop(scope, { h: 0.42, fit: 0.45, x: s.x, y: TOP, z: s.z, ry: s.ry });
  for (const s of chemsets) prop(chemset, { h: 0.5, fit: 0.55, x: s.x, y: TOP, z: s.z, ry: s.ry });
  const standers = [SPOT, ...crowdList.filter((c) => !c.walk && c.x !== undefined).map((c) => new V3(c.x, 0, c.z))];
  for (const s of stools) if (standers.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 0.8)) prop(stool, { h: 0.66, x: s.x, z: s.z, ry: rr(0, 2 * PI) });
  const scopeAtSpot = new V3(SPOT.x, TOP, benches[0].z + 0.45);

  // ---------------------------------------------------------------- light: bright, even, from above
  const sunDir = new V3(0.22, 1, 0.3).normalize();
  const sun = new THREE.DirectionalLight(0xfff8f0, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xf6f8fb, 0x9d9a94, 1.15); scene.add(hemi);
  // a soft fill from the corridor windows
  const fill = new THREE.DirectionalLight(0xdfeaf5, 0.5); fill.position.set(-4, 6, 30); scene.add(fill);

  // ---------------------------------------------------------------- people
  const castMap = {}; castKeys.forEach((k, i) => { castMap[k] = figs[i]; scene.add(figs[i].object); });
  const crowdFigs = crowdList.map((c, i) => { const f = figs[castKeys.length + i]; scene.add(f.object); return { ...c, fig: f }; });
  const footOf = (f, side) => { let b = null; f.object.traverse((o) => { if (!b && o.isBone && new RegExp(side + "Foot$", "i").test(o.name)) b = o; }); return b; };
  // walking speed from the feet: while a foot is planted it moves back at exactly the speed the body must go forward
  function gaitOf(f) {
    const out = {}; const Lf = footOf(f, "Left"), Rf = footOf(f, "Right");
    for (const g of ["walk", "run", "jog"]) {
      if (!f.actions[g] || !Lf) continue;
      const T = f.durations[g], N = 160, ys = [], zs = [];
      f.object.position.set(0, 0, 0); f.object.rotation.set(0, 0, 0);
      for (const foot of [Lf, Rf]) { const y = [], z = [];
        for (let i = 0; i <= N; i++) { f.pose((i / N) * T, { [g]: 1 }); f.object.updateMatrixWorld(true); const p = foot.getWorldPosition(new V3()); y.push(p.y); z.push(p.z); }
        ys.push(y); zs.push(z); }
      let sum = 0, cnt = 0;
      for (let k = 0; k < 2; k++) { const y = ys[k], z = zs[k], lo = Math.min(...y);
        for (let i = 0; i < N; i++) if (y[i] < lo + 0.025 && y[i + 1] < lo + 0.025) { sum += -(z[i + 1] - z[i]) / (T / N); cnt++; } }
      out[g] = cnt ? Math.abs(sum / cnt) : { walk: 1.35, run: 3.6, jog: 2.6 }[g];
    }
    f.pose(0, { idle: 1 }); return out;
  }
  const gaitSpeed = {}; for (const k of castKeys) gaitSpeed[k] = gaitOf(castMap[k]);
  for (const c of crowdFigs) if (c.walk) c.speed = gaitOf(c.fig).walk || 1.3;

  // ---------------------------------------------------------------- update
  const _f = new V3();
  function poseFig(f, s, time, def) {
    const o = f.object; o.visible = s.show !== false;
    const g = { ...(s.gait || def.gait || {}) }; const clip = s.clip || def.clip; if (clip && f.actions[clip] && !s.gait) g[clip] = 1;
    let sum = 0; for (const k in g) { if (!f.actions[k]) delete g[k]; else if (k !== "idle") sum += g[k]; }
    if (f.actions.idle) g.idle = Math.max(g.idle || 0, 1 - sum);
    f.pose(s.time ?? time, g);
    o.position.set(s.x ?? def.x, 0, s.z ?? def.z); o.rotation.set(0, s.heading ?? def.heading, 0);
  }
  function update(st = {}) {
    const time = st.time || 0, people = st.people || {};
    castKeys.forEach((k, i) => poseFig(castMap[k], people[k] || {}, time, { x: SPOT.x + i * 1.1, z: SPOT.z, heading: PI }));
    const cr = st.crowd;
    crowdFigs.forEach((c, i) => {
      const s = cr === false ? { show: false } : (cr && (cr[i] || cr[c.id])) || {};
      const t = time + 0.7 * i + 1.3;
      if (c.walk && s.x === undefined) {
        const w = c.walk, len = Math.abs(w.x1 - w.x0), dir = Math.sign(w.x1 - w.x0) || 1;
        const d = ((w.phase || 0) * len + c.speed * (s.time ?? time)) % len;
        poseFig(c.fig, { ...s, gait: { walk: 1 } }, t, { x: w.x0 + dir * d, z: w.z, heading: dir > 0 ? PI / 2 : -PI / 2 });
      } else poseFig(c.fig, s, t, c);
    });
    groups.ceiling.visible = st.ceiling ?? !(camera.position.y > H - 0.05);
    const lead = castMap[castKeys[0]]?.object;
    const f = st.focus ? _f.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : lead ? _f.copy(lead.position) : _f.set(0, 0, 0);
    const R = st.shadowRadius ?? Math.min(26, Math.max(7, camera.position.distanceTo(f) * 1.1));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 120 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sunDir, 40); sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: castMap[castKeys[0]]?.object, crowd: crowdFigs, gaitSpeed, spot: SPOT.clone(), microscope: scopeAtSpot,
    aisle: { z: -2.0, x0: -12, x1: 12, halfWidth: 1.4 }, benches, columns: COLS, fumeCupboards: fumes, monitors: MON.clone(),
    shelves: new V3(X1 - 0.5, 1.1, -4.6), corridor: { z: 9.5, x0: -CX + 1, x1: CX - 1, glassZ: Z1 }, door: { x: (DOOR.x0 + DOOR.x1) / 2, z: Z1 },
    sun, sunDir: sunDir.clone(), H, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1 }, ceilingGroup: groups.ceiling,
  };
}
