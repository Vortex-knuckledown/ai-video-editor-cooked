// World "office": a modern open-plan office interior high in a city tower, by day.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. Floor at y = 0, ceiling at y = 3.2 (world.H).
// The room is x -22..22, z -12..12. Floor-to-ceiling windows on the NORTH wall (z = -12) and the EAST wall
// (x = 22) look out over a city skyline (the street is 60 m below, y = -60). The SOUTH wall (z = 12) is
// exposed brick, the WEST wall (x = -22) is painted plaster with a kitchen counter, shelves and a fridge.
// The main AISLE runs the whole length along x at z = 0 (clear for |z| < 2.4, x -20..20): people walk it.
// Desk banks run north-south off the aisle: north side at x = -18,-13,-8,-3,2,7,12,17 (z -3.2..-9.6), south side
// at x = -18,-13,-8,-3,2,7 (z 3.2..9.6). Each bank seats 8 (monitors, keyboards, office chairs), with a felt
// divider and a low storage bench with plants at the aisle end. Concrete columns at x = -10.5,-0.5,9.5, z = +-6.4.
// The glass-walled MEETING ROOM is x 11..22, z 3.5..12 (door in its north glass at x 12..13, z 3.5) with a
// 4.4 m table, 8 chairs, a wall screen and a pendant. Linear pendant lights and ducts hang from the ceiling;
// they hide themselves when the camera rises above the ceiling (the ceiling is one-sided, so a camera above
// y = 3.2 looking down sees the whole floor as a cutaway).
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], crowd}) -> world.
//   cast:  library characters to load (man, woman, robot, soldier, mannequin); each is world.cast.<id>.
//   crowd: background people standing talking, [{id, x, z, heading, clip}] (default: one "man", or "woman" when
//          the cast already has a man, talking at the south edge of the aisle at x = -12, z = 2.2, facing north).
// Per frame: set world.camera, then world.update(state), then world.render().
//
// state (every field optional):
//   time         seconds of the shot (animation clock by default)
//   people       {<cast id>: {x, z, heading, time, gait: {walk, run, jog, talk}, show}}
//                heading radians about +y: 0 faces +z (south), PI/2 faces east (+x, along the aisle), -PI/2 west.
//                gait weights 0..1, idle takes the rest. Move a walker by world.gaitSpeed.<id>.walk * walk * dt
//                so the feet never slide. Default: cast[0] stands in the aisle at x = -12, z = 0.9 facing the
//                crowd talker; later cast members stand beside it.
//   crowd        {<index or id>: {x, z, heading, time, clip, show}} overrides for the crowd; crowd: false hides it
//   ceiling      true/false forces the ceiling fixtures on or off (default: on unless the camera is above y = 3.1)
//   focus        {x, y, z} the centre of the sun's shadow box (default: cast[0])
//   shadowRadius metres of the shadow box (default from the camera's distance to the focus)
//
// Exposes: world.cast.<id> (loadFigure results), world.person (cast[0].object), world.crowd (array),
// world.gaitSpeed.<id> {walk, run, jog} m/s measured from the feet, world.aisle {z, x0, x1, halfWidth},
// world.spot (Vector3, cast[0]'s default place), world.meetingRoom {x0, x1, z0, z1, door: {x, z}, table: Vector3},
// world.banks [{x, z0, z1, side}], world.kitchen (Vector3), world.windows {north: -12, east: 22},
// world.sun (DirectionalLight), world.sunDir, world.H (3.2), world.bounds {x0, x1, z0, z1}, world.ceilingGroup.
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
  scene.fog = new THREE.Fog(0xc4d2df, 90, 1500);
  const camera = new THREE.PerspectiveCamera(38, W / Hh, 0.05, 4000);
  camera.position.set(20, 2.6, 1.2); camera.lookAt(-6, 1.3, 0);

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f, srgb) => new Promise((res, rej) => TL.load(K + f, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); }, undefined, rej));
  const pbrSet = async (n) => { const [d, no, r] = await Promise.all([tex(`pbr/${n}_diff.jpg`, true), tex(`pbr/${n}_nor.jpg`), tex(`pbr/${n}_rough.jpg`)]); return { d, no, r }; };
  const figIds = [...new Set(cast)];
  const crowdList = (crowd ?? [{ id: cast.includes("man") ? "woman" : "man", x: -12, z: 2.2, heading: PI, clip: "talk" }]);
  const [sky, concrete, brick, plantA, plantB, mchair, ...figs] = await Promise.all([
    new HDRLoader().loadAsync(K + "sky/day.hdr"), pbrSet("concrete"), pbrSet("brick"),
    loadProp({ THREE, id: "potted_plant_01" }), loadProp({ THREE, id: "potted_plant_02" }), loadProp({ THREE, id: "dining_chair_02" }),
    ...figIds.map((id) => loadFigure({ THREE, id, clips: clipsFor(id) })),
    ...crowdList.map((c) => loadFigure({ THREE, id: c.id, clips: clipsFor(c.id) })),
  ]);
  function clipsFor(id) { return { man: ["idle", "walk", "run", "jog", "talk"], woman: ["idle", "walk", "run", "jog", "talk"], robot: ["idle", "walk", "run", "wave"] }[id] || ["idle", "walk", "run"]; }
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.environmentIntensity = 0.75; scene.backgroundIntensity = 1.0;

  // ---------------------------------------------------------------- helpers
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
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
  const cyl = (r0, r1, h, n = 14) => new THREE.CylinderGeometry(r0, r1, h, n);
  const _e = new THREE.Euler(), _q = new THREE.Quaternion();
  const M = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), new V3(s, s, s));
  const I = new THREE.Matrix4();
  // static geometry is merged per material: thousands of parts, a few dozen draw calls
  const bins = new Map();
  function put(geo, mat, m = I, { cast: cs = true, recv = true, group = "static" } = {}) {
    const key = `${mat.uuid}|${cs}|${recv}|${group}`;
    if (!bins.has(key)) bins.set(key, { mat, cs, recv, group, list: [] });
    bins.get(key).list.push(geo.clone().applyMatrix4(m));
  }
  const groups = { static: new THREE.Group(), ceiling: new THREE.Group(), city: new THREE.Group() };
  for (const g of Object.values(groups)) scene.add(g);
  function flush() {
    for (const b of bins.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(b.list, false), b.mat);
      mesh.castShadow = b.cs; mesh.receiveShadow = b.recv; groups[b.group].add(mesh);
    }
    bins.clear();
  }

  // ---------------------------------------------------------------- materials
  const H = 3.2, X0 = -22, X1 = 22, Z0 = -12, Z1 = 12;
  const mkPbr = (set, o = {}) => std({ map: set.d, normalMap: set.no, roughnessMap: set.r, ...o });
  const floorM = mkPbr(concrete, { roughness: 0.62, normalScale: new THREE.Vector2(0.35, 0.35) }); floorM.color.setRGB(1.45, 1.47, 1.5);
  const ceilM = std({ color: 0xe4e2dc, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 1, normalScale: new THREE.Vector2(0.3, 0.3), emissive: 0x8c8a85 });
  const plasterM = std({ color: 0xe9e6df, normalMap: concrete.no, roughnessMap: concrete.r, roughness: 1, normalScale: new THREE.Vector2(0.25, 0.25) });
  const columnM = mkPbr(concrete, { roughness: 1 }); columnM.color.setRGB(1.9, 1.88, 1.82);
  const brickM = mkPbr(brick, { roughness: 1 }); brickM.color.setRGB(1.05, 0.98, 0.95);
  const metalDark = std({ color: 0x26282c, roughness: 0.45, metalness: 0.65 });
  const alu = std({ color: 0xa9aeb3, roughness: 0.32, metalness: 0.85 });
  const steel = std({ color: 0xc4c7ca, roughness: 0.28, metalness: 0.9 });
  const ductM = std({ color: 0xd4d7d9, roughness: 0.42, metalness: 0.35, emissive: 0x3a3c3e });
  const whiteLam = std({ color: 0xeceae5, roughness: 0.42 });
  const greyLam = std({ color: 0xc9c7c2, roughness: 0.5 });
  const plasticBlk = std({ color: 0x1b1c1f, roughness: 0.5 });
  const plasticWht = std({ color: 0xe6e6e3, roughness: 0.38 });
  const glassM = new THREE.MeshStandardMaterial({ color: 0xd8e8ee, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const lightM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 2.3, 2.1) });
  const noise = (g, w, h, base, amp, n) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (rnd() - 0.5) * amp; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } };
  const fabricTex = (base) => canvasTex(256, 256, (g, w, h) => noise(g, w, h, base, 0.22, 26000));
  const woodTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = "#c7a57c"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { const y0 = rnd() * h, a = rnd() * 0.12, ph = rnd() * 6, f = 0.004 + rnd() * 0.01, amp = 1 + rnd() * 5;
      g.strokeStyle = rnd() < 0.5 ? `rgba(120,80,45,${a})` : `rgba(245,220,185,${a})`; g.lineWidth = 0.6 + rnd() * 2.2; g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1) * amp * 0.3; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  });
  const woodM = std({ map: woodTex, roughness: 0.48 });
  const feltCols = ["#6f7f74", "#7d8790", "#8a7f72", "#5f6b78"];
  const feltM = feltCols.map((c) => std({ map: fabricTex(c), roughness: 0.95 }));
  const chairFab = [std({ map: fabricTex("#2e3134"), roughness: 0.9 }), std({ map: fabricTex("#3b4552"), roughness: 0.9 })];
  const mugM = [0xf2f0ea, 0x2f5d8a, 0xc0503c, 0x1e1f22, 0xe2b13c].map((c) => std({ color: c, roughness: 0.35 }));
  const paperM = [0xf4f2ec, 0x2b4a6f, 0x8c3b33, 0xd9cfa8].map((c) => std({ color: c, roughness: 0.8 }));

  // monitor screens: a code editor, a spreadsheet, a dashboard, a design canvas, a mail list
  const screenTex = [
    (g, w, h) => { g.fillStyle = "#1e2229"; g.fillRect(0, 0, w, h); g.fillStyle = "#262b33"; g.fillRect(0, 0, 70, h);
      for (let y = 18; y < h - 8; y += 13) { let x = 84 + Math.floor(rnd() * 4) * 18; const n = 1 + Math.floor(rnd() * 5);
        for (let k = 0; k < n; k++) { const ww = 20 + rnd() * 90; g.fillStyle = ["#c678dd", "#61afef", "#98c379", "#e5c07b", "#abb2bf", "#e06c75"][Math.floor(rnd() * 6)]; g.fillRect(x, y, ww, 6); x += ww + 8; if (x > w - 20) break; } } },
    (g, w, h) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = "#1f7a45"; g.fillRect(0, 0, w, 22); g.fillStyle = "#eef1f4"; g.fillRect(0, 22, w, 18);
      g.strokeStyle = "#d4d8dc"; for (let x = 40; x < w; x += 64) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, h); g.stroke(); } for (let y = 40; y < h; y += 15) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = "#5b6066"; for (let y = 45; y < h; y += 15) for (let x = 44; x < w; x += 64) if (rnd() < 0.75) g.fillRect(x + 4, y + 3, 14 + rnd() * 36, 5); },
    (g, w, h) => { g.fillStyle = "#f4f6f9"; g.fillRect(0, 0, w, h); g.fillStyle = "#24324a"; g.fillRect(0, 0, 64, h);
      for (let i = 0; i < 3; i++) { g.fillStyle = "#fff"; g.fillRect(80 + i * 140, 18, 128, 60); g.fillStyle = ["#3b82f6", "#10b981", "#f59e0b"][i]; g.fillRect(90 + i * 140, 52, 50 + rnd() * 50, 12); }
      g.fillStyle = "#fff"; g.fillRect(80, 92, 268, 200); g.strokeStyle = "#3b82f6"; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= 240; x += 20) { const y = 260 - x * 0.45 - rnd() * 40; x ? g.lineTo(94 + x, y) : g.moveTo(94, y); } g.stroke();
      g.fillStyle = "#fff"; g.fillRect(360, 92, 140, 200); for (let i = 0; i < 6; i++) { g.fillStyle = "#10b981"; g.fillRect(372 + i * 21, 280 - (40 + rnd() * 140), 14, 40 + rnd() * 140); g.fillRect(372 + i * 21, 150, 0, 0); } },
    (g, w, h) => { g.fillStyle = "#2c2c2e"; g.fillRect(0, 0, w, h); g.fillStyle = "#3a3a3d"; g.fillRect(0, 0, w, 20); g.fillRect(w - 90, 20, 90, h);
      g.fillStyle = "#e9e5df"; g.fillRect(70, 40, 320, 260); for (let i = 0; i < 5; i++) { g.fillStyle = ["#ef6f5e", "#4c8bf5", "#f6c445", "#5cc58a", "#a879e8"][i]; g.fillRect(90 + rnd() * 220, 60 + rnd() * 180, 40 + rnd() * 70, 26 + rnd() * 50); } },
    (g, w, h) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = "#0f62c9"; g.fillRect(0, 0, w, 24); g.fillStyle = "#f1f3f4"; g.fillRect(0, 24, 110, h);
      for (let y = 34; y < h; y += 28) { g.fillStyle = "#202124"; g.fillRect(124, y, 60 + rnd() * 40, 6); g.fillStyle = "#9aa0a6"; g.fillRect(124, y + 11, 200 + rnd() * 160, 5); g.fillStyle = "#e8eaed"; g.fillRect(118, y + 22, w, 1); } },
  ].map((f) => std({ map: canvasTex(512, 320, f), emissive: 0xffffff, emissiveMap: null, roughness: 0.25, metalness: 0 }));
  for (const m of screenTex) { m.emissiveMap = m.map; m.emissiveIntensity = 0.75; m.color.setRGB(0.35, 0.35, 0.35); }

  // ---------------------------------------------------------------- the room shell
  { const fg = box(X1 - X0, 0.1, Z1 - Z0, 3.2); put(fg, floorM, M(0, -0.05, 0), { cast: false }); }
  { const cg = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0); const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 44 / 3.5, uv.getY(i) * 24 / 3.5);
    const ceil = new THREE.Mesh(cg, ceilM); ceil.rotation.x = PI / 2; ceil.position.y = H; ceil.receiveShadow = false; scene.add(ceil); }
  // south: exposed brick, a concrete skirting
  put(box(X1 - X0, H, 0.3, 2.2), brickM, M(0, H / 2, Z1 + 0.15));
  put(box(X1 - X0, 0.1, 0.02), greyLam, M(0, 0.05, Z1 - 0.01));
  // west: painted plaster
  put(box(0.3, H, Z1 - Z0, 3), plasterM, M(X0 - 0.15, H / 2, 0));
  // the tower below and the slab edge, so the floor sits on its building from above
  // windows: north (z = Z0) and east (x = X1)
  const glassPanes = [];
  function windowWall(axis) {
    const len = axis === "x" ? X1 - X0 : Z1 - Z0, n = Math.round(len / 1.5);
    const at = (u, y, off = 0) => axis === "x" ? M(X0 + u, y, Z0 - off) : M(X1 + off, y, Z0 + u, PI / 2);
    for (let i = 0; i <= n; i++) put(box(0.07, H, 0.14), alu, at(i * len / n, H / 2, 0.02));
    put(box(len, 0.12, 0.16), alu, at(len / 2, 0.06, 0.02)); put(box(len, 0.14, 0.16), alu, at(len / 2, H - 0.07, 0.02));
    put(box(len, 0.06, 0.08), alu, at(len / 2, 2.45, 0.02));                              // transom
    put(box(len, 0.22, 0.22), plasticWht, at(len / 2, 0.11, -0.16), { cast: false });   // perimeter convector
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(len, H), glassM); gp.applyMatrix4(at(len / 2, H / 2, 0.04)); gp.renderOrder = 2; scene.add(gp); glassPanes.push(gp);
    // a few roller blinds partly down
    for (let i = 0; i < n; i++) { if (rnd() > 0.35) continue; const drop = rr(0.25, 1.1), w = len / n - 0.1;
      put(cyl(0.04, 0.04, w, 10), plasticWht, at((i + 0.5) * len / n, H - 0.2, -0.12).multiply(M(0, 0, 0, 0, 0, PI / 2)), { cast: false, group: "ceiling" });
      put(box(w, drop, 0.01), blindM, at((i + 0.5) * len / n, H - 0.22 - drop / 2, -0.12), { cast: false }); }
  }
  const blindM = std({ color: 0xece8de, roughness: 0.9, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  windowWall("x"); windowWall("z");
  // columns
  const COLS = [];
  for (const cx of [-10.5, -0.5, 9.5]) for (const cz of [-6.4, 6.4]) { put(cyl(0.3, 0.3, H, 28), columnM, M(cx, H / 2, cz)); COLS.push(new V3(cx, 0, cz)); }

  // ---------------------------------------------------------------- the city outside: streets 60 m below, blocks of towers
  const GY = -60;
  const facade = (kind) => canvasTex(512, 512, (g, w, h) => {
    const P = { glass: ["#5d6f80", "#2e4052", "#8fb0c8"], stone: ["#c9bfae", "#3a4048", "#9fb2c2"], conc: ["#a7a9aa", "#30363d", "#8ea6ba"], dark: ["#2b2f35", "#1d2a38", "#5f7b94"] }[kind];
    g.fillStyle = P[0]; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = c * 128 + (kind === "glass" || kind === "dark" ? 6 : 16), y = r * 128 + (kind === "glass" || kind === "dark" ? 14 : 26), ww = kind === "glass" || kind === "dark" ? 116 : 96, hh = kind === "glass" || kind === "dark" ? 108 : 84;
      const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, P[2]); gr.addColorStop(1, P[1]); g.fillStyle = gr; g.fillRect(x, y, ww, hh);
      if (rnd() < 0.35) { g.fillStyle = "rgba(230,226,215,0.75)"; g.fillRect(x, y, ww, hh * rr(0.2, 0.7)); }
      if (rnd() < 0.2) { g.fillStyle = "rgba(255,240,200,0.25)"; g.fillRect(x, y, ww, hh); }
      g.fillStyle = P[0]; if (kind === "glass" || kind === "dark") { g.fillRect(x + ww / 2 - 1, y, 3, hh); }
    }
  });
  const facM = ["glass", "stone", "conc", "dark"].map((k) => std({ map: facade(k), roughness: k === "glass" || k === "dark" ? 0.25 : 0.75, metalness: k === "glass" || k === "dark" ? 0.5 : 0.05 }));
  const roofM = std({ color: 0x8b8d8f, roughness: 0.9 });
  const asphaltM = std({ color: 0x4a4c50, roughness: 0.95 }), paveM = std({ color: 0xa8a59f, roughness: 0.9 });
  { const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), asphaltM); ground.rotation.x = -PI / 2; ground.position.y = GY; groups.city.add(ground); }
  function building(x, z, w, d, top, kind) {
    const h = top - GY, g = boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 12, 14.4);
    const uv = g.attributes.uv; for (let k = 8; k < 16; k++) uv.setXY(k, 0.004, 0.004);   // roofs take the spandrel colour
    put(g, facM[kind], M(x, GY + h / 2, z), { cast: false, recv: false, group: "city" });
    put(box(w * 0.4, 3, d * 0.4), roofM, M(x + rr(-0.2, 0.2) * w, top + 1.5, z + rr(-0.2, 0.2) * d), { cast: false, recv: false, group: "city" });
  }
  const BL = 72;
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
    const cx = i * BL, cz = j * BL; put(box(52, 0.3, 52), paveM, M(cx, GY + 0.15, cz), { cast: false, recv: false, group: "city" });
    if (i === 0 && j === 0) continue;
    const near = Math.max(Math.abs(i), Math.abs(j)) <= 1, dd = Math.hypot(i - 3, j + 4);
    const lots = rnd() < 0.5 ? [[0, 0, 44, 44]] : [[-11, 0, 20, 44], [11, 0, 20, 44]];
    for (const [ox, oz, w, d] of lots) {
      let top = GY + 20 + rnd() * rnd() * 150 * (1 + 1.6 * Math.exp(-dd / 2.5));
      if (near) top = Math.min(top, GY + 52);
      building(cx + ox, cz + oz, w - rr(0, 6), d - rr(0, 6), top, Math.floor(rnd() * 4));
    }
  }
  // our own tower below this floor, and the slab edge
  { const h = -0.4 - GY, g = boxUV(new THREE.BoxGeometry(X1 - X0 + 0.6, h, Z1 - Z0 + 0.6), X1 - X0 + 0.6, h, Z1 - Z0 + 0.6, 12, 14.4);
    put(g, facM[0], M(0, GY + h / 2, 0), { cast: false, recv: false, group: "city" });
    put(box(X1 - X0 + 0.8, 0.4, Z1 - Z0 + 0.8, 3), columnM, M(0, -0.25, 0), { cast: false }); }

  // ---------------------------------------------------------------- furniture builders
  const TOP = 0.75;
  function officeChair(P, fab) {
    for (let k = 0; k < 5; k++) { const a = k * 2 * PI / 5;
      put(box(0.045, 0.035, 0.3), plasticBlk, P.clone().multiply(M(Math.sin(a) * 0.15, 0.075, Math.cos(a) * 0.15, a)));
      put(new THREE.SphereGeometry(0.03, 10, 8), plasticBlk, P.clone().multiply(M(Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29))); }
    put(cyl(0.045, 0.05, 0.06), plasticBlk, P.clone().multiply(M(0, 0.08, 0)));
    put(cyl(0.022, 0.022, 0.3, 10), steel, P.clone().multiply(M(0, 0.25, 0)));
    put(box(0.22, 0.05, 0.22), plasticBlk, P.clone().multiply(M(0, 0.4, 0)));
    put(box(0.5, 0.075, 0.48), fab, P.clone().multiply(M(0, 0.455, 0.01)));
    put(box(0.06, 0.34, 0.035), plasticBlk, P.clone().multiply(M(0, 0.55, -0.25, 0, -0.1)));
    put(box(0.46, 0.55, 0.06), fab, P.clone().multiply(M(0, 0.86, -0.27, 0, -0.12)));
    for (const sx of [-1, 1]) { put(box(0.03, 0.2, 0.03), plasticBlk, P.clone().multiply(M(sx * 0.265, 0.56, -0.02)));
      put(box(0.065, 0.025, 0.24), plasticBlk, P.clone().multiply(M(sx * 0.265, 0.665, 0.0))); }
  }
  function monitor(P, scr, ox = 0, ry = 0) {
    const Q = P.clone().multiply(M(ox, 0, 0, ry));
    put(box(0.22, 0.012, 0.17), metalDark, Q.clone().multiply(M(0, TOP + 0.006, -0.02)));
    put(box(0.045, 0.32, 0.02), metalDark, Q.clone().multiply(M(0, TOP + 0.17, -0.08)));
    put(box(0.62, 0.37, 0.025), plasticBlk, Q.clone().multiply(M(0, TOP + 0.4, -0.06)));
    put(new THREE.PlaneGeometry(0.595, 0.335), scr, Q.clone().multiply(M(0, TOP + 0.405, -0.0465)), { cast: false });
  }
  function laptop(P, scr) {
    put(box(0.32, 0.016, 0.22), alu, P.clone().multiply(M(0, TOP + 0.008, 0)));
    const L = P.clone().multiply(M(0, TOP + 0.016, -0.11, 0, -0.32));
    put(box(0.32, 0.21, 0.008), alu, L.clone().multiply(M(0, 0.105, 0)));
    put(new THREE.PlaneGeometry(0.29, 0.18), scr, L.clone().multiply(M(0, 0.108, 0.0045)), { cast: false });
  }
  const smallPlants = [], bigPlants = [];
  const banks = [];
  function bank(cx, z0, z1, feltI) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2, dir = Math.sign(z1 - z0), side = dir;   // dir: +1 south side, -1 north side
    banks.push({ x: cx, z0, z1, side: dir > 0 ? "south" : "north" });
    put(box(1.6, 0.03, len), woodM, M(cx, TOP - 0.015, zc));
    for (const sx of [-1, 1]) put(box(0.04, 0.03, len), whiteLam, M(cx + sx * 0.8, TOP - 0.015, zc), { cast: false });
    for (const k of [0, 0.5, 1]) { const fz = z0 + (z1 - z0) * k + (k === 0 ? dir * 0.06 : k === 1 ? -dir * 0.06 : 0);
      for (const sx of [-1, 1]) put(box(0.05, TOP - 0.03, 0.05), metalDark, M(cx + sx * 0.7, (TOP - 0.03) / 2, fz));
      put(box(1.45, 0.04, 0.05), metalDark, M(cx, 0.06, fz)); }
    for (const sx of [-1, 1]) put(box(0.04, 0.07, len - 0.1), metalDark, M(cx + sx * 0.7, TOP - 0.065, zc));
    put(box(0.03, 0.38, len - 0.04), feltM[feltI], M(cx, TOP + 0.19, zc));
    put(box(0.05, 0.02, len - 0.04), alu, M(cx, TOP + 0.39, zc));
    // storage bench at the aisle end
    const ez = z0 - dir * 0.27;
    put(box(1.6, 0.6, 0.44), greyLam, M(cx, 0.3, ez));
    put(box(1.6, 0.06, 0.45), feltM[(feltI + 1) % 4], M(cx, 0.63, ez));
    if (rnd() < 0.6) smallPlants.push({ x: cx + rr(-0.45, 0.45), y: 0.66, z: ez, h: rr(0.5, 0.75) });
    // eight places
    let n = 0;
    for (let s = 0; s < 4; s++) for (const sx of [-1, 1]) {
      const sz = z0 + dir * (0.8 + s * 1.6), P = M(cx + sx * 0.32, 0, sz, sx * PI / 2);   // local +z points at the sitter
      const pick = Math.floor(rnd() * 5), r = rnd(); n++;
      if (r < 0.18) laptop(P.clone().multiply(M(0, 0, 0.18)), screenTex[pick]);
      else if (r < 0.45) { monitor(P, screenTex[pick], -0.33, 0.12); monitor(P, screenTex[(pick + 2) % 5], 0.33, -0.12); }
      else monitor(P, screenTex[pick]);
      if (r >= 0.18) { put(box(0.44, 0.018, 0.14), rnd() < 0.5 ? plasticBlk : plasticWht, P.clone().multiply(M(0, TOP + 0.009, 0.3)));
        put(box(0.06, 0.025, 0.1), plasticBlk, P.clone().multiply(M(0.32, TOP + 0.012, 0.3))); }
      if (rnd() < 0.55) put(cyl(0.04, 0.036, 0.1), mugM[Math.floor(rnd() * 5)], P.clone().multiply(M(-0.42 + rr(-0.05, 0.05), TOP + 0.05, 0.25)));
      if (rnd() < 0.5) put(box(0.21, 0.014 + rnd() * 0.02, 0.29), paperM[Math.floor(rnd() * 4)], P.clone().multiply(M(rr(0.42, 0.55) * (rnd() < 0.5 ? 1 : -1), TOP + 0.012, 0.2, rr(-0.4, 0.4))));
      if (rnd() < 0.08) smallPlants.push({ x: cx + sx * 0.25, y: TOP, z: sz + dir * 0.55, h: rr(0.3, 0.42) });
      if (rnd() < 0.9) officeChair(M(cx + sx * rr(1.12, 1.4), 0, sz + rr(-0.2, 0.2), -sx * PI / 2 + rr(-0.45, 0.45)), chairFab[(n + feltI) % 2]);
    }
  }
  const NORTH = [-18, -13, -8, -3, 2, 7, 12, 17], SOUTH = [-18, -13, -8, -3, 2, 7];
  NORTH.forEach((x, i) => bank(x, -3.2, -9.6, i % 4));
  SOUTH.forEach((x, i) => bank(x, 3.2, 9.6, (i + 2) % 4));
  // tall plants: between banks along the windows, in the corners, by the meeting-room door and the kitchen
  for (let i = 0; i < NORTH.length - 1; i++) if (i % 2 === 0) bigPlants.push({ x: (NORTH[i] + NORTH[i + 1]) / 2, z: -10.9, h: rr(1.1, 1.4), b: true });
  bigPlants.push({ x: -21.0, z: -11.0, h: 1.7 }, { x: 21.0, z: -11.0, h: 1.75 }, { x: 10.4, z: 2.9, h: 1.55 }, { x: -21.1, z: 4.0, h: 1.5 }, { x: -21.0, z: 11.0, h: 1.6, b: true }, { x: 21.2, z: 4.3, h: 1.4, b: true });

  // ---------------------------------------------------------------- meeting room (glass)
  const MR = { x0: 11, x1: X1, z0: 3.5, z1: Z1 };
  const frosted = std({ map: canvasTex(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "rgba(255,255,255,0.85)"; for (let x = 4; x < w; x += 10) for (let y = 4; y < h; y += 10) { g.beginPath(); g.arc(x + ((y / 10) % 2) * 5, y, 3, 0, 7); g.fill(); } }), transparent: true, depthWrite: false, roughness: 0.6, side: THREE.DoubleSide });
  frosted.map.repeat.set(1, 1);
  function glassWall(axis, a0, a1, fixed, door) {
    const len = a1 - a0, n = Math.max(2, Math.round(len / 1.4));
    const at = (u, y) => axis === "x" ? M(a0 + u, y, fixed) : M(fixed, y, a0 + u, PI / 2);
    for (let i = 0; i <= n; i++) put(box(0.05, H, 0.08), alu, at(i * len / n, H / 2));
    put(box(len, 0.06, 0.1), alu, at(len / 2, 0.03)); put(box(len, 0.08, 0.1), alu, at(len / 2, H - 0.04));
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(len, H), glassM); gp.applyMatrix4(at(len / 2, H / 2)); gp.renderOrder = 2; scene.add(gp); glassPanes.push(gp);
    const fg = new THREE.PlaneGeometry(len, 0.22); const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.0, uv.getY(i));
    const fb = new THREE.Mesh(fg, frosted); fb.applyMatrix4(at(len / 2, 1.2)); fb.renderOrder = 3; scene.add(fb);
    if (door) { const [d0, d1] = door;
      for (const u of [d0, d1]) put(box(0.07, H, 0.1), alu, at(u - a0, H / 2));
      put(box(d1 - d0, 0.06, 0.1), alu, at((d0 + d1) / 2 - a0, 2.2));
      for (const o of [-0.07, 0.07]) { const B = at(d1 - a0 - 0.12, 1.05).multiply(M(0, 0, o)); put(cyl(0.014, 0.014, 1.2, 10), steel, B);
        for (const yy of [-0.5, 0.5]) put(box(0.02, 0.02, 0.07), steel, B.clone().multiply(M(0, yy, -Math.sign(o) * 0.035))); } }
  }
  glassWall("x", MR.x0, MR.x1, MR.z0, [12.0, 13.0]);
  glassWall("z", MR.z0, MR.z1, MR.x0);
  const TBL = new V3(16.5, 0, 7.75);
  put(box(4.4, 0.04, 1.3), woodM, M(TBL.x, TOP - 0.02, TBL.z));
  for (const sx of [-1, 1]) { put(box(0.06, TOP - 0.04, 0.95), metalDark, M(TBL.x + sx * 1.75, (TOP - 0.04) / 2, TBL.z)); put(box(0.5, 0.03, 1.0), metalDark, M(TBL.x + sx * 1.75, 0.015, TBL.z)); }
  put(box(0.3, 0.06, 0.18), plasticBlk, M(TBL.x, TOP + 0.03, TBL.z));                 // conference speaker
  put(box(3.4, 0.05, 0.07), metalDark, M(TBL.x, H - 0.8, TBL.z), { group: "ceiling" });
  put(box(3.36, 0.012, 0.06), lightM, M(TBL.x, H - 0.83, TBL.z), { cast: false, group: "ceiling" });
  for (const sx of [-1, 1]) put(cyl(0.003, 0.003, 0.78, 4), metalDark, M(TBL.x + sx * 1.5, H - 0.39, TBL.z), { cast: false, group: "ceiling" });
  // wall screen and credenza on the brick
  const tvM = std({ map: canvasTex(640, 360, (g, w, h) => { g.fillStyle = "#0e1726"; g.fillRect(0, 0, w, h); g.fillStyle = "#1c2a40"; g.fillRect(30, 30, w - 60, h - 60);
    for (let i = 0; i < 9; i++) { const bh = 40 + i * 18 + rnd() * 30; g.fillStyle = i === 8 ? "#f5b642" : "#4e8ef7"; g.fillRect(70 + i * 56, h - 60 - bh, 36, bh); }
    g.fillStyle = "#e8eef7"; g.fillRect(70, 52, 200, 12); g.fillStyle = "#8193ad"; g.fillRect(70, 74, 130, 8); }), roughness: 0.2 });
  tvM.emissive = new THREE.Color(0xffffff); tvM.emissiveMap = tvM.map; tvM.emissiveIntensity = 0.8; tvM.color.setRGB(0.3, 0.3, 0.3);
  put(box(1.95, 1.12, 0.05), plasticBlk, M(TBL.x, 1.6, Z1 - 0.03));
  put(new THREE.PlaneGeometry(1.9, 1.07), tvM, M(TBL.x, 1.6, Z1 - 0.056, PI), { cast: false });
  put(box(2.8, 0.62, 0.44), woodM, M(TBL.x, 0.31, Z1 - 0.24));
  // chairs round the table (a library chair, turned to face the table)
  const chairBox = new THREE.Box3().setFromObject(mchair), chairS = 0.86 / Math.max(0.5, chairBox.max.y - chairBox.min.y);
  const meetChairs = [];
  for (const x of [15.1, 16.5, 17.9]) for (const sz of [-1, 1]) meetChairs.push([x + rr(-0.08, 0.08), TBL.z + sz * 1.08, sz > 0 ? PI : 0]);
  meetChairs.push([TBL.x - 2.85, TBL.z, PI / 2], [TBL.x + 2.85, TBL.z, -PI / 2]);
  for (const [x, z, ry] of meetChairs) { const c = mchair.clone(); c.scale.setScalar(chairS); c.position.set(x, -chairBox.min.y * chairS, z); c.rotation.y = ry + rr(-0.15, 0.15); scene.add(c); }

  // ---------------------------------------------------------------- kitchen on the west wall
  const KX = X0 + 0.32;
  put(box(0.62, 0.86, 5.3), whiteLam, M(KX, 0.43, 0.35));
  for (let k = 0; k < 9; k++) put(box(0.005, 0.8, 0.003), greyLam, M(KX + 0.312, 0.44, -2.3 + k * 0.6 + 0.6), { cast: false });
  put(box(0.66, 0.04, 5.34), std({ color: 0xf1efea, roughness: 0.25 }), M(KX + 0.02, 0.88, 0.35));
  put(box(0.7, 1.95, 0.72), steel, M(KX + 0.04, 0.975, -2.75));                       // fridge
  put(box(0.02, 0.9, 0.03), metalDark, M(KX + 0.4, 1.3, -2.48));
  put(box(0.36, 0.42, 0.3), plasticBlk, M(KX, 1.11, -1.6));                            // coffee machine
  put(box(0.2, 0.06, 0.18), steel, M(KX + 0.06, 0.93, -1.6));
  for (const y of [1.5, 1.92]) { put(box(0.3, 0.035, 2.6), woodM, M(X0 + 0.15, y, -0.6));
    for (let k = 0; k < 7; k++) if (rnd() < 0.8) { const jh = 0.1 + rnd() * 0.12; put(cyl(0.045, 0.045, jh), mugM[k % 5], M(X0 + 0.15, y + 0.0175 + jh / 2, -1.7 + k * 0.36)); } }
  for (let k = 0; k < 4; k++) put(cyl(0.04, 0.036, 0.1), mugM[(k + 1) % 5], M(KX + rr(-0.1, 0.1), 0.95, -0.6 + k * 0.3));
  const KITCHEN = new V3(KX + 1.2, 0, 0.3);
  // artwork: a big canvas above the counter, three prints on the brick
  const artTex = (seedArt) => canvasTex(512, 340, (g, w, h) => { seed = seedArt; g.fillStyle = "#efe9df"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) { g.fillStyle = ["#d9643f", "#264653", "#e9c46a", "#2a9d8f", "#f4a261", "#1d3557", "#a8dadc"][i]; g.globalAlpha = 0.85;
      g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 140, 20 + rnd() * 90, rnd() * 3, 0, 7); g.fill(); } g.globalAlpha = 1; });
  const artM = [11, 23, 37, 41].map((s) => std({ map: artTex(s), roughness: 0.85 })); seed = 99;
  put(box(0.04, 1.24, 1.84), metalDark, M(X0 + 0.02, 1.85, 1.9));
  put(new THREE.PlaneGeometry(1.76, 1.16), artM[0], M(X0 + 0.045, 1.85, 1.9, PI / 2), { cast: false });
  for (const [x, i] of [[-15.5, 1], [-5.5, 2], [4.5, 3]]) { put(box(1.3, 0.9, 0.04), metalDark, M(x, 1.75, Z1 - 0.02));
    put(new THREE.PlaneGeometry(1.22, 0.82), artM[i], M(x, 1.75, Z1 - 0.042, PI), { cast: false }); }

  // ---------------------------------------------------------------- ceiling: linear pendants over every bank, ducts, sprinklers
  for (const b of banks) { const zc = (b.z0 + b.z1) / 2;
    for (const o of [-1.6, 1.6]) { const z = zc + o;
      put(box(0.07, 0.05, 2.9), metalDark, M(b.x, H - 0.7, z), { cast: false, group: "ceiling" });
      put(box(0.058, 0.01, 2.86), lightM, M(b.x, H - 0.728, z), { cast: false, group: "ceiling" });
      for (const e of [-1.2, 1.2]) put(cyl(0.003, 0.003, 0.68, 4), metalDark, M(b.x, H - 0.34, z + e), { cast: false, group: "ceiling" }); } }
  for (const dz of [-1.7, 1.7]) {
    put(cyl(0.26, 0.26, X1 - X0 - 0.4, 24), ductM, M(0, H - 0.36, dz, 0, 0, PI / 2), { cast: false, group: "ceiling" });
    for (let x = X0 + 1.5; x < X1; x += 3) { put(box(0.03, 0.12, 0.6), metalDark, M(x, H - 0.06, dz), { cast: false, group: "ceiling" });
      put(cyl(0.28, 0.28, 0.06, 24), ductM, M(x, H - 0.36, dz, 0, 0, PI / 2), { cast: false, group: "ceiling" }); }
  }
  for (let x = X0 + 2; x < X1; x += 4) for (const z of [-0.0, -6, 6]) put(cyl(0.025, 0.012, 0.06, 8), steel, M(x, H - 0.03, z), { cast: false, group: "ceiling" });

  flush();

  // ---------------------------------------------------------------- plants (library props, scaled to height)
  function placePlant(src, p, castS) {
    const o = src.clone(); const bb = new THREE.Box3().setFromObject(src); const s = p.h / Math.max(0.1, bb.max.y - bb.min.y);
    o.scale.setScalar(s); o.position.set(p.x, (p.y || 0) - bb.min.y * s, p.z); o.rotation.y = rr(0, 2 * PI);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = castS; m.receiveShadow = true; } }); scene.add(o);
  }
  for (const p of bigPlants) placePlant(p.b ? plantB : plantA, p, true);
  for (const p of smallPlants) placePlant(plantB, p, false);

  // ---------------------------------------------------------------- light
  const sunDir = new V3(0.38, 0.72, -0.58).normalize();
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x8a8178, 0.55); scene.add(hemi);

  // ---------------------------------------------------------------- people
  const castMap = {}; figIds.forEach((id, i) => { castMap[id] = figs[i]; scene.add(figs[i].object); });
  const crowdFigs = crowdList.map((c, i) => { const f = figs[figIds.length + i]; scene.add(f.object); return { ...c, fig: f }; });
  const footOf = (f, side) => { let b = null; f.object.traverse((o) => { if (!b && o.isBone && new RegExp(side + "Foot$", "i").test(o.name)) b = o; }); return b; };
  // walking speed from the feet: while a foot is planted it moves back at exactly the speed the body must go forward
  function gaitOf(f) {
    const out = {}; const L = footOf(f, "Left"), R = footOf(f, "Right");
    for (const g of ["walk", "run", "jog"]) {
      if (!f.actions[g] || !L) continue;
      const T = f.durations[g], N = 160, ys = [], zs = [];
      f.object.position.set(0, 0, 0); f.object.rotation.set(0, 0, 0);
      for (const foot of [L, R]) { const y = [], z = [];
        for (let i = 0; i <= N; i++) { f.pose((i / N) * T, { [g]: 1 }); f.object.updateMatrixWorld(true); const p = foot.getWorldPosition(new V3()); y.push(p.y); z.push(p.z); }
        ys.push(y); zs.push(z); }
      let sum = 0, cnt = 0;
      for (let k = 0; k < 2; k++) { const y = ys[k], z = zs[k], lo = Math.min(...y);
        for (let i = 0; i < N; i++) if (y[i] < lo + 0.025 && y[i + 1] < lo + 0.025) { sum += -(z[i + 1] - z[i]) / (T / N); cnt++; } }
      out[g] = cnt ? Math.abs(sum / cnt) : { walk: 1.35, run: 3.6, jog: 2.6 }[g];
    }
    f.pose(0, { idle: 1 }); return out;
  }
  const gaitSpeed = {}; for (const id of figIds) gaitSpeed[id] = gaitOf(castMap[id]);
  const spot = new V3(-12, 0, 0.9);

  // ---------------------------------------------------------------- update
  const _f = new V3();
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
    figIds.forEach((id, i) => poseFig(castMap[id], people[id] || {}, time, { x: spot.x + i * 0.9, z: spot.z - i * 0.15, heading: i ? -PI / 2 : 0 }));
    const cr = st.crowd;
    crowdFigs.forEach((c, i) => { const s = cr === false ? { show: false } : (cr && (cr[i] || cr[c.id])) || {};
      poseFig(c.fig, { clip: c.clip, ...s }, time + 0.7 * i + 1.3, c); });
    const camUp = camera.position.y > H - 0.1;
    groups.ceiling.visible = st.ceiling ?? !camUp;
    const lead = castMap[figIds[0]]?.object;
    const f = st.focus ? _f.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : lead ? _f.copy(lead.position) : _f.set(0, 0, 0);
    const R = st.shadowRadius ?? Math.min(40, Math.max(9, camera.position.distanceTo(f) * 1.1));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 260 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sunDir, 120); sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: castMap[figIds[0]]?.object, crowd: crowdFigs, gaitSpeed, spot,
    aisle: { z: 0, x0: -20, x1: 20, halfWidth: 2.4 }, banks, columns: COLS,
    meetingRoom: { ...MR, door: { x: 12.5, z: MR.z0 }, table: TBL.clone() }, kitchen: KITCHEN,
    windows: { north: Z0, east: X1 }, sun, sunDir: sunDir.clone(), H, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1 }, ceilingGroup: groups.ceiling,
  };
}
