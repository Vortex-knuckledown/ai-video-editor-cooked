// World "kitchen": a modern home kitchen on a bright morning, daylight through a window over the sink.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. The room's inside faces: x -4..4, z -3..3.2, floor y = 0, ceiling y = 2.7.
//   North wall (z = -3): the main run of base units x -4..2.5 (front at z -2.38, worktop y 0.92), white subway-tile
//                        splashback, a window over the sink (x -1.7..0.5, sill y 1.05, head y 2.25) with the garden,
//                        a fence and the neighbours' houses outside. Sink centred at x -0.6, hob at x 1.2 with an
//                        oven below and a steel hood above, a kettle at x -2.3, a coffee machine at x -3.35,
//                        wall cabinets x -4..-1.85 and 1.6..2.5 (y 1.45..2.25). A steel fridge x 2.55..3.43 and a
//                        tall larder cupboard x 3.45..4 in the north-east corner.
//   West wall (x = -4):  two oak floating shelves with plates, bowls and jars, a framed print, a plant on the floor.
//   East wall (x = 4):   a framed print, a radiator.
//   South wall (z = 3.2): a door at x 2.9, a framed print, a tall plant in the corner.
//   Middle: an island x -1.2..1.4 (body z -0.95..-0.05, worktop z -1..0.35, top y 0.92) with a fruit bowl, a
//           chopping board, a vase; three bar stools on its south side (z 0.62); three pendant lights over it
//           (bottoms at y 1.7). Oak plank floor.
//   The free walkway is the strip z 1.3..2.6 from x -3.4 to 3.4 (spots.walkFrom -> walkTo, z 1.85).
//   Between the island and the north counters is a 1.38 m aisle (spots.atIsland: north side, facing the island).
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], clips}) -> world. Per frame: set world.camera (position,
// fov, lookAt), then world.update(state), then world.render(). update() cuts away whichever walls / ceiling stand
// between the camera and the room, so a camera may be outside the room (a side-on track from z = 5.5, an aerial
// view from y = 9) and still see in. Wall shadows stay.
//
// state (every field optional):
//   time        seconds of the shot (default clock for the people's animation)
//   people      {<cast id>: {x, z, heading, time, gait: {walk, run, <other clip>: w}, show}}
//               heading radians about +y: 0 faces +z (south), PI/2 faces east (+x), PI faces north (the window),
//               -PI/2 faces west. gait weights 0..1, idle takes the rest. Move a walker by world.gaitSpeed[id].walk *
//               walk metres per second so the feet do not slide. time = animation clock (default state.time).
//               show false hides. A person missing from state.people stands at world.spots.atIsland.
//   pendants    0..1 the pendant lights over the island (default 1)
//   sun         0..1 how much morning sun comes through the window (default 1)
//   steam       0..1 a wisp of steam from the kettle spout (default 0)
//   cutaway     false keeps every wall and the ceiling drawn (default: cut away what blocks the camera)
//
// Exposes: world.cast.<id> (loadFigure result: object, pose, height), world.person (the first cast member's object),
// world.gaitSpeed.<id> {walk, run} m/s (also .walk / .run for the first), world.spots {atIsland, atSink, atHob,
// byFridge, onStool, walkFrom, walkTo: {x, z, heading}}, world.room {x0:-4, x1:4, z0:-3, z1:3.2, h:2.7},
// world.island {x0, x1, z0, z1, top} , world.islandCentre (Vector3 on the worktop), world.stools [3],
// world.kettle, world.coffeeMachine, world.fridge, world.fruitBowl, world.hob, world.sink (Vector3s / Groups),
// world.pendants [3 PointLight], world.sun (DirectionalLight), world.windowCentre (Vector3),
// world.bones.<id> {head, hips, leftFoot, rightFoot}.
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], clips }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const X0 = -4, X1 = 4, Z0 = -3, Z1 = 3.2, H = 2.7, WT = 0.18;
  const CD = 0.62, CH = 0.92, FZ = Z0 + CD;            // counter depth, worktop height, counter front z

  // ---------------------------------------------------------------- renderer, camera
  const W = canvas.width || 1920, Hh = canvas.height || 1080;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, Hh, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / Hh, 0.03, 600);
  camera.position.set(3.4, 1.7, 2.8); camera.lookAt(-1, 1, -1);

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
  const propIds = ["metal_stool_02", "wooden_bowl_01", "food_apple_01", "modern_ceiling_lamp_01", "wooden_cutting_board",
    "pot_enamel_01", "potted_plant_01", "potted_plant_02", "ceramic_vase_01"];
  const [sky, BRICK, CONC, SAND, ROCK, ...rest] = await Promise.all([
    hdr("sky/day.hdr"), pbrSet("brick"), pbrSet("concrete"), pbrSet("sand"), pbrSet("rock"),
    ...propIds.map((id) => loadProp({ THREE, id })),
    ...cast.map((id) => loadFigure({ THREE, id, clips: clips || ["idle", "walk", "run"] })),
  ]);
  const P = Object.fromEntries(propIds.map((id, i) => [id, rest[i]]));
  const figures = rest.slice(propIds.length);

  const surf = (set, w, h, tile, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ ...extra });
    for (const k of ["map", "normalMap", "roughnessMap"]) { const t = set[k].clone(); t.repeat.set(w / tile, h / tile); t.needsUpdate = true; m[k] = t; }
    return m;
  };

  let seed = 4410293;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);

  // ---------------------------------------------------------------- sky, light
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, PI * 0.3, 0); scene.environmentRotation.set(0, PI * 0.3, 0);
  scene.backgroundIntensity = 0.85; scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0xc6d3df, 25, 140);

  const sun = new THREE.DirectionalLight(0xfff0d8, 5.0);
  const sunDir = new V3(0.42, 0.55, -1).normalize();   // towards the sun: low in the north-east, in through the window
  sun.position.copy(sunDir).multiplyScalar(30); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 5, far: 70 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xdfe8f4, 0x8a7560, 0.9); scene.add(hemi);
  // soft daylight bounce from the window side, no shadow: the room reads bright like a morning kitchen
  const bounce = new THREE.DirectionalLight(0xeaf0ff, 0.7); bounce.position.set(-0.6, 3, -6); scene.add(bounce);
  const fill = new THREE.PointLight(0xfff4e6, 4, 0, 2); fill.position.set(0, 2.1, 1.6); scene.add(fill);

  // ---------------------------------------------------------------- canvas textures
  const cnv = (w, h, paint) => { const c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const PX = 2048 / 3.6;
  const woodPaint = (g, w, h, { plank = 0.2, base = [34, 40, 62], spread = 5, dark = 0.7, ends = true } = {}) => {
    const pw = plank * PX;
    for (let y = 0; y < h; y += pw) {
      let x = -rr(0, 1.6) * PX;
      while (x < w) {
        const len = ends ? rr(1.0, 2.2) * PX : w * 2, hue = base[0] + rr(-3, 3), sat = base[1] + rr(-6, 5), lit = base[2] + rr(-spread, spread);
        g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`; g.fillRect(x, y, len, pw);
        for (let i = 0; i < 24; i++) {
          const gy = y + rr(0, pw), a = rr(0.04, 0.13), amp = rr(0.5, 3), fr = rr(0.004, 0.02), ph = rr(0, 6);
          g.strokeStyle = `hsla(${hue - 4},${sat + 5}%,${lit * dark}%,${a})`; g.lineWidth = rr(0.6, 2.2); g.beginPath();
          for (let k = 0; k <= len; k += 8) { const yy = gy + Math.sin(k * fr + ph) * amp; k ? g.lineTo(x + k, yy) : g.moveTo(x + k, yy); }
          g.stroke();
        }
        if (rnd() < 0.25) { const kx = x + rr(0.1, 0.9) * len, ky = y + rr(0.25, 0.75) * pw;
          for (let r = 6; r > 0; r -= 1.5) { g.strokeStyle = `hsla(${hue - 6},${sat + 8}%,${lit * 0.55}%,0.22)`; g.beginPath(); g.ellipse(kx, ky, r * 2.4, r, 0, 0, 2 * PI); g.stroke(); } }
        g.fillStyle = "rgba(60,40,20,0.45)"; g.fillRect(x, y, 2, pw);
        x += len;
      }
      g.fillStyle = "rgba(60,40,20,0.5)"; g.fillRect(0, y, w, 2);
    }
  };
  const floorTex = cnv(2048, 2048, (g, w, h) => woodPaint(g, w, h));
  const oakTex = cnv(1024, 1024, (g, w, h) => woodPaint(g, w, h, { plank: 0.5, base: [32, 42, 50], spread: 3, ends: false }));
  // subway tiles 0.15 x 0.075 m, a 1.2 m square
  const tileTex = cnv(1024, 1024, (g, w, h) => {
    g.fillStyle = "#b9b6ae"; g.fillRect(0, 0, w, h);
    const tw = w / 8, th = h / 16;
    for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) {
      const x = c * tw + (r % 2 ? tw / 2 : 0), y = r * th, l = rr(91, 96);
      const gr = g.createLinearGradient(x, y, x, y + th); gr.addColorStop(0, `hsl(40,12%,${l + 2}%)`); gr.addColorStop(1, `hsl(40,10%,${l - 3}%)`);
      g.fillStyle = gr; g.fillRect(x + 3, y + 3, tw - 6, th - 6);
    }
  });
  const tileBump = cnv(1024, 1024, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h); const tw = w / 8, th = h / 16;
    for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) { const x = c * tw + (r % 2 ? tw / 2 : 0), y = r * th; g.fillStyle = "#fff"; g.fillRect(x + 4, y + 4, tw - 8, th - 8); }
  });
  tileBump.colorSpace = THREE.NoColorSpace;
  // quartz worktop: warm white with fine grey fleck and soft veins
  const quartzTex = cnv(1024, 1024, (g, w, h) => {
    g.fillStyle = "#ecebe6"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rr(90, 160)},${rr(90, 160)},${rr(90, 160)},${rr(0.08, 0.3)})`; g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(1, 3)); }
    for (let v = 0; v < 6; v++) { g.strokeStyle = `rgba(150,150,150,${rr(0.06, 0.14)})`; g.lineWidth = rr(1, 4); g.beginPath();
      let x = rr(0, w), y = 0; g.moveTo(x, y); while (y < h) { x += rr(-30, 30); y += rr(20, 60); g.lineTo(x, y); } g.stroke(); }
  });
  const hobTex = cnv(512, 512, (g, w, h) => {
    g.fillStyle = "#0b0b0c"; g.fillRect(0, 0, w, h);
    for (const [cx, cy, r] of [[140, 140, 90], [372, 140, 70], [140, 372, 70], [372, 372, 95]]) {
      g.strokeStyle = "rgba(200,200,200,0.55)"; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, 2 * PI); g.stroke();
      g.strokeStyle = "rgba(200,200,200,0.25)"; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r * 0.55, 0, 2 * PI); g.stroke();
    }
    g.fillStyle = "rgba(220,220,220,0.6)"; for (let i = 0; i < 4; i++) g.fillRect(200 + i * 30, 480, 14, 14);
  });
  const artTex = (palette) => cnv(512, 640, (g, w, h) => {
    g.fillStyle = palette[0]; g.fillRect(0, 0, w, h);
    for (let i = 1; i < palette.length; i++) { g.fillStyle = palette[i]; g.globalAlpha = 0.9;
      const x = rr(0, w * 0.5), y = rr(0, h * 0.6); rnd() < 0.5 ? g.fillRect(x, y, rr(120, 300), rr(120, 300)) : (g.beginPath(), g.arc(x + 100, y + 100, rr(50, 140), 0, 2 * PI), g.fill()); }
    g.globalAlpha = 1;
  });

  // ---------------------------------------------------------------- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const plaster = (w, h, color = 0xefebe3) => { const m = surf(CONC, w, h, 1.6, { color, roughness: 0.9 }); m.map = null; m.normalScale = new THREE.Vector2(0.3, 0.3); return m; };
  const paintWhite = std({ color: 0xf4f2ec, roughness: 0.55 });
  const cabinet = std({ color: 0x55695c, roughness: 0.6 });                // matte sage-green fronts
  const cabinetIn = std({ color: 0x4a5c50, roughness: 0.7 });
  const oak = std({ map: oakTex, roughness: 0.5, color: 0xffffff });
  const quartz = (w, d) => { const m = std({ map: quartzTex.clone(), roughness: 0.18, color: 0xffffff }); m.map.repeat.set(w / 1.4, d / 1.4); m.map.needsUpdate = true; return m; };
  const steel = surf(CONC, 1, 1, 0.5, { color: 0xc9ccd0, roughness: 0.32, metalness: 0.9 }); steel.map = null; steel.normalScale = new THREE.Vector2(0.06, 0.06);
  const darkMetal = std({ color: 0x1b1b1d, roughness: 0.4, metalness: 0.8 });
  const brass = std({ color: 0xb8904e, roughness: 0.3, metalness: 1 });
  const blackGlass = std({ color: 0x050506, roughness: 0.08, metalness: 0.3 });
  const ceramic = std({ color: 0xf3f1ec, roughness: 0.25 });
  const GHOST = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  const add = (geo, mat, x, y, z, { cast = true, receive = true, parent = scene } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
  const cyl = (rt, rb, h, mat, x, y, z, o, seg = 24) => add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, o);

  // a library prop wrapped in a group, scaled uniformly so its size along `axis` is `size`, standing on y = 0, centred
  const fit = (obj, size, axis = "y") => {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new V3());
    const k = size / (axis === "w" ? Math.max(s.x, s.z) : s[axis]);
    obj.scale.multiplyScalar(k); obj.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(obj), c = b2.getCenter(new V3());
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y; obj.updateMatrixWorld(true);
    const g = new THREE.Group(); g.add(obj); g.userData.size = b2.getSize(new V3()); return g;
  };
  const place = (obj, x, y, z, rotY = 0) => { obj.position.set(x, y, z); obj.rotation.y = rotY; scene.add(obj); return obj; };

  // ---------------------------------------------------------------- the shell
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0),
    std({ map: floorTex, bumpMap: floorTex, bumpScale: 0.5, roughness: 0.38, color: 0xe2d8ca }));
  floorTex.repeat.set((X1 - X0) / 3.6, (Z1 - Z0) / 3.6);
  floor.rotation.x = -PI / 2; floor.position.set(0, 0, (Z0 + Z1) / 2); floor.receiveShadow = true; scene.add(floor);
  box(X1 - X0 + 2 * WT, 0.3, Z1 - Z0 + 2 * WT, surf(CONC, 9, 7, 3), 0, -0.151, (Z0 + Z1) / 2);

  const sides = { north: [], south: [], east: [], west: [], ceiling: [] };
  const decor = { north: [], south: [], east: [], west: [], ceiling: [] };
  const wall = (side, w, h, d, mat, x, y, z) => { const m = box(w, h, d, mat, x, y, z); m.userData.mat = mat; sides[side].push(m); return m; };
  const WX0 = -1.7, WX1 = 0.5, WY0 = 1.05, WY1 = 2.25, zN = Z0 - WT / 2, ZC = (Z0 + Z1) / 2, DEPTH = Z1 - Z0;
  wall("north", WX0 - (X0 - WT), H, WT, plaster(2.5, H), (X0 - WT + WX0) / 2, H / 2, zN);
  wall("north", X1 + WT - WX1, H, WT, plaster(3.7, H), (WX1 + X1 + WT) / 2, H / 2, zN);
  wall("north", WX1 - WX0, WY0, WT, plaster(2.2, WY0), (WX0 + WX1) / 2, WY0 / 2, zN);
  wall("north", WX1 - WX0, H - WY1, WT, plaster(2.2, H - WY1), (WX0 + WX1) / 2, (H + WY1) / 2, zN);
  wall("south", X1 - X0 + 2 * WT, H, WT, plaster(8.4, H), 0, H / 2, Z1 + WT / 2);
  wall("east", WT, H, DEPTH, plaster(DEPTH, H), X1 + WT / 2, H / 2, ZC);
  wall("west", WT, H, DEPTH, surf(BRICK, DEPTH, H, 1.6, { color: 0xe6d6cc }), X0 - WT / 2, H / 2, ZC);
  wall("ceiling", X1 - X0 + 2 * WT, 0.14, DEPTH + 2 * WT, plaster(8.4, 6.6, 0xf6f3ee), 0, H + 0.07, ZC);
  sides.ceiling[0].castShadow = false;
  // recessed downlights in the ceiling
  const downMat = std({ color: 0xffffff, emissive: 0xfff3e0, emissiveIntensity: 1.4 });
  for (const [x, z] of [[-2.8, -1.6], [-0.6, -1.9], [1.8, -1.9], [-2.8, 1.6], [0, 2.1], [2.8, 1.6], [3.2, -1.2]]) {
    const d = add(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 20), downMat, x, H - 0.004, z, { cast: false }); decor.ceiling.push(d);
  }
  // skirting and cornice
  const skirt = (side, w, d, x, z) => decor[side].push(box(w, 0.1, d, paintWhite, x, 0.05, z, { cast: false }));
  skirt("south", X1 - X0, 0.018, 0, Z1 - 0.009); skirt("east", 0.018, DEPTH, X1 - 0.009, ZC); skirt("west", 0.018, DEPTH, X0 + 0.009, ZC);
  for (const [side, w, d, x, z] of [["north", X1 - X0, 0.05, 0, Z0 + 0.025], ["south", X1 - X0, 0.05, 0, Z1 - 0.025],
    ["east", 0.05, DEPTH, X1 - 0.025, ZC], ["west", 0.05, DEPTH, X0 + 0.025, ZC]]) decor[side].push(box(w, 0.06, d, paintWhite, x, H - 0.03, z, { cast: false }));

  // ---------------------------------------------------------------- the window over the sink
  const frameMat = std({ color: 0x2b2d2f, roughness: 0.45, metalness: 0.5 });   // slim dark crittall-style frame
  const WXc = (WX0 + WX1) / 2, WW = WX1 - WX0;
  for (const [w, h, x, y] of [[WW + 0.06, 0.05, WXc, WY1 - 0.025], [WW + 0.06, 0.05, WXc, WY0 + 0.025], [0.05, WY1 - WY0, WX0 + 0.025, (WY0 + WY1) / 2],
    [0.05, WY1 - WY0, WX1 - 0.025, (WY0 + WY1) / 2], [0.035, WY1 - WY0, WXc, (WY0 + WY1) / 2], [0.025, WY1 - WY0, WX0 + WW / 4, (WY0 + WY1) / 2],
    [0.025, WY1 - WY0, WX1 - WW / 4, (WY0 + WY1) / 2], [WW, 0.025, WXc, WY0 + (WY1 - WY0) * 0.55]]) decor.north.push(box(w, h, 0.05, frameMat, x, y, zN));
  decor.north.push(box(WW + 0.1, 0.03, 0.2, quartz(2.3, 0.2), WXc, WY0 - 0.015, Z0 + 0.06));   // sill
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xe6eef4, roughness: 0.03, transparent: true, opacity: 0.08, envMapIntensity: 1.5, depthWrite: false });
  decor.north.push(add(new THREE.PlaneGeometry(WW, WY1 - WY0), glass, WXc, (WY0 + WY1) / 2, zN, { cast: false, receive: false }));
  // linen roman blind, pulled up at the top of the window
  const linen = surf(SAND, 1, 1, 0.5, { color: 0xf0e9dc, roughness: 1 }); linen.map = null; linen.normalScale = new THREE.Vector2(0.2, 0.2);
  for (let i = 0; i < 3; i++) decor.north.push(box(WW - 0.08, 0.06, 0.05 + i * 0.012, linen, WXc, WY1 - 0.06 - i * 0.055, Z0 + 0.05, { cast: true }));

  // ---------------------------------------------------------------- outside: patio, lawn, fence, trees, houses
  const grassTex = cnv(1024, 1024, (g, w, h) => {
    g.fillStyle = "#4b6b30"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = `hsla(${rr(78, 100)},${rr(30, 45)}%,${rr(22, 36)}%,0.25)`; g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(40, 160), 0, 2 * PI); g.fill(); }
    for (let i = 0; i < 26000; i++) { const x = rr(0, w), y = rr(0, h); g.strokeStyle = `hsla(${rr(75, 105)},${rr(35, 55)}%,${rr(20, 44)}%,0.7)`;
      g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-3, 3), y - rr(4, 10)); g.stroke(); }
  });
  grassTex.repeat.set(100, 100);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), std({ map: grassTex, normalMap: ROCK.normalMap.clone(), normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1 }));
  lawn.material.normalMap.repeat.set(130, 130);
  lawn.rotation.x = -PI / 2; lawn.position.y = -0.31; lawn.receiveShadow = true; scene.add(lawn);
  box(X1 - X0 + 2, 0.32, 3.2, surf(CONC, 10, 3.2, 1.5, { color: 0xc2bbb0 }), 0, -0.15, Z0 - WT - 1.6);
  const fenceMat = std({ map: oakTex, color: 0x9a7a5c, roughness: 0.85 });
  for (let x = -16; x <= 16; x += 0.16) box(0.14, 1.8, 0.03, fenceMat, x, -0.31 + 0.9 + Math.sin(x * 3.1) * 0.02, -14, { receive: false });
  const winDark = std({ color: 0x24303e, roughness: 0.1, metalness: 0.7 });
  const winFrame = std({ color: 0xeeeae2, roughness: 0.6 });
  const roofMat = surf(ROCK, 12, 6, 2, { color: 0x50464a });
  for (const [hx, hz, hw, hh, rot, tone] of [[-14, -40, 9, 6.2, 0.05, 0xb7a08c], [-1, -46, 10, 6.8, -0.04, 0xcfc0ad], [13, -39, 8, 5.8, 0.1, 0x9d8571], [-27, -47, 10, 7, 0.0, 0xc2b29e], [26, -47, 9, 6.5, -0.1, 0xab9a88]]) {
    const hg = new THREE.Group(); hg.position.set(hx, -0.31, hz); hg.rotation.y = rot; scene.add(hg);
    box(hw, hh, 7, surf(BRICK, hw, hh, 2.2, { color: tone }), 0, hh / 2, 0, { parent: hg });
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.6, 3.2, 4, 1), roofMat); roof.rotation.y = PI / 4; roof.scale.set(hw / 6.4, 1, 7 / 6.4);
    roof.position.y = hh + 1.6; roof.castShadow = true; hg.add(roof);
    for (let r = 0; r < 2; r++) for (let c = 0; c < Math.floor(hw / 2.2); c++) {
      box(1.2, 1.4, 0.05, winFrame, -hw / 2 + 1.3 + c * 2.2, 1.6 + r * 2.8, 3.51, { parent: hg, cast: false });
      box(1.05, 1.25, 0.05, winDark, -hw / 2 + 1.3 + c * 2.2, 1.6 + r * 2.8, 3.53, { parent: hg, cast: false });
    }
  }
  const leafA = surf(ROCK, 4, 4, 2, { color: 0x4a6a35, roughness: 1 }), leafB = surf(ROCK, 4, 4, 2, { color: 0x3a5a2c, roughness: 1 });
  const bark = std({ color: 0x4a3b2e, roughness: 1 });
  for (const [tx, tz, s] of [[-6.5, -9, 1.1], [5.5, -10, 1], [-2.5, -17, 1.5], [9, -18, 1.3], [-15, -15, 1.4], [16, -13, 1.1], [2, -32, 2]]) {
    add(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 2.6 * s, 8), bark, tx, -0.31 + 1.3 * s, tz);
    for (let k = 0; k < 6; k++) add(new THREE.IcosahedronGeometry(rr(0.9, 1.4) * s, 1), k % 2 ? leafA : leafB, tx + rr(-0.8, 0.8) * s, -0.31 + (2.8 + rr(0, 1.5)) * s, tz + rr(-0.8, 0.8) * s);
  }
  // a few shrubs along the patio edge
  for (let x = -4.5; x <= 4.5; x += 1.5) add(new THREE.IcosahedronGeometry(rr(0.4, 0.6), 1), leafB, x + rr(-0.3, 0.3), -0.1, Z0 - WT - 3.6);

  // ---------------------------------------------------------------- base units along the north wall
  const handleBar = (x, y, z, len, vertical = false) => {
    const h = box(vertical ? 0.014 : len, vertical ? len : 0.014, 0.014, darkMetal, x, y, z, { cast: false });
    return h;
  };
  const CX0 = X0, CX1 = 2.5;
  box(CX1 - CX0, 0.1, CD - 0.08, std({ color: 0x2a2c2b, roughness: 0.7 }), (CX0 + CX1) / 2, 0.05, Z0 + (CD - 0.08) / 2);   // plinth, set back
  box(CX1 - CX0, CH - 0.04 - 0.1, CD - 0.03, cabinetIn, (CX0 + CX1) / 2, 0.1 + (CH - 0.14) / 2, Z0 + (CD - 0.03) / 2);     // carcass
  // fronts: [x0, x1, kind]
  const SINKX = -0.6, HOBX = 1.2;
  const fronts = [[X0, -3.4, "drawers"], [-3.4, -2.8, "door"], [-2.8, -2.2, "door"], [-2.2, -1.6, "drawers"], [-1.6, -1.0, "door"],
    [-1.0, -0.2, "sink"], [-0.2, 0.4, "door"], [0.4, 0.9, "drawers"], [0.9, 1.5, "oven"], [1.5, 2.5, "drawers"]];
  const fz = FZ - 0.01, fy0 = 0.11, fy1 = CH - 0.045;
  for (const [a, b, kind] of fronts) {
    const w = b - a - 0.004, xc = (a + b) / 2;
    if (kind === "door") { box(w, fy1 - fy0, 0.02, cabinet, xc, (fy0 + fy1) / 2, fz); handleBar(xc + w / 2 - 0.05, fy1 - 0.17, fz + 0.022, 0.2, true); }
    if (kind === "sink") { for (const s of [-1, 1]) { box(w / 2 - 0.002, fy1 - fy0, 0.02, cabinet, xc + s * w / 4, (fy0 + fy1) / 2, fz); handleBar(xc + s * 0.05, fy1 - 0.17, fz + 0.022, 0.2, true); } }
    if (kind === "drawers") { const hs = [0.36, 0.24, 0.17]; let y = fy0;
      for (const h of hs) { box(w, h - 0.004, 0.02, cabinet, xc, y + h / 2, fz); handleBar(xc, y + h - 0.05, fz + 0.022, Math.min(0.32, w * 0.6)); y += h; } }
    if (kind === "oven") {
      box(w, fy1 - fy0, 0.02, darkMetal, xc, (fy0 + fy1) / 2, fz);
      box(w - 0.06, 0.42, 0.005, blackGlass, xc, 0.42, fz + 0.012, { cast: false });
      box(w - 0.08, 0.1, 0.005, steel, xc, 0.74, fz + 0.012, { cast: false });
      cyl(0.012, 0.012, w - 0.12, steel, xc, 0.68, fz + 0.05, { cast: false }).rotation.z = PI / 2;
      for (let i = 0; i < 4; i++) { const k = cyl(0.018, 0.018, 0.02, steel, xc - 0.18 + i * 0.12, 0.79, fz + 0.02, { cast: false }); k.rotation.x = PI / 2; }
    }
  }
  // worktop with a hole for the sink
  const SW = 0.74, SD = 0.44, SZ = Z0 + 0.33, TT = 0.04, TY = CH - TT / 2;
  const qt = quartz(6.5, 0.65);
  box(SINKX - SW / 2 - CX0, TT, CD + 0.02, qt, (CX0 + SINKX - SW / 2) / 2, TY, Z0 + (CD + 0.02) / 2);
  box(CX1 - (SINKX + SW / 2), TT, CD + 0.02, qt, (CX1 + SINKX + SW / 2) / 2, TY, Z0 + (CD + 0.02) / 2);
  box(SW, TT, SZ - SD / 2 - Z0, qt, SINKX, TY, (Z0 + SZ - SD / 2) / 2);
  box(SW, TT, FZ + 0.02 - (SZ + SD / 2), qt, SINKX, TY, (FZ + 0.02 + SZ + SD / 2) / 2);
  // the sink basin: steel walls and bottom
  const sb = 0.2;
  box(SW - 0.02, 0.01, SD - 0.02, steel, SINKX, CH - sb, SZ, { cast: false });
  for (const s of [-1, 1]) { box(0.01, sb, SD, steel, SINKX + s * (SW / 2 - 0.005), CH - sb / 2, SZ, { cast: false }); box(SW, sb, 0.01, steel, SINKX, CH - sb / 2, SZ + s * (SD / 2 - 0.005), { cast: false }); }
  cyl(0.025, 0.025, 0.004, darkMetal, SINKX, CH - sb + 0.007, SZ, { cast: false }, 16);
  // gooseneck tap
  const tapX = SINKX, tapZ = Z0 + 0.07;
  cyl(0.028, 0.032, 0.05, steel, tapX, CH + 0.025, tapZ);
  cyl(0.014, 0.014, 0.3, steel, tapX, CH + 0.2, tapZ);
  const neck = add(new THREE.TorusGeometry(0.1, 0.014, 10, 24, PI), steel, tapX, CH + 0.35, tapZ + 0.1);
  neck.rotation.y = PI / 2;
  cyl(0.014, 0.012, 0.06, steel, tapX, CH + 0.32, tapZ + 0.2);
  const lever = cyl(0.008, 0.008, 0.09, steel, tapX + 0.04, CH + 0.12, tapZ, {}, 10); lever.rotation.z = PI / 2.6;
  const sinkPos = new V3(SINKX, CH, SZ);

  // hob: black glass, flush in the worktop
  const hob = add(new THREE.PlaneGeometry(0.6, 0.52), std({ map: hobTex, roughness: 0.08, metalness: 0.2, color: 0xffffff }), HOBX, CH + 0.002, Z0 + 0.32, { cast: false });
  hob.rotation.x = -PI / 2;
  const pot = place(fit(P.pot_enamel_01, 0.26, "w"), HOBX + 0.15, CH + 0.003, Z0 + 0.42, 0.4);

  // splashback tiles along the whole run up to the wall cabinets (under the window: up to the sill)
  const tileMat = (w, h) => { const m = std({ map: tileTex.clone(), bumpMap: tileBump.clone(), bumpScale: 1.2, roughness: 0.2, color: 0xffffff });
    for (const t of [m.map, m.bumpMap]) { t.repeat.set(w / 1.2, h / 1.2); t.needsUpdate = true; } return m; };
  const spl = (x0, x1, y0, y1) => decor.north.push(box(x1 - x0, y1 - y0, 0.01, tileMat(x1 - x0, y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2, Z0 + 0.005, { cast: false }));
  spl(X0, WX0, CH, 1.45); spl(WX0, WX1, CH, WY0 - 0.03); spl(WX1, 0.9, CH, 1.45); spl(1.5, CX1, CH, 1.45);
  spl(0.9, 1.5, CH, 2.0);  // behind the hob, up to the hood

  // cooker hood: steel canopy and chimney
  const hood = new THREE.Group(); hood.position.set(HOBX, 0, Z0); scene.add(hood);
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.42, 0.18, 4, 1), steel); canopy.rotation.y = PI / 4; canopy.scale.set(1.0, 1, 0.68);
  canopy.position.set(0, 1.62 + 0.09, 0.25); canopy.castShadow = true; hood.add(canopy);
  box(0.6, 0.04, 0.5, steel, 0, 1.6, 0.25, { parent: hood });
  box(0.26, H - 1.8, 0.24, steel, 0, 1.8 + (H - 1.8) / 2, 0.12, { parent: hood });
  decor.north.push(hood);

  // wall cabinets
  const wallCab = (x0, x1) => {
    const y0 = 1.45, y1 = 2.25, d = 0.35, xc = (x0 + x1) / 2;
    const g = [box(x1 - x0, y1 - y0, d - 0.02, cabinetIn, xc, (y0 + y1) / 2, Z0 + (d - 0.02) / 2)];
    const n = Math.max(1, Math.round((x1 - x0) / 0.55)), dw = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const cx = x0 + dw * (i + 0.5);
      g.push(box(dw - 0.004, y1 - y0 - 0.004, 0.02, cabinet, cx, (y0 + y1) / 2, Z0 + d - 0.01));
      g.push(handleBar(cx + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), y0 + 0.14, Z0 + d + 0.012, 0.18, true));
    }
    // a light strip under the cabinet, falling on the worktop
    const strip = box(x1 - x0 - 0.1, 0.01, 0.03, std({ color: 0xffffff, emissive: 0xfff1d8, emissiveIntensity: 2 }), xc, y0 - 0.006, Z0 + d - 0.06, { cast: false });
    g.push(strip);
    decor.north.push(...g);
  };
  wallCab(X0, -1.85); wallCab(1.6, CX1);
  const underL = new THREE.PointLight(0xfff0d8, 1.2, 2.5, 2); underL.position.set(-2.9, 1.38, Z0 + 0.25); scene.add(underL);

  // ---------------------------------------------------------------- fridge and larder in the north-east corner
  const fridge = new THREE.Group(); fridge.position.set(3.0, 0, Z0); scene.add(fridge);
  const FW = 0.86, FD = 0.7, FH = 1.95;
  box(FW, FH, FD - 0.03, std({ color: 0x8c9096, roughness: 0.4, metalness: 0.7 }), 0, FH / 2, (FD - 0.03) / 2, { parent: fridge });
  box(FW / 2 - 0.004, FH - 0.03, 0.04, steel, -FW / 4, FH / 2, FD - 0.01, { parent: fridge });          // two tall doors
  box(FW / 2 - 0.004, FH - 0.03, 0.04, steel, FW / 4, FH / 2, FD - 0.01, { parent: fridge });
  for (const s of [-1, 1]) box(0.02, 0.9, 0.03, darkMetal, s * 0.03, 1.15, FD + 0.03, { parent: fridge });
  box(0.16, 0.24, 0.006, std({ color: 0x15171a, roughness: 0.2 }), -FW / 4, 1.35, FD + 0.012, { parent: fridge, cast: false });   // water dispenser
  // a couple of magnets and a note
  box(0.1, 0.13, 0.003, std({ color: 0xfaf3d8, roughness: 0.9 }), -0.28, 1.55, FD + 0.012, { parent: fridge, cast: false });
  cyl(0.015, 0.015, 0.008, std({ color: 0xc23a2e }), -0.28, 1.6, FD + 0.016, { parent: fridge, cast: false }, 12).rotation.x = PI / 2;
  box(FW + 0.04, 0.25, FD, cabinet, 0, H - 0.125 - 0.45, FD / 2, { parent: fridge });                    // cupboard over the fridge
  box(FW + 0.04, 0.45, FD, cabinetIn, 0, H - 0.225, FD / 2, { parent: fridge, cast: false });
  box(0.04, H, FD, cabinet, -FW / 2 - 0.02, H / 2, FD / 2, { parent: fridge });                           // side panel
  const larder = new THREE.Group(); larder.position.set(3.73, 0, Z0); scene.add(larder);
  box(0.54, H - 0.05, FD - 0.03, cabinetIn, 0, (H - 0.05) / 2, (FD - 0.03) / 2, { parent: larder });
  box(0.534, H - 0.16, 0.02, cabinet, 0, 0.11 + (H - 0.16) / 2, FD - 0.01, { parent: larder });
  larder.add(handleBar(-0.22, 1.1, FD + 0.012, 0.5, true));
  box(0.54, 0.1, FD - 0.08, std({ color: 0x2a2c2b }), 0, 0.05, (FD - 0.08) / 2, { parent: larder });

  // ---------------------------------------------------------------- on the counters: kettle, coffee machine, jars, board
  // kettle: a matte white body turned on a lathe, steel lid, handle, spout, on its base
  const kettle = new THREE.Group(); kettle.position.set(-2.3, CH, Z0 + 0.3); kettle.rotation.y = -0.5; scene.add(kettle);
  cyl(0.085, 0.09, 0.02, darkMetal, 0, 0.01, 0, { parent: kettle }, 32);
  const kp = [[0, 0], [0.078, 0], [0.085, 0.02], [0.086, 0.12], [0.075, 0.2], [0.055, 0.235], [0, 0.24]].map(([x, y]) => new THREE.Vector2(x, y));
  add(new THREE.LatheGeometry(kp, 40), std({ color: 0xf2efe8, roughness: 0.35 }), 0, 0.02, 0, { parent: kettle });
  cyl(0.05, 0.055, 0.015, steel, 0, 0.26, 0, { parent: kettle }, 24);
  const kh = add(new THREE.TorusGeometry(0.07, 0.013, 10, 24, PI * 1.1), darkMetal, -0.09, 0.15, 0, { parent: kettle }); kh.rotation.z = PI / 2 - 0.05;
  const sp = add(new THREE.CylinderGeometry(0.012, 0.024, 0.08, 12), std({ color: 0xf2efe8, roughness: 0.35 }), 0.1, 0.2, 0, { parent: kettle }); sp.rotation.z = -1.0;
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const steam = []; for (let i = 0; i < 6; i++) { const s = add(new THREE.SphereGeometry(0.03 + i * 0.01, 10, 8), steamMat.clone(), 0.13, 0.25 + i * 0.05, 0, { parent: kettle, cast: false, receive: false }); steam.push(s); }

  // coffee machine: a dark steel bean-to-cup machine with a cup on the drip tray
  const coffee = new THREE.Group(); coffee.position.set(-3.35, CH, Z0 + 0.28); scene.add(coffee);
  const cmBody = std({ color: 0x232426, roughness: 0.35, metalness: 0.6 });
  box(0.28, 0.36, 0.4, cmBody, 0, 0.18, 0, { parent: coffee });
  box(0.28, 0.06, 0.12, cmBody, 0, 0.33, 0.24, { parent: coffee });           // the head over the cup
  box(0.24, 0.02, 0.12, steel, 0, 0.012, 0.25, { parent: coffee });           // drip tray
  box(0.18, 0.11, 0.004, blackGlass, 0, 0.27, 0.202, { parent: coffee, cast: false });
  box(0.12, 0.05, 0.003, std({ color: 0x0b1a24, emissive: 0x6fb8ff, emissiveIntensity: 0.6 }), 0, 0.28, 0.205, { parent: coffee, cast: false });
  cyl(0.012, 0.012, 0.03, steel, -0.025, 0.285, 0.26, { parent: coffee }, 10); cyl(0.012, 0.012, 0.03, steel, 0.025, 0.285, 0.26, { parent: coffee }, 10);
  cyl(0.11, 0.11, 0.05, std({ color: 0x3a2a20, roughness: 0.6, transparent: true, opacity: 0.85 }), 0, 0.385, -0.08, { parent: coffee }, 24);   // bean hopper
  const cupGeo = new THREE.LatheGeometry([[0, 0], [0.03, 0], [0.036, 0.005], [0.04, 0.07], [0.036, 0.07], [0.033, 0.008], [0, 0.008]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
  add(cupGeo, ceramic, 0, 0.022, 0.26, { parent: coffee });
  // utensil crock, oil bottle, salt, a jar of spoons by the hob
  const crock = new THREE.Group(); crock.position.set(0.65, CH, Z0 + 0.18); scene.add(crock);
  cyl(0.06, 0.055, 0.16, ceramic, 0, 0.08, 0, { parent: crock }, 24);
  for (let i = 0; i < 5; i++) { const u = cyl(0.008, 0.008, 0.3, i % 2 ? oak : darkMetal, rr(-0.025, 0.025), 0.2, rr(-0.025, 0.025), { parent: crock }, 8); u.rotation.set(rr(-0.2, 0.2), 0, rr(-0.2, 0.2)); }
  const oil = new THREE.Group(); oil.position.set(1.7, CH, Z0 + 0.15); scene.add(oil);
  add(new THREE.LatheGeometry([[0, 0], [0.035, 0], [0.035, 0.18], [0.015, 0.23], [0.012, 0.27], [0, 0.27]].map(([x, y]) => new THREE.Vector2(x, y)), 24),
    new THREE.MeshPhysicalMaterial({ color: 0xb59a32, roughness: 0.05, transmission: 0.4, transparent: true, opacity: 0.8 }), 0, 0, 0, { parent: oil });
  cyl(0.025, 0.025, 0.09, ceramic, 0.09, 0.045, 0.02, { parent: oil }, 16);
  const board = place(fit(P.wooden_cutting_board, 0.4, "w"), 2.1, CH, Z0 + 0.3, 0.1);
  // a little herb pot on the window sill
  place(fit(P.potted_plant_02, 0.3), WX1 - 0.3, WY0, Z0 + 0.08, 0.6);
  place(fit(P.potted_plant_01, 0.28), WX0 + 0.25, WY0, Z0 + 0.08, 1.9);

  // ---------------------------------------------------------------- the island
  const IX0 = -1.2, IX1 = 1.4, IZ0 = -0.95, IZ1 = -0.05, ITZ0 = -1.0, ITZ1 = 0.35, IXC = (IX0 + IX1) / 2;
  box(IX1 - IX0 - 0.1, 0.1, IZ1 - IZ0 - 0.08, std({ color: 0x2a2c2b }), IXC, 0.05, (IZ0 + IZ1) / 2);
  box(IX1 - IX0, CH - TT - 0.1, IZ1 - IZ0, cabinetIn, IXC, 0.1 + (CH - TT - 0.1) / 2, (IZ0 + IZ1) / 2);
  // oak slatted panel on the seating side, sage drawers on the working side
  for (let x = IX0 + 0.02; x < IX1 - 0.02; x += 0.06) box(0.045, CH - TT - 0.02, 0.02, oak, x + 0.0225, (CH - TT) / 2 + 0.01, IZ1 + 0.01);
  for (const s of [IX0 - 0.01, IX1 + 0.01]) box(0.02, CH - TT, IZ1 - IZ0 + 0.04, oak, s, (CH - TT) / 2, (IZ0 + IZ1) / 2 + 0.02);
  for (let i = 0; i < 4; i++) { const a = IX0 + i * 0.65, xc = a + 0.325;
    for (const [y0, h] of [[0.11, 0.38], [0.49, 0.36]]) { box(0.646, h - 0.004, 0.02, cabinet, xc, y0 + h / 2, IZ0 - 0.01); handleBar(xc, y0 + h - 0.06, IZ0 - 0.032, 0.3); } }
  const islandTop = box(IX1 - IX0 + 0.1, TT, ITZ1 - ITZ0, quartz(2.7, 1.35), IXC, TY, (ITZ0 + ITZ1) / 2);
  // on the island: a fruit bowl, a chopping board, a vase with stems, a couple of mugs
  const bowl = place(fit(P.wooden_bowl_01, 0.32, "w"), 0.55, CH, -0.35, 0);
  const bh = bowl.children[0] ? bowl.userData.size.y : 0.1;
  const apples = [];
  const appleSrc = fit(P.food_apple_01, 0.082, "w");
  for (const [dx, dz, dy, ry] of [[-0.06, -0.03, 0.03, 0], [0.06, -0.02, 0.03, 1.4], [0.0, 0.07, 0.03, 2.6], [-0.01, 0.0, 0.085, 0.8], [0.07, 0.07, 0.04, 2]]) {
    const a = appleSrc.clone(); a.position.set(0.55 + dx, CH + Math.min(bh * 0.35, 0.05) + dy - 0.02, -0.35 + dz); a.rotation.y = ry; scene.add(a); apples.push(a);
  }
  // two lemons and a banana bunch beside the apples
  const lemonMat = std({ color: 0xe8c832, roughness: 0.55 });
  for (const [dx, dz] of [[-0.07, 0.08], [0.1, -0.07]]) { const l = add(new THREE.SphereGeometry(0.035, 16, 12), lemonMat, 0.55 + dx, CH + 0.075, -0.35 + dz); l.scale.set(1.25, 1, 1); }
  place(fit(P.wooden_cutting_board.clone(), 0.42, "w"), -0.5, CH, -0.45, 1.4);
  const knife = new THREE.Group(); knife.position.set(-0.45, CH + 0.03, -0.42); knife.rotation.y = 0.6; scene.add(knife);
  box(0.16, 0.002, 0.03, steel, 0.08, 0.002, 0, { parent: knife, cast: false }); box(0.1, 0.016, 0.02, darkMetal, -0.05, 0.008, 0, { parent: knife });
  const vase = place(fit(P.ceramic_vase_01, 0.24), -0.95, CH, -0.6, 0);
  for (let i = 0; i < 4; i++) { const st = cyl(0.003, 0.003, 0.3, std({ color: 0x4f6b3a }), -0.95 + rr(-0.03, 0.03), CH + 0.36, -0.6 + rr(-0.03, 0.03), { cast: false }, 6); st.rotation.set(rr(-0.25, 0.25), 0, rr(-0.25, 0.25));
    add(new THREE.SphereGeometry(0.025, 10, 8), std({ color: 0xf1ede2, roughness: 0.8 }), st.position.x + st.rotation.z * -0.15, CH + 0.5, st.position.z + st.rotation.x * 0.15, { cast: false }); }
  for (const [x, z] of [[0.05, 0.12], [1.05, 0.15]]) add(cupGeo, std({ color: x > 0.5 ? 0x2f4d63 : 0xe2ddd3, roughness: 0.3 }), x, CH, z).scale.setScalar(1.4);

  // bar stools on the seating side
  const stools = [];
  const stoolSrc = fit(P.metal_stool_02, 0.66);
  for (const [x, ry] of [[-0.65, 0.2], [0.15, -0.1], [0.95, 0.35]]) { const s = stoolSrc.clone(); place(s, x, 0, 0.62, ry); stools.push(s); }

  // pendant lights over the island, each on a cord from a ceiling rose
  const pendants = [], pendantGlow = [];
  const lampSrc = fit(P.modern_ceiling_lamp_01, 0.34, "w");
  const lampH = lampSrc.userData.size.y, LB = 1.72;
  const glowMat = std({ color: 0xffffff, emissive: 0xffe2b5, emissiveIntensity: 3 });
  for (const x of [IXC - 0.85, IXC, IXC + 0.85]) {
    const lamp = lampSrc.clone(); place(lamp, x, LB, (ITZ0 + ITZ1) / 2 - 0.1, 0);
    lamp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const top = LB + lampH;
    if (top < H) cyl(0.004, 0.004, H - top, darkMetal, x, (top + H) / 2, (ITZ0 + ITZ1) / 2 - 0.1, { cast: false }, 6);
    decor.ceiling.push(cyl(0.05, 0.05, 0.02, paintWhite, x, H - 0.01, (ITZ0 + ITZ1) / 2 - 0.1, { cast: false }));
    const g = add(new THREE.SphereGeometry(0.035, 12, 10), glowMat, x, LB + Math.min(0.08, lampH * 0.3), (ITZ0 + ITZ1) / 2 - 0.1, { cast: false, receive: false });
    pendantGlow.push(g);
    const pl = new THREE.PointLight(0xffd6a0, 2.2, 0, 2); pl.position.set(x, LB - 0.05, (ITZ0 + ITZ1) / 2 - 0.1); scene.add(pl); pendants.push(pl);
  }

  // ---------------------------------------------------------------- west wall: oak shelves, prints, a plant
  const shelfZ0 = -1.4, shelfZ1 = 0.4, plateMat = std({ color: 0xf1eee8, roughness: 0.3 }), blueGlaze = std({ color: 0x3b5d73, roughness: 0.25 });
  for (const y of [1.35, 1.8]) {
    box(0.26, 0.04, shelfZ1 - shelfZ0, oak, X0 + 0.13, y, (shelfZ0 + shelfZ1) / 2);
    // a stack of plates, bowls, jars
    for (let i = 0; i < 6; i++) cyl(0.12, 0.1, 0.014, plateMat, X0 + 0.14, y + 0.02 + 0.007 + i * 0.016, shelfZ0 + 0.2, {}, 32);
    for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.075, 24, 12, 0, 2 * PI, PI / 2, PI / 2), y > 1.5 ? blueGlaze : plateMat, X0 + 0.13, y + 0.02 + 0.075 + i * 0.025, shelfZ0 + 0.52).rotation.x = PI;
    for (let j = 0; j < 3; j++) { const jx = X0 + 0.13, jz = shelfZ0 + 0.85 + j * 0.15, jh = rr(0.14, 0.2);
      add(new THREE.CylinderGeometry(0.05, 0.05, jh, 20), new THREE.MeshPhysicalMaterial({ color: 0xe8efe9, roughness: 0.05, transparent: true, opacity: 0.35 }), jx, y + 0.02 + jh / 2, jz);
      cyl(0.044, 0.044, jh * 0.6, std({ color: [0xd9c08a, 0x7a4a2a, 0xe8e2d4][j], roughness: 0.9 }), jx, y + 0.02 + jh * 0.3, jz, { cast: false }, 16);
      cyl(0.052, 0.052, 0.025, oak, jx, y + 0.02 + jh + 0.012, jz, {}, 20); }
    for (let j = 0; j < 4; j++) box(0.18, rr(0.2, 0.26), rr(0.025, 0.04), std({ color: [0x7b2d26, 0x23395b, 0xc9a227, 0x2f5d50][j], roughness: 0.75 }), X0 + 0.11, y + 0.14, shelfZ1 - 0.08 - j * 0.04);
  }
  const frameDark = std({ color: 0x1d1a17, roughness: 0.5 });
  const print = (side, x, y, z, ry, w, h, palette) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
    box(w + 0.05, h + 0.05, 0.03, frameDark, 0, 0, 0, { parent: g, cast: false });
    box(w - 0.02, h - 0.02, 0.005, paintWhite, 0, 0, 0.016, { parent: g, cast: false });
    add(new THREE.PlaneGeometry(w - 0.12, h - 0.12), std({ map: artTex(palette), roughness: 0.8 }), 0, 0, 0.02, { parent: g, cast: false });
    decor[side].push(g);
  };
  print("west", X0 + 0.02, 1.55, 1.5, PI / 2, 0.6, 0.8, ["#efe7d8", "#d2763f", "#33536a", "#e2b85b"]);
  print("east", X1 - 0.02, 1.5, 0.2, -PI / 2, 0.9, 0.65, ["#e7e2d6", "#3f5e4d", "#c05a43", "#1f2a3a", "#e9cf92"]);
  print("south", -1.2, 1.55, Z1 - 0.02, PI, 1.0, 0.7, ["#ece5d8", "#28405a", "#c99350", "#8a3a30"]);
  const plantW = place(fit(P.potted_plant_01, 1.1), X0 + 0.4, 0, 2.6, 0.3);
  const plantS = place(fit(P.potted_plant_02, 0.9), X1 - 0.4, 0, Z1 - 0.4, 2.2);
  // radiator on the east wall
  const rad = new THREE.Group(); rad.position.set(X1 - 0.06, 0.15, 1.5); scene.add(rad);
  for (let i = 0; i < 14; i++) box(0.05, 0.55, 0.045, paintWhite, 0, 0.275, -0.35 + i * 0.054, { parent: rad });
  decor.east.push(rad);
  // the door on the south wall
  const doorMat = std({ color: 0xf0ece3, roughness: 0.45 });
  decor.south.push(box(0.9, 2.05, 0.04, doorMat, 2.9, 1.025, Z1 - 0.02));
  for (const [w, h, x, y] of [[0.08, 2.13, 2.41, 1.065], [0.08, 2.13, 3.39, 1.065], [1.06, 0.08, 2.9, 2.09]]) decor.south.push(box(w, h, 0.05, paintWhite, x, y, Z1 - 0.025));
  for (const [y0, y1] of [[0.25, 0.95], [1.15, 1.85]]) decor.south.push(box(0.64, y1 - y0, 0.01, std({ color: 0xe6e1d6, roughness: 0.5 }), 2.9, (y0 + y1) / 2, Z1 - 0.045, { cast: false }));
  decor.south.push(add(new THREE.SphereGeometry(0.03, 12, 10), brass, 2.55, 1.0, Z1 - 0.08, { cast: false }));
  // a runner rug along the walkway
  const rugTex = cnv(1600, 400, (g, w, h) => {
    g.fillStyle = "#c9bfae"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) { g.fillStyle = `rgba(${rr(80, 120)},${rr(80, 110)},${rr(70, 100)},${rr(0.05, 0.15)})`; g.fillRect(0, y, w, 3); }
    g.strokeStyle = "#5a5148"; g.lineWidth = 16; g.strokeRect(30, 30, w - 60, h - 60);
    const id = g.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0);
  });
  const rugMat = std({ map: rugTex, normalMap: SAND.normalMap.clone(), roughness: 1 }); rugMat.normalMap.repeat.set(8, 2);
  box(3.2, 0.01, 0.8, rugMat, 0.1, 0.005, 1.85, { cast: false });

  // ---------------------------------------------------------------- the cast
  const castMap = {}, gait = {}, bones = {};
  const findBone = (o, re) => { let b = null; o.traverse((x) => { if (!b && x.isBone && re.test(x.name)) b = x; }); return b; };
  figures.forEach((f, i) => {
    const id = cast[i]; castMap[id] = f; scene.add(f.object);
    f.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    bones[id] = { head: findBone(f.object, /Head$/), hips: findBone(f.object, /Hips$/), leftFoot: findBone(f.object, /LeftFoot$/), rightFoot: findBone(f.object, /RightFoot$/) };
    const speed = (name) => {
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
    atIsland: { x: 0.1, z: -1.42, heading: 0 }, atSink: { x: SINKX, z: FZ + 0.32, heading: PI }, atHob: { x: HOBX, z: FZ + 0.32, heading: PI },
    byFridge: { x: 3.0, z: -1.6, heading: PI }, onStool: { x: 0.15, z: 0.75, heading: PI },
    walkFrom: { x: -3.4, z: 1.85, heading: PI / 2 }, walkTo: { x: 3.4, z: 1.85, heading: PI / 2 },
  };

  // ---------------------------------------------------------------- per frame
  const setSide = (side, hide) => {
    for (const m of sides[side]) m.material = hide ? GHOST : m.userData.mat;
    for (const d of decor[side]) d.visible = !hide;
  };
  function update(state = {}) {
    const time = state.time || 0, people = state.people || {};
    cast.forEach((id, i) => {
      const f = castMap[id], d = spots.atIsland, p = people[id] || { ...d, x: d.x + i * 0.8 };
      f.object.visible = p.show !== false;
      f.object.position.set(p.x ?? d.x, 0, p.z ?? d.z);
      f.object.rotation.set(0, p.heading ?? d.heading, 0);
      const g = { ...(p.gait || {}) }; let sum = 0; for (const k in g) sum += g[k] || 0;
      if (f.actions.idle) g.idle = Math.max(0, 1 - sum);
      f.pose(p.time ?? time, g);
    });
    const on = state.pendants ?? 1, sunK = state.sun ?? 1, st = state.steam ?? 0;
    pendants.forEach((l) => (l.intensity = 2.2 * on)); glowMat.emissiveIntensity = 3 * on + 0.05;
    sun.intensity = 5.0 * sunK;
    steam.forEach((s, i) => { const ph = (time * 0.6 + i / steam.length) % 1;
      s.position.set(0.13 + ph * 0.05 + Math.sin(time * 2 + i) * 0.01, 0.25 + ph * 0.3, Math.sin(time * 1.3 + i * 2) * 0.015);
      s.scale.setScalar(0.6 + ph * 1.6); s.material.opacity = st * 0.22 * Math.sin(ph * PI); });
    const c = camera.position, cut = state.cutaway !== false;
    setSide("north", cut && c.z < Z0); setSide("south", cut && c.z > Z1);
    setSide("west", cut && c.x < X0); setSide("east", cut && c.x > X1); setSide("ceiling", cut && c.y > H);
  }
  const render = () => renderer.render(scene, camera);
  update({});

  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: figures[0] ? figures[0].object : null, bones, gaitSpeed: gait, spots,
    room: { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H },
    island: { x0: IX0, x1: IX1, z0: ITZ0, z1: ITZ1, top: CH }, islandCentre: new V3(IXC, CH, (ITZ0 + ITZ1) / 2), islandTop,
    stools, kettle, coffeeMachine: coffee, fridge, fruitBowl: bowl, apples, hob, sink: sinkPos, pot, board, vase,
    pendants, sun, sunDir, windowCentre: new V3(WXc, (WY0 + WY1) / 2, Z0), plants: [plantW, plantS],
  };
}
