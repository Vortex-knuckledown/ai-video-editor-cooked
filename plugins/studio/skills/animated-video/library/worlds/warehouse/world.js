// World "warehouse": a large distribution warehouse interior by day.
//
// Axes (metres): +x EAST, +y up, +z SOUTH. Floor at y = 0, roof deck at y = 12 (world.H), truss bottoms at 10.4.
// The hall is x -40..40, z -26..26. Polished concrete floor with saw-cut joints every 6 m.
// MAIN AISLE runs along x at z = 0 from the west wall to the dock area (clear for |z| < 3.0, x -38..21),
// yellow edge lines at z = +-3.0, a green PEDESTRIAN WALKWAY z 0.9..2.5 (people walk z = 1.7), forklift arrows at z = -1.5.
// PALLET RACKS (blue uprights, orange beams, 5 levels: floor, 1.75, 3.5, 5.25, 7.0; 8.6 m tall) run along x in two
// blocks, x -35.6..-10.4 and -6.4..18.8 (a CROSS AISLE at x -10.4..-6.4), rows at |z| 4.0-5.1 (facing the main
// aisle), 8.5-10.7, 14.1-16.3, 19.7-21.9 (back-to-back pairs). Rack aisles run along x at |z| = 6.8, 12.4, 18.0, 23.95.
// Every slot holds a pallet of cartons or a stretch-wrapped load (some empty). Steel columns at z = +-3.6,
// x = -34,-22,-8.4,4,16,28 with yellow guards and safety signs.
// DOCK AREA x 21..40: six LOADING DOCK DOORS in the east wall (x = 40) at z = -17.5,-10.5,-3.5,3.5,10.5,17.5
// (3.0 wide, 3.6 high): two open to a sunny yard (z = -10.5, 10.5), one with a trailer backed in (z = -3.5), one half
// open (z = 3.5), two shut. The yard outside is 1.2 m below the floor. Staging lanes with wrapped pallets, stacks of empty
// pallets, a forklift. The roof: steel trusses every 6 m, red sprinkler mains, skylight strips, high-bay lamps on
// cables (hanging at y = 9.6), clerestory windows high on the north, south and west walls. A green fire exit on the
// west wall at the end of the main aisle. Roof, trusses and lamps hide when the camera rises above y = 12, so a high
// camera looking down sees the whole floor as a cutaway.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], crowd}) -> world.
//   cast:  library characters (man, woman, robot, soldier, mannequin), or {id, outfit: {shirt, trousers}, as, clips}
//          (outfit: man and woman only). Each is world.cast.<as || id>.
//   crowd: background people, [{id, outfit, x, z, heading, clip, time}]; clip "walk" walks along heading at the
//          measured gait speed. Default: a man in a hi-vis yellow shirt walking west on the north half of the main
//          aisle (from x = 14, z = -1.6), and a woman (orange shirt) and a man (blue shirt) talking in the dock area at
//          x 25-26, z -4..-3. Their shirts are always chosen to differ from the cast's outfits.
// Per frame: set world.camera, then world.update(state), then world.render().
//
// state (every field optional):
//   time         seconds of the shot (animation clock by default)
//   people       {<cast key>: {x, z, heading, time, gait: {walk, run, jog, talk}, clip, show}}
//                heading radians about +y: 0 faces +z (south), PI/2 faces east (+x, along the aisle to the docks),
//                -PI/2 west. Gait weights 0..1, idle takes the rest. Move a walker by world.gaitSpeed.<key>.walk *
//                walk * dt so the feet never slide. Default: cast[0] stands on the walkway at x = -6, z = 1.7.
//   crowd        {<index or id>: {x, z, heading, time, clip, show}} overrides; crowd: false hides them all
//   forklift     {x, z, heading, lift (0..2.6 m fork height), load (true/false), roll (wheel turn, metres), show}
//                heading 0 = forks facing +z. Default: x = 30, z = -5.6, heading -PI/2 (forks west), lift 0.15, load on.
//                roll defaults to the distance along its heading, so a forklift moved along a line turns its wheels.
//   roof         true/false forces roof, trusses and lamps on or off (default: on unless the camera is above y = 12)
//   focus        {x, y, z} the centre of the shadow box (default: cast[0])
//   shadowRadius metres of the shadow box (default from the camera's distance to the focus)
//
// Exposes: world.cast.<key> (loadFigure results), world.person (cast[0].object), world.crowd (array of {fig, ...}),
// world.gaitSpeed.<key> {walk, run, jog} m/s, world.aisle {z, x0, x1, halfWidth, walkway: {z0, z1, z}},
// world.crossAisle {x0, x1}, world.rackAisles [z...], world.racks [{x0, x1, z0, z1}], world.columns [Vector3],
// world.docks [{z, open, trailer, x}], world.forklift {object, carriage, lift, length: 3.4, width: 1.15},
// world.staging {x0, x1, z0, z1}, world.exit (Vector3), world.spot (Vector3), world.sun, world.sunDir, world.H (12),
// world.bounds {x0, x1, z0, z1}, world.roofGroup.
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure } from "../lib/figure.js";

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
  scene.fog = new THREE.Fog(0xc9ccce, 22, 190);
  const camera = new THREE.PerspectiveCamera(40, W / Hh, 0.05, 3000);
  camera.position.set(34, 6, 2); camera.lookAt(-20, 2, 0);

  // ---------------------------------------------------------------- cast and crowd
  const castList = cast.map((c) => (typeof c === "string" ? { id: c } : { ...c }));
  for (const c of castList) c.key = c.as || c.id;
  const clipsFor = (id) => ({ man: ["idle", "walk", "run", "jog", "talk"], woman: ["idle", "walk", "run", "jog", "talk"], robot: ["idle", "walk", "run", "wave"] }[id] || ["idle", "walk", "run"]);
  const defaultShirt = { woman: "#f2f2f0", man: "#26282b" };
  const castShirts = castList.map((c) => new THREE.Color((c.outfit && c.outfit.shirt) || defaultShirt[c.id] || "#808080"));
  const SHIRTS = [["#d6df22", "#2b3346"], ["#e8731c", "#3d4a5c"], ["#3567b0", "#5a5348"], ["#2e8b57", "#2f2f35"], ["#8e3b8f", "#4a4f57"], ["#b8322c", "#2a3140"]];
  const freeOutfits = SHIRTS.filter(([s]) => castShirts.every((c) => { const k = new THREE.Color(s); return Math.abs(k.r - c.r) + Math.abs(k.g - c.g) + Math.abs(k.b - c.b) > 0.35; }));
  const outfitN = (i) => { const [shirt, trousers] = freeOutfits[i % freeOutfits.length]; return { shirt, trousers }; };
  const crowdList = (crowd ?? [
    { id: "man", outfit: outfitN(0), x: 14, z: -1.6, heading: -PI / 2, clip: "walk" },
    { id: "woman", outfit: outfitN(1), x: 25.3, z: -4.3, heading: 0, clip: "talk" },
    { id: "man", outfit: outfitN(2), x: 26.2, z: -3.2, heading: 0, clip: "talk" },
  ]).map((c) => ({ ...c }));
  if (!crowd && crowdList.length >= 3) {   // the two talkers face each other
    const a = crowdList[1], b = crowdList[2];
    a.heading = Math.atan2(b.x - a.x, b.z - a.z); b.heading = Math.atan2(a.x - b.x, a.z - b.z);
  }

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f, srgb) => new Promise((res, rej) => TL.load(K + f, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); }, undefined, rej));
  const pbrSet = async (n) => { const [d, no, r] = await Promise.all([tex(`pbr/${n}_diff.jpg`, true), tex(`pbr/${n}_nor.jpg`), tex(`pbr/${n}_rough.jpg`)]); return { d, no, r }; };
  const [sky, concrete, asphalt, ...figs] = await Promise.all([
    new HDRLoader().loadAsync(K + "sky/day.hdr"), pbrSet("concrete"), pbrSet("asphalt"),
    ...castList.map((c) => loadFigure({ THREE, id: c.id, clips: c.clips || clipsFor(c.id), outfit: c.outfit || null })),
    ...crowdList.map((c) => loadFigure({ THREE, id: c.id, clips: clipsFor(c.id), outfit: c.outfit || null })),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.environmentIntensity = 0.55; scene.backgroundIntensity = 1.0;

  // ---------------------------------------------------------------- helpers
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const std = (o) => new THREE.MeshStandardMaterial(o);
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  function boxUV(geo, w, h, d, tu, tv = tu) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tu, uv.getY(k) * dims[f][1] / tv); }
    return geo;
  }
  const box = (w, h, d, tu, tv) => (tu ? boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tu, tv) : new THREE.BoxGeometry(w, h, d));
  const cyl = (r0, r1, h, n = 14) => new THREE.CylinderGeometry(r0, r1, h, n);
  const flat = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-PI / 2);
  const _e = new THREE.Euler(), _q = new THREE.Quaternion();
  const M = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), new V3(s, s, s));
  const I = new THREE.Matrix4();
  const bins = new Map();
  function put(geo, mat, m = I, { cast: cs = true, recv = true, group = "static" } = {}) {
    const key = `${mat.uuid}|${cs}|${recv}|${group}`;
    if (!bins.has(key)) bins.set(key, { mat, cs, recv, group, list: [] });
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    bins.get(key).list.push(g.applyMatrix4(m));
  }
  const groups = { static: new THREE.Group(), roof: new THREE.Group(), yard: new THREE.Group() };
  for (const g of Object.values(groups)) scene.add(g);
  function flush(target) {
    for (const b of bins.values()) {
      const geos = b.list.map((g) => { for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k); return g; });
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), b.mat);
      mesh.castShadow = b.cs; mesh.receiveShadow = b.recv; (target || groups[b.group]).add(mesh);
    }
    bins.clear();
  }
  const noise = (g, w, h, base, amp, n) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (rnd() - 0.5) * amp; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } };

  // ---------------------------------------------------------------- materials
  const H = 12, X0 = -40, X1 = 40, Z0 = -26, Z1 = 26, TRUSS = 10.4;
  const mkPbr = (set, o = {}) => std({ map: set.d, normalMap: set.no, roughnessMap: set.r, ...o });
  const floorM = mkPbr(concrete, { roughness: 0.42, metalness: 0.0, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 0.9 }); floorM.color.setRGB(1.25, 1.24, 1.22);
  const wallConcM = mkPbr(concrete, { roughness: 1 }); wallConcM.color.setRGB(1.55, 1.53, 1.48);
  const yardM = mkPbr(asphalt, { roughness: 0.95 });
  const ribTex = (base, dark, light) => canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) { const x = k * 64; const gr = g.createLinearGradient(x, 0, x + 64, 0);
      gr.addColorStop(0, base); gr.addColorStop(0.38, base); gr.addColorStop(0.42, dark); gr.addColorStop(0.5, light); gr.addColorStop(0.58, dark); gr.addColorStop(0.62, base); gr.addColorStop(1, base);
      g.fillStyle = gr; g.fillRect(x, 0, 64, h); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 6); }
  });
  const claddingM = std({ map: ribTex("#d9dcdc", "#a9adae", "#f2f4f4"), roughness: 0.55, metalness: 0.25 });
  const deckM = std({ map: ribTex("#cfd2d2", "#9fa3a4", "#e9ebeb"), roughness: 0.6, metalness: 0.3, side: THREE.BackSide });
  const outsideM = std({ map: ribTex("#9aa5ad", "#7c868d", "#b7c0c6"), roughness: 0.6, metalness: 0.2 });
  const rackBlue = std({ color: 0x1f4f99, roughness: 0.42, metalness: 0.35 });
  const rackOrange = std({ color: 0xe0641c, roughness: 0.4, metalness: 0.3 });
  const steelGrey = std({ color: 0x7f8a92, roughness: 0.45, metalness: 0.6 });
  const steelDark = std({ color: 0x3a3f44, roughness: 0.5, metalness: 0.6 });
  const galv = std({ color: 0xb4b9bc, roughness: 0.38, metalness: 0.8 });
  const sprinklerM = std({ color: 0xb8231d, roughness: 0.45, metalness: 0.2 });
  const yellowM = std({ color: 0xf0b90f, roughness: 0.45, metalness: 0.15 });
  const blackM = std({ color: 0x151617, roughness: 0.6 });
  const rubberM = std({ color: 0x18191a, roughness: 0.85 });
  const lampLight = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.2, 3.05, 2.8), fog: false });
  const skyLightM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.0, 2.15, 2.35), fog: false });
  const clereM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.75, 1.92, 2.1) });
  const hazardTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#f0b90f"; g.fillRect(0, 0, w, h); g.fillStyle = "#141414";
    for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64 + 32, 0); g.lineTo(k * 64 + 32 + 128, h); g.lineTo(k * 64 + 128, h); g.closePath(); g.fill(); } });
  const hazardM = std({ map: hazardTex, roughness: 0.5 });
  const paint = (c, o = {}) => std({ color: c, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
  const yellowPaint = paint(0xf2bd1d), whitePaint = paint(0xeeeeea), greenPaint = paint(0x2f7d4f, { roughness: 0.5 });
  const jointM = paint(0x5d5e5f, { roughness: 0.9 });
  const woodTex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = "#c19a6b"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.strokeStyle = rnd() < 0.5 ? `rgba(110,75,40,${rnd() * 0.25})` : `rgba(240,215,170,${rnd() * 0.2})`; g.lineWidth = 0.5 + rnd() * 1.5; const y = rnd() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w / 3, y + rr(-4, 4), 2 * w / 3, y + rr(-4, 4), w, y + rr(-3, 3)); g.stroke(); }
    for (let i = 0; i < 4; i++) { g.fillStyle = "rgba(70,45,20,0.35)"; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 3, 1.6, 0, 0, 7); g.fill(); } });
  const woodM = std({ map: woodTex, roughness: 0.85 });
  const cartonTex = (label) => canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, "#c49a64", 0.12, 9000);
    g.fillStyle = "rgba(120,80,40,0.18)"; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
    g.fillStyle = "rgba(225,200,150,0.75)"; g.fillRect(w / 2 - 22, 0, 44, h);
    g.fillStyle = "rgba(255,240,210,0.25)"; g.fillRect(w / 2 - 22, 0, 44, 3);
    if (label) { g.fillStyle = "#f4f2ec"; g.fillRect(150, 150, 86, 68); g.fillStyle = "#222";
      for (let x = 156; x < 230; x += 2 + Math.floor(rnd() * 3)) g.fillRect(x, 186, 1 + Math.floor(rnd() * 2), 26);
      g.fillRect(156, 158, 50, 6); g.fillRect(156, 170, 72, 4);
      g.fillStyle = "#3a3a3a"; g.font = "bold 22px sans-serif"; g.fillText("↑↑", 24, 44); }
  });
  const cartonM = [std({ map: cartonTex(false), roughness: 0.9 }), std({ map: cartonTex(true), roughness: 0.9 })];
  const wrapTex = canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, "#b89466", 0.1, 6000);
    g.strokeStyle = "rgba(90,60,30,0.45)"; g.lineWidth = 2;
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let r = 0; r < 4; r++) for (let x = (r % 2) * 42; x < w; x += 85) { g.beginPath(); g.moveTo(x, r * 64); g.lineTo(x, r * 64 + 64); g.stroke(); }
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(255,255,255,${0.08 + rnd() * 0.22})`; g.lineWidth = 2 + rnd() * 8; const y = rnd() * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + rr(-20, 20)); g.stroke(); }
    g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, 0, w, h);
  });
  const wrapM = std({ map: wrapTex, roughness: 0.22, metalness: 0.0 });
  const doorTex = canvasTex(128, 256, (g, w, h) => { g.fillStyle = "#8e9ba6"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, "#a9b5bf"); gr.addColorStop(0.7, "#8d99a3"); gr.addColorStop(1, "#5e6870"); g.fillStyle = gr; g.fillRect(0, y, w, 16); } });
  const rollDoorM = std({ map: doorTex, roughness: 0.5, metalness: 0.4 });
  const checkerTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#8a8f93"; g.fillRect(0, 0, w, h); g.fillStyle = "#b3b8bb";
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 * 8; x < w; x += 16) { g.save(); g.translate(x + 4, y + 4); g.rotate(((x + y) / 16) % 2 ? 0.8 : -0.8); g.fillRect(-4, -1, 8, 2); g.restore(); } });
  const checkerM = std({ map: checkerTex, roughness: 0.45, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 });

  // ---------------------------------------------------------------- signs (canvas)
  function signTex(w, h, draw) { return canvasTex(w, h, (g) => draw(g, w, h)); }
  const txt = (g, s, x, y, size, col = "#111", align = "center") => { g.fillStyle = col; g.font = `bold ${size}px Arial, Helvetica, sans-serif`; g.textAlign = align; g.textBaseline = "middle"; g.fillText(s, x, y); };
  const signs = {
    forklift: signTex(256, 320, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#f2c200"; g.fillRect(0, 0, w, 210);
      g.fillStyle = "#111"; g.beginPath(); g.moveTo(w / 2, 22); g.lineTo(232, 190); g.lineTo(24, 190); g.closePath(); g.fill();
      g.fillStyle = "#f2c200"; g.beginPath(); g.moveTo(w / 2, 46); g.lineTo(210, 178); g.lineTo(46, 178); g.closePath(); g.fill();
      g.fillStyle = "#111"; g.fillRect(96, 112, 46, 34); g.fillRect(104, 92, 22, 22); g.fillRect(146, 84, 6, 66); g.fillRect(146, 140, 34, 6);
      g.beginPath(); g.arc(106, 152, 10, 0, 7); g.arc(138, 152, 10, 0, 7); g.fill();
      txt(g, "FORKLIFT", w / 2, 242, 34); txt(g, "TRUCKS OPERATING", w / 2, 284, 24); }),
    hivis: signTex(256, 320, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#1b5fae"; g.beginPath(); g.arc(w / 2, 108, 92, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.moveTo(92, 60); g.lineTo(164, 60); g.lineTo(176, 168); g.lineTo(80, 168); g.closePath(); g.fill();
      g.fillStyle = "#1b5fae"; g.fillRect(110, 56, 36, 30); g.fillRect(84, 122, 88, 8); g.fillRect(84, 144, 88, 8);
      txt(g, "HI-VIS VEST", w / 2, 240, 34); txt(g, "MUST BE WORN", w / 2, 282, 28); }),
    speed: signTex(256, 320, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#d21f1b"; g.beginPath(); g.arc(w / 2, 112, 98, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(w / 2, 112, 74, 0, 7); g.fill(); txt(g, "8", w / 2, 116, 96); txt(g, "km/h", w / 2, 172, 18);
      txt(g, "SPEED LIMIT", w / 2, 246, 34); txt(g, "ALL VEHICLES", w / 2, 286, 24); }),
    walkway: signTex(256, 320, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#1f8a4c"; g.fillRect(28, 20, 200, 180);
      g.fillStyle = "#fff"; g.beginPath(); g.arc(128, 54, 14, 0, 7); g.fill(); g.lineWidth = 12; g.strokeStyle = "#fff"; g.lineCap = "round";
      g.beginPath(); g.moveTo(128, 76); g.lineTo(122, 128); g.lineTo(98, 176); g.moveTo(122, 128); g.lineTo(150, 176); g.moveTo(96, 100); g.lineTo(126, 88); g.lineTo(156, 112); g.stroke();
      txt(g, "PEDESTRIANS", w / 2, 242, 30); txt(g, "USE WALKWAY", w / 2, 284, 28); }),
    exit: signTex(512, 160, (g, w, h) => { g.fillStyle = "#12924a"; g.fillRect(0, 0, w, h); g.strokeStyle = "#fff"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
      txt(g, "FIRE EXIT", 300, h / 2 + 2, 64, "#fff"); g.fillStyle = "#fff"; g.beginPath(); g.arc(78, 46, 12, 0, 7); g.fill();
      g.lineWidth = 12; g.lineCap = "round"; g.strokeStyle = "#fff"; g.beginPath(); g.moveTo(74, 64); g.lineTo(64, 100); g.lineTo(40, 124); g.moveTo(64, 100); g.lineTo(96, 120); g.lineTo(104, 140); g.moveTo(46, 80); g.lineTo(76, 70); g.lineTo(100, 90); g.stroke(); }),
    extinguisher: signTex(128, 192, (g, w, h) => { g.fillStyle = "#c8201b"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.fillRect(46, 34, 36, 100); g.fillRect(54, 20, 20, 16); g.fillRect(72, 22, 26, 8);
      txt(g, "FIRE", w / 2, 160, 26, "#fff"); }),
  };
  const signMat = {}; for (const k in signs) signMat[k] = std({ map: signs[k], roughness: 0.5 });
  const exitGlow = new THREE.MeshBasicMaterial({ map: signs.exit, color: new THREE.Color().setRGB(1.6, 1.6, 1.6) });
  const aisleSignTex = (n) => signTex(320, 128, (g, w, h) => { g.fillStyle = "#16335f"; g.fillRect(0, 0, w, h); g.strokeStyle = "#f2c200"; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    txt(g, "AISLE", 96, h / 2 + 2, 40, "#fff"); txt(g, String(n).padStart(2, "0"), 236, h / 2 + 4, 76, "#f2c200"); });
  const stencil = (draw, w = 256, h = 128) => new THREE.MeshStandardMaterial({ map: canvasTex(w, h, (g) => { g.clearRect(0, 0, w, h); draw(g, w, h); }), transparent: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
  const stopM = stencil((g, w, h) => txt(g, "STOP", w / 2, h / 2 + 4, 100, "#f4f4f0"));
  const arrowM = stencil((g, w, h) => { g.fillStyle = "#f4f4f0"; g.beginPath(); g.moveTo(20, 52); g.lineTo(160, 52); g.lineTo(160, 22); g.lineTo(236, 64); g.lineTo(160, 106); g.lineTo(160, 76); g.lineTo(20, 76); g.closePath(); g.fill(); });
  const walkerM = stencil((g, w, h) => { g.fillStyle = "#f4f4f0"; g.strokeStyle = "#f4f4f0"; g.lineCap = "round"; g.lineWidth = 12;
    for (const ox of [64, 192]) { g.beginPath(); g.arc(ox, 22, 11, 0, 7); g.fill(); g.beginPath(); g.moveTo(ox, 40); g.lineTo(ox - 4, 78); g.lineTo(ox - 22, 116); g.moveTo(ox - 4, 78); g.lineTo(ox + 18, 116); g.moveTo(ox - 24, 58); g.lineTo(ox + 2, 48); g.lineTo(ox + 24, 66); g.stroke(); } });
  const stagingM = stencil((g, w, h) => txt(g, "STAGING", w / 2, h / 2 + 4, 58, "#f2bd1d"));
  const poolTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,246,228,1)"); gr.addColorStop(0.45, "rgba(255,240,220,0.4)"); gr.addColorStop(1, "rgba(255,240,220,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const poolM = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const dayPoolM = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xdfe9ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  // ---------------------------------------------------------------- floor and markings
  put(box(X1 - X0, 0.2, Z1 - Z0, 4), floorM, M(0, -0.1, 0), { cast: false });
  for (let x = X0 + 6; x < X1; x += 6) put(flat(0.012, Z1 - Z0), jointM, M(x, 0.001, 0), { cast: false });
  for (let z = Z0 + 4; z < Z1; z += 6) put(flat(X1 - X0, 0.012), jointM, M(0, 0.001, z), { cast: false });
  const AIS = { z: 0, x0: -38, x1: 21, halfWidth: 3.0, walkway: { z0: 0.9, z1: 2.5, z: 1.7 } };
  const CROSS = { x0: -10.4, x1: -6.4 };
  const lineAlongX = (xa, xb, z, wdt, mat) => put(flat(xb - xa, wdt), mat, M((xa + xb) / 2, 0.003, z), { cast: false });
  for (const sz of [-1, 1]) { lineAlongX(AIS.x0, CROSS.x0, sz * 3.0, 0.12, yellowPaint); lineAlongX(CROSS.x1, AIS.x1, sz * 3.0, 0.12, yellowPaint); }
  // the green walkway with white edges, painted walkers every 12 m
  put(flat(AIS.x1 - AIS.x0, AIS.walkway.z1 - AIS.walkway.z0), greenPaint, M((AIS.x0 + AIS.x1) / 2, 0.002, AIS.walkway.z), { cast: false });
  for (const z of [AIS.walkway.z0, AIS.walkway.z1]) lineAlongX(AIS.x0, AIS.x1, z, 0.08, whitePaint);
  for (let x = -34; x < 20; x += 12) { put(flat(1.4, 0.7).rotateY(PI / 2), walkerM, M(x, 0.004, AIS.walkway.z, 0), { cast: false }); }
  for (let x = -30; x < 20; x += 12) put(flat(2.2, 1.1), arrowM, M(x, 0.004, -1.5, x % 24 === 0 ? 0 : PI), { cast: false });
  // stop lines where the main aisle meets the cross aisle and the dock area
  for (const [x, ry] of [[CROSS.x0 - 0.6, 0], [CROSS.x1 + 0.6, PI], [AIS.x1 - 0.9, 0]]) {
    put(flat(0.25, 2.8), whitePaint, M(x, 0.003, -1.5), { cast: false });
    put(flat(1.6, 0.8).rotateY(PI / 2), stopM, M(x - (ry ? -1.0 : 1.0), 0.004, -1.5, ry), { cast: false }); }
  // zebra crossing over the cross aisle on the walkway line
  for (let k = 0; k < 7; k++) put(flat(0.35, AIS.walkway.z1 - AIS.walkway.z0), whitePaint, M(CROSS.x0 + 0.3 + k * 0.6, 0.003, AIS.walkway.z), { cast: false });
  // staging lanes and the hatched zone in front of the docks
  const STG = { x0: 22, x1: 35, z0: -24, z1: 24 };
  for (let z = -22; z <= 22; z += 4) if (Math.abs(z) > 4) { put(flat(STG.x1 - STG.x0, 0.1), yellowPaint, M((STG.x0 + STG.x1) / 2, 0.003, z), { cast: false }); }
  for (const x of [STG.x0, STG.x1]) for (const sz of [-1, 1]) put(flat(0.1, 18), yellowPaint, M(x, 0.003, sz * 13), { cast: false });
  put(flat(2.6, 1.3).rotateY(PI / 2), stagingM, M(23.2, 0.004, -13, 0), { cast: false });
  put(flat(2.6, 1.3).rotateY(-PI / 2), stagingM, M(23.2, 0.004, 13, 0), { cast: false });

  // ---------------------------------------------------------------- walls (precast concrete below, ribbed cladding above)
  const LOW = 3.0;
  function wallX(z, x0, x1, sign) {   // a wall along x at z, interior face toward -sign
    const len = x1 - x0, cx = (x0 + x1) / 2;
    put(box(len, LOW, 0.3, 3), wallConcM, M(cx, LOW / 2, z + sign * 0.15));
    put(box(len, H - LOW, 0.3, 1.0, 4), claddingM, M(cx, LOW + (H - LOW) / 2, z + sign * 0.15));
    put(box(len, 0.12, 0.06), galv, M(cx, LOW, z - sign * 0.03), { cast: false });
    put(box(len + 0.6, H + 1.2, 0.05, 1.0, 4), outsideM, M(cx, (H - 1.2) / 2, z + sign * 0.33), { recv: false, group: "yard" });
  }
  wallX(Z0, X0, X1, -1); wallX(Z1, X0, X1, 1);
  { const len = Z1 - Z0; put(box(0.3, LOW, len, 3), wallConcM, M(X0 - 0.15, LOW / 2, 0)); put(box(0.3, H - LOW, len, 1.0, 4), claddingM, M(X0 - 0.15, LOW + (H - LOW) / 2, 0));
    put(box(0.06, 0.12, len), galv, M(X0 + 0.03, LOW, 0), { cast: false });
    put(box(0.05, H + 1.2, len + 0.6, 1.0, 4), outsideM, M(X0 - 0.33, (H - 1.2) / 2, 0), { recv: false, group: "yard" }); }
  // clerestory windows high on north, south and west walls
  for (const [z, s] of [[Z0, 1], [Z1, -1]]) { put(new THREE.PlaneGeometry(X1 - X0 - 2, 1.3), clereM, M(0, 9.9, z + s * 0.01, s > 0 ? 0 : PI), { cast: false });
    for (let x = X0 + 1; x <= X1 - 1; x += 1.5) put(box(0.08, 1.4, 0.08), steelDark, M(x, 9.9, z + s * 0.04), { cast: false });
    for (const y of [9.2, 10.6]) put(box(X1 - X0 - 2, 0.1, 0.1), steelDark, M(0, y, z + s * 0.05), { cast: false }); }
  put(new THREE.PlaneGeometry(Z1 - Z0 - 2, 1.3), clereM, M(X0 + 0.01, 9.9, 0, PI / 2), { cast: false });
  for (let z = Z0 + 1; z <= Z1 - 1; z += 1.5) put(box(0.08, 1.4, 0.08), steelDark, M(X0 + 0.04, 9.9, z), { cast: false });
  // west fire exit at the end of the main aisle
  const EXIT = new V3(X0 + 0.6, 0, AIS.walkway.z);
  put(box(0.08, 2.2, 1.9), std({ color: 0x5f6f62, roughness: 0.5, metalness: 0.4 }), M(X0 + 0.04, 1.1, EXIT.z));
  put(box(0.1, 2.3, 0.08), steelDark, M(X0 + 0.06, 1.15, EXIT.z - 0.99)); put(box(0.1, 2.3, 0.08), steelDark, M(X0 + 0.06, 1.15, EXIT.z + 0.99));
  put(box(0.14, 0.06, 1.5), galv, M(X0 + 0.14, 1.05, EXIT.z));
  put(new THREE.PlaneGeometry(1.2, 0.375), exitGlow, M(X0 + 0.04, 2.6, EXIT.z, PI / 2), { cast: false });

  // ---------------------------------------------------------------- east wall with the loading docks
  const DOORS = [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5], DW = 3.0, DH = 3.6;
  const DSTATE = ["shut", "open", "trailer", "half", "open", "shut"];
  const docks = DOORS.map((z, i) => ({ z, x: X1, open: DSTATE[i] !== "shut", trailer: DSTATE[i] === "trailer", state: DSTATE[i] }));
  { const edges = [Z0, ...DOORS.flatMap((z) => [z - DW / 2, z + DW / 2]), Z1];
    for (let i = 0; i < edges.length; i += 2) { const a = edges[i], b = edges[i + 1], len = b - a, cz = (a + b) / 2;
      put(box(0.3, LOW, len, 3), wallConcM, M(X1 + 0.15, LOW / 2, cz)); put(box(0.3, H - LOW, len, 1.0, 4), claddingM, M(X1 + 0.15, LOW + (H - LOW) / 2, cz));
      put(box(0.05, H + 1.2, len, 1.0, 4), outsideM, M(X1 + 0.33, (H - 1.2) / 2, cz), { recv: false, group: "yard" }); }
    for (const d of docks) {
      const z = d.z;
      put(box(0.3, H - DH, DW, 1.0, 4), claddingM, M(X1 + 0.15, DH + (H - DH) / 2, z));
      put(box(0.05, H + 1.2 - DH - 1.2, DW, 1.0, 4), outsideM, M(X1 + 0.33, DH + (H - DH) / 2, z), { recv: false, group: "yard" });
      for (const s of [-1, 1]) { put(box(0.4, DH, 0.12), yellowM, M(X1 - 0.05, DH / 2, z + s * (DW / 2 + 0.06)));
        put(box(0.25, 1.1, 0.2), hazardM, M(X1 - 0.35, 0.55, z + s * (DW / 2 + 0.35)));
        put(cyl(0.11, 0.11, 1.1, 16), yellowM, M(X1 - 2.6, 0.55, z + s * (DW / 2 + 0.25)));          // bollards
        put(cyl(0.112, 0.112, 0.08, 16), blackM, M(X1 - 2.6, 0.85, z + s * (DW / 2 + 0.25)));
        put(box(0.25, 0.5, 0.35), rubberM, M(X1 + 0.53, -0.4, z + s * 1.1), { group: "yard" }); }        // bumpers outside
      put(box(0.6, 0.55, DW + 0.4), steelGrey, M(X1 - 0.3, DH + 0.3, z));                               // roll housing
      put(box(0.05, 0.06, DW), steelDark, M(X1 - 0.02, DH - 0.03, z));
      // dock leveller plate with hazard edges
      put(flat(2.3, 2.2), checkerM, M(X1 - 1.15, 0.006, z), { cast: false });
      for (const s of [-1, 1]) put(flat(2.3, 0.15), hazardM, M(X1 - 1.15, 0.007, z + s * 1.15), { cast: false });
      put(new THREE.PlaneGeometry(0.6, 0.75), signMat.forklift, M(X1 - 0.02, 2.0, z + DW / 2 + 1.2, -PI / 2), { cast: false });
      // the door itself
      if (d.state === "shut") put(new THREE.PlaneGeometry(DW, DH, 1, 1), rollDoorM, M(X1 + 0.02, DH / 2, z, -PI / 2), { cast: false });
      if (d.state === "half") put(new THREE.PlaneGeometry(DW, DH * 0.45), rollDoorM, M(X1 + 0.02, DH - DH * 0.225, z, -PI / 2));
      // dock seals outside around the opening
      if (d.open) { for (const s of [-1, 1]) put(box(0.4, DH + 0.4, 0.3), rubberM, M(X1 + 0.5, DH / 2, z + s * (DW / 2 + 0.15)), { group: "yard" });
        put(box(0.4, 0.4, DW + 0.6), rubberM, M(X1 + 0.5, DH + 0.2, z), { group: "yard" }); }
    }
  }
  // the yard outside: an apron 1.2 m down, a dock wall, a trailer, fences and low buildings far off
  const GY = -1.2;
  { const g = new THREE.PlaneGeometry(600, 600); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 600 / 6, uv.getY(i) * 600 / 6);
    const yard = new THREE.Mesh(g, yardM); yard.rotation.x = -PI / 2; yard.position.y = GY; yard.receiveShadow = true; groups.yard.add(yard); }
  put(box(0.4, 1.2, Z1 - Z0 + 0.6, 3), wallConcM, M(X1 + 0.2, GY + 0.6, 0), { group: "yard" });
  put(box(X1 - X0 + 1.2, 1.0, Z1 - Z0 + 1.2, 3), wallConcM, M(0, GY + 0.5, 0), { cast: false, group: "yard" });
  for (let z = -40; z <= 40; z += 4) if (Math.abs(z) > 1) put(flat(14, 0.12), whitePaint, M(X1 + 9, GY + 0.003, z + 0.0), { cast: false, group: "yard" });
  const trailerM = std({ color: 0xe9ebec, roughness: 0.45, metalness: 0.3 });
  const trailerIn = std({ color: 0x77736c, roughness: 0.85 });
  function trailer(z, x0, opened) {
    const L = 13.6, Wt = 2.55, Ht = 2.7, base = GY + 1.25;
    put(box(L, Ht, 0.05), trailerM, M(x0 + L / 2, base + Ht / 2, z - Wt / 2), { group: "yard" });
    put(box(L, Ht, 0.05), trailerM, M(x0 + L / 2, base + Ht / 2, z + Wt / 2), { group: "yard" });
    put(box(L, 0.05, Wt), trailerM, M(x0 + L / 2, base + Ht, z), { group: "yard" });
    put(box(L, 0.08, Wt), trailerIn, M(x0 + L / 2, base, z), { group: "yard" });
    put(box(0.05, Ht, Wt), opened ? trailerIn : trailerM, M(x0 + L, base + Ht / 2, z), { group: "yard" });
    if (!opened) put(box(0.05, Ht, Wt), trailerM, M(x0, base + Ht / 2, z), { group: "yard" });
    for (const s of [-1, 1]) for (const dx of [9.6, 10.9, 12.2]) put(cyl(0.5, 0.5, 0.3, 20).rotateX(PI / 2), rubberM, M(x0 + dx, GY + 0.5, z + s * 1.05), { group: "yard" });
    put(box(L, 0.3, 0.06), std({ color: 0x2f5fa8, roughness: 0.5 }), M(x0 + L / 2, base + Ht - 0.3, z + Wt / 2 + 0.03), { group: "yard" });
    return { x0, L, base };
  }
  const tr = trailer(-3.5, X1 + 0.75, true);
  trailer(-10.5 - 0.1, X1 + 24, false); trailer(10.5, X1 + 30, false);
  // cartons inside the docked trailer, near its far end
  const trailerLoads = [];
  for (let k = 0; k < 6; k++) trailerLoads.push({ x: tr.x0 + 6 + k * 1.25, y: tr.base + 0.04, z: -3.5 + (k % 2 ? 0.62 : -0.62), h: rr(1.3, 1.9), wrap: rnd() < 0.5, ry: PI / 2 });
  // fence and low buildings beyond the yard
  for (let z = -120; z <= 120; z += 3) { put(box(0.06, 2.2, 0.06), galv, M(X1 + 60, GY + 1.1, z), { cast: false, recv: false, group: "yard" }); }
  put(box(0.02, 2.0, 240), std({ color: 0x8a9096, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.5 }), M(X1 + 60, GY + 1.0, 0), { cast: false, recv: false, group: "yard" });
  for (let k = 0; k < 9; k++) { const w = rr(20, 50), h = rr(6, 14), d = rr(18, 40);
    put(box(d, h, w, 1.0, 4), outsideM, M(X1 + 95 + rr(0, 60), GY + h / 2, -120 + k * 30 + rr(-6, 6)), { cast: false, recv: false, group: "yard" }); }
  for (const [x, z] of [[-90, -60], [-80, 50], [0, -90], [10, 85], [-140, 0]]) { const w = rr(40, 80), h = rr(8, 15), d = rr(30, 50);
    put(box(w, h, d, 1.0, 4), outsideM, M(x, GY + h / 2, z), { cast: false, recv: false, group: "yard" }); }

  // ---------------------------------------------------------------- steel columns with guards and signs
  const COLX = [-34, -22, -8.4, 4, 16, 28], COLS = [];
  const colM = std({ color: 0x55636e, roughness: 0.45, metalness: 0.5 });
  const signOrder = ["forklift", "hivis", "speed", "walkway"];
  let si = 0;
  for (const cx of COLX) for (const cz of [-3.6, 3.6]) {
    COLS.push(new V3(cx, 0, cz));
    put(box(0.36, TRUSS, 0.03), colM, M(cx, TRUSS / 2, cz - 0.17)); put(box(0.36, TRUSS, 0.03), colM, M(cx, TRUSS / 2, cz + 0.17)); put(box(0.025, TRUSS, 0.32), colM, M(cx, TRUSS / 2, cz));
    put(box(0.6, 1.2, 0.6, 0.6, 0.6), hazardM, M(cx, 0.6, cz));
    const face = cz < 0 ? 1 : -1;   // signs face the aisle
    put(new THREE.PlaneGeometry(0.5, 0.625), signMat[signOrder[si++ % 4]], M(cx, 2.2, cz + face * 0.31, face > 0 ? 0 : PI), { cast: false });
    if (si % 3 === 0) { put(new THREE.PlaneGeometry(0.22, 0.33), signMat.extinguisher, M(cx + 0.186, 2.25, cz, PI / 2), { cast: false });
      put(box(0.1, 0.06, 0.12), steelDark, M(cx + 0.22, 1.82, cz));                                     // wall bracket on the web
      put(cyl(0.08, 0.08, 0.5, 14), sprinklerM, M(cx + 0.28, 1.6, cz)); put(cyl(0.03, 0.03, 0.12, 8), blackM, M(cx + 0.28, 1.91, cz)); }
  }
  for (const cz of [-18, -10, 10, 18]) for (const cx of [28, 34]) { COLS.push(new V3(cx, 0, cz));
    put(box(0.36, TRUSS, 0.03), colM, M(cx, TRUSS / 2, cz - 0.17)); put(box(0.36, TRUSS, 0.03), colM, M(cx, TRUSS / 2, cz + 0.17)); put(box(0.025, TRUSS, 0.32), colM, M(cx, TRUSS / 2, cz));
    put(box(0.6, 1.2, 0.6, 0.6, 0.6), hazardM, M(cx, 0.6, cz)); }

  // ---------------------------------------------------------------- pallet racks
  const RACK_ROWS = [[4.0, 5.1], [8.5, 9.6], [9.6, 10.7], [14.1, 15.2], [15.2, 16.3], [19.7, 20.8], [20.8, 21.9]];
  const BLOCKS = [[-35.6, -10.4], [-6.4, 18.8]], BAY = 2.8, LEVELS = [0, 1.75, 3.5, 5.25, 7.0], UP = 8.6;
  const racks = [], slots = [];
  const beamLabelTex = canvasTex(512, 32, (g, w, h) => { g.fillStyle = "#e0641c"; g.fillRect(0, 0, w, h);
    for (const x of [70, 330]) { g.fillStyle = "#f6f4ee"; g.fillRect(x, 5, 110, 22); g.fillStyle = "#222"; for (let k = x + 6; k < x + 70; k += 3) g.fillRect(k, 9, 1 + (k % 2), 14); txt(g, "A" + Math.floor(rnd() * 90 + 10), x + 92, 16, 13, "#111"); } });
  const beamLabelM = std({ map: beamLabelTex, roughness: 0.4, metalness: 0.2 });
  for (const sideZ of [-1, 1]) for (const [za, zb] of RACK_ROWS) {
    const z0 = sideZ * za, z1 = sideZ * zb, zc = (z0 + z1) / 2, front = sideZ * za, back = sideZ * zb;
    for (const [xa, xb] of BLOCKS) {
      racks.push({ x0: xa, x1: xb, z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
      const nb = Math.round((xb - xa) / BAY);
      for (let i = 0; i <= nb; i++) { const x = xa + i * BAY;
        for (const z of [front, back]) { put(box(0.09, UP, 0.07), rackBlue, M(x, UP / 2, z - sideZ * 0.035 * (z === front ? -1 : 1)));
          put(box(0.16, 0.01, 0.14), galv, M(x, 0.005, z), { cast: false }); }
        // bracing between the front and back posts
        const D = Math.abs(back - front) - 0.07;
        for (let y = 0.25; y < UP - 0.6; y += 1.2) { const dy = 1.2, L = Math.hypot(dy, D), a = Math.atan2(D, dy) * ((Math.round((y - 0.25) / 1.2) % 2) ? 1 : -1);
          put(box(0.03, L, 0.025), rackBlue, M(x, y + dy / 2, zc, 0, a * sideZ), { cast: false }); }
        for (const y of [0.2, UP - 0.15]) put(box(0.03, 0.03, D), rackBlue, M(x, y, zc), { cast: false });
        // post protectors on the aisle-facing posts at the row ends
        if (i === 0 || i === nb) put(box(0.3, 0.45, 1.15, 0.5, 0.5), hazardM, M(x + (i === 0 ? -0.2 : 0.2), 0.225, zc));
      }
      for (let b = 0; b < nb; b++) { const bx = xa + b * BAY + BAY / 2;
        for (let l = 0; l < LEVELS.length; l++) {
          const y = LEVELS[l];
          if (l > 0) for (const z of [front, back]) put(box(BAY - 0.09, 0.12, 0.05), z === front ? beamLabelM : rackOrange, M(bx, y - 0.06, z), { cast: l < 2 });
          const top = l < LEVELS.length - 1 ? LEVELS[l + 1] - 0.12 - y : 1.45;
          for (const o of [-0.7, 0.7]) slots.push({ x: bx + o, y, z: zc, h: Math.min(1.45, top - 0.22), ry: 0, level: l });
        }
      }
    }
  }
  // hanging aisle signs where each rack aisle opens onto the dock area
  const rackAisles = [-23.95, -18.0, -12.4, -6.8, 6.8, 12.4, 18.0, 23.95];
  rackAisles.forEach((z, i) => { const m = std({ map: aisleSignTex(i + 1), roughness: 0.5 });
    for (const s of [1, -1]) put(new THREE.PlaneGeometry(1.4, 0.56), m, M(19.4 + s * 0.011, 9.2, z, s * PI / 2), { cast: false, group: "roof" });
    put(box(0.02, 0.58, 1.42), steelDark, M(19.4, 9.2, z), { cast: false, group: "roof" });
    for (const s of [-0.6, 0.6]) put(cyl(0.006, 0.006, TRUSS - 9.48, 4), steelDark, M(19.4, (TRUSS + 9.48) / 2, z + s), { cast: false, group: "roof" }); });

  // ---------------------------------------------------------------- staging area: loads on the floor, empty pallet stacks
  for (let z = -20; z <= 20; z += 4) { if (Math.abs(z) < 6) continue;
    for (let x = STG.x0 + 1.2; x < STG.x1 - 0.8; x += 1.45) if (rnd() < 0.62) slots.push({ x, y: 0, z, h: rr(0.8, 1.6), ry: PI / 2 + rr(-0.04, 0.04), level: 0 }); }
  const emptyStacks = [];
  for (const [x, z, n] of [[36.5, -23.6, 12], [37.8, -23.6, 9], [36.5, 23.4, 14], [37.9, 23.4, 7], [-38.6, -24.6, 11], [-37.0, 24.6, 6], [21.6, -24.5, 10]]) emptyStacks.push({ x, z, n });
  for (const l of trailerLoads) slots.push({ ...l, level: 0, trailer: true });

  // pallets and their loads, instanced
  const palletGeo = (() => { const parts = [];
    for (let k = 0; k < 5; k++) parts.push(box(1.2, 0.022, 0.13).translate(0, 0.133, -0.435 + k * 0.2175));
    for (const x of [-0.55, 0, 0.55]) parts.push(box(0.1, 0.09, 1.0).translate(x, 0.077, 0));
    for (const z of [-0.43, 0, 0.43]) parts.push(box(1.2, 0.022, 0.14).translate(0, 0.011, z));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()), false); })();
  const palletMs = [], cartonMs = [[], []], cartonCols = [[], []], wrapMs = [];
  const SIZES = [[0.58, 0.48, 0.47], [0.39, 0.48, 0.32], [0.39, 0.31, 0.47], [0.58, 0.32, 0.47], [0.29, 0.31, 0.32]];
  const TINTS = [[1, 1, 1], [0.92, 0.9, 0.86], [1.06, 1.04, 1.0], [0.82, 0.78, 0.72], [1.35, 1.36, 1.38], [1.0, 0.96, 0.9]];
  const pm = new THREE.Matrix4(), tmpS = new V3(), tmpP = new V3(), tmpQ = new THREE.Quaternion(), qy = new THREE.Quaternion();
  function addLoad(s) {
    const P = M(s.x, s.y, s.z, s.ry || 0);
    palletMs.push(P.clone().multiply(M(rr(-0.03, 0.03), 0, rr(-0.04, 0.04), rr(-0.02, 0.02))));
    const base = 0.144, hmax = s.h;
    if (s.wrap === true || (s.wrap !== false && rnd() < 0.34)) {
      const h = Math.max(0.5, hmax * rr(0.75, 1));
      wrapMs.push(P.clone().multiply(new THREE.Matrix4().compose(tmpP.set(0, base + h / 2, 0), tmpQ.identity(), tmpS.set(1.16, h, 0.98))));
      return;
    }
    const [sx, sy, sz] = pick(SIZES), nx = Math.max(1, Math.floor(1.18 / sx)), nz = Math.max(1, Math.floor(0.98 / sz));
    const layers = Math.max(1, Math.floor(hmax * rr(0.6, 1.0) / sy)), tint = pick(TINTS), lab = rnd() < 0.5 ? 1 : 0;
    const ox = -(nx * sx) / 2 + sx / 2, oz = -(nz * sz) / 2 + sz / 2;
    for (let ly = 0; ly < layers; ly++) for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const top = ly === layers - 1;
      if (!top && i > 0 && i < nx - 1 && k > 0 && k < nz - 1) continue;          // hidden inside the stack
      if (top && layers > 1 && rnd() < 0.18) continue;                            // a part-picked top layer
      const m = P.clone().multiply(new THREE.Matrix4().compose(tmpP.set(ox + i * sx + rr(-0.01, 0.01), base + ly * sy + sy / 2, oz + k * sz + rr(-0.01, 0.01)),
        qy.setFromAxisAngle(new V3(0, 1, 0), rr(-0.025, 0.025)), tmpS.set(sx - 0.008, sy - 0.004, sz - 0.008)));
      const v = rr(0.93, 1.05);
      cartonMs[lab].push(m); cartonCols[lab].push(new THREE.Color(tint[0] * v, tint[1] * v, tint[2] * v));
    }
  }
  for (const s of slots) { if (!s.trailer && rnd() < (s.level === 0 && s.x > 20 ? 0 : 0.09)) continue; addLoad(s); }
  for (const e of emptyStacks) for (let k = 0; k < e.n; k++) palletMs.push(M(e.x + rr(-0.03, 0.03), k * 0.144, e.z + rr(-0.03, 0.03), rr(-0.03, 0.03)));
  function instanced(geo, mat, mats, cols) {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => { im.setMatrixAt(i, m); if (cols) im.setColorAt(i, cols[i]); });
    im.instanceMatrix.needsUpdate = true; if (cols) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im;
  }
  instanced(palletGeo, woodM, palletMs);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (const lab of [0, 1]) if (cartonMs[lab].length) instanced(unit, cartonM[lab], cartonMs[lab], cartonCols[lab]);
  instanced(unit, wrapM, wrapMs);

  // ---------------------------------------------------------------- a few things in the dock area
  // shipping desk with a monitor, a label printer, a bin, traffic cones
  { const x = 23.2, z = 4.6;
    put(box(1.6, 0.04, 0.8), std({ color: 0xd8d6cf, roughness: 0.5 }), M(x, 0.95, z));
    for (const sx of [-0.72, 0.72]) for (const sz of [-0.33, 0.33]) put(box(0.05, 0.93, 0.05), steelGrey, M(x + sx, 0.465, z + sz));
    put(box(0.55, 0.34, 0.03), blackM, M(x - 0.3, 1.32, z + 0.2)); put(box(0.05, 0.2, 0.05), blackM, M(x - 0.3, 1.07, z + 0.24));
    put(new THREE.PlaneGeometry(0.52, 0.31), std({ color: 0x223a5c, emissive: 0x3f6fb0, emissiveIntensity: 0.6, roughness: 0.3 }), M(x - 0.3, 1.32, z + 0.18, PI), { cast: false });
    put(box(0.3, 0.2, 0.3), std({ color: 0xeeeeea, roughness: 0.4 }), M(x + 0.45, 1.07, z));
    put(cyl(0.3, 0.27, 0.85, 18), std({ color: 0x2c6e3f, roughness: 0.6 }), M(x + 1.3, 0.425, z + 0.1)); }
  const coneM = std({ color: 0xff5a12, roughness: 0.55 });
  for (const [x, z] of [[36.8, -21.2], [37.6, -20.4], [36.2, -19.6]]) { put(cyl(0.025, 0.17, 0.7, 16), coneM, M(x, 0.37, z)); put(box(0.38, 0.03, 0.38), blackM, M(x, 0.015, z));
    put(cyl(0.11, 0.135, 0.08, 16), whitePaint, M(x, 0.36, z), { cast: false }); }
  // pedestrian barrier along the walkway where it reaches the dock area
  for (let x = 21.5; x <= 33.5; x += 1.5) put(cyl(0.04, 0.04, 1.1, 10), yellowM, M(x, 0.55, AIS.walkway.z1 + 0.25));
  for (const y of [0.55, 1.05]) put(cyl(0.035, 0.035, 12, 10).rotateZ(PI / 2), yellowM, M(27.5, y, AIS.walkway.z1 + 0.25));
  put(flat(12, AIS.walkway.z1 - AIS.walkway.z0), greenPaint, M(27.5, 0.002, AIS.walkway.z), { cast: false });

  // ---------------------------------------------------------------- the roof: trusses, purlins, deck, skylights, sprinklers, lamps
  const TR = [];
  for (let x = -36; x <= 36; x += 6) TR.push(x);
  for (const x of TR) {
    put(box(0.18, 0.18, Z1 - Z0), steelGrey, M(x, TRUSS, 0), { cast: false, group: "roof" });
    put(box(0.18, 0.18, Z1 - Z0), steelGrey, M(x, 11.75, 0), { cast: false, group: "roof" });
    for (let z = Z0 + 1; z < Z1 - 2; z += 2) {
      put(box(0.08, 11.75 - TRUSS, 0.08), steelGrey, M(x, (11.75 + TRUSS) / 2, z), { cast: false, group: "roof" });
      const L = Math.hypot(2, 11.75 - TRUSS), a = Math.atan2(2, 11.75 - TRUSS) * ((Math.round((z - Z0 - 1) / 2) % 2) ? 1 : -1);
      put(box(0.06, L, 0.06), steelGrey, M(x, (11.75 + TRUSS) / 2, z + 1, 0, a), { cast: false, group: "roof" });
    }
  }
  for (let z = Z0 + 1.5; z < Z1; z += 2.5) put(box(X1 - X0, 0.2, 0.08), galv, M(0, 11.88, z), { cast: false, group: "roof" });
  for (const z of [-20, -10, 0, 10, 20]) { put(cyl(0.09, 0.09, X1 - X0, 12).rotateZ(PI / 2), sprinklerM, M(0, 11.1, z), { cast: false, group: "roof" });
    for (let x = X0 + 3; x < X1; x += 3) put(cyl(0.015, 0.015, 0.4, 6), sprinklerM, M(x, 10.9, z), { cast: false, group: "roof" }); }
  // HVAC duct down the main aisle
  put(cyl(0.45, 0.45, X1 - X0 - 4, 24).rotateZ(PI / 2), galv, M(0, 10.0, -5.0), { cast: false, group: "roof" });
  for (let x = X0 + 4; x < X1 - 2; x += 4) put(cyl(0.47, 0.47, 0.06, 24).rotateZ(PI / 2), galv, M(x, 10.0, -5.0), { cast: false, group: "roof" });
  // deck with skylight strips (between trusses, over the aisles)
  { const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0), uv.getY(i) * (Z1 - Z0) / 4);
    const deck = new THREE.Mesh(g, std({ map: deckM.map, roughness: 0.6, metalness: 0.3, side: THREE.FrontSide })); deck.position.y = H; groups.roof.add(deck);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + 0.6, Z1 - Z0 + 0.6).rotateX(-PI / 2), std({ color: 0x8e9396, roughness: 0.8 })); top.position.y = H + 0.3; groups.roof.add(top); }
  for (let x = -33; x < 36; x += 6) for (const z of [-12.4, 0, 12.4]) {
    put(new THREE.PlaneGeometry(1.6, 4.0).rotateX(PI / 2), skyLightM, M(x, H - 0.02, z), { cast: false, group: "roof" });
    put(box(1.75, 0.08, 0.08), galv, M(x, H - 0.05, z - 2.0), { cast: false, group: "roof" }); put(box(1.75, 0.08, 0.08), galv, M(x, H - 0.05, z + 2.0), { cast: false, group: "roof" }); }
  // high-bay lamps on cables
  const lampXs = []; for (let x = -37; x <= 37; x += 6) lampXs.push(x);
  const LAMPY = 9.6, lamps = [];
  for (const x of lampXs) for (const z of [0, ...rackAisles]) lamps.push([x, z]);
  for (const x of [25, 31, 37]) for (const z of [-21, -15, -9, 9, 15, 21]) lamps.push([x, z]);
  for (const [x, z] of lamps) {
    put(cyl(0.12, 0.2, 0.2, 16), steelDark, M(x, LAMPY + 0.22, z), { cast: false, group: "roof" });
    put(cyl(0.2, 0.34, 0.22, 20, 1, true), galv, M(x, LAMPY, z), { cast: false, group: "roof" });
    put(new THREE.CircleGeometry(0.32, 20).rotateX(PI / 2), lampLight, M(x, LAMPY - 0.116, z), { cast: false, group: "roof" });
    put(cyl(0.008, 0.008, TRUSS - LAMPY - 0.3, 4), steelDark, M(x, (TRUSS + LAMPY + 0.3) / 2, z), { cast: false, group: "roof" });
    const r = Math.abs(z) < 0.1 || x > 21 ? 4.2 : 3.0;
    put(flat(r * 2, r * 2), poolM, M(x, 0.008, z), { cast: false, recv: false });
  }
  for (const d of docks) if (d.state === "open" || d.state === "half") put(flat(8, 5), dayPoolM, M(X1 - 3.0, 0.009, d.z), { cast: false, recv: false });

  flush();

  // ---------------------------------------------------------------- the forklift (forks toward local +z)
  const forklift = new THREE.Group(); scene.add(forklift);
  const carriage = new THREE.Group(); forklift.add(carriage);
  const fkBody = std({ color: 0xf0a80e, roughness: 0.42, metalness: 0.2 }), fkDark = std({ color: 0x2a2c2f, roughness: 0.5, metalness: 0.5 });
  const fkSeat = std({ color: 0x141516, roughness: 0.75 }), fkHub = std({ color: 0xc9cbcc, roughness: 0.4, metalness: 0.7 });
  const fm = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0, parent = forklift) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz, "YXZ"); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  fm(box(0.66, 0.55, 1.7), fkDark, 0, 0.47, -0.05);                   // chassis between the wheels
  fm(box(1.12, 0.22, 1.7), fkBody, 0, 0.8, -0.05);                    // body and fenders over the wheels
  fm(box(1.12, 0.78, 0.5), fkDark, 0, 0.62, -1.08);                   // counterweight
  fm(cyl(0.39, 0.39, 1.12, 24).rotateZ(PI / 2), fkDark, 0, 0.62, -1.25);
  fm(box(1.0, 0.16, 1.0), fkBody, 0, 0.95, -0.45);                    // hood
  fm(box(0.5, 0.12, 0.48), fkSeat, 0, 1.09, -0.45); fm(box(0.5, 0.5, 0.1), fkSeat, 0, 1.38, -0.7, 0, -0.15);
  fm(box(0.5, 0.42, 0.3), fkBody, 0, 1.05, 0.42);                     // dash
  fm(cyl(0.03, 0.03, 0.4, 8), fkDark, 0, 1.38, 0.32, 0, -0.5);
  fm(new THREE.TorusGeometry(0.15, 0.018, 8, 24), fkSeat, 0, 1.55, 0.25, 0, -1.1);
  for (const sx of [-0.5, 0.5]) { fm(box(0.06, 1.32, 0.06), fkDark, sx, 1.53, 0.6, 0, -0.06); fm(box(0.06, 1.25, 0.06), fkDark, sx, 1.6, -0.85); }
  fm(box(1.06, 0.05, 1.55), fkDark, 0, 2.2, -0.12);
  for (let k = 0; k < 5; k++) fm(box(1.0, 0.03, 0.03), fkDark, 0, 2.23, -0.75 + k * 0.32);
  fm(cyl(0.06, 0.07, 0.1, 12), std({ color: 0xff8a10, emissive: 0xff6a00, emissiveIntensity: 0.8 }), 0.38, 2.29, -0.75);
  fm(box(0.12, 0.08, 0.04), lampLight, 0.47, 2.12, 0.64);
  for (const sx of [-0.3, 0.3]) fm(box(0.09, 2.5, 0.12), fkDark, sx, 1.3, 0.88);   // mast
  for (const y of [0.2, 1.35, 2.5]) fm(box(0.66, 0.08, 0.08), fkDark, 0, y, 0.88);
  fm(cyl(0.04, 0.04, 1.4, 10), steelGrey, 0, 0.95, 0.8);                // lift cylinder
  fm(box(1.0, 0.5, 0.06), fkDark, 0, 0.3, 1.0, 0, 0, 0, carriage);     // carriage plate
  for (let k = 0; k < 6; k++) fm(box(0.03, 0.62, 0.03), fkDark, -0.45 + k * 0.18, 0.86, 1.0, 0, 0, 0, carriage);
  fm(box(1.0, 0.04, 0.04), fkDark, 0, 1.17, 1.0, 0, 0, 0, carriage);
  for (const sx of [-0.3, 0.3]) { fm(box(0.12, 0.5, 0.05), fkDark, sx, 0.25, 1.06, 0, 0, 0, carriage); fm(box(0.12, 0.045, 1.15), fkDark, sx, 0.025, 1.63, 0, 0, 0, carriage); }
  const fLoad = new THREE.Group(); carriage.add(fLoad); fLoad.position.set(0, 0.05, 1.65);
  { const pal = new THREE.Mesh(palletGeo, woodM); pal.rotation.y = PI / 2; pal.castShadow = pal.receiveShadow = true; fLoad.add(pal);
    const w = new THREE.Mesh(unit, wrapM); w.scale.set(0.98, 1.1, 1.16); w.position.y = 0.144 + 0.55; w.castShadow = w.receiveShadow = true; fLoad.add(w); }
  const wheels = [];
  for (const [z, r, wdt] of [[0.62, 0.33, 0.24], [-0.55, 0.28, 0.2]]) for (const sx of [-0.5, 0.5]) {
    const wg = new THREE.Group(); wg.position.set(sx, r, z); forklift.add(wg);
    fm(cyl(r, r, wdt, 24).rotateZ(PI / 2), rubberM, 0, 0, 0, 0, 0, 0, wg); fm(cyl(r * 0.55, r * 0.55, wdt + 0.01, 16).rotateZ(PI / 2), fkHub, 0, 0, 0, 0, 0, 0, wg);
    for (let k = 0; k < 4; k++) fm(box(wdt + 0.02, r * 0.12, r * 1.0), fkDark, 0, 0, 0, 0, k * PI / 4, 0, wg);
    wheels.push({ g: wg, r });
  }
  const FK = { x: 30, z: -5.6, heading: -PI / 2, lift: 0.15, load: true };

  // ---------------------------------------------------------------- light
  const sunDir = new V3(0.28, 1.0, 0.42).normalize();
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.1); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3; scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xe8edf2, 0x8f8a82, 0.85); scene.add(hemi);
  for (const d of docks) if (d.state === "open" || d.state === "half") { const pl = new THREE.PointLight(0xe6efff, d.state === "half" ? 60 : 150, 30, 2); pl.position.set(X1 - 1.0, 2.2, d.z); scene.add(pl); }

  // ---------------------------------------------------------------- people
  const castMap = {}; castList.forEach((c, i) => { castMap[c.key] = figs[i]; scene.add(figs[i].object); });
  const crowdFigs = crowdList.map((c, i) => { const f = figs[castList.length + i]; scene.add(f.object); return { ...c, fig: f }; });
  const footOf = (f, side) => { let b = null; f.object.traverse((o) => { if (!b && o.isBone && new RegExp(side + "Foot$", "i").test(o.name)) b = o; }); return b; };
  function gaitOf(f) {
    const out = {}; const L = footOf(f, "Left"), R = footOf(f, "Right");
    for (const g of ["walk", "run", "jog"]) {
      if (!f.actions[g]) continue;
      if (!L || !R) { out[g] = { walk: 1.35, run: 3.6, jog: 2.6 }[g]; continue; }
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
    f.pose(0, f.actions.idle ? { idle: 1 } : undefined); return out;
  }
  const gaitSpeed = {}; for (const c of castList) gaitSpeed[c.key] = gaitOf(castMap[c.key]);
  crowdFigs.forEach((c) => { c.speed = c.clip === "walk" ? (gaitOf(c.fig).walk || 1.3) : 0; });
  const spot = new V3(-6, 0, AIS.walkway.z);

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
    castList.forEach((c, i) => poseFig(castMap[c.key], people[c.key] || {}, time, { x: spot.x + i * 0.9, z: spot.z - i * 0.1, heading: i ? -PI / 2 : PI / 2 }));
    const cr = st.crowd;
    crowdFigs.forEach((c, i) => {
      const s = cr === false ? { show: false } : (cr && (cr[i] || cr[c.id])) || {};
      const tt = s.time ?? time, hd = s.heading ?? c.heading;
      let x = s.x ?? c.x, z = s.z ?? c.z;
      if (s.x === undefined && c.speed) { x += Math.sin(hd) * c.speed * tt; z += Math.cos(hd) * c.speed * tt; }
      const inside = x > X0 + 1 && x < X1 - 1 && z > Z0 + 1 && z < Z1 - 1;
      poseFig(c.fig, { clip: c.clip, ...s, x, z, heading: hd, show: s.show ?? inside }, tt + 0.7 * i + 1.3, c);
    });
    // forklift
    const fk = { ...FK, ...(st.forklift || {}) };
    forklift.visible = fk.show !== false;
    forklift.position.set(fk.x, 0, fk.z); forklift.rotation.set(0, fk.heading, 0);
    carriage.position.y = Math.max(0, Math.min(2.6, fk.lift));
    fLoad.visible = fk.load !== false;
    const roll = fk.roll ?? (fk.x * Math.sin(fk.heading) + fk.z * Math.cos(fk.heading));
    for (const w of wheels) w.g.rotation.x = roll / w.r;
    // roof off for a camera above it
    groups.roof.visible = st.roof ?? !(camera.position.y > H - 0.2);
    const lead = castMap[castList[0]?.key]?.object;
    const f = st.focus ? _f.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : lead ? _f.copy(lead.position) : _f.set(0, 0, 0);
    const R = st.shadowRadius ?? Math.min(60, Math.max(10, camera.position.distanceTo(f) * 1.1));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 200 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sunDir, 80); sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: castMap[castList[0]?.key]?.object, crowd: crowdFigs, gaitSpeed, spot,
    aisle: AIS, crossAisle: CROSS, rackAisles, racks, columns: COLS, docks, staging: STG, exit: EXIT,
    forklift: { object: forklift, carriage, lift: FK.lift, length: 3.4, width: 1.15, defaults: { ...FK } },
    sun, sunDir: sunDir.clone(), H, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1 }, roofGroup: groups.roof,
  };
}
