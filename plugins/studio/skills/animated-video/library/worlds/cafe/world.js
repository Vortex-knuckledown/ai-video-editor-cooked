// World "cafe": a cosy street-corner coffee shop by day, daylight pouring in through a big street-facing window.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. The room's inside faces: x -6..6, z -4.5..4.5, floor y = 0, ceiling y = 3.2.
//   North wall (z = -4.5): a back counter x -6..1.6 (front z -3.9, top y 0.9) with a drip brewer, syrups, cups and an
//                          under-counter fridge; subway tiles behind it; open oak shelves of cups and jars either side
//                          of a big chalk menu board (x -4..-1, y 1.5..2.8). East of it: an oak display shelf of
//                          coffee bags and a tall plant.
//   The counter:  x -5..1.6, z -3..-2.4 (customer face z -2.4), top y 1.02, oak slatted front, dark stone top.
//                 On it: an espresso machine (x -3.4, group heads facing the barista, north) and a grinder (x -2.6),
//                 a till (x -1.4), a glass pastry case x -0.4..1.4 with croissants, muffins, cakes and doughnuts,
//                 stacks of cups at x -4.6. Four glass pendant lamps hang over it (bottoms at y 1.95).
//                 The barista's aisle is z -3.9..-3.0.
//   Middle:  three round marble bistro tables at z 0.9 (x -4.2, -1.4, 1.4), a chair west and east of each, a dark dome
//            pendant over each (bottom y 2.0). A reading corner: an armchair and side table at x 3.6.
//   South wall (z = 4.5): the big street window x -5.7..4.3 (sill y 0.95, head y 2.85), a glass door x 4.6..5.6.
//            A window bench along it (x -5.8..4.3, z 3.95..4.5, seat y 0.48) with four small tables (z 3.45) and a
//            chair each on their north side (z 2.85).
//   West wall (x = -6): bare brick, framed prints, a plant.   East wall (x = 6): oak shelves of cups and plants, a clock.
//   Outside the window: a pavement with trees and lamp posts, a street with parked cars, shopfronts and flats opposite.
//   Walk lanes: lane A along the counter, z -1.2 (spots.walkFrom -> walkTo, x -4.6 .. 3.6);
//               lane B between the table rows, z 2.1, free from x -5.4 to 4.4 (a side-on camera can track from here).
//               The east aisle x ~5 (door to counter) is where the background walker goes.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], clips, extras = true}) -> world.
//   cast entries: "woman" | "man" | ... or {id: "man", outfit: {shirt: "#2f6fdd", trousers: "#3b4a6b"}, as: "sam"}
//   (outfit for man and woman only); each is world.cast.<as || id>.
//   extras: background people built into the place (false to leave them out): a barista behind the counter, a customer
//   at the pastry case, a customer walking between the door and the counter. Their outfits are always picked to differ
//   from every cast member's colours.
// Per frame: set world.camera (position, fov, lookAt), then world.update(state), then world.render(). update() cuts away
// whichever walls / ceiling stand between the camera and the room, so a camera may be outside (a side-on view from the
// pavement at z 7, an aerial view from y 10) and still see in. Wall shadows stay.
//
// state (every field optional):
//   time        seconds of the shot (default clock for everyone's animation)
//   people      {<cast key>: {x, z, heading, time, gait: {walk, run, <other clip>: w}, show}}
//               heading radians about +y: 0 faces +z (south, the window), PI/2 faces east, PI faces north (the counter),
//               -PI/2 faces west. gait weights 0..1, idle takes the rest. Move a walker by world.gaitSpeed[key].walk *
//               walk metres per second so the feet do not slide. A cast member missing from people stands at
//               world.spots.atCounter (the next ones a step east of it).
//   extras      false hides all background people; or {barista: {show}, customer: {show}, walker: {show, phase}}
//               (phase: seconds added to the walker's loop clock)
//   lamps       0..1 the pendant lamps (default 1)
//   sun         0..1 how much sun comes through the window (default 1)
//   steam       0..1 a wisp of steam over the espresso machine's cup (default 0.6)
//   cutaway     false keeps every wall and the ceiling drawn (default: cut away what blocks the camera)
//
// Exposes: world.cast.<key> (loadFigure result: object, pose, height), world.person (the first cast member's object),
// world.gaitSpeed.<key> {walk, run} m/s (also .walk / .run for the first), world.spots {atCounter, atPastryCase,
// atWindow, byDoor, walkFrom, walkTo, laneB: {x, z, heading}}, world.room {x0, x1, z0, z1, h},
// world.counter {x0, x1, z0, z1, top}, world.counterCentre (Vector3 on the counter top), world.espressoMachine,
// world.grinder, world.till, world.pastryCase, world.menuBoard (Groups), world.tables [{x, z, top}], world.chairs,
// world.lamps [PointLight], world.sun (DirectionalLight), world.windowCentre (Vector3), world.extras {barista,
// customer, walker} (loadFigure results), world.extraOutfits, world.bones.<key> {head, hips, leftFoot, rightFoot}.
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], clips, extras = true }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const X0 = -6, X1 = 6, Z0 = -4.5, Z1 = 4.5, H = 3.2, WT = 0.2;

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
  const camera = new THREE.PerspectiveCamera(45, W / Hh, 0.03, 700);
  camera.position.set(-5.2, 2.3, 3.6); camera.lookAt(0, 1, -1.5);

  // ---------------------------------------------------------------- the cast and the background people
  const castList = cast.map((c) => (typeof c === "string" ? { id: c } : c));
  const keys = castList.map((c) => c.as || c.id);
  const DEFAULT_CLOTHES = { woman: ["#eeeeee", "#151515"], man: ["#262626", "#202020"] };
  const castColours = castList.map((c) => {
    const d = DEFAULT_CLOTHES[c.id] || ["#888888", "#555555"];
    return [new THREE.Color((c.outfit && c.outfit.shirt) || d[0]), new THREE.Color((c.outfit && c.outfit.trousers) || d[1])];
  });
  const far = (hex) => { const c = new THREE.Color(hex);
    return castColours.every(([s, t]) => Math.hypot(c.r - s.r, c.g - s.g, c.b - s.b) > 0.22 && Math.hypot(c.r - t.r, c.g - t.g, c.b - t.b) > 0.22); };
  const pick = (options) => options.find(([s, t]) => far(s) && far(t)) || options[options.length - 1];
  const EXTRA_DEFS = extras === false ? [] : [
    { key: "barista", id: "man", clips: ["idle", "talk"],
      options: [["#2f5444", "#5b4636"], ["#7a2e2e", "#6b5a48"], ["#3a4a6a", "#8a7a62"], ["#b8862e", "#3b3f4a"]] },
    { key: "customer", id: "woman", clips: ["idle", "talk"],
      options: [["#a8433a", "#38507a"], ["#5f7f5a", "#7a5a40"], ["#c08a2e", "#4a5560"], ["#6a4a8a", "#8a8070"]] },
    { key: "walker", id: "man", clips: ["idle", "walk"],
      options: [["#d3a13b", "#6a6f76"], ["#2f6f9a", "#8a6a4a"], ["#8b5aa0", "#3f5a4a"], ["#c0603a", "#4a5a70"]] },
  ];
  const extraOutfits = {};
  for (const e of EXTRA_DEFS) { const [shirt, trousers] = pick(e.options); extraOutfits[e.key] = { shirt, trousers }; }

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
  const propIds = ["dining_chair_02", "croissant", "modern_ceiling_lamp_01", "potted_plant_01", "potted_plant_02",
    "wooden_display_shelves_01", "wall_clock", "ArmChair_01", "side_table_01", "ceramic_vase_01"];
  const [sky, BRICK, CONC, ASPH, SAND, ROCK, ...rest] = await Promise.all([
    hdr("sky/day.hdr"), pbrSet("brick"), pbrSet("concrete"), pbrSet("asphalt"), pbrSet("sand"), pbrSet("rock"),
    ...propIds.map((id) => loadProp({ THREE, id })),
    ...castList.map((c) => loadFigure({ THREE, id: c.id, clips: clips || ["idle", "walk", "run"], outfit: c.outfit || null })),
    ...EXTRA_DEFS.map((e) => loadFigure({ THREE, id: e.id, clips: e.clips, outfit: extraOutfits[e.key] })),
  ]);
  const P = Object.fromEntries(propIds.map((id, i) => [id, rest[i]]));
  const figures = rest.slice(propIds.length, propIds.length + castList.length);
  const extraFigs = rest.slice(propIds.length + castList.length);

  const surf = (set, w, h, tile, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ ...extra });
    for (const k of ["map", "normalMap", "roughnessMap"]) { const t = set[k].clone(); t.repeat.set(w / tile, h / tile); t.needsUpdate = true; m[k] = t; }
    return m;
  };

  let seed = 7741203;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);

  // ---------------------------------------------------------------- sky, light
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, PI * 0.8, 0); scene.environmentRotation.set(0, PI * 0.8, 0);
  scene.backgroundIntensity = 0.9; scene.environmentIntensity = 0.5;
  scene.fog = new THREE.Fog(0xc9d5e0, 30, 160);

  const sun = new THREE.DirectionalLight(0xfff0d8, 4.6);
  const sunDir = new V3(-0.45, 0.62, 1).normalize();   // towards the sun: high in the south-west, in through the street window
  sun.position.copy(sunDir).multiplyScalar(40); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 5, far: 90 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xe4ecf6, 0x8a6f58, 0.95); scene.add(hemi);
  const bounce = new THREE.DirectionalLight(0xeaf0ff, 0.6); bounce.position.set(0.5, 3, 8); scene.add(bounce);   // daylight off the street
  const fillA = new THREE.PointLight(0xffe9d0, 5, 0, 2); fillA.position.set(-2, 2.6, 0.4); scene.add(fillA);
  const fillB = new THREE.PointLight(0xffe9d0, 4, 0, 2); fillB.position.set(3, 2.6, -1); scene.add(fillB);

  // ---------------------------------------------------------------- canvas textures
  const cnv = (w, h, paint) => { const c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const PX = 2048 / 3.6;
  const woodPaint = (g, w, h, { plank = 0.18, base = [28, 38, 46], spread = 6, dark = 0.7, ends = true } = {}) => {
    const pw = plank * PX;
    for (let y = 0; y < h; y += pw) {
      let x = -rr(0, 1.6) * PX;
      while (x < w) {
        const len = ends ? rr(0.9, 2.0) * PX : w * 2, hue = base[0] + rr(-3, 3), sat = base[1] + rr(-6, 5), lit = base[2] + rr(-spread, spread);
        g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`; g.fillRect(x, y, len, pw);
        for (let i = 0; i < 24; i++) {
          const gy = y + rr(0, pw), a = rr(0.04, 0.13), amp = rr(0.5, 3), fr = rr(0.004, 0.02), ph = rr(0, 6);
          g.strokeStyle = `hsla(${hue - 4},${sat + 5}%,${lit * dark}%,${a})`; g.lineWidth = rr(0.6, 2.2); g.beginPath();
          for (let k = 0; k <= len; k += 8) { const yy = gy + Math.sin(k * fr + ph) * amp; k ? g.lineTo(x + k, yy) : g.moveTo(x + k, yy); }
          g.stroke();
        }
        if (rnd() < 0.25) { const kx = x + rr(0.1, 0.9) * len, ky = y + rr(0.25, 0.75) * pw;
          for (let r = 6; r > 0; r -= 1.5) { g.strokeStyle = `hsla(${hue - 6},${sat + 8}%,${lit * 0.55}%,0.22)`; g.beginPath(); g.ellipse(kx, ky, r * 2.4, r, 0, 0, 2 * PI); g.stroke(); } }
        g.fillStyle = "rgba(50,32,18,0.5)"; g.fillRect(x, y, 2, pw);
        x += len;
      }
      g.fillStyle = "rgba(50,32,18,0.55)"; g.fillRect(0, y, w, 2);
    }
  };
  const floorTex = cnv(2048, 2048, (g, w, h) => woodPaint(g, w, h));
  const oakTex = cnv(1024, 1024, (g, w, h) => woodPaint(g, w, h, { plank: 0.5, base: [32, 42, 52], spread: 3, ends: false }));
  const tileTex = cnv(1024, 1024, (g, w, h) => {      // white subway tiles 0.15 x 0.075 m, a 1.2 m square
    g.fillStyle = "#b9b6ae"; g.fillRect(0, 0, w, h);
    const tw = w / 8, th = h / 16;
    for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) {
      const x = c * tw + (r % 2 ? tw / 2 : 0), y = r * th, l = rr(90, 96);
      const gr = g.createLinearGradient(x, y, x, y + th); gr.addColorStop(0, `hsl(40,12%,${l + 2}%)`); gr.addColorStop(1, `hsl(40,10%,${l - 3}%)`);
      g.fillStyle = gr; g.fillRect(x + 3, y + 3, tw - 6, th - 6);
    }
  });
  const tileBump = cnv(1024, 1024, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h); const tw = w / 8, th = h / 16;
    for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) { const x = c * tw + (r % 2 ? tw / 2 : 0), y = r * th; g.fillStyle = "#fff"; g.fillRect(x + 4, y + 4, tw - 8, th - 8); }
  });
  tileBump.colorSpace = THREE.NoColorSpace;
  const marbleTex = cnv(1024, 1024, (g, w, h) => {
    g.fillStyle = "#eeebe5"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${rr(120, 170)},${rr(120, 170)},${rr(120, 170)},${rr(0.05, 0.18)})`; g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(1, 3)); }
    for (let v = 0; v < 9; v++) { g.strokeStyle = `rgba(120,118,115,${rr(0.08, 0.22)})`; g.lineWidth = rr(1, 5); g.beginPath();
      let x = rr(0, w), y = 0; g.moveTo(x, y); while (y < h) { x += rr(-40, 40); y += rr(20, 70); g.lineTo(x, y); } g.stroke(); }
  });
  const stoneTex = cnv(1024, 1024, (g, w, h) => {     // dark terrazzo-like counter top
    g.fillStyle = "#2c2a28"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const l = rr(25, 75); g.fillStyle = `hsla(30,${rr(0, 12)}%,${l}%,${rr(0.2, 0.6)})`; g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(0.6, 3), 0, 2 * PI); g.fill(); }
  });
  const menuTex = cnv(1536, 1280, (g, w, h) => {       // a chalk menu board
    g.fillStyle = "#1e2220"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${rr(0.01, 0.05)})`; g.fillRect(rr(0, w), rr(0, h), rr(4, 60), rr(1, 6)); }
    g.fillStyle = "#f2efe6"; g.textBaseline = "middle";
    g.font = "bold 120px Georgia, serif"; g.textAlign = "center"; g.fillText("COFFEE", w / 2, 130);
    g.strokeStyle = "rgba(242,239,230,0.7)"; g.lineWidth = 4; g.beginPath(); g.moveTo(w * 0.3, 215); g.lineTo(w * 0.7, 215); g.stroke();
    const col = (x0, items) => items.forEach(([name, price], i) => {
      const y = 320 + i * 118; g.textAlign = "left"; g.font = "64px Georgia, serif"; g.fillStyle = "#f2efe6"; g.fillText(name, x0, y);
      g.textAlign = "right"; g.fillStyle = "#f0d58a"; g.fillText(price, x0 + 600, y);
      g.fillStyle = "rgba(242,239,230,0.35)"; for (let d = x0 + g.measureText(name).width + 0; d < x0 + 470; d += 22) g.fillRect(d, y + 22, 8, 4);
    });
    col(90, [["Espresso", "2.60"], ["Macchiato", "2.90"], ["Flat white", "3.40"], ["Cappuccino", "3.40"], ["Latte", "3.60"], ["Mocha", "3.90"], ["Americano", "3.00"], ["Pour over", "4.20"]]);
    col(830, [["Tea", "2.80"], ["Chai latte", "3.70"], ["Hot chocolate", "3.50"], ["Croissant", "2.90"], ["Pain au choc", "3.20"], ["Muffin", "3.10"], ["Banana bread", "3.40"], ["Cake slice", "4.00"]]);
  });
  const artTex = (palette) => cnv(512, 640, (g, w, h) => {
    g.fillStyle = palette[0]; g.fillRect(0, 0, w, h);
    for (let i = 1; i < palette.length; i++) { g.fillStyle = palette[i]; g.globalAlpha = 0.9;
      const x = rr(0, w * 0.5), y = rr(0, h * 0.6); rnd() < 0.5 ? g.fillRect(x, y, rr(120, 300), rr(120, 300)) : (g.beginPath(), g.arc(x + 100, y + 100, rr(50, 140), 0, 2 * PI), g.fill()); }
    g.globalAlpha = 1;
  });
  const signTex = cnv(1024, 256, (g, w, h) => {
    g.fillStyle = "#24392f"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e9dcbc"; g.font = "bold 130px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("CAFÉ", w / 2, h / 2 + 6);
    g.strokeStyle = "#c9a86a"; g.lineWidth = 6; g.strokeRect(16, 16, w - 32, h - 32);
  });
  const bagTex = (hex, label) => cnv(256, 384, (g, w, h) => {
    g.fillStyle = hex; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(40, 150, w - 80, 110);
    g.fillStyle = "#222"; g.font = "bold 40px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, w / 2, 205);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, w, 30);
  });
  const shopTex = (bg, label) => cnv(1024, 192, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = "#f4efe4"; g.font = "bold 96px Helvetica, Arial, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, w / 2, h / 2 + 4);
  });

  // ---------------------------------------------------------------- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const plaster = (w, h, color = 0xf0e8dc) => { const m = surf(CONC, w, h, 1.6, { color, roughness: 0.92 }); m.map = null; m.normalScale = new THREE.Vector2(0.3, 0.3); return m; };
  const paintWhite = std({ color: 0xf4f0e8, roughness: 0.55 });
  const oak = std({ map: oakTex, roughness: 0.5, color: 0xffffff });
  const darkOak = std({ map: oakTex, roughness: 0.55, color: 0x8a6a52 });
  const steel = surf(CONC, 1, 1, 0.5, { color: 0xd2d5d8, roughness: 0.22, metalness: 1 }); steel.map = null; steel.normalScale = new THREE.Vector2(0.04, 0.04);
  const darkMetal = std({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.8 });
  const brass = std({ color: 0xc09a58, roughness: 0.28, metalness: 1 });
  const blackGlass = std({ color: 0x060607, roughness: 0.08, metalness: 0.3 });
  const ceramic = std({ color: 0xf5f2ec, roughness: 0.22 });
  const stone = (w, d) => { const m = std({ map: stoneTex.clone(), roughness: 0.25, color: 0xffffff }); m.map.repeat.set(w / 1.6, d / 1.6); m.map.needsUpdate = true; return m; };
  const marble = std({ map: marbleTex, roughness: 0.2, color: 0xffffff });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xe6eef4, roughness: 0.03, transparent: true, opacity: 0.07, envMapIntensity: 1.5, depthWrite: false });
  const caseGlass = new THREE.MeshPhysicalMaterial({ color: 0xeef4f6, roughness: 0.02, transparent: true, opacity: 0.16, envMapIntensity: 1.6, depthWrite: false });
  const GHOST = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  const add = (geo, mat, x, y, z, { cast = true, receive = true, parent = scene } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
  const cyl = (rt, rb, h, mat, x, y, z, o, seg = 24) => add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, o);
  const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

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
  const place = (obj, x, y, z, rotY = 0, parent = scene) => { obj.position.set(x, y, z); obj.rotation.y = rotY; parent.add(obj); return obj; };

  // small things used everywhere
  const cupGeo = lathe([[0, 0], [0.032, 0], [0.038, 0.006], [0.043, 0.075], [0.039, 0.075], [0.035, 0.009], [0, 0.009]]);
  const saucerGeo = lathe([[0, 0], [0.06, 0], [0.072, 0.012], [0.068, 0.014], [0.055, 0.004], [0, 0.004]]);
  const plateGeo = lathe([[0, 0], [0.09, 0], [0.11, 0.014], [0.106, 0.016], [0.085, 0.005], [0, 0.005]]);
  const coffeeTop = std({ color: 0x6b4226, roughness: 0.4 });
  const cup = (x, y, z, { color = 0xf5f2ec, saucer = true, full = true, parent = scene } = {}) => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    let y0 = 0;
    if (saucer) { add(saucerGeo, ceramic, 0, 0, 0, { parent: g }); y0 = 0.008; }
    add(cupGeo, color === 0xf5f2ec ? ceramic : std({ color, roughness: 0.25 }), 0, y0, 0, { parent: g });
    const h = add(new THREE.TorusGeometry(0.02, 0.005, 8, 16, PI * 1.2), ceramic, 0.045, y0 + 0.045, 0, { parent: g }); h.rotation.z = -PI * 0.6;
    if (full) add(new THREE.CircleGeometry(0.037, 20), coffeeTop, 0, y0 + 0.066, 0, { parent: g, cast: false }).rotation.x = -PI / 2;
    return g;
  };
  const croissantSrc = fit(P.croissant, 0.16, "w");
  const croissant = (x, y, z, ry = 0, parent = scene) => place(croissantSrc.clone(), x, y, z, ry, parent);

  // ---------------------------------------------------------------- the shell
  const floorMat = std({ map: floorTex, normalMap: CONC.normalMap.clone(), normalScale: new THREE.Vector2(0.15, 0.15), roughness: 0.42, color: 0xd9c4ae });
  floorTex.repeat.set((X1 - X0) / 3.6, (Z1 - Z0) / 3.6); floorMat.normalMap.repeat.set(4, 3);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), floorMat);
  floor.rotation.x = -PI / 2; floor.position.set(0, 0, (Z0 + Z1) / 2); floor.receiveShadow = true; scene.add(floor);
  box(X1 - X0 + 2 * WT, 0.4, Z1 - Z0 + 2 * WT, surf(CONC, 12, 9, 3), 0, -0.201, (Z0 + Z1) / 2);

  const sides = { north: [], south: [], east: [], west: [], ceiling: [] };
  const decor = { north: [], south: [], east: [], west: [], ceiling: [] };
  const wall = (side, w, h, d, mat, x, y, z) => { const m = box(w, h, d, mat, x, y, z); m.userData.mat = mat; sides[side].push(m); return m; };
  const ZC = (Z0 + Z1) / 2, DEPTH = Z1 - Z0, zS = Z1 + WT / 2;
  wall("north", X1 - X0 + 2 * WT, H, WT, plaster(12.4, H), 0, H / 2, Z0 - WT / 2);
  wall("west", WT, H, DEPTH, surf(BRICK, DEPTH, H, 1.6, { color: 0xe8d4c6 }), X0 - WT / 2, H / 2, ZC);
  wall("east", WT, H, DEPTH, plaster(DEPTH, H, 0xe9dccb), X1 + WT / 2, H / 2, ZC);
  wall("ceiling", X1 - X0 + 2 * WT, 0.16, DEPTH + 2 * WT, plaster(12.4, 9.4, 0xf4efe7), 0, H + 0.08, ZC);
  sides.ceiling[0].castShadow = true;
  // the south wall: the street window x -5.7..4.3, a glass door x 4.6..5.6. Inside cream, outside painted dark green.
  const WX0 = -5.7, WX1 = 4.3, WY0 = 0.95, WY1 = 2.85, DX0 = 4.6, DX1 = 5.6, DY1 = 2.3;
  const facade = std({ color: 0x2c4538, roughness: 0.6 });
  const southPiece = (x0, x1, y0, y1) => { const inner = plaster(x1 - x0, y1 - y0);
    const mats = [inner, inner, inner, inner, facade, inner];
    return wall("south", x1 - x0, y1 - y0, WT, mats, (x0 + x1) / 2, (y0 + y1) / 2, zS); };
  southPiece(X0 - WT, WX0, 0, H); southPiece(WX1, DX0, 0, H); southPiece(DX1, X1 + WT, 0, H);
  southPiece(WX0, WX1, 0, WY0); southPiece(WX0, WX1, WY1, H); southPiece(DX0, DX1, DY1, H);
  // skirting and cornice
  const skirt = (side, w, d, x, z) => decor[side].push(box(w, 0.1, d, paintWhite, x, 0.05, z, { cast: false }));
  skirt("east", 0.018, DEPTH, X1 - 0.009, ZC); skirt("west", 0.018, DEPTH, X0 + 0.009, ZC);
  for (const [side, w, d, x, z] of [["north", X1 - X0, 0.05, 0, Z0 + 0.025], ["south", X1 - X0, 0.05, 0, Z1 - 0.025],
    ["east", 0.05, DEPTH, X1 - 0.025, ZC], ["west", 0.05, DEPTH, X0 + 0.025, ZC]]) decor[side].push(box(w, 0.07, d, paintWhite, x, H - 0.035, z, { cast: false }));
  // exposed dark beams across the ceiling
  for (let x = -4.5; x <= 4.6; x += 3) decor.ceiling.push(box(0.16, 0.2, DEPTH, darkOak, x, H - 0.1, ZC, { cast: false }));

  // ---------------------------------------------------------------- the street window and door
  const frameMat = std({ color: 0x1f2a24, roughness: 0.45, metalness: 0.4 });
  const WXc = (WX0 + WX1) / 2, WW = WX1 - WX0;
  const mull = [];
  mull.push([WW + 0.08, 0.07, WXc, WY1 - 0.035], [WW + 0.08, 0.07, WXc, WY0 + 0.035], [WW, 0.05, WXc, 2.3]);
  for (let i = 0; i <= 5; i++) mull.push([0.07, WY1 - WY0, WX0 + (i * WW) / 5, (WY0 + WY1) / 2]);
  for (const [w, h, x, y] of mull) decor.south.push(box(w, h, 0.08, frameMat, x, y, zS));
  decor.south.push(box(WW + 0.1, 0.04, 0.3, oak, WXc, WY0 - 0.02, Z1 - 0.1));    // the sill
  decor.south.push(add(new THREE.PlaneGeometry(WW, WY1 - WY0), glass, WXc, (WY0 + WY1) / 2, zS, { cast: false, receive: false }));
  // the door: a dark frame, a glass leaf, a brass push bar
  for (const [w, h, x, y] of [[0.08, DY1, DX0 + 0.04, DY1 / 2], [0.08, DY1, DX1 - 0.04, DY1 / 2], [DX1 - DX0, 0.08, (DX0 + DX1) / 2, DY1 - 0.04],
    [DX1 - DX0, 0.18, (DX0 + DX1) / 2, 0.09]]) decor.south.push(box(w, h, 0.09, frameMat, x, y, zS));
  decor.south.push(add(new THREE.PlaneGeometry(DX1 - DX0 - 0.16, DY1 - 0.26), glass, (DX0 + DX1) / 2, DY1 / 2 + 0.05, zS, { cast: false, receive: false }));
  decor.south.push(box(0.6, 0.03, 0.03, brass, (DX0 + DX1) / 2, 1.05, Z1 - 0.04, { cast: false }));
  decor.south.push(box(0.6, 0.03, 0.03, brass, (DX0 + DX1) / 2, 1.05, Z1 + WT + 0.04, { cast: false }));
  const doormat = box(0.9, 0.012, 0.6, surf(SAND, 0.9, 0.6, 0.4, { color: 0x4a4038, roughness: 1 }), (DX0 + DX1) / 2, 0.006, Z1 - 0.5, { cast: false });

  // outside on the facade: the sign over the window and a striped awning (both cut away with the south wall)
  const sign = add(new THREE.PlaneGeometry(2.4, 0.6), std({ map: signTex, roughness: 0.6 }), -0.7, 3.05, Z1 + WT + 0.012, { cast: false });
  decor.south.push(sign);
  const awnTex = cnv(512, 64, (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? "#efe6d2" : "#2f5a46"; g.fillRect((i * w) / 16, 0, w / 16, h); } });
  awnTex.repeat.set(3, 1);
  const awnMat = std({ map: awnTex, roughness: 0.85, side: THREE.DoubleSide });
  const awning = add(new THREE.PlaneGeometry(WW + 0.4, 1.3), awnMat, WXc, 2.72, Z1 + WT + 0.58);
  awning.rotation.x = -PI / 2 + 0.5; decor.south.push(awning);
  const valance = add(new THREE.PlaneGeometry(WW + 0.4, 0.2), awnMat, WXc, 2.33, Z1 + WT + 1.16, { cast: false }); decor.south.push(valance);

  // ---------------------------------------------------------------- outside: pavement, street, cars, trees, buildings
  const PZ0 = Z1 + WT, PZ1 = PZ0 + 4.2, RZ0 = PZ1, RZ1 = RZ0 + 8, OZ = RZ1 + 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), surf(CONC, 500, 500, 4, { color: 0x9c968c }));
  ground.rotation.x = -PI / 2; ground.position.set(0, -0.3, 0); ground.receiveShadow = true; scene.add(ground);
  box(80, 0.18, PZ1 - PZ0, surf(CONC, 80, PZ1 - PZ0, 2.2, { color: 0xc4bdb2 }), 0, -0.09, (PZ0 + PZ1) / 2);   // near pavement
  box(80, 0.18, 4, surf(CONC, 80, 4, 2.2, { color: 0xbab3a8 }), 0, -0.09, RZ1 + 2);                           // far pavement
  const road = new THREE.Mesh(new THREE.PlaneGeometry(80, RZ1 - RZ0), surf(ASPH, 80, RZ1 - RZ0, 4, { color: 0x8a8a8a }));
  road.rotation.x = -PI / 2; road.position.set(0, -0.17, (RZ0 + RZ1) / 2); road.receiveShadow = true; scene.add(road);
  const kerb = std({ color: 0xa9a59e, roughness: 0.8 });
  box(80, 0.2, 0.18, kerb, 0, -0.08, PZ1 - 0.09); box(80, 0.2, 0.18, kerb, 0, -0.08, RZ1 + 0.09);
  const lineMat = std({ color: 0xe9e3d0, roughness: 0.7 });
  for (let x = -40; x < 40; x += 4) add(new THREE.PlaneGeometry(2, 0.14), lineMat, x, -0.165, (RZ0 + RZ1) / 2, { cast: false }).rotation.x = -PI / 2;
  // parked cars on the near side: a body, a cabin, wheels
  const tyre = std({ color: 0x151515, roughness: 0.9 }), carGlass = std({ color: 0x1b2430, roughness: 0.06, metalness: 0.9 });
  const carCols = [0x7a1f1f, 0xe8e8e8, 0x1d2a3a, 0x8a8f96, 0x3f5a46, 0xc9a227];
  for (const [cx, ci, ry] of [[-13, 0, 0], [-7.6, 1, 0], [-1.4, 2, 0], [5.2, 3, 0], [11, 4, 0], [17, 5, 0]]) {
    const car = new THREE.Group(), cm = std({ color: carCols[ci], roughness: 0.25, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.62, 1.8), cm); body.position.y = 0.62;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.62), carGlass); cab.position.set(-0.2, 1.2, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 1.55), cm); roof.position.set(-0.2, 1.5, 0);
    car.add(body, cab, roof);
    for (const [wx, wz] of [[1.4, 0.9], [1.4, -0.9], [-1.4, 0.9], [-1.4, -0.9]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18), tyre); wh.rotation.x = PI / 2; wh.position.set(wx, 0.34, wz); car.add(wh); }
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.3), std({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.3 })); l.position.set(s * 2.15, 0.7, 0.6); car.add(l); }
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    car.position.set(cx, -0.17, RZ0 + 1.25); car.rotation.y = ry; scene.add(car);
  }
  // street trees and lamp posts on the near pavement
  const bark = std({ color: 0x4a3b2e, roughness: 1 });
  const leafA = surf(ROCK, 4, 4, 2, { color: 0x557a3a, roughness: 1 }), leafB = surf(ROCK, 4, 4, 2, { color: 0x3f6230, roughness: 1 });
  for (const tx of [-17, -9.5, 9.5, 17]) {
    const tz = PZ1 - 0.9;
    box(1.1, 0.02, 1.1, std({ color: 0x3a3028, roughness: 1 }), tx, 0.005, tz, { cast: false });
    add(new THREE.CylinderGeometry(0.1, 0.15, 3.4, 8), bark, tx, 1.7, tz);
    for (let k = 0; k < 7; k++) add(new THREE.IcosahedronGeometry(rr(0.8, 1.2), 1), k % 2 ? leafA : leafB, tx + rr(-0.8, 0.8), 3.6 + rr(0, 1.4), tz + rr(-0.7, 0.7));
  }
  for (const lx of [-12.5, -3.2, 6.8, 13.5]) { const lz = PZ1 - 0.45;
    cyl(0.07, 0.1, 4.6, darkMetal, lx, 2.3, lz); const arm = box(0.06, 0.06, 0.6, darkMetal, lx, 4.55, lz + 0.28);
    add(new THREE.SphereGeometry(0.18, 14, 10), std({ color: 0xfff6dd, emissive: 0xffe9b0, emissiveIntensity: 0.4 }), lx, 4.45, lz + 0.56, { cast: false });
  }
  // a bin and a bike rack by the cafe door
  cyl(0.24, 0.22, 0.9, std({ color: 0x2b3a33, roughness: 0.6, metalness: 0.4 }), 6.6, 0.45, PZ0 + 0.6);
  for (const bx of [-7.3, -6.6]) { const hoop = add(new THREE.TorusGeometry(0.4, 0.025, 8, 24, PI), steel, bx, 0, PZ0 + 1.6); hoop.rotation.y = PI / 2; }
  // the buildings: the cafe's neighbours either side (shopfronts, flats above) and a row opposite
  const winDark = std({ color: 0x26323e, roughness: 0.08, metalness: 0.7 });
  const winFrame = std({ color: 0xebe6dc, roughness: 0.6 });
  const roofMat = surf(ROCK, 20, 20, 3, { color: 0x5a5652 });
  const block = (x0, x1, z0, z1, h, tone, face = 1, shop = null) => {   // face = +1: the front faces +z, -1: faces -z
    const w = x1 - x0, d = z1 - z0, xc = (x0 + x1) / 2, fz = face > 0 ? z1 : z0;
    const m = surf(BRICK, w, h, 2.2, { color: tone });
    box(w, h, d, m, xc, h / 2 - 0.3, (z0 + z1) / 2);
    box(w, 0.04, d, roofMat, xc, h - 0.28, (z0 + z1) / 2, { cast: false });
    const cols = Math.max(2, Math.floor(w / 2.6)), floors = Math.floor((h - 4.2) / 3.1);
    for (let r = 0; r < floors; r++) for (let c = 0; c < cols; c++) {
      const wx = x0 + (c + 0.5) * (w / cols), wy = 4.8 + r * 3.1;
      box(1.3, 1.7, 0.06, winFrame, wx, wy, fz + face * 0.03, { cast: false });
      box(1.12, 1.52, 0.06, winDark, wx, wy, fz + face * 0.05, { cast: false });
    }
    if (shop) {   // a shopfront at street level: a fascia with a name, a dark window
      const fasc = add(new THREE.PlaneGeometry(w - 0.6, 0.55), std({ map: shopTex(shop[0], shop[1]), roughness: 0.6 }), xc, 3.25, fz + face * 0.04, { cast: false });
      if (face < 0) fasc.rotation.y = PI;
      box(w - 1.0, 2.2, 0.06, winDark, xc, 1.25, fz + face * 0.04, { cast: false });
      box(w - 0.8, 0.12, 0.1, winFrame, xc, 2.4, fz + face * 0.05, { cast: false });
    }
  };
  block(X1 + WT, 14, -14, PZ0, 8.4, 0xb59a86, 1, ["#6a2e2a", "BOOKS"]);
  block(14, 24, -14, PZ0, 11.5, 0xc7b6a0, 1, ["#2d3f5a", "FLOWERS"]);
  block(-14, X0 - WT, -14, PZ0, 9.6, 0xa88a74, 1, ["#3a3a3a", "BAKERY"]);
  block(-26, -14, -14, PZ0, 12.5, 0xcbbca8, 1, null);
  // the cafe's own floors above, so the frame is a real building from outside (cut away with the ceiling)
  const upper = box(X1 - X0 + 2 * WT, 5.6, DEPTH + 2 * WT, surf(BRICK, 12.4, 5.6, 2.2, { color: 0xbfa28c }), 0, H + 0.16 + 2.8, ZC);
  upper.userData.mat = upper.material; sides.ceiling.push(upper);
  const upperWin = [];
  for (let c = 0; c < 4; c++) { const wx = -4.5 + c * 3;
    upperWin.push(box(1.3, 1.7, 0.06, winFrame, wx, 5.0, Z1 + WT + 0.03, { cast: false }), box(1.12, 1.52, 0.06, winDark, wx, 5.0, Z1 + WT + 0.05, { cast: false })); }
  decor.ceiling.push(...upperWin);
  // the row opposite
  let ox = -40; const tones = [0xb7a08c, 0xcfc0ad, 0x9d8571, 0xc2b29e, 0xab9a88, 0xd2c2b0];
  const shops = [["#2f4f3e", "MARKET"], ["#7a3b2a", "PIZZA"], ["#24324a", "BARBER"], ["#5a4a2a", "DELI"], ["#3f2f4f", "RECORDS"], ["#2a4a4f", "PHARMACY"]];
  let bi = 0;
  while (ox < 40) { const w = 8 + rr(0, 6), h = 9 + Math.floor(rr(0, 4)) * 3.1;
    block(ox, ox + w, OZ, OZ + 12, h, tones[bi % tones.length], -1, shops[bi % shops.length]); ox += w + 0.2; bi++; }
  // far trees on the opposite pavement
  for (const tx of [-20, -6, 8, 22]) { const tz = RZ1 + 1.4; add(new THREE.CylinderGeometry(0.1, 0.15, 3.4, 8), bark, tx, 1.7, tz);
    for (let k = 0; k < 6; k++) add(new THREE.IcosahedronGeometry(rr(0.8, 1.2), 1), k % 2 ? leafA : leafB, tx + rr(-0.8, 0.8), 3.6 + rr(0, 1.4), tz + rr(-0.7, 0.7)); }

  // ---------------------------------------------------------------- the back counter on the north wall
  const BZ = Z0 + 0.6, BH = 0.9, BX0 = X0, BX1 = 1.6;
  box(BX1 - BX0, 0.1, 0.52, std({ color: 0x2a2624, roughness: 0.8 }), (BX0 + BX1) / 2, 0.05, Z0 + 0.26);
  box(BX1 - BX0, BH - 0.14, 0.58, std({ color: 0x3a3430, roughness: 0.7 }), (BX0 + BX1) / 2, 0.1 + (BH - 0.14) / 2, Z0 + 0.29);
  const sage = std({ color: 0x4f6656, roughness: 0.6 });
  for (let x = BX0 + 0.02; x < BX1 - 0.3; x += 0.6) {
    const isFridge = x > -2.4 && x < -0.9;
    box(0.58, BH - 0.18, 0.02, isFridge ? steel : sage, x + 0.29, 0.1 + (BH - 0.18) / 2 + 0.02, BZ - 0.01);
    if (isFridge) box(0.5, 0.5, 0.006, blackGlass, x + 0.29, 0.5, BZ + 0.002, { cast: false });
    box(0.22, 0.014, 0.014, darkMetal, x + 0.29, BH - 0.14, BZ + 0.012, { cast: false });
  }
  box(BX1 - BX0, 0.04, 0.64, stone(7.6, 0.64), (BX0 + BX1) / 2, BH - 0.02, Z0 + 0.32);
  // tiles from the back counter up to 1.5 m
  const tileMat = (w, h) => { const m = std({ map: tileTex.clone(), bumpMap: tileBump.clone(), bumpScale: 1.2, roughness: 0.2, color: 0xffffff });
    for (const t of [m.map, m.bumpMap]) { t.repeat.set(w / 1.2, h / 1.2); t.needsUpdate = true; } return m; };
  decor.north.push(box(BX1 - BX0, 0.6, 0.01, tileMat(BX1 - BX0, 0.6), (BX0 + BX1) / 2, BH + 0.3, Z0 + 0.005, { cast: false }));
  // on the back counter: a drip brewer, syrup bottles, a cup tower, a milk jug, a small sink
  const brewer = new THREE.Group(); brewer.position.set(-5.3, BH, Z0 + 0.32); scene.add(brewer);
  box(0.3, 0.5, 0.32, darkMetal, 0, 0.25, -0.04, { parent: brewer }); box(0.3, 0.06, 0.38, darkMetal, 0, 0.47, 0.03, { parent: brewer });
  add(new THREE.CylinderGeometry(0.08, 0.09, 0.2, 20), new THREE.MeshPhysicalMaterial({ color: 0x3a2214, roughness: 0.1, transparent: true, opacity: 0.85 }), 0, 0.1, 0.1, { parent: brewer });
  const syrupCols = [0x8a4a1a, 0xc2903a, 0x6a1f2a, 0x3a5a2a, 0xd8c8a8];
  syrupCols.forEach((c, i) => { const b = new THREE.Group(); b.position.set(-4.75 + i * 0.12, BH, Z0 + 0.15); scene.add(b);
    add(lathe([[0, 0], [0.035, 0], [0.035, 0.22], [0.016, 0.27], [0.014, 0.3], [0, 0.3]], 18), new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.08, transparent: true, opacity: 0.85 }), 0, 0, 0, { parent: b });
    cyl(0.01, 0.01, 0.06, darkMetal, 0, 0.33, 0, { parent: b }, 8); });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) cup(-3.9 + i * 0.13, BH + j * 0.075, Z0 + 0.3, { saucer: false, full: false });
  const sinkX = 0.5;
  box(0.5, 0.01, 0.4, steel, sinkX, BH + 0.002, Z0 + 0.34, { cast: false });
  cyl(0.014, 0.014, 0.3, steel, sinkX, BH + 0.15, Z0 + 0.1); const tapN = add(new THREE.TorusGeometry(0.08, 0.012, 8, 20, PI), steel, sinkX, BH + 0.3, Z0 + 0.18); tapN.rotation.y = PI / 2;
  add(lathe([[0, 0], [0.05, 0], [0.055, 0.12], [0.045, 0.16], [0.05, 0.17], [0, 0.17]], 20), steel, -0.4, BH, Z0 + 0.3);
  // open oak shelves of cups and jars either side of the menu board
  const shelfRun = (x0, x1, ys) => {
    for (const y of ys) {
      decor.north.push(box(x1 - x0, 0.04, 0.26, oak, (x0 + x1) / 2, y, Z0 + 0.13));
      for (const bx of [x0 + 0.15, x1 - 0.15]) decor.north.push(box(0.02, 0.12, 0.2, darkMetal, bx, y - 0.08, Z0 + 0.1, { cast: false }));
      let x = x0 + 0.12;
      while (x < x1 - 0.12) {
        const k = rnd();
        if (k < 0.45) { const n = 2 + Math.floor(rnd() * 3); for (let j = 0; j < n; j++) decor.north.push(cup(x, y + 0.02 + j * 0.075, Z0 + 0.13, { saucer: false, full: false, color: j % 2 && rnd() < 0.5 ? 0x34506a : 0xf5f2ec })); x += 0.13; }
        else if (k < 0.75) { const jh = rr(0.14, 0.22);
          decor.north.push(add(new THREE.CylinderGeometry(0.055, 0.055, jh, 20), new THREE.MeshPhysicalMaterial({ color: 0xe8efe9, roughness: 0.05, transparent: true, opacity: 0.35 }), x, y + 0.02 + jh / 2, Z0 + 0.13));
          decor.north.push(cyl(0.05, 0.05, jh * 0.7, std({ color: [0x3a2214, 0x5a3a20, 0xd9c08a][Math.floor(rnd() * 3)], roughness: 0.9 }), x, y + 0.02 + jh * 0.35, Z0 + 0.13, { cast: false }, 16));
          decor.north.push(cyl(0.058, 0.058, 0.025, oak, x, y + 0.02 + jh + 0.012, Z0 + 0.13, {}, 20)); x += 0.15; }
        else { decor.north.push(place(fit(P.potted_plant_02.clone(), 0.24), x + 0.03, y + 0.02, Z0 + 0.13, rr(0, 6))); x += 0.22; }
      }
    }
  };
  shelfRun(-5.85, -4.25, [1.75, 2.2]); shelfRun(-0.75, 1.5, [1.75, 2.2]);
  // the chalk menu board in an oak frame
  const menuBoard = new THREE.Group(); menuBoard.position.set(-2.5, 2.15, Z0 + 0.03); scene.add(menuBoard);
  box(3.12, 1.42, 0.05, darkOak, 0, 0, 0, { parent: menuBoard, cast: false });
  add(new THREE.PlaneGeometry(3.0, 1.3), std({ map: menuTex, roughness: 0.9 }), 0, 0, 0.027, { parent: menuBoard, cast: false });
  decor.north.push(menuBoard);
  // a picture light over the board
  const boardLight = new THREE.SpotLight(0xffe8c8, 6, 4, 0.9, 0.6, 2); boardLight.position.set(-2.5, 3.0, Z0 + 0.6); boardLight.target.position.set(-2.5, 2.0, Z0); scene.add(boardLight, boardLight.target);

  // ---------------------------------------------------------------- the counter
  const CX0 = -5.0, CX1 = 1.6, CZ0 = -3.0, CZ1 = -2.4, CT = 1.02, CXC = (CX0 + CX1) / 2;
  box(CX1 - CX0 - 0.1, 0.1, CZ1 - CZ0 - 0.1, std({ color: 0x241f1c }), CXC, 0.05, (CZ0 + CZ1) / 2 - 0.03);
  box(CX1 - CX0, CT - 0.14, CZ1 - CZ0 - 0.04, std({ color: 0x3a3430, roughness: 0.7 }), CXC, 0.1 + (CT - 0.14) / 2, (CZ0 + CZ1) / 2);
  for (let x = CX0 + 0.02; x < CX1 - 0.02; x += 0.07) box(0.055, CT - 0.06, 0.025, oak, x + 0.0275, (CT - 0.06) / 2 + 0.02, CZ1 + 0.005);   // oak slats
  for (const s of [CX0 - 0.012, CX1 + 0.012]) box(0.025, CT - 0.04, CZ1 - CZ0, oak, s, (CT - 0.04) / 2, (CZ0 + CZ1) / 2);
  box(CX1 - CX0 + 0.08, 0.05, CZ1 - CZ0 + 0.1, stone(6.7, 0.7), CXC, CT - 0.025, (CZ0 + CZ1) / 2 + 0.02);
  // a brass foot rail along the customer side
  const rail = cyl(0.022, 0.022, CX1 - CX0 - 0.3, brass, CXC, 0.2, CZ1 + 0.17, {}, 14); rail.rotation.z = PI / 2;
  for (let x = CX0 + 0.3; x < CX1 - 0.2; x += 1.3) { cyl(0.012, 0.012, 0.2, brass, x, 0.1, CZ1 + 0.17, {}, 10); const br = cyl(0.012, 0.012, 0.17, brass, x, 0.2, CZ1 + 0.085, {}, 10); br.rotation.x = PI / 2; }

  // espresso machine: polished steel, two group heads facing the barista (north), cups warming on top
  const espresso = new THREE.Group(); espresso.position.set(-3.4, CT, (CZ0 + CZ1) / 2); espresso.rotation.y = PI; scene.add(espresso);
  const red = std({ color: 0x8e1f1c, roughness: 0.3, metalness: 0.3 });
  box(0.78, 0.36, 0.5, steel, 0, 0.24, -0.02, { parent: espresso });
  box(0.8, 0.06, 0.52, darkMetal, 0, 0.03, -0.02, { parent: espresso });
  box(0.78, 0.12, 0.04, red, 0, 0.32, 0.235, { parent: espresso });               // coloured front panel
  box(0.78, 0.12, 0.04, red, 0, 0.32, -0.275, { parent: espresso });              // and the same on the customer side
  box(0.8, 0.02, 0.52, steel, 0, 0.43, -0.02, { parent: espresso });
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) box(0.012, 0.035, 0.46, steel, s * 0.38, 0.465, -0.02 + 0 * i, { parent: espresso, cast: false });
  box(0.012, 0.035, 0.76, steel, 0, 0.465, 0.21, { parent: espresso, cast: false }).rotation.y = PI / 2;
  box(0.012, 0.035, 0.76, steel, 0, 0.465, -0.25, { parent: espresso, cast: false }).rotation.y = PI / 2;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) cup(-0.28 + i * 0.14, 0.44, -0.12 + j * 0.15, { saucer: false, full: false, parent: espresso });
  box(0.7, 0.03, 0.18, steel, 0, 0.075, 0.33, { parent: espresso });              // drip tray
  for (const gx of [-0.2, 0.2]) {
    cyl(0.05, 0.055, 0.07, steel, gx, 0.2, 0.27, { parent: espresso }, 20);        // group head
    cyl(0.045, 0.04, 0.03, darkMetal, gx, 0.155, 0.29, { parent: espresso }, 20);  // portafilter basket
    const handle = cyl(0.014, 0.018, 0.16, darkMetal, gx, 0.155, 0.39, { parent: espresso }, 10); handle.rotation.x = PI / 2;
    add(new THREE.CircleGeometry(0.035, 20), std({ color: 0xf6f3ea, roughness: 0.3 }), gx, 0.32, 0.257, { parent: espresso, cast: false });   // gauge
    cup(gx, 0.09, 0.3, { saucer: false, parent: espresso });
  }
  const wand = cyl(0.007, 0.007, 0.24, steel, 0.34, 0.2, 0.3, { parent: espresso }, 8); wand.rotation.x = 0.25;
  // grinder: a dark body with a smoked bean hopper
  const grinder = new THREE.Group(); grinder.position.set(-2.62, CT, (CZ0 + CZ1) / 2); grinder.rotation.y = PI; scene.add(grinder);
  box(0.18, 0.36, 0.26, darkMetal, 0, 0.18, 0, { parent: grinder });
  box(0.14, 0.02, 0.12, steel, 0, 0.06, 0.12, { parent: grinder });
  add(lathe([[0, 0], [0.04, 0], [0.11, 0.2], [0.1, 0.21], [0, 0.21]], 24), new THREE.MeshPhysicalMaterial({ color: 0x3a2a20, roughness: 0.15, transparent: true, opacity: 0.75 }), 0, 0.36, 0, { parent: grinder });
  cyl(0.06, 0.06, 0.06, std({ color: 0x2a1a10, roughness: 0.9 }), 0, 0.42, 0, { parent: grinder }, 16);
  // the till: a tablet on a stand facing the barista, a card reader, a tip jar on the customer side
  const till = new THREE.Group(); till.position.set(-1.45, CT, (CZ0 + CZ1) / 2); scene.add(till);
  cyl(0.06, 0.07, 0.02, darkMetal, 0, 0.01, -0.05, { parent: till }); cyl(0.015, 0.015, 0.2, darkMetal, 0, 0.1, -0.05, { parent: till }, 10);
  const tab = box(0.3, 0.21, 0.012, darkMetal, 0, 0.27, -0.05, { parent: till }); tab.rotation.x = 0.35;
  const scr = add(new THREE.PlaneGeometry(0.27, 0.18), std({ color: 0x0a1a24, emissive: 0x9fd0ff, emissiveIntensity: 0.35 }), 0, 0.27, -0.058, { parent: till, cast: false }); scr.rotation.set(0.35, PI, 0);
  box(0.07, 0.025, 0.13, darkMetal, 0.25, 0.012, 0.12, { parent: till });
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 20), new THREE.MeshPhysicalMaterial({ color: 0xeef4f2, roughness: 0.05, transparent: true, opacity: 0.3 }), -0.25, 0.07, 0.15, { parent: till });
  // cup stacks and lids at the counter's west end, a vase of flowers
  for (let s = 0; s < 3; s++) for (let j = 0; j < 6; j++) { const c = add(lathe([[0, 0], [0.03, 0], [0.042, 0.11], [0.04, 0.11], [0.028, 0.004], [0, 0.004]], 18), std({ color: s === 1 ? 0x2e4a3a : 0xf0ebe0, roughness: 0.6 }), -4.75 + s * 0.12, CT + j * 0.02, -2.6); }
  const vase = place(fit(P.ceramic_vase_01, 0.22), -4.2, CT, -2.62, 0);
  for (let i = 0; i < 5; i++) { const st = cyl(0.003, 0.003, 0.28, std({ color: 0x4f6b3a }), -4.2 + rr(-0.03, 0.03), CT + 0.34, -2.62 + rr(-0.03, 0.03), { cast: false }, 6); st.rotation.set(rr(-0.3, 0.3), 0, rr(-0.3, 0.3));
    add(new THREE.SphereGeometry(0.03, 10, 8), std({ color: [0xf1ede2, 0xe8a0a0, 0xf0d070][i % 3], roughness: 0.8 }), st.position.x - st.rotation.z * 0.14, CT + 0.48, st.position.z + st.rotation.x * 0.14, { cast: false }); }

  // the pastry case: a glass box on the counter, two shelves of baking, lit from inside
  const PCX0 = -0.4, PCX1 = 1.4, PCW = PCX1 - PCX0, PCXC = (PCX0 + PCX1) / 2, PCD = 0.5, PCH = 0.52, PZc = (CZ0 + CZ1) / 2;
  const pastryCase = new THREE.Group(); pastryCase.position.set(PCXC, CT, PZc); scene.add(pastryCase);
  box(PCW, 0.05, PCD, darkMetal, 0, 0.025, 0, { parent: pastryCase });
  box(PCW, 0.03, PCD, darkMetal, 0, PCH, 0, { parent: pastryCase });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.025, PCH, 0.025, darkMetal, sx * (PCW / 2 - 0.012), PCH / 2, sz * (PCD / 2 - 0.012), { parent: pastryCase });
  for (const [w, h, x, y, z, ry] of [[PCW, PCH - 0.05, 0, PCH / 2 + 0.01, PCD / 2, 0], [PCD, PCH - 0.05, -PCW / 2, PCH / 2 + 0.01, 0, PI / 2], [PCD, PCH - 0.05, PCW / 2, PCH / 2 + 0.01, 0, PI / 2]]) {
    const gp = add(new THREE.PlaneGeometry(w, h), caseGlass, x, y, z, { parent: pastryCase, cast: false, receive: false }); gp.rotation.y = ry; }
  const shelfGlass = new THREE.MeshPhysicalMaterial({ color: 0xdfe8e6, roughness: 0.1, transparent: true, opacity: 0.4 });
  box(PCW - 0.05, 0.012, PCD - 0.05, shelfGlass, 0, 0.27, 0, { parent: pastryCase, cast: false });
  const caseLight = new THREE.PointLight(0xfff0d8, 0.9, 1.6, 2); caseLight.position.set(0, PCH - 0.06, 0); pastryCase.add(caseLight);
  add(new THREE.PlaneGeometry(PCW - 0.1, 0.02), std({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 2 }), 0, PCH - 0.016, 0, { parent: pastryCase, cast: false }).rotation.x = PI / 2;
  // lower shelf: croissants on two trays, muffins
  const tray = std({ color: 0x2c2a28, roughness: 0.5, metalness: 0.4 });
  for (const tx of [-0.6, -0.12]) box(0.42, 0.01, 0.34, tray, tx, 0.055, 0, { parent: pastryCase, cast: false });
  for (const [tx, tz, ry] of [[-0.7, -0.08, 0.2], [-0.5, -0.08, -0.3], [-0.7, 0.09, -0.1], [-0.5, 0.09, 0.4], [-0.22, -0.08, 0.1], [-0.02, -0.08, -0.2], [-0.22, 0.09, 0.3], [-0.02, 0.09, 0]])
    croissant(tx, 0.06, tz, ry, pastryCase);
  const muffinCase = std({ color: 0x8a5a2a, roughness: 0.8 }), muffinTop = std({ color: 0x6a3f20, roughness: 0.85 }), blueberryTop = std({ color: 0xb08050, roughness: 0.85 });
  for (let i = 0; i < 6; i++) { const mx = 0.28 + (i % 3) * 0.13, mz = i < 3 ? -0.08 : 0.09;
    cyl(0.04, 0.032, 0.05, muffinCase, mx, 0.08, mz, { parent: pastryCase }, 16);
    const top = add(new THREE.SphereGeometry(0.048, 16, 10, 0, 2 * PI, 0, PI / 2), i % 2 ? muffinTop : blueberryTop, mx, 0.105, mz, { parent: pastryCase }); top.scale.y = 0.75; }
  // upper shelf: a cake with a slice out, doughnuts, cookies
  const sponge = std({ color: 0xe8cf9a, roughness: 0.8 }), frosting = std({ color: 0xf5ede0, roughness: 0.6 }), choc = std({ color: 0x4a2a18, roughness: 0.6 });
  const cake = new THREE.Group(); cake.position.set(-0.55, 0.28, 0); pastryCase.add(cake);
  cyl(0.15, 0.15, 0.01, ceramic, 0, 0.005, 0, { parent: cake }, 32);
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 32, 1, false, 0.5, 2 * PI - 0.8), sponge, 0, 0.06, 0, { parent: cake });
  add(new THREE.CylinderGeometry(0.122, 0.122, 0.015, 32, 1, false, 0.5, 2 * PI - 0.8), choc, 0, 0.115, 0, { parent: cake });
  const donutMat = [std({ color: 0xd9a0b0, roughness: 0.5 }), choc, frosting];
  for (let i = 0; i < 6; i++) { const d = add(new THREE.TorusGeometry(0.038, 0.02, 10, 20), sponge, -0.15 + (i % 3) * 0.11, 0.305, i < 3 ? -0.08 : 0.09, { parent: pastryCase }); d.rotation.x = PI / 2;
    const icing = add(new THREE.TorusGeometry(0.038, 0.021, 10, 20, PI * 2), donutMat[i % 3], d.position.x, 0.312, d.position.z, { parent: pastryCase }); icing.rotation.x = PI / 2; icing.scale.z = 0.6; }
  for (let i = 0; i < 8; i++) cyl(0.04, 0.04, 0.012, std({ color: i % 2 ? 0xb9864a : 0x8a5a30, roughness: 0.9 }), 0.3 + (i % 4) * 0.1, 0.29 + Math.floor(i / 4) * 0.014, (i % 2 ? 0.06 : -0.06) * 0.5, { parent: pastryCase }, 16);

  // pendant lamps over the counter: glass globes from the library on cords
  const lamps = [], lampGlow = [];
  const glowMat = std({ color: 0xffffff, emissive: 0xffdcaa, emissiveIntensity: 3 });
  const lampSrc = fit(P.modern_ceiling_lamp_01, 0.34, "w"), lampH = lampSrc.userData.size.y, LB = 1.95;
  for (const x of [-4.1, -2.7, -1.3, 0.3]) {
    const lz = (CZ0 + CZ1) / 2 - 0.05;
    const lamp = lampSrc.clone(); place(lamp, x, LB, lz, 0); lamp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const top = LB + lampH; if (top < H) cyl(0.004, 0.004, H - top, darkMetal, x, (top + H) / 2, lz, { cast: false }, 6);
    decor.ceiling.push(cyl(0.05, 0.05, 0.02, darkMetal, x, H - 0.01, lz, { cast: false }));
    lampGlow.push(add(new THREE.SphereGeometry(0.035, 12, 10), glowMat, x, LB + Math.min(0.08, lampH * 0.3), lz, { cast: false, receive: false }));
    const pl = new THREE.PointLight(0xffd2a0, 2.2, 0, 2); pl.position.set(x, LB - 0.05, lz); scene.add(pl); lamps.push(pl);
  }

  // ---------------------------------------------------------------- tables and chairs
  const chairSrc = fit(P.dining_chair_02, 0.92);
  const chairs = [], tables = [];
  const bistro = (x, z, r, h, { topMat = marble } = {}) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    cyl(r * 0.62, r * 0.7, 0.03, darkMetal, 0, 0.015, 0, { parent: g }, 28);           // cast iron foot
    cyl(0.03, 0.035, h - 0.06, darkMetal, 0, (h - 0.06) / 2 + 0.03, 0, { parent: g }, 14);
    cyl(0.1, 0.06, 0.04, darkMetal, 0, h - 0.06, 0, { parent: g }, 16);
    const t = cyl(r, r, 0.03, topMat, 0, h - 0.015, 0, { parent: g }, 40);
    cyl(r + 0.004, r + 0.004, 0.012, brass, 0, h - 0.03, 0, { parent: g }, 40);       // a brass band round the edge
    tables.push({ x, z, top: h, r, group: g });
    return g;
  };
  const chair = (x, z, ry) => { const c = chairSrc.clone(); place(c, x, 0, z, ry); chairs.push(c); return c; };
  const TH = 0.75;
  const middle = [[-4.2, 0.9], [-1.4, 0.9], [1.4, 0.9]];
  middle.forEach(([x, z], i) => {
    bistro(x, z, 0.36, TH);
    chair(x - 0.62, z + (i === 1 ? 0.06 : -0.04), PI / 2 + (i - 1) * 0.12);
    chair(x + 0.62, z + (i === 0 ? 0.05 : 0.0), -PI / 2 - (i - 1) * 0.1);
  });
  // what is on the middle tables
  cup(-4.2 - 0.12, TH, 0.85); cup(-4.2 + 0.14, TH, 0.96, { color: 0x34506a });
  const plate = (x, y, z) => add(plateGeo, ceramic, x, y, z);
  plate(-1.4, TH, 0.8); croissant(-1.4, TH + 0.006, 0.8, 0.6); cup(-1.4 + 0.15, TH, 1.0);
  cup(1.4 - 0.1, TH, 0.95, { color: 0xc96a3a }); plate(1.4 + 0.12, TH, 0.82);
  const laptop = new THREE.Group(); laptop.position.set(1.4 + 0.12, TH, 0.85); laptop.rotation.y = -PI / 2; scene.add(laptop);
  box(0.32, 0.015, 0.22, std({ color: 0xa8aab0, roughness: 0.35, metalness: 0.8 }), 0, 0.012, 0, { parent: laptop });
  const lid = box(0.32, 0.21, 0.01, std({ color: 0xa8aab0, roughness: 0.35, metalness: 0.8 }), 0, 0.12, -0.12, { parent: laptop }); lid.rotation.x = -0.25;
  // and a small sugar pot on each
  for (const [x, z] of middle) cyl(0.03, 0.03, 0.07, steel, x + 0.05, TH + 0.035, z - 0.18, {}, 16);

  // the window bench: an oak box seat with cushions, the street window behind it
  const BEX0 = -5.8, BEX1 = 4.3, BEZ0 = 3.95, BEZ1 = Z1, BEH = 0.42;
  box(BEX1 - BEX0, BEH, BEZ1 - BEZ0, oak, (BEX0 + BEX1) / 2, BEH / 2, (BEZ0 + BEZ1) / 2);
  box(BEX1 - BEX0, 0.06, 0.02, darkOak, (BEX0 + BEX1) / 2, 0.06, BEZ0 - 0.01, { cast: false });
  const cushion = (col) => { const m = surf(SAND, 1, 1, 0.3, { color: col, roughness: 1 }); m.map = null; m.normalScale = new THREE.Vector2(0.5, 0.5); return m; };
  const cushA = cushion(0x6b7f6a), cushB = cushion(0xc9b89a), cushC = cushion(0x9a4a3a);
  const nSeat = 5, segW = (BEX1 - BEX0) / nSeat;
  for (let i = 0; i < nSeat; i++) {
    const x = BEX0 + segW * (i + 0.5);
    const s = add(new THREE.BoxGeometry(segW - 0.03, 0.08, BEZ1 - BEZ0 - 0.04, 2, 1, 2), cushA, x, BEH + 0.04, (BEZ0 + BEZ1) / 2 + 0.01); s.scale.y = 0.95;
    const back = box(segW - 0.1, 0.4, 0.12, i % 2 ? cushB : cushA, x, BEH + 0.28, BEZ1 - 0.1); back.rotation.x = -0.12;
    if (i % 2 === 0) { const p = box(0.36, 0.34, 0.12, cushC, x + rr(-0.5, 0.5), BEH + 0.25, BEZ1 - 0.22); p.rotation.set(-0.2, rr(-0.3, 0.3), rr(-0.15, 0.15)); }
  }
  const windowTables = [-4.6, -2.4, -0.2, 2.0];
  windowTables.forEach((x, i) => {
    bistro(x, 3.42, 0.3, 0.74);
    chair(x + (i % 2 ? 0.04 : -0.05), 2.82, (i % 2 ? 0.08 : -0.1));
  });
  cup(-4.6 + 0.08, 0.74, 3.4); cup(-2.4 - 0.1, 0.74, 3.36, { color: 0x34506a }); cup(-2.4 + 0.1, 0.74, 3.48);
  plate(-0.2, 0.74, 3.4); add(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 3, 1, false, 0, PI / 3), sponge, -0.2, 0.74 + 0.04, 3.4).rotation.y = 0.4;
  cup(2.0 - 0.06, 0.74, 3.44, { color: 0xc96a3a });
  const book = box(0.16, 0.03, 0.23, std({ color: 0x2f4a6a, roughness: 0.8 }), 2.12, 0.74 + 0.015, 3.36); book.rotation.y = 0.3;

  // reading corner by the east wall: an armchair and a side table with a lamp
  const arm = place(fit(P.ArmChair_01, 0.98), 3.65, 0, 0.5, -PI / 2 - 0.25);
  const side = place(fit(P.side_table_01, 0.55), 3.75, 0, 1.45, 0.1);
  cup(3.72, 0.55, 1.42, { color: 0x34506a });

  // ---------------------------------------------------------------- dome pendants over the middle tables
  const shadeGeo = lathe([[0.005, 0.22], [0.03, 0.22], [0.05, 0.2], [0.14, 0.1], [0.19, 0.0], [0.185, -0.005], [0.135, 0.095], [0.045, 0.19], [0.005, 0.2]], 32);
  const shadeMat = std({ color: 0x1e2b25, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  for (const [x, z] of middle) {
    const y = 2.0;
    add(shadeGeo, shadeMat, x, y, z, { cast: false });
    lampGlow.push(add(new THREE.SphereGeometry(0.05, 14, 10), glowMat, x, y + 0.08, z, { cast: false, receive: false }));
    cyl(0.004, 0.004, H - y - 0.22, darkMetal, x, (H + y + 0.22) / 2, z, { cast: false }, 6);
    decor.ceiling.push(cyl(0.05, 0.05, 0.02, darkMetal, x, H - 0.01, z, { cast: false }));
    const pl = new THREE.PointLight(0xffd2a0, 2.6, 0, 2); pl.position.set(x, y + 0.02, z); scene.add(pl); lamps.push(pl);
  }

  // ---------------------------------------------------------------- east wall: oak shelves of cups and plants, a clock
  const EX = X1;
  for (const y of [1.35, 1.75, 2.15]) {
    decor.east.push(box(0.26, 0.04, 2.6, oak, EX - 0.13, y, -0.3));
    for (const bz of [-1.4, 0.8]) decor.east.push(box(0.2, 0.12, 0.02, darkMetal, EX - 0.1, y - 0.08, bz, { cast: false }));
    let z = -1.5;
    while (z < 0.9) {
      const k = rnd();
      if (k < 0.4) { const n = 1 + Math.floor(rnd() * 3); for (let j = 0; j < n; j++) decor.east.push(cup(EX - 0.13, y + 0.02 + j * 0.075, z, { saucer: false, full: false, color: [0xf5f2ec, 0x34506a, 0xc96a3a][Math.floor(rnd() * 3)] })); z += 0.14; }
      else if (k < 0.7) { decor.east.push(place(fit(P.potted_plant_02.clone(), rr(0.24, 0.3)), EX - 0.13, y + 0.02, z + 0.05, rr(0, 6))); z += 0.3; }
      else { const bag = add(new THREE.BoxGeometry(0.09, 0.2, 0.13), std({ map: bagTex(["#7a4a2a", "#2f4a3a", "#8a2f2f", "#c9a24a"][Math.floor(rnd() * 4)], "BEANS"), roughness: 0.7 }), EX - 0.13, y + 0.12, z);
        bag.rotation.y = -PI / 2; decor.east.push(bag); z += 0.16; }
    }
  }
  const clock = place(fit(P.wall_clock, 0.42, "w"), EX - 0.03, 2.55, -0.3, -PI / 2); decor.east.push(clock);
  clock.rotation.set(0, -PI / 2, 0);
  // the display shelf of coffee bags against the north wall, east of the counter, and a tall plant in the corner
  const disp = place(fit(P.wooden_display_shelves_01, 1.6), 3.3, 0, Z0 + 0.22, PI / 2);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
    const bag = add(new THREE.BoxGeometry(0.13, 0.2, 0.08), std({ map: bagTex(["#7a4a2a", "#2f4a3a", "#8a2f2f", "#c9a24a"][(i + r) % 4], "BEANS"), roughness: 0.7 }),
      3.3 - 0.39 + i * 0.26, 0, Z0 + 0.25);
    bag.userData.row = r; bag.visible = false; decor.north.push(bag); disp.userData[`bag${r}${i}`] = bag;
  }
  const plantNE = place(fit(P.potted_plant_01.clone(), 1.5), 5.35, 0, Z0 + 0.5, 0.8);
  const plantNW = place(fit(P.potted_plant_01.clone(), 1.3), -5.45, 0, -1.9, 2.1);
  const plantSE = place(fit(P.potted_plant_02.clone(), 0.75), 5.55, 0, 2.7, 1.2);

  // the display shelf's rows: put the bags on whatever surfaces the model has (found by casting down)
  {
    disp.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
      const bag = disp.userData[`bag${r}${i}`], from = new V3(bag.position.x, [1.55, 1.05, 0.62][r], Z0 + 0.25);
      ray.set(from, new V3(0, -1, 0)); ray.far = 0.45;
      const hit = ray.intersectObject(disp, true)[0];
      if (hit && hit.point.y > 0.15) { bag.position.y = hit.point.y + 0.1; bag.visible = true; }
    }
  }

  // ---------------------------------------------------------------- west wall: prints and a mirror on the brick
  const frameDark = std({ color: 0x1d1a17, roughness: 0.5 });
  const print = (side, x, y, z, ry, w, h, palette) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
    box(w + 0.05, h + 0.05, 0.03, frameDark, 0, 0, 0, { parent: g, cast: false });
    box(w - 0.02, h - 0.02, 0.005, paintWhite, 0, 0, 0.016, { parent: g, cast: false });
    add(new THREE.PlaneGeometry(w - 0.12, h - 0.12), std({ map: artTex(palette), roughness: 0.8 }), 0, 0, 0.02, { parent: g, cast: false });
    decor[side].push(g); return g;
  };
  print("west", X0 + 0.02, 1.75, -0.6, PI / 2, 0.7, 0.9, ["#efe7d8", "#d2763f", "#33536a", "#e2b85b"]);
  print("west", X0 + 0.02, 1.85, 0.6, PI / 2, 0.5, 0.65, ["#e7e2d6", "#3f5e4d", "#c05a43", "#1f2a3a"]);
  print("west", X0 + 0.02, 1.7, 2.0, PI / 2, 0.9, 0.65, ["#ece5d8", "#28405a", "#c99350", "#8a3a30", "#e9cf92"]);
  print("east", X1 - 0.02, 1.7, 2.3, -PI / 2, 0.6, 0.8, ["#f0e6d4", "#5a7a5a", "#d9a24a", "#2a3a4a"]);
  // a slim wall light pair on the brick
  for (const z of [-1.6, 1.3]) { decor.west.push(box(0.08, 0.14, 0.08, brass, X0 + 0.05, 2.45, z));
    decor.west.push(add(new THREE.SphereGeometry(0.06, 14, 10), glowMat, X0 + 0.12, 2.55, z, { cast: false })); }

  // ---------------------------------------------------------------- the cast
  const castMap = {}, gait = {}, bones = {};
  const findBone = (o, re) => { let b = null; o.traverse((x) => { if (!b && x.isBone && re.test(x.name)) b = x; }); return b; };
  const measure = (f, key) => {
    bones[key] = { head: findBone(f.object, /Head$/), hips: findBone(f.object, /Hips$/), leftFoot: findBone(f.object, /LeftFoot$/), rightFoot: findBone(f.object, /RightFoot$/) };
    const speed = (name) => {
      if (!f.actions[name] || !bones[key].leftFoot) return name === "run" ? 3.2 : 1.35;
      const T = f.durations[name]; let lo = 1e9, hi = -1e9;
      f.object.position.set(0, 0, 0); f.object.rotation.set(0, 0, 0);
      for (let k = 0; k <= 48; k++) { f.pose((k / 48) * T, { [name]: 1 }); f.object.updateMatrixWorld(true);
        const z = bones[key].leftFoot.getWorldPosition(new V3()).z; lo = Math.min(lo, z); hi = Math.max(hi, z); }
      return (2 * (hi - lo)) / T;
    };
    return { walk: speed("walk"), run: speed("run") };
  };
  figures.forEach((f, i) => {
    const key = keys[i]; castMap[key] = f; scene.add(f.object);
    f.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    gait[key] = measure(f, key);
    f.pose(0, f.actions.idle ? "idle" : undefined);
  });
  if (keys.length) { gait.walk = gait[keys[0]].walk; gait.run = gait[keys[0]].run; }

  // the background people
  const extraMap = {};
  EXTRA_DEFS.forEach((e, i) => {
    const f = extraFigs[i]; extraMap[e.key] = f; scene.add(f.object);
    f.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (e.key === "walker") gait.__walker = measure(f, "__walker").walk;
  });
  // the walker goes from the door up the east aisle (x 5.05) to the counter's end and back, turning at each end
  const WK = { x: 5.05, zA: 3.55, zB: -1.65, r: 0.45, turn: 1.3 };
  const wkLen = WK.zA - WK.zB;
  const walkerAt = (t) => {
    const v = gait.__walker || 1.35, Tw = wkLen / v + WK.r, cyc = 2 * (Tw + WK.turn);
    let u = ((t % cyc) + cyc) % cyc; const lap = Math.floor(t / cyc);
    const legDist = (s) => (s < WK.r ? (v * s * s) / (2 * WK.r) : s < Tw - WK.r ? v * (s - WK.r / 2) : wkLen - (v * (Tw - s) ** 2) / (2 * WK.r));
    const wOf = (s) => Math.max(0, Math.min(1, s / WK.r, (Tw - s) / WK.r));
    const base = lap * 2 * wkLen;   // distance walked in earlier laps (keeps the stride clock running)
    if (u < Tw) { const d = legDist(u); return { z: WK.zA - d, heading: PI, walk: wOf(u), dist: base + d }; }
    u -= Tw;
    if (u < WK.turn) { const k = u / WK.turn, e = k * k * (3 - 2 * k); return { z: WK.zB, heading: PI + e * PI, walk: 0, dist: base + wkLen }; }
    u -= WK.turn;
    if (u < Tw) { const d = legDist(u); return { z: WK.zB + d, heading: 0, walk: wOf(u), dist: base + wkLen + d }; }
    u -= Tw; const k = u / WK.turn, e = k * k * (3 - 2 * k);
    return { z: WK.zA, heading: e * PI, walk: 0, dist: base + 2 * wkLen };
  };
  const EXTRA_SPOTS = { barista: { x: -3.0, z: -3.45, heading: 0.15 }, customer: { x: 0.55, z: -1.92, heading: PI + 0.12 } };
  const poseParts = (f, weights, times) => {   // each clip on its own clock, so a walk's stride follows the distance
    for (const n in f.actions) { const a = f.actions[n]; a.setEffectiveWeight(weights[n] || 0); a.time = ((times[n] ?? times.all) % f.durations[n] + f.durations[n]) % f.durations[n]; }
    f.mixer.update(0);
  };

  const spots = {
    atCounter: { x: -1.4, z: -1.95, heading: PI }, atPastryCase: { x: 0.0, z: -1.95, heading: PI },
    atWindow: { x: -1.3, z: 2.95, heading: 0 }, byDoor: { x: 5.1, z: 3.8, heading: PI },
    walkFrom: { x: -4.6, z: -1.2, heading: PI / 2 }, walkTo: { x: 3.6, z: -1.2, heading: PI / 2 },
    laneB: { x: 0, z: 2.1, heading: PI / 2 },
  };

  // ---------------------------------------------------------------- per frame
  const setSide = (side, hide) => {
    for (const m of sides[side]) m.material = hide ? GHOST : m.userData.mat;
    for (const d of decor[side]) d.visible = !hide && (d.userData.wasVisible ?? true);
  };
  // remember which bags found a shelf so cutting the north wall away and back does not lose them
  decor.north.forEach((d) => { if (d.userData.row !== undefined) d.userData.wasVisible = d.visible; });
  function update(state = {}) {
    const time = state.time || 0, people = state.people || {};
    keys.forEach((key, i) => {
      const f = castMap[key], d = spots.atCounter, p = people[key] || { ...d, x: d.x + i * 0.8 };
      f.object.visible = p.show !== false;
      f.object.position.set(p.x ?? d.x, 0, p.z ?? d.z);
      f.object.rotation.set(0, p.heading ?? d.heading, 0);
      const g = { ...(p.gait || {}) }; let sum = 0; for (const k in g) sum += g[k] || 0;
      if (f.actions.idle) g.idle = Math.max(0, 1 - sum);
      f.pose(p.time ?? time, g);
    });
    const ex = state.extras === false ? false : state.extras || {};
    for (const key in extraMap) {
      const f = extraMap[key], o = ex ? ex[key] || {} : {};
      f.object.visible = ex !== false && o.show !== false;
      if (!f.object.visible) continue;
      if (key === "walker") {
        const w = walkerAt(time + 3.1 + (o.phase || 0)), v = gait.__walker || 1.35;
        f.object.position.set(WK.x, 0, w.z); f.object.rotation.set(0, w.heading, 0);
        poseParts(f, { walk: w.walk, idle: 1 - w.walk }, { walk: w.dist / v, idle: time });
      } else {
        const s = EXTRA_SPOTS[key];
        f.object.position.set(s.x, 0, s.z); f.object.rotation.set(0, s.heading, 0);
        const talk = key === "barista" ? 0.75 : 0.0;
        poseParts(f, { talk, idle: 1 - talk }, { all: time + (key === "barista" ? 1.7 : 0.6) });
      }
    }
    const on = state.lamps ?? 1, sunK = state.sun ?? 1, st = state.steam ?? 0.6;
    lamps.forEach((l, i) => (l.intensity = (i < 4 ? 2.2 : 2.6) * on)); glowMat.emissiveIntensity = 3 * on + 0.05;
    sun.intensity = 4.6 * sunK;
    steam.forEach((s, i) => { const ph = (time * 0.5 + i / steam.length) % 1;
      s.position.set(Math.sin(time * 1.7 + i) * 0.012, ph * 0.28, Math.sin(time * 1.3 + i * 2) * 0.012);
      s.scale.setScalar(0.6 + ph * 1.5); s.material.opacity = st * 0.18 * Math.sin(ph * PI); });
    const c = camera.position, cut = state.cutaway !== false;
    setSide("north", cut && c.z < Z0); setSide("south", cut && c.z > Z1);
    setSide("west", cut && c.x < X0); setSide("east", cut && c.x > X1); setSide("ceiling", cut && c.y > H);
  }
  // a wisp of steam over the cup under the barista-side group head
  const steamRoot = new THREE.Group(); steamRoot.position.set(-3.4 + 0.2, CT + 0.17, (CZ0 + CZ1) / 2 - 0.3); scene.add(steamRoot);
  const steam = []; for (let i = 0; i < 6; i++) { const s = add(new THREE.SphereGeometry(0.025 + i * 0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), 0, 0, 0, { parent: steamRoot, cast: false, receive: false }); steam.push(s); }

  const render = () => renderer.render(scene, camera);
  update({});

  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: figures[0] ? figures[0].object : null, bones, gaitSpeed: gait, spots,
    room: { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H },
    counter: { x0: CX0, x1: CX1, z0: CZ0, z1: CZ1, top: CT }, counterCentre: new V3(CXC, CT, (CZ0 + CZ1) / 2),
    espressoMachine: espresso, grinder, till, pastryCase, menuBoard, tables, chairs, armchair: arm, sideTable: side,
    lamps, sun, sunDir, windowCentre: new V3(WXc, (WY0 + WY1) / 2, Z1), door: new V3((DX0 + DX1) / 2, 1.1, Z1),
    plants: [plantNE, plantNW, plantSE], extras: extraMap, extraOutfits,
  };
}
