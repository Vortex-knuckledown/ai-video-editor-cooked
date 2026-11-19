// World "living-room": a home living room in the evening, dusk light through a big window.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. The room's inside faces: x -3.5..3.5, z -3..3, floor y = 0, ceiling y = 2.7.
//   North wall (z = -3): a wide window (x -1.3..1.3, sill y 0.75, head y 2.35) with curtains, dusk sky and a garden
//                        with neighbours' houses outside. Two framed prints either side.
//   West wall (x = -3.5): exposed brick, two tall bookcases full of books (z -2.35..-0.25 and 0.25..1.3), a plant.
//   East wall (x = 3.5):  a low wooden TV unit (z -0.95..0.95) with a flat TV (screen faces west), a plant in the corner.
//   South wall (z = 3):   a door at x -2.7, a framed print.
//   Middle: a rug (x -1.4..1.8, z -1.3..1.3) on an oak plank floor; a sofa at x -1.27 facing EAST (towards the TV,
//   z -0.9..0.9, seat front at x -0.86); a coffee table at x 0.45; an armchair at (1.6, -1.75) turned to the sofa;
//   a side table with a vase at the sofa's north end; a floor lamp at (-1.55, 1.3) by the sofa's south end.
//   The free walkway is the strip z 1.65..2.4 from the door (x -2.6) to x 2.6.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], clips}) -> world. Per frame: set world.camera (position,
// fov, lookAt), then world.update(state), then world.render(). update() also cuts away whichever walls / ceiling stand
// between the camera and the room, so a camera may be outside the room (a side-on track from z = 5, an aerial view
// from y = 8) and still see in. Wall shadows stay.
//
// state (every field optional):
//   time        seconds of the shot (default clock for the people's animation)
//   people      {<cast id>: {x, z, heading, time, gait: {walk, run, <other clip>: w}, show}}
//               heading radians about +y: 0 faces +z (south), PI/2 faces east (+x), PI faces north (the window),
//               -PI/2 faces west. gait weights 0..1, idle takes the rest. Move a walker by world.gaitSpeed[id].walk * walk
//               metres per second so the feet do not slide. time = animation clock (default state.time). show false hides.
//               A person missing from state.people stands at world.spots.bySofa.
//   lamp        0..1 the floor lamp (default 1)
//   tv          0..1 the TV picture (default 0.85)
//   dusk        0..1 how much warm low sun comes through the window (default 1)
//   cutaway     false keeps every wall and the ceiling drawn (default: cut away what blocks the camera)
//
// Exposes: world.cast.<id> (loadFigure result: object, pose, height), world.person (the first cast member's object),
// world.gaitSpeed.<id> {walk, run} m/s (also world.gaitSpeed.walk / .run for the first), world.spots {bySofa, window,
// door, byTv, walkFrom, walkTo: {x, z, heading}}, world.room {x0:-3.5, x1:3.5, z0:-3, z1:3, h:2.7},
// world.sofa, world.armchair, world.coffeeTable, world.tv (the screen mesh), world.lamp (PointLight),
// world.sun (DirectionalLight), world.windowCentre (Vector3), world.bones.<id> {head, hips, leftFoot, rightFoot}.
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], clips }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const X0 = -3.5, X1 = 3.5, Z0 = -3, Z1 = 3, H = 2.7, WT = 0.18;   // room inside faces, wall thickness

  // ---------------------------------------------------------------- renderer, camera
  const W = canvas.width || 1920, Hh = canvas.height || 1080;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, Hh, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / Hh, 0.03, 600);
  camera.position.set(3.1, 1.7, 2.7); camera.lookAt(-1.2, 0.9, -0.8);

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
  const propIds = ["sofa_02", "ArmChair_01", "modern_coffee_table_01", "side_table_01", "potted_plant_01", "ceramic_vase_01", "book_encyclopedia_set_01"];
  const [sky, BRICK, CONC, SAND, ROCK, ...rest] = await Promise.all([
    hdr("sky/sunset.hdr"), pbrSet("brick"), pbrSet("concrete"), pbrSet("sand"), pbrSet("rock"),
    ...propIds.map((id) => loadProp({ THREE, id })),
    ...cast.map((id) => loadFigure({ THREE, id, clips: clips || ["idle", "walk", "run"] })),
  ]);
  const P = Object.fromEntries(propIds.map((id, i) => [id, rest[i]]));
  const figures = rest.slice(propIds.length);

  // a material from a kit surface, its tiling set for a face of w x h metres (tile = metres per repeat)
  const surf = (set, w, h, tile, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ ...extra });
    for (const k of ["map", "normalMap", "roughnessMap"]) { const t = set[k].clone(); t.repeat.set(w / tile, h / tile); t.needsUpdate = true; m[k] = t; }
    return m;
  };

  // ---------------------------------------------------------------- deterministic random
  let seed = 7302114;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);

  // ---------------------------------------------------------------- sky, light
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, PI * 0.62, 0); scene.environmentRotation.set(0, PI * 0.62, 0);
  scene.backgroundIntensity = 0.7; scene.environmentIntensity = 0.32;
  scene.fog = new THREE.Fog(0x9a90a8, 20, 120);

  const sun = new THREE.DirectionalLight(0xff9a55, 4.2);
  const sunDir = new V3(0.32, 0.2, -1).normalize();
  sun.position.copy(sunDir).multiplyScalar(30); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 5, far: 70 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xa9b6d8, 0x5a4434, 0.55); scene.add(hemi);

  // ---------------------------------------------------------------- canvas textures (things the kit has no photo of)
  const cnv = (w, h, paint) => { const c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  // oak planks: 3.6 m square of boards 0.18 m wide, staggered ends, grain and the odd knot
  const PX = 2048 / 3.6;
  const woodPaint = (g, w, h, { plank = 0.18, base = [30, 48, 46], spread = 6, dark = 0.55, ends = true } = {}) => {
    const pw = plank * PX;
    for (let y = 0; y < h; y += pw) {
      let x = -rr(0, 1.6) * PX;
      while (x < w) {
        const len = ends ? rr(1.0, 2.2) * PX : w * 2, hue = base[0] + rr(-4, 4), sat = base[1] + rr(-8, 6), lit = base[2] + rr(-spread, spread);
        g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`; g.fillRect(x, y, len, pw);
        for (let i = 0; i < 26; i++) {           // grain lines along the board
          const gy = y + rr(0, pw), a = rr(0.05, 0.16), amp = rr(0.5, 3), fr = rr(0.004, 0.02), ph = rr(0, 6);
          g.strokeStyle = `hsla(${hue - 4},${sat + 5}%,${lit * dark}%,${a})`; g.lineWidth = rr(0.6, 2.2); g.beginPath();
          for (let k = 0; k <= len; k += 8) { const yy = gy + Math.sin(k * fr + ph) * amp; k ? g.lineTo(x + k, yy) : g.moveTo(x + k, yy); }
          g.stroke();
        }
        if (rnd() < 0.35) { const kx = x + rr(0.1, 0.9) * len, ky = y + rr(0.25, 0.75) * pw;   // a knot
          for (let r = 7; r > 0; r -= 1.5) { g.strokeStyle = `hsla(${hue - 6},${sat + 8}%,${lit * 0.45}%,0.25)`; g.beginPath(); g.ellipse(kx, ky, r * 2.4, r, 0, 0, 2 * PI); g.stroke(); } }
        g.fillStyle = "rgba(25,14,6,0.55)"; g.fillRect(x, y, 2, pw);   // board end
        x += len;
      }
      g.fillStyle = "rgba(25,14,6,0.6)"; g.fillRect(0, y, w, 2);      // the gap between rows
    }
  };
  const floorTex = cnv(2048, 2048, (g, w, h) => woodPaint(g, w, h));
  const veneerTex = cnv(1024, 1024, (g, w, h) => woodPaint(g, w, h, { plank: 0.5, base: [24, 42, 24], spread: 3, dark: 0.6, ends: false }));
  const rugTex = cnv(1600, 1300, (g, w, h) => {
    g.fillStyle = "#7a2b25"; g.fillRect(0, 0, w, h);
    const band = (m, c, t) => { g.strokeStyle = c; g.lineWidth = t; g.strokeRect(m, m, w - 2 * m, h - 2 * m); };
    band(28, "#1f2a3d", 40); band(78, "#c9a46a", 10); band(112, "#2c3b52", 36); band(150, "#c9a46a", 6);
    g.save(); g.beginPath(); g.rect(170, 170, w - 340, h - 340); g.clip();
    for (let y = 120; y < h; y += 120) for (let x = 120; x < w; x += 120) {   // a lattice of small diamonds
      g.fillStyle = (x / 120 + y / 120) % 2 ? "#a2453a" : "#5e1f1b"; g.beginPath(); g.moveTo(x, y - 46); g.lineTo(x + 46, y); g.lineTo(x, y + 46); g.lineTo(x - 46, y); g.fill();
      g.fillStyle = "#d8be8a"; g.beginPath(); g.arc(x, y, 6, 0, 2 * PI); g.fill(); }
    g.restore();
    g.fillStyle = "#e3cf9f"; g.beginPath(); g.ellipse(w / 2, h / 2, 230, 170, 0, 0, 2 * PI); g.fill();
    g.fillStyle = "#24324a"; g.beginPath(); g.ellipse(w / 2, h / 2, 190, 136, 0, 0, 2 * PI); g.fill();
    g.fillStyle = "#a2453a"; g.beginPath(); g.ellipse(w / 2, h / 2, 90, 64, 0, 0, 2 * PI); g.fill();
    const id = g.getImageData(0, 0, w, h), d = id.data;   // wool: speckle and wear
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(id, 0, 0);
  });
  const screenTex = cnv(1280, 720, (g, w, h) => {   // a paused nature film: mountains at blue hour
    const sk = g.createLinearGradient(0, 0, 0, h); sk.addColorStop(0, "#1d3a6b"); sk.addColorStop(0.55, "#d98a5b"); sk.addColorStop(1, "#2a2230");
    g.fillStyle = sk; g.fillRect(0, 0, w, h);
    for (const [y0, c] of [[0.52, "#3a3d5c"], [0.62, "#2a2b42"], [0.74, "#1a1a28"]]) {
      g.fillStyle = c; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, h * y0 - Math.abs(Math.sin(x * 0.007 + y0 * 9)) * 120 - rnd() * 8);
      g.lineTo(w, h); g.fill(); }
    g.fillStyle = "rgba(255,230,190,0.9)"; g.beginPath(); g.arc(w * 0.7, h * 0.42, 22, 0, 2 * PI); g.fill();
  });
  const artTex = (palette) => cnv(512, 640, (g, w, h) => {   // a framed abstract print
    g.fillStyle = palette[0]; g.fillRect(0, 0, w, h);
    for (let i = 1; i < palette.length; i++) { g.fillStyle = palette[i]; g.globalAlpha = 0.9;
      const x = rr(0, w * 0.5), y = rr(0, h * 0.6); rnd() < 0.5 ? g.fillRect(x, y, rr(120, 300), rr(120, 300)) : (g.beginPath(), g.arc(x + 100, y + 100, rr(50, 140), 0, 2 * PI), g.fill()); }
    g.globalAlpha = 1;
  });

  // ---------------------------------------------------------------- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  // painted plaster: the kit's concrete gives the relief and the sheen, the paint gives the colour
  const plaster = (w, h, color = 0xe9dfcf) => { const m = surf(CONC, w, h, 1.6, { color, roughness: 0.9 }); m.map = null; m.normalScale = new THREE.Vector2(0.35, 0.35); return m; };
  const paintWhite = std({ color: 0xf2efe8, roughness: 0.55 });
  const veneer = std({ map: veneerTex, roughness: 0.55, color: 0xffffff });
  const darkMetal = std({ color: 0x1b1b1d, roughness: 0.4, metalness: 0.8 });
  const brass = std({ color: 0xb8904e, roughness: 0.3, metalness: 1 });
  const GHOST = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  const add = (geo, mat, x, y, z, { cast = true, receive = true, parent = scene } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);

  // ---------------------------------------------------------------- the shell: floor, walls, ceiling, cut away towards the camera
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0),
    std({ map: floorTex, bumpMap: floorTex, bumpScale: 0.6, roughness: 0.42, color: 0xffffff }));
  floorTex.repeat.set((X1 - X0) / 3.6, (Z1 - Z0) / 3.6);
  floor.rotation.x = -PI / 2; floor.receiveShadow = true; scene.add(floor);
  box(X1 - X0 + 2 * WT, 0.3, Z1 - Z0 + 2 * WT, surf(CONC, 8, 7, 3), 0, -0.151, 0);   // the slab under it

  const sides = { north: [], south: [], east: [], west: [], ceiling: [] };   // meshes to cut away, by side
  const decor = { north: [], south: [], east: [], west: [], ceiling: [] };   // things hung on them
  const wall = (side, w, h, d, mat, x, y, z) => { const m = box(w, h, d, mat, x, y, z); m.userData.mat = mat; sides[side].push(m); return m; };
  // north: a window opening x -1.3..1.3, y 0.75..2.35
  const WX = 1.3, WY0 = 0.75, WY1 = 2.35, zN = Z0 - WT / 2;
  wall("north", -WX - (X0 - WT), H, WT, plaster(2.4, H), (X0 - WT - WX) / 2, H / 2, zN);
  wall("north", X1 + WT - WX, H, WT, plaster(3.4, H), (WX + X1 + WT) / 2, H / 2, zN);
  wall("north", 2 * WX, WY0, WT, plaster(2.6, WY0), 0, WY0 / 2, zN);
  wall("north", 2 * WX, H - WY1, WT, plaster(2.6, H - WY1), 0, (H + WY1) / 2, zN);
  wall("south", X1 - X0 + 2 * WT, H, WT, plaster(7.4, H), 0, H / 2, Z1 + WT / 2);
  wall("east", WT, H, Z1 - Z0, plaster(6, H), X1 + WT / 2, H / 2, 0);
  const brickW = surf(BRICK, Z1 - Z0, H, 1.6, { color: 0xd8b8a4 });
  wall("west", WT, H, Z1 - Z0, brickW, X0 - WT / 2, H / 2, 0);
  wall("ceiling", X1 - X0 + 2 * WT, 0.14, Z1 - Z0 + 2 * WT, plaster(7.4, 6.4, 0xf3eee6), 0, H + 0.07, 0);
  sides.ceiling[0].castShadow = false;

  // skirting boards
  const skirt = (side, w, d, x, z) => decor[side].push(box(w, 0.1, d, paintWhite, x, 0.05, z, { cast: false }));
  skirt("north", X1 - X0, 0.018, 0, Z0 + 0.009); skirt("south", X1 - X0, 0.018, 0, Z1 - 0.009);
  skirt("east", 0.018, Z1 - Z0, X1 - 0.009, 0); skirt("west", 0.018, Z1 - Z0, X0 - 0.009, 0);
  // a cornice where wall meets ceiling
  for (const [side, w, d, x, z] of [["north", X1 - X0, 0.05, 0, Z0 + 0.025], ["south", X1 - X0, 0.05, 0, Z1 - 0.025],
    ["east", 0.05, Z1 - Z0, X1 - 0.025, 0], ["west", 0.05, Z1 - Z0, X0 + 0.025, 0]]) decor[side].push(box(w, 0.07, d, paintWhite, x, H - 0.035, z, { cast: false }));

  // ---------------------------------------------------------------- the window: frame, glass, sill, curtains on a rod
  const frameMat = std({ color: 0xece8e0, roughness: 0.5 });
  const wz = Z0 - WT / 2;
  for (const [w, h, x, y] of [[2 * WX + 0.1, 0.07, 0, WY1 - 0.035], [2 * WX + 0.1, 0.07, 0, WY0 + 0.035], [0.07, WY1 - WY0, -WX + 0.035, (WY0 + WY1) / 2],
    [0.07, WY1 - WY0, WX - 0.035, (WY0 + WY1) / 2], [0.05, WY1 - WY0, -WX / 3, (WY0 + WY1) / 2], [0.05, WY1 - WY0, WX / 3, (WY0 + WY1) / 2],
    [2 * WX, 0.045, 0, WY1 - 0.42]]) decor.north.push(box(w, h, 0.09, frameMat, x, y, wz));
  decor.north.push(box(2 * WX + 0.16, 0.04, 0.26, paintWhite, 0, WY0 - 0.02, Z0 + 0.05));        // sill
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.6, depthWrite: false });
  decor.north.push(add(new THREE.PlaneGeometry(2 * WX, WY1 - WY0), glass, 0, (WY0 + WY1) / 2, wz, { cast: false, receive: false }));
  decor.north.push(add(new THREE.CylinderGeometry(0.014, 0.014, 2 * WX + 1.7, 12), brass, 0, 2.52, Z0 + 0.12, { cast: false }));
  decor.north[decor.north.length - 1].rotation.z = PI / 2;
  const linen = surf(SAND, 1, 2.5, 0.6, { color: 0xf2ead8, roughness: 1, side: THREE.DoubleSide });
  linen.map = null; linen.normalScale = new THREE.Vector2(0.25, 0.25);
  for (const cx of [-WX - 0.38, WX + 0.38]) {
    const g = new THREE.PlaneGeometry(0.75, 2.47, 60, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sin((x + 0.4) * 34) * 0.035 * (0.75 + 0.25 * (1 - (y + 1.2) / 2.5))); }
    g.computeVertexNormals();
    decor.north.push(add(g, linen, cx, 2.5 - 2.47 / 2 - 0.01, Z0 + 0.15));
  }

  // ---------------------------------------------------------------- outside: a garden, a fence, the neighbours' houses, trees
  const grassTex = cnv(1024, 1024, (g, w, h) => {   // mown lawn: blades over a mottled green, 4 m square
    g.fillStyle = "#3e5a2b"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = `hsla(${rr(78, 100)},${rr(30, 45)}%,${rr(18, 32)}%,0.25)`; g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(40, 160), 0, 2 * PI); g.fill(); }
    for (let i = 0; i < 26000; i++) { const x = rr(0, w), y = rr(0, h); g.strokeStyle = `hsla(${rr(75, 105)},${rr(35, 55)}%,${rr(16, 40)}%,0.7)`;
      g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-3, 3), y - rr(4, 10)); g.stroke(); }
  });
  grassTex.repeat.set(100, 100);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), std({ map: grassTex, normalMap: ROCK.normalMap.clone(), normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1 }));
  lawn.material.normalMap.repeat.set(130, 130);
  lawn.rotation.x = -PI / 2; lawn.position.y = -0.31; lawn.receiveShadow = true; scene.add(lawn);
  box(X1 - X0 + 2, 0.32, 3, surf(CONC, 9, 3, 1.5, { color: 0xb8b0a4 }), 0, -0.15, Z0 - WT - 1.5);   // patio
  const fenceMat = std({ map: veneerTex, color: 0x8a6a50, roughness: 0.85 });
  for (let x = -14; x <= 14; x += 0.16) box(0.14, 1.8, 0.03, fenceMat, x, -0.31 + 0.9 + Math.sin(x * 3.1) * 0.02, -13.5, { receive: false });
  const winLit = std({ color: 0x2a2018, emissive: 0xffb866, emissiveIntensity: 1.6 });
  const winDark = std({ color: 0x1c2230, roughness: 0.1, metalness: 0.7 });
  const roofMat = surf(ROCK, 12, 6, 2, { color: 0x4c4240 });
  for (const [hx, hz, hw, hh, rot, tone] of [[-14, -44, 9, 6.2, 0.05, 0xb7a08c], [-1, -52, 10, 6.8, -0.04, 0xcfc0ad], [13, -42, 8, 5.8, 0.1, 0x9d8571], [-28, -50, 10, 7, 0.0, 0xc2b29e], [27, -51, 9, 6.5, -0.1, 0xab9a88]]) {
    const hg = new THREE.Group(); hg.position.set(hx, -0.31, hz); hg.rotation.y = rot; scene.add(hg);
    box(hw, hh, 7, surf(BRICK, hw, hh, 2.2, { color: tone }), 0, hh / 2, 0, { parent: hg });
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.6, 3.2, 4, 1), roofMat); roof.rotation.y = PI / 4; roof.scale.set(hw / 6.4, 1, 7 / 6.4);
    roof.position.y = hh + 1.6; roof.castShadow = true; hg.add(roof);
    for (let r = 0; r < 2; r++) for (let c = 0; c < Math.floor(hw / 2.2); c++) {
      const lit = rnd() < 0.45;
      box(1.1, 1.3, 0.05, lit ? winLit : winDark, -hw / 2 + 1.3 + c * 2.2, 1.6 + r * 2.8, 3.52, { parent: hg, cast: false });
    }
  }
  const leaf = surf(ROCK, 4, 4, 2, { color: 0x34472a, roughness: 1 });
  const bark = std({ color: 0x3b2e24, roughness: 1 });
  for (const [tx, tz, s] of [[-7, -10, 1.2], [6.5, -11, 1], [-3, -18, 1.5], [9, -19, 1.3], [-16, -15, 1.4], [17, -14, 1.1], [2, -40, 2]]) {
    add(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 2.6 * s, 8), bark, tx, -0.31 + 1.3 * s, tz);
    for (let k = 0; k < 5; k++) add(new THREE.IcosahedronGeometry(rr(0.9, 1.4) * s, 1), leaf, tx + rr(-0.7, 0.7) * s, -0.31 + (2.8 + rr(0, 1.5)) * s, tz + rr(-0.7, 0.7) * s);
  }
  const lampPost = (x, z) => { add(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 8), darkMetal, x, -0.31 + 1.8, z);
    add(new THREE.SphereGeometry(0.2, 12, 10), std({ color: 0xfff0d0, emissive: 0xffd08a, emissiveIntensity: 3 }), x, -0.31 + 3.7, z, { cast: false }); };
  lampPost(-5, -21); lampPost(7, -22);

  // ---------------------------------------------------------------- furniture from the library, sized in metres
  const place = (obj, x, z, rotY = 0, y = 0) => { obj.position.set(x, y, z); obj.rotation.y = rotY; scene.add(obj); return obj; };
  const sofa = place(P.sofa_02, -1.27, 0, PI / 2);          // front (+z of the model) turned to face east
  sofa.scale.setScalar(1.12);
  const armchair = place(P.ArmChair_01, 1.65, -1.75, -0.75); armchair.scale.setScalar(1.05);
  const coffeeTable = place(P.modern_coffee_table_01, 0.45, 0, 0);
  const sideTable = place(P.side_table_01, -1.3, -1.32, PI / 2);
  place(P.ceramic_vase_01, -1.3, -1.32, 0, 0.55);
  const plantA = place(P.potted_plant_01, -2.95, -2.55, 0.4);
  const plantB = place(P.potted_plant_01.clone(), 2.95, -2.5, 2.2); plantB.scale.setScalar(0.85);
  const plantC = place(P.potted_plant_01.clone(), 2.9, 2.5, 4.0); plantC.scale.setScalar(0.75);

  // rug: wool pile on the plank floor
  const rugMat = std({ map: rugTex, normalMap: SAND.normalMap.clone(), roughness: 1, color: 0xffffff });
  rugMat.normalMap.repeat.set(10, 8); rugMat.normalScale = new THREE.Vector2(0.6, 0.6);
  box(3.2, 0.012, 2.6, rugMat, 0.2, 0.006, 0, { cast: false });

  // things on the coffee table: a stack of books, a tray, a mug
  const bookCols = [0x7b2d26, 0x23395b, 0xc9a227, 0x2f5d50, 0x5b3a6b, 0xd9d2c3, 0x1f1f22, 0x9a6b3c, 0x406a8c, 0xa23b3b, 0x3d4a2e, 0xe0b080];
  const bookMats = bookCols.map((c) => std({ color: c, roughness: 0.75 }));
  let sy = 0.395;
  for (let i = 0; i < 3; i++) { const h = rr(0.025, 0.04), b = box(0.22 - i * 0.02, h, 0.3 - i * 0.03, bookMats[(i * 5) % 12], 0.38, sy + h / 2, -0.25); b.rotation.y = rr(-0.2, 0.2); sy += h; }
  box(0.36, 0.015, 0.24, darkMetal, 0.48, 0.402, 0.27);
  add(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 20), std({ color: 0xe8e4dc, roughness: 0.3 }), 0.45, 0.455, 0.25);

  // ---------------------------------------------------------------- bookcases on the brick wall, full of books
  const bookcase = (zc, w) => {
    const d = 0.34, hgt = 2.15, x = X0 + d / 2, t = 0.025, g = [];
    g.push(box(d, hgt, t, veneer, x, hgt / 2, zc - w / 2 + t / 2), box(d, hgt, t, veneer, x, hgt / 2, zc + w / 2 - t / 2));
    g.push(box(0.012, hgt, w, veneer, X0 + 0.006, hgt / 2, zc));
    const shelves = [0.06, 0.48, 0.88, 1.26, 1.66, 2.15 - t / 2];
    for (const y of shelves) g.push(box(d, t, w - 2 * t, veneer, x, y, zc));
    box(d, 0.06, w - 2 * t, veneer, x, 0.03, zc);
    for (let s = 0; s < shelves.length - 1; s++) {   // books, some leaning, a gap or an ornament now and then
      let z = zc - w / 2 + t + 0.01; const top = shelves[s] + t / 2, room = shelves[s + 1] - shelves[s] - t - 0.03;
      while (z < zc + w / 2 - t - 0.05) {
        if (rnd() < 0.08) { z += rr(0.1, 0.18); continue; }
        if (rnd() < 0.06 && z < zc + w / 2 - 0.25) {   // a horizontal pile
          let y = top; for (let k = 0; k < 4; k++) { const hh = rr(0.025, 0.04); box(rr(0.18, 0.24), hh, rr(0.15, 0.2), bookMats[Math.floor(rnd() * 12)], x + 0.02, y + hh / 2, z + 0.1); y += hh; }
          z += 0.24; continue; }
        const th = rr(0.022, 0.05), bh = Math.min(room, rr(0.2, 0.32)), bd = rr(0.17, 0.24);
        const b = box(bd, bh, th, bookMats[Math.floor(rnd() * 12)], X0 + 0.02 + bd / 2 + rr(0.0, 0.05), top + bh / 2, z + th / 2);
        if (rnd() < 0.05) { b.rotation.x = 0.18; b.position.y -= 0.01; b.position.z += 0.02; }
        z += th + 0.002;
      }
    }
    return g;
  };
  bookcase(-1.3, 1.0); bookcase(-0.3 + 1.0 / 2 + 0.1, 1.0);
  // an encyclopedia set lying on top of the second bookcase
  const enc = place(P.book_encyclopedia_set_01, X0 + 0.08, 0.55, PI / 2, 2.15);

  // ---------------------------------------------------------------- TV unit and TV on the east wall
  const tvx = X1 - 0.23;
  box(0.44, 0.42, 1.9, veneer, tvx, 0.1 + 0.21, 0);
  for (const zz of [-0.88, 0.88]) for (const xx of [tvx - 0.17, tvx + 0.17]) box(0.03, 0.1, 0.03, darkMetal, xx, 0.05, zz);
  for (const zz of [-0.475, 0.475]) box(0.006, 0.36, 0.9, std({ color: 0x3a2516, roughness: 0.6 }), tvx - 0.222, 0.31, zz, { cast: false });   // door lines
  for (const zz of [-0.12, 0.12]) box(0.02, 0.12, 0.012, brass, tvx - 0.23, 0.31, zz, { cast: false });        // handles
  box(0.08, 0.06, 0.9, darkMetal, tvx - 0.1, 0.55, 0);                                                         // soundbar
  box(0.2, 0.012, 0.3, darkMetal, tvx + 0.02, 0.526, 0);                                                       // TV foot
  box(0.04, 0.12, 0.06, darkMetal, tvx + 0.02, 0.59, 0);
  const tvBody = box(0.05, 0.84, 1.46, std({ color: 0x0c0c0e, roughness: 0.35, metalness: 0.4 }), tvx + 0.02, 0.65 + 0.42, 0);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.12, metalness: 0.2, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.9 });
  const tv = add(new THREE.PlaneGeometry(1.4, 0.78), screenMat, tvx - 0.006, 0.65 + 0.42, 0, { cast: false });
  tv.rotation.y = -PI / 2;
  const tvGlow = new THREE.PointLight(0x8fa8ff, 0.8, 4, 2); tvGlow.position.set(tvx - 0.6, 1.05, 0); scene.add(tvGlow);
  place(P.ceramic_vase_01.clone(), tvx, 0.82, 0, 0.52).scale.setScalar(0.7);
  for (let i = 0; i < 4; i++) box(0.17, 0.24 - i * 0.02, 0.035, bookMats[(i * 3 + 1) % 12], tvx, 0.52 + (0.24 - i * 0.02) / 2, -0.7 - i * 0.04);

  // ---------------------------------------------------------------- floor lamp by the sofa, a ceiling light, prints
  const LX = -1.55, LZ = 1.3;
  add(new THREE.CylinderGeometry(0.16, 0.17, 0.025, 32), darkMetal, LX, 0.0125, LZ);
  add(new THREE.CylinderGeometry(0.011, 0.011, 1.45, 10), brass, LX, 0.74, LZ);
  const shadeMat = std({ color: 0xf3e3c4, emissive: 0xffc27a, emissiveIntensity: 0.9, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
  const shade = add(new THREE.CylinderGeometry(0.16, 0.22, 0.3, 40, 1, true), shadeMat, LX, 1.58, LZ, { cast: false, receive: false });
  const bulb = add(new THREE.SphereGeometry(0.04, 12, 10), std({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 4 }), LX, 1.52, LZ, { cast: false, receive: false });
  const lamp = new THREE.PointLight(0xffc483, 9, 0, 2); lamp.position.set(LX, 1.52, LZ);
  lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.002; lamp.shadow.camera.near = 0.08; scene.add(lamp);
  const ceilLight = new THREE.PointLight(0xffe0bb, 5, 0, 2); ceilLight.position.set(0.3, 2.45, 0); scene.add(ceilLight);
  const fixture = add(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 32), std({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 1.2 }), 0.3, H - 0.03, 0, { cast: false });
  decor.ceiling.push(fixture);

  const frameDark = std({ color: 0x1d1a17, roughness: 0.5 });
  const print = (side, x, z, ry, w, h, palette) => {
    const g = new THREE.Group(); g.position.set(x, 1.62, z); g.rotation.y = ry; scene.add(g);
    box(w + 0.06, h + 0.06, 0.03, frameDark, 0, 0, 0, { parent: g, cast: false });
    box(w - 0.02, h - 0.02, 0.005, paintWhite, 0, 0, 0.016, { parent: g, cast: false });
    add(new THREE.PlaneGeometry(w - 0.14, h - 0.14), std({ map: artTex(palette), roughness: 0.8 }), 0, 0, 0.02, { parent: g, cast: false });
    decor[side].push(g);
  };
  print("north", -2.45, Z0 + 0.02, 0, 0.56, 0.72, ["#e9e1d2", "#c4673f", "#2f4a5c", "#d9b25b"]);
  print("north", 2.45, Z0 + 0.02, 0, 0.56, 0.72, ["#ece5d8", "#3d5a4a", "#b84a3a", "#20283a"]);
  print("south", 0.6, Z1 - 0.02, PI, 1.1, 0.75, ["#ded5c4", "#1f3550", "#c98f4e", "#7f2f2a", "#e6c890"]);

  // the door on the south wall
  const doorMat = std({ color: 0xf0ece3, roughness: 0.45 });
  decor.south.push(box(0.92, 2.05, 0.04, doorMat, -2.7, 1.025, Z1 - 0.02));
  for (const [w, h, x, y] of [[0.08, 2.13, -3.2, 1.065], [0.08, 2.13, -2.2, 1.065], [1.08, 0.08, -2.7, 2.09]]) decor.south.push(box(w, h, 0.05, paintWhite, x, y, Z1 - 0.025));
  for (const [y0, y1] of [[0.25, 0.95], [1.15, 1.85]]) decor.south.push(box(0.66, y1 - y0, 0.01, std({ color: 0xe6e1d6, roughness: 0.5 }), -2.7, (y0 + y1) / 2, Z1 - 0.045, { cast: false }));
  decor.south.push(add(new THREE.SphereGeometry(0.03, 12, 10), brass, -2.35, 1.0, Z1 - 0.08, { cast: false }));

  // ---------------------------------------------------------------- the cast
  const castMap = {}, gait = {}, bones = {};
  const findBone = (o, re) => { let b = null; o.traverse((x) => { if (!b && x.isBone && re.test(x.name)) b = x; }); return b; };
  figures.forEach((f, i) => {
    const id = cast[i]; castMap[id] = f; scene.add(f.object);
    f.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    bones[id] = { head: findBone(f.object, /Head$/), hips: findBone(f.object, /Hips$/), leftFoot: findBone(f.object, /LeftFoot$/), rightFoot: findBone(f.object, /RightFoot$/) };
    const speed = (name) => {   // how far the feet carry the body per second, so a shot can move it without sliding
      if (!f.actions[name] || !bones[id].leftFoot) return name === "run" ? 3.2 : 1.35;
      const T = f.durations[name]; let lo = 1e9, hi = -1e9;
      f.object.position.set(0, 0, 0); f.object.rotation.set(0, 0, 0);
      for (let k = 0; k <= 48; k++) { f.pose((k / 48) * T, { [name]: 1 }); f.object.updateMatrixWorld(true);
        const z = bones[id].leftFoot.getWorldPosition(new V3()).z; lo = Math.min(lo, z); hi = Math.max(hi, z); }
      return (2 * (hi - lo)) / T;
    };
    gait[id] = { walk: speed("walk"), run: speed("run") };
    f.pose(0, "idle");
  });
  if (cast.length) { gait.walk = gait[cast[0]].walk; gait.run = gait[cast[0]].run; }

  const spots = {
    bySofa: { x: -0.5, z: 1.25, heading: PI / 2 }, window: { x: 0, z: -2.35, heading: PI }, door: { x: -2.7, z: 2.35, heading: PI / 2 },
    byTv: { x: 2.55, z: 1.45, heading: -PI / 2 }, walkFrom: { x: -2.6, z: 1.95, heading: PI / 2 }, walkTo: { x: 2.4, z: 1.95, heading: PI / 2 },
  };

  // ---------------------------------------------------------------- per frame
  const setSide = (side, hide) => {
    for (const m of sides[side]) m.material = hide ? GHOST : m.userData.mat;
    for (const d of decor[side]) d.visible = !hide;
  };
  function update(state = {}) {
    const time = state.time || 0, people = state.people || {};
    cast.forEach((id, i) => {
      const f = castMap[id], p = people[id] || { ...spots.bySofa, x: spots.bySofa.x + i * 0.8 };
      f.object.visible = p.show !== false;
      f.object.position.set(p.x ?? spots.bySofa.x, 0, p.z ?? spots.bySofa.z);
      f.object.rotation.set(0, p.heading ?? spots.bySofa.heading, 0);
      const g = { ...(p.gait || {}) }; let sum = 0; for (const k in g) sum += g[k] || 0;
      if (f.actions.idle) g.idle = Math.max(0, 1 - sum);
      f.pose(p.time ?? time, g);
    });
    const on = state.lamp ?? 1, tvOn = state.tv ?? 0.85, dusk = state.dusk ?? 1;
    lamp.intensity = 9 * on; shadeMat.emissiveIntensity = 0.9 * on + 0.05; bulb.material.emissiveIntensity = 4 * on;
    screenMat.emissiveIntensity = 0.9 * tvOn; tvGlow.intensity = 0.8 * tvOn;
    sun.intensity = 4.2 * dusk;
    const c = camera.position, cut = state.cutaway !== false;
    setSide("north", cut && c.z < Z0); setSide("south", cut && c.z > Z1);
    setSide("west", cut && c.x < X0); setSide("east", cut && c.x > X1); setSide("ceiling", cut && c.y > H);
  }
  const render = () => renderer.render(scene, camera);
  update({});

  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: figures[0] ? figures[0].object : null, bones, gaitSpeed: gait, spots,
    room: { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H }, sofa, armchair, coffeeTable, sideTable, tv, lamp, sun, sunDir,
    windowCentre: new V3(0, (WY0 + WY1) / 2, Z0), plants: [plantA, plantB, plantC], encyclopedia: enc,
  };
}
