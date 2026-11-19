// World "park": a city park on a sunny afternoon. A wide mown lawn crossed west to east by a paved promenade
// (light concrete slabs between kerbs) with benches, litter bins and lamp posts along its north side; leafy trees on
// the lawn and a dense belt of them round the edge; flower beds; a round pond with a stone rim, a paved apron,
// benches and a three-tier fountain throwing water; a playground far off on the south lawn (sand, swings, a slide,
// a climbing frame, a seesaw); a low stone wall, then a road and city buildings rising beyond the trees, in haze.
// People walk and jog the path; a couple strolls the lawn; two people stand talking by the pond.
//
// Axes (metres): +x is EAST (the way the main path leads), +y up, +z SOUTH, -z NORTH.
// The main path runs the whole park along x (x = -178 .. 178), its centre line z = pathZ(x) (within +-2.5 m of
// z = 0), PATH_HALF = 1.9 m each side of it, surface at y = PAVE_Y (0.03). Lanes: the main person walks at
// z = pathZ(x) + LANE.main (+0.45, the south half); the crowd uses LANE.walk (-0.55) and LANE.jog (-1.35).
// North of the path (z = pathZ - 3.1): benches facing the path every ~16 m, lamp posts and bins between them,
// clipped shrubs behind. SOUTH of the path, for x in [-110, 110], nothing taller than a flower stands within 9 m of
// the path: a camera can track a walker side on from the south at 2 to 9 m, looking north at the pond and fountain.
// POND {x: 22, z: -27, r: 10}: water at y = -0.3, rim to r 10.6 (top y 0.3), paved apron to r 13.5; a spur path
// joins it to the main path (x = 22). PLAY {x: -62, z: 46}: the playground (22 x 16 m of sand), joined by a spur
// path at x = -62. The park ends at |x| = 180, |z| = 130 (a low wall); road and buildings beyond, up to ~150 m tall.
// The Sun is in the south-west, about 40 degrees up: a camera south of the path looking north sees people lit
// three-quarter front; looking south or west is looking towards the light.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], crowd = true}) -> world.
//   cast: library characters, strings or {id, outfit: {shirt, trousers}, as} (outfit for man and woman only);
//   each is exposed as world.cast.<as || id>. The first is the main person. crowd false skips the background people.
//   Per frame: set world.camera (position, lookAt, fov), call world.update(state), then world.render(opts)
//   (or world.renderer.render(world.scene, world.camera)).
//
// state (every field optional):
//   time          seconds of the shot: drives the fountain, the water and, by default, every animation clock
//   people        {<cast name>: {x, z, heading, time, gait: {walk, run, jog}, show}}. z defaults to the main lane,
//                 pathZ(x) + LANE.main; y is always the surface there (path, apron or lawn). heading radians about
//                 +y, 0 faces +z (south), PI/2 faces east; default faces east along the path. gait weights 0..1
//                 (idle gets the rest); move x by world.gaitSpeed[name].walk * walk (m/s) so feet never slide.
//                 time = that person's animation clock (default state.time). show false hides. Cast members not
//                 named are hidden. With no people at all the first cast member idles at SPOT.
//   crowd         0 hides the background people, 1 shows them (default 1)
//   crowdTime     seconds the background people have moved (default state.time); offset it per shot to vary them
//   focus         {x, y, z} centre of the sun's shadow box (default the first visible person, else the camera target)
//   shadowRadius  metres of that box (default from the camera's distance, 16..140)
//   haze          multiplier of the haze density (default 1; 0.6 clears the air for a high view)
//
// render(opts): opts.blur 0..1 is a shallow depth of field (0 = none, 1 = strong), opts.focusDistance metres from
// the camera to keep sharp (default: distance to the main person). For the close shot: subject sharp, park soft.
//
// Exposes: world.cast.<name> (loadFigure results: object, pose, height), world.person (the first's object),
// world.gaitSpeed[name] {walk, run, jog} m/s, world.pathZ(x), world.pathAt(x) -> {x, y, z, heading},
// world.groundY(x, z) (the surface height anywhere), world.POND, world.FOUNTAIN (Vector3, top of the jet),
// world.PLAY, world.SPOT (Vector3 on the main lane at x = -6), world.LANE, world.PATH_HALF, world.PAVE_Y,
// world.benches / world.lamps (arrays of {x, z, heading}), world.trees (array of {x, z, h, r}), world.crowd (the
// background people: {name, object, x, z} after update), world.sun (DirectionalLight), world.sunDir (unit Vector3
// towards the Sun), world.water (Mesh), world.BOUNDS {x0, x1, z0, z1} of the park.
import { loadFigure, loadProp } from "../lib/figure.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], crowd = true }) {
  if (typeof cast === "string") cast = [cast];
  if (!cast || !cast.length) cast = ["woman"];
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const W = canvas.width || 1920, H = canvas.height || 1080;

  // ---------------------------------------------------------------- renderer, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.2, 3000);
  camera.position.set(-20, 3, 14); camera.lookAt(0, 1.5, 0);

  // ---------------------------------------------------------------- deterministic random and noise
  let seed = 7331;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.03, y * 2.03) * 0.28 + vnoise(x * 4.1, y * 4.1) * 0.17;
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- the layout
  const BOUNDS = { x0: -180, x1: 180, z0: -130, z1: 130 };
  const PATH_HALF = 1.9, PAVE_Y = 0.03, LANE = { main: 0.45, walk: -0.55, jog: -1.35 };
  const pathZ = (x) => 2.0 * Math.sin(0.021 * x + 0.5) + 0.5 * Math.sin(0.057 * x);
  const pathDZ = (x) => 2.0 * 0.021 * Math.cos(0.021 * x + 0.5) + 0.5 * 0.057 * Math.cos(0.057 * x);
  const POND = { x: 22, z: -27, r: 10, rim: 10.6, apron: 13.5, water: -0.3 };
  const PLAY = { x: -62, z: 46, w: 22, d: 16 };
  const SPURS = [ // straight side paths: {x, z0, z1, half}
    { x: POND.x, z0: pathZ(POND.x) - PATH_HALF + 0.05, z1: POND.z + POND.apron - 0.4, half: 1.3 },
    { x: PLAY.x, z0: pathZ(PLAY.x) + PATH_HALF - 0.05, z1: PLAY.z - PLAY.d / 2 - 0.2, half: 1.3 },
  ];
  const STROLL_Z = -9.5;  // the couple's line across the north lawn (kept clear of trees and shrubs)
  const BEDS = [ // flower beds: ellipses {x, z, rx, rz}
    { x: -36, z: pathZ(-36) + 11.5, rx: 6.5, rz: 2.0 }, { x: 4, z: pathZ(4) + 12.0, rx: 7.5, rz: 2.2 },
    { x: 46, z: pathZ(46) + 11.0, rx: 6.0, rz: 2.0 }, { x: 86, z: pathZ(86) + 11.5, rx: 6.5, rz: 2.0 },
    { x: POND.x - 5.2, z: pathZ(POND.x) - 6.2, rx: 2.8, rz: 1.5 }, { x: POND.x + 5.2, z: pathZ(POND.x) - 6.2, rx: 2.8, rz: 1.5 },
    { x: -62 - 6, z: pathZ(-62) + 6.5, rx: 2.6, rz: 1.4 }, { x: -62 + 6, z: pathZ(-62) + 6.5, rx: 2.6, rz: 1.4 },
  ];
  const dPath = (x, z) => (x < BOUNDS.x0 - 2 || x > BOUNDS.x1 + 2 ? 1e3 : Math.abs(z - pathZ(x)));
  const dPond = (x, z) => Math.hypot(x - POND.x, z - POND.z);
  const dPlay = (x, z) => Math.max(Math.abs(x - PLAY.x) - PLAY.w / 2, Math.abs(z - PLAY.z) - PLAY.d / 2, 0) +
    Math.min(0, Math.max(Math.abs(x - PLAY.x) - PLAY.w / 2, Math.abs(z - PLAY.z) - PLAY.d / 2));
  const dSpur = (x, z) => Math.min(...SPURS.map((s) => {
    const lo = Math.min(s.z0, s.z1), hi = Math.max(s.z0, s.z1);
    return Math.hypot(Math.abs(x - s.x), Math.max(0, lo - z, z - hi));
  }) );
  const inBed = (x, z, pad = 0) => BEDS.some((b) => ((x - b.x) / (b.rx + pad)) ** 2 + ((z - b.z) / (b.rz + pad)) ** 2 < 1);
  const paved = (x, z) => dPath(x, z) < PATH_HALF || (dPond(x, z) > POND.rim - 0.01 && dPond(x, z) < POND.apron) ||
    SPURS.some((s) => Math.abs(x - s.x) < s.half && z > Math.min(s.z0, s.z1) && z < Math.max(s.z0, s.z1));
  // the lawn: flat where people walk, gentle swells further out, a dish under the pond
  const hillsAt = (x, z) => {
    const k = sstep(5, 22, dPath(x, z)) * sstep(POND.apron + 1, POND.apron + 14, dPond(x, z)) * sstep(3, 16, dPlay(x, z))
      * sstep(2, 10, dSpur(x, z)) * (1 - sstep(BOUNDS.x1 - 12, BOUNDS.x1 - 2, Math.abs(x))) * (1 - sstep(BOUNDS.z1 - 12, BOUNDS.z1 - 2, Math.abs(z)));
    return Math.max(0, fbm(x * 0.012 + 4.1, z * 0.012 - 2.3) * 1.4 + fbm(x * 0.05, z * 0.05) * 0.2 + 0.7) * k;
  };
  const groundRaw = (x, z) => {
    const dp = dPond(x, z);
    if (dp < POND.rim) return -0.95 + 0.35 * sstep(POND.r - 3, POND.r, dp);
    if (paved(x, z)) return -0.05;
    return hillsAt(x, z) + 0.02 + fbm(x * 0.7, z * 0.7) * 0.012;
  };
  // the surface a foot stands on
  const groundY = (x, z) => {
    const dp = dPond(x, z);
    if (dp < POND.rim && dp > POND.r) return 0.3;
    if (paved(x, z)) return PAVE_Y;
    return Math.max(0, groundRaw(x, z));
  };
  const pathAt = (x) => ({ x, y: PAVE_Y, z: pathZ(x), heading: Math.atan2(1, pathDZ(x)) });

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f) => new Promise((res, rej) => TL.load(f, res, undefined, rej));
  const img = (f) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = f; });
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`${K}pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const LIB = new URL("../lib/", import.meta.url).href;
  const hdrL = new HDRLoader(); hdrL.setDataType(THREE.FloatType);

  // the cast: names, ids, outfits
  const CASTS = cast.map((c) => (typeof c === "string" ? { id: c, as: c } : { id: c.id, outfit: c.outfit || null, as: c.as || c.id }));
  const clipsFor = (id) => (id === "man" || id === "woman" ? ["idle", "walk", "run", "jog"] : ["idle", "walk", "run"]);
  // the background people: dressed in colours that are never the main person's
  const mainShirt = new THREE.Color(CASTS[0].outfit?.shirt || (CASTS[0].id === "woman" ? "#f2f2f2" : "#222428"));
  const mainTrou = new THREE.Color(CASTS[0].outfit?.trousers || "#1a1a1c");
  const far = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) > 0.35;
  const SHIRTS = ["#c0392b", "#2f6fdd", "#2e8b57", "#e0a526", "#8e44ad", "#e67e22", "#16a0a0", "#d2577a", "#5b6abf", "#7fae3a"]
    .filter((c) => far(new THREE.Color(c), mainShirt));
  const TROUS = ["#3b4a6b", "#6b5a45", "#4a5a3a", "#5e5e66", "#8a7a5a", "#2f4f6f", "#7a4a3a"].filter((c) => far(new THREE.Color(c), mainTrou));
  const CROWD = crowd ? [
    { name: "jogger", id: "man", clip: "jog", kind: "path", lane: LANE.jog, dir: 1, x0: -34 },
    { name: "walker", id: "woman", clip: "walk", kind: "path", lane: LANE.walk, dir: -1, x0: 34 },
    { name: "walker2", id: "man", clip: "walk", kind: "path", lane: LANE.walk, dir: -1, x0: 92 },
    { name: "stroller1", id: "woman", clip: "walk", kind: "lawn", z: STROLL_Z + 0.42, dir: -1, x0: 46 },
    { name: "stroller2", id: "man", clip: "walk", kind: "lawn", z: STROLL_Z - 0.42, dir: -1, x0: 46 },
    { name: "talker1", id: "woman", clip: "talk", kind: "stand", x: POND.x + 5.4, z: POND.z + 11.7 },
    { name: "talker2", id: "man", clip: "idle", kind: "stand", x: POND.x + 6.5, z: POND.z + 11.1 },
    { name: "parent", id: "woman", clip: "idle", kind: "stand", x: PLAY.x + 8, z: PLAY.z - PLAY.d / 2 - 1.6 },
  ] : [];
  CROWD.forEach((c, i) => { c.outfit = { shirt: SHIRTS[(i * 3) % SHIRTS.length], trousers: TROUS[(i * 2 + 1) % TROUS.length] }; });

  const PROP_IDS = ["painted_wooden_bench", "street_lamp_01", "metal_trash_can", "flower_gazania", "celandine_01",
    "grass_medium_01", "wooden_picnic_table"];
  const [skyTex, CONC, ASPH, ROCK, BRICK, LEAVES, BARK_D, BARK_N, props, figs, crowdFigs] = await Promise.all([
    hdrL.loadAsync(K + "sky/day.hdr"), pbrSet("concrete"), pbrSet("asphalt"), pbrSet("rock"), pbrSet("brick"),
    img(LIB + "props/island_tree_01/textures/island_tree_01_leaves_diff_1k.jpg"),
    tex(LIB + "props/pine_tree_01/textures/pine_tree_01_bark_diff_1k.jpg"),
    tex(LIB + "props/pine_tree_01/textures/pine_tree_01_bark_nor_gl_1k.jpg"),
    Promise.all(PROP_IDS.map((id) => loadProp({ THREE, id }))),
    Promise.all(CASTS.map((c) => loadFigure({ THREE, id: c.id, clips: clipsFor(c.id), outfit: c.outfit }))),
    Promise.all(CROWD.map((c) => loadFigure({ THREE, id: c.id, clips: [...new Set(["idle", c.clip])], outfit: c.outfit }))),
  ]);
  const P = Object.fromEntries(PROP_IDS.map((id, i) => [id, props[i]]));
  for (const t of [BARK_D, BARK_N]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  BARK_D.colorSpace = THREE.SRGBColorSpace;

  // how fast each clip carries its figure (from the clip's own hips travel, before it is put on the spot)
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const metaCache = {};
  async function clipSpeed(id, name, fallback) {
    try {
      const meta = metaCache[id] || (metaCache[id] = await (await fetch(`${LIB}characters/${id}/character.json`)).json());
      const src = meta.clips[name]; if (!src || src.startsWith("@")) return fallback;
      const g = await new GLTFLoader().loadAsync(`${LIB}characters/${id}/${src}`);
      const c = g.animations[0]; const tr = c.tracks.find((t) => /hips\.position$/i.test(t.name)); if (!tr) return fallback;
      const v = tr.values, n = v.length / 3, dist = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]);
      const hipH = Math.abs(v[1]) || 1, s = dist / hipH * 0.98 * (meta.height || 1.75) / 1.72;
      const sp = s / (tr.times[n - 1] - tr.times[0]);
      return sp > 0.3 && sp < 12 ? sp : fallback;
    } catch (e) { return fallback; }
  }
  const speedCache = {};
  const speedOf = (id, clip, fb) => (speedCache[id + clip] ||= clipSpeed(id, clip, fb));
  const gaitSpeed = {};
  await Promise.all(CASTS.map(async (c) => {
    gaitSpeed[c.as] = { walk: await speedOf(c.id, "walk", 1.4), run: await speedOf(c.id, "run", 5.0), jog: await speedOf(c.id, "jog", 2.8) };
  }));
  await Promise.all(CROWD.map(async (c) => { c.speed = c.kind === "stand" ? 0 : await speedOf(c.id, c.clip, c.clip === "jog" ? 2.8 : 1.4); }));

  // ---------------------------------------------------------------- sky, sun, haze
  // find the Sun in the HDR and turn the sky so it sits where this world's sunlight comes from
  const SUN_AZ = Math.atan2(0.62, -0.78);          // from the south-west (x west, z south)
  let skyRot = 0, hazeCol = new THREE.Color(0.75, 0.8, 0.86);
  {
    const { data, width: SW, height: SH } = skyTex.image;
    let best = -1, bi = 0; const hor = [0, 0, 0]; let hn = 0;
    for (let r = 0; r < SH; r++) for (let c = 0; c < SW; c++) {
      const i = (r * SW + c) * 4, L = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (L > best) { best = L; bi = r * SW + c; }
      const el = (0.5 - (r + 0.5) / SH) * PI;
      if (el > 0.03 && el < 0.18 && L < 4) { hor[0] += data[i]; hor[1] += data[i + 1]; hor[2] += data[i + 2]; hn++; }
    }
    const c = bi % SW, u = (c + 0.5) / SW, phi = (u - 0.5) * 2 * PI;
    const dTex = new V3(Math.cos(phi), 0, Math.sin(phi));
    skyRot = Math.atan2(dTex.z, dTex.x) - SUN_AZ;
    if (hn) { hazeCol.setRGB(hor[0] / hn, hor[1] / hn, hor[2] / hn); const m = Math.max(hazeCol.r, hazeCol.g, hazeCol.b); hazeCol.multiplyScalar(0.92 / m); }
  }
  const SUN_EL = 0.70;
  const sunDir = new V3(Math.cos(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), Math.sin(SUN_AZ) * Math.cos(SUN_EL)).normalize();
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = skyTex; scene.environment = skyTex;
  scene.backgroundRotation.set(0, skyRot, 0); scene.environmentRotation.set(0, skyRot, 0);
  scene.backgroundIntensity = 0.95; scene.environmentIntensity = 0.75;
  const HAZE_D = 0.0034;
  scene.fog = new THREE.FogExp2(hazeCol.clone().lerp(new THREE.Color(0.78, 0.84, 0.9), 0.3), HAZE_D);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5a6a3a, 0.35); scene.add(hemi);

  // ---------------------------------------------------------------- batching helpers
  const bins = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();
  const mat4 = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(sx, sy, sz)).clone();
  function put(geo, mat, m4, cast = true, recv = true) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()); if (m4) g.applyMatrix4(m4);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.color) { const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(1); g.setAttribute("color", new THREE.BufferAttribute(c, 3)); }
    const key = mat.uuid + (cast ? "c" : "") + (recv ? "r" : "");
    if (!bins.has(key)) bins.set(key, { mat, cast, recv, list: [] });
    bins.get(key).list.push(g);
  }
  const meshes = [];
  function flush() {
    for (const b of bins.values()) {
      for (let i = 0; i < b.list.length; i += 3000) {
        const g = mergeGeometries(b.list.slice(i, i + 3000), false);
        const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
        mesh.matrixAutoUpdate = false; scene.add(mesh); meshes.push(mesh);
      }
    }
    bins.clear();
  }
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const putBox = (mat, x, y, z, w, h, d, ry = 0, cast = true, rx = 0, rz = 0) => put(UNIT, mat, mat4(x, y, z, ry, rx, rz, w, h, d), cast);
  // a box whose UVs are metres / tile, so one tiling surface fits any size
  function tbox(w, h, d, tu, tv = tu) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tu, uv.getY(i) * dims[f][1] / tv); }
    return g;
  }
  const dummy = new THREE.Object3D();
  function partsOf(obj) {
    obj.updateMatrixWorld(true);
    const out = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.computeBoundingBox();
      const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.computeBoundingBox();
      const mt = o.material.clone();
      out.push({ geo: g, mat: mt, size: g.boundingBox.getSize(new V3()) });
    });
    return out;
  }
  function instanced(part, list, { shadow = true, receive = true, colors = null } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors) { colors.forEach((c, i) => im.setColorAt(i, c)); im.instanceColor.needsUpdate = true; }
    im.castShadow = shadow; im.receiveShadow = receive; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    scene.add(im); return im;
  }
  // a whole prop placed many times (every mesh of it instanced)
  function placeProp(obj, list) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const ms = list.map((m) => m.clone().multiply(o.matrixWorld));
      const im = new THREE.InstancedMesh(o.geometry, o.material, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      scene.add(im);
    });
  }

  // ---------------------------------------------------------------- canvas textures
  const canvasTex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  // mown grass: fine blades in many greens, tiling
  function grassTex() {
    const S = 512, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
    g.fillStyle = "#4f6b2a"; g.fillRect(0, 0, S, S);
    const greens = ["#3f5a22", "#56742e", "#5f7f33", "#6b8a3a", "#4a6626", "#7a9445", "#465f25", "#86a050", "#5a6e2c"];
    for (let i = 0; i < 26000; i++) {
      const x = rnd() * S, y = rnd() * S, L = rr(3, 9), a = rr(-0.9, 0.9) - PI / 2;
      g.strokeStyle = pick(greens); g.lineWidth = rr(0.8, 1.8); g.globalAlpha = rr(0.5, 1);
      for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) {
        if (ox || oy) { if (x + ox < -10 || x + ox > S + 10 || y + oy < -10 || y + oy > S + 10) continue; }
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L); g.stroke();
      }
    }
    g.globalAlpha = 1;
    return canvasTex(c);
  }
  // grass blades on a transparent ground, for tufts along edges
  function bladeTex() {
    const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d");
    const greens = ["#4a6a24", "#5d7d2e", "#6f8f3c", "#3e5a1e", "#7d9a48"];
    for (let i = 0; i < 160; i++) {
      const x = rr(4, 252), h = rr(40, 124), lean = rr(-18, 18);
      g.strokeStyle = pick(greens); g.lineWidth = rr(1.5, 3.2); g.lineCap = "round";
      g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  // a spray of leaves (the island tree's photographed leaves) on a transparent ground; two variants side by side
  function leafAtlas() {
    const src = document.createElement("canvas"); src.width = LEAVES.width; src.height = LEAVES.height;
    const sg = src.getContext("2d", { willReadFrequently: true }); sg.drawImage(LEAVES, 0, 0);
    const d = sg.getImageData(0, 0, src.width, src.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = Math.max(p[i], p[i + 1], p[i + 2]); p[i + 3] = Math.max(0, Math.min(255, (l - 14) * 10)); }
    sg.putImageData(d, 0, 0);
    const SW = src.width / 1024;
    const leaves = [[20, 20, 130, 410], [170, 20, 175, 380], [370, 30, 125, 340], [530, 50, 135, 320], [710, 20, 130, 400],
      [15, 640, 175, 360], [220, 590, 145, 430], [430, 615, 145, 395]].map((r) => r.map((v) => v * SW));
    const S = 512, c = document.createElement("canvas"); c.width = S * 2; c.height = S; const g = c.getContext("2d");
    for (let v = 0; v < 2; v++) {
      const ox = v * S;
      g.save(); g.beginPath(); g.rect(ox, 0, S, S); g.clip();
      // twigs from the bottom centre out, leaves along them
      const twigs = [];
      for (let k = 0; k < 9; k++) {
        const a = -PI / 2 + rr(-1.25, 1.25), L = rr(150, 240), x0 = ox + S / 2 + rr(-20, 20), y0 = S - 10;
        twigs.push([x0, y0, x0 + Math.cos(a) * L * 1.1, y0 + Math.sin(a) * L * 1.7 + 20]);
      }
      g.strokeStyle = "#4b3a2a"; g.lineCap = "round";
      for (const [x0, y0, x1, y1] of twigs) { g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      const n = 120;
      for (let i = 0; i < n; i++) {
        const [x0, y0, x1, y1] = pick(twigs), t = Math.sqrt(rnd()) * 0.95 + 0.05;
        const x = x0 + (x1 - x0) * t + rr(-26, 26), y = y0 + (y1 - y0) * t + rr(-26, 26);
        if (Math.hypot(x - ox - S / 2, (y - S * 0.48) * 1.0) > S * 0.49) continue;
        const L = pick(leaves), sz = rr(58, 92), asp = L[2] / L[3];
        const ang = Math.atan2(y1 - y0, x1 - x0) + PI / 2 + rr(-1.1, 1.1) + (rnd() < 0.5 ? PI : 0);
        g.save(); g.translate(x, y); g.rotate(ang);
        const b = v ? rr(0.55, 0.8) : rr(0.8, 1.15);
        g.filter = `brightness(${b.toFixed(2)}) saturate(${rr(1.0, 1.4).toFixed(2)}) hue-rotate(${rr(-8, 18).toFixed(0)}deg)`;
        g.drawImage(src, L[0], L[1], L[2], L[3], -sz * asp / 2, -sz * 0.1, sz * asp, sz);
        g.restore();
      }
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  // facades: a grid of windows on a wall, one tile = 4 bays x 6 floors (12 m x 19.8 m)
  function facadeTex(style) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 1024; const g = c.getContext("2d");
    const st = [
      { wall: "#b9a58e", frame: "#e8e2d6", glass: ["#2c3a4a", "#3a4a5c", "#4a5a6a", "#22303c"], ww: 0.5, wh: 0.55 },
      { wall: "#8f5a46", frame: "#ddd5c4", glass: ["#26313b", "#323f4c", "#3d4652", "#1e2830"], ww: 0.45, wh: 0.55 },
      { wall: "#9fb0bf", frame: "#5d6b78", glass: ["#41607e", "#4f7090", "#38536e", "#5c7f9e"], ww: 0.9, wh: 0.78 },
      { wall: "#d9d6cf", frame: "#7a7a78", glass: ["#2a3846", "#38485a", "#465868", "#30404e"], ww: 0.62, wh: 0.6 },
      { wall: "#c7b796", frame: "#4a4038", glass: ["#2a2f36", "#373e46", "#444c55", "#22272d"], ww: 0.5, wh: 0.6 },
    ][style];
    g.fillStyle = st.wall; g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${rr(0.02, 0.06)})`; g.fillRect(rnd() * 512, rnd() * 1024, rr(2, 14), rr(2, 10)); }
    const bw = 128, fh = 1024 / 6;
    for (let f = 0; f < 6; f++) for (let b = 0; b < 4; b++) {
      const w = bw * st.ww, h = fh * st.wh, x = b * bw + (bw - w) / 2, y = f * fh + (fh - h) * 0.45;
      g.fillStyle = st.frame; g.fillRect(x - 5, y - 5, w + 10, h + 10);
      const grd = g.createLinearGradient(x, y, x + w * 0.6, y + h);
      const gc = pick(st.glass); grd.addColorStop(0, gc); grd.addColorStop(1, pick(st.glass));
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      if (rnd() < 0.35) { g.fillStyle = `rgba(230,225,210,${rr(0.25, 0.6)})`; g.fillRect(x, y, w * rr(0.2, 0.5), h); }
      g.fillStyle = st.frame; g.fillRect(x + w / 2 - 2, y, 4, h);
      if (style !== 2) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x - 6, y + h + 5, w + 12, 6); }
    }
    if (style === 2) for (let f = 0; f <= 6; f++) { g.fillStyle = st.frame; g.fillRect(0, f * fh - 6, 512, 12); }
    return canvasTex(c);
  }
  function streakTex() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 256; const g = c.getContext("2d");
    for (let i = 0; i < 140; i++) {
      const x = rnd() * 128, y = rnd() * 256, h = rr(30, 140);
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, `rgba(255,255,255,${rr(0.3, 0.9)})`); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(x, y, rr(1, 3.5), h); g.fillRect(x, y - 256, rr(1, 3.5), h);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function dotTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  // paving: the concrete photograph cut into 1.5 m slabs with dark joints (one tile = 3 m)
  function pavingTex() {
    const S = 1024, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
    g.drawImage(CONC.map.image, 0, 0, S, S);
    g.fillStyle = "rgba(255,248,235,0.12)"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,250,240"},${rr(0.02, 0.07)})`; g.fillRect(i * S / 2 + (j % 2) * S / 4, j * S / 2, S / 2, S / 2);
    }
    g.strokeStyle = "rgba(40,36,32,0.75)"; g.lineWidth = 5;
    for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(0, k * S / 2); g.lineTo(S, k * S / 2); g.stroke(); }
    for (let k = 0; k <= 2; k++) for (let j = 0; j < 2; j++) { const x = k * S / 2 + (j % 2) * S / 4; g.beginPath(); g.moveTo(x, j * S / 2); g.lineTo(x, (j + 1) * S / 2); g.stroke(); }
    return canvasTex(c);
  }

  // ---------------------------------------------------------------- materials
  const PAVING = pavingTex();
  const M = {
    pave: new THREE.MeshStandardMaterial({ map: PAVING, normalMap: CONC.normalMap, roughnessMap: CONC.roughnessMap, color: 0xe8e2d6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    kerb: std({ map: CONC.map, normalMap: CONC.normalMap, color: 0xa9a49c, roughness: 0.9 }),
    stone: std({ map: ROCK.map, normalMap: ROCK.normalMap, roughnessMap: ROCK.roughnessMap, color: 0xd9d0c0 }),
    coping: std({ map: CONC.map, normalMap: CONC.normalMap, color: 0xd8d0c2, roughness: 0.85 }),
    road: new THREE.MeshStandardMaterial({ map: ASPH.map, normalMap: ASPH.normalMap, roughnessMap: ASPH.roughnessMap, color: 0x8a8a8a }),
    sidewalk: std({ map: CONC.map, normalMap: CONC.normalMap, color: 0xcfcac0 }),
    brick: std({ ...BRICK, color: 0xb58a76 }),
    bark: std({ map: BARK_D, normalMap: BARK_N, color: 0xb8aca0, roughness: 0.95 }),
    soil: std({ map: ASPH.map, color: 0x4a3626, roughness: 1 }),
    sand: null,
    paintR: std({ color: 0xc8392e, roughness: 0.5, metalness: 0.1 }),
    paintY: std({ color: 0xe8b320, roughness: 0.5, metalness: 0.1 }),
    paintB: std({ color: 0x2c64b8, roughness: 0.5, metalness: 0.1 }),
    paintG: std({ color: 0x2f7d4a, roughness: 0.5, metalness: 0.1 }),
    steel: std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 }),
    iron: std({ color: 0x23262a, roughness: 0.5, metalness: 0.6 }),
    rubber: std({ color: 0x1d1d1f, roughness: 0.9 }),
    wood: std({ color: 0x8a5e3c, roughness: 0.8 }),
    roof: std({ map: CONC.map, color: 0x6c6862, roughness: 1 }),
    glassCar: std({ color: 0x1b2128, roughness: 0.05, metalness: 0.9 }),
    lily: std({ color: 0x3f6b2c, roughness: 0.6, side: THREE.DoubleSide }),
  };
  { const sm = new THREE.MeshStandardMaterial({ ...(await pbrSet("sand")), color: 0xf0e2c4 }); M.sand = sm; }

  // ---------------------------------------------------------------- the ground: one lawn, mowing stripes, worn edges
  {
    const GX0 = BOUNDS.x0 - 1, GX1 = BOUNDS.x1 + 1, GZ0 = BOUNDS.z0 - 1, GZ1 = BOUNDS.z1 + 1;
    const geo = new THREE.PlaneGeometry(GX1 - GX0, GZ1 - GZ0, Math.round((GX1 - GX0) / 0.8), Math.round((GZ1 - GZ0) / 0.8));
    geo.rotateX(-PI / 2); geo.translate((GX0 + GX1) / 2, 0, (GZ0 + GZ1) / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const base = new THREE.Color().setRGB(0.6, 0.66, 0.46), dry = new THREE.Color().setRGB(1.12, 1.02, 0.72), soil = new THREE.Color().setRGB(0.62, 0.52, 0.42);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, groundRaw(x, z));
      uv.setXY(i, x / 1.6, z / 1.6);
      // mowing stripes run along x, 4 m wide, a touch lighter and darker
      const stripe = Math.sin((z + 0.6 * Math.sin(x * 0.01)) * PI / 4) > 0 ? 1.07 : 0.93;
      c.copy(base).multiplyScalar(stripe * (0.86 + 0.24 * fbm(x * 0.05, z * 0.05) + 0.08 * fbm(x * 0.4, z * 0.4)));
      c.lerp(dry, sstep(0.25, 0.7, fbm(x * 0.02 + 9, z * 0.02 - 3)) * 0.45);
      // worn grass at the path edges and where people stand
      const de = dPath(x, z) - PATH_HALF;
      c.lerp(soil, (1 - sstep(0.0, 0.6 + 0.4 * fbm(x * 0.8, z), de)) * 0.35);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: grassTex(), vertexColors: true, roughness: 0.95, color: 0xffffff });
    const ground = new THREE.Mesh(geo, m); ground.receiveShadow = true; scene.add(ground);
    // the city floor outside the park: asphalt
    for (const [cx, cz, w, d] of [[0, -(GZ1 + 700) / 1, 1400 + 2 * GX1, 1400], [0, GZ1 + 700, 1400 + 2 * GX1, 1400], [-(GX1 + 700), 0, 1400, GZ1 * 2], [GX1 + 700, 0, 1400, GZ1 * 2]]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.road);
      { const u = road.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * w / 5, u.getY(i) * d / 5); }
      road.rotation.x = -PI / 2; road.position.set(cx, -0.02, cz); road.receiveShadow = true; scene.add(road);
    }
  }

  // ---------------------------------------------------------------- paths: ribbons along a curve, kerbs at their edges
  function ribbon(samples, profile, mat, uvScale = 3, closed = false, cast = false) {
    // samples: [{x, z, px, pz, s}] (point, unit perpendicular, distance along); profile: [[offset, y], ...] a polyline
    const pos = [], uvs = [], idx = [];
    const n = samples.length, segs = profile.length - 1;
    for (let k = 0; k < segs; k++) {
      const [o0, y0] = profile[k], [o1, y1] = profile[k + 1];
      const base = pos.length / 3;
      for (const s of samples) {
        pos.push(s.x + s.px * o0, y0, s.z + s.pz * o0, s.x + s.px * o1, y1, s.z + s.pz * o1);
        const across = Math.hypot(o1 - o0, y1 - y0);
        uvs.push(o0 / uvScale, s.s / uvScale, (o0 + across * Math.sign(o1 - o0 || 1)) / uvScale, s.s / uvScale);
      }
      for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      if (closed) { const a = base + (n - 1) * 2, b = base; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    }
    // the winding above faces up for a curve running +x with offsets towards +z; flip it for the other handedness
    const al = { x: samples[1].x + samples[1].px - samples[0].x - samples[0].px, z: samples[1].z + samples[1].pz - samples[0].z - samples[0].pz };
    if (al.z * samples[0].px - al.x * samples[0].pz > 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = cast; scene.add(mesh); return mesh;
  }
  const curveSamples = (x0, x1, step = 0.5) => {
    const out = []; let s = 0, prev = null;
    for (let x = x0; x <= x1 + 1e-6; x += step) {
      const z = pathZ(x), dz = pathDZ(x), L = Math.hypot(1, dz);
      if (prev) s += Math.hypot(x - prev.x, z - prev.z);
      prev = { x, z, px: -dz / L, pz: 1 / L, s }; out.push(prev);
    }
    return out;
  };
  const kerbProf = (o, w = 0.14, h = 0.1) => [[o - w / 2, -0.04], [o - w / 2, h], [o + w / 2, h], [o + w / 2, -0.04]];
  {
    // main promenade (z = pathZ(x) + px*o: +o is SOUTH)
    ribbon(curveSamples(BOUNDS.x0 - 1, BOUNDS.x1 + 1), [[-PATH_HALF, PAVE_Y], [PATH_HALF, PAVE_Y]], M.pave, 3);
    // kerbs: the north one broken at the pond spur, the south one at the playground spur
    const gaps = { n: [POND.x - 1.45, POND.x + 1.45], s: [PLAY.x - 1.45, PLAY.x + 1.45] };
    for (const [side, o] of [["n", -PATH_HALF - 0.07], ["s", PATH_HALF + 0.07]]) {
      const [g0, g1] = gaps[side];
      ribbon(curveSamples(BOUNDS.x0 - 1, g0), kerbProf(o).map(([a, b]) => [a, b]), M.kerb, 1);
      ribbon(curveSamples(g1, BOUNDS.x1 + 1), kerbProf(o), M.kerb, 1);
    }
    // spurs: straight
    for (const sp of SPURS) {
      const a = Math.min(sp.z0, sp.z1), b = Math.max(sp.z0, sp.z1), sm = [];
      for (let z = a; z <= b + 1e-6; z += 0.5) sm.push({ x: sp.x, z, px: 1, pz: 0, s: z - a });
      ribbon(sm, [[-sp.half, PAVE_Y], [sp.half, PAVE_Y]], M.pave, 3);
      ribbon(sm, kerbProf(-sp.half - 0.07), M.kerb, 1); ribbon(sm, kerbProf(sp.half + 0.07), M.kerb, 1);
    }
    // the pond: apron, rim (coping with an inner wall down to the bed)
    const ring = (r) => { const out = []; const N = 160; for (let i = 0; i < N; i++) { const a = (i / N) * 2 * PI; out.push({ x: POND.x, z: POND.z, px: Math.cos(a), pz: Math.sin(a), s: a * r }); } return out; };
    const cs = ring(POND.apron);
    ribbon(cs, [[POND.rim, PAVE_Y], [POND.apron, PAVE_Y]], M.pave, 3, true);
    ribbon(cs, [[POND.apron + 0.07 - 0.07, -0.04], [POND.apron, 0.09], [POND.apron + 0.14, 0.09], [POND.apron + 0.14, -0.04]], M.kerb, 1, true);
    ribbon(cs, [[POND.r, -1.0], [POND.r, 0.3], [POND.rim, 0.3], [POND.rim, PAVE_Y]], M.coping, 1, true);
  }

  // ---------------------------------------------------------------- the pond and the fountain
  let water, basinWater, curtains = [], spray, sprayData;
  const FOUNTAIN = new V3(POND.x, 3.2, POND.z);
  {
    const nor = ROCK.normalMap.clone(); nor.wrapS = nor.wrapT = THREE.RepeatWrapping; nor.repeat.set(6, 6); nor.needsUpdate = true;
    const wm = new THREE.MeshStandardMaterial({ color: 0x1d3a3c, roughness: 0.04, metalness: 0.2, normalMap: nor,
      normalScale: new THREE.Vector2(0.12, 0.12), envMapIntensity: 1.2, transparent: true, opacity: 0.92 });
    water = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.02, 96), wm);
    water.rotation.x = -PI / 2; water.position.set(POND.x, POND.water, POND.z); water.receiveShadow = true; scene.add(water);
    // lily pads near the rim
    const pad = new THREE.CircleGeometry(1, 18, 0.3, 2 * PI - 0.3); pad.rotateX(-PI / 2);
    for (let i = 0; i < 26; i++) {
      const a = rr(0, 2 * PI); if (Math.sin(a) > 0.5 && Math.cos(a) > -0.2) continue;
      const r = rr(7.4, 9.5), s = rr(0.18, 0.34);
      put(pad, M.lily, mat4(POND.x + Math.cos(a) * r, POND.water + 0.012, POND.z + Math.sin(a) * r, rr(0, 6.3), 0, 0, s, 1, s), false);
    }
    // the fountain: a stone basin wall, a fluted column, two bowls, a finial with the jet
    const F = (x) => x;
    const lath = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    put(lath([[3.0, -1.0], [3.0, 0.42], [3.12, 0.48], [3.12, 0.58], [2.7, 0.58], [2.7, 0.45], [2.7, -1.0]]), M.coping, mat4(POND.x, 0, POND.z));
    put(lath([[0.0, -1.0], [0.62, -1.0], [0.62, 0.3], [0.48, 0.4], [0.36, 0.55], [0.33, 1.2], [0.4, 1.32], [0.3, 1.42]]), M.coping, mat4(POND.x, 0, POND.z));
    // lower bowl: outside, rim, inside
    put(lath([[0.3, 1.36], [0.6, 1.4], [1.2, 1.5], [1.62, 1.66], [1.7, 1.78], [1.62, 1.8], [1.5, 1.72], [0.3, 1.6]]), M.coping, mat4(POND.x, 0, POND.z));
    put(lath([[0.0, 1.6], [0.18, 1.6], [0.17, 2.3], [0.24, 2.36], [0.14, 2.42]]), M.coping, mat4(POND.x, 0, POND.z));
    put(lath([[0.14, 2.38], [0.4, 2.42], [0.7, 2.52], [0.76, 2.6], [0.68, 2.62], [0.14, 2.56]]), M.coping, mat4(POND.x, 0, POND.z));
    put(lath([[0.0, 2.56], [0.09, 2.56], [0.12, 2.68], [0.06, 2.82], [0.0, 2.84]]), M.coping, mat4(POND.x, 0, POND.z));
    void F;
    // water standing in the basin and in the bowls
    const bw = (r, y, op = 0.9) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), wm.clone()); m.material.opacity = op; m.material.normalMap = nor.clone(); m.material.normalMap.needsUpdate = true; m.rotation.x = -PI / 2; m.position.set(POND.x, y, POND.z); m.receiveShadow = true; scene.add(m); return m; };
    basinWater = bw(2.7, 0.36);
    bw(1.52, 1.7); bw(0.66, 2.56);
    // falling curtains from each bowl's lip, their streaks running down
    const st = streakTex();
    const curtain = (pts, rep) => {
      const t = st.clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
      const m = new THREE.MeshStandardMaterial({ color: 0xeef6fb, map: t, alphaMap: t, transparent: true, opacity: 0.75, depthWrite: false,
        side: THREE.DoubleSide, roughness: 0.15, metalness: 0, emissive: 0x6a7a84, emissiveIntensity: 0.25 });
      const g = lath(pts, 64); const mesh = new THREE.Mesh(g, m); mesh.position.set(POND.x, 0, POND.z); mesh.renderOrder = 3; scene.add(mesh); curtains.push(mesh);
    };
    curtain([[1.71, 1.78], [1.78, 1.5], [1.86, 1.1], [1.92, 0.7], [1.95, 0.38]], 22);
    curtain([[0.77, 2.6], [0.82, 2.4], [0.88, 2.1], [0.92, 1.8], [0.93, 1.7]], 10);
    // spray: droplets thrown up from the finial falling into the top bowl, and splashes where the curtains land
    const N = 900, pos = new Float32Array(N * 3);
    sprayData = [];
    for (let i = 0; i < N; i++) {
      const top = i < 600;
      sprayData.push(top ? { top, ph: rnd(), a: rr(0, 2 * PI), vr: rr(0.15, 0.75), vy: rr(2.4, 3.3) }
        : { top, ph: rnd(), a: rr(0, 2 * PI), r: rnd() < 0.6 ? 1.95 : 0.93, vr: rr(0.1, 0.5), vy: rr(0.4, 1.0) });
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    spray = new THREE.Points(g, new THREE.PointsMaterial({ map: dotTex(), color: 0xf4fbff, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
    spray.frustumCulled = false; scene.add(spray);
    // a ring of rough stones at the inner foot of the rim
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * 2 * PI + rr(-0.02, 0.02), r = POND.r - rr(0.15, 0.5), s = rr(0.25, 0.5);
      put(new THREE.DodecahedronGeometry(1, 0), M.stone, mat4(POND.x + Math.cos(a) * r, POND.water - 0.12, POND.z + Math.sin(a) * r, rr(0, 6), rr(0, 6), 0, s, s * 0.6, s), false);
    }
  }

  // ---------------------------------------------------------------- benches, lamps, bins along the path; around the pond
  const benches = [], lamps = [], binsAt = [];
  {
    const along = [];
    for (let x = -150; x <= 150; x += 16) {
      if (Math.abs(x - POND.x) < 7) continue;
      along.push(x + rr(-1.2, 1.2));
    }
    const benchList = [], lampList = [], binList = [];
    for (const bx of along) {
      const z = pathZ(bx) - PATH_HALF - 1.05, dz = pathDZ(bx), ang = Math.atan2(dz, 1);
      benches.push({ x: bx, z, heading: -ang });
      benchList.push(mat4(bx, 0, z, -ang, 0, 0, 1.45, 1, 1.15));
      // a pad of paving under each bench
      put(tbox(2.3, 0.06, 1.5, 1.5), M.kerb, mat4(bx, 0.0, z - 0.1, -ang), false);
      if (rnd() < 0.6) { const x2 = bx + 1.6; binsAt.push({ x: x2, z: pathZ(x2) - PATH_HALF - 0.6 }); binList.push(mat4(x2, 0, pathZ(x2) - PATH_HALF - 0.6, rr(0, 6), 0, 0, 0.9, 0.9, 0.9)); }
      const lx = bx + 8; if (Math.abs(lx - POND.x) < 3 || lx > 160) continue;
      const lz = pathZ(lx) - PATH_HALF - 0.55;
      lamps.push({ x: lx, z: lz, heading: 0 }); lampList.push(mat4(lx, 0, lz, -Math.atan2(pathDZ(lx), 1), 0, 0, 1.15, 1.15, 1.15));
    }
    // benches round the pond apron facing the water (not where the spur arrives)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * PI + PI / 8; const dx = Math.cos(a), dz = Math.sin(a);
      if (dz > 0.85) continue;
      const r = POND.apron - 0.7, x = POND.x + dx * r, z = POND.z + dz * r;
      benches.push({ x, z, heading: Math.atan2(-dx, -dz) });
      benchList.push(mat4(x, PAVE_Y, z, Math.atan2(-dx, -dz), 0, 0, 1.45, 1, 1.15));
    }
    // a few lamps round the pond and at the playground spur
    for (const a of [PI * 0.15, PI * 0.85, PI * 1.5]) {
      const r = POND.apron - 0.3, x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
      lamps.push({ x, z, heading: 0 }); lampList.push(mat4(x, PAVE_Y, z, a, 0, 0, 1.15, 1.15, 1.15));
    }
    placeProp(P.painted_wooden_bench, benchList);
    placeProp(P.street_lamp_01, lampList);
    placeProp(P.metal_trash_can, binList);
    // picnic tables near the playground
    const pt = [];
    for (const [dx, dz] of [[-17, -2], [-16, 6], [16, 3]]) pt.push(mat4(PLAY.x + dx, groundY(PLAY.x + dx, PLAY.z + dz), PLAY.z + dz, rr(0, 3)));
    placeProp(P.wooden_picnic_table, pt);
  }

  // ---------------------------------------------------------------- the playground
  {
    const { x: px, z: pz, w, d } = PLAY;
    // sand, edged with timber
    const sg = tbox(w, 0.12, d, 2.5); put(sg, M.sand, mat4(px, 0.0, pz), false);
    for (const s of [-1, 1]) { putBox(M.wood, px, 0.1, pz + s * (d / 2 + 0.1), w + 0.4, 0.2, 0.2); putBox(M.wood, px + s * (w / 2 + 0.1), 0.1, pz, 0.2, 0.2, d); }
    const tube = (mat, a, b, r = 0.05) => {
      const A = new V3(...a), B = new V3(...b), L = A.distanceTo(B);
      const g = new THREE.CylinderGeometry(r, r, L, 10); const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
      m.compose(A.clone().add(B).multiplyScalar(0.5), q, new V3(1, 1, 1)); put(g, mat, m);
    };
    // swings: an A-frame at each end, a beam, three seats on chains
    const sx = px - 5, sz = pz - 3, beamY = 2.4, half = 3.2;
    for (const e of [-1, 1]) { tube(M.paintB, [sx + e * half, 0.06, sz - 1.0], [sx + e * half, beamY, sz]); tube(M.paintB, [sx + e * half, 0.06, sz + 1.0], [sx + e * half, beamY, sz]); }
    tube(M.paintB, [sx - half - 0.1, beamY, sz], [sx + half + 0.1, beamY, sz], 0.07);
    for (const k of [-2.0, 0, 2.0]) {
      for (const o of [-0.23, 0.23]) tube(M.steel, [sx + k + o, beamY, sz], [sx + k + o, 0.55, sz], 0.012);
      putBox(M.rubber, sx + k, 0.53, sz, 0.55, 0.05, 0.2);
    }
    // a slide: platform with a roof, ladder, chute
    const lx = px + 5, lz = pz - 2.5, ph = 1.6;
    for (const [a, b] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) tube(M.paintY, [lx + a, 0.06, lz + b], [lx + a, ph + 1.3, lz + b], 0.06);
    putBox(M.wood, lx, ph, lz, 1.3, 0.08, 1.3);
    put(new THREE.ConeGeometry(1.05, 0.7, 4, 1), M.paintR, mat4(lx, ph + 1.65, lz, PI / 4));
    for (let k = 0; k < 6; k++) putBox(M.steel, lx - 0.95, 0.27 * (k + 1), lz, 0.05, 0.04, 0.55);
    tube(M.steel, [lx - 0.95, 0.06, lz - 0.28], [lx - 0.95, ph + 0.9, lz - 0.28], 0.025); tube(M.steel, [lx - 0.95, 0.06, lz + 0.28], [lx - 0.95, ph + 0.9, lz + 0.28], 0.025);
    { // chute: a curved trough going +z
      const L = 3.2, prof = []; const shape = new THREE.Shape();
      shape.moveTo(-0.32, 0.12); shape.lineTo(-0.3, 0); shape.lineTo(0.3, 0); shape.lineTo(0.32, 0.12); shape.lineTo(0.28, 0.12); shape.lineTo(0.26, 0.04); shape.lineTo(-0.26, 0.04); shape.lineTo(-0.28, 0.12);
      const path = new THREE.CatmullRomCurve3([new V3(0, ph, 0.65), new V3(0, ph - 0.3, 1.4), new V3(0, 0.6, 2.9), new V3(0, 0.35, 3.6), new V3(0, 0.33, 4.0)]);
      const g = new THREE.ExtrudeGeometry(shape, { steps: 40, extrudePath: path }); void L; void prof;
      put(g, M.steel, mat4(lx, 0, lz));
      tube(M.paintY, [lx - 0.3, 0.06, lz + 3.7], [lx - 0.3, 0.33, lz + 3.7], 0.04); tube(M.paintY, [lx + 0.3, 0.06, lz + 3.7], [lx + 0.3, 0.33, lz + 3.7], 0.04);
    }
    // climbing frame: a cube of bars
    const cx = px + 1, cz = pz + 4, cs = 2.2;
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) tube(M.paintG, [cx - cs / 2 + i * cs / 2, 0.06, cz - cs / 2 + j * cs / 2], [cx - cs / 2 + i * cs / 2, cs, cz - cs / 2 + j * cs / 2], 0.035);
    for (let h = 1; h <= 4; h++) {
      const y = h * cs / 4;
      for (let i = 0; i <= 2; i++) { tube(M.paintG, [cx - cs / 2, y, cz - cs / 2 + i * cs / 2], [cx + cs / 2, y, cz - cs / 2 + i * cs / 2], 0.03); tube(M.paintG, [cx - cs / 2 + i * cs / 2, y, cz - cs / 2], [cx - cs / 2 + i * cs / 2, y, cz + cs / 2], 0.03); }
    }
    // seesaw
    const ex = px - 6, ez = pz + 4.5;
    putBox(M.paintR, ex, 0.3, ez, 0.3, 0.6, 0.3);
    putBox(M.wood, ex, 0.62, ez, 3.4, 0.07, 0.3, 0, true, 0, 0.12);
    for (const s of [-1, 1]) tube(M.steel, [ex + s * 1.45, 0.62 + s * -0.17 + 0.0, ez - 0.15], [ex + s * 1.45, 0.62 - s * 0.17 + 0.25, ez + 0.15], 0.02);
    // a low fence round the play area
    for (let k = 0; k <= 1; k++) {
      const fz = pz + (k ? 1 : -1) * (d / 2 + 1.2);
      for (let x = px - w / 2 - 1.2; x <= px + w / 2 + 1.2; x += 0.2) { if (k === 0 && Math.abs(x - px) < 1.4) continue; putBox(M.paintG, x, 0.45, fz, 0.04, 0.9, 0.04); }
      putBox(M.paintG, px, 0.85, fz, w + 2.4, 0.06, 0.06); putBox(M.paintG, px, 0.15, fz, w + 2.4, 0.06, 0.06);
    }
    for (const s of [-1, 1]) {
      const fx = px + s * (w / 2 + 1.2);
      for (let z = pz - d / 2 - 1.2; z <= pz + d / 2 + 1.2; z += 0.2) putBox(M.paintG, fx, 0.45, z, 0.04, 0.9, 0.04);
      putBox(M.paintG, fx, 0.85, pz, 0.06, 0.06, d + 2.4); putBox(M.paintG, fx, 0.15, pz, 0.06, 0.06, d + 2.4);
    }
  }

  // ---------------------------------------------------------------- the edge: a low stone wall, the road, the city
  {
    const wallH = 0.7;
    for (const s of [-1, 1]) {
      putBox(M.coping, 0, wallH / 2 - 0.05, s * (BOUNDS.z1 + 0.3), BOUNDS.x1 * 2 + 1.2, wallH, 0.6, 0, true);
      putBox(M.coping, s * (BOUNDS.x1 + 0.3), wallH / 2 - 0.05, 0, 0.6, wallH, BOUNDS.z1 * 2 + 1.2, 0, true);
    }
    // gaps where the main path leaves the park are left as is: the wall stands beyond the trees
    // pavements and a road ring
    const RW = 14, SW = 5;
    for (const s of [-1, 1]) {
      put(tbox(BOUNDS.x1 * 2 + 2 * (RW + SW * 2), 0.15, SW, 2), M.sidewalk, mat4(0, 0.0, s * (BOUNDS.z1 + 0.6 + RW + SW * 1.5)), false);
      put(tbox(SW, 0.15, BOUNDS.z1 * 2 + 2 * (RW + SW), 2), M.sidewalk, mat4(s * (BOUNDS.x1 + 0.6 + RW + SW * 1.5), 0.0, 0), false);
    }
    // parked cars along the far kerbs
    const carCols = [0xb8bcc2, 0x1d2a44, 0x8a1c1c, 0x2b2b2d, 0xe8e6e0, 0x3a5a40, 0x6a6e74, 0xc9a227];
    const carMats = carCols.map((c) => std({ color: c, roughness: 0.3, metalness: 0.6 }));
    const car = (x, z, ry) => {
      const m = pick(carMats), c = Math.cos(ry), s = Math.sin(ry), P2 = (u, y, v) => [x + c * u + s * v, y, z - s * u + c * v];
      const pb = P2(0, 0.62, 0); putBox(m, pb[0], pb[1], pb[2], 4.4, 0.7, 1.8, ry);
      const pc = P2(-0.2, 1.22, 0); putBox(M.glassCar, pc[0], pc[1], pc[2], 2.4, 0.55, 1.62, ry);
      const pr = P2(-0.2, 1.5, 0); putBox(m, pr[0], pr[1], pr[2], 2.2, 0.06, 1.6, ry);
      for (const [u, v] of [[1.4, 0.82], [1.4, -0.82], [-1.4, 0.82], [-1.4, -0.82]]) { const pw = P2(u, 0.34, v); put(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), M.rubber, mat4(pw[0], pw[1], pw[2], ry, PI / 2)); }
    };
    for (let x = -170; x < 170; x += rr(6, 14)) for (const s of [-1, 1]) if (rnd() < 0.7) car(x, s * (BOUNDS.z1 + 0.6 + RW - 1.6), s > 0 ? 0 : PI);
    for (let z = -120; z < 120; z += rr(6, 14)) for (const s of [-1, 1]) if (rnd() < 0.7) car(s * (BOUNDS.x1 + 0.6 + RW - 1.6), z, PI / 2);
    // buildings in a ring beyond the road
    const FAC = [0, 1, 2, 3, 4].map(facadeTex);
    const facM = FAC.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.05 }));
    const roofM = new THREE.MeshStandardMaterial({ map: CONC.map, color: 0x77726a, roughness: 1 });
    const inner = { x: BOUNDS.x1 + 0.6 + RW + SW * 2, z: BOUNDS.z1 + 0.6 + RW + SW * 2 };
    const bld = (x0, x1, z0, z1, h, style) => {
      const w = x1 - x0, d = z1 - z0, g = tbox(w, h, d, 12, 19.8);
      g.clearGroups(); // faces: +x, -x, +y, -y, +z, -z (6 indices each)
      for (let f = 0; f < 6; f++) g.addGroup(f * 6, 6, f === 2 || f === 3 ? 1 : 0);
      const mesh = new THREE.Mesh(g, [facM[style], roofM]); mesh.position.set((x0 + x1) / 2, h / 2 - 0.05, (z0 + z1) / 2);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); scene.add(mesh);
      if (rnd() < 0.6) putBox(roofM.clone ? M.roof : M.roof, (x0 + x1) / 2 + rr(-w / 5, w / 5), h + 1.2, (z0 + z1) / 2 + rr(-d / 5, d / 5), rr(3, w / 2), 2.4, rr(3, d / 2));
    };
    const row = (along, a0, a1, depth0, side) => {
      let a = a0;
      while (a < a1) {
        const w = rr(14, 34), dd = rr(16, 28), farRow = depth0 > 230;
        const near = depth0 < 180, tall = rnd() < (near ? 0.04 : 0.14) ? rr(70, 140) : (near ? rr(14, 34) : rr(22, 60)) * (farRow ? 1.3 : 1);
        const style = tall > 70 ? pick([2, 3]) : pick([0, 1, 3, 4, 0, 1]);
        if (along === "x") { const z0 = side * depth0, z1 = side * (depth0 + dd); bld(a, a + w - 0.5, Math.min(z0, z1), Math.max(z0, z1), tall, style); }
        else { const x0 = side * depth0, x1 = side * (depth0 + dd); bld(Math.min(x0, x1), Math.max(x0, x1), a, a + w - 0.5, tall, style); }
        a += w;
      }
    };
    for (const s of [-1, 1]) {
      row("x", -inner.x - 40, inner.x + 40, inner.z, s); row("x", -inner.x - 120, inner.x + 120, inner.z + 60, s); row("x", -inner.x - 200, inner.x + 200, inner.z + 130, s);
      row("z", -inner.z, inner.z, inner.x, s); row("z", -inner.z - 60, inner.z + 60, inner.x + 60, s); row("z", -inner.z - 130, inner.z + 130, inner.x + 130, s);
    }
  }

  // ---------------------------------------------------------------- flower beds
  {
    const gz = partsOf(P.flower_gazania).filter((p) => p.size.y > 0.05), ce = partsOf(P.celandine_01);
    const lg = gz.map(() => []), lc = ce.map(() => []), cg = gz.map(() => []);
    const tints = [new THREE.Color(1, 1, 1), new THREE.Color(1, 0.55, 0.6), new THREE.Color(1.1, 0.75, 0.5), new THREE.Color(0.95, 0.6, 0.95)];
    for (const b of BEDS) {
      // raised soil with a stone edge
      const sh = new THREE.CircleGeometry(1, 40); sh.rotateX(-PI / 2);
      put(sh, M.soil, mat4(b.x, 0.07, b.z, 0, 0, 0, b.rx, 1, b.rz), false);
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * 2 * PI, x = b.x + Math.cos(a) * (b.rx + 0.08), z = b.z + Math.sin(a) * (b.rz + 0.08);
        const a2 = ((k + 1) / 48) * 2 * PI, x2 = b.x + Math.cos(a2) * (b.rx + 0.08), z2 = b.z + Math.sin(a2) * (b.rz + 0.08);
        putBox(M.kerb, (x + x2) / 2, 0.06, (z + z2) / 2, Math.hypot(x2 - x, z2 - z) + 0.02, 0.18, 0.16, -Math.atan2(z2 - z, x2 - x), false);
      }
      const tint = tints[BEDS.indexOf(b) % tints.length];
      const n = Math.round(b.rx * b.rz * 5);
      for (let i = 0; i < n; i++) {
        const a = rr(0, 2 * PI), r = Math.sqrt(rnd()) * 0.9, x = b.x + Math.cos(a) * r * b.rx, z = b.z + Math.sin(a) * r * b.rz;
        const k = Math.floor(rnd() * gz.length), s = rr(0.28, 0.42) / Math.max(0.05, gz[k].size.y);
        lg[k].push(mat4(x, 0.06, z, rr(0, 6.3), 0, 0, s, s, s)); cg[k].push(tint);
      }
      for (let i = 0; i < n * 2; i++) {
        const a = rr(0, 2 * PI), r = Math.sqrt(rnd()) * 0.95, x = b.x + Math.cos(a) * r * b.rx, z = b.z + Math.sin(a) * r * b.rz;
        const k = Math.floor(rnd() * ce.length); lc[k].push(mat4(x, 0.06, z, rr(0, 6.3), 0, 0, 1.4, 1.4, 1.4));
      }
    }
    gz.forEach((p, k) => instanced(p, lg[k], { colors: cg[k] }));
    ce.forEach((p, k) => instanced(p, lc[k]));
  }

  // ---------------------------------------------------------------- trees: bark trunks and limbs, crowns of leaf sprays
  const trees = [];
  {
    const clearOf = (x, z, r) => {
      if (Math.abs(x) > BOUNDS.x1 - 2 || Math.abs(z) > BOUNDS.z1 - 2) return false;
      const dp = z - pathZ(x);
      if (Math.abs(dp) < 4.8 + r * 0.2) return false;
      if (dp > 0 && dp < 10 && x > -112 && x < 112) return false;                 // the tracking side stays open
      if (dPond(x, z) < POND.apron + 2.5) return false;
      if (dPlay(x, z) < 5) return false;
      if (dSpur(x, z) < 4) return false;
      if (inBed(x, z, 2.2)) return false;
      if (Math.abs(z - STROLL_Z) < 3.2 && x > -130 && x < 130) return false;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < (t.cr + r) * 0.75)) return false;
      return true;
    };
    // the belt round the edge
    for (let i = 0; i < 1400; i++) {
      const side = Math.floor(rnd() * 4), u = rnd(), inset = rr(3, 22);
      let x, z;
      if (side < 2) { x = BOUNDS.x0 + u * (BOUNDS.x1 - BOUNDS.x0); z = side ? BOUNDS.z1 - inset : BOUNDS.z0 + inset; }
      else { z = BOUNDS.z0 + u * (BOUNDS.z1 - BOUNDS.z0); x = side === 3 ? BOUNDS.x1 - inset : BOUNDS.x0 + inset; }
      const h = rr(11, 19), cr = h * rr(0.28, 0.36);
      if (clearOf(x, z, cr)) trees.push({ x, z, h, cr, belt: true });
    }
    // trees standing on the lawns, in loose groups
    const groups = [[-120, -40], [-80, -60], [-30, -50], [60, -45], [100, -20], [130, -70], [-140, 40], [-10, 45], [40, 70], [90, 50], [130, 30],
      [-100, 85], [10, 95], [-40, -95], [80, -95], [60, 20], [-90, 22], [-50, -22], [80, -12], [-130, -10]];
    for (const [gx, gz] of groups) {
      const n = Math.floor(rr(2, 6));
      for (let i = 0; i < n * 3 && n > 0; i++) {
        const x = gx + rr(-14, 14), z = gz + rr(-12, 12), h = rr(9, 17), cr = h * rr(0.3, 0.4);
        if (clearOf(x, z, cr)) trees.push({ x, z, h, cr });
      }
    }
    // a line of trees behind the benches on the north side, crowns over the path
    for (let x = -150; x <= 150; x += rr(12, 18)) {
      const z = pathZ(x) - rr(6.5, 8.5), h = rr(10, 15), cr = h * 0.33;
      if (clearOf(x, z, cr * 0.6)) trees.push({ x, z, h, cr });
    }

    const LEAF = leafAtlas();
    const barkG = [], leafG = [];
    const limb = (A, B, r0, r1) => {
      const L = A.distanceTo(B), g = new THREE.CylinderGeometry(r1, r0, L, 7, 1, true);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * L / 1.6);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new V3(1, 1, 1)));
      barkG.push(g);
    };
    // leaf cards with normals bent outward from their clump: crowns shade as volumes, not as flat cards
    const pos = [], nrm = [], uvs = [], col = [], idxs = [];
    const card = (c, centre, size, variant, tint, shade) => {
      const n = new V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize();
      let u = new V3().crossVectors(n, new V3(0, 1, 0)); if (u.lengthSq() < 1e-3) u.set(1, 0, 0); u.normalize();
      const v = new V3().crossVectors(u, n).normalize();
      const rot = rr(0, 2 * PI), cu = u.clone().multiplyScalar(Math.cos(rot)).addScaledVector(v, Math.sin(rot)), cv = new V3().crossVectors(n, cu);
      const base = pos.length / 3, h = size / 2;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [a, b] of corners) {
        const p = c.clone().addScaledVector(cu, a * h).addScaledVector(cv, b * h);
        pos.push(p.x, p.y, p.z);
        const out = p.clone().sub(centre).normalize().multiplyScalar(0.8).addScaledVector(new V3(0, 1, 0), 0.25).normalize();
        nrm.push(out.x, out.y, out.z);
        uvs.push((a + 1) / 4 + variant * 0.5, (b + 1) / 2);
        col.push(tint.r * shade, tint.g * shade, tint.b * shade);
      }
      idxs.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const t of trees) {
      const base = groundY(t.x, t.z) - 0.1;
      t.y = base;
      const trunkH = t.h * rr(0.28, 0.38), r0 = 0.12 + t.h * 0.018;
      t.r = r0;
      const lean = new V3(rr(-0.08, 0.08), 1, rr(-0.08, 0.08)).normalize();
      const A = new V3(t.x, base, t.z), B = A.clone().addScaledVector(lean, trunkH);
      limb(A.clone().add(new V3(0, -0.2, 0)), B, r0 * 1.15, r0 * 0.8);
      // root flare
      limb(A.clone().add(new V3(0, -0.1, 0)), A.clone().add(new V3(0, 0.6, 0)), r0 * 1.55, r0 * 1.12);
      const tint = new THREE.Color().setHSL(rr(0.2, 0.27), rr(0.45, 0.65), rr(0.45, 0.6));
      const crownC = new V3(t.x, base + t.h - t.cr * 0.95, t.z);
      const nLimb = t.belt ? 3 : Math.floor(rr(4, 6));
      const blobs = [];
      for (let k = 0; k < nLimb; k++) {
        const a = (k / nLimb) * 2 * PI + rr(-0.4, 0.4), out = t.cr * rr(0.45, 0.75), up = rr(0.1, 0.45) * t.h;
        const E = new V3(t.x + Math.cos(a) * out, B.y + up + t.cr * 0.3, t.z + Math.sin(a) * out);
        limb(B, E, r0 * 0.7, r0 * 0.28);
        if (!t.belt) { const E2 = E.clone().add(new V3(Math.cos(a + 0.6) * t.cr * 0.3, t.cr * 0.3, Math.sin(a + 0.6) * t.cr * 0.3)); limb(E, E2, r0 * 0.28, r0 * 0.12); }
        blobs.push({ c: E.clone().add(new V3(0, t.cr * 0.15, 0)), r: t.cr * rr(0.5, 0.7) });
      }
      blobs.push({ c: crownC.clone().add(new V3(0, t.cr * 0.35, 0)), r: t.cr * 0.7 });
      // cards: on the surface of each clump mostly, some inside
      const per = t.belt ? 20 : 66;
      for (const b of blobs) {
        const n = Math.round(per * (b.r / (t.cr * 0.6)) ** 2);
        for (let i = 0; i < n; i++) {
          const d = new V3(rr(-1, 1), rr(-0.8, 1), rr(-1, 1)).normalize(), rad = b.r * (rnd() < 0.75 ? rr(0.75, 1.0) : rr(0.2, 0.7));
          const p = b.c.clone().addScaledVector(d, rad); p.y = Math.max(p.y, B.y + 0.6);
          const up = (p.y - (crownC.y - t.cr)) / (t.cr * 2.2);
          const shade = Math.min(1.15, 0.55 + 0.55 * Math.max(0, up) + 0.15 * (rad / b.r));
          card(p, crownC, rr(1.3, 2.0) * (t.belt ? 1.5 : 1), rad / b.r < 0.7 || d.y < -0.3 ? 1 : 0, tint, shade);
        }
      }
    }
    const bark = mergeGeometries(barkG.map((g) => g.toNonIndexed()), false);
    const bm = new THREE.Mesh(bark, new THREE.MeshStandardMaterial({ map: BARK_D, normalMap: BARK_N, color: 0xa89c90, roughness: 0.95 }));
    bm.castShadow = true; bm.receiveShadow = true; scene.add(bm);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); lg.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    lg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); lg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    lg.setIndex(idxs);
    const lm = new THREE.MeshStandardMaterial({ map: LEAF, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75,
      color: 0xd8ecb0, alphaToCoverage: true, shadowSide: THREE.DoubleSide });
    lm.onBeforeCompile = (sh) => {   // keep the outward normals on both faces of a card
      sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""));
    };
    const leaves = new THREE.Mesh(lg, lm); leaves.castShadow = true; leaves.receiveShadow = true;
    leaves.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: LEAF, alphaTest: 0.45, side: THREE.DoubleSide });
    scene.add(leaves);

    // clipped shrubs behind the benches: low crowns of the same leaves
    const sp = [], sn = [], su = [], sc = [], si = [];
    void sp; void sn; void su; void sc; void si;
  }

  // ---------------------------------------------------------------- shrubs and grass tufts
  {
    // shrubs: low leafy mounds behind benches and round the pond apron
    const LEAF2 = leafAtlas();
    const pos = [], nrm = [], uvs = [], col = [], idx = [];
    const shrub = (x, z, r, hgt) => {
      const tint = new THREE.Color().setHSL(rr(0.22, 0.3), rr(0.4, 0.6), rr(0.32, 0.45));
      const c = new V3(x, hgt * 0.45, z);
      const n = Math.round(30 * r * r);
      for (let i = 0; i < n; i++) {
        const d = new V3(rr(-1, 1), rr(-0.2, 1), rr(-1, 1)).normalize();
        const p = new V3(x + d.x * r * rr(0.6, 1), Math.max(0.25, c.y + d.y * hgt * 0.55 * rr(0.6, 1)), z + d.z * r * rr(0.6, 1));
        const nn = new V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize();
        let u = new V3().crossVectors(nn, new V3(0, 1, 0)); if (u.lengthSq() < 1e-3) u.set(1, 0, 0); u.normalize();
        const v = new V3().crossVectors(u, nn).normalize(), h = rr(0.35, 0.6), base = pos.length / 3, variant = d.y < 0.2 ? 1 : 0;
        const shade = 0.6 + 0.5 * Math.max(0, d.y);
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const q = p.clone().addScaledVector(u, a * h).addScaledVector(v, b * h); q.y = Math.max(0.02, q.y);
          pos.push(q.x, q.y, q.z);
          const o = q.clone().sub(c).normalize(); nrm.push(o.x, o.y, o.z);
          uvs.push((a + 1) / 4 + variant * 0.5, (b + 1) / 2); col.push(tint.r * shade, tint.g * shade, tint.b * shade);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    for (const b of benches) {
      if (Math.hypot(b.x - POND.x, b.z - POND.z) < POND.apron + 2) continue;
      for (const o of [-1.8, 0, 1.8]) {
        const x = b.x + o + rr(-0.3, 0.3), z = pathZ(x) - PATH_HALF - 2.9 + rr(-0.2, 0.3);
        if (Math.abs(z - STROLL_Z) < 1.8) continue;
        shrub(x, z, rr(0.8, 1.1), rr(0.9, 1.3));
      }
    }
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * 2 * PI + 0.1, r = POND.apron + 1.4; if (Math.sin(a) > 0.8) continue;
      shrub(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, rr(0.9, 1.3), rr(0.9, 1.4));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({ map: LEAF2, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xc8e0a0, alphaToCoverage: true });
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "")); };
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: LEAF2, alphaTest: 0.45, side: THREE.DoubleSide });
    scene.add(mesh);

    // grass tufts: crossed cards of blades along every lawn edge near where people walk, and scattered on the lawn
    const BL = bladeTex();
    const tuft = new THREE.PlaneGeometry(0.22, 0.08); tuft.translate(0, 0.035, 0);
    const t2 = tuft.clone(); t2.rotateY(PI / 2);
    const tg = mergeGeometries([tuft, t2], false);
    const tm = new THREE.MeshStandardMaterial({ map: BL, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, color: 0xa8b878 });
    const list = [];
    for (let i = 0; i < 40000; i++) {
      const x = rr(-140, 140);
      const r = rnd();
      let z;
      if (r < 0.97) z = pathZ(x) + (rnd() < 0.5 ? -1 : 1) * (PATH_HALF + 0.15 + Math.abs(rr(-1, 1)) ** 3 * 3);
      else z = pathZ(x) + rr(-30, 30);
      if (paved(x, z) || dPath(x, z) < PATH_HALF + 0.14 || dPond(x, z) < POND.apron + 0.2 || inBed(x, z, 0.2) || dPlay(x, z) < 1.6 || dSpur(x, z) < 1.45) continue;
      const y = groundRaw(x, z), s = rr(0.6, 1.1);
      list.push(mat4(x, Math.max(0, y) - 0.02, z, rr(0, 6.3), 0, 0, s, s * rr(0.7, 1.2), s));
    }
    instanced({ geo: tg, mat: tm }, list, { shadow: false });
  }

  flush();

  // ---------------------------------------------------------------- the people
  const people = {};
  CASTS.forEach((c, i) => { const f = figs[i]; f.object.visible = false; scene.add(f.object); people[c.as] = f; });
  const crowdOut = CROWD.map((c, i) => {
    const f = crowdFigs[i]; scene.add(f.object); return { name: c.name, def: c, fig: f, object: f.object, x: 0, z: 0 };
  });
  const SPOT = new V3(-6, PAVE_Y, pathZ(-6) + LANE.main);

  // ---------------------------------------------------------------- depth of field (for the close shot)
  let dof = null;
  function makeDof() {
    const dt = new THREE.DepthTexture(W, H); dt.type = THREE.UnsignedIntType;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: dt, samples: 4 });
    const mat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: rt.texture }, tDepth: { value: dt }, cNear: { value: 0.1 }, cFar: { value: 2000 },
        focus: { value: 5 }, maxR: { value: 0 }, px: { value: new THREE.Vector2(1 / W, 1 / H) } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `
        #include <packing>
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform float cNear, cFar, focus, maxR; uniform vec2 px; varying vec2 vUv;
        float dist(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, cNear, cFar); }
        float coc(float z){ return maxR * clamp(abs(z - focus) / max(z, 0.001) * 1.6, 0.0, 1.0); }
        void main(){
          float c0 = coc(dist(vUv));
          vec3 acc = texture2D(tColor, vUv).rgb; float wsum = 1.0;
          if (c0 > 0.5) {
            for (int i = 1; i < 48; i++) {
              float fi = float(i), r = sqrt(fi / 48.0) * c0, a = fi * 2.39996;
              vec2 o = vec2(cos(a), sin(a)) * r * px;
              float cs = coc(dist(vUv + o));
              float w = smoothstep(r - 1.5, r + 0.5, cs);
              acc += texture2D(tColor, vUv + o).rgb * w; wsum += w;
            }
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
    const s2 = new THREE.Scene(); s2.add(quad);
    return { rt, mat, s2, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }

  // ---------------------------------------------------------------- update and render
  const focusPoint = SPOT.clone();
  const look = new V3();
  const wrap = (x, a, b) => a + ((((x - a) % (b - a)) + (b - a)) % (b - a));
  function update(state = {}) {
    const time = state.time || 0;
    // water: ripples drift, the fountain runs
    water.material.normalMap.offset.set(time * 0.02, time * 0.013);
    basinWater.material.normalMap.offset.set(-time * 0.2, time * 0.15);
    curtains.forEach((m, i) => { m.material.map.offset.y = time * (i ? 1.4 : 1.8); });
    {
      const p = spray.geometry.attributes.position, g = 9.81;
      sprayData.forEach((d, i) => {
        if (d.top) {
          const T = (2 * d.vy) / g + 0.12, t = ((time / T + d.ph) % 1) * T;
          const r = d.vr * t, y = 2.84 + d.vy * t - 0.5 * g * t * t;
          p.setXYZ(i, POND.x + Math.cos(d.a) * r, Math.max(2.56, y), POND.z + Math.sin(d.a) * r);
        } else {
          const T = (2 * d.vy) / g, t = ((time / T + d.ph) % 1) * T, base = d.r > 1.5 ? 0.37 : 1.71;
          const r = d.r + d.vr * t, y = base + d.vy * t - 0.5 * g * t * t;
          p.setXYZ(i, POND.x + Math.cos(d.a) * r, Math.max(base, y), POND.z + Math.sin(d.a) * r);
        }
      });
      p.needsUpdate = true;
    }
    // the cast
    const ppl = state.people;
    let first = null;
    CASTS.forEach((c, i) => {
      const f = people[c.as];
      const p = ppl ? ppl[c.as] : (i === 0 ? { x: SPOT.x } : null);
      if (!p || p.show === false) { f.object.visible = false; return; }
      const x = p.x ?? SPOT.x, z = p.z ?? pathZ(x) + LANE.main;
      f.object.visible = true;
      f.object.position.set(x, groundY(x, z), z);
      f.object.rotation.set(0, p.heading ?? pathAt(x).heading, 0);
      const g = p.gait || {}, w = {};
      let sum = 0;
      for (const k of Object.keys(g)) if (f.actions[k]) { w[k] = Math.max(0, g[k] || 0); sum += w[k]; }
      w.idle = Math.max(0, 1 - sum);
      f.pose(p.time ?? time, w);
      if (!first) first = f.object.position;
    });
    // the background people
    const show = (state.crowd ?? 1) > 0.5, ct = state.crowdTime ?? time;
    for (const c of crowdOut) {
      const d = c.def;
      c.object.visible = show;
      if (!show) continue;
      let x, z, hd;
      if (d.kind === "path") {
        x = wrap(d.x0 + d.dir * d.speed * ct, -165, 165); z = pathZ(x) + d.lane;
        hd = d.dir > 0 ? Math.atan2(1, pathDZ(x)) : Math.atan2(-1, -pathDZ(x));
      } else if (d.kind === "lawn") {
        x = wrap(d.x0 + d.dir * d.speed * ct, -125, 125); z = d.z; hd = d.dir > 0 ? PI / 2 : -PI / 2;
      } else {
        x = d.x; z = d.z; hd = 0;
      }
      if (d.name === "talker1") hd = Math.atan2(CROWD[6]?.x - x || 1, CROWD[6]?.z - z || 0);
      if (d.name === "talker2") hd = Math.atan2(CROWD[5]?.x - x || -1, CROWD[5]?.z - z || 0);
      if (d.name === "parent") hd = 0;
      c.x = x; c.z = z;
      c.object.position.set(x, groundY(x, z), z); c.object.rotation.set(0, hd, 0);
      c.fig.pose(ct + (d.x0 || 0) * 0.37, d.kind === "stand" ? { [d.clip]: 1 } : { [d.clip]: 1 });
    }
    // haze and the sun's shadow box round the subject
    camera.getWorldDirection(look);
    scene.fog.density = HAZE_D * (state.haze ?? 1);
    const fp = state.focus ? new V3(state.focus.x, state.focus.y ?? 0, state.focus.z) : first ? first.clone() : camera.position.clone().addScaledVector(look, 30);
    focusPoint.copy(first ? first.clone().add(new V3(0, 1.2, 0)) : fp);
    const rad = state.shadowRadius ?? Math.min(140, Math.max(16, camera.position.distanceTo(fp) * 1.1));
    sun.target.position.copy(fp);
    sun.position.copy(fp).addScaledVector(sunDir, 300);
    const sc = sun.shadow.camera;
    if (sc.right !== rad) { sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 50; sc.far = 600; sc.updateProjectionMatrix(); }
    sun.shadow.bias = rad > 60 ? -0.001 : rad > 30 ? -0.0006 : -0.0003;
    sun.shadow.normalBias = rad > 60 ? 0.12 : 0.04;
  }
  function render(opts = {}) {
    const blur = opts.blur || 0;
    if (blur <= 0.001) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    if (!dof) dof = makeDof();
    const u = dof.mat.uniforms;
    u.cNear.value = camera.near; u.cFar.value = camera.far; u.maxR.value = 16 * blur;
    u.focus.value = opts.focusDistance ?? camera.position.distanceTo(focusPoint);
    renderer.setRenderTarget(dof.rt); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(dof.s2, dof.cam);
  }

  update({});
  return {
    renderer, scene, camera, update, render, cast: people, person: people[CASTS[0].as]?.object, gaitSpeed,
    pathZ, pathAt, groundY, POND, FOUNTAIN, PLAY, SPOT, LANE, PATH_HALF, PAVE_Y, benches, lamps, trees, crowd: crowdOut,
    sun, sunDir, water, BOUNDS,
  };
}
