// World "moon": the surface of the Moon with the Sun low.
//
// Grey regolith (the kit's sand surface, turned grey, at two scales so it never tiles), craters from 0.3 m to 200 m
// across with raised rims, a field of rocks and boulders, long hard shadows from a Sun 11 degrees up in the east,
// a ring of far highlands on the horizon. A landing module (gold-foil descent stage on four legs with a ladder,
// a silver ascent stage with windows, hatch, dish and thrusters), a flag beside it, a parked rover with its wheel
// tracks, a small science station with cables, boot prints along a trodden path. The Earth hangs small and blue,
// half lit, in a black sky full of stars. One or more people from the library walk the path.
//
// Axes (metres): +x is EAST (towards the Sun), +y up, +z SOUTH. A camera south of the path looking north (-z) sees
// the path side on, the lander behind it, the Earth up and to the left, shadows falling to the left.
//   the path      z = 3, flat and trodden, good for walking from x = -120 to 120 (world.path)
//   the lander    centred (0, -8), legs reach 4.5 m out, top of the ascent stage at about 6 m (world.lander)
//   the flag      (6.5, -3.5), 2.3 m tall, flying east (world.flag)
//   the rover     (-11, -4), facing east (world.rover); the station (17, -15) (world.station)
//   the Earth     8.5 degrees up, a little west of north (world.earthDir), the Sun (world.sunDir)
//   the ground    world.heightAt(x, z) is the surface height; everything stands on it
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"]}) -> world. Per frame: set world.camera (position, fov,
// lookAt), then world.update(state), then world.render().
//
// state (every field optional):
//   time          seconds of the shot (drives the people's clocks and the Earth's slow turn)
//   people        {<id>: {x, z, heading, time, gait: {walk, run, ...any loaded clip}, show}} one entry per cast id.
//                 heading is radians about +y, 0 faces +z (south), PI/2 faces east (along the path). Idle takes
//                 whatever weight walk and run leave. Move x by world.gaitSpeed[id].walk * walk * dt so feet never
//                 slide (measured from the clip at load). Defaults: cast[0] at (-6, 3) facing east, the rest
//                 standing behind it. y is always the ground.
//   person        the same fields, for cast[0] (shorthand)
//   focus         {x, y, z} where the shadow box is centred (default cast[0])
//   shadowRadius  metres the hard shadows cover round the focus (default from the camera's distance, 18..320)
//
// Exposes: world.cast.<id> (loadFigure results), world.person (cast[0].object), world.gaitSpeed.<id> {walk, run},
// world.heightAt(x, z), world.path {z, x0, x1}, world.lander, world.flag, world.rover, world.station (Groups),
// world.spots {lander, flag, rover, station, start} (Vector3 on the ground), world.earth (Mesh), world.earthDir,
// world.sun (DirectionalLight), world.sunDir (unit vectors), world.scene, world.camera, world.renderer, world.render().
import { loadFigure } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"] }) {
  const V3 = THREE.Vector3, PI = Math.PI;
  const W = canvas.width || 1920, Hh = canvas.height || 1080;

  // ------------------------------------------------------------------ renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, Hh, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x23242a, 380, 4200);          // a fall-off into the distance, so depth reads
  const camera = new THREE.PerspectiveCamera(35, W / Hh, 0.25, 20000);
  camera.position.set(34, 8, 44); camera.lookAt(-2, 3, -6);

  // ------------------------------------------------------------------ the Sun and the Earth's directions
  const sunDir = new V3(0.92, 0.2, -0.33).normalize();
  const EARTH_EL = 8.5 * PI / 180, EARTH_AZ = Math.atan2(-0.94, -0.35);
  const earthDir = new V3(Math.cos(EARTH_AZ) * Math.cos(EARTH_EL), Math.sin(EARTH_EL), Math.sin(EARTH_AZ) * Math.cos(EARTH_EL)).normalize();

  // ------------------------------------------------------------------ loading
  const TL = new THREE.TextureLoader();
  const tex = (f) => new Promise((res, rej) => TL.load(K + f, res, undefined, rej));
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const [sand, rock, concrete, earthDay, earthClouds, earthSpec, earthNormal, figures] = await Promise.all([
    pbrSet("sand"), pbrSet("rock"), pbrSet("concrete"),
    tex("textures/earth_day.jpg"), tex("textures/earth_clouds.png"), tex("textures/earth_specular.jpg"), tex("textures/earth_normal.jpg"),
    Promise.all(cast.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] }))),
  ]);
  earthDay.colorSpace = THREE.SRGBColorSpace; earthDay.anisotropy = 8;

  // ------------------------------------------------------------------ noise
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vnoise = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vnoise(x * f + k * 17.3, y * f - k * 9.1); n += a; a *= 0.5; f *= 2.03; } return s / n; };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ layout
  const PZ = 3;                                                     // the walking path
  const SP = { lander: new V3(0, 0, -8), flag: new V3(6.5, 0, -3.5), rover: new V3(-11, 0, -4), station: new V3(17, 0, -15), start: new V3(-6, 0, PZ) };
  const zones = [[SP.lander, 11], [SP.flag, 2.5], [SP.rover, 4.5], [SP.station, 6]];
  const onPath = (x, z, pad) => Math.abs(x) < 150 && Math.abs(z - PZ) < pad;
  const clearOf = (x, z, r) => { for (const [p, zr] of zones) if (Math.hypot(x - p.x, z - p.z) < zr + r) return false; return !onPath(x, z, 2.6 + r); };

  // craters: {x, z, R, D depth, rim, fresh}, bucketed in a grid for the height field
  const craters = [], CELL = 32, grid = new Map();
  const addCrater = (x, z, R, age) => {
    const c = { x, z, R, D: R * (0.12 + 0.1 * age), rim: R * (0.02 + 0.03 * age), fresh: age, reach: R * 2.6 };
    craters.push(c);
    const i0 = Math.floor((x - c.reach) / CELL), i1 = Math.floor((x + c.reach) / CELL), j0 = Math.floor((z - c.reach) / CELL), j1 = Math.floor((z + c.reach) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 100003 + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
  };
  // a few placed so every camera has one: in the mid-ground behind the lander, beside the path, near the rover
  addCrater(-48, -52, 17, 0.8); addCrater(42, -46, 12, 1); addCrater(-26, 32, 8, 0.9); addCrater(70, 40, 26, 0.6);
  addCrater(-95, 18, 14, 0.5); addCrater(18, 30, 5.5, 1); addCrater(-150, -140, 60, 0.7); addCrater(210, -260, 95, 0.5);
  addCrater(-320, 120, 70, 0.4); addCrater(160, 200, 50, 0.6); addCrater(-30, -150, 30, 0.9); addCrater(90, -120, 22, 0.8);
  for (let n = 0; n < 16; n++) { const a = rnd() * 2 * PI, r = 380 + rnd() * 1000, R = 40 + rnd() * 160; addCrater(Math.cos(a) * r, Math.sin(a) * r, R, 0.3 + rnd() * 0.6); }
  for (let n = 0, tries = 0; n < 300 && tries < 5000; tries++) {
    const a = rnd() * 2 * PI, r = 12 + Math.pow(rnd(), 0.7) * 650, R = 2.5 + Math.pow(rnd(), 3) * 18, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clearOf(x, z, R * 1.5)) continue; addCrater(x, z, R, 0.3 + rnd() * 0.7); n++;
  }
  for (let n = 0, tries = 0; n < 2400 && tries < 20000; tries++) {
    const r = Math.pow(rnd(), 0.8) * 170, a = rnd() * 2 * PI, R = 0.3 + Math.pow(rnd(), 2.5) * 2.6, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clearOf(x, z, R * 1.4)) continue; addCrater(x, z, R, 0.4 + rnd() * 0.6); n++;
  }
  const craterAt = (c, x, z) => {
    const d = Math.hypot(x - c.x, z - c.z) / c.R;
    if (d >= 2.6) return 0;
    if (d < 1) return -c.D + (c.D + c.rim) * d * d;
    return c.rim * Math.exp(-(d - 1) * 3.2) * (1 - sstep(2.2, 2.6, d));
  };
  // the far highlands: a ring of hills rising beyond 700 m, lower towards the Earth so it clears them
  const highlands = (x, z, r) => {
    if (r < 600) return 0;
    const a = Math.atan2(z, x), dE = Math.cos(a - EARTH_AZ);
    const ridge = 0.55 + 0.45 * fbm(a * 3.1 + 5, 0.3, 3) - 0.25 * Math.max(0, dE);
    return sstep(600, 1700, r) * (70 + 190 * ridge * fbm(x / 420, z / 420, 4)) ;
  };
  const quiet = (x, z) => {                                        // 1 in the open, lower on the path and the pads
    let q = sstep(1.4, 4.5, Math.abs(z - PZ)) * (Math.abs(x) < 150 ? 1 : 0) + (Math.abs(x) < 150 ? 0 : 1);
    for (const [p, zr] of zones) q = Math.min(q, sstep(zr * 0.6, zr + 4, Math.hypot(x - p.x, z - p.z)));
    return 0.25 + 0.75 * Math.min(1, q);
  };
  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    let h = (fbm(x / 60, z / 60, 3) - 0.5) * 3.0 * Math.min(1, 0.3 + r / 150);   // gentle swell
    h += ((fbm(x / 7, z / 7, 3) - 0.5) * 0.55 + (vnoise(x / 1.6, z / 1.6) - 0.5) * 0.08) * quiet(x, z);
    const list = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (list) for (const c of list) h += craterAt(c, x, z);
    return h + highlands(x, z, r);
  }
  const normalAt = (x, z) => new V3(heightAt(x - 0.2, z) - heightAt(x + 0.2, z), 0.4, heightAt(x, z - 0.2) - heightAt(x, z + 0.2)).normalize();
  for (const k in SP) SP[k].y = heightAt(SP[k].x, SP[k].z);

  // ------------------------------------------------------------------ the environment: black sky, grey ground, the Sun
  {
    const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    const g = new THREE.SphereGeometry(100, 48, 24), col = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 100, v = y < 0 ? 0.32 * Math.min(1, -y * 3 + 0.4) : 0.006; col.push(v, v * 0.98, v * 0.95); }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const s = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.9).multiplyScalar(40) }));
    s.position.copy(sunDir).multiplyScalar(80); env.add(s);
    scene.environment = pm.fromScene(env, 0.02).texture; scene.environmentIntensity = 0.7;
    pm.dispose();
  }

  // ------------------------------------------------------------------ lights
  const sun = new THREE.DirectionalLight(0xfff3e6, 4.6);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 1600 });
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0x22283a, 0x8a8478, 0.55));            // regolith bounce from below, earthshine above
  const fill = new THREE.DirectionalLight(0xbfcbe0, 0.35); fill.position.set(-sunDir.x, 0.5, -sunDir.z); scene.add(fill);

  // ------------------------------------------------------------------ the ground
  const greyIt = (mat, tint, mix2 = true) => {                       // regolith grey, two scales against tiling
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTint = { value: tint };
      sh.fragmentShader = "uniform vec3 uTint;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
#ifdef USE_MAP
  vec4 s1 = texture2D(map, vMapUv);
  ${mix2 ? "vec4 s2 = texture2D(map, vMapUv * 0.173 + vec2(0.37, 0.71)); vec4 s3 = texture2D(map, vMapUv * 0.031 + vec2(0.13, 0.52));" : "vec4 s2 = s1; vec4 s3 = s1;"}
  vec3 L = vec3(0.299, 0.587, 0.114);
  float l = mix(dot(s1.rgb, L), dot(s2.rgb, L), 0.45) * (0.7 + 0.6 * dot(s3.rgb, L) / 0.35);
  diffuseColor.rgb *= vec3(l) * uTint;
#endif`);
    };
    mat.customProgramCacheKey = () => "grey" + (mix2 ? 2 : 1);
    return mat;
  };
  {
    const N = 760, HALF = 2000, A = 150, B = HALF - A;
    const s = (u) => A * u + B * Math.pow(u, 5);                     // dense near the middle, sparse at the horizon
    const xs = new Float32Array(N + 1); for (let i = 0; i <= N; i++) xs[i] = s(i / N * 2 - 1);
    const pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2), col = new Float32Array((N + 1) * (N + 1) * 3);
    let k = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
      const x = xs[i], z = xs[j], y = heightAt(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = x / 3.2; uv[k * 2 + 1] = -z / 3.2;
      // albedo: broad darker and lighter ground, bright ejecta round fresh craters, the blast-swept pad
      let a = 0.82 + 0.3 * (fbm(x / 140 + 3, z / 140, 3) - 0.5) + 0.12 * (fbm(x / 18, z / 18, 2) - 0.5);
      const list = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      if (list) for (const c of list) { const d = Math.hypot(x - c.x, z - c.z) / c.R; if (d < 2.6) a += c.fresh * 0.16 * (d < 1 ? 0.6 + 0.4 * d : Math.exp(-(d - 1) * 1.8)); }
      a += 0.08 * (1 - sstep(4, 10, Math.hypot(x - SP.lander.x, z - SP.lander.z)));
      a *= 1 - 0.1 * sstep(900, 2000, Math.hypot(x, z));
      col[k * 3] = a; col[k * 3 + 1] = a * 0.985; col[k * 3 + 2] = a * 0.965;
    }
    const idx = new Uint32Array(N * N * 6); k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.set([a, c, b, b, c, d], k); k += 6; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mat = greyIt(new THREE.MeshStandardMaterial({ ...sand, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3) }), new THREE.Color(1.18, 1.15, 1.1));
    const ground = new THREE.Mesh(g, mat); ground.receiveShadow = true; ground.castShadow = true; scene.add(ground);
  }

  // ------------------------------------------------------------------ rocks and boulders
  const rockMat = greyIt(new THREE.MeshStandardMaterial({ ...rock, roughness: 0.95, color: 0xffffff, normalScale: new THREE.Vector2(0.7, 0.7) }), new THREE.Color(0.78, 0.76, 0.74), false);
  const rockGeos = [];
  {
    const { mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
    for (let v = 0; v < 4; v++) {
      let g = new THREE.IcosahedronGeometry(1, 3); g.deleteAttribute("normal"); g.deleteAttribute("uv"); g = mergeVertices(g);
      const p = g.attributes.position, o = v * 11.7, sq = [0.62, 0.78, 0.55, 0.85][v], stretch = [1.15, 1, 1.25, 1.05][v];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        let r = 1 + 0.38 * (vnoise(x * 1.3 + o, z * 1.3 + y * 1.1) - 0.5) + 0.14 * (vnoise(x * 3.7 + o, y * 3.9 - z) - 0.5);
        for (let c = 0; c < 5; c++) {                                  // cut a few flat faces: rocks are broken, not melted
          const a = c * 2.4 + o, nx = Math.cos(a) * Math.sin(1 + c), ny = Math.cos(1 + c * 0.7), nz = Math.sin(a) * Math.sin(1 + c);
          const dd = x * nx + y * ny + z * nz; if (dd > 0.72) r *= 0.72 / dd;
        }
        p.setXYZ(i, x * r * stretch, y * r * sq, z * r);
      }
      g.computeVertexNormals(); g = g.toNonIndexed();
      const q = g.attributes.position, uv = new Float32Array(q.count * 2), e1 = new V3(), e2 = new V3(), fn = new V3();
      for (let t = 0; t < q.count; t += 3) {
        e1.set(q.getX(t + 1) - q.getX(t), q.getY(t + 1) - q.getY(t), q.getZ(t + 1) - q.getZ(t));
        e2.set(q.getX(t + 2) - q.getX(t), q.getY(t + 2) - q.getY(t), q.getZ(t + 2) - q.getZ(t)); fn.crossVectors(e1, e2);
        const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
        for (let k = t; k < t + 3; k++) { const X = q.getX(k), Y = q.getY(k), Z = q.getZ(k);
          const [u, w] = ay >= ax && ay >= az ? [X, Z] : ax >= az ? [Z, Y] : [X, Y]; uv[k * 2] = u * 0.45 + o; uv[k * 2 + 1] = w * 0.45; }
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); rockGeos.push(g);
    }
    const lists = rockGeos.map(() => []);
    const place = (x, z, s) => {
      const k = Math.floor(rnd() * 4), sq = [0.55, 0.7, 0.45, 0.8][k], m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 2 * PI, (rnd() - 0.5) * 0.4));
      m.compose(new V3(x, heightAt(x, z) + s * sq * 0.35 - s * 0.05, z), q, new V3(s, s * (0.8 + rnd() * 0.4), s));
      lists[k].push(m);
    };
    for (let n = 0, t = 0; n < 3200 && t < 20000; t++) {                  // pebbles and stones close by
      const r = Math.pow(rnd(), 1.4) * 130, a = rnd() * 2 * PI, x = Math.cos(a) * r, z = Math.sin(a) * r, s = 0.04 + Math.pow(rnd(), 3) * 0.32;
      if (!clearOf(x, z, -1.6) || Math.abs(z - PZ) < 0.9) continue; place(x, z, s); n++;
    }
    for (let n = 0, t = 0; n < 420 && t < 8000; t++) {                    // rocks across the plain
      const r = 10 + Math.pow(rnd(), 0.9) * 520, a = rnd() * 2 * PI, x = Math.cos(a) * r, z = Math.sin(a) * r, s = 0.35 + Math.pow(rnd(), 2.5) * 1.3;
      if (!clearOf(x, z, s)) continue; place(x, z, s); n++;
    }
    for (const c of craters) if (c.R > 6 && c.R < 70 && c.fresh > 0.55) {   // blocks thrown onto fresh rims
      for (let n = 0; n < 5; n++) { const a = rnd() * 2 * PI, d = c.R * (1.05 + rnd() * 0.5), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, s = 0.5 + rnd() * Math.min(3, c.R * 0.09); if (clearOf(x, z, s)) place(x, z, s); }
    }
    for (const [x, z, s] of [[-22, -16, 2.6], [28, -30, 3.4], [-40, 12, 1.9], [12, 14, 1.2], [-60, -30, 4.2], [55, 8, 2.2], [-8, 22, 1.5]]) place(x, z, s);   // boulders in view
    rockGeos.forEach((g, k) => {
      const im = new THREE.InstancedMesh(g, rockMat, lists[k].length); lists[k].forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false; scene.add(im);
    });
  }

  // ------------------------------------------------------------------ prints in the dust: boots and wheel tracks
  const decal = (draw, w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const bootTex = decal((g, w, h) => {
    g.save(); g.beginPath(); g.ellipse(w / 2, h * 0.3, w * 0.42, h * 0.27, 0, 0, 2 * PI); g.ellipse(w / 2, h * 0.76, w * 0.36, h * 0.2, 0, 0, 2 * PI); g.clip();
    for (let y = 0; y < h; y += 8) { g.fillStyle = "rgba(30,29,28,0.9)"; g.fillRect(0, y, w, 4); g.fillStyle = "rgba(62,60,58,0.7)"; g.fillRect(0, y + 4, w, 4); }
    g.restore();
  }, 64, 160);
  const tyreTex = decal((g, w, h) => {
    for (let y = 0; y < h; y += 16) { g.fillStyle = "rgba(45,43,40,0.6)"; g.beginPath(); g.moveTo(2, y); g.lineTo(w / 2, y + 7); g.lineTo(w - 2, y); g.lineTo(w - 2, y + 6); g.lineTo(w / 2, y + 13); g.lineTo(2, y + 6); g.fill(); }
    g.fillStyle = "rgba(60,58,55,0.35)"; g.fillRect(0, 0, w, h);
  }, 64, 128);
  const decals = (texture, list, w, l) => {
    const geo = new THREE.PlaneGeometry(w, l); geo.rotateX(-PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const im = new THREE.InstancedMesh(geo, mat, list.length), up = new V3(0, 1, 0), m = new THREE.Matrix4();
    list.forEach(([x, z, yaw], i) => {
      const q = new THREE.Quaternion().setFromUnitVectors(up, normalAt(x, z)).multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
      im.setMatrixAt(i, m.compose(new V3(x, heightAt(x, z) + 0.012, z), q, new V3(1, 1, 1)));
    });
    im.receiveShadow = true; im.frustumCulled = false; im.renderOrder = 1; scene.add(im);
  };
  {
    const prints = [];
    const trail = (pts, n0 = 0) => {                                   // a walker along a polyline, alternating feet
      for (let s = 0; s + 1 < pts.length; s++) {
        const [ax, az] = pts[s], [bx, bz] = pts[s + 1], L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
        for (let d = 0; d < L; d += 0.72) { const side = (Math.floor(d / 0.72) + n0) % 2 ? 1 : -1, x = ax + (bx - ax) * d / L + Math.cos(yaw) * side * 0.14, z = az + (bz - az) * d / L - Math.sin(yaw) * side * 0.14; prints.push([x + (rnd() - 0.5) * 0.06, z + (rnd() - 0.5) * 0.06, yaw + (rnd() - 0.5) * 0.25]); }
      }
    };
    trail([[-120, PZ + 0.35], [-60, PZ + 0.45], [0, PZ + 0.3], [60, PZ + 0.5], [120, PZ + 0.4]]);
    trail([[120, PZ - 0.4], [40, PZ - 0.55], [-20, PZ - 0.45], [-120, PZ - 0.5]], 1);
    trail([[0, PZ - 0.4], [1.2, -1.5], [1.2, -3.9]]);                  // to the ladder
    trail([[1.5, -3.6], [5, -3.2], [6.1, -3.1], [7.6, -2.6], [9, PZ - 0.5]], 1);
    trail([[-1, -3.8], [-6, -3.0], [-9.5, -2.6]]);                      // to the rover
    trail([[8, -4], [12, -9], [15.5, -13.5], [17.5, -12], [14, -8.5]]); // to the station and back
    decals(bootTex, prints, 0.13, 0.32);
    const tracks = [], path = new THREE.CatmullRomCurve3([new V3(-12.4, 0, -4), new V3(-20, 0, -4.5), new V3(-30, 0, -9), new V3(-42, 0, -20), new V3(-55, 0, -38), new V3(-62, 0, -60), new V3(-60, 0, -90)]);
    const Lp = path.getLength();
    for (let d = 0; d < Lp; d += 0.24) {
      const p = path.getPointAt(d / Lp), t = path.getTangentAt(d / Lp), yaw = Math.atan2(t.x, t.z);
      for (const side of [-1, 1]) { const x = p.x + t.z * side * 0.92, z = p.z - t.x * side * 0.92; if (clearOf(x, z, -3) || Math.hypot(x - SP.rover.x, z - SP.rover.z) < 4) tracks.push([x, z, yaw]); }
    }
    decals(tyreTex, tracks, 0.24, 0.26);
  }

  // ------------------------------------------------------------------ materials for the hardware
  const crinkle = concrete.normalMap.clone(); crinkle.repeat.set(2, 2); crinkle.needsUpdate = true;
  const M = {
    gold: new THREE.MeshStandardMaterial({ color: 0xd8a83c, metalness: 0.95, roughness: 0.3, normalMap: crinkle, normalScale: new THREE.Vector2(1.6, 1.6) }),
    foil: new THREE.MeshStandardMaterial({ color: 0xc9c6bd, metalness: 0.9, roughness: 0.35, normalMap: crinkle, normalScale: new THREE.Vector2(1.2, 1.2) }),
    panel: new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.55, roughness: 0.45 }),
    darkPanel: new THREE.MeshStandardMaterial({ color: 0x232426, metalness: 0.3, roughness: 0.6 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0e0f, metalness: 0.2, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.9, roughness: 0.08 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc8c8c4, metalness: 0.85, roughness: 0.3 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e6e0, metalness: 0.1, roughness: 0.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x77736a, metalness: 0.7, roughness: 0.55 }),
    fender: new THREE.MeshStandardMaterial({ color: 0x9c927f, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
    seat: new THREE.MeshStandardMaterial({ color: 0x5b6b78, roughness: 0.85 }),
  };
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const rod = (a, b, r, mat, parent) => {                              // a cylinder from point a to point b
    const d = new V3().subVectors(b, a), m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat, parent);
    m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); return m;
  };

  // ------------------------------------------------------------------ the landing module
  const lander = new THREE.Group(); lander.position.copy(SP.lander); scene.add(lander);
  {
    const desc = mesh(new THREE.CylinderGeometry(2.15, 2.15, 1.6, 8), M.gold, lander, 0, 2.3, 0); desc.rotation.y = PI / 8;
    mesh(new THREE.CylinderGeometry(2.12, 1.9, 0.12, 8), M.black, lander, 0, 1.46, 0).rotation.y = PI / 8;
    const bell = mesh(new THREE.CylinderGeometry(0.36, 0.78, 0.95, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a3836, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }), lander, 0, 1.0, 0);
    for (let k = 0; k < 8; k++) { const a = k * PI / 4; mesh(new THREE.BoxGeometry(1.2, 1.5, 0.04), k % 2 ? M.foil : M.gold, lander, Math.sin(a) * 2.0, 2.3, Math.cos(a) * 2.0).rotation.y = a; }
    for (let k = 0; k < 4; k++) {                                      // four legs, the +z one with the ladder
      const a = k * PI / 2, ux = Math.sin(a), uz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
      const fx = SP.lander.x + ux * 4.5, fz = SP.lander.z + uz * 4.5, fy = heightAt(fx, fz) - SP.lander.y + 0.08;
      const top = new V3(ux * 2.05, 2.95, uz * 2.05), foot = new V3(ux * 4.5, fy + 0.16, uz * 4.5);
      rod(top, foot, 0.075, M.foil, lander);
      mesh(new THREE.CylinderGeometry(0.46, 0.36, 0.16, 20), M.foil, lander, foot.x, fy + 0.02, foot.z);
      const mid = top.clone().lerp(foot, 0.62);
      for (const s of [-1, 1]) rod(new V3(ux * 1.95 + tx * s * 1.0, 1.55, uz * 1.95 + tz * s * 1.0), mid, 0.045, M.alu, lander);
      rod(new V3(ux * 1.95, 1.5, uz * 1.95), mid, 0.05, M.alu, lander);
      rod(foot.clone().add(new V3(0, 0.05, 0)), foot.clone().add(new V3(ux * 0.35, 1.4, uz * 0.35)), 0.012, M.alu, lander);   // contact probe
      if (k === 0) {
        for (const s of [-1, 1]) rod(new V3(ux * 2.25 + tx * s * 0.28, 2.95, uz * 2.25 + tz * s * 0.28), new V3(ux * 4.1 + tx * s * 0.28, fy + 0.7, uz * 4.1 + tz * s * 0.28), 0.025, M.alu, lander);
        for (let r = 0.12; r < 0.95; r += 0.1) { const p = new V3(ux * 2.25, 2.95, uz * 2.25).lerp(new V3(ux * 4.1, fy + 0.7, uz * 4.1), r); rod(p.clone().add(new V3(tx * -0.28, 0, tz * -0.28)), p.clone().add(new V3(tx * 0.28, 0, tz * 0.28)), 0.018, M.alu, lander); }
        mesh(new THREE.BoxGeometry(0.9, 0.05, 0.7), M.alu, lander, 0, 3.08, 2.3);   // the porch
      }
    }
    // the ascent stage: a faceted cabin facing +z, windows, hatch, a tunnel on top, dishes, thruster quads
    const asc = new THREE.Group(); asc.position.y = 3.1; lander.add(asc);
    mesh(new THREE.BoxGeometry(2.7, 0.18, 2.6), M.black, asc, 0, 0.09, 0);
    const cab = mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.5, 8), M.panel, asc, 0, 1.3, 0.1); cab.rotation.z = PI / 2; cab.rotation.x = PI / 8;
    mesh(new THREE.BoxGeometry(2.3, 1.7, 1.1), M.panel, asc, 0, 1.05, 1.0);
    const face = mesh(new THREE.BoxGeometry(1.7, 1.2, 0.3), M.panel, asc, 0, 1.55, 1.45); face.rotation.x = -0.35;
    for (const s of [-1, 1]) {
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.55 * s, 0), new THREE.Vector2(0.08 * s, 0.5)]);
      const w = mesh(new THREE.ShapeGeometry(tri), M.glass, face, 0.12 * s, -0.15, 0.16); if (s < 0) w.material = M.glass;
      w.geometry.computeVertexNormals(); w.material.side = THREE.DoubleSide;
    }
    mesh(new THREE.BoxGeometry(0.8, 0.8, 0.06), M.darkPanel, asc, 0, 0.75, 1.56);
    mesh(new THREE.BoxGeometry(0.6, 0.6, 0.07), M.panel, asc, 0, 0.75, 1.575);
    mesh(new THREE.BoxGeometry(2.1, 1.3, 1.3), M.darkPanel, asc, 0, 1.05, -1.25);
    mesh(new THREE.BoxGeometry(1.6, 1.1, 0.05), M.gold, asc, 0, 1.05, -1.92);
    mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.5, 20), M.panel, asc, 0, 2.55, 0.05);
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 20), M.alu, asc, 0, 2.82, 0.05);
    const dish = (r, x, y, z, parent) => {
      const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
      const d = mesh(new THREE.SphereGeometry(r, 24, 8, 0, 2 * PI, 0, 0.6), M.white, g, 0, 0, 0); d.material = M.white; d.geometry.translate(0, -r, 0); d.rotation.x = PI;
      rod(new V3(0, 0, 0), new V3(0, -0.35, 0), 0.02, M.alu, g); return g;
    };
    const sband = dish(0.42, -1.05, 2.7, -0.7, asc); sband.lookAt(sband.getWorldPosition(new V3()).add(earthDir)); sband.rotateX(-PI / 2);
    rod(new V3(-0.9, 2.0, -0.6), new V3(-1.05, 2.55, -0.7), 0.03, M.alu, asc);
    const rr = dish(0.3, 1.0, 2.35, 0.95, asc); rr.rotation.x = 0.6;
    for (const [x, z] of [[-1.45, 1.0], [1.45, 1.0], [-1.45, -1.0], [1.45, -1.0]]) {
      mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), M.darkPanel, asc, x, 1.75, z);
      for (const [dx, dy, dz] of [[0, 0.2, 0], [0, -0.2, 0], [Math.sign(x) * 0.2, 0, 0], [0, 0, Math.sign(z) * 0.2]]) {
        const c = mesh(new THREE.ConeGeometry(0.06, 0.18, 10, 1, true), M.alu, asc, x + dx, 1.75 + dy, z + dz);
        c.quaternion.setFromUnitVectors(new V3(0, -1, 0), new V3(dx, dy, dz).normalize());
      }
    }
    for (const s of [-1, 1]) rod(new V3(s * 0.7, 2.3, -0.8), new V3(s * 0.95, 3.2, -1.0), 0.012, M.alu, asc);     // VHF whips
  }

  // ------------------------------------------------------------------ the flag
  const flag = new THREE.Group(); flag.position.copy(SP.flag); scene.add(flag);
  {
    rod(new V3(0, -0.3, 0), new V3(0, 2.35, 0), 0.02, M.alu, flag);
    rod(new V3(0, 2.25, 0), new V3(1.25, 2.25, 0), 0.012, M.alu, flag);
    const ft = decal((g, w, h) => {
      for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? "#f2f0ea" : "#b22234"; g.fillRect(0, i * h / 13, w, h / 13 + 1); }
      g.fillStyle = "#3c3b6e"; g.fillRect(0, 0, w * 0.4, h * 7 / 13); g.fillStyle = "#f2f0ea";
      for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) { g.beginPath(); g.arc((c + (r % 2 ? 1 : 0.5)) * w * 0.4 / 6, (r + 0.6) * h * 7 / 13 / 9.2, 3.2, 0, 2 * PI); g.fill(); }
    }, 512, 320);
    const geo = new THREE.PlaneGeometry(1.2, 0.76, 40, 12), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + 0.6) / 1.2, v = (0.38 - p.getY(i)) / 0.76; p.setZ(i, 0.05 * Math.sin(u * 9.5 + 0.6) * u + 0.03 * v * u * Math.sin(u * 5)); }
    geo.computeVertexNormals();
    const cloth = mesh(geo, new THREE.MeshStandardMaterial({ map: ft, roughness: 0.75, side: THREE.DoubleSide }), flag, 0.62, 2.25 - 0.38, 0);
    cloth.rotation.y = 0.25;
  }

  // ------------------------------------------------------------------ the rover (parked, facing east)
  const rover = new THREE.Group(); rover.position.copy(SP.rover); scene.add(rover);
  {
    mesh(new THREE.BoxGeometry(2.9, 0.12, 1.15), M.alu, rover, 0, 0.62, 0);
    mesh(new THREE.BoxGeometry(2.4, 0.08, 1.3), M.darkPanel, rover, -0.1, 0.7, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * 1.15, z = sz * 0.92;
      const wy = heightAt(SP.rover.x + x, SP.rover.z + z) - SP.rover.y + 0.41;
      const t = mesh(new THREE.TorusGeometry(0.36, 0.07, 10, 28), M.tyre, rover, x, wy, z);
      const hub = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a857a, metalness: 0.6, roughness: 0.5, wireframe: false, side: THREE.DoubleSide }), rover, x, wy, z); hub.rotation.x = PI / 2;
      mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 12), M.darkPanel, rover, x, wy, z).rotation.x = PI / 2;
      const fen = mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 20, 1, true, -PI * 0.3, PI * 0.6), M.fender, rover, x, wy, z); fen.rotation.x = PI / 2; fen.rotation.y = PI / 2;
      rod(new V3(x * 0.7, 0.62, z * 0.75), new V3(x, wy, z * 0.95), 0.03, M.alu, rover);
    }
    for (const sz of [-0.32, 0.32]) {
      mesh(new THREE.BoxGeometry(0.5, 0.06, 0.48), M.seat, rover, -0.15, 0.85, sz);
      const b = mesh(new THREE.BoxGeometry(0.06, 0.5, 0.48), M.seat, rover, -0.42, 1.08, sz); b.rotation.z = 0.15;
    }
    const con = mesh(new THREE.BoxGeometry(0.2, 0.36, 0.42), M.darkPanel, rover, 0.55, 1.0, 0); con.rotation.z = -0.4;
    rod(new V3(0.55, 0.7, 0), new V3(0.55, 0.9, 0), 0.03, M.alu, rover);
    mesh(new THREE.BoxGeometry(0.6, 0.45, 1.0), M.foil, rover, -1.3, 0.95, 0);
    rod(new V3(1.1, 0.7, 0.45), new V3(1.1, 1.9, 0.45), 0.02, M.alu, rover);
    const hg = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.16, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xd6d2c8, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }));
    hg.castShadow = true; hg.position.set(1.1, 1.95, 0.45); rover.add(hg); hg.lookAt(hg.getWorldPosition(new V3()).sub(earthDir)); hg.rotateX(PI / 2);
    rod(new V3(1.2, 0.7, -0.45), new V3(1.2, 1.35, -0.45), 0.02, M.alu, rover);
    mesh(new THREE.BoxGeometry(0.22, 0.16, 0.14), M.white, rover, 1.2, 1.42, -0.45);
    rod(new V3(1.25, 0.7, 0.1), new V3(1.25, 1.55, 0.1), 0.04, M.white, rover);
  }

  // ------------------------------------------------------------------ the science station
  const station = new THREE.Group(); station.position.copy(SP.station); scene.add(station);
  {
    const at = (x, z) => heightAt(SP.station.x + x, SP.station.z + z) - SP.station.y;
    mesh(new THREE.BoxGeometry(0.6, 0.3, 0.5), M.gold, station, 0, at(0, 0) + 0.15, 0);
    for (const [x, z] of [[-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) rod(new V3(x, at(0, 0) + 0.3, z), new V3(x, at(0, 0) + 0.62, z), 0.012, M.alu, station);
    mesh(new THREE.BoxGeometry(0.85, 0.02, 0.7), M.foil, station, 0, at(0, 0) + 0.63, 0);
    rod(new V3(0.2, at(0, 0) + 0.3, 0), new V3(0.2, at(0, 0) + 1.2, 0), 0.015, M.alu, station);
    const hd = mesh(new THREE.ConeGeometry(0.1, 0.5, 4, 1, true), M.alu, station, 0.2, at(0, 0) + 1.25, 0); hd.rotation.z = 0.6;
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 12), M.darkPanel, station, 3, at(3, 1) + 0.4, 1);
    for (let k = 0; k < 8; k++) { const f = mesh(new THREE.BoxGeometry(0.02, 0.45, 0.16), M.darkPanel, station, 3 + Math.cos(k * PI / 4) * 0.25, at(3, 1) + 0.4, 1 + Math.sin(k * PI / 4) * 0.25); f.rotation.y = -k * PI / 4; }
    rod(new V3(3, at(3, 1) + 0.16, 1), new V3(3, at(3, 1), 1), 0.12, M.alu, station);
    mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.02, 32), M.foil, station, -3, at(-3, 2) + 0.01, 2);
    mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.4, 16), M.gold, station, -3, at(-3, 2) + 0.2, 2);
    const rrt = decal((g, w, h) => { g.fillStyle = "#8b8f93"; g.fillRect(0, 0, w, h); for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { g.fillStyle = "#14171b"; g.beginPath(); g.arc((x + 0.5) * w / 10, (y + 0.5) * h / 10, w / 24, 0, 2 * PI); g.fill(); } }, 256, 256);
    const lr = mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), [M.alu, M.alu, new THREE.MeshStandardMaterial({ map: rrt, metalness: 0.6, roughness: 0.25 }), M.alu, M.alu, M.alu], station, 1.5, at(1.5, 3) + 0.38, 3); lr.rotation.x = 0.45;
    rod(new V3(1.5, at(1.5, 3), 3), new V3(1.5, at(1.5, 3) + 0.35, 3), 0.02, M.alu, station);
    for (const [x, z] of [[3, 1], [-3, 2], [1.5, 3]]) {
      const pts = []; for (let s = 0; s <= 12; s++) { const u = s / 12, px = x * u + Math.sin(u * PI * 2) * 0.2, pz = z * u + Math.sin(u * PI * 3) * 0.15; pts.push(new V3(px, at(px, pz) + 0.02, pz)); }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6), M.white, station);
    }
  }

  // ------------------------------------------------------------------ the sky: stars, the Sun's glare, the Earth
  {
    const layers = [[5200, 1.4, 0.55], [1400, 2.2, 0.85], [260, 3.2, 1.0]];
    for (const [n, size, bright] of layers) {
      const p = [], c = [];
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1, a = rnd() * 2 * PI, s = Math.sqrt(1 - u * u), v = new V3(s * Math.cos(a), u * 0.9 + 0.08, s * Math.sin(a)).normalize();
        if (v.y < -0.05) continue;
        p.push(v.x * 9000, v.y * 9000, v.z * 9000);
        const b = bright * (0.35 + 0.65 * rnd()), t = rnd(); c.push(b * (t < 0.2 ? 0.85 : 1), b * 0.95, b * (t > 0.8 ? 0.8 : 1.05));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, toneMapped: false }));
      pts.renderOrder = -2; pts.frustumCulled = false; scene.add(pts);
    }
    const glow = decal((g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.06, "rgba(255,252,240,1)"); r.addColorStop(0.1, "rgba(255,240,215,0.35)"); r.addColorStop(0.35, "rgba(255,230,200,0.08)"); r.addColorStop(1, "rgba(255,230,200,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); }, 256, 256);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.5, 2.5, 2.5) }));
    sp.position.copy(sunDir).multiplyScalar(9000); sp.scale.setScalar(1400); sp.renderOrder = -1; scene.add(sp);
  }
  const EARTH_D = 6000, EARTH_R = EARTH_D * Math.tan(1.6 * PI / 180);
  earthClouds.colorSpace = THREE.NoColorSpace; earthSpec.colorSpace = THREE.NoColorSpace;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 96, 64), new THREE.ShaderMaterial({   // lit by the Sun only: a true half Earth
    uniforms: { uDay: { value: earthDay }, uCloud: { value: earthClouds }, uSpec: { value: earthSpec }, uSun: { value: sunDir }, uTurn: { value: 0 } }, fog: false,
    vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `uniform sampler2D uDay; uniform sampler2D uCloud; uniform sampler2D uSpec; uniform vec3 uSun; uniform float uTurn; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 n = normalize(vN); float l = dot(n, uSun);
        vec3 day = texture2D(uDay, vUv).rgb; float c = texture2D(uCloud, vUv + vec2(uTurn, 0.0)).r * 0.7; float sea = texture2D(uSpec, vUv).r;
        float lit = smoothstep(-0.06, 0.2, l) * (0.35 + 0.65 * max(l, 0.0));
        vec3 col = mix(day * vec3(0.85, 0.95, 1.12), vec3(0.95), c) * lit * 1.5;
        vec3 h = normalize(uSun + normalize(vV)); col += sea * (1.0 - c) * pow(max(dot(n, h), 0.0), 40.0) * 0.6 * step(0.0, l);
        col += vec3(0.004, 0.006, 0.01);
        gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); }`,
  }));
  earth.position.copy(earthDir).multiplyScalar(EARTH_D); earth.rotation.set(0.41, 2.2, 0); scene.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.06, 64, 48), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
    vertexShader: "varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vW = normalize((modelMatrix*vec4(position,0.0)).xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "uniform vec3 uSun; varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 1.2); float rim = smoothstep(0.0, 0.35, abs(dot(vN, vV))); float lit = smoothstep(-0.25, 0.5, dot(vW, uSun)); float a = (1.0 - rim) * 0.0 + rim * f * lit; gl_FragColor = vec4(vec3(0.3, 0.55, 1.0) * a * 1.6, a); }",
  }));
  atmo.position.copy(earth.position); scene.add(atmo);

  // ------------------------------------------------------------------ the people
  const castMap = {}, gaitSpeed = {}, defaults = {};
  const footOf = (o) => { let f = null; o.traverse((b) => { if (!f && b.isBone && /(left.?foot|foot.?l)$/i.test(b.name)) f = b; }); return f; };
  const measure = (fig, clip) => {                                     // ground speed of a gait: how fast the planted foot slides back
    const foot = footOf(fig.object); if (!foot || !fig.durations[clip]) return null;
    const T = fig.durations[clip], n = 90, ys = [], zs = [], v = new V3();
    fig.object.position.set(0, 0, 0); fig.object.rotation.set(0, 0, 0);
    for (let i = 0; i <= n; i++) { fig.pose(T * i / n, { [clip]: 1 }); fig.object.updateMatrixWorld(true); foot.getWorldPosition(v); ys.push(v.y); zs.push(v.z); }
    const lo = Math.min(...ys), sp = [];
    for (let i = 0; i < n; i++) if (ys[i] < lo + 0.03 && ys[i + 1] < lo + 0.03) sp.push(-(zs[i + 1] - zs[i]) / (T / n));
    fig.pose(0);
    if (sp.length < 3) return null; sp.sort((a, b) => a - b); const s = sp[sp.length >> 1]; return s > 0.2 && s < 9 ? s : null;
  };
  figures.forEach((f, i) => {
    castMap[f.id] = f; scene.add(f.object);
    gaitSpeed[f.id] = { walk: measure(f, "walk") || 1.3, run: measure(f, "run") || 3.4 };
    defaults[f.id] = { x: SP.start.x - i * 1.6, z: PZ + (i % 2 ? -0.6 : 0.6) * (i ? 1 : 0), heading: PI / 2 };
  });

  // ------------------------------------------------------------------ update and render
  const focus = new V3();
  let lastR = 0;
  function update(state = {}) {
    const time = state.time || 0;
    const people = { ...(state.people || {}) };
    if (state.person && figures[0]) people[figures[0].id] = { ...state.person, ...(people[figures[0].id] || {}) };
    for (const f of figures) {
      const p = people[f.id] || {}, d = defaults[f.id];
      const x = p.x ?? d.x, z = p.z ?? d.z;
      f.object.visible = p.show !== false;
      f.object.position.set(x, heightAt(x, z), z); f.object.rotation.y = p.heading ?? d.heading;
      const g = { ...(p.gait || {}) }; let sum = 0; for (const k in g) if (k !== "idle") sum += g[k];
      if (g.idle === undefined) g.idle = Math.max(0, 1 - sum);
      f.pose(p.time ?? time, g);
    }
    earth.rotation.y = 2.2 + time * 0.004; earth.material.uniforms.uTurn.value = time * 0.0002;
    if (state.focus) focus.set(state.focus.x, state.focus.y ?? heightAt(state.focus.x, state.focus.z), state.focus.z);
    else if (figures[0]) focus.copy(figures[0].object.position); else focus.copy(SP.lander);
    const R = state.shadowRadius || Math.min(320, Math.max(18, camera.position.distanceTo(focus) * 0.9));
    if (Math.abs(R - lastR) > 0.01) { Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R }); sun.shadow.camera.updateProjectionMatrix(); lastR = R; }
    const tex = (2 * R) / 4096; focus.x = Math.round(focus.x / tex) * tex; focus.z = Math.round(focus.z / tex) * tex;   // no shimmer as it follows
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 700);
  }
  const render = () => renderer.render(scene, camera);
  update({});

  return {
    renderer, scene, camera, update, render, heightAt, sun, sunDir, earth, earthDir, lander, flag, rover, station,
    cast: castMap, person: figures[0] ? figures[0].object : null, gaitSpeed, spots: SP,
    path: { z: PZ, x0: -120, x1: 120 },
  };
}
