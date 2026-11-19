// World "beach": a sandy tropical beach in late afternoon.
//
// Axes (metres): +x runs ALONG the shore, +y up, -z is OUT TO SEA (the horizon), +z inland. In the middle of the
// beach (|x| < 260) the waterline sits at z = 0; beyond that the shore curves seaward into a bay that ends in two
// rocky, green headlands (|x| > 650). world.shoreZ(x) gives the waterline's z, world.groundY(x, z) the sand height.
// Sand slopes up gently from the water (wet, dark and glossy for the first ~5 m, a tide line at ~7 m), dry sand to the
// dunes (z ~35..75, dune grass and a slatted sand fence at z ~ 36), a palm grove behind, then hazy green hills.
// Waves roll in with real height, break about 15..25 m out, run up the sand as a foamy sheet and slide back.
// A wooden lifeguard tower stands at world.towerSpot (x 12, z 17), rocks lie at the shore at x ~ -95 and in the surf
// at x ~ 95, umbrellas and towels at x -34..-24 and 30. The Sun is low over the sea to +x (warm sunset sky).
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], extras = true}) -> world.
// Per frame: set world.camera (position, fov, lookAt), then world.update(state), then world.render().
//
// state (every field optional):
//   time        seconds of the shot: waves, swash, palm sway, the flag, gulls and the background walkers all run on it
//   people      {<cast id>: {x, z, heading, time, gait: {walk, run}, show}}: heading radians about +y, 0 faces +z
//               (inland), PI/2 faces +x (along the shore), -PI/2 faces -x, PI faces the sea. y is put on the sand.
//               time = that figure's animation clock (default state.time). Move x by world.gaitSpeed[id].walk * walk
//               (+ .run * run) metres a second so the feet never slide. Default for cast[0]: walking +x along the wet
//               sand at z = 3.2 from x = -14.
//   extras      false hides the three background walkers far along the shoreline (default shown)
//   focus       {x, y, z} the shadow box centre (default cast[0]); shadowRadius metres (default from camera distance)
//
// Exposes: world.cast.<id> (loadFigure result: object, pose, height), world.person / world.subject (cast[0]'s object),
// world.gaitSpeed.<id> {walk, run} m/s, world.spot (Vector3, cast[0]'s default start on the wet sand),
// world.shoreZ(x), world.groundY(x, z), world.walkZ (3.2, the firm wet sand line), world.sun (DirectionalLight),
// world.sunDir (unit vector to the Sun), world.tower (Group), world.towerSpot (Vector3, its foot),
// world.palms (array of {group, top: Vector3}), world.rocks (array of Object3D), world.umbrellas, world.extras.
import { loadFigure, loadProp } from "../lib/figure.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], extras = true }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader || (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;
  const GLTFLoader = loaders.GLTFLoader || (await import("three/addons/loaders/GLTFLoader.js")).GLTFLoader;
  const V3 = THREE.Vector3, PI = Math.PI;
  const LIB = new URL("../lib/", import.meta.url).href;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
  const camera = new THREE.PerspectiveCamera(40, W / Hh, 0.1, 40000);
  camera.position.set(0, 8, -40); camera.lookAt(0, 2, 20);

  // ---------------------------------------------------------------- deterministic random
  let seed = 7310;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);

  // ---------------------------------------------------------------- the land's shape
  function shoreZ(x) { const a = Math.max(0, Math.abs(x) - 260); return Math.max(-0.00035 * a * a, -1200); }
  function groundY(x, z) {
    const d = z - shoreZ(x);
    let y = d < 0 ? Math.max(0.05 * d, -12) : 0.035 * Math.min(d, 60) + 0.012 * Math.max(0, d - 60);
    y += sm(34, 75, d) * (1.9 + 0.8 * Math.sin(x * 0.029 + 0.7) + 0.5 * Math.sin(x * 0.071 + 2) + 0.3 * Math.sin(x * 0.17 + z * 0.05));
    if (d > 9) y += sm(9, 20, d) * 0.07 * Math.sin(x * 0.21 + 0.6 * Math.sin(z * 0.13)) * Math.sin(z * 0.17 + x * 0.03);
    y += sm(120, 520, d) * (42 + 18 * Math.sin(x * 0.0037 + 1) + 10 * Math.sin(x * 0.011 + z * 0.004));
    y += sm(700, 2200, d) * (170 + 90 * Math.sin(x * 0.0019 + 0.4) + 40 * Math.sin(x * 0.006 + 2));
    const hd = sm(620, 1250, Math.abs(x));
    if (hd > 0) y += hd * sm(-90, 30, d) * (38 + 16 * Math.sin(x * 0.006) + 6 * Math.sin(z * 0.02 + x * 0.013));
    return y;
  }

  // ---------------------------------------------------------------- loading
  const TL = new THREE.TextureLoader();
  const tex = (f) => new Promise((res, rej) => TL.load(K + f, res, undefined, rej));
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => tex(`pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const hdrL = new HDRLoader(); hdrL.setDataType(THREE.HalfFloatType);
  const others = extras ? [{ id: "man", x: 70, z: 4.6, dir: -1, t0: 0 }, { id: "woman", x: -120, z: 2.4, dir: 1, t0: 0.4 },
    { id: "man", x: 160, z: 5.6, dir: -1, t0: 0.9 }] : [];
  async function gaitOf(id) {
    const out = { walk: 1.3, run: 3.4 };
    try {
      const dir = `${LIB}characters/${id}/`, meta = await (await fetch(dir + "character.json")).json();
      for (const n of ["walk", "run"]) {
        const src = meta.clips[n]; if (!src || src.startsWith("@")) continue;
        const g = await new GLTFLoader().loadAsync(dir + src), clip = g.animations[0]; if (!clip) continue;
        const tr = clip.tracks.find((t) => /hips\.position$/i.test(t.name)); if (!tr) continue;
        const v = tr.values, m = v.length / 3, hy = Math.abs(v[1]) || 1;
        const rel = Math.hypot(v[(m - 1) * 3] - v[0], v[(m - 1) * 3 + 2] - v[2]) / hy;
        if (rel < 0.15) continue;
        const sp = rel * 0.53 * (meta.height || 1.72) / clip.duration;
        if (n === "walk" && sp > 0.7 && sp < 2.2) out.walk = sp;
        if (n === "run" && sp > 2 && sp < 7) out.run = sp;
      }
    } catch (e) { /* defaults */ }
    return out;
  }
  const castIds = [...new Set(cast)];
  const [sky, SAND, ROCK, CONC, rocksProp, boulder, grass, figs, extraFigs, gaits] = await Promise.all([
    hdrL.loadAsync(K + "sky/sunset.hdr"), pbrSet("sand"), pbrSet("rock"), pbrSet("concrete"),
    loadProp({ THREE, id: "coast_rocks_03" }), loadProp({ THREE, id: "boulder_01" }), loadProp({ THREE, id: "grass_medium_01" }),
    Promise.all(castIds.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] }))),
    Promise.all(others.map((o) => loadFigure({ THREE, id: o.id, clips: ["walk"] }))),
    Promise.all([...new Set([...castIds, ...others.map((o) => o.id)])].map(async (id) => [id, await gaitOf(id)])),
  ]);
  const gaitSpeed = Object.fromEntries(gaits);

  // ---------------------------------------------------------------- sky: find the Sun in the HDR, aim it over the sea
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const half = (h) => THREE.DataUtils.fromHalfFloat(h);
  const SUN_X = 0.94, SUN_SEA = -0.36;
  const SKY = (() => {
    const { data, width: w, height: h } = sky.image;
    const get = (i) => (data instanceof Uint16Array ? half(data[i]) : data[i]);
    let best = -1, bi = 0; const hor = [0, 0, 0], amb = [0, 0, 0]; let hn = 0, an = 0;
    for (let r = 0; r < h; r += 2) for (let c = 0; c < w; c += 2) {
      const i = (r * w + c) * 4, R = get(i), G = get(i + 1), B = get(i + 2), L = R * 0.2126 + G * 0.7152 + B * 0.0722;
      const v = 1 - (r + 0.5) / h, el = (v - 0.5) * PI;
      if (L > best && el > 0) { best = L; bi = r * w + c; }
      if (el > 0.015 && el < 0.12 && L < 6) { hor[0] += R; hor[1] += G; hor[2] += B; hn++; }
      if (el > 0.1 && L < 6) { const cw = Math.cos(el); amb[0] += R * cw; amb[1] += G * cw; amb[2] += B * cw; an += cw; }
    }
    const r = Math.floor(bi / w), c = bi % w, u = (c + 0.5) / w, v = 1 - (r + 0.5) / h;
    const el = Math.abs((v - 0.5) * PI), phi = (u - 0.5) * 2 * PI;
    const dTex = new V3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
    const targetAz = Math.atan2(SUN_SEA, SUN_X);              // low along the shore, a little out to sea
    const rot = Math.atan2(dTex.z, dTex.x) - targetAz;
    const fog = new THREE.Color(hor[0] / hn, hor[1] / hn, hor[2] / hn);
    const m = Math.max(fog.r, fog.g, fog.b); if (m > 1.1) fog.multiplyScalar(1.1 / m);
    const ambient = new THREE.Color(amb[0] / an, amb[1] / an, amb[2] / an);
    const lel = Math.min(Math.max(el, 0.2), 0.42);           // late afternoon: 11..24 degrees up
    const light = new V3(Math.cos(targetAz) * Math.cos(lel), Math.sin(lel), Math.sin(targetAz) * Math.cos(lel)).normalize();
    return { rot, fog, ambient, light };
  })();
  scene.background = sky; scene.environment = sky;
  scene.backgroundRotation.set(0, SKY.rot, 0); scene.environmentRotation.set(0, SKY.rot, 0);
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.FogExp2(SKY.fog.clone(), 0.00105);
  const sunDir = SKY.light.clone();
  const sun = new THREE.DirectionalLight(0xffbf86, 4.2);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x8a6f52, 0.25); scene.add(hemi);
  const envRot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(-SKY.rot));
  const sunLin = new THREE.Color(0xffbf86).multiplyScalar(4.2);

  // ---------------------------------------------------------------- canvas textures
  const canvasTex = (w, h, paint, srgb = true) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  };
  const frondTex = (green) => canvasTex(256, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const N = 78;
    for (let k = 0; k < N; k++) for (const side of [-1, 1]) {
      const v = 0.04 + 0.95 * (k / N), y = h * (1 - v), L = w * 0.5, dy = L * (0.55 + 0.2 * rnd());
      const hue = green ? 80 + rr(-10, 14) : 32 + rr(-4, 6), sat = green ? rr(38, 58) : rr(35, 50), lit = green ? rr(20, 34) : rr(30, 42);
      const grad = g.createLinearGradient(w / 2, y, w / 2 + side * L, y - dy);
      grad.addColorStop(0, `hsl(${hue},${sat}%,${lit}%)`);
      grad.addColorStop(0.75, `hsl(${hue - 4},${sat}%,${lit + 6}%)`);
      grad.addColorStop(1, green ? `hsl(${hue - 30},${sat - 10}%,${lit + 14}%)` : `hsl(${hue},${sat}%,${lit + 8}%)`);
      g.fillStyle = grad; g.beginPath();
      const bw = 5.5 + rnd() * 2.5;
      g.moveTo(w / 2, y + bw); g.quadraticCurveTo(w / 2 + side * L * 0.5, y - dy * 0.35 + bw, w / 2 + side * L * (0.94 + 0.06 * rnd()), y - dy);
      g.quadraticCurveTo(w / 2 + side * L * 0.5, y - dy * 0.42 - bw * 0.6, w / 2, y - bw * 0.8); g.fill();
    }
    g.fillStyle = green ? "#8b8a4a" : "#a07c4c"; g.fillRect(w / 2 - 5, 0, 10, h);
  });
  const barkTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#7d6e5c"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const l = rr(28, 62); g.fillStyle = `hsla(30,14%,${l}%,0.25)`; g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(2, 9)); }
    for (let r = 0; r < 8; r++) {
      const y = r * 32 + rr(-2, 2);
      g.fillStyle = "rgba(48,38,28,0.75)"; g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + r) * 2 + rr(-1, 1));
      for (let x = w; x >= 0; x -= 16) g.lineTo(x, y + 6 + Math.sin(x * 0.05 + r) * 2 + rr(-1, 1)); g.fill();
      g.fillStyle = "rgba(170,150,120,0.35)"; g.fillRect(0, y + 7, w, 3);
    }
  });
  const woodTex = (base, plank = 0.2, paint = false) => canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const n = Math.round(1 / plank);
    for (let p = 0; p < n; p++) {
      const y0 = p * h / n;
      g.fillStyle = `rgba(0,0,0,${rr(0.02, 0.12)})`; g.fillRect(0, y0, w, h / n);
      for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${paint ? "255,255,255" : "40,25,10"},${rr(0.05, 0.16)})`; g.lineWidth = rr(0.5, 1.6);
        g.beginPath(); const yy = y0 + rr(2, h / n - 2); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + rr(-3, 3), w * 0.6, yy + rr(-3, 3), w, yy + rr(-2, 2)); g.stroke(); }
      g.fillStyle = "rgba(20,12,6,0.55)"; g.fillRect(0, y0, w, 2.5);
    }
  });
  const stripeTex = (cols, n, vertical = false) => canvasTex(512, 512, (g, w, h) => {
    for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; if (vertical) g.fillRect(i * w / n, 0, w / n + 1, h); else g.fillRect(0, i * h / n, w, h / n + 1); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${rr(0, 0.05)})`; g.fillRect(rr(0, w), rr(0, h), 2, 2); }
  });

  // ---------------------------------------------------------------- shared GLSL: the shore, the waves, noise
  const GL = /* glsl */`
    float shoreZ(float x){ float a = max(0.0, abs(x) - 260.0); return max(-0.00035*a*a, -1200.0); }
    float warpX(float x){ return 1.6*sin(x*0.043+0.6) + 0.9*sin(x*0.107+2.1) + 0.4*sin(x*0.23); }
    float depthAt(float d){ return d < 0.0 ? min(-0.05*d, 12.0) : 0.0; }
    float wPhase(float x, float d, float t){ return 0.3927*(d + warpX(x)) - 0.7854*t; }
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
    float waveH(float x, float z, float t){
      float d = z - shoreZ(x); float dep = depthAt(d);
      float c = 0.5 + 0.5*cos(wPhase(x, d, t));
      float shoal = 1.0 - smoothstep(1.2, 5.0, dep);
      float brk = 1.0 - smoothstep(0.7, 1.5, dep);
      float A = 0.10 + 0.30*shoal*(1.0 - brk) + 0.09*brk*smoothstep(0.05, 0.6, dep);
      float h = A*(2.0*pow(c, 1.5 + 4.0*shoal) - 0.45);
      h += 0.045*sin(x*0.37 + z*0.21 - t*1.3) + 0.03*sin(-x*0.23 + z*0.53 - t*1.7);
      float fade = (1.0 - smoothstep(-3.5, -0.4, d)) * (1.0 - smoothstep(270.0, 325.0, abs(x))) * smoothstep(-98.0, -85.0, z);
      return h*fade;
    }`;

  // ---------------------------------------------------------------- terrain
  function axis(ranges) { const a = []; for (const [x0, x1, s] of ranges) for (let x = x0; x < x1 - 1e-6; x += s) a.push(x); a.push(ranges[ranges.length - 1][1]); return a; }
  const XS = axis([[-4000, -1600, 60], [-1600, -900, 15], [-900, -320, 6], [-320, 320, 2], [320, 900, 6], [900, 1600, 15], [1600, 4000, 60]]);
  const ZS = axis([[-1300, -120, 20], [-120, -20, 4], [-20, 50, 1.25], [50, 140, 3], [140, 600, 12], [600, 3200, 60]]);
  {
    const nx = XS.length, nz = ZS.length, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    const aShore = new Float32Array(nx * nz), aVeg = new Float32Array(nx * nz), aRock = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = XS[i], z = ZS[j], y = groundY(x, z), d = z - shoreZ(x);
      pos.set([x, y, z], k * 3); uv.set([x / 2.6, -z / 2.6], k * 2); aShore[k] = d;
      const hd = sm(620, 1250, Math.abs(x)) * sm(-20, 30, d);
      aVeg[k] = Math.min(1, sm(70, 135, d) + hd * 0.85 + sm(44, 70, d) * 0.35 * (0.5 + 0.5 * Math.sin(x * 0.13 + z * 0.4)));
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1; idx.push(a, c, b, b, c, e); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const nrm = geo.attributes.normal.array;
    for (let k = 0; k < nx * nz; k++) aRock[k] = (1 - sm(0.72, 0.9, nrm[k * 3 + 1])) * sm(-30, 10, aShore[k] + 40 * sm(600, 900, Math.abs(pos[k * 3])));
    geo.setAttribute("aShore", new THREE.BufferAttribute(aShore, 1));
    geo.setAttribute("aVeg", new THREE.BufferAttribute(aVeg, 1));
    geo.setAttribute("aRock", new THREE.BufferAttribute(aRock, 1));
    const mat = new THREE.MeshStandardMaterial({ ...SAND, color: 0xffffff, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.rockMap = { value: ROCK.map };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aShore; attribute float aVeg; attribute float aRock;\nvarying float vShore; varying float vVeg; varying float vRock; varying vec3 vWp;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShore = aShore; vVeg = aVeg; vRock = aRock; vWp = (modelMatrix*vec4(position,1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D rockMap; varying float vShore; varying float vVeg; varying float vRock; varying vec3 vWp;\n" + GL + "\nfloat gWet; float gUnder;")
        .replace("#include <map_fragment>", `#include <map_fragment>
          {
            vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8)*vMapUv*0.57 + vec2(0.31, 0.77);
            vec3 sB = texture2D(map, ruv).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, sB, smoothstep(0.3, 0.7, fbm(vWp.xz*0.06 + 3.0)));
            diffuseColor.rgb *= vec3(1.5, 1.36, 1.12);
            vec3 macro = texture2D(map, vMapUv*0.083).rgb;
            float mv = dot(macro, vec3(0.33)) / 0.55;
            float n = fbm(vWp.xz*0.035);
            diffuseColor.rgb *= vec3(1.06, 1.0, 0.92) * mix(0.82, 1.12, n) * mix(0.9, 1.1, clamp(mv, 0.0, 2.0)*0.5);
            float d = vShore + (fbm(vWp.xz*0.15) - 0.5)*1.6;
            gWet = 1.0 - smoothstep(3.2, 6.0, d);
            gUnder = 1.0 - smoothstep(-1.5, 0.3, d);
            float tide = exp(-pow((d - 7.2)/0.35, 2.0)) * smoothstep(0.35, 0.7, fbm(vWp.xz*0.6));
            diffuseColor.rgb *= mix(1.0, 0.5, gWet) * mix(1.0, 0.7, gUnder) * (1.0 - 0.35*tide) * mix(1.0, 0.8 + 0.4*fbm(vWp.xz*0.9), gWet);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.8, 0.92, 0.95), gUnder);
            vec3 veg = vec3(0.12, 0.15, 0.06) * (0.6 + 0.8*n) * mix(0.85, 1.15, vnoise(vWp.xz*0.4));
            diffuseColor.rgb = mix(diffuseColor.rgb, veg, vVeg);
            vec3 rk = texture2D(rockMap, vMapUv*0.35).rgb * vec3(0.85, 0.82, 0.78);
            diffuseColor.rgb = mix(diffuseColor.rgb, rk, clamp(vRock*1.4, 0.0, 1.0));
          }`)
        .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace("texture2D( normalMap, vNormalMapUv )",
          "mix(texture2D(normalMap, vNormalMapUv), texture2D(normalMap, mat2(0.8, -0.6, 0.6, 0.8)*vNormalMapUv*0.57 + vec2(0.31, 0.77)), smoothstep(0.3, 0.7, fbm(vWp.xz*0.06 + 3.0)))"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45 + 0.3*fbm(vWp.xz*0.7), gWet*(1.0-vVeg)); roughnessFactor = mix(roughnessFactor, 0.95, max(vVeg, vRock));");
    };
    const land = new THREE.Mesh(geo, mat); land.receiveShadow = true; scene.add(land);
  }

  // ---------------------------------------------------------------- the sea (one shader: waves, foam, depth colour, sky reflection)
  const seaU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    time: { value: 0 }, envMap: { value: null }, envRot: { value: envRot }, sunDir: { value: sunDir }, sunCol: { value: sunLin },
    skyAmb: { value: SKY.ambient.clone() }, rocks: { value: [] },
  }]);
  seaU.envMap.value = sky;
  const NR = 6; seaU.rocks.value = Array.from({ length: NR }, () => new THREE.Vector4(0, 0, 0, 0));
  const seaMat = new THREE.ShaderMaterial({
    uniforms: seaU, fog: true, transparent: true, depthWrite: true,
    vertexShader: /* glsl */`
      uniform float time; varying vec3 vWp; varying vec3 vN;
      #include <fog_pars_vertex>
      ${GL}
      void main(){
        vec4 wp = modelMatrix*vec4(position, 1.0);
        float e = 0.35;
        float h = waveH(wp.x, wp.z, time);
        float hx = waveH(wp.x + e, wp.z, time) - waveH(wp.x - e, wp.z, time);
        float hz = waveH(wp.x, wp.z + e, time) - waveH(wp.x, wp.z - e, time);
        wp.y += h; vWp = wp.xyz;
        vN = normalize(vec3(-hx/(2.0*e), 1.0, -hz/(2.0*e)));
        vec4 mvPosition = viewMatrix*wp;
        gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform sampler2D envMap; uniform mat3 envRot; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyAmb;
      uniform vec4 rocks[${NR}];
      varying vec3 vWp; varying vec3 vN;
      #include <fog_pars_fragment>
      ${GL}
      vec3 env(vec3 r){ r = envRot*r; vec2 uv = vec2(atan(r.z, r.x)*0.15915494 + 0.5, asin(clamp(r.y, -1.0, 1.0))*0.31830989 + 0.5);
        return min(texture2D(envMap, uv).rgb, vec3(8.0)); }
      void main(){
        vec3 p = vWp; float t = time;
        float dist = length(cameraPosition - p);
        float d = p.z - shoreZ(p.x); float dep = depthAt(d);
        // small waves on top of the swell, fading with distance so the far sea does not shimmer
        vec2 q = p.xz; vec2 g = vec2(0.0);
        float fd = 1.0/(1.0 + dist*0.012);
        g += vec2(0.30, 0.95)*0.10*cos(dot(q, vec2(0.30, 0.95))*1.1 - t*1.5);
        g += vec2(-0.7, 0.71)*0.08*cos(dot(q, vec2(-0.7, 0.71))*1.9 - t*2.1);
        g += vec2(0.92, 0.38)*0.06*cos(dot(q, vec2(0.92, 0.38))*3.1 - t*2.6);
        g += vec2(-0.2, 0.98)*0.05*cos(dot(q, vec2(-0.2, 0.98))*5.3 - t*3.3);
        g += vec2(0.6, -0.8)*0.035*cos(dot(q, vec2(0.6, -0.8))*8.7 - t*4.1);
        vec3 N = normalize(vN + vec3(-g.x, 0.0, -g.y)*(0.35 + 1.3*fd));
        // foam: breaking crests and their trails, lace at the waterline, rings round rocks
        float ph = wPhase(p.x, d, t), u = fract(ph*0.15915494);
        float zone = (1.0 - smoothstep(1.2, 2.2, dep)) * smoothstep(0.0, 0.25, dep);
        float trail = exp(-(1.0 - u)*5.0)*0.85 + exp(-u*28.0);
        vec2 fq = p.xz*vec2(0.55, 0.9) + vec2(0.0, -t*0.6);
        float n1 = fbm(fq), n2 = fbm(p.xz*2.3 + vec2(t*0.1, -t*0.9));
        float foam = smoothstep(0.42, 0.78, zone*trail*(0.55 + 0.9*n1)) * (0.65 + 0.35*n2);
        float lace = (1.0 - smoothstep(0.0, 0.6, dep)) * smoothstep(0.45, 0.7, fbm(p.xz*1.4 + vec2(0.0, t*0.3)));
        foam = max(foam, lace*0.8);
        float cap = smoothstep(0.93, 1.0, 0.5 + 0.5*cos(ph)) * smoothstep(0.62, 0.85, n1) * smoothstep(1.5, 3.0, dep) * 0.5;
        foam = max(foam, cap*fd);
        for (int i = 0; i < ${NR}; i++){ vec4 r = rocks[i]; if (r.z <= 0.0) continue;
          float rd = length(p.xz - r.xy) - r.z;
          float ring = exp(-max(rd, 0.0)/1.1) * (0.6 + 0.4*sin(t*1.7 + r.w)) * smoothstep(0.3, 0.7, n2 + 0.2);
          foam = max(foam, ring); }
        foam = clamp(foam, 0.0, 1.0);
        // colour
        vec3 V = normalize(cameraPosition - p);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98*pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = env(R);
        vec3 deep = vec3(0.008, 0.040, 0.060), shallow = vec3(0.045, 0.20, 0.19);
        vec3 body = mix(shallow, deep, 1.0 - exp(-dep*0.45));
        float crest = smoothstep(0.7, 1.0, 0.5 + 0.5*cos(ph)) * (1.0 - smoothstep(1.0, 5.0, dep)) * smoothstep(0.3, 1.0, dep);
        body += vec3(0.03, 0.12, 0.10)*crest;                       // light through a steep wave face
        float sd = max(dot(N, sunDir), 0.0);
        vec3 lit = body*(skyAmb*0.7 + sunCol*(0.08 + 0.18*sd));
        vec3 col = mix(lit, refl, fres);
        float sp = pow(max(dot(R, sunDir), 0.0), 420.0)*14.0 + pow(max(dot(R, sunDir), 0.0), 40.0)*0.25;
        col += sunCol*sp*(1.0 - foam);
        vec3 fcol = vec3(0.93, 0.95, 0.96)*(skyAmb*0.9 + sunCol*(0.18 + 0.5*sd));
        col = mix(col, fcol, foam);
        float alpha = clamp(0.18 + dep*1.6, 0.0, 1.0);
        alpha = max(alpha, fres);
        alpha = mix(alpha, 1.0, foam);
        float edgeN = -0.25 - 1.3*fbm(p.xz*vec2(0.35, 0.8) + 5.0);
        alpha *= 1.0 - smoothstep(edgeN - 0.6, edgeN, d);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  function planeXZ(x0, x1, z0, z1, nx, nz) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); return g;
  }
  {
    const surf = planeXZ(-330, 330, -100, 2, 660, 204);
    const far = mergeGeometries([planeXZ(-30000, -330, -30000, 400, 60, 60), planeXZ(330, 30000, -30000, 400, 60, 60),
      planeXZ(-330, 330, -30000, -100, 8, 60), planeXZ(-330, 330, 2, 400, 8, 8)]);
    for (const g of [surf, far]) { const m = new THREE.Mesh(g, seaMat); m.renderOrder = 2; m.frustumCulled = false; scene.add(m); }
  }

  // swash: the thin sheet a wave pushes up the sand, foamy at its edge, sliding back
  const swashMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, sunCol: { value: sunLin }, skyAmb: { value: SKY.ambient.clone() }, sunDir: { value: sunDir } }]),
    fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: `varying vec3 vWp;
      #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float time; uniform vec3 sunCol; uniform vec3 skyAmb; uniform vec3 sunDir; varying vec3 vWp;
      #include <fog_pars_fragment>
      ${GL}
      void main(){
        vec3 p = vWp; float t = time; float d = p.z - shoreZ(p.x);
        float u0 = fract(wPhase(p.x, 0.0, t)*0.15915494 + 0.04);
        float up = u0 < 0.33 ? sin(u0/0.33*1.5708) : 1.0 - smoothstep(0.33, 0.97, u0);
        float R = 3.3 + 1.2*sin(p.x*0.051 + 0.4) + 0.7*sin(p.x*0.13 + 1.9) + 0.5*(fbm(vec2(p.x*0.08, floor(t/8.0 + 0.5))) - 0.5);
        float edge = -1.2 + R*up + (fbm(vec2(p.x*0.6, 3.1)) - 0.5)*0.6 + (fbm(vec2(p.x*0.18, floor(t/8.0 + 0.5)*3.7)) - 0.5)*1.6;
        if (d > edge) discard;
        float behind = edge - d;
        float advancing = u0 < 0.33 ? 1.0 : 0.35;
        float n = fbm(p.xz*vec2(2.2, 3.0) + vec2(0.0, -up*3.0));
        float line = exp(-behind*3.2) * smoothstep(0.25, 0.6, n + 0.15);
        float bubbles = exp(-behind*0.7) * smoothstep(0.55, 0.78, fbm(p.xz*4.0 + 9.0)) * advancing;
        float foam = clamp(line*(0.55 + 0.45*advancing) + bubbles*0.7, 0.0, 1.0);
        float rip = fbm(p.xz*vec2(1.5, 3.5) + vec2(t*0.3, -t*0.8));
        vec3 V = normalize(cameraPosition - p);
        float fres = 0.02 + 0.98*pow(1.0 - max(V.y, 0.0), 5.0);
        vec3 water = mix(vec3(0.05, 0.14, 0.14)*(skyAmb + sunCol*0.12), skyAmb*(0.85 + 0.5*rip), clamp(fres*1.5, 0.0, 1.0));
        vec3 fcol = vec3(0.95)*(skyAmb*0.9 + sunCol*(0.18 + 0.45*sunDir.y));
        float a = mix((0.1 + 0.75*fres + 0.12*rip)*smoothstep(0.0, 0.4, behind), 0.95, foam);
        gl_FragColor = vec4(mix(water, fcol, foam), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  {
    const g = planeXZ(-330, 330, -2.5, 7, 660, 38), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, groundY(p.getX(i), p.getZ(i)) + 0.02);
    const m = new THREE.Mesh(g, swashMat); m.renderOrder = 1; m.frustumCulled = false; scene.add(m);
  }

  // ---------------------------------------------------------------- palms
  const frondG = frondTex(true), frondB = frondTex(false);
  const frondMat = new THREE.MeshStandardMaterial({ map: frondG, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xd8e0b0 });
  const deadMat = new THREE.MeshStandardMaterial({ map: frondB, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0xd0c0a0 });
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, normalMap: ROCK.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 });
  const nutMat = new THREE.MeshStandardMaterial({ color: 0x5a4a22, roughness: 0.7 });
  function frondGeo(len, width, rise, droop, fold, segs = 18) {
    const P = [], UV = [], I = [];
    for (let i = 0; i <= segs; i++) {
      const s = i / segs, hx = len * s * 0.95, y = len * (rise * s - droop * s * s);
      const ty = len * (rise - 2 * droop * s), tx = len * 0.95, tl = Math.hypot(tx, ty), T = [tx / tl, ty / tl];
      const w = width * 0.5 * Math.pow(Math.sin(PI * Math.min(1, 0.06 + s * 0.94)), 0.55) * (1 - 0.25 * s);
      const U = [-T[1], T[0]];                                  // up, in the frond's plane
      const c = Math.cos(fold), sn = Math.sin(fold);
      P.push(hx - U[0] * w * sn, y - U[1] * w * sn, w * c, hx, y, 0, hx - U[0] * w * sn, y - U[1] * w * sn, -w * c);
      UV.push(0, s, 0.5, s, 1, s);
      if (i < segs) { const a = i * 3; I.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I); g.computeVertexNormals(); return g;
  }
  function crownGeo(scale, dead) {
    const live = [], brown = [], n = 15;
    for (let i = 0; i < n; i++) {
      const tier = i % 3, a = (i / n) * 2 * PI + rr(-0.15, 0.15);
      const len = scale * rr(3.6, 4.8) * (tier === 0 ? 0.85 : 1);
      const rise = tier === 0 ? rr(0.55, 0.8) : tier === 1 ? rr(0.25, 0.45) : rr(0.0, 0.18);
      const g = frondGeo(len, scale * rr(1.5, 1.9), rise, rise + rr(0.45, 0.7), rr(0.35, 0.6));
      g.rotateX(rr(-0.25, 0.25)); g.rotateY(a); live.push(g);
    }
    for (let i = 0; i < dead; i++) {
      const g = frondGeo(scale * rr(2.6, 3.4), scale * 1.1, -0.6, 0.35, 0.9); g.rotateY(rr(0, 2 * PI)); brown.push(g);
    }
    return { live: mergeGeometries(live), brown: brown.length ? mergeGeometries(brown) : null };
  }
  const crowns = Array.from({ length: 5 }, (_, i) => crownGeo(1, i % 3));
  const nutGeo = new THREE.SphereGeometry(0.13, 12, 9);
  const nuts = [];
  const palms = [];
  function addPalm(x, z, H, lean, az) {
    const y0 = groundY(x, z) - 0.35, dir = new V3(Math.cos(az), 0, Math.sin(az));
    const pts = []; for (let i = 0; i <= 6; i++) { const s = i / 6; pts.push(new V3(x, y0, z).addScaledVector(dir, lean * H * Math.pow(s, 1.7)).add(new V3(0, (H + 0.35) * s, 0))); }
    const curve = new THREE.CatmullRomCurve3(pts), TS = 28, RS = 12;
    const g = new THREE.TubeGeometry(curve, TS, 1, RS, false), pp = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i <= TS; i++) {
      const s = i / TS, c = curve.getPointAt(s), r = (0.15 + 0.11 * Math.pow(1 - s, 3) + 0.03 * (1 - s)) * (1 + 0.03 * Math.sin(s * H * 25));
      for (let j = 0; j <= RS; j++) { const k = i * (RS + 1) + j; const v = new V3(pp.getX(k), pp.getY(k), pp.getZ(k)).sub(c).multiplyScalar(r).add(c); pp.setXYZ(k, v.x, v.y, v.z); uv.setXY(k, j / RS, s * H / 2); }
    }
    g.computeVertexNormals();
    const trunk = new THREE.Mesh(g, barkMat); trunk.castShadow = trunk.receiveShadow = true; scene.add(trunk);
    const top = curve.getPointAt(1);
    const crown = new THREE.Group(); crown.position.copy(top); const sc = H / 10 * rr(0.95, 1.1) + 0.25; crown.scale.setScalar(Math.min(1.25, sc));
    const cg = crowns[Math.floor(rnd() * crowns.length)];
    const lm = new THREE.Mesh(cg.live, frondMat); lm.castShadow = true; lm.receiveShadow = true; crown.add(lm);
    if (cg.brown) { const bm = new THREE.Mesh(cg.brown, deadMat); bm.castShadow = true; crown.add(bm); }
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 10), barkMat); bulb.position.y = -0.3; crown.add(bulb);
    crown.rotation.y = rr(0, 2 * PI); scene.add(crown);
    const nn = Math.floor(rr(2, 6));
    for (let i = 0; i < nn; i++) { const a = rr(0, 2 * PI); nuts.push(new V3(top.x + Math.cos(a) * 0.22, top.y - rr(0.25, 0.5), top.z + Math.sin(a) * 0.22)); }
    palms.push({ group: crown, trunk, top: top.clone(), phase: rr(0, 6.28), amp: rr(0.025, 0.05) });
  }
  const palmSpots = [];
  const tryPalm = (x, z) => { for (const p of palmSpots) if (Math.hypot(p[0] - x, p[1] - z) < 6) return false; palmSpots.push([x, z]); return true; };
  for (let i = 0; i < 46; i++) {                                // the grove behind the beach
    const x = rr(-260, 260), z = rr(26, 70) + (rnd() < 0.4 ? rr(0, 40) : 0);
    if (Math.abs(x - 12) < 9 && z < 34) continue;               // keep the tower clear
    if (!tryPalm(x, z)) continue;
    addPalm(x, z, rr(7.5, 12.5), rr(0.08, 0.32), Math.atan2(-1, rr(-0.6, 0.6)) + rr(-0.4, 0.4));
  }
  for (const [x, z] of [[-18, 24], [36, 23], [-52, 22]]) if (tryPalm(x, z)) addPalm(x, z, rr(8, 10), 0.3, -PI / 2 + rr(-0.3, 0.3));
  for (let i = 0; i < 40; i++) {                                // along the curving shore of the bay
    const x = (rnd() < 0.5 ? -1 : 1) * rr(280, 720), z = shoreZ(x) + rr(30, 70);
    if (tryPalm(x, z)) addPalm(x, z, rr(8, 12), rr(0.1, 0.3), Math.atan2(-1, rr(-0.5, 0.5)));
  }
  { const im = new THREE.InstancedMesh(nutGeo, nutMat, nuts.length), m = new THREE.Matrix4();
    nuts.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z))); im.castShadow = true; scene.add(im); }

  // trees on the hills behind and on the headlands: rounded canopies, hazy with distance
  {
    const N = 16000, geo = new THREE.IcosahedronGeometry(1, 1), mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, N), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(); let n = 0;
    const col = new THREE.Color();
    while (n < N) {
      const x = rr(-2200, 2200), z = rr(-900, 1600), d = z - shoreZ(x);
      const hd = sm(620, 1250, Math.abs(x)) * sm(-10, 40, d);
      if (!((d > 115 + rr(0, 40) && d < 900) || hd > 0.55)) continue;
      const r = rr(2.2, 4.8), y = groundY(x, z) + r * 0.45;
      s.set(r, r * rr(0.7, 1.0), r); q.setFromEuler(new THREE.Euler(0, rr(0, 6), 0));
      im.setMatrixAt(n, m.compose(new V3(x, y, z), q, s)); im.setColorAt(n, col.setHSL(rr(0.21, 0.3), rr(0.35, 0.55), rr(0.07, 0.14))); n++;
    }
    im.receiveShadow = true; scene.add(im);
  }

  // dune grass (library grass tufts, instanced) and a slatted sand fence along the foot of the dunes
  {
    const parts = []; grass.updateMatrixWorld(true);
    grass.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; if (b.max.y - b.min.y > 0.2) parts.push(o); } });
    const per = 260, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3();
    for (const o of parts) {
      const mat = o.material.clone(); mat.side = THREE.DoubleSide;
      const im = new THREE.InstancedMesh(o.geometry, mat, per); let n = 0;
      while (n < per) {
        const x = rr(-300, 300), z = rr(30, 85), d = z - shoreZ(x);
        if (d < 33 || (Math.abs(x - 12) < 6 && d < 40)) continue;
        const k = rr(2.6, 4.2); s.set(k, k * rr(0.9, 1.3), k); q.setFromEuler(new THREE.Euler(0, rr(0, 6.28), 0));
        im.setMatrixAt(n++, m.compose(new V3(x, groundY(x, z) - 0.03, z), q, s));
      }
      im.castShadow = true; im.receiveShadow = true; scene.add(im);
    }
  }
  const fenceWood = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.95, map: woodTex("#9a8466", 0.5) });
  {
    const slat = new THREE.BoxGeometry(0.04, 1.1, 0.012), post = new THREE.CylinderGeometry(0.05, 0.06, 1.6, 7);
    const S = [], P = [];
    let x = -280;
    while (x < 280) {
      const run = rr(18, 46);
      for (let xx = x; xx < Math.min(280, x + run); xx += 0.11) {
        const z = 36.5 + 1.5 * Math.sin(xx * 0.05) + 0.8 * Math.sin(xx * 0.17);
        if (Math.abs(xx - 12) < 3.5) continue;                    // the path to the tower
        S.push([xx, z, rr(-0.06, 0.06), rr(0.92, 1.05)]);
        if (Math.abs(((xx - x) % 2.5)) < 0.11) P.push([xx, z]);
      }
      x += run + rr(3, 9);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3();
    const im = new THREE.InstancedMesh(slat, fenceWood, S.length);
    S.forEach(([xx, z, tilt, h], i) => { q.setFromEuler(new THREE.Euler(tilt, 0.05 * Math.cos(xx * 0.05), tilt * 0.5)); s.set(1, h, 1);
      im.setMatrixAt(i, m.compose(new V3(xx, groundY(xx, z) + 0.45 * h, z), q, s)); });
    im.castShadow = im.receiveShadow = true; scene.add(im);
    const ip = new THREE.InstancedMesh(post, fenceWood, P.length);
    P.forEach(([xx, z], i) => ip.setMatrixAt(i, m.makeTranslation(xx, groundY(xx, z) + 0.55, z + 0.04)));
    ip.castShadow = true; scene.add(ip);
  }

  // ---------------------------------------------------------------- rocks
  const rocks = [], rockRings = [];
  const fitProp = (src, target, x, z, ry, sink = 0.15, tilt = 0) => {
    const o = src.clone(true); const b = new THREE.Box3().setFromObject(src), sz = b.getSize(new V3());
    const k = target / Math.max(sz.x, sz.z); o.scale.setScalar(k); o.rotation.set(tilt, ry, 0);
    o.position.set(x, groundY(x, z) - b.min.y * k - sz.y * k * sink, z); scene.add(o); rocks.push(o); return { o, r: target * 0.5 };
  };
  rocksProp.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  boulder.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  fitProp(rocksProp, 26, -100, -2, 0.4, 0.42);
  fitProp(rocksProp, 15, -82, 5, 2.1, 0.45);
  for (const [x, z, s, ry] of [[95, -14, 3.2, 0.3], [99, -17, 2.0, 1.4], [91, -11, 1.4, 2.6], [-86, -9, 2.6, 0.9], [-112, -8, 3.4, 2.2], [-70, 30, 1.6, 1.0], [58, 33, 1.2, 2.0], [-140, 31, 2.1, 0.2]]) {
    const { o } = fitProp(boulder, s, x, z, ry, 0.2);
    if (z < 0) rockRings.push(new THREE.Vector4(x, z, s * 0.45, rr(0, 6)));
  }
  rockRings.push(new THREE.Vector4(-100, -8, 7, 1.2), new THREE.Vector4(-108, -5, 6, 2.5));
  rockRings.slice(0, NR).forEach((v, i) => seaU.rocks.value[i].copy(v));

  // ---------------------------------------------------------------- lifeguard tower
  const tower = new THREE.Group(); const towerSpot = new V3(12, groundY(12, 17), 17);
  {
    const raw = new THREE.MeshStandardMaterial({ map: woodTex("#8c6a48", 0.25), roughness: 0.9 });
    const paint = new THREE.MeshStandardMaterial({ map: woodTex("#6fa9c8", 0.14, true), roughness: 0.75 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8332b, roughness: 0.55 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.08, metalness: 0.6 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; tower.add(m); return m; };
    const DECK = 2.5, LEG = 1.25;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.16, DECK + 0.6, 0.16), raw, sx * LEG, (DECK + 0.6) / 2 - 0.6, sz * LEG);
    const brace = Math.hypot(2 * LEG, DECK - 0.3), ang = Math.atan2(DECK - 0.3, 2 * LEG);
    for (const sz of [-1, 1]) { add(new THREE.BoxGeometry(brace, 0.1, 0.06), raw, 0, DECK / 2, sz * (LEG + 0.1), 0, 0, ang); add(new THREE.BoxGeometry(brace, 0.1, 0.06), raw, 0, DECK / 2, sz * (LEG + 0.1), 0, 0, -ang); }
    for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.06, 0.1, brace), raw, sx * (LEG + 0.1), DECK / 2, 0, ang, 0, 0); add(new THREE.BoxGeometry(0.06, 0.1, brace), raw, sx * (LEG + 0.1), DECK / 2, 0, -ang, 0, 0); }
    add(new THREE.BoxGeometry(3.3, 0.14, 3.6), raw, 0, DECK, -0.2);
    // cabin
    const CW = 2.4, CH = 2.1, CD = 2.2, cy = DECK + 0.07 + CH / 2;
    add(new THREE.BoxGeometry(CW, CH, 0.1), paint, 0, cy, CD / 2);                     // back wall (inland)
    add(new THREE.BoxGeometry(CW, 0.95, 0.1), paint, 0, DECK + 0.55, -CD / 2);         // front wall below the window
    add(new THREE.BoxGeometry(CW, 0.28, 0.1), paint, 0, DECK + CH - 0.07, -CD / 2);
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.1, 0.95, CD), paint, sx * CW / 2, DECK + 0.55, 0);
      add(new THREE.BoxGeometry(0.1, 0.28, CD), paint, sx * CW / 2, DECK + CH - 0.07, 0);
      for (const zz of [-1, 1]) add(new THREE.BoxGeometry(0.12, CH, 0.12), trim, sx * CW / 2, cy, zz * CD / 2);
      add(new THREE.BoxGeometry(0.04, 0.85, CD - 0.2), glass, sx * CW / 2, DECK + 1.45, 0);
    }
    add(new THREE.BoxGeometry(CW - 0.2, 0.85, 0.04), glass, 0, DECK + 1.45, -CD / 2);
    add(new THREE.BoxGeometry(CW + 0.1, 0.08, 0.14), trim, 0, DECK + 1.04, -CD / 2 - 0.02);
    const roof = add(new THREE.ConeGeometry(2.25, 0.9, 4, 1), red, 0, DECK + CH + 0.5, 0, 0, PI / 4, 0); roof.scale.set(1.05, 1, 1.0);
    add(new THREE.BoxGeometry(CW + 0.3, 0.1, CD + 0.3), trim, 0, DECK + CH + 0.06, 0);
    // railing round the front of the deck
    for (let i = 0; i <= 6; i++) add(new THREE.BoxGeometry(0.07, 0.9, 0.07), trim, -1.6 + i * 0.533, DECK + 0.5, -1.95);
    for (const zz of [-1.95]) { add(new THREE.BoxGeometry(3.3, 0.08, 0.08), trim, 0, DECK + 0.95, zz); add(new THREE.BoxGeometry(3.3, 0.06, 0.06), trim, 0, DECK + 0.5, zz); }
    for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.08, 0.08, 0.75), trim, sx * 1.6, DECK + 0.95, -1.58); add(new THREE.BoxGeometry(0.07, 0.9, 0.07), trim, sx * 1.6, DECK + 0.5, -1.2); }
    // a ramp down to the sand behind
    const RL = 5.4, ra = Math.atan2(DECK, RL - 0.3);
    const ramp = add(new THREE.BoxGeometry(1.0, 0.1, RL), raw, 0.6, DECK / 2 + 0.02, 1.4 + RL / 2 * Math.cos(ra), ra, 0, 0);
    for (const sx of [0.1, 1.1]) add(new THREE.BoxGeometry(0.06, 0.06, RL), trim, sx, DECK / 2 + 0.85, 1.4 + RL / 2 * Math.cos(ra), ra, 0, 0);
    for (let i = 1; i < 4; i++) for (const sx of [0.1, 1.1]) { const zz = 1.4 + i / 4 * RL * Math.cos(ra); add(new THREE.BoxGeometry(0.06, 0.9, 0.06), trim, sx, DECK * (1 - i / 4) + 0.45, zz); }
    // rescue buoy on the rail, a rescue board leaning on a leg, a flagpole with a red flag
    add(new THREE.TorusGeometry(0.28, 0.08, 10, 24), new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5 }), 0.9, DECK + 0.55, -2.0);
    const board = add(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: 0xf2c23a, roughness: 0.35 }), -1.55, 1.05, -1.0, 0.0, 0, 0.22);
    board.scale.set(0.05, 1.3, 0.28);
    add(new THREE.CylinderGeometry(0.03, 0.04, 3.2, 8), trim, 1.0, DECK + CH + 1.4, 0.6);
    const flagGeo = new THREE.PlaneGeometry(1.1, 0.7, 12, 4); flagGeo.translate(0.55, 0, 0);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xd8261c, side: THREE.DoubleSide, roughness: 0.7 }));
    flag.position.set(1.03, DECK + CH + 2.6, 0.6); flag.castShadow = true; tower.add(flag); tower.userData.flag = flag;
    tower.userData.flagBase = Float32Array.from(flagGeo.attributes.position.array);
  }
  tower.position.copy(towerSpot); tower.rotation.y = 0.12; scene.add(tower);

  // ---------------------------------------------------------------- beach things: umbrellas, towels, chairs, a cooler, a surfboard
  const umbrellas = [];
  const slopeA = Math.atan(0.035);
  function towel(x, z, ry, cols) {
    const g = new THREE.Group(); g.position.set(x, groundY(x, z) + 0.012, z); g.rotation.x = -slopeA;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), new THREE.MeshStandardMaterial({ map: stripeTex(cols, 9), roughness: 0.95 }));
    m.rotation.set(-PI / 2, 0, ry); m.receiveShadow = true; g.add(m); scene.add(g);
  }
  function umbrella(x, z, cols, tilt) {
    const g = new THREE.Group(); g.position.set(x, groundY(x, z) - 0.25, z); g.rotation.set(tilt, rr(0, 6), tilt * 0.6);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.4, metalness: 0.3 }));
    pole.position.y = 1.3; pole.castShadow = true; g.add(pole);
    const cm = new THREE.MeshStandardMaterial({ map: stripeTex(cols, 8, true), side: THREE.DoubleSide, roughness: 0.8 });
    const can = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.5, 16, 1, true), cm); can.position.y = 2.45; can.castShadow = true; g.add(can);
    scene.add(g); umbrellas.push(g);
  }
  umbrella(-30, 15, ["#f4efe4", "#e0483c"], 0.08); umbrella(-24.5, 18, ["#f4efe4", "#2f78b8"], -0.06); umbrella(31, 14, ["#f2d64a", "#f4efe4"], 0.1);
  towel(-29.5, 13.5, 0.2, ["#2f78b8", "#f4efe4", "#f2a33a"]); towel(-27.8, 13.9, 0.1, ["#d94a6a", "#f6dfe5"]); towel(-24, 16.4, -0.3, ["#3aa38a", "#f4efe4"]);
  towel(30.5, 12.6, 0.15, ["#f08a3c", "#3f4f9a", "#f4efe4"]);
  const chairMat = new THREE.MeshStandardMaterial({ map: stripeTex(["#2f78b8", "#f4efe4"], 6, true), side: THREE.DoubleSide, roughness: 0.85 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x9b7a52, roughness: 0.7 });
  for (const [x, z, ry] of [[-31.5, 16.2, -0.3], [32.4, 15.4, 0.4]]) {
    const g = new THREE.Group(); g.position.set(x, groundY(x, z), z); g.rotation.y = PI + ry;
    const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.9), chairMat); seat.position.set(0, 0.32, 0.05); seat.rotation.x = -PI / 2 + 0.25; g.add(seat);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), chairMat); back.position.set(0, 0.62, 0.55); back.rotation.x = -0.45; g.add(back);
    for (const sx of [-0.29, 0.29]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.05), frameMat); a.position.set(sx, 0.25, 0.15); a.rotation.x = 0.4; g.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.95), frameMat); b.position.set(sx, 0.28, 0.2); b.rotation.x = -0.55; g.add(b);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.95, 0.03), frameMat); c.position.set(sx, 0.55, 0.62); c.rotation.x = -0.45; g.add(c);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g);
  }
  { const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.4 }));
    c.position.set(-26.4, groundY(-26.4, 15.2) + 0.2, 15.2); c.rotation.y = 0.4; c.castShadow = true; scene.add(c);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.42), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4 })); lid.position.y = 0.23; c.add(lid);
    const sb = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: 0x3fb7c9, roughness: 0.3 }));
    sb.scale.set(0.27, 1.05, 0.04); sb.position.set(16.5, groundY(16.5, 21) + 0.75, 21); sb.rotation.set(0.12, 0.5, 0.08); sb.castShadow = true; scene.add(sb); }

  // ---------------------------------------------------------------- the far distance: sailboats, gulls
  const boats = [];
  for (const [x, z, s] of [[-420, -760, 1], [260, -1350, 1.4], [900, -1900, 1.8]]) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 9), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.4 })); hull.position.y = 0.4; g.add(hull);
    const sailGeo = new THREE.BufferGeometry(); sailGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 1, -2.5, 0, 12, 0.4, 0, 1, 3.2], 3)); sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ color: 0xfaf8f2, side: THREE.DoubleSide, roughness: 0.6 })); g.add(sail);
    g.scale.setScalar(s); g.position.set(x, 0, z); g.rotation.y = rr(0, 6); scene.add(g); boats.push({ g, x, ph: rr(0, 6) });
  }
  const gullMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, side: THREE.DoubleSide, roughness: 0.8 });
  const wing = new THREE.BufferGeometry(); wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.14, 0.75, 0, -0.08], 3)); wing.computeVertexNormals();
  const gulls = Array.from({ length: 6 }, (_, i) => {
    const g = new THREE.Group(), L = new THREE.Mesh(wing, gullMat), R = new THREE.Mesh(wing, gullMat); R.scale.x = -1;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), gullMat); body.scale.set(1, 0.8, 2.6); g.add(L, R, body); scene.add(g);
    return { g, L, R, cx: rr(-60, 60), cz: rr(-30, 15), r: rr(12, 30), y: rr(12, 26), w: rr(0.12, 0.22) * (i % 2 ? 1 : -1), ph: rr(0, 6) };
  });

  // ---------------------------------------------------------------- people
  const castMap = {}; figs.forEach((f) => { castMap[f.id] = f; f.object.traverse((o) => { if (o.isMesh) o.receiveShadow = true; }); scene.add(f.object); });
  const lead = castMap[cast[0]];
  const walkZ = 3.2, spot = new V3(-14, groundY(-14, walkZ), walkZ);
  const extraList = others.map((o, i) => { const f = extraFigs[i]; scene.add(f.object); return { ...o, f }; });

  // ---------------------------------------------------------------- update
  const _c = new V3();
  function place(f, x, z, heading, t, gait) {
    f.object.position.set(x, groundY(x, z), z); f.object.rotation.y = heading;
    const w = gait || { walk: 0 }, idle = Math.max(0, 1 - (w.walk || 0) - (w.run || 0));
    f.pose(t, { idle, walk: w.walk || 0, run: w.run || 0 });
  }
  function update(st = {}) {
    const T = st.time ?? 0;
    seaU.time.value = T; swashMat.uniforms.time.value = T;
    const people = st.people || {};
    for (const id of castIds) {
      const f = castMap[id], p = people[id];
      if (p) { f.object.visible = p.show !== false; place(f, p.x ?? spot.x, p.z ?? walkZ, p.heading ?? PI / 2, p.time ?? T, p.gait || { walk: 0 }); }
      else if (id === cast[0]) { f.object.visible = true; place(f, spot.x + gaitSpeed[id].walk * T, walkZ, PI / 2, T, { walk: 1 }); }
      else f.object.visible = false;
    }
    for (const e of extraList) {
      e.f.object.visible = st.extras !== false;
      if (st.extras === false) continue;
      const tt = T + e.t0 * 10;
      place(e.f, e.x + e.dir * gaitSpeed[e.id].walk * tt, e.z, e.dir > 0 ? PI / 2 : -PI / 2, tt + e.t0, { walk: 1 });
    }
    for (const p of palms) { p.group.rotation.x = p.amp * Math.sin(T * 0.8 + p.phase); p.group.rotation.z = p.amp * 0.7 * Math.sin(T * 0.63 + p.phase * 1.3); }
    { const f = tower.userData.flag, b = tower.userData.flagBase, a = f.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) { const x = b[i * 3]; a.setZ(i, Math.sin(x * 4.2 - T * 7) * 0.09 * x + Math.sin(x * 2 - T * 3.1) * 0.05 * x); a.setY(i, b[i * 3 + 1] - x * 0.06); }
      a.needsUpdate = true; f.geometry.computeVertexNormals(); }
    for (const b of boats) { b.g.position.x = b.x + T * 1.2; b.g.position.y = 0.1 * Math.sin(T * 0.9 + b.ph); b.g.rotation.z = 0.03 * Math.sin(T * 0.7 + b.ph); }
    for (const g of gulls) {
      const a = g.ph + g.w * T; g.g.position.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(T * 0.5 + g.ph), g.cz + Math.sin(a) * g.r);
      g.g.rotation.set(0, -a + (g.w > 0 ? 0 : PI), Math.sign(g.w) * 0.25);
      const fl = 0.35 * Math.sin(T * 5.5 + g.ph * 3); g.L.rotation.z = fl; g.R.rotation.z = -fl;
    }
    // shadows follow the focus
    const fo = st.focus ? _c.set(st.focus.x, st.focus.y ?? 0, st.focus.z) : _c.copy(lead ? lead.object.position : spot);
    const R = st.shadowRadius ?? Math.min(170, Math.max(18, camera.position.distanceTo(fo) * 1.2));
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 1500 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(fo); sun.position.copy(fo).addScaledVector(sunDir, 700); sun.target.updateMatrixWorld();
  }
  update({});
  const render = () => renderer.render(scene, camera);
  return {
    renderer, scene, camera, update, render, cast: castMap, person: lead && lead.object, subject: lead && lead.object,
    gaitSpeed, spot, walkZ, shoreZ, groundY, sun, sunDir, tower, towerSpot, palms, rocks, umbrellas, extras: extraList,
  };
}
