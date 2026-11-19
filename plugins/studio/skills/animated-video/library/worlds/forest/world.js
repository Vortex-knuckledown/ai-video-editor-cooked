// World "forest": a pine forest trail on a hazy morning. Tall pine trunks with high crowns, young firs, ferns,
// grass and logs in the undergrowth, a dirt path winding east into a sunlit grassy clearing, a small stream with
// mossy stones running beside the path on its north side, shafts of low sunlight slanting through the haze.
//
// Axes (metres): +x is EAST (the way the path leads, towards the clearing), +y up, +z SOUTH, -z NORTH.
// The path runs along x from x = -170 to the clearing; its centre line is z = pathZ(x) (within +-3 m of z = 0),
// 2.2 m of packed dirt. The stream runs west-east north of the path at z = streamZ(x) (about z = -7 to -12),
// water 2.4 m wide at y = -0.22. The clearing is a grassy circle, centre CLEARING {x: 52, z: ~1.9}, radius 15 m;
// the path ends in it and the stream passes along its north edge. Pines stand at least 3.6 m from the path centre;
// on the path's south side (+z) nothing taller than a fern stands within 6 m, so a camera can track a walker
// side on from the south at 3 to 6 m. The place is finest for x in [-90, 70], z in [-45, 45]; haze beyond.
// The Sun is low in the east (about 26 degrees up, from +x and a little south): looking east down the path
// is looking into the light shafts; looking north from the south side lights the walker's face side.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"]}) -> world. Per frame: set world.camera (position,
// lookAt, fov), call world.update(state), then world.render(opts) (or world.renderer.render(world.scene, world.camera)).
//
// state (every field optional):
//   time          seconds of the shot: drives the water ripple and, by default, each person's animation clock
//   people        {<cast id>: {x, z, heading, time, gait: {walk, run}, show}}. x along the path; z defaults to
//                 the path centre at x (pathZ(x)); y is always the ground there. heading radians about +y,
//                 0 faces +z (south), PI/2 faces east; default = facing east along the path (pathAt(x).heading).
//                 gait weights 0..1 (idle gets the rest); move x by world.gaitSpeed[id].walk * walk (m/s) so feet
//                 never slide. time = that person's animation clock (default state.time). show false hides.
//                 Cast members not named are hidden. With no people at all the first cast member idles at SPOT.
//   focus         {x, y, z} centre of the sun's shadow box (default: the first visible person, else the camera target)
//   shadowRadius  metres of that box (default from the camera's distance, 18..80)
//   haze          multiplier of the haze density (default 1; 0.5 clears the air for a high view, 1.5 thickens it)
//   shafts        multiplier of the light shafts' strength (default 1; they fade by themselves as the camera looks down)
//
// render(opts): opts.blur 0..1 is a shallow depth of field (0 = none, 1 = strong), opts.focusDistance metres from
// the camera to keep sharp (default: distance to the focus point). Use it for the close shot: the subject sharp,
// the forest soft behind.
//
// Exposes: world.cast.<id> (each a loadFigure result: object, pose, height), world.person (the first cast member's
// object), world.gaitSpeed[id] {walk, run} m/s, world.pathZ(x), world.pathAt(x) -> {x, y, z, heading} (heading faces
// east along the path), world.streamZ(x), world.groundY(x, z), world.CLEARING {x, z, r}, world.SPOT (Vector3, a
// default place on the path at x = -10), world.sun (DirectionalLight), world.sunDir (unit Vector3 towards the Sun),
// world.trees (array of {x, z, h} pine positions), world.water (Mesh), world.PATH_HALF (1.1), world.STREAM_Y (-0.22).
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"] }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const W = canvas.width || 1920, H = canvas.height || 1080;

  // ---------------------------------------------------------------- renderer, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 2000);
  camera.position.set(-30, 4, 4); camera.lookAt(0, 1.5, 0);

  // ---------------------------------------------------------------- deterministic random and noise
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
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
  const pathZ = (x) => 2.0 * Math.sin(0.045 * x) + 1.0 * Math.sin(0.11 * x + 1.0);
  const pathDZ = (x) => 2.0 * 0.045 * Math.cos(0.045 * x) + 0.11 * Math.cos(0.11 * x + 1.0);
  const streamZ = (x) => -9.5 + 2.2 * Math.sin(0.06 * x + 2.0) + 0.8 * Math.sin(0.17 * x);
  const CLEARING = { x: 52, z: pathZ(52), r: 15 };
  const PATH_END = 58, PATH_HALF = 1.1, STREAM_Y = -0.22;
  const dPath = (x, z) => (x > PATH_END ? Math.hypot(x - PATH_END, z - pathZ(PATH_END)) : Math.abs(z - pathZ(x)));
  const dClear = (x, z) => Math.hypot(x - CLEARING.x, z - CLEARING.z);
  const groundY = (x, z) => {
    const dp = dPath(x, z), ds = Math.abs(z - streamZ(x)), dc = dClear(x, z);
    const hills = (fbm(x * 0.018 + 3.1, z * 0.018 - 1.7) * 4.2 + fbm(x * 0.07, z * 0.07) * 0.7 + 0.05 * Math.max(0, Math.abs(z) - 14))
      * sstep(2.5, 22, dp) * sstep(10, 28, dc) * sstep(2.6, 11, ds);
    const micro = fbm(x * 0.6, z * 0.6) * 0.05 * sstep(0.6, 2.0, dp);
    const channel = -0.5 * Math.exp(-((ds / 1.0) ** 2));
    return hills + micro + channel;
  };
  const pathAt = (x) => ({ x, y: groundY(x, pathZ(x)), z: pathZ(x), heading: Math.atan2(1, pathDZ(x)) });

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f) => new Promise((res, rej) => TL.load(f, res, undefined, rej));
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`${K}pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const LIB = new URL("../lib/", import.meta.url).href;
  const barkTex = async () => {
    const [d, n] = await Promise.all([tex(LIB + "props/pine_tree_01/textures/pine_tree_01_bark_diff_1k.jpg"),
      tex(LIB + "props/pine_tree_01/textures/pine_tree_01_bark_nor_gl_1k.jpg")]);
    for (const t of [d, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(2, 14); }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n };
  };
  const hdrL = new HDRLoader(); hdrL.setDataType(THREE.HalfFloatType);
  const [sky, SAND, ROCK, BARK, fernP, grassP, rocksP, boulderP, stumpP, logP, ...figs] = await Promise.all([
    hdrL.loadAsync(K + "sky/day.hdr"), pbrSet("sand"), pbrSet("rock"), barkTex(),
    loadProp({ THREE, id: "fern_02" }), loadProp({ THREE, id: "grass_medium_01" }), loadProp({ THREE, id: "rock_moss_set_01" }),
    loadProp({ THREE, id: "boulder_01" }), loadProp({ THREE, id: "tree_stump_01" }), loadProp({ THREE, id: "dead_tree_trunk" }),
    ...cast.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] })),
  ]);

  // how fast each person's walk and run carry them (from the clip's own hips travel, before it is put on the spot)
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  async function clipSpeed(id, name, fallback) {
    try {
      const meta = await (await fetch(`${LIB}characters/${id}/character.json`)).json();
      const src = meta.clips[name]; if (!src || src.startsWith("@")) return fallback;
      const g = await new GLTFLoader().loadAsync(`${LIB}characters/${id}/${src}`);
      const c = g.animations[0]; const tr = c.tracks.find((t) => /hips\.position$/i.test(t.name)); if (!tr) return fallback;
      const v = tr.values, n = v.length / 3, dist = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]);
      const hipH = Math.abs(v[1]) || 1, s = dist / hipH * 0.98 * (meta.height || 1.75) / 1.72;   // hips ~0.98 m on a 1.72 m body
      const sp = s / (tr.times[n - 1] - tr.times[0]);
      return sp > 0.3 && sp < 12 ? sp : fallback;
    } catch (e) { return fallback; }
  }
  const gaitSpeed = {};
  await Promise.all(cast.map(async (id) => { gaitSpeed[id] = { walk: await clipSpeed(id, "walk", 1.4), run: await clipSpeed(id, "run", 5.0) }; }));

  // ---------------------------------------------------------------- sky, sun, haze
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.environment = sky;
  scene.backgroundIntensity = 0.7; scene.environmentIntensity = 0.55;
  const sunDir = new V3(0.84, 0.46, 0.28).normalize();
  const HAZE = new THREE.Color(0xaab3a2);
  scene.fog = new THREE.FogExp2(HAZE, 0.0125);
  const sun = new THREE.DirectionalLight(0xffe4b8, 3.4);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xc9dcf0, 0x4a3f2c, 0.55); scene.add(hemi);

  // ---------------------------------------------------------------- canvas textures (needles, light shafts)
  function needleCard(dark) {
    // a pine bough seen from the side: a twig with side shoots, each thick with needles, on a transparent ground
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const g = c.getContext("2d"); g.lineCap = "round";
    const greens = dark ? ["#1c2e16", "#24391b", "#2b4420", "#33502a", "#172612", "#3d5c2c"]
                        : ["#24391b", "#2e4822", "#38562a", "#446433", "#1e3017", "#55703a", "#6a7d3e"];
    const shoots = [];
    const twig = (x0, y0, x1, y1, w, depth) => {
      shoots.push([x0, y0, x1, y1, w]);
      if (depth > 0) for (let k = 0; k < 7; k++) {
        const t = 0.1 + k * 0.11 + rr(-0.03, 0.03), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, sd = k % 2 ? 1 : -1;
        const ang = Math.atan2(y1 - y0, x1 - x0), a = ang + sd * rr(0.45, 0.85), L = Math.hypot(x1 - x0, y1 - y0) * (1 - t) * rr(0.35, 0.55);
        twig(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, w * 0.55, depth - 1);
      }
    };
    twig(4, 128, 504, 128 + rr(-10, 10), 5, 1);
    for (const [x0, y0, x1, y1, w] of shoots) {
      g.strokeStyle = "#3e3024"; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    for (const [x0, y0, x1, y1, w] of shoots) {
      const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0), n = Math.floor(len / 1.6);
      for (let i = 0; i < n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, taper = 1 - 0.5 * t;
        for (let k = 0; k < 3; k++) {
          const sd = k % 2 ? 1 : -1, a = ang + sd * rr(0.35, 1.2), L = rr(14, 30) * taper * (w > 3 ? 0.9 : 1);
          g.strokeStyle = greens[Math.floor(rnd() * greens.length)]; g.lineWidth = rr(1.6, 3.0);
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5 + 2, x + Math.cos(a) * L, y + Math.sin(a) * L + 3); g.stroke();
        }
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  const NEEDLE = needleCard(false), FIRN = needleCard(true);
  function shaftTex() {
    const c = document.createElement("canvas"); c.width = 64; c.height = 256; const g = c.getContext("2d");
    const im = g.createImageData(64, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
      const u = x / 63, v = y / 255, a = Math.sin(PI * u) ** 2.2 * Math.sin(PI * v) ** 0.8 * (0.85 + 0.15 * Math.sin(v * 17 + u * 3));
      const i = (y * 64 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
    g.putImageData(im, 0, 0);
    return new THREE.CanvasTexture(c);
  }

  // ---------------------------------------------------------------- the ground: one terrain, dirt path, forest floor, clearing grass, stream bed
  const GX0 = -190, GX1 = 170, GZ0 = -150, GZ1 = 150, SEG_X = 450, SEG_Z = 375;
  {
    const geo = new THREE.PlaneGeometry(GX1 - GX0, GZ1 - GZ0, SEG_X, SEG_Z); geo.rotateX(-PI / 2);
    geo.translate((GX0 + GX1) / 2, 0, (GZ0 + GZ1) / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), uv = geo.attributes.uv;
    const sc = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    const cNeedle = sc(0.42, 0.31, 0.21), cMoss = sc(0.31, 0.36, 0.17), cPath = sc(0.80, 0.68, 0.53),
      cWorn = sc(0.88, 0.76, 0.61), cGrass = sc(0.44, 0.52, 0.23), cBed = sc(0.26, 0.24, 0.20), cMud = sc(0.32, 0.25, 0.18);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, groundY(x, z));
      uv.setXY(i, x / 2.6, z / 2.6);
      const dp = dPath(x, z), ds = Math.abs(z - streamZ(x)), dc = dClear(x, z);
      c.copy(cNeedle).lerp(cMoss, sstep(-0.2, 0.5, fbm(x * 0.09 + 7, z * 0.09)) * 0.85);
      c.multiplyScalar(0.85 + 0.25 * fbm(x * 0.35, z * 0.35));
      c.lerp(cGrass, 1 - sstep(CLEARING.r - 5, CLEARING.r + 3, dc + fbm(x * 0.2, z * 0.2) * 3));
      const edge = 1.05 + fbm(x * 0.5 + 2, z * 0.5) * 0.35;
      const wp = (1 - sstep(edge, edge + 0.7, dp)) * (1 - sstep(CLEARING.r - 6, CLEARING.r, dc) * (x > CLEARING.x - 8 ? 1 : 0));
      const worn = 1 - sstep(0.15, 0.55, Math.abs(Math.abs(z - pathZ(x)) - 0.35));
      c.lerp(cPath.clone().lerp(cWorn, worn * 0.5), wp);
      c.lerp(cMud, (1 - sstep(0.9, 2.2, ds)) * 0.75);
      c.lerp(cBed, 1 - sstep(0.5, 1.1, ds));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ ...SAND, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
    const ground = new THREE.Mesh(geo, m); ground.receiveShadow = true; scene.add(ground);
  }

  // ---------------------------------------------------------------- the stream: a ribbon of water in the channel
  let water;
  {
    const xs = []; for (let x = GX0; x <= GX1; x += 1) xs.push(x);
    const pos = [], uvs = [], idx = [];
    xs.forEach((x, i) => {
      const z = streamZ(x);
      pos.push(x, STREAM_Y, z - 1.3, x, STREAM_Y, z + 1.3); uvs.push(x / 4, 0, x / 4, 0.85);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const nor = ROCK.normalMap.clone(); nor.wrapS = nor.wrapT = THREE.RepeatWrapping; nor.needsUpdate = true;
    water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1c2620, roughness: 0.07, metalness: 0.05, normalMap: nor,
      normalScale: new THREE.Vector2(0.18, 0.18), transparent: true, opacity: 0.84, envMapIntensity: 0.9 }));
    water.receiveShadow = true; scene.add(water);
  }

  // ---------------------------------------------------------------- props to instances
  const dummy = new THREE.Object3D();
  function partsOf(obj) {
    obj.updateMatrixWorld(true);
    const out = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.computeBoundingBox();
      const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.computeBoundingBox();
      const mt = o.material.clone(); if (mt.transparent && !mt.alphaMap) { mt.transparent = false; mt.depthWrite = true; }
      out.push({ geo: g, mat: mt, size: g.boundingBox.getSize(new V3()) });
    });
    return out;
  }
  function instanced(part, list, { shadow = true, receive = true } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow; im.receiveShadow = receive; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    scene.add(im); return im;
  }
  const mat4 = (x, y, z, ry, s, rx = 0, rz = 0, sy) => {
    dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(s, sy ?? s, s); dummy.updateMatrix(); return dummy.matrix.clone();
  };

  // ---------------------------------------------------------------- pines and young firs
  const trees = [], firs = [];
  const nearSouth = (x, z, reach = 0) => x > -95 && x < 62 && z > pathZ(x) && z - pathZ(x) < 6.2 + reach;
  for (let gx = -150; gx < 140; gx += 4.6) for (let gz = -120; gz < 120; gz += 4.6) {
    const x = gx + rr(-1.9, 1.9), z = gz + rr(-1.9, 1.9);
    const dp = dPath(x, z), ds = Math.abs(z - streamZ(x)), dc = dClear(x, z);
    if (dp < 3.6 || ds < 2.3 || dc < CLEARING.r + 1.5 || nearSouth(x, z)) { continue; }
    const dens = 0.62 + 0.25 * fbm(x * 0.03, z * 0.03);
    if (rnd() > dens) continue;
    if (rnd() < 0.22) { const hf = rr(2.5, 10); if (dp > 4 + hf * 0.4 && ds > 2.6 && !nearSouth(x, z, hf * 0.4 + 0.5)) firs.push({ x, z, h: hf }); continue; }
    const hh = rr(15, 30); trees.push({ x, z, h: hh, r: rr(0.17, 0.24) + hh * 0.005, cb: rr(0.42, 0.62), cr: rr(2.2, 3.6) });
  }
  // a few young firs along the margins of the path and the clearing
  for (let i = 0; i < 140; i++) {
    const x = rr(-110, 75), side = rnd() < 0.55 ? -1 : 1, z = pathZ(x) + side * rr(4.2, 16);
    const hf = rr(1.4, 5.5);
    if (Math.abs(z - streamZ(x)) < 2.6 || dClear(x, z) < CLEARING.r - 1 || nearSouth(x, z, hf * 0.4 + 0.5) || dPath(x, z) < 2.2 + hf * 0.4) continue;
    firs.push({ x, z, h: hf });
  }
  for (let i = 0; i < 26; i++) {   // round the clearing's rim
    const a = rr(0, 2 * PI), r = CLEARING.r + rr(0.5, 3), x = CLEARING.x + Math.cos(a) * r, z = CLEARING.z + Math.sin(a) * r;
    if (dPath(x, z) < 3 || Math.abs(z - streamZ(x)) < 2.6) continue;
    firs.push({ x, z, h: rr(1.5, 6) });
  }
  {
    // trunk: a lathe with a root flare, unit height, bark wrapped round it
    const prof = [];
    for (const y of [0, 0.004, 0.009, 0.016, 0.028, 0.05, 0.09, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88, 1]) {
      prof.push(new THREE.Vector2(Math.max(0.02, (1 - 0.72 * y) * (1 + 0.9 * Math.exp(-y * 90))), y));
    }
    const trunkGeo = new THREE.LatheGeometry(prof, 14);
    const barkM = new THREE.MeshStandardMaterial({ ...BARK, color: 0xd8c4b0, roughness: 0.95 });
    const tm = [], tcol = [];
    const stubGeo = new THREE.CylinderGeometry(0.35, 1, 1, 5, 1); stubGeo.translate(0, 0.5, 0); stubGeo.rotateZ(-PI / 2);
    const stubM = new THREE.MeshStandardMaterial({ color: 0x3b2f25, roughness: 1 });
    const stubs = [];
    const cardGeo = new THREE.PlaneGeometry(1, 1); cardGeo.translate(0.5, 0, 0);
    const cards = [], fcards = [];
    const basis = new THREE.Matrix4();
    const card = (list, ox, oy, oz, dir, len, wid, roll) => {
      const d = dir.clone().normalize();
      let side = new V3().crossVectors(new V3(0, 1, 0), d); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
      side.applyAxisAngle(d, roll);
      const nrm = new V3().crossVectors(d, side).normalize();
      basis.makeBasis(d.multiplyScalar(len), side.multiplyScalar(wid), nrm); basis.setPosition(ox, oy, oz);
      list.push(basis.clone());
    };
    for (const t of trees) {
      const base = Math.min(groundY(t.x - t.r, t.z), groundY(t.x + t.r, t.z), groundY(t.x, t.z - t.r), groundY(t.x, t.z + t.r)) - 0.15;
      t.y = base;
      const lean = rr(-0.025, 0.025), leanz = rr(-0.025, 0.025);
      dummy.position.set(t.x, base, t.z); dummy.rotation.set(leanz, rr(0, 2 * PI), lean); dummy.scale.set(t.r, t.h, t.r); dummy.updateMatrix();
      tm.push(dummy.matrix.clone());
      const cc = new THREE.Color().setHSL(0.07 + rr(-0.015, 0.02), rr(0.25, 0.45), rr(0.5, 0.7)); tcol.push(cc);
      const top = base + t.h, cb = base + t.h * t.cb, near = Math.abs(t.z) < 50 && t.x > -100 && t.x < 85;
      // dead branch stubs on the bare trunk
      const nStub = near ? Math.floor(rr(5, 12)) : 0;
      for (let k = 0; k < nStub; k++) {
        const y = base + rr(2.5, t.h * t.cb), a = rr(0, 2 * PI), L = rr(0.25, 1.3) * (0.6 + (y - base) / t.h);
        const rTr = t.r * (1 - 0.72 * (y - base) / t.h);
        dummy.position.set(t.x + Math.cos(a) * rTr * 0.8, y, t.z + Math.sin(a) * rTr * 0.8);
        dummy.rotation.set(0, -a, rr(-0.5, 0.15)); dummy.scale.set(L, rr(0.018, 0.035), rr(0.018, 0.035)); dummy.updateMatrix();
        stubs.push(dummy.matrix.clone());
      }
      // the crown: whorls of branches, each a spray of needle cards
      const step = near ? 0.55 : 1.1;
      for (let y = cb; y < top + 0.6; y += step * rr(0.8, 1.2)) {
        const f = (y - cb) / (top - cb), prof = Math.pow(Math.sin(PI * Math.min(1, f * 0.92 + 0.06)), 0.65) * (1 - 0.25 * f);
        const R = t.cr * prof + 0.4, nb = near ? Math.floor(rr(5, 9)) : 4;
        for (let b = 0; b < nb; b++) {
          const a = rr(0, 2 * PI), droop = rr(-0.35, 0.25) + (f > 0.85 ? 0.6 : 0);
          const rTr = t.r * (1 - 0.72 * Math.min(1, (y - base) / t.h));
          const dir = new V3(Math.cos(a) * Math.cos(droop), Math.sin(droop), Math.sin(a) * Math.cos(droop));
          const segs = Math.max(1, Math.round(R / 1.3));
          for (let s = 0; s < segs; s++) {
            const d0 = rTr + (R / segs) * s * 0.85;
            const L = Math.min(2.4, R / segs + 0.7), wd = L * rr(0.45, 0.6);
            card(cards, t.x + dir.x * d0, y + dir.y * d0, t.z + dir.z * d0, dir.clone().add(new V3(rr(-0.2, 0.2), rr(-0.15, 0.1), rr(-0.2, 0.2))), L, wd, rr(-0.6, 0.6));
            if (near && rnd() < 0.6) card(cards, t.x + dir.x * d0, y + dir.y * d0, t.z + dir.z * d0, dir.clone(), L * 0.9, wd, rr(1.0, 2.1));
          }
        }
      }
    }
    // young firs: a cone of drooping sprays from the ground up
    const fm = [];
    for (const t of firs) {
      const base = groundY(t.x, t.z) - 0.05, r = Math.max(0.05, t.h * 0.03);
      dummy.position.set(t.x, base, t.z); dummy.rotation.set(0, rr(0, 6), 0); dummy.scale.set(r, t.h, r); dummy.updateMatrix(); fm.push(dummy.matrix.clone());
      for (let y = base + 0.3; y < base + t.h; y += 0.24 * Math.max(0.7, t.h / 5)) {
        const f = (y - base) / t.h, R = t.h * 0.36 * (1 - f) + 0.15, nb = Math.max(5, Math.round(12 * (1 - f)) + 3);
        for (let b = 0; b < nb; b++) {
          const a = (b / nb) * 2 * PI + rr(-0.3, 0.3), droop = rr(-0.45, -0.1);
          card(fcards, t.x, y, t.z, new V3(Math.cos(a) * Math.cos(droop), Math.sin(droop), Math.sin(a) * Math.cos(droop)), R + 0.25, (R + 0.25) * 0.6, rr(-0.7, 0.7));
        }
      }
    }
    const trunks = instanced({ geo: trunkGeo, mat: barkM }, [...tm, ...fm]);
    tcol.forEach((c, i) => trunks.setColorAt(i, c)); for (let i = tm.length; i < tm.length + fm.length; i++) trunks.setColorAt(i, new THREE.Color(0.55, 0.45, 0.38));
    trunks.instanceColor.needsUpdate = true;
    instanced({ geo: stubGeo, mat: stubM }, stubs);
    const leafM = (map, color) => new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85,
      alphaToCoverage: true, shadowSide: THREE.DoubleSide });
    const needles = instanced({ geo: cardGeo, mat: leafM(NEEDLE, 0xe2e8d4) }, cards, { receive: true });
    const firNeedles = instanced({ geo: cardGeo, mat: leafM(FIRN, 0xdde6d0) }, fcards, { receive: true });
    for (const im of [needles, firNeedles]) {
      if (!im) continue;
      im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: im.material.map, alphaTest: 0.42, side: THREE.DoubleSide });
    }
  }

  // ---------------------------------------------------------------- undergrowth: ferns, grass, logs, stumps, boulders, stream stones, twigs
  const blocked = (x, z, pathGap, streamGap) => dPath(x, z) < pathGap || Math.abs(z - streamZ(x)) < streamGap;
  const nearTrunk = (x, z, gap) => trees.some((t) => Math.abs(t.x - x) < gap && Math.abs(t.z - z) < gap);
  {
    const parts = partsOf(fernP), lists = parts.map(() => []);
    let n = 0;
    for (let i = 0; i < 16000 && n < 4200; i++) {
      // most ferns sit within 20 m of the path or the stream, thinning further out
      const x = rr(-130, 90), z = rnd() < 0.75 ? pathZ(x) + rr(-16, 16) : rr(-80, 80);
      const dp = dPath(x, z), ds = Math.abs(z - streamZ(x)), dc = dClear(x, z);
      if (blocked(x, z, 1.75, 1.1) || dc < CLEARING.r - 4) continue;
      const clump = fbm(x * 0.12, z * 0.12);
      if (rnd() > 0.35 + clump * 0.6 + (dp < 4 ? 0.25 : 0)) continue;
      const k = Math.floor(rnd() * parts.length), s = rr(1.0, 2.1) * (dp < 2.6 ? 0.7 : 1);
      lists[k].push(mat4(x, groundY(x, z) - 0.03, z, rr(0, 2 * PI), s)); n++;
    }
    parts.forEach((p, k) => instanced(p, lists[k], { shadow: true }));
  }
  {
    const parts = partsOf(grassP).filter((p) => p.size.y > 0.07), lists = parts.map(() => []);
    for (const p of parts) { p.mat.alphaMap = p.mat.map; p.mat.alphaTest = 0.08; p.mat.color.multiplyScalar(1.3); p.mat.side = THREE.DoubleSide; p.mat.needsUpdate = true; }
    for (let i = 0; i < 20000; i++) {
      const r = rnd();
      let x, z;
      if (r < 0.3) { const a = rr(0, 2 * PI), d = Math.sqrt(rnd()) * (CLEARING.r + 2); x = CLEARING.x + Math.cos(a) * d; z = CLEARING.z + Math.sin(a) * d; }
      else if (r < 0.62) { x = rr(-130, 60); z = pathZ(x) + (rnd() < 0.5 ? -1 : 1) * rr(1.0, 3.2); }
      else { x = rr(-130, 90); z = pathZ(x) + rr(-30, 30); }
      if (blocked(x, z, 1.15, 1.0)) continue;
      if (x > PATH_END - 10 && dPath(x, z) < 1.4) continue;
      const k = Math.floor(rnd() * parts.length);
      lists[k].push(mat4(x, groundY(x, z) - 0.01, z, rr(0, 2 * PI), dPath(x, z) < 3.4 || dClear(x, z) < CLEARING.r ? rr(2.2, 3.6) : rr(3.0, 5.0)));
    }
    parts.forEach((p, k) => instanced(p, lists[k], { shadow: false }));
  }
  {
    const rockParts = partsOf(rocksP), lists = rockParts.map(() => []);
    // stones in and along the stream, some breaking the surface
    for (let x = GX0 + 5; x < GX1 - 5; x += rr(0.5, 1.6)) {
      const z = streamZ(x) + rr(-1.6, 1.6), ds = Math.abs(z - streamZ(x));
      const s = ds < 0.9 ? rr(0.16, 0.4) : rr(0.15, 0.55);
      const k = Math.floor(rnd() * rockParts.length);
      lists[k].push(mat4(x, groundY(x, z) - s * 0.25, z, rr(0, 2 * PI), s));
    }
    // a few stepping stones where the stream comes closest to the path, and stones scattered on the floor
    for (let i = 0; i < 160; i++) {
      const x = rr(-130, 90), z = pathZ(x) + rr(-28, 28); if (blocked(x, z, 2.2, 2.2) || nearTrunk(x, z, 1.2)) continue;
      const s = rr(0.2, 0.7); lists[Math.floor(rnd() * rockParts.length)].push(mat4(x, groundY(x, z) - s * 0.3, z, rr(0, 6.3), s));
    }
    rockParts.forEach((p, k) => instanced(p, lists[k]));
    const bp = partsOf(boulderP)[0], bl = [];
    for (let i = 0; i < 70; i++) {
      const x = rr(-140, 100), z = pathZ(x) + (rnd() < 0.5 ? -1 : 1) * rr(4.5, 40);
      if (blocked(x, z, 4.2, 3.0) || nearSouth(x, z) || nearTrunk(x, z, 2.0) || dClear(x, z) < CLEARING.r - 2) continue;
      const s = rr(1.0, 2.6); bl.push(mat4(x, groundY(x, z) - 0.25 * s, z, rr(0, 6.3), s));
    }
    // two boulders on the clearing's rim and one by the stream bank
    bl.push(mat4(CLEARING.x + 9, groundY(CLEARING.x + 9, CLEARING.z + 10) - 0.3, CLEARING.z + 10, 1.2, 2.2));
    bl.push(mat4(CLEARING.x - 4, groundY(CLEARING.x - 4, CLEARING.z - 9.5) - 0.2, CLEARING.z - 9.5, 0.4, 1.4));
    instanced(bp, bl);
    const sp = partsOf(stumpP)[0], sl = [];
    for (let i = 0; i < 90; i++) {
      const x = rr(-130, 90), z = pathZ(x) + rr(-35, 35);
      if (blocked(x, z, 3.0, 2.6) || nearSouth(x, z) || nearTrunk(x, z, 1.5) || dClear(x, z) < CLEARING.r - 3) continue;
      sl.push(mat4(x, groundY(x, z) - 0.12, z, rr(0, 6.3), rr(0.8, 1.5)));
    }
    instanced(sp, sl);
    const lp = partsOf(logP)[0], ll = [];
    for (let i = 0; i < 80; i++) {
      const x = rr(-130, 90), z = pathZ(x) + rr(-35, 35), s = rr(1.0, 2.2), a = rr(0, PI);
      const ex = Math.cos(a) * 1.6 * s, ez = -Math.sin(a) * 1.6 * s;
      if (blocked(x, z, 3.2 + 1.6 * s, 2.8) || blocked(x + ex, z + ez, 2.4, 2.4) || blocked(x - ex, z - ez, 2.4, 2.4) || nearSouth(x, z) || nearTrunk(x, z, 1.8)) continue;
      const y = Math.min(groundY(x, z), groundY(x + ex, z + ez), groundY(x - ex, z - ez)) - 0.05 * s;
      const tilt = Math.atan2(groundY(x + ex, z + ez) - groundY(x - ex, z - ez), 3.2 * s);
      ll.push(mat4(x, y, z, a, s, 0, tilt));
    }
    instanced(lp, ll);
    // fallen twigs and pine litter near the path, for the close shots
    const tw = new THREE.CylinderGeometry(1, 1, 1, 4, 1); tw.rotateZ(PI / 2);
    const twl = [];
    for (let i = 0; i < 2600; i++) {
      const x = rr(-110, 60), z = pathZ(x) + rr(-9, 9); if (blocked(x, z, 0.6, 1.3)) continue;
      dummy.position.set(x, groundY(x, z) + 0.01, z); dummy.rotation.set(0, rr(0, 6.3), rr(-0.08, 0.08));
      dummy.scale.set(rr(0.12, 0.7), rr(0.006, 0.016), rr(0.006, 0.016)); dummy.updateMatrix(); twl.push(dummy.matrix.clone());
    }
    instanced({ geo: tw, mat: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }) }, twl, { shadow: false });
  }

  // ---------------------------------------------------------------- shafts of light through the haze
  let shafts;
  {
    const st = shaftTex();
    const m = new THREE.MeshBasicMaterial({ map: st, color: 0xfff0cc, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: true, toneMapped: true });
    const L = 64;
    const g = new THREE.PlaneGeometry(1, L, 1, 1);
    shafts = new THREE.Group(); scene.add(shafts);
    const place = (x, z, w, op) => {
      // the shaft hangs from the canopy towards the ground along the sunlight, its foot at the ground point
      const foot = new V3(x, groundY(x, z), z), mid = foot.clone().addScaledVector(sunDir, L / 2 - 2);
      for (const yaw of [0, PI / 2]) {
        const mm = m.clone(); mm.opacity = op; mm.userData.base = op;
        const mesh = new THREE.Mesh(g, mm); mesh.position.copy(mid);
        mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), sunDir); mesh.rotateY(yaw + rr(-0.3, 0.3));
        mesh.scale.set(w, 1, 1); mesh.renderOrder = 5; shafts.add(mesh);
      }
    };
    for (let i = 0; i < 46; i++) {
      const x = rr(-80, 50), z = pathZ(x) + rr(-14, 14);
      place(x, z, rr(0.8, 3.2), rr(0.05, 0.12));
    }
    for (let i = 0; i < 10; i++) place(CLEARING.x - CLEARING.r - rr(0, 6), CLEARING.z + rr(-12, 12), rr(2.5, 5), rr(0.06, 0.1));
  }

  // ---------------------------------------------------------------- the people
  const people = {};
  cast.forEach((id, i) => { const f = figs[i]; f.object.visible = false; scene.add(f.object); people[id] = f; });
  const SPOT = new V3(-10, groundY(-10, pathZ(-10)), pathZ(-10));

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
  let focusPoint = SPOT.clone();
  const look = new V3();
  function update(state = {}) {
    const time = state.time || 0;
    water.material.normalMap.offset.set(-time * 0.35, time * 0.05);
    const ppl = state.people;
    let first = null;
    cast.forEach((id, i) => {
      const f = people[id];
      let p = ppl ? ppl[id] : (i === 0 ? { x: SPOT.x } : null);
      if (!p || p.show === false) { f.object.visible = false; return; }
      const x = p.x ?? SPOT.x, z = p.z ?? pathZ(x);
      f.object.visible = true;
      f.object.position.set(x, groundY(x, z), z);
      f.object.rotation.set(0, p.heading ?? pathAt(x).heading, 0);
      const g = p.gait || {}, walk = g.walk || 0, run = g.run || 0;
      f.pose(p.time ?? time, { idle: Math.max(0, 1 - walk - run), walk, run });
      if (!first) first = f.object.position;
    });
    camera.getWorldDirection(look);
    // the shafts read from the ground; from above they would be streaks, so they fade as the camera looks down
    const sh = (state.shafts ?? 1) * (1 - sstep(0.35, 0.8, -look.y));
    for (const m of shafts.children) { m.material.opacity = m.material.userData.base * sh; m.visible = sh > 0.01; }
    scene.fog.density = 0.0125 * (state.haze ?? 1);
    const fp = state.focus ? new V3(state.focus.x, state.focus.y ?? 0, state.focus.z) : first ? first.clone() : camera.position.clone().addScaledVector(look, 25);
    focusPoint.copy(first ? first.clone().add(new V3(0, 1.2, 0)) : fp);
    const rad = state.shadowRadius ?? Math.min(80, Math.max(18, camera.position.distanceTo(fp) * 1.1));
    sun.target.position.copy(fp);
    sun.position.copy(fp).addScaledVector(sunDir, 120);
    const sc = sun.shadow.camera;
    if (sc.right !== rad) { sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 1; sc.far = 260; sc.updateProjectionMatrix(); }
    sun.shadow.bias = rad > 40 ? -0.0008 : -0.0004;
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
    renderer, scene, camera, update, render, cast: people, person: people[cast[0]]?.object, gaitSpeed,
    pathZ, pathAt, streamZ, groundY, CLEARING, SPOT, sun, sunDir, trees, water, PATH_HALF, STREAM_Y,
  };
}
