// World "mountain": a high mountain trail above the tree line on a clear day.
//
// Axes (metres): +y up. A narrow rocky ridge runs along z; a hiking trail follows its crest, wandering a few metres
// left and right (world.trailX(z)). Walking the trail towards -z climbs gently to a summit knoll with a stone cairn.
//   trail      about 1.4 m of packed gravel; the ground is flat across it for 1.7 m each side of its centre line.
//              The trail's own coordinate is s, metres along it: s = 0 at z = 0, s grows towards the summit (-z).
//              world.trailAt(s) -> {x, y, z, heading} (heading faces up the trail, towards the summit).
//              Trail elevation y = 0 at s = 0, about +1 at the sign, +17 on the summit (s = world.SUMMIT_S, ~240).
//   along it   wooden marker stakes with red-and-white tops every 40 m, alternating sides 1.3 m out; a wooden
//              signpost (two arrow boards: SUMMIT / VALLEY) 1.9 m right of the trail at s = 20 (world.sign);
//              the cairn 2.6 m left of the trail on the summit (world.cairn). Alpine grass and stones line the edges.
//   flanks     the ridge falls away on both sides, steepening into rocky spurs and gullies, past boulders and
//              lingering snow patches, to valley floors about 1150 m below (y ~ -1150) at |x| ~ 2000 to 3000,
//              with dark conifer forest down there and layers of haze from y = -900 to -560.
//   far        snow-capped peaks 2.5 to 13 km out on every side, rising to y ~ +1700; the ridge itself climbs into the
//              biggest one beyond the summit, about 3.8 km out towards -z. Terrain runs to 16 km in every direction.
// The action is meant to happen on the trail between s = -150 and s = 260 (dense ground, grass, stones, props);
// a camera can stand anywhere within ~80 m of the trail at any height, or fly high over the ridge.
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"]}) -> world. Per frame: set world.camera (position,
// fov, lookAt), then world.update(state), then world.render().
//
// state (every field optional):
//   time         seconds of the shot (drives the figures' animation clock by default)
//   people       {<id>: {s, offset, back, x, z, heading, time, gait: {walk, run}, show}} for ids in cast.
//                Either s (metres along the trail; offset = metres to the right of the walking direction, default 0;
//                back: true walks down, towards the valley end) or x, z, heading (radians about +y, 0 faces +z,
//                PI faces -z). Feet are put on the ground at world.height(x, z). gait weights 0..1, idle gets the
//                rest. Move a walker by world.gaitSpeed[id].walk * walk (+ .run * run) metres a second so the feet
//                never slide. When `people` is given, a cast member not in it is hidden. Without it, the first
//                cast member stands idle on the trail at s = 0 facing the summit.
//   focus        {x, y, z} the shadow box centre (default the first visible person, else the trail at s = 0)
//   shadowRadius metres of the shadow box round the focus (default from the camera's distance)
//
// Exposes: world.cast.<id> (loadFigure results), world.person (first cast member's object), world.gaitSpeed.<id>
// {walk, run} m/s, world.sun (DirectionalLight), world.sunDir, world.height(x, z) (ground height there),
// world.trailX(z), world.trailAt(s), world.SUMMIT_S, world.summit (Vector3, the trail's high point),
// world.cairn (Vector3, its base), world.sign (Vector3, the signpost's base), world.peaks (array of {x, z, y} summits).
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadFigure, loadProp } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"] }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const V3 = THREE.Vector3, PI = Math.PI;

  // ---------------------------------------------------------------- renderer, camera
  const W = canvas.width || 1920, H = canvas.height || 1080;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.2, 40000);
  camera.position.set(-30, 12, 40); camera.lookAt(0, 2, -40);

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
  const [sky, ROCK, SAND, CONC, boulderA, boulderB, rockSet, grassProp, figures] = await Promise.all([
    hdrL.loadAsync(K + "sky/day.hdr"), pbrSet("rock"), pbrSet("sand"), pbrSet("concrete"),
    loadProp({ THREE, id: "boulder_01" }), loadProp({ THREE, id: "namaqualand_boulder_03" }),
    loadProp({ THREE, id: "rock_moss_set_01" }), loadProp({ THREE, id: "grass_medium_01" }),
    Promise.all(cast.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] }))),
  ]);

  // ---------------------------------------------------------------- deterministic random and noise
  let seed = 7319;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const hash = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
  const sm = (t) => t * t * (3 - 2 * t);
  const noise = (x, z) => { const i = Math.floor(x), j = Math.floor(z), fx = sm(x - i), fz = sm(z - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz; };
  const fbm = (x, z, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * noise(x * f + k * 17.3, z * f - k * 9.1); n += a; a *= 0.5; f *= 2.03; } return s / n; };
  const ridged = (x, z, o = 5) => { let s = 0, a = 0.5, f = 1, n = 0, w = 1; for (let k = 0; k < o; k++) { let v = 1 - Math.abs(noise(x * f + k * 31.7, z * f + k * 12.9) * 2 - 1); v *= v; v *= w; w = Math.min(1, v * 1.6); s += a * v; n += a; a *= 0.5; f *= 2.1; } return s / n; };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const step = (a, b, v) => sm(clamp01((v - a) / (b - a)));
  const smax = (a, b, k) => { const h = clamp01(0.5 + 0.5 * (b - a) / k); return a + (b - a) * h + k * h * (1 - h); };

  // ---------------------------------------------------------------- the land's shape
  const FLAT = 1.7, VALLEY = -1150;
  const trailX = (z) => 5.5 * Math.sin(z * 0.019) + 2.2 * Math.sin(z * 0.051 + 1.3);
  const crest = (z) => 14 * Math.tanh(-z / 260);
  const SUMMIT_Z = -236;
  const knoll = (d, z) => 7 * Math.exp(-(d * d) / (2 * 18 * 18) - ((z - SUMMIT_Z) ** 2) / (2 * 26 * 26));
  // peaks: {x, z, h above the valley floor, R}
  const peaks = [
    { x: 300, z: -3800, h: 2500, R: 2500 }, { x: 3800, z: -900, h: 2300, R: 2300 }, { x: 4400, z: 1900, h: 2050, R: 2100 },
    { x: 6200, z: -3600, h: 2750, R: 2700 }, { x: -3700, z: -1700, h: 2450, R: 2300 }, { x: -4300, z: 1300, h: 2150, R: 2200 },
    { x: -7200, z: -5200, h: 2850, R: 3000 }, { x: -900, z: 4900, h: 2350, R: 2400 }, { x: 2600, z: 6200, h: 2650, R: 2700 },
    { x: -3200, z: -6400, h: 2600, R: 2600 }, { x: 3300, z: -7400, h: 2900, R: 3000 },
  ];
  for (let i = 0; i < 26; i++) { const a = rr(0, 2 * PI), r = rr(7000, 13000); peaks.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: rr(1800, 3000), R: rr(2200, 3400) }); }
  peaks.forEach((p, i) => { p.s = i * 7.31; });
  function base(x, z) {
    const d = x - trailX(z), u = Math.max(0, Math.abs(d) - FLAT), side = d > 0 ? 1 : 0.84;
    let h = crest(z) + knoll(d, z);
    h -= (VALLEY * -1) * (1 - Math.exp(-Math.pow(u / 520, 1.3))) * side;      // a sharp crest, steepening flanks
    const k = step(0, 22, u);
    h += (fbm(x * 0.03, z * 0.03, 4) - 0.5) * (1.4 + u * 0.05) * k;          // rocky crest and slopes
    h += (fbm(x * 0.13, z * 0.13, 2) - 0.5) * 0.55 * k;
    h += (ridged(x * 0.011 + 3, z * 0.011 - 7, 4) - 0.35) * (3 + u * 0.06) * step(6, 40, u);  // crags and ribs of rock
    h += (ridged(x * 0.0016, z * 0.0016) - 0.42) * 560 * step(70, 1300, u);   // spurs and gullies on the flanks
    return h;
  }
  function height(x, z) {
    let h = base(x, z);
    for (const p of peaks) {
      const dx = x - p.x, dz = z - p.z; if (Math.abs(dx) > p.R || Math.abs(dz) > p.R) continue;
      const r = Math.hypot(dx, dz) * (0.82 + 0.36 * fbm(x * 0.0006 + p.s, z * 0.0006 - p.s, 3)); if (r >= p.R) continue;
      const t = 1 - r / p.R, rg = ridged(x * 0.0011 + p.s, z * 0.0011 - p.s, 6);
      const c = VALLEY + p.h * (0.7 * Math.pow(t, 1.7) + 0.42 * t * rg * rg + 0.06 * t * (fbm(x * 0.006, z * 0.006, 3) - 0.5));
      h = smax(h, c, 140);
    }
    return h;
  }

  // ---------------------------------------------------------------- the trail's own coordinate
  const TZ = [], TS = [];
  {
    let s = 0, px = trailX(900), py = height(px, 900), pz = 900; const raw = [];
    for (let z = 900; z >= -900; z -= 0.5) { const x = trailX(z), y = height(x, z); s += Math.hypot(x - px, y - py, z - pz); raw.push([z, s]); px = x; py = y; pz = z; }
    const s0 = raw.find((r) => r[0] <= 0)[1];
    for (const [z, sv] of raw) { TZ.push(z); TS.push(sv - s0); }
  }
  function trailAt(s) {
    let lo = 0, hi = TS.length - 1;
    if (s <= TS[0]) hi = 1; else if (s >= TS[hi]) lo = hi - 1;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (TS[m] <= s) lo = m; else hi = m; }
    const k = (s - TS[lo]) / (TS[hi] - TS[lo]), z = TZ[lo] + (TZ[hi] - TZ[lo]) * k, x = trailX(z);
    const dx = trailX(z - 0.5) - x;
    return { x, y: height(x, z), z, heading: Math.atan2(dx, -0.5) };
  }
  const SUMMIT_S = trailAt(0).z - SUMMIT_Z;   // ~ |SUMMIT_Z|, refined below
  let summitS = SUMMIT_S; { let best = -1e9; for (let s = 150; s < 320; s += 0.5) { const p = trailAt(s); if (p.y > best) { best = p.y; summitS = s; } } }

  // ---------------------------------------------------------------- sky: find the Sun, take the horizon colour
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const SUN_AZ = Math.atan2(-0.35, 0.8);      // the Sun to the right and a little ahead of someone climbing to -z
  const SUN_EL = 0.72;                        // about 41 degrees: mid-morning light, long enough shadows
  let fogCol = new THREE.Color(0xc9d6e4), skyRot = 0;
  {
    const { data, width: SW, height: SH } = sky.image;
    let best = -1, bi = 0; const hor = [0, 0, 0]; let hn = 0;
    for (let r = 0; r < SH; r++) for (let c = 0; c < SW; c++) {
      const i = (r * SW + c) * 4, L = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (L > best) { best = L; bi = r * SW + c; }
      const el = (0.5 - (r + 0.5) / SH) * PI;
      if (el > 0.01 && el < 0.1 && L < 4) { hor[0] += data[i]; hor[1] += data[i + 1]; hor[2] += data[i + 2]; hn++; }
    }
    const u = ((bi % SW) + 0.5) / SW, phi = (u - 0.5) * 2 * PI;
    skyRot = Math.atan2(Math.sin(phi), Math.cos(phi)) - SUN_AZ;
    if (hn) { fogCol = new THREE.Color(hor[0] / hn, hor[1] / hn, hor[2] / hn); const m = Math.max(fogCol.r, fogCol.g, fogCol.b); fogCol.multiplyScalar(0.7 / m); }
    fogCol.lerp(new THREE.Color(0.62, 0.7, 0.8), 0.45);                     // thin, cool mountain air
  }
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, skyRot, 0); scene.environmentRotation.set(0, skyRot, 0);
  scene.environmentIntensity = 0.6;
  scene.fog = new THREE.FogExp2(fogCol, 0.000105);

  const sunDir = new V3(Math.cos(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), Math.sin(SUN_AZ) * Math.cos(SUN_EL)).normalize();
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.3);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbdd4f2, 0x6d6450, 0.4));

  // ---------------------------------------------------------------- the ground (dense near the trail)
  function axis(dense, step0, grow, extent) {
    const v = []; for (let x = -dense; x <= dense + 1e-6; x += step0) v.push(x);
    let s = step0, x = dense; while (x < extent) { s *= grow; x += s; v.push(x); v.unshift(-x); }
    return v;
  }
  // rock texture sampled from three sides (no stretching on cliffs), finer near the eye; vSnow whitens it
  const terrainMat = (extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ ...ROCK, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8), ...extra });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float snow;\nvarying float vSnow;\nvarying vec3 vWP;\nvarying vec3 vWN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSnow = snow;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * normal);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nvarying float vSnow;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvec4 tri(vec3 p, vec3 w, float s) {\n  return texture2D(map, p.zy * s) * w.x + texture2D(map, p.xz * s) * w.y + texture2D(map, p.xy * s) * w.z;\n}")
        .replace("#include <map_fragment>", [
          "vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);",
          "float dcam = length(vWP - cameraPosition);",
          "vec4 tA = tri(vWP, bw, 0.29), tB = tri(vWP, bw, 0.021), tC = tri(vWP, bw, 0.0017);",
          "vec4 tx = mix(mix(tA, tB, smoothstep(25.0, 260.0, dcam)), tC, smoothstep(900.0, 5000.0, dcam));",
          "tx.rgb *= mix(0.62 + 0.9 * dot(tri(vWP, bw, 0.004).rgb, vec3(0.333)), 1.0, smoothstep(900.0, 5000.0, dcam));",
          "float lum = dot(tx.rgb, vec3(0.299, 0.587, 0.114));",
          "tx.rgb = mix(tx.rgb, vec3(0.9 + 0.25 * lum), vSnow);",
          "diffuseColor *= tx;",
        ].join("\n"));
    };
    return m;
  };
  const ground = (() => {
    const xs = axis(90, 1.0, 1.024, 16000), zs = axis(420, 1.4, 1.024, 16000);
    const nx = xs.length, nz = zs.length, N = nx * nz;
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i;
      pos[k * 3] = x; pos[k * 3 + 1] = height(x, z); pos[k * 3 + 2] = z; uv[k * 2] = x / 3; uv[k * 2 + 1] = -z / 3;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1; idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const nrm = g.attributes.normal.array, col = new Float32Array(N * 3), snow = new Float32Array(N);
    const cRock = new THREE.Color(0.78, 0.75, 0.71), cDark = new THREE.Color(0.5, 0.48, 0.46), cGrass = new THREE.Color(0.44, 0.56, 0.24),
      cDry = new THREE.Color(0.74, 0.68, 0.44), cForest = new THREE.Color(0.2, 0.27, 0.15), cSnow = new THREE.Color(0.96, 0.98, 1.04), c = new THREE.Color();
    for (let k = 0; k < N; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], ny = nrm[k * 3 + 1];
      const d = x - trailX(z), u = Math.max(0, Math.abs(d) - FLAT);
      c.copy(cRock).lerp(cDark, fbm(x * 0.02 + 4, z * 0.02, 3) * 0.8);
      const gr = step(0.8, 0.93, ny + (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 0.25) * (1 - step(-80, 260, y - 200 * (fbm(x * 0.001, z * 0.001, 2) - 0.5)));
      const bare = step(0.52, 0.66, fbm(x * 0.09 + 2, z * 0.09 - 5, 3));        // rock showing through the turf
      c.lerp(cGrass.clone().lerp(cDry, 0.6 * fbm(x * 0.03 - 3, z * 0.03 + 8, 3)), gr * 0.92 * (1 - 0.8 * bare));
      c.lerp(cForest, step(-520, -760, y) * step(0.62, 0.8, ny));
      let sn = step(160, 420, y + (fbm(x * 0.002, z * 0.002, 4) - 0.5) * 380) * step(0.38, 0.62, ny);
      sn = Math.max(sn, step(0.7, 0.75, fbm(x * 0.006 + 9, z * 0.016 - 4, 4)) * step(0.75, 0.88, ny) * step(25, 70, u) * (1 - step(-260, -120, y)));
      c.lerp(cSnow, sn);
      c.multiplyScalar(0.93 + 0.14 * noise(x * 0.4, z * 0.4));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; snow[k] = sn;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setAttribute("snow", new THREE.BufferAttribute(snow, 1));
    const m = new THREE.Mesh(g, terrainMat()); m.receiveShadow = true; scene.add(m);
    return m;
  })();
  const slopeAt = (x, z) => { const e = 0.6; return Math.hypot(height(x + e, z) - height(x - e, z), height(x, z + e) - height(x, z - e)) / (2 * e); };

  // ---------------------------------------------------------------- the trail: packed gravel, soft edges
  {
    const S0 = -420, S1 = 420, ds = 0.5, across = [-1.05, -0.7, -0.35, 0, 0.35, 0.7, 1.05];
    const pos = [], uv = [], al = [], idx = []; let rows = 0;
    for (let s = S0; s <= S1; s += ds, rows++) {
      const p = trailAt(s), cx = -Math.cos(p.heading), sx = Math.sin(p.heading);   // right of travel: (-cos h, sin h)
      for (const a of across) {
        const w = a * (1 + 0.18 * (fbm(s * 0.15, a * 3, 2) - 0.5));
        const x = p.x + cx * w, z = p.z + sx * w;
        pos.push(x, height(x, z) + 0.025, z); uv.push(w / 1.6, s / 1.6); al.push(1 - step(0.55, 1.05, Math.abs(a)));
      }
    }
    const n = across.length;
    for (let r = 0; r < rows - 1; r++) for (let i = 0; i < n - 1; i++) { const a = r * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const col = []; for (let i = 0; i < al.length; i++) col.push(1, 1, 1, al[i]);
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ ...SAND, color: 0x9d8e7c, vertexColors: true, transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const trail = new THREE.Mesh(g, m); trail.receiveShadow = true; trail.renderOrder = 1; scene.add(trail);
  }

  // ---------------------------------------------------------------- helpers for instanced things
  const inst = (geo, mat, list, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D();
    list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0); o.scale.setScalar(p.s || 1); if (p.sy) o.scale.y = p.sy * (p.s || 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m;
  };
  // every mesh of a prop as its own piece, centred, base at y = 0
  const pieces = (root) => {
    const out = []; root.updateMatrixWorld(true);
    root.traverse((o) => { if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.computeBoundingBox();
      const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.computeBoundingBox();
      out.push({ geo: g, mat: o.material, size: g.boundingBox.getSize(new V3()), verts: g.attributes.position.count }); });
    return out;
  };
  const onTrail = (x, z) => Math.abs(x - trailX(z));
  // a place near the trail: s along it, d metres out (either side)
  const nearTrail = (s0, s1, d0, d1) => { const p = trailAt(rr(s0, s1)), d = rr(d0, d1) * (rnd() < 0.5 ? -1 : 1);
    return { x: p.x - Math.cos(p.heading) * d, z: p.z + Math.sin(p.heading) * d }; };
  const sinkFor = (x, z, s, r) => s * (0.18 + Math.min(0.6, slopeAt(x, z)) * r);

  // ---------------------------------------------------------------- boulders and stones
  {
    const pB = pieces(boulderA)[0], pN = pieces(boulderB)[0], pR = pieces(rockSet);
    const big = [], nam = [], rocks = pR.map(() => []);
    for (let i = 0; i < 70; i++) { const { x, z } = nearTrail(-380, 380, 4, 90); const s = rr(0.9, 2.8); big.push({ x, z, y: height(x, z) - sinkFor(x, z, s, 0.8), ry: rr(0, 6), s }); }
    for (let i = 0; i < 18; i++) { const { x, z } = nearTrail(-150, 300, 3.2, 14); const s = rr(0.6, 1.2); big.push({ x, z, y: height(x, z) - sinkFor(x, z, s, 0.7), ry: rr(0, 6), s }); }
    for (let i = 0; i < 90; i++) { const { x, z } = nearTrail(-420, 420, 6, 160); const s = rr(1.2, 3.5); nam.push({ x, z, y: height(x, z) - sinkFor(x, z, s, 1.0), ry: rr(0, 6), s }); }
    for (let i = 0; i < 40; i++) { const { x, z } = nearTrail(-700, 700, 120, 420); const s = rr(5, 12); nam.push({ x, z, y: height(x, z) - sinkFor(x, z, s, 1.2), ry: rr(0, 6), s }); }   // outcrops below
    for (let i = 0; i < 900; i++) { const { x, z } = nearTrail(-400, 400, 2.0, 50); const s = rr(0.12, 0.55); rocks[i % rocks.length].push({ x, z, y: height(x, z) - sinkFor(x, z, s, 0.9), ry: rr(0, 6), s, sy: rr(0.6, 1) }); }
    for (let i = 0; i < 700; i++) { const { x, z } = nearTrail(-400, 400, 0.85, 2.3); const s = rr(0.05, 0.16); rocks[i % rocks.length].push({ x, z, y: height(x, z) - s * 0.3, ry: rr(0, 6), s, sy: rr(0.5, 0.9) }); }  // stones edging the trail
    inst(pB.geo, pB.mat, big); inst(pN.geo, pN.mat, nam);
    pR.forEach((p, i) => inst(p.geo, p.mat, rocks[i]));
  }

  // ---------------------------------------------------------------- alpine grass: library clumps and built tufts
  {
    const ps = pieces(grassProp).filter((p) => p.verts < 3000 && p.size.y > 0.08);
    for (const p of ps) { const m = p.mat.clone(); m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; m.side = THREE.DoubleSide; p.mat = m; }
    const lists = ps.map(() => []);
    let placed = 0;
    for (let tries = 0; placed < 9000 && tries < 60000; tries++) {
      const { x, z } = placed < 6500 ? nearTrail(-160, 320, 0.95, 9) : nearTrail(-420, 420, 0.95, 26); if (slopeAt(x, z) > 0.75) continue;
      const s = rr(1.4, 2.6); lists[placed % ps.length].push({ x, z, y: height(x, z) - 0.03, ry: rr(0, 6), s }); placed++;
    }
    ps.forEach((p, i) => { const m = inst(p.geo, p.mat, lists[i], false); m.castShadow = true; });
    const tuftG = (() => { const v = [], n = 18; for (let i = 0; i < n; i++) { const a = i / n * 2 * PI + rr(-0.2, 0.2), lean = rr(0.1, 0.35), h = rr(0.18, 0.4), w = 0.018;
        const bx = Math.cos(a) * 0.03, bz = Math.sin(a) * 0.03, tx = Math.cos(a) * lean * h * 1.4, tz = Math.sin(a) * lean * h * 1.4, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        v.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g; })();
    const tuftA = [], tuftB = [];
    for (let i = 0; i < 16000; i++) { const { x, z } = i < 9000 ? nearTrail(-160, 320, 0.9, 14) : nearTrail(-420, 420, 0.9, 70); if (slopeAt(x, z) > 0.9) continue; (i % 3 ? tuftA : tuftB).push({ x, z, y: height(x, z) - 0.02, ry: rr(0, 6), s: rr(0.7, 1.5) }); }
    inst(tuftG, new THREE.MeshStandardMaterial({ color: 0x8f9a52, roughness: 1, side: THREE.DoubleSide }), tuftA, false);
    inst(tuftG, new THREE.MeshStandardMaterial({ color: 0xc2ad72, roughness: 1, side: THREE.DoubleSide }), tuftB, false);
  }

  // ---------------------------------------------------------------- conifer forest far below the tree line
  {
    const prep = (g, color) => { g = g.index ? g.toNonIndexed() : g; const c = new Float32Array(g.attributes.position.count * 3), cc = new THREE.Color(color);
      for (let i = 0; i < c.length; i += 3) c.set([cc.r, cc.g, cc.b], i); g.setAttribute("color", new THREE.BufferAttribute(c, 3)); g.deleteAttribute("uv"); return g; };
    const parts = [prep(new THREE.CylinderGeometry(0.25, 0.35, 3, 6).translate(0, 1.5, 0), 0x3b2c20)];
    [[0, 2, 7, 3.2], [0, 5, 5.6, 2.5], [0, 7.8, 4.2, 1.8]].forEach(([, y, h, r]) => parts.push(prep(new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2, 0), 0x1d3020)));
    const treeG = mergeGeometries(parts), list = [];
    for (let tries = 0; list.length < 9000 && tries < 120000; tries++) {
      const a = rr(0, 2 * PI), r = rr(700, 6000), x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
      if (y > -560 || y < -1180 || slopeAt(x, z) > 0.55) continue;
      list.push({ x, z, y: y - 0.5, ry: rr(0, 6), s: rr(1.2, 2.2) });
    }
    inst(treeG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), list, false);
  }

  // ---------------------------------------------------------------- haze lying in the valleys: thin stacked layers
  {
    const cv = document.createElement("canvas"); cv.width = cv.height = 512; const cx = cv.getContext("2d"), img = cx.createImageData(512, 512);
    const per = (x, y, f) => { // tileable noise
      const s = 512 / f; let v = 0, a = 0.5, n = 0, ff = f;
      for (let o = 0; o < 5; o++) { const X = x / 512 * ff, Y = y / 512 * ff, i = Math.floor(X), j = Math.floor(Y), fx = sm(X - i), fy = sm(Y - j), m = ff;
        const h = (p, q) => hash(((p % m) + m) % m + o * 101, ((q % m) + m) % m + o * 57);
        const A = h(i, j), B = h(i + 1, j), C = h(i, j + 1), D = h(i + 1, j + 1);
        v += a * (A + (B - A) * fx + (C - A) * fy + (A - B - C + D) * fx * fy); n += a; a *= 0.5; ff *= 2; }
      return v / n; };
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const v = 0.35 + 0.65 * step(0.25, 0.85, per(x, y, 3)); const i = (y * 512 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * v; img.data[i + 3] = 255; }
    cx.putImageData(img, 0, 0);
    const alpha = new THREE.CanvasTexture(cv); alpha.wrapS = alpha.wrapT = THREE.RepeatWrapping;
    const hazeCol = fogCol.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
    const layers = [[-900, 0.2, 0], [-840, 0.18, 0.3], [-780, 0.16, 0.55], [-720, 0.14, 0.15], [-660, 0.11, 0.8], [-610, 0.08, 0.45], [-560, 0.06, 0.65]];
    for (const [y, op, off] of layers) {
      const a = alpha.clone(); a.repeat.set(5, 5); a.offset.set(off, off * 0.7); a.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(36000, 36000), new THREE.MeshBasicMaterial({ color: hazeCol, alphaMap: a, transparent: true, opacity: op, depthWrite: false }));
      m.rotation.x = -PI / 2; m.position.y = y; m.renderOrder = 2; scene.add(m);
    }
  }

  // ---------------------------------------------------------------- wood for the sign and the stakes
  const woodTex = (() => {
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256; const c = cv.getContext("2d");
    c.fillStyle = "#7a5a3c"; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) { const y = rr(0, 256); c.strokeStyle = `rgba(${rnd() < 0.5 ? "40,26,14" : "160,128,92"},${rr(0.15, 0.45)})`; c.lineWidth = rr(0.6, 2.4);
      c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= 256; x += 16) c.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5); c.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.9 });

  // ---------------------------------------------------------------- marker stakes along the trail
  {
    const postG = new THREE.BoxGeometry(0.08, 1.0, 0.08).translate(0, 0.4, 0);
    const redG = new THREE.BoxGeometry(0.085, 0.09, 0.085), whiteG = redG.clone();
    redG.translate(0, 0.78, 0); const red2 = redG.clone().translate(0, -0.18, 0); whiteG.translate(0, 0.69, 0);
    const posts = [], k = 0;
    for (let s = -400, i = 0; s <= 420; s += 40, i++) {
      if (Math.abs(s - 20) < 12 || Math.abs(s - summitS) < 14) continue;
      const p = trailAt(s), d = i % 2 ? 1.3 : -1.3, x = p.x - Math.cos(p.heading) * d, z = p.z + Math.sin(p.heading) * d;
      posts.push({ x, z, y: height(x, z) - 0.15, ry: p.heading + rr(-0.2, 0.2), rz: rr(-0.05, 0.05) });
    }
    inst(postG, wood, posts);
    inst(mergeGeometries([redG, red2]), new THREE.MeshStandardMaterial({ color: 0xb8231c, roughness: 0.6 }), posts);
    inst(whiteG, new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.6 }), posts);
  }

  // ---------------------------------------------------------------- the signpost (s = 20, right of the trail)
  const signPos = new V3();
  {
    const p = trailAt(20), d = 1.9; signPos.set(p.x - Math.cos(p.heading) * d, 0, p.z + Math.sin(p.heading) * d); signPos.y = height(signPos.x, signPos.z);
    const board = (text, sub) => {
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128; const c = cv.getContext("2d");
      c.drawImage(woodTex.image, 0, 0, 512, 128); c.fillStyle = "rgba(255,240,210,0.08)"; c.fillRect(0, 0, 512, 128);
      c.fillStyle = "#f3ead8"; c.font = "bold 58px Helvetica, Arial, sans-serif"; c.textBaseline = "middle"; c.fillText(text, 26, 66);
      c.font = "bold 40px Helvetica, Arial, sans-serif"; c.textAlign = "right"; c.fillText(sub, 486, 68);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
    };
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.12), wood); post.position.y = 1.0; g.add(post);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 4), wood); cap.position.y = 2.2; cap.rotation.y = PI / 4; g.add(cap);
    // boards point along the trail: local -z is up the trail (to the summit), +z down it
    const mk = (y, dir, text, sub) => {
      const len = 0.95, b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.24, len), [board(text, sub), board(text, sub), wood, wood, wood, wood]);
      b.position.set(0, y, dir * (len / 2 - 0.02)); g.add(b);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 3), wood); tip.rotation.z = PI / 2; tip.rotation.x = dir > 0 ? 0 : PI;
      tip.scale.set(1, 1, 0.7); tip.position.set(0, y, dir * (len - 0.02)); g.add(tip);
    };
    mk(1.85, -1, "SUMMIT", "0.2 km"); mk(1.52, 1, "VALLEY", "6.5 km");
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.position.set(signPos.x, signPos.y - 0.12, signPos.z); g.rotation.y = p.heading + PI; scene.add(g);
  }

  // ---------------------------------------------------------------- the summit cairn
  const summit = (() => { const p = trailAt(summitS); return new V3(p.x, p.y, p.z); })();
  const cairnPos = new V3();
  {
    const p = trailAt(summitS), d = -2.6; cairnPos.set(p.x - Math.cos(p.heading) * d, 0, p.z + Math.sin(p.heading) * d); cairnPos.y = height(cairnPos.x, cairnPos.z);
    const mat = new THREE.MeshStandardMaterial({ ...ROCK, color: 0x9a948c, roughness: 0.95 });
    const g = new THREE.Group(); let y = -0.1;
    const stone = (r, h, ox, oz) => { const geo = new THREE.IcosahedronGeometry(1, 2), pp = geo.attributes.position;
      for (let i = 0; i < pp.count; i++) { const f = 1 + (hash(i * 13 + Math.floor(r * 1000), 7) - 0.5) * 0.28; pp.setXYZ(i, pp.getX(i) * f * r, pp.getY(i) * f * h, pp.getZ(i) * f * r * rr(0.8, 1)); }
      geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat); m.position.set(ox, y + h * 0.9, oz); m.rotation.y = rr(0, 6); g.add(m); y += h * 1.6; };
    // a broad footing ring, then a tapering stack
    for (let i = 0; i < 7; i++) { const a = i / 7 * 2 * PI; const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), mat); m.scale.set(1, 0.6, 1.2); m.position.set(Math.cos(a) * 0.62, 0.06, Math.sin(a) * 0.62); m.rotation.y = a; g.add(m); }
    [[0.62, 0.17], [0.56, 0.16], [0.5, 0.15], [0.44, 0.14], [0.38, 0.12], [0.32, 0.11], [0.26, 0.1], [0.2, 0.09], [0.14, 0.09]].forEach(([r, h], i) => stone(r, h, rr(-0.04, 0.04), rr(-0.04, 0.04)));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.position.copy(cairnPos); scene.add(g);
  }

  // ---------------------------------------------------------------- the people
  const castMap = {}, gaitSpeed = {};
  const footOf = (o) => { let f = null; o.traverse((b) => { if (!f && b.isBone && /left.?foot$/i.test(b.name)) f = b; }); return f; };
  function measure(fig, name) {   // metres a second the planted foot slides back: the speed that keeps it still
    if (!fig.actions[name]) return 0;
    const foot = footOf(fig.object), dur = fig.durations[name], N = 120, P = [], v = new V3();
    if (!foot) return name === "run" ? 3.4 : 1.35;
    fig.object.position.set(0, 0, 0); fig.object.rotation.set(0, 0, 0);
    for (let i = 0; i < N; i++) { fig.pose(dur * i / N, name); fig.object.updateMatrixWorld(true); foot.getWorldPosition(v); P.push(v.clone()); }
    const minY = Math.min(...P.map((p) => p.y)), vals = [];
    for (let i = 0; i < N - 1; i++) if (P[i].y < minY + 0.035 && P[i + 1].y < minY + 0.035) vals.push(-(P[i + 1].z - P[i].z) / (dur / N));
    vals.sort((a, b) => a - b); const m = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    return m > 0.3 ? m : (name === "run" ? 3.4 : 1.35);
  }
  figures.forEach((f) => { castMap[f.id] = f; gaitSpeed[f.id] = { walk: measure(f, "walk"), run: measure(f, "run") }; f.pose(0, "idle"); scene.add(f.object); });

  // ---------------------------------------------------------------- update
  const _f = new V3();
  function update(st = {}) {
    const time = st.time ?? 0;
    let focus = null;
    figures.forEach((f, i) => {
      let p = st.people ? st.people[f.id] : (i === 0 ? { s: 0 } : null);
      if (p && p.show === false) p = null;
      f.object.visible = !!p; if (!p) return;
      const g = p.gait || {}, walk = clamp01(g.walk || 0), run = clamp01(g.run || 0);
      let x, z, hd;
      if (p.s !== undefined || (p.x === undefined && p.z === undefined)) {
        const t = trailAt(p.s ?? 0), off = (p.offset || 0) * (p.back ? -1 : 1);
        x = t.x - Math.cos(t.heading) * off; z = t.z + Math.sin(t.heading) * off; hd = p.heading ?? (t.heading + (p.back ? PI : 0));
      } else { x = p.x ?? 0; z = p.z ?? 0; hd = p.heading ?? PI; }
      f.object.position.set(x, height(x, z), z); f.object.rotation.y = hd;
      f.pose(p.time ?? time, { idle: Math.max(0, 1 - walk - run), walk, run });
      if (!focus) focus = f.object.position;
    });
    const f = st.focus ? _f.set(st.focus.x, st.focus.y ?? height(st.focus.x, st.focus.z), st.focus.z) : focus ? _f.copy(focus) : _f.set(0, 0, 0);
    const R = st.shadowRadius ?? Math.min(500, Math.max(16, camera.position.distanceTo(f) * 1.2));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 2400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(sunDir, 1000); sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render,
    cast: castMap, person: figures[0] ? figures[0].object : null, gaitSpeed, sun, sunDir: sunDir.clone(), height,
    trailX, trailAt, SUMMIT_S: summitS, summit, cairn: cairnPos, sign: signPos,
    peaks: peaks.slice(0, 11).map((p) => ({ x: p.x, z: p.z, y: height(p.x, p.z) })),
  };
}
