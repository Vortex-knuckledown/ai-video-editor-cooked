// World "desert": a rocky desert at midday with a straight two-lane highway running to the horizon.
//
// Axes (metres): +y up. The highway runs along z; its far end (the horizon, with a red mesa beside it) is at -z.
// +x is the RIGHT of someone travelling towards -z. Road surface top at y = world.ROAD_Y (0.02).
//   lanes      3.6 m each: the right lane (centre x = +1.8) drives towards -z, the left lane (x = -1.8) towards +z;
//              dashed yellow centre line at x = 0, white edge lines at x = +-3.6
//   shoulders  paved, x 3.75..5.5 (right) and -5.5..-3.75 (left); world.SHOULDER_X (4.6) is where people walk
//   verges     gravel and sand x 5.5..9, then the desert rises into low dunes and rock; nothing stands within 8 m
//              of the road centre except the delineator posts (x = +-6.4) and one speed-limit sign (x = 6.9, z = -32)
//   poles      telephone poles every 55 m at x = -14 with three sagging wires; barbed-wire fences at x = +-24
//   far        red mesas and buttes 1.5 to 6 km out on every side, in haze; terrain to 12 km
// The action is meant to happen around z = -250..250 (dense ground, cacti, scrub, boulders); the road and the
// poles run on for kilometres in both directions so a car can drive any distance.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"]}) -> world. Per frame: set world.camera (position,
// fov, lookAt), then world.update(state), then world.render().
//
// state (every field optional):
//   time         seconds of the shot (drives the figures' animation clock by default)
//   people       {<id>: {x, z, heading, time, gait: {walk, run}, show}} for ids in cast. heading radians about +y,
//                0 faces +z, PI faces -z (towards the horizon). gait weights 0..1, idle gets the rest. Move a
//                walker by world.gaitSpeed[id].walk * walk (+ .run * run) metres a second so the feet never slide.
//                When `people` is given, a cast member not in it is hidden. Without it, the first cast member
//                stands idle on the right shoulder at (4.6, 0) facing the horizon.
//   car          {z, lane, show} the car (a blue sedan). lane 1 = right lane heading -z (default), -1 = left lane
//                heading +z. Wheels turn with z. Default z = -45. car: false hides it.
//   focus        {x, y, z} the shadow box centre (default the first visible person, else the car)
//   shadowRadius metres of the shadow box round the focus (default from the camera's distance)
//
// Exposes: world.cast.<id> (loadFigure results), world.person (first cast member's object), world.gaitSpeed.<id>
// {walk, run} m/s, world.car (Group, faces +z in its own frame), world.sun (DirectionalLight), world.sunDir,
// world.height(x, z) (ground height there), world.ROAD_Y, world.SHOULDER_X, world.LANE_X (1.8), world.ROAD_HALF
// (5.5), world.mesas (array of {x, z, r, h}), world.sign (Vector3 of the speed-limit sign), world.poleX (-14).
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"] }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const ROAD_Y = 0.02, SHOULDER_X = 4.6, LANE_X = 1.8, ROAD_HALF = 5.5, POLE_X = -14, FENCE_X = 24;

  // ---------------------------------------------------------------- renderer, camera
  const W = canvas.width || 1920, H = canvas.height || 1080;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 20000);
  camera.position.set(-20, 6, 30); camera.lookAt(3, 1.5, -20);

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f) => new Promise((res, rej) => TL.load(K + f, res, undefined, rej));
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const hdrL = new HDRLoader(); hdrL.setDataType(THREE.FloatType);
  const [sky, SAND, ASPH, ROCK, CONC, boulderA, boulderB, pebbles, deadTree, figures] = await Promise.all([
    hdrL.loadAsync(K + "sky/day.hdr"), pbrSet("sand"), pbrSet("asphalt"), pbrSet("rock"), pbrSet("concrete"),
    loadProp({ THREE, id: "namaqualand_boulder_03" }), loadProp({ THREE, id: "namaqualand_boulder_05" }),
    loadProp({ THREE, id: "namaqualand_boulders_01" }), loadProp({ THREE, id: "dead_quiver_trunk" }),
    Promise.all(cast.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] }))),
  ]);

  // ---------------------------------------------------------------- deterministic random and noise
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const hash = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
  const sm = (t) => t * t * (3 - 2 * t);
  const noise = (x, z) => { const i = Math.floor(x), j = Math.floor(z), fx = sm(x - i), fz = sm(z - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz; };
  const fbm = (x, z, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * noise(x * f + k * 17.3, z * f - k * 9.1); n += a; a *= 0.5; f *= 2.03; } return s / n; };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const step = (a, b, v) => sm(clamp01((v - a) / (b - a)));

  // ---------------------------------------------------------------- the ground's height
  function height(x, z) {
    const ax = Math.abs(x);
    if (ax < 9) return 0.0;
    const k = step(9, 55, ax), far = Math.min(1, ax / 900);
    let h = (fbm(x * 0.0035, z * 0.0035, 4) - 0.42) * 22 * k * (0.3 + far);                 // broad swells
    const u = x * 0.8 + z * 0.6 + 90 * fbm(x * 0.002 + 7, z * 0.002, 3);
    const ridge = Math.pow(1 - Math.abs(Math.sin(u * 0.011)), 2.4);                          // dune crests
    const duneMask = step(0.38, 0.62, fbm(x * 0.0013 + 3, z * 0.0013 - 2, 3));
    h += ridge * (1.5 + 18 * far) * k * duneMask;
    h += (fbm(x * 0.07, z * 0.07, 2) - 0.5) * 0.7 * k;                                         // hummocks
    return Math.max(h, -1.2 * k);
  }

  // ---------------------------------------------------------------- sky: find the Sun, take the horizon colour
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const SUN_AZ = Math.atan2(0.55, -0.62);                                    // the Sun to the front-left, slightly behind
  const SUN_EL = 1.05;                                                       // about 60 degrees: midday
  let fogCol = new THREE.Color(0xd8dde2), skyRot = 0;
  {
    const { data, width: SW, height: SH } = sky.image;
    let best = -1, bi = 0; const hor = [0, 0, 0]; let hn = 0;
    for (let r = 0; r < SH; r++) for (let c = 0; c < SW; c++) {
      const i = (r * SW + c) * 4, L = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (L > best) { best = L; bi = r * SW + c; }
      const el = (0.5 - (r + 0.5) / SH) * PI;
      if (el > 0.01 && el < 0.09 && L < 4) { hor[0] += data[i]; hor[1] += data[i + 1]; hor[2] += data[i + 2]; hn++; }
    }
    const u = ((bi % SW) + 0.5) / SW, phi = (u - 0.5) * 2 * PI;
    skyRot = Math.atan2(Math.sin(phi), Math.cos(phi)) - SUN_AZ;
    if (hn) { fogCol = new THREE.Color(hor[0] / hn, hor[1] / hn, hor[2] / hn); const m = Math.max(fogCol.r, fogCol.g, fogCol.b); fogCol.multiplyScalar(0.62 / m); }
    fogCol.lerp(new THREE.Color(0.55, 0.58, 0.62), 0.5);                            // a little dust in the haze
  }
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, skyRot, 0); scene.environmentRotation.set(0, skyRot, 0);
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.FogExp2(fogCol, 0.0002);

  const sunDir = new V3(Math.cos(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), Math.sin(SUN_AZ) * Math.cos(SUN_EL)).normalize();
  const sun = new THREE.DirectionalLight(0xfff1df, 3.4);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd3ef, 0xb08a62, 0.35));          // blue sky above, warm sand bounce below

  // ---------------------------------------------------------------- the desert floor (dense near the action)
  function axis(dense, step0, grow, extent) {
    const v = []; for (let x = -dense; x <= dense + 1e-6; x += step0) v.push(x);
    let s = step0, x = dense; while (x < extent) { s *= grow; x += s; v.push(x); v.unshift(-x); }
    return v;
  }
  {
    const xs = axis(70, 1.5, 1.05, 12000), zs = axis(320, 2, 1.05, 12000);
    const nx = xs.length, nz = zs.length, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
    const cA = new THREE.Color(0xf3dfc4), cB = new THREE.Color(0xd9b48c), cG = new THREE.Color(0xb7a58e), c = new THREE.Color();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i, y = height(x, z);
      pos.set([x, y, z], k * 3); uv.set([x / 3.2, -z / 3.2], k * 2);
      c.copy(cA).lerp(cB, clamp01(fbm(x * 0.004 - 5, z * 0.004 + 1, 4) * 1.6 - 0.35));
      c.lerp(cG, (1 - step(6, 14, Math.abs(x))) * 0.6);                    // gravel verge
      c.multiplyScalar(0.92 + 0.16 * fbm(x * 0.05, z * 0.05, 2));
      col.set([c.r, c.g, c.b], k * 3);
    }
    const idx = []; for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1; idx.push(a, d, b, b, d, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ ...SAND, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) });
    const ground = new THREE.Mesh(g, m); ground.receiveShadow = true; scene.add(ground);
  }

  // ---------------------------------------------------------------- the highway
  {
    const len = 14000, z0 = -10000;
    const asph = { map: ASPH.map.clone(), normalMap: ASPH.normalMap.clone(), roughnessMap: ASPH.roughnessMap.clone() };
    for (const t of Object.values(asph)) { t.repeat.set(ROAD_HALF * 2 / 4, len / 4); t.needsUpdate = true; }
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, len),
      new THREE.MeshStandardMaterial({ ...asph, color: 0xb8b0a6, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    road.rotation.x = -PI / 2; road.position.set(0, ROAD_Y, z0 + len / 2); road.receiveShadow = true; scene.add(road);
    // darker, worn tyre tracks in each lane
    const wornM = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.9, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    for (const x of [-2.6, -1.0, 1.0, 2.6]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.7, len), wornM); p.rotation.x = -PI / 2; p.position.set(x, ROAD_Y + 0.002, z0 + len / 2); p.receiveShadow = true; scene.add(p); }
    const paint = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.15, len), paint(0xeeeae0)); e.rotation.x = -PI / 2; e.position.set(sx * 3.6, ROAD_Y + 0.004, z0 + len / 2); e.receiveShadow = true; scene.add(e); }
    const dashG = new THREE.PlaneGeometry(0.13, 3); dashG.rotateX(-PI / 2);
    const n = Math.floor(len / 12), dash = new THREE.InstancedMesh(dashG, paint(0xe2b23a), n), mm = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { mm.makeTranslation(0, ROAD_Y + 0.004, z0 + i * 12 + 1.5); dash.setMatrixAt(i, mm); }
    dash.receiveShadow = true; scene.add(dash);
  }
  // a mirage: the road ahead shines like water from a low eye, fading with height
  const mirageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, transparent: true, opacity: 0.0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 512; const cx = cv.getContext("2d");
    const gr = cx.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, "#000"); gr.addColorStop(0.35, "#fff"); gr.addColorStop(0.7, "#888"); gr.addColorStop(1, "#000");
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 512);
    const sg = cx.createLinearGradient(0, 0, 64, 0); sg.addColorStop(0, "rgba(0,0,0,1)"); sg.addColorStop(0.2, "rgba(0,0,0,0)"); sg.addColorStop(0.8, "rgba(0,0,0,0)"); sg.addColorStop(1, "rgba(0,0,0,1)");
    cx.fillStyle = sg; cx.fillRect(0, 0, 64, 512);
    mirageMat.alphaMap = new THREE.CanvasTexture(cv);
  }
  const mirage = new THREE.Mesh(new THREE.PlaneGeometry(9, 900), mirageMat);
  mirage.rotation.x = -PI / 2; mirage.position.y = ROAD_Y + 0.006; scene.add(mirage);

  // ---------------------------------------------------------------- helpers for geometry
  const prep = (g, color) => {
    g = g.index ? g.toNonIndexed() : g;
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) { const c = new Float32Array(g.attributes.position.count * 3); const cc = new THREE.Color(color ?? 0xffffff); for (let i = 0; i < c.length; i += 3) c.set([cc.r, cc.g, cc.b], i); g.setAttribute("color", new THREE.BufferAttribute(c, 3)); }
    return g;
  };
  const inst = (geo, mat, list, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D();
    list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0); o.scale.setScalar(p.s || 1); if (p.sy) o.scale.y = p.sy * (p.s || 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
  };
  const instProp = (root, list) => {   // a library prop placed many times: one InstancedMesh per part
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      inst(g, o.material, list); });
  };
  // where things may stand: off the road corridor
  const spot = (minAx, maxAx, zMin, zMax) => { for (;;) { const x = rr(-maxAx, maxAx), z = rr(zMin, zMax); if (Math.abs(x) >= minAx) return { x, z }; } };

  // ---------------------------------------------------------------- cacti (built: ribbed capsules)
  const ribbed = (r, len, ribs = 14, depth = 0.07) => {
    const g = new THREE.CapsuleGeometry(r, len, 6, 28); const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), f = Math.cos(a * ribs), k = 1 + depth * f;
      p.setX(i, x * k); p.setZ(i, z * k); const s = 0.78 + 0.22 * (f * 0.5 + 0.5); c.set([0.11 * s, 0.19 * s, 0.07 * s], i * 3); }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3)); g.computeVertexNormals(); return prep(g);
  };
  const saguaro = (h, arms) => {
    const parts = [], r = 0.23, t = ribbed(r, h - 2 * r); t.translate(0, h / 2 - 0.15, 0); parts.push(t);
    for (const [side, y0, up, out] of arms) {
      const ar = r * 0.72, el = ribbed(ar, out); el.rotateZ(PI / 2); el.translate(side * (out / 2 + r * 0.6), y0, 0); parts.push(el);
      const v = ribbed(ar, up); v.translate(side * (out + r * 0.6), y0 + up / 2, 0); parts.push(v);
    }
    return mergeGeometries(parts);
  };
  const cactusMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
  const SAG = [saguaro(5.2, [[1, 2.3, 1.4, 0.55], [-1, 2.9, 1.1, 0.5]]), saguaro(4.0, [[1, 1.9, 0.9, 0.5]]), saguaro(6.3, [[-1, 2.1, 1.9, 0.6], [1, 3.0, 1.3, 0.5], [-1, 3.6, 0.8, 0.45]]), saguaro(2.6, [])];
  const barrelG = (() => { const g = ribbed(0.3, 0.25, 18, 0.09); g.translate(0, 0.3, 0); return g; })();
  const pearG = (() => { const parts = []; const pad = (x, y, rz, ry, s) => { const g = prep(new THREE.SphereGeometry(0.22, 14, 10), 0x2f4a1c); g.scale(s, s * 1.2, s * 0.22); g.rotateZ(rz); g.rotateY(ry); g.translate(x, y, 0); parts.push(g); };
    pad(0, 0.22, 0, 0, 1); pad(0.18, 0.5, -0.5, 0.6, 0.9); pad(-0.2, 0.48, 0.45, -0.4, 0.95); pad(0.05, 0.75, 0.1, 1.2, 0.8); pad(0.32, 0.7, -0.9, 0.2, 0.7); pad(-0.3, 0.2, 1.1, 0.9, 0.85);
    return mergeGeometries(parts); })();
  {
    const S = [[], [], [], []], B = [], P = [];
    for (let i = 0; i < 260; i++) { const { x, z } = spot(12, 700, -900, 700); const s = rr(0.8, 1.15); S[i % 4].push({ x, z, y: height(x, z) - 0.2, ry: rr(0, 2 * PI), s }); }
    for (let i = 0; i < 26; i++) { const { x, z } = spot(10, 45, -260, 260); S[i % 4].push({ x, z, y: height(x, z) - 0.2, ry: rr(0, 2 * PI), s: rr(0.75, 1.1) }); }
    for (let i = 0; i < 120; i++) { const { x, z } = spot(8.5, 120, -350, 350); B.push({ x, z, y: height(x, z) - 0.06, ry: rr(0, 6), s: rr(0.6, 1.3) }); }
    for (let i = 0; i < 150; i++) { const { x, z } = spot(9, 160, -400, 400); P.push({ x, z, y: height(x, z) - 0.05, ry: rr(0, 6), s: rr(0.7, 1.5) }); }
    SAG.forEach((g, i) => inst(g, cactusMat, S[i])); inst(barrelG, cactusMat, B); inst(pearG, cactusMat, P);
  }

  // ---------------------------------------------------------------- scrub and dry grass
  {
    const bushG = (() => { const parts = []; for (let i = 0; i < 12; i++) { const g = new THREE.IcosahedronGeometry(rr(0.2, 0.4), 1); const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) { const f = 1 + (hash(k + i * 97, 3) - 0.5) * 0.5; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.8, p.getZ(k) * f); }
        const a = rr(0, 2 * PI), d = rr(0, 0.45); g.translate(Math.cos(a) * d, rr(0.25, 0.6), Math.sin(a) * d); g.computeVertexNormals(); parts.push(prep(g)); }
      const g = mergeGeometries(parts), p = g.attributes.position, c = g.attributes.color, a = new THREE.Color(0x5e6136), b = new THREE.Color(0x8b8152), cc = new THREE.Color();
      for (let k = 0; k < p.count; k++) { cc.copy(a).lerp(b, hash(Math.floor(p.getX(k) * 40), Math.floor(p.getZ(k) * 40))); c.setXYZ(k, cc.r, cc.g, cc.b); }
      return g; })();
    const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const tuftG = (() => { const v = [], n = 22; for (let i = 0; i < n; i++) { const a = i / n * 2 * PI + rr(-0.2, 0.2), lean = rr(0.15, 0.45), h = rr(0.25, 0.55), w = 0.025;
        const bx = Math.cos(a) * 0.04, bz = Math.sin(a) * 0.04, tx = Math.cos(a) * lean * h * 1.4, tz = Math.sin(a) * lean * h * 1.4, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        v.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g; })();
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0xc2a670, roughness: 1, side: THREE.DoubleSide });
    const bushes = [], tufts = [];
    for (let i = 0; i < 2600; i++) { const { x, z } = spot(8, 1100, -1300, 1100); bushes.push({ x, z, y: height(x, z) - 0.08, ry: rr(0, 6), s: rr(0.6, 1.5) }); }
    for (let i = 0; i < 700; i++) { const { x, z } = spot(7.5, 40, -300, 300); bushes.push({ x, z, y: height(x, z) - 0.08, ry: rr(0, 6), s: rr(0.5, 1.2) }); }
    for (let i = 0; i < 5000; i++) { const { x, z } = spot(6.2, 90, -320, 320); tufts.push({ x, z, y: height(x, z) - 0.02, ry: rr(0, 6), s: rr(0.6, 1.4) }); }
    inst(bushG, bushMat, bushes); inst(tuftG, tuftMat, tufts, false);
  }

  // ---------------------------------------------------------------- rocks: library boulders, gravel, outcrops
  {
    const big = [], mid = [], peb = [], dead = [];
    for (let i = 0; i < 90; i++) { const { x, z } = spot(11, 500, -700, 600); const s = rr(0.8, 2.6); big.push({ x, z, y: height(x, z) - 0.25 * s, ry: rr(0, 6), s }); }
    for (let i = 0; i < 40; i++) { const { x, z } = spot(60, 900, -1200, 900); const s = rr(5, 14); big.push({ x, z, y: height(x, z) - 0.35 * s, ry: rr(0, 6), s }); }  // outcrops
    for (let i = 0; i < 260; i++) { const { x, z } = spot(8, 140, -350, 350); const s = rr(0.7, 2.2); mid.push({ x, z, y: height(x, z) - 0.12 * s, ry: rr(0, 6), s }); }
    for (let i = 0; i < 1400; i++) { const { x, z } = spot(5.7, 30, -300, 300); const s = rr(0.6, 2.4); peb.push({ x, z, y: height(x, z) - 0.04 * s, ry: rr(0, 6), s }); }
    for (let i = 0; i < 14; i++) { const { x, z } = spot(14, 300, -500, 400); dead.push({ x, z, y: height(x, z) - 0.05, ry: rr(0, 6), s: rr(0.9, 1.6) }); }
    instProp(boulderA, big); instProp(boulderB, mid); instProp(pebbles, peb); instProp(deadTree, dead);
  }

  // ---------------------------------------------------------------- mesas and buttes far off
  const mesas = [];
  {
    const rock = { map: ROCK.map.clone(), normalMap: ROCK.normalMap.clone(), roughnessMap: ROCK.roughnessMap.clone() };
    const mesaMat = new THREE.MeshStandardMaterial({ ...rock, vertexColors: true, roughness: 0.95 });
    const red = new THREE.Color(0xc0643c), pale = new THREE.Color(0xd8a274), dark = new THREE.Color(0x8a4428), talus = new THREE.Color(0xd2a47a), cc = new THREE.Color();
    function mesa(cx, cz, R, Hh, sd) {
      const SEG = 120, prof = [[1.45, 0], [1.22, 0.12], [1.08, 0.24], [1.02, 0.3], [1.0, 0.45], [0.99, 0.62], [0.985, 0.8], [0.97, 0.93], [0.95, 0.985], [0.9, 1.0], [0, 1.0]];
      const rows = prof.length, pos = [], uv = [], col = [], idx = [];
      const rad = (a) => R * (1 + 0.28 * (fbm(Math.cos(a) * 1.6 + sd, Math.sin(a) * 1.6 - sd, 4) - 0.5) * 2 + 0.06 * Math.sin(a * 23 + sd));
      for (let r = 0; r < rows; r++) for (let s = 0; s <= SEG; s++) {
        const a = s / SEG * 2 * PI, [f, hy] = prof[r], rr0 = r === rows - 1 ? 0 : rad(a) * f + (r > 2 && r < rows - 2 ? (hash(s, r + sd * 7) - 0.5) * R * 0.03 : 0);
        const y = hy * Hh, x = cx + Math.cos(a) * rr0, z = cz + Math.sin(a) * rr0;
        pos.push(x, y + (r === 0 ? height(x, z) - 6 : height(cx, cz) - 6), z); uv.push(a * R / 30, y / 30);
        if (r <= 2) cc.copy(talus).lerp(red, r / 3); else { const band = Math.sin(hy * 38 + Math.sin(a * 3) * 0.6) * 0.5 + 0.5; cc.copy(red).lerp(pale, band * 0.55); if (hy > 0.9) cc.lerp(dark, 0.3); }
        cc.multiplyScalar(0.85 + 0.25 * hash(s, r)); col.push(cc.r, cc.g, cc.b);
      }
      for (let r = 0; r < rows - 1; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mesaMat); m.receiveShadow = true; scene.add(m); mesas.push({ x: cx, z: cz, r: R, h: Hh });
    }
    // the road's landmark: a long mesa just right of the highway's vanishing point, and a butte left of it
    mesa(900, -4200, 650, 260, 1); mesa(-700, -3300, 140, 230, 2); mesa(-2400, -4800, 900, 300, 3);
    mesa(2600, -2200, 500, 200, 4); mesa(-3000, -1500, 600, 240, 5); mesa(3300, 600, 700, 280, 6);
    mesa(-2600, 1900, 450, 220, 7); mesa(1500, 3400, 380, 260, 8); mesa(-900, 4300, 800, 230, 9);
    mesa(1800, -1300, 120, 170, 10); mesa(-1700, -700, 160, 190, 11); mesa(4200, -4600, 900, 320, 12);
  }

  // ---------------------------------------------------------------- telephone poles and wires, fences, posts, sign
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b553e, roughness: 0.92, map: CONC.map, normalMap: CONC.normalMap });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.45, metalness: 0.7 });
  {
    const polePts = [];
    const poleG = new THREE.CylinderGeometry(0.12, 0.17, 9, 10); poleG.translate(0, 4.4, 0);
    const armG = new THREE.BoxGeometry(2.4, 0.14, 0.14); armG.translate(0, 8.3, 0);
    const insG = new THREE.CylinderGeometry(0.05, 0.06, 0.22, 8); const insGs = [-1.0, 0, 1.0].map((dx) => { const g = insG.clone(); g.translate(dx, 8.48, 0); return g; });
    const ins = mergeGeometries(insGs); const insMat = new THREE.MeshStandardMaterial({ color: 0x4a6b6a, roughness: 0.3 });
    const list = [];
    for (let z = -6000; z <= 2500; z += 55) { const y = height(POLE_X, z) - 0.4; list.push({ x: POLE_X, z, y, ry: PI / 2 }); polePts.push(new V3(POLE_X, y + 8.6, z)); }
    inst(poleG, wood, list); inst(armG, wood, list); inst(ins, insMat, list);
    const wv = [];
    for (const dx of [-1.0, 0, 1.0]) for (let i = 0; i < polePts.length - 1; i++) { const a = polePts[i], b = polePts[i + 1]; let prev = null;
      for (let s = 0; s <= 10; s++) { const t = s / 10, p = new V3(a.x, a.y + (b.y - a.y) * t - 0.9 * 4 * t * (1 - t), a.z + (b.z - a.z) * t + dx); if (prev) wv.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p; } }
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wv, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2724, transparent: true, opacity: 0.8 })));
  }
  {
    const postG = new THREE.CylinderGeometry(0.05, 0.06, 1.4, 6); postG.translate(0, 0.6, 0);
    const list = [], wv = [];
    for (const sx of [-1, 1]) { let prev = null;
      for (let z = -3000; z <= 1500; z += 4) { const x = sx * FENCE_X + (fbm(z * 0.01, sx) - 0.5) * 0.6, y = height(x, z) - 0.1; list.push({ x, z, y, rz: (hash(z, sx) - 0.5) * 0.12 });
        const p = [0.45, 0.8, 1.15].map((h) => new V3(x, y + h, z)); if (prev) for (let k = 0; k < 3; k++) wv.push(prev[k].x, prev[k].y - 0.02, prev[k].z, p[k].x, p[k].y - 0.02, p[k].z); prev = p; } }
    inst(postG, wood, list);
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wv, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x5b5650, transparent: true, opacity: 0.7 })));
  }
  {
    const dG = new THREE.BoxGeometry(0.1, 1.15, 0.06); dG.translate(0, 0.55, 0);
    const rG = new THREE.BoxGeometry(0.08, 0.16, 0.065); rG.translate(0, 0.98, 0);
    const list = []; for (let z = -6000; z <= 2500; z += 80) for (const sx of [-1, 1]) list.push({ x: sx * 6.4, z: z + (sx > 0 ? 40 : 0), y: -0.06 });
    inst(dG, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6 }), list);
    inst(rG, new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x6a3a00, roughness: 0.3, metalness: 0.4 }), list, false);
  }
  const signPos = new V3(6.9, 0, -32);
  {
    const cv = document.createElement("canvas"); cv.width = 384; cv.height = 480; const c = cv.getContext("2d");
    c.fillStyle = "#f4f2ec"; c.fillRect(0, 0, 384, 480); c.strokeStyle = "#141414"; c.lineWidth = 14; c.strokeRect(22, 22, 340, 436);
    c.fillStyle = "#141414"; c.textAlign = "center"; c.font = "bold 66px Helvetica, Arial, sans-serif"; c.fillText("SPEED", 192, 120); c.fillText("LIMIT", 192, 196);
    c.font = "bold 190px Helvetica, Arial, sans-serif"; c.fillText("65", 192, 400);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.95, 0.03), [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }), metal]);
    face.position.y = 2.15; const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 0.08), metal); post.position.set(0, 1.1, -0.04);
    g.add(face, post); g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.position.set(signPos.x, -0.06, signPos.z); g.rotation.y = 0; scene.add(g);   // its face looks along +z, at traffic heading -z
  }

  // ---------------------------------------------------------------- the car: a blue sedan, faces +z, wheels on y = 0
  const car = new THREE.Group(); const wheels = [];
  {
    const paintM = new THREE.MeshPhysicalMaterial({ color: 0x23507e, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0x0d1218, metalness: 0.9, roughness: 0.06, side: THREE.DoubleSide });
    const trimM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    const prof = [[-2.3, 0.3], [-1.2, 0.29], [0, 0.29], [1.2, 0.29], [2.25, 0.31], [2.37, 0.48], [2.33, 0.66], [2.12, 0.8], [1.5, 0.87], [0.95, 0.93], [0.55, 1.18], [0.2, 1.36], [-0.45, 1.41],
      [-1.05, 1.38], [-1.5, 1.15], [-1.82, 0.99], [-2.28, 0.94], [-2.39, 0.62]];
    const curve = new THREE.CatmullRomCurve3(prof.map(([z, y]) => new V3(z, y, 0)), true, "centripetal");
    const sh = new THREE.Shape(curve.getPoints(140).map((p) => new THREE.Vector2(p.x, p.y)));
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 1.56, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.12, bevelSegments: 5, curveSegments: 4 });
    bg.translate(0, 0, -0.78); bg.rotateY(PI / 2);     // profile x -> world -z ; flip so the nose is +z
    bg.rotateY(PI); const body = new THREE.Mesh(bg, paintM); car.add(body);
    // windows: side panes, windscreen, rear screen
    const win = [[0.86, 0.96], [0.2, 1.31], [-1.0, 1.33], [-1.68, 1.0]];
    const ws = new THREE.Shape(); win.forEach(([z, y], i) => (i ? ws.lineTo(z, y) : ws.moveTo(z, y)));
    for (const sx of [-1, 1]) { const g = new THREE.ShapeGeometry(ws); g.rotateY(-PI / 2); const m = new THREE.Mesh(g, glassM); m.position.x = sx * 0.902; car.add(m); }
    const pane = (a, b, w) => { const [z1, y1] = a, [z2, y2] = b, L = Math.hypot(z2 - z1, y2 - y1); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, L), glassM);
      const al = Math.atan2(z2 - z1, y2 - y1); m.rotation.x = al;
      m.position.set(0, (y1 + y2) / 2 - Math.sin(al) * 0.02, (z1 + z2) / 2 + Math.cos(al) * 0.02); car.add(m); };
    pane([0.93, 0.93], [0.21, 1.36], 1.55); pane([-1.06, 1.38], [-1.79, 0.99], 1.5);
    // bumpers, lights, mirrors, plate
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); car.add(b); return b; };
    box(1.82, 0.16, 0.12, 0, 0.4, 2.38, trimM); box(1.82, 0.16, 0.12, 0, 0.42, -2.42, trimM);
    const headM = new THREE.MeshStandardMaterial({ color: 0xf6f4ee, emissive: 0x777066, roughness: 0.1, metalness: 0.3 });
    const tailM = new THREE.MeshStandardMaterial({ color: 0x8a0a0a, emissive: 0x3a0000, roughness: 0.2 });
    for (const sx of [-1, 1]) { box(0.42, 0.12, 0.06, sx * 0.62, 0.66, 2.33, headM); box(0.4, 0.13, 0.06, sx * 0.64, 0.8, -2.35, tailM); box(0.08, 0.1, 0.2, sx * 0.98, 1.0, 0.82, paintM); }
    box(0.52, 0.12, 0.02, 0, 0.6, -2.4, new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.5 }));
    box(1.5, 0.05, 3.8, 0, 0.3, 0, trimM);   // sill / underbody shadow
    const tyreG = new THREE.CylinderGeometry(0.34, 0.34, 0.23, 24); tyreG.rotateZ(PI / 2);
    const rimG = new THREE.CylinderGeometry(0.21, 0.21, 0.235, 12); rimG.rotateZ(PI / 2);
    const spokeG = new THREE.BoxGeometry(0.24, 0.05, 0.36);
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    for (const [sx, z] of [[-1, 1.45], [1, 1.45], [-1, -1.42], [1, -1.42]]) {
      const w = new THREE.Group(); w.position.set(sx * 0.8, 0.34, z);
      w.add(new THREE.Mesh(tyreG, tyreM), new THREE.Mesh(rimG, metal)); for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(spokeG, metal); s.rotation.x = k * PI / 3; w.add(s); }
      car.add(w); wheels.push(w);
      const well = new THREE.Mesh(new THREE.CircleGeometry(0.43, 24, 0, PI), trimM); well.rotation.y = sx * PI / 2; well.position.set(sx * 0.906, 0.33, z); car.add(well);
    }
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(car);
  }

  // ---------------------------------------------------------------- the people
  const castMap = {}, gaitSpeed = {};
  const footOf = (o) => { let f = null; o.traverse((b) => { if (!f && b.isBone && /left.?foot$/i.test(b.name)) f = b; }); return f; };
  function measure(fig, name) {   // metres a second the planted foot slides back: the speed that keeps it still
    if (!fig.actions[name]) return 0;
    const foot = footOf(fig.object), dur = fig.durations[name], N = 120, P = [], v = new V3();
    if (!foot) return name === "run" ? 3.4 : 1.35;
    for (let i = 0; i < N; i++) { fig.pose(dur * i / N, name); fig.object.updateMatrixWorld(true); foot.getWorldPosition(v); P.push(v.clone()); }
    const minY = Math.min(...P.map((p) => p.y)), vals = [];
    for (let i = 0; i < N - 1; i++) if (P[i].y < minY + 0.035 && P[i + 1].y < minY + 0.035) vals.push(-(P[i + 1].z - P[i].z) / (dur / N));
    vals.sort((a, b) => a - b); const m = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    return m > 0.3 ? m : (name === "run" ? 3.4 : 1.35);
  }
  figures.forEach((f) => { castMap[f.id] = f; gaitSpeed[f.id] = { walk: measure(f, "walk"), run: measure(f, "run") }; f.pose(0, "idle"); scene.add(f.object); });

  // ---------------------------------------------------------------- update
  const _f = new V3(), _c = new V3();
  function update(st = {}) {
    const time = st.time ?? 0;
    let focus = null;
    figures.forEach((f, i) => {
      let p = st.people ? st.people[f.id] : (i === 0 ? {} : null);
      if (p && p.show === false) p = null;
      f.object.visible = !!p; if (!p) return;
      const g = p.gait || {}, walk = clamp01(g.walk || 0), run = clamp01(g.run || 0);
      f.object.position.set(p.x ?? SHOULDER_X, ROAD_Y, p.z ?? 0); f.object.rotation.y = p.heading ?? PI;
      f.pose(p.time ?? time, { idle: Math.max(0, 1 - walk - run), walk, run });
      if (!focus) focus = f.object.position;
    });
    const c = st.car;
    car.visible = !(c === false || (c && c.show === false));
    if (car.visible) { const lane = (c && c.lane) === -1 ? -1 : 1, z = c?.z ?? -45;
      car.position.set(lane * LANE_X, ROAD_Y, z); car.rotation.y = lane === 1 ? PI : 0;
      const d = lane === 1 ? -z : z; for (const w of wheels) w.rotation.x = d / 0.34;
      if (!focus) focus = car.position; }
    // the mirage only shows from a low eye
    const ch = camera.position.y;
    mirageMat.opacity = 0.55 * (1 - step(3, 18, ch)); mirage.visible = mirageMat.opacity > 0.01;
    mirage.position.set(0, ROAD_Y + 0.006, camera.position.z - 140 - 450 * (Math.abs(camera.position.x) < 30 ? 1 : 0.6));
    if (Math.abs(camera.position.x) > 60) mirage.visible = false;
    // shadows follow the focus
    const f = st.focus ? _f.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : focus ? _f.copy(focus) : _f.set(0, 0, 0);
    const R = st.shadowRadius ?? Math.min(400, Math.max(18, camera.position.distanceTo(f) * 1.2));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 1600 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sunDir, 700); sun.target.updateMatrixWorld();
    _c.copy(f);
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: figures[0] ? figures[0].object : null, gaitSpeed, car, sun, sunDir: sunDir.clone(), height,
    ROAD_Y, SHOULDER_X, LANE_X, ROAD_HALF, mesas, sign: signPos, poleX: POLE_X,
  };
}
