// World "classroom": a school classroom by day, sun coming in through big windows on the west side.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. Floor at y = 0, ceiling at y = 3.1 (world.H).
// The room is x -5..5, z -4.5..4.5 (world.bounds). The FRONT of the class is the NORTH wall (z = -4.5): a 4 m
// whiteboard (world.board, centre x = -0.8, y = 1.5) with a clock above it, and a wall screen to its right
// (world.screen, x = 3.15). The WEST wall (x = -5) has three big windows (sill 0.85, head 2.75) looking out on a lawn,
// a playground, trees and the school's other brick wing; the morning-to-midday sun comes through them and lays
// window patches across the desks. The EAST wall (x = 5) has the door (z -3.9..-2.9) and a pin board with posters.
// The SOUTH (back) wall has three bookcases full of books, a low cabinet and posters (a world map among them).
// 16 student desks with chairs face the board in 4 rows (desk centres x = -3.3, -1.5, 1.5, 3.3; z = -1.4, 0, 1.4, 2.8).
// The teacher's desk is at x = 2.7, z = -3.0 with its chair behind it.
// Walkable: the centre AISLE x = 0 (clear for |x| < 1.0, z -3.3..4.0), the FRONT strip z = -3.9..-2.0 (x -4.4..1.6,
// the board is behind it) and the BACK strip z = 3.6..4.1. People "at the board" stand about z = -3.8 facing +z.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"]}) -> world.
//   cast: library characters to load (woman, man, robot, soldier, mannequin); each is world.cast.<id>.
// Per frame: set world.camera (position, fov, lookAt), then world.update(state), then world.render().
//
// state (every field optional):
//   time         seconds of the shot (animation clock by default)
//   people       {<cast id>: {x, z, heading, time, gait: {walk, run, jog, talk, ...}, clip, show}}
//                heading radians about +y: 0 faces +z (south, towards the back, i.e. a teacher facing the class),
//                PI faces the board, PI/2 faces east, -PI/2 faces the windows. Gait weights 0..1, idle gets the rest.
//                Move a walker by world.gaitSpeed.<id>.walk * walk * dt so the feet never slide.
//                Default: cast[0] stands at the board (world.spot) facing the class, others beside it.
//   ceiling      true/false forces the ceiling and its lights on or off (default: off when the camera is above y = 3.1)
//   neighbours   true/false forces the next-door classrooms and the corridor on or off (default: off from above)
//   cutaway      true/false: hide the walls between the camera and the room when the camera is outside it
//                (default true; hidden walls still cast their shadows, so the window light stays)
//   focus        {x, y, z} the centre of the sun's shadow box (default: the room centre)
//   board        a function (ctx, w, h) drawing on the whiteboard (2048 x 614 px, 1 px = 2 mm); called only when it changes
//   screen       a function (ctx, w, h) drawing the wall screen (1280 x 720), or null for its default blue desktop
//
// Exposes: world.cast.<id> (loadFigure results), world.person (cast[0].object), world.gaitSpeed.<id> {walk, run, jog}
// m/s measured from the feet, world.spot (Vector3 at the board), world.board {x, y, z, w, h, mesh, draw(fn)},
// world.screen {x, y, z, w, h, mesh, draw(fn)}, world.aisle {x, z0, z1, halfWidth}, world.front {z, x0, x1},
// world.desks [{x, z, seat: Vector3}], world.teacherDesk (Vector3), world.door {x, z}, world.windows [{x, z, w}],
// world.clock (Object3D), world.sun (DirectionalLight), world.sunDir, world.H (3.1),
// world.bounds {x0, x1, z0, z1}, world.ceilingGroup, world.walls {north, south, east, west} (Groups).
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"] } = {}) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const W = canvas.width || 1920, Hh = canvas.height || 1080;

  // ---------------------------------------------------------------- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, Hh, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcdd9e4, 40, 520);
  const camera = new THREE.PerspectiveCamera(50, W / Hh, 0.05, 3000);
  camera.position.set(4.3, 1.7, 4.1); camera.lookAt(-1, 1.2, -3);

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const LIB = new URL("../lib/", import.meta.url).href;   // the shared library, wherever it is linked from
  const tex = (f, srgb) => new Promise((res, rej) => TL.load(/:\/\//.test(f) ? f : K + f, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); }, undefined, rej));
  const pbrSet = async (n) => { const [d, no, r] = await Promise.all([tex(`pbr/${n}_diff.jpg`, true), tex(`pbr/${n}_nor.jpg`), tex(`pbr/${n}_rough.jpg`)]); return { d, no, r }; };
  const figIds = [...new Set(cast)];
  const clipsFor = (id) => ({ man: ["idle", "walk", "run", "jog", "talk"], woman: ["idle", "walk", "run", "jog", "talk"], robot: ["idle", "walk", "run", "wave"] }[id] || ["idle", "walk", "run"]);
  const [sky, concrete, brick, asphalt, rock, earth, deskP, chairP, tableP, clockP, plantA, plantB, barkD, barkN, leafN, ...figs] = await Promise.all([
    new HDRLoader().loadAsync(K + "sky/day.hdr"), pbrSet("concrete"), pbrSet("brick"), pbrSet("asphalt"), pbrSet("rock"),
    tex("textures/earth_day.jpg", true),
    loadProp({ THREE, id: "SchoolDesk_01" }), loadProp({ THREE, id: "SchoolChair_01" }), loadProp({ THREE, id: "WoodenTable_01" }),
    loadProp({ THREE, id: "wall_clock" }), loadProp({ THREE, id: "potted_plant_01" }), loadProp({ THREE, id: "potted_plant_02" }),
    // tree bark and leaf surfaces from the library (the tree models themselves are too heavy: the shapes are built here)
    tex(LIB + "props/island_tree_01/textures/island_tree_01_diff_1k.jpg", true),
    tex(LIB + "props/island_tree_01/textures/island_tree_01_nor_gl_1k.jpg"),
    tex(LIB + "props/island_tree_01/textures/island_tree_01_leaves_nor_gl_1k.jpg"),
    ...figIds.map((id) => loadFigure({ THREE, id, clips: clipsFor(id) })),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.environmentIntensity = 0.42; scene.backgroundIntensity = 1.0;

  // ---------------------------------------------------------------- helpers
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.userData.canvas = c; return t;
  }
  // a kit surface on a box with its texture at a real size (tu metres per repeat), never stretched
  function boxUV(geo, w, h, d, tu, tv = tu) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tu, uv.getY(k) * dims[f][1] / tv); }
    return geo;
  }
  const box = (w, h, d, tu, tv) => (tu ? boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tu, tv) : new THREE.BoxGeometry(w, h, d));
  const planeUV = (w, h, tu, tv = tu) => { const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tu, uv.getY(i) * h / tv); return g; };
  const cyl = (r0, r1, h, n = 14) => new THREE.CylinderGeometry(r0, r1, h, n);
  const _e = new THREE.Euler(), _q = new THREE.Quaternion();
  const M = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), new V3(s, s, s));
  const I = new THREE.Matrix4();
  // static geometry merged per material and group: many parts, few draw calls
  const bins = new Map();
  const groups = { static: new THREE.Group(), ceiling: new THREE.Group(), outside: new THREE.Group(), neighbours: new THREE.Group(),
    north: new THREE.Group(), south: new THREE.Group(), east: new THREE.Group(), west: new THREE.Group() };
  for (const g of Object.values(groups)) scene.add(g);
  function put(geo, mat, m = I, { cast: cs = true, recv = true, group = "static" } = {}) {
    const key = `${mat.uuid}|${cs}|${recv}|${group}`;
    if (!bins.has(key)) bins.set(key, { mat, cs, recv, group, list: [] });
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    bins.get(key).list.push(g.applyMatrix4(m));
  }
  function flush() {
    for (const b of bins.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(b.list, false), b.mat);
      mesh.castShadow = b.cs; mesh.receiveShadow = b.recv; groups[b.group].add(mesh);
    }
    bins.clear();
  }
  // a library prop placed with its base at y and its footprint centred, optional scale per axis
  function place(src, { x = 0, y = 0, z = 0, ry = 0, s = 1, sx, sy, sz, group = "static", castS = true }) {
    const o = src.clone(true);
    o.scale.set(sx ?? s, sy ?? s, sz ?? s);
    o.rotation.y = ry; o.position.set(0, 0, 0); o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    o.position.set(x - (bb.min.x + bb.max.x) / 2, y - bb.min.y, z - (bb.min.z + bb.max.z) / 2);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = castS; m.receiveShadow = true; } });
    groups[group].add(o); return o;
  }

  // ---------------------------------------------------------------- materials
  const H = 3.1, X0 = -5, X1 = 5, Z0 = -4.5, Z1 = 4.5, WT = 0.24;   // wall thickness, outside the room box
  const mkPbr = (set, o = {}) => std({ map: set.d, normalMap: set.no, roughnessMap: set.r, ...o });
  const noise = (g, w, h, base, amp, n) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (rnd() - 0.5) * amp; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } };
  // vinyl floor tiles, 0.5 m, two tones, speckled: one canvas = 2 x 2 tiles = 1 m
  const floorTex = canvasTex(1024, 1024, (g, w, h) => {
    const tones = ["#c9c2b4", "#bdb5a6", "#c4bcad", "#cfc8ba"];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = tones[i * 2 + j]; g.fillRect(i * w / 2, j * h / 2, w / 2, h / 2); }
    for (let k = 0; k < 60000; k++) { const v = rnd(); g.fillStyle = v < 0.5 ? `rgba(90,80,70,${0.08 + rnd() * 0.12})` : v < 0.8 ? `rgba(255,255,250,${0.1 + rnd() * 0.15})` : `rgba(120,110,95,${0.1})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
    g.strokeStyle = "rgba(70,62,54,0.35)"; g.lineWidth = 3;
    for (const p of [0, w / 2]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
  });
  floorTex.repeat.set(1, 1);
  const floorM = std({ map: floorTex, color: 0xd9d6d0, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 0.55, normalScale: new THREE.Vector2(0.18, 0.18) });
  const paintM = std({ color: 0xe8e1d2, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 1, normalScale: new THREE.Vector2(0.22, 0.22) });
  const paintLowM = std({ color: 0x8fa3a6, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 0.9, normalScale: new THREE.Vector2(0.22, 0.22) });  // dado band
  const outerM = mkPbr(brick, { roughness: 1 }); outerM.color.setRGB(1.0, 0.92, 0.88);
  const ceilTex = canvasTex(512, 512, (g, w, h) => {
    noise(g, w, h, "#ecebe6", 0.18, 30000);
    for (let k = 0; k < 1400; k++) { g.fillStyle = `rgba(120,118,110,${0.15 + rnd() * 0.2})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.8 + rnd() * 1.4, 0, 7); g.fill(); }
    g.strokeStyle = "#cfcfcb"; g.lineWidth = 10; g.strokeRect(0, 0, w, h);
  });
  const ceilM = std({ map: ceilTex, roughness: 1, side: THREE.FrontSide });
  const woodTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = "#b48a5c"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 180; i++) { const y0 = rnd() * h, a = rnd() * 0.14, ph = rnd() * 6, f = 0.004 + rnd() * 0.01, amp = 1 + rnd() * 5;
      g.strokeStyle = rnd() < 0.55 ? `rgba(105,68,36,${a})` : `rgba(235,205,160,${a})`; g.lineWidth = 0.6 + rnd() * 2.2; g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1) * amp * 0.3; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  });
  const woodM = std({ map: woodTex, roughness: 0.6, normalMap: concrete.no, normalScale: new THREE.Vector2(0.08, 0.08) });
  const woodDarkM = std({ map: woodTex, color: 0x8a6a4c, roughness: 0.6 });
  const frameM = std({ color: 0xf1f1ee, roughness: 0.45, metalness: 0.1 });       // white window frames
  const aluM = std({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.85 });
  const darkM = std({ color: 0x24262a, roughness: 0.5, metalness: 0.4 });
  const blackM = std({ color: 0x0d0e10, roughness: 0.25, metalness: 0.2 });
  const skirtM = std({ color: 0x5b5e60, roughness: 0.6 });
  const radM = std({ color: 0xeeeeea, roughness: 0.4, metalness: 0.3 });
  const corkTex = canvasTex(512, 512, (g, w, h) => { noise(g, w, h, "#b08a5a", 0.5, 40000); for (let k = 0; k < 6000; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "70,45,20" : "220,190,140"},0.35)`; g.fillRect(rnd() * w, rnd() * h, 2, 2); } });
  const corkM = std({ map: corkTex, roughness: 0.95 });
  const doorM = std({ map: woodTex, color: 0xa7865f, roughness: 0.5 });
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0xe8f1f4, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const lightM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.2, 2.15, 2.0) });
  // ghost: what a cut-away wall wears. Draws nothing, still casts its shadow.
  const ghostM = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  // ---------------------------------------------------------------- floor and ceiling
  const floor = new THREE.Mesh(planeUV(X1 - X0, Z1 - Z0, 1), floorM); floor.rotation.x = -PI / 2; floor.receiveShadow = true; groups.static.add(floor);
  // the ceiling faces down only, so a camera above it sees straight into the room
  const ceil = new THREE.Mesh(planeUV(X1 - X0, Z1 - Z0, 0.6), ceilM); ceil.rotation.x = PI / 2; ceil.position.y = H; ceil.receiveShadow = true; ceil.castShadow = true;
  groups.ceiling.add(ceil);
  // ceiling tile grid (T-bar) and recessed light panels
  for (let x = X0 + 0.6; x < X1; x += 0.6) put(box(0.025, 0.012, Z1 - Z0), frameM, M(x, H - 0.006, 0), { cast: false, group: "ceiling" });
  for (let z = Z0 + 0.6; z < Z1; z += 0.6) put(box(X1 - X0, 0.012, 0.025), frameM, M(0, H - 0.006, z), { cast: false, group: "ceiling" });
  const LIGHTS = [];
  for (const x of [-3, 0, 3]) for (const z of [-3, -0.6, 1.8, 4.0]) { if (z > 4) continue; LIGHTS.push([x, z]);
    put(box(1.2, 0.03, 0.6), aluM, M(x, H - 0.016, z), { cast: false, group: "ceiling" });
    put(new THREE.PlaneGeometry(1.12, 0.52), lightM, M(x, H - 0.033, z, 0, PI / 2), { cast: false, recv: false, group: "ceiling" }); }

  // ---------------------------------------------------------------- walls (each wall is its own group, for the cut-away)
  // paint inside, brick outside; WT thick, outside the room box. A wall piece: [x0,x1] or [z0,z1] along it, [y0,y1].
  const DADO = 1.0;
  function wallPiece(side, a0, a1, y0, y1) {
    const len = a1 - a0, h = y1 - y0, mid = (a0 + a1) / 2;
    if (len <= 0.001 || h <= 0.001) return;
    const ns = side === "north" || side === "south";
    const sign = side === "north" || side === "west" ? -1 : 1;
    const c = (ns ? Z1 : X1) * sign + sign * WT / 2;                // the wall's centre line
    // the inner face: dado colour below DADO, paint above
    const parts = [];
    if (y0 < DADO) parts.push([y0, Math.min(DADO, y1), paintLowM]);
    if (y1 > DADO) parts.push([Math.max(DADO, y0), y1, paintM]);
    for (const [p0, p1, mat] of parts) {
      const ph = p1 - p0, g = planeUV(len, ph, 1.2);
      const yc = (p0 + p1) / 2;
      const inner = (ns ? Z1 : X1) * sign;
      const m = ns ? M(mid, yc, inner, sign < 0 ? 0 : PI) : M(inner, yc, mid, sign < 0 ? PI / 2 : -PI / 2);
      put(g, mat, m, { cast: false, group: side });
    }
    // the body (casts the shadow, its outside shows as brick from the yard)
    const g = ns ? box(len, h, WT, 2.4) : box(WT, h, len, 2.4);
    put(g, outerM, ns ? M(mid, (y0 + y1) / 2, c + sign * 0.004) : M(c + sign * 0.004, (y0 + y1) / 2, mid), { group: side });
  }
  // NORTH (front) and SOUTH (back): solid
  wallPiece("north", X0 - WT, X1 + WT, 0, H + 0.3);
  wallPiece("south", X0 - WT, X1 + WT, 0, H + 0.3);
  // EAST: a door opening z -3.9..-2.9, 2.1 high
  const DOOR = { z0: -3.9, z1: -2.9, h: 2.1 };
  wallPiece("east", Z0, DOOR.z0, 0, H + 0.3); wallPiece("east", DOOR.z1, Z1, 0, H + 0.3); wallPiece("east", DOOR.z0, DOOR.z1, DOOR.h, H + 0.3);
  // WEST: three windows, 2.3 wide, sill 0.85, head 2.75
  const WIN = [-2.75, 0, 2.75].map((z) => ({ x: X0, z, w: 2.3 })), SILL = 0.85, HEAD = 2.75;
  { let a = Z0; for (const w of WIN) { wallPiece("west", a, w.z - w.w / 2, 0, H + 0.3); a = w.z + w.w / 2; } wallPiece("west", a, Z1, 0, H + 0.3);
    for (const w of WIN) { wallPiece("west", w.z - w.w / 2, w.z + w.w / 2, 0, SILL); wallPiece("west", w.z - w.w / 2, w.z + w.w / 2, HEAD, H + 0.3); } }
  // reveals (the inside of each opening) and frames, glass, sills, radiators
  for (const w of WIN) {
    const z0 = w.z - w.w / 2, z1 = w.z + w.w / 2, hh = HEAD - SILL, xc = X0 - WT / 2;
    for (const z of [z0, z1]) put(new THREE.PlaneGeometry(WT + 0.01, hh), paintM, M(xc, SILL + hh / 2, z + (z === z0 ? 0.004 : -0.004), z === z0 ? 0 : PI), { cast: false, group: "west" });
    put(new THREE.PlaneGeometry(WT + 0.01, w.w), paintM, M(xc, HEAD - 0.004, w.z, 0, PI / 2), { cast: false, group: "west" });
    put(new THREE.PlaneGeometry(WT + 0.01, w.w), paintM, M(xc, SILL + 0.004, w.z, 0, -PI / 2), { cast: false, group: "west" });
    // frame: outer rectangle, a mullion making two lights, a transom with a top light
    const fx = X0 - WT * 0.55, fd = 0.07;
    put(box(fd, 0.07, w.w), frameM, M(fx, SILL + 0.035, w.z), { group: "west" });
    put(box(fd, 0.07, w.w), frameM, M(fx, HEAD - 0.035, w.z), { group: "west" });
    put(box(fd, 0.06, w.w), frameM, M(fx, 2.2, w.z), { group: "west" });
    for (const z of [z0 + 0.035, w.z, z1 - 0.035]) put(box(fd, hh, 0.06), frameM, M(fx, SILL + hh / 2, z), { group: "west" });
    put(new THREE.PlaneGeometry(w.w, hh), glassM, M(fx, SILL + hh / 2, w.z, PI / 2), { cast: false, recv: false, group: "west" });
    // inside sill
    put(box(0.3, 0.04, w.w + 0.12), frameM, M(X0 + 0.05, SILL + 0.02, w.z), { group: "west" });
    // radiator under the sill
    for (let k = 0; k < 18; k++) put(box(0.08, 0.55, 0.05), radM, M(X0 + 0.09, 0.42, w.z - 0.9 + k * 0.106), { group: "west" });
    put(box(0.03, 0.04, 1.9), radM, M(X0 + 0.09, 0.12, w.z), { group: "west" });
  }
  // skirting boards
  put(box(X1 - X0, 0.1, 0.02), skirtM, M(0, 0.05, Z0 + 0.01), { cast: false, group: "north" });
  put(box(X1 - X0, 0.1, 0.02), skirtM, M(0, 0.05, Z1 - 0.01), { cast: false, group: "south" });
  put(box(0.02, 0.1, Z1 - Z0), skirtM, M(X0 + 0.01, 0.05, 0), { cast: false, group: "west" });
  put(box(0.02, 0.1, DOOR.z0 - Z0), skirtM, M(X1 - 0.01, 0.05, (Z0 + DOOR.z0) / 2), { cast: false, group: "east" });
  put(box(0.02, 0.1, Z1 - DOOR.z1), skirtM, M(X1 - 0.01, 0.05, (DOOR.z1 + Z1) / 2), { cast: false, group: "east" });
  // a picture rail / dado rail
  put(box(X1 - X0, 0.04, 0.025), woodDarkM, M(0, DADO, Z0 + 0.012), { cast: false, group: "north" });
  put(box(X1 - X0, 0.04, 0.025), woodDarkM, M(0, DADO, Z1 - 0.012), { cast: false, group: "south" });
  put(box(0.025, 0.04, DOOR.z0 - Z0), woodDarkM, M(X1 - 0.012, DADO, (Z0 + DOOR.z0) / 2), { cast: false, group: "east" });
  put(box(0.025, 0.04, Z1 - DOOR.z1), woodDarkM, M(X1 - 0.012, DADO, (DOOR.z1 + Z1) / 2), { cast: false, group: "east" });
  // the door: frame, a slightly open leaf with a glass vision panel, a handle; a corridor wall behind
  { const zc = (DOOR.z0 + DOOR.z1) / 2;
    for (const z of [DOOR.z0 - 0.04, DOOR.z1 + 0.04]) put(box(0.06, DOOR.h + 0.04, 0.08), woodDarkM, M(X1 + 0.01, (DOOR.h + 0.04) / 2, z), { group: "east" });
    put(box(0.06, 0.08, DOOR.z1 - DOOR.z0 + 0.16), woodDarkM, M(X1 + 0.01, DOOR.h + 0.04, zc), { group: "east" });
    const leaf = new THREE.Group(); const lw = DOOR.z1 - DOOR.z0 - 0.02;
    const slab = new THREE.Mesh(box(0.045, DOOR.h - 0.02, lw), doorM); slab.position.set(0, (DOOR.h - 0.02) / 2, lw / 2); slab.castShadow = slab.receiveShadow = true; leaf.add(slab);
    const vp = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.7), std({ color: 0x9fb2bd, roughness: 0.05, metalness: 0.6 })); vp.position.set(-0.024, 1.45, lw * 0.7); vp.rotation.y = -PI / 2; leaf.add(vp);
    const hd = new THREE.Mesh(box(0.06, 0.03, 0.14), aluM); hd.position.set(-0.05, 1.0, lw - 0.1); leaf.add(hd);
    leaf.position.set(X1 + WT * 0.5, 0, DOOR.z0 + 0.01); leaf.rotation.y = 0.35; groups.east.add(leaf);
    // corridor behind the door
    // the corridor behind the door runs the length of the block (hidden with the neighbours from above)
    const CX0 = X1 + WT, CX1 = CX0 + 2.6, CL = Z1 - Z0 + 2 * WT + 32;
    put(box(CX1 - CX0, 0.02, CL), floorM, M((CX0 + CX1) / 2, -0.01, 0), { cast: false, group: "neighbours" });
    put(planeUV(CL, H, 1.2), paintM, M(CX1, H / 2, 0, -PI / 2), { cast: false, group: "neighbours" });
    put(box(WT, H + 0.3, CL, 2.4), outerM, M(CX1 + WT / 2 + 0.004, (H + 0.3) / 2, 0), { group: "neighbours" });
    put(planeUV(CX1 - CX0, CL, 0.6), ceilM, M((CX0 + CX1) / 2, H, 0, 0, PI / 2), { cast: false, group: "neighbours" });
    put(box(CX1 - CX0 + WT + 0.3, 0.4, CL, 2.4), outerM, M((CX0 + CX1 + WT) / 2, H + 0.5, 0), { group: "neighbours" });
    for (let z = -14; z <= 14; z += 4) put(new THREE.PlaneGeometry(0.5, 1.2), lightM, M((CX0 + CX1) / 2, H - 0.01, z, 0, PI / 2), { cast: false, recv: false, group: "neighbours" });
  }

  // ---------------------------------------------------------------- the front: whiteboard, clock, wall screen
  const BOARD = { x: -0.8, y: 1.5, z: Z0 + 0.03, w: 4.0, h: 1.2 };
  const boardCanvasW = 2048, boardCanvasH = 614;
  const boardTex = canvasTex(boardCanvasW, boardCanvasH, () => {});
  function boardDefault(g, w, h) {
    g.fillStyle = "#f7f8f6"; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "rgba(255,255,255,0.0)"); gr.addColorStop(0.45, "rgba(255,255,255,0.35)"); gr.addColorStop(0.55, "rgba(230,232,232,0.0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // ghosting of old marker, very faint
    for (let k = 0; k < 9; k++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? "60,70,110" : "90,90,90"},${0.03 + rnd() * 0.035})`; g.lineWidth = 6 + rnd() * 10; g.beginPath();
      let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let i = 0; i < 6; i++) { x += rr(-160, 220); y += rr(-50, 50); g.lineTo(x, y); } g.stroke(); }
  }
  function drawBoard(fn) { const c = boardTex.userData.canvas, g = c.getContext("2d"); boardDefault(g, c.width, c.height); if (fn) fn(g, c.width, c.height); boardTex.needsUpdate = true; }
  drawBoard(null);
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), std({ map: boardTex, roughness: 0.18, metalness: 0.0, envMapIntensity: 0.6 }));
  boardMesh.position.set(BOARD.x, BOARD.y, BOARD.z); boardMesh.receiveShadow = true; groups.north.add(boardMesh);
  put(box(BOARD.w + 0.06, BOARD.h + 0.06, 0.025), aluM, M(BOARD.x, BOARD.y, Z0 + 0.0125), { group: "north" });
  put(box(BOARD.w * 0.9, 0.025, 0.07), aluM, M(BOARD.x, BOARD.y - BOARD.h / 2 - 0.03, Z0 + 0.05), { group: "north" });   // marker tray
  for (const [dx, col] of [[-0.5, 0x1e3f9a], [-0.38, 0x111111], [-0.26, 0xb52020], [0.6, 0x2a2a2a]]) {   // markers and an eraser
    if (dx > 0.5) put(box(0.14, 0.035, 0.05), darkM, M(BOARD.x + dx, BOARD.y - BOARD.h / 2 - 0.0, Z0 + 0.05));
    else put(cyl(0.009, 0.009, 0.13, 8), std({ color: col, roughness: 0.4 }), M(BOARD.x + dx, BOARD.y - BOARD.h / 2 - 0.008, Z0 + 0.05, 0, 0, PI / 2), { cast: false });
  }
  const clock = place(clockP, { x: BOARD.x, y: 2.42, z: Z0 + 0.03, s: 1.1, group: "north" });
  // the wall screen: a flat panel on a bracket
  const SCREEN = { x: 3.15, y: 1.62, z: Z0 + 0.07, w: 1.66, h: 0.94 };
  const screenTex = canvasTex(1280, 720, () => {}); screenTex.wrapS = screenTex.wrapT = THREE.ClampToEdgeWrapping;
  function screenDefault(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#1b4f8f"); gr.addColorStop(0.6, "#2d79b8"); gr.addColorStop(1, "#5fb0d9"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.18; g.fillStyle = "#ffffff"; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(w * (0.25 + i * 0.3), h * 1.05, w * 0.5, h * (0.35 + i * 0.1), 0, PI, 2 * PI); g.fill(); } g.globalAlpha = 1;
  }
  function drawScreen(fn) { const c = screenTex.userData.canvas, g = c.getContext("2d"); (fn || screenDefault)(g, c.width, c.height); screenTex.needsUpdate = true; }
  drawScreen(null);
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(0.9, 0.9, 0.9) }));
  screenMesh.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.031); groups.north.add(screenMesh);
  put(box(SCREEN.w + 0.04, SCREEN.h + 0.04, 0.06), blackM, M(SCREEN.x, SCREEN.y, SCREEN.z), { group: "north" });
  put(box(0.3, 0.2, 0.05), darkM, M(SCREEN.x, SCREEN.y, Z0 + 0.025), { cast: false, group: "north" });

  // ---------------------------------------------------------------- posters (drawn: no photo of a real classroom wall needed)
  function poster(kind) {
    return canvasTex(600, 840, (g, w, h) => {
      const F = "bold 54px Helvetica, Arial, sans-serif";
      if (kind === "map") {
        g.fillStyle = "#f4efe3"; g.fillRect(0, 0, w, h);
        g.drawImage(earth.image, 30, 140, w - 60, (w - 60) / 2);
        g.fillStyle = "#23395b"; g.font = F; g.textAlign = "center"; g.fillText("THE WORLD", w / 2, 95);
        g.font = "28px Helvetica, Arial"; g.fillStyle = "#55606e"; ["Continents", "Oceans", "Countries"].forEach((t, i) => g.fillText(t, w / 2, 520 + i * 52));
        g.strokeStyle = "#23395b"; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
      } else if (kind === "planets") {
        g.fillStyle = "#0e1630"; g.fillRect(0, 0, w, h);
        for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.8})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
        const P = [["#ffcc4d", 120], ["#b5a58f", 14], ["#e8c27a", 22], ["#4f8fd6", 24], ["#d0643c", 18], ["#d9b38c", 58], ["#e6d29a", 48], ["#9fe3ea", 34], ["#5a7ee0", 32]];
        let y = 40; P.forEach(([c, r], i) => { const x = i === 0 ? w / 2 : w * (i % 2 ? 0.33 : 0.67); y += i === 0 ? r : r + 26; g.fillStyle = c; g.beginPath(); g.arc(x, i === 0 ? -40 : y, r, 0, 7); g.fill(); y += r; if (i === 6) { g.strokeStyle = "#e6d29a"; g.lineWidth = 5; g.beginPath(); g.ellipse(x, y - r, r * 1.7, r * 0.4, -0.3, 0, 7); g.stroke(); } });
        g.fillStyle = "#ffffff"; g.font = F; g.textAlign = "center"; g.fillText("OUR SOLAR SYSTEM", w / 2, h - 40);
      } else if (kind === "alphabet") {
        g.fillStyle = "#fffaf0"; g.fillRect(0, 0, w, h);
        const cols = ["#e94f37", "#f6ae2d", "#33a1fd", "#2a9d8f", "#9b5de5", "#f15bb5"];
        "ABCDEFGHIJKLMNOPQRSTUVWX".split("").forEach((c, i) => { const cx = 60 + (i % 4) * 160, cy = 110 + Math.floor(i / 4) * 125; g.fillStyle = cols[i % 6]; g.beginPath(); g.roundRect(cx - 60, cy - 55, 120, 110, 14); g.fill(); g.fillStyle = "#fff"; g.font = "bold 80px Helvetica, Arial"; g.textAlign = "center"; g.fillText(c, cx, cy + 28); });
      } else if (kind === "numbers") {
        g.fillStyle = "#eaf4ea"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#1d5c3a"; g.font = F; g.textAlign = "center"; g.fillText("TIMES TABLES", w / 2, 80);
        g.font = "26px Helvetica, Arial";
        for (let i = 1; i <= 10; i++) for (let j = 1; j <= 10; j++) { g.fillStyle = (i + j) % 2 ? "#cfe6d3" : "#ffffff"; g.fillRect(40 + (j - 1) * 52, 110 + (i - 1) * 68, 52, 68); g.fillStyle = i === 1 || j === 1 ? "#1d5c3a" : "#36474f"; g.fillText(String(i * j), 40 + (j - 0.5) * 52, 110 + (i - 0.5) * 68 + 9); }
      } else if (kind === "elements") {
        g.fillStyle = "#f6f3ee"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#333"; g.font = "bold 46px Helvetica, Arial"; g.textAlign = "center"; g.fillText("ELEMENTS", w / 2, 70);
        const cols = ["#f4a259", "#5b8e7d", "#8cb369", "#bc4b51", "#4d9de0", "#e1bc29"];
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { if (r === 0 && c > 0 && c < 8) continue; if (r < 3 && c > 1 && c < 6) continue; g.fillStyle = cols[(r + c * 2) % 6]; g.fillRect(30 + c * 60, 110 + r * 76, 56, 72); g.fillStyle = "rgba(255,255,255,0.9)"; g.font = "bold 22px Helvetica"; g.fillText(String.fromCharCode(65 + ((r * 9 + c) % 26)) + String.fromCharCode(97 + ((r * 5 + c * 3) % 26)), 58 + c * 60, 152 + r * 76); }
      } else {   // "reading": a plain motivational poster
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#f9c74f"); gr.addColorStop(1, "#f3722c"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = "#fff"; g.font = "bold 120px Helvetica, Arial"; g.textAlign = "center"; g.fillText("READ", w / 2, 330); g.font = "bold 50px Helvetica"; g.fillText("every day", w / 2, 420);
        g.fillStyle = "rgba(255,255,255,0.85)"; for (let i = 0; i < 3; i++) { g.save(); g.translate(w / 2 - 140 + i * 140, 610); g.rotate((i - 1) * 0.15); g.fillRect(-55, -80, 110, 160); g.restore(); }
      }
    });
  }
  const posterM = {}; for (const k of ["map", "planets", "alphabet", "numbers", "elements", "reading"]) posterM[k] = std({ map: poster(k), roughness: 0.75 });
  // a poster sheet on a wall: side, centre along the wall, y, width
  function hang(side, a, y, w, kind) {
    const h = w * 1.4, off = 0.006;
    const m = side === "north" ? M(a, y, Z0 + off) : side === "south" ? M(a, y, Z1 - off, PI) : side === "east" ? M(X1 - off, y, a, -PI / 2) : M(X0 + off, y, a, PI / 2);
    put(new THREE.PlaneGeometry(w, h), posterM[kind], m, { cast: false, group: side });
  }
  hang("north", -4.05, 1.7, 0.6, "alphabet");
  hang("south", -3.3, 1.75, 0.6, "reading");
  hang("south", 3.7, 1.8, 0.7, "map");
  hang("north", 4.5, 1.7, 0.6, "elements");
  hang("east", 2.6, 1.75, 0.6, "planets");
  hang("east", 3.6, 1.75, 0.6, "numbers");
  // the pin board on the east wall with pinned sheets
  put(box(0.03, 1.1, 2.2), corkM, M(X1 - 0.015, 1.7, -0.6), { cast: false, group: "east" });
  put(box(0.035, 1.16, 0.03), woodDarkM, M(X1 - 0.017, 1.7, -1.715), { cast: false, group: "east" });
  put(box(0.035, 1.16, 0.03), woodDarkM, M(X1 - 0.017, 1.7, 0.515), { cast: false, group: "east" });
  put(box(0.035, 0.03, 2.26), woodDarkM, M(X1 - 0.017, 2.265, -0.6), { cast: false, group: "east" });
  put(box(0.035, 0.03, 2.26), woodDarkM, M(X1 - 0.017, 1.135, -0.6), { cast: false, group: "east" });
  const sheetCols = [0xfdfdf8, 0xfff3a8, 0xbfe3ff, 0xffd0d6, 0xd5f5c8, 0xfdfdf8];
  for (let i = 0; i < 9; i++) { const zz = -1.5 + (i % 5) * 0.42 + rr(-0.04, 0.04), yy = i < 5 ? 1.95 : 1.45, sw = rr(0.21, 0.3);
    if (i >= 5 && i % 5 > 3) continue;
    put(new THREE.PlaneGeometry(sw, sw * 1.35), std({ color: sheetCols[i % 6], roughness: 0.9 }), M(X1 - 0.032, yy + rr(-0.05, 0.05), zz, -PI / 2, 0, rr(-0.06, 0.06)), { cast: false, group: "east" });
    put(cyl(0.008, 0.008, 0.01, 8), std({ color: [0xd62828, 0x1d70d6, 0x2a9d3a][i % 3], roughness: 0.4 }), M(X1 - 0.038, yy + sw * 0.6, zz, 0, 0, PI / 2), { cast: false, group: "east" }); }

  // ---------------------------------------------------------------- back wall: bookcases, a cabinet, books
  const BOOK_COLS = [0x8c2f39, 0x1f4e79, 0x2e6b3a, 0xc9a227, 0x5c4b8a, 0xd35400, 0x2c3e50, 0x7f8c8d, 0xa93226, 0x117a65, 0xe7e2d3, 0x34495e];
  const bookM = BOOK_COLS.map((c) => std({ color: c, roughness: 0.75 }));
  function bookcase(xc, w = 1.0, h = 2.0, d = 0.34) {
    const z = Z1 - d / 2 - 0.01, t = 0.025;
    for (const s of [-1, 1]) put(box(t, h, d, 0.6), woodM, M(xc + s * (w / 2 - t / 2), h / 2, z));
    put(box(w, h, 0.012), woodDarkM, M(xc, h / 2, Z1 - 0.012));
    put(box(w, t, d), woodM, M(xc, h - t / 2, z));
    const shelves = [0.08, 0.46, 0.84, 1.22, 1.6];
    for (const sy of shelves) put(box(w - 2 * t, t, d - 0.012), woodM, M(xc, sy, z));
    put(box(w - 2 * t, 0.08, 0.02), woodDarkM, M(xc, 0.04, z + d / 2 - 0.01));
    shelves.forEach((sy, si) => {
      let x = xc - w / 2 + t + 0.01; const xe = xc + w / 2 - t - 0.01, top = (si < shelves.length - 1 ? shelves[si + 1] : h) - sy - t;
      while (x < xe - 0.03) {
        if (rnd() < 0.08) { x += rr(0.05, 0.14); continue; }
        const bw = rr(0.022, 0.05), bh = Math.min(top - 0.03, rr(0.2, 0.31)), bd = rr(0.17, 0.24);
        if (x + bw > xe) break;
        const lean = rnd() < 0.06 && x + bw + 0.1 < xe ? 0.22 : 0;
        put(box(bw, bh, bd), bookM[Math.floor(rnd() * bookM.length)], M(x + bw / 2 + lean * bh * 0.5, sy + t / 2 + bh / 2 * Math.cos(lean), Z1 - 0.03 - bd / 2, 0, 0, -lean), { cast: false });
        x += bw + 0.002 + lean * bh;
      }
    });
  }
  for (const xc of [-1.6, -0.5, 0.6]) bookcase(xc, 1.06);
  // a low cabinet with a globe and boxes, by the back-right corner
  put(box(1.4, 0.8, 0.45, 0.6), woodM, M(2.2, 0.4, Z1 - 0.235));
  for (const dx of [-0.35, 0.35]) put(box(0.6, 0.66, 0.01), woodDarkM, M(2.2 + dx, 0.42, Z1 - 0.462));
  for (const dx of [-0.08, 0.08]) put(box(0.02, 0.12, 0.02), aluM, M(2.2 + dx, 0.5, Z1 - 0.475), { cast: false });
  { const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 40, 28), std({ map: earth, roughness: 0.5 })); globe.position.set(2.55, 0.8 + 0.06 + 0.17, Z1 - 0.24); globe.rotation.z = 0.41; globe.castShadow = true; groups.static.add(globe);
    put(cyl(0.07, 0.09, 0.05, 20), darkM, M(2.55, 0.825, Z1 - 0.24)); put(cyl(0.008, 0.008, 0.1, 6), darkM, M(2.55, 0.89, Z1 - 0.24));
    put(new THREE.TorusGeometry(0.175, 0.006, 6, 40, PI), aluM, M(2.55, 1.03, Z1 - 0.24, PI / 2, 0, 0.41)); }
  for (const [dx, c] of [[-0.45, 0x2f6fb0], [-0.1, 0xd9534f]]) put(box(0.3, 0.18, 0.3), std({ color: c, roughness: 0.6 }), M(2.2 + dx, 0.89, Z1 - 0.24));
  // a bin and a plant
  put(cyl(0.16, 0.13, 0.36, 20), std({ color: 0x3b6e8f, roughness: 0.5 }), M(4.6, 0.18, Z1 - 0.35));
  place(plantA, { x: -4.55, z: Z1 - 0.4, s: 0.9 });
  place(plantB, { x: 4.55, z: -1.9, s: 1.0 });

  // ---------------------------------------------------------------- desks and chairs (library props), the teacher's desk
  const DCOLS = [-3.3, -1.5, 1.5, 3.3], DROWS = [-1.4, 0, 1.4, 2.8];
  const desks = [];
  // the prop's open side (where the knees go) is +z: desks face the board by turning PI
  for (const z of DROWS) for (const x of DCOLS) {
    const j = rr(-0.04, 0.04), jr = rr(-0.035, 0.035);
    place(deskP, { x: x + j, z: z + rr(-0.03, 0.03), ry: PI + jr });
    const pull = rr(0.42, 0.56);
    place(chairP, { x: x + j + rr(-0.05, 0.05), z: z + pull, ry: PI + rr(-0.12, 0.12) });
    desks.push({ x, z, seat: new V3(x, 0.45, z + pull) });
  }
  // a few things on desks: notebooks and pencil cases, never more than one per desk
  const nbM = [0xf2efe6, 0x2f6fb0, 0xd9534f, 0x3d9970].map((c) => std({ color: c, roughness: 0.8 }));
  const DESK_TOP = new THREE.Box3().setFromObject(deskP).max.y;
  desks.forEach((d, i) => { if (rnd() < 0.45) return;
    put(box(0.21, 0.012, 0.29), nbM[i % 4], M(d.x + rr(-0.15, 0.15), DESK_TOP + 0.006, d.z + rr(-0.03, 0.05), rr(-0.5, 0.5)), { cast: false });
    if (rnd() < 0.5) put(cyl(0.004, 0.004, 0.17, 6), std({ color: 0xe9b824, roughness: 0.5 }), M(d.x + rr(-0.2, 0.2), DESK_TOP + 0.016, d.z + rr(-0.05, 0.08), rr(0, PI), 0, PI / 2), { cast: false }); });
  // teacher's desk: the old wooden table, raised to desk height, a chair behind, a laptop, books, a mug
  const TD = new V3(2.7, 0, -3.0);
  const td = place(tableP, { x: TD.x, z: TD.z, ry: 0, sx: 0.9, sy: 1.38, sz: 1.2 });
  const TDTOP = new THREE.Box3().setFromObject(td).max.y;
  place(chairP, { x: TD.x + 0.15, z: TD.z - 0.62, ry: 0.15 });
  { const lx = TD.x - 0.25, lz = TD.z + 0.02, y = TDTOP;
    put(box(0.34, 0.015, 0.24), darkM, M(lx, y + 0.008, lz, 0.1));
    put(box(0.34, 0.23, 0.01), darkM, M(lx - 0.012 * Math.sin(0.1), y + 0.015 + 0.105, lz - 0.12 - 0.02, 0.1, -0.2));
    put(new THREE.PlaneGeometry(0.31, 0.2), new THREE.MeshBasicMaterial({ color: 0x9fc4e8 }), M(lx - 0.012 * Math.sin(0.1), y + 0.015 + 0.105, lz - 0.12 - 0.02 - 0.006, PI + 0.1, 0.2), { cast: false, recv: false });
    let by = y; for (let i = 0; i < 3; i++) { const bh = rr(0.03, 0.05); put(box(0.2, bh, 0.27), bookM[(i * 5 + 2) % bookM.length], M(TD.x + 0.45, by + bh / 2, TD.z + 0.05, rr(-0.15, 0.15)), { cast: false }); by += bh; }
    put(cyl(0.04, 0.036, 0.1, 18), std({ color: 0xffffff, roughness: 0.3 }), M(TD.x + 0.1, y + 0.05, TD.z + 0.22), { cast: false });
    put(new THREE.TorusGeometry(0.028, 0.008, 6, 14), std({ color: 0xffffff, roughness: 0.3 }), M(TD.x + 0.145, y + 0.055, TD.z + 0.22, 0, 0, 0), { cast: false });
    put(box(0.22, 0.004, 0.3), std({ color: 0xfafaf5, roughness: 0.9 }), M(TD.x + 0.1, y + 0.002, TD.z - 0.1, 0.3), { cast: false });
  }

  // ---------------------------------------------------------------- outside: lawn, playground, trees, the other wing
  const grassTex = canvasTex(512, 512, (g, w, h) => { noise(g, w, h, "#5d7d3a", 0.35, 70000); for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "40,60,20" : "140,170,80"},0.4)`; g.fillRect(rnd() * w, rnd() * h, 1, 3); } });
  grassTex.repeat.set(120, 120);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), std({ map: grassTex, normalMap: rock.no, roughness: 1, normalScale: new THREE.Vector2(0.3, 0.3) }));
  rock.no.repeat.set(120, 120);
  grass.rotation.x = -PI / 2; grass.position.set(-280, -0.06, 0); grass.receiveShadow = true; groups.outside.add(grass);
  // a paved path along the building and a tarmac playground beyond it
  put(planeUV(3, 60, 2.5), mkPbr(concrete), M(X0 - WT - 1.5, -0.04, 0, 0, -PI / 2), { cast: false, group: "outside" });
  { const pg = new THREE.Mesh(planeUV(26, 34, 4), mkPbr(asphalt, { roughness: 0.9 })); pg.rotation.x = -PI / 2; pg.position.set(-22, -0.03, 2); pg.receiveShadow = true; groups.outside.add(pg);
    const lineM = new THREE.MeshBasicMaterial({ color: 0xe8e6da }), yel = new THREE.MeshBasicMaterial({ color: 0xe2b93b });
    for (const [w, d, x, z] of [[24, 0.1, -22, -14.9], [24, 0.1, -22, 18.9], [0.1, 34, -34.9, 2], [0.1, 34, -9.1, 2], [24, 0.1, -22, 2]]) put(new THREE.PlaneGeometry(w, d), lineM, M(x, -0.02, z, 0, -PI / 2), { cast: false, group: "outside" });
    put(new THREE.RingGeometry(2.9, 3.0, 48), lineM, M(-22, -0.02, 2, 0, -PI / 2), { cast: false, group: "outside" });
    for (let i = 0; i < 8; i++) put(new THREE.PlaneGeometry(0.9, 0.9), i % 2 ? yel : lineM, M(-12.5, -0.019, -10 + i * 1.0, 0, -PI / 2), { cast: false, group: "outside" });
    // basketball hoops at both ends
    for (const [z, r] of [[-14.2, 0], [18.2, PI]]) { put(cyl(0.06, 0.06, 3.0, 10), darkM, M(-22, 1.5, z), { group: "outside" }); put(box(1.2, 0.8, 0.04), frameM, M(-22, 3.1, z + (r ? -0.3 : 0.3)), { group: "outside" }); put(new THREE.TorusGeometry(0.23, 0.015, 6, 24), std({ color: 0xd35400 }), M(-22, 2.95, z + (r ? -0.6 : 0.6), 0, PI / 2), { group: "outside" }); }
    // a low fence round the yard
    for (let z = -16; z <= 20; z += 2.4) put(cyl(0.03, 0.03, 1.2, 6), darkM, M(-36, 0.6, z), { group: "outside" });
    put(box(0.04, 0.04, 36), darkM, M(-36, 1.15, 2), { group: "outside" }); put(box(0.04, 0.04, 36), darkM, M(-36, 0.6, 2), { group: "outside" });
    // benches along the path
    for (const z of [-8, 8]) { put(box(0.45, 0.05, 1.8), woodM, M(-8.0, 0.45, z), { group: "outside" }); for (const dz of [-0.7, 0.7]) put(box(0.4, 0.45, 0.06), darkM, M(-8.0, 0.22, z + dz), { group: "outside" }); }
  }
  // this building's own outside: the classroom is one of a row; the brick runs on north and south
  for (const s of [-1, 1]) put(box(10.5 + 2 * WT, H + 0.3, 16, 2.4), outerM, M(0, (H + 0.3) / 2, s * (Z1 + WT + 8.001)), { group: "neighbours" });
  const roofM = std({ color: 0x8e8a84, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 0.9 });
  put(box(X1 - X0 + 2 * WT + 0.3, 0.4, Z1 - Z0 + 2 * WT, 2.4), roofM, M(0, H + 0.5, 0), { group: "ceiling" });            // this room's roof (hidden from above)
  for (const s of [-1, 1]) put(box(10.5 + 2 * WT + 0.3, 0.4, 16, 2.4), roofM, M(0, H + 0.5, s * (Z1 + WT + 8)), { group: "neighbours" });
  // the school's other wing across the yard: brick, two storeys, rows of windows
  { const bx = -78, bw = 12, bl = 90, bh = 7.6;
    put(box(bw, bh, bl, 2.4), outerM, M(bx, bh / 2, 0), { group: "outside" });
    put(box(bw + 0.4, 0.4, bl + 0.4), std({ color: 0x77716b, roughness: 0.8 }), M(bx, bh + 0.2, 0), { group: "outside" });
    const winG = std({ color: 0x334554, roughness: 0.08, metalness: 0.8 });
    for (let f = 0; f < 2; f++) for (let z = -bl / 2 + 2.5; z < bl / 2 - 2; z += 3.2) {
      put(box(0.1, 1.9, 2.3), frameM, M(bx + bw / 2 + 0.03, 1.9 + f * 4.0, z), { group: "outside", cast: false });
      put(box(0.1, 1.75, 2.15), winG, M(bx + bw / 2 + 0.06, 1.9 + f * 4.0, z), { group: "outside", cast: false }); }
  }
  // trees: broadleaf, built from a bark trunk, a few limbs and a lumpy canopy, merged into the yard
  const barkM = std({ map: barkD, normalMap: barkN, roughness: 0.95 });
  barkD.repeat.set(2, 3); barkN.repeat.set(2, 3);
  const leafTex = canvasTex(512, 512, (g, w, h) => { noise(g, w, h, "#4a6b2a", 0.0, 0);
    for (let k = 0; k < 26000; k++) { const v = rnd(); g.fillStyle = v < 0.4 ? "rgba(32,52,18,0.55)" : v < 0.8 ? "rgba(96,132,52,0.5)" : "rgba(150,170,80,0.45)"; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 4, 1 + rnd() * 2, rnd() * PI, 0, 7); g.fill(); } });
  leafTex.repeat.set(3, 3); leafN.repeat.set(3, 3);
  const leafMs = [0x6f8f45, 0x5d8040, 0x7a9a4a].map((c) => std({ map: leafTex, color: c, normalMap: leafN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.85 }));
  function blob(r, n = 2) {
    const g = new THREE.IcosahedronGeometry(r, n), p = g.attributes.position, v = new V3();
    const a = rr(0, 6), b = rr(0, 6);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = 1 + 0.16 * Math.sin(v.x * 2.1 / r * 3 + a) * Math.cos(v.z * 1.7 / r * 3 + b) + 0.1 * Math.sin(v.y * 4.3 / r + a); v.multiplyScalar(d); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  }
  const trees = [];
  function tree(x, z, h) {
    const tr = h * 0.42, r0 = h * 0.028, lm = leafMs[Math.floor(rnd() * 3)];
    put(cyl(r0 * 0.7, r0, tr, 10), barkM, M(x, tr / 2 - 0.05, z), { group: "outside" });
    for (let i = 0; i < 3; i++) { const a = rr(0, 2 * PI), L = h * 0.22; put(cyl(r0 * 0.3, r0 * 0.5, L, 6), barkM, M(x + Math.cos(a) * L * 0.3, tr + L * 0.3, z + Math.sin(a) * L * 0.3, a, 0, 0.8), { group: "outside" }); }
    const cr = h * 0.3;
    put(blob(cr), lm, M(x, tr + cr * 0.9, z), { group: "outside" });
    for (let i = 0; i < 6; i++) { const a = rr(0, 2 * PI), d = cr * rr(0.45, 0.75), r = cr * rr(0.5, 0.75);
      put(blob(r), lm, M(x + Math.cos(a) * d, tr + cr * rr(0.5, 1.3), z + Math.sin(a) * d), { group: "outside" }); }
    trees.push(new V3(x, 0, z));
  }
  for (const z of [-24, -13, 22, 31]) tree(rr(-12, -6), z, rr(8, 10));
  for (let z = -60; z <= 60; z += 7) tree(rr(-58, -46), z + rr(-3, 3), rr(8, 12));
  for (let z = -70; z <= 70; z += 10) tree(rr(-110, -95), z, rr(12, 16));

  flush();

  // ---------------------------------------------------------------- light: the sun in through the west windows, the sky, the room lights
  const sunDir = new V3(-0.72, 0.6, 0.34).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d8, 4.2); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xe9eef4, 0x9a8f7f, 0.35); scene.add(hemi);
  // soft fill from the ceiling panels (no shadows: they would cost more than they show)
  const roomLights = new THREE.Group(); scene.add(roomLights);
  for (const [x, z] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]]) { const p = new THREE.PointLight(0xfff6e8, 6, 10, 1.4); p.position.set(x, H - 0.35, z); roomLights.add(p); }

  // ---------------------------------------------------------------- people
  const castMap = {}; figIds.forEach((id, i) => { castMap[id] = figs[i]; figs[i].object.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } }); scene.add(figs[i].object); });
  const footOf = (f, side) => { let b = null; f.object.traverse((o) => { if (!b && o.isBone && new RegExp(side + "(Foot|_foot|Foot\\.L|Foot\\.R)$", "i").test(o.name)) b = o; }); return b; };
  // walking speed from the feet: while a foot is planted it moves back at exactly the speed the body must go forward
  function gaitOf(f) {
    const out = {}; const L = footOf(f, "Left"), R = footOf(f, "Right");
    for (const g of ["walk", "run", "jog"]) {
      if (!f.actions[g]) continue;
      const fb = { walk: 1.35, run: 3.6, jog: 2.6 }[g];
      if (!L || !R) { out[g] = fb; continue; }
      const T = f.durations[g], N = 160, ys = [], zs = [];
      f.object.position.set(0, 0, 0); f.object.rotation.set(0, 0, 0);
      for (const foot of [L, R]) { const y = [], z = [];
        for (let i = 0; i <= N; i++) { f.pose((i / N) * T, { [g]: 1 }); f.object.updateMatrixWorld(true); const p = foot.getWorldPosition(new V3()); y.push(p.y); z.push(p.z); }
        ys.push(y); zs.push(z); }
      let sum = 0, cnt = 0;
      for (let k = 0; k < 2; k++) { const y = ys[k], z = zs[k], lo = Math.min(...y);
        for (let i = 0; i < N; i++) if (y[i] < lo + 0.025 && y[i + 1] < lo + 0.025) { sum += -(z[i + 1] - z[i]) / (T / N); cnt++; } }
      const v = cnt ? Math.abs(sum / cnt) : fb;
      out[g] = v > 0.3 && v < 9 ? v : fb;
    }
    f.pose(0, f.actions.idle ? { idle: 1 } : undefined); return out;
  }
  const gaitSpeed = {}; for (const id of figIds) gaitSpeed[id] = gaitOf(castMap[id]);
  const spot = new V3(-0.6, 0, -3.75);

  // ---------------------------------------------------------------- cut-away walls
  const WALLS = { north: groups.north, south: groups.south, east: groups.east, west: groups.west };
  for (const g of [...Object.values(WALLS), groups.ceiling, groups.neighbours]) g.traverse((m) => { if (m.isMesh) m.userData.mat = m.material; });
  const setGhost = (g, on) => g.traverse((m) => { if (m.isMesh) { m.material = on ? ghostM : m.userData.mat; } });
  const ghostState = { north: false, south: false, east: false, west: false, ceiling: false, neighbours: false };

  // ---------------------------------------------------------------- update
  const _f = new V3();
  let lastBoard = null, lastScreen;
  function poseFig(f, s, time, def) {
    const o = f.object; o.visible = s.show !== false;
    const g = { ...(s.gait || {}) }; if (s.clip && f.actions[s.clip]) g[s.clip] = 1;
    let sum = 0; for (const k in g) { if (!f.actions[k]) delete g[k]; else sum += g[k]; }
    if (f.actions.idle) g.idle = Math.max(0, 1 - sum);
    f.pose(s.time ?? time, g);
    o.position.set(s.x ?? def.x, 0, s.z ?? def.z); o.rotation.set(0, s.heading ?? def.heading, 0);
  }
  function update(st = {}) {
    const time = st.time || 0, people = st.people || {};
    figIds.forEach((id, i) => poseFig(castMap[id], people[id] || {}, time + i * 0.6, { x: spot.x + i * 1.0, z: spot.z + i * 0.2, heading: i ? -0.5 : 0 }));
    camera.updateMatrixWorld();
    const cp = camera.position, camUp = cp.y > H - 0.05, ceilOn = st.ceiling ?? !camUp;
    if (ceilOn === ghostState.ceiling) { setGhost(groups.ceiling, !ceilOn); ghostState.ceiling = !ceilOn; }
    const nbOn = st.neighbours ?? !camUp;   // the classrooms either side and the corridor: hidden from above, so the room shows whole
    if (nbOn === ghostState.neighbours) { setGhost(groups.neighbours, !nbOn); ghostState.neighbours = !nbOn; }
    // the walls between an outside camera and the room go to ghosts (they still shade the room)
    const cut = st.cutaway !== false;
    const want = { north: cut && cp.z < Z0 - 0.05, south: cut && cp.z > Z1 + 0.05, west: cut && cp.x < X0 - 0.05, east: cut && cp.x > X1 + 0.05 };
    for (const k in want) if (want[k] !== ghostState[k]) { setGhost(WALLS[k], want[k]); ghostState[k] = want[k]; }
    if (st.board !== undefined && st.board !== lastBoard) { drawBoard(st.board); lastBoard = st.board; }
    if (st.screen !== undefined && st.screen !== lastScreen) { drawScreen(st.screen); lastScreen = st.screen; }
    // shadow box: the whole room and the near yard, centred on the focus
    const f = st.focus ? _f.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : _f.set(-1.5, 0, 0);
    const R = st.shadowRadius ?? 11;
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 200 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sunDir, 90); sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: castMap[figIds[0]]?.object, gaitSpeed, spot,
    board: { ...BOARD, mesh: boardMesh, draw: drawBoard }, screen: { ...SCREEN, mesh: screenMesh, draw: drawScreen },
    aisle: { x: 0, z0: -3.3, z1: 4.0, halfWidth: 1.0 }, front: { z: -2.9, x0: -4.4, x1: 1.6 },
    desks, teacherDesk: TD.clone(), door: { x: X1, z: (DOOR.z0 + DOOR.z1) / 2 }, windows: WIN.map((w) => ({ ...w })),
    clock, sun, sunDir: sunDir.clone(), H, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1 },
    ceilingGroup: groups.ceiling, walls: WALLS, trees,
  };
}
