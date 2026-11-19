// World "city-night": a big-city downtown avenue at night, just after rain.
// Tall towers with lit windows (some topped by lit crowns and red aviation lights), shopfronts glowing at street
// level with neon fascia signs, blade signs and big LED billboards, wet asphalt that mirrors every light (puddles
// sharper than the rest), street lamps, traffic signals, parked cars and two-way traffic with headlights, a striped
// steam stack and a manhole breathing steam, people walking both pavements. No story: the place itself.
//
// Axes (metres): +x is EAST along the avenue, +y up, +z SOUTH. The avenue runs along x: road z -8..8 (two lanes
// each way: eastbound at z = +1.6 and +4.5, westbound at z = -1.6 and -4.5; parking lanes at z = +-6.9), pavements
// 6 m wide (z 8..14 near, -14..-8 far), pavement top y = PAVE = 0.15, shopfronts at z = +-14. Cross streets 14 m
// wide at x = XC (-400, -290, -180, -70, 40, 150, 260, 370) with crosswalks and signals. Parallel streets at
// z = +-(70..84). Detailed for |x| < 450; towers continue down the avenue to |x| ~ 1400 and fade into haze.
// The NEAR pavement (+z) is the subject's: default walking line z = SUBJECT_Z = 10.4 (kerb furniture stays at
// z <= 9.3, crowd walks at z >= 12.4, so the line is always clear). On the near side there are no parked cars for
// x in [-48, 30], so a camera can stand in the parking lane (z 6..8) and track the subject side on from 2.5..5 m.
// Near-side lamps stand at x = 14 + 28k (z = 8.6), far-side at x = 28k (z = -8.6).
// Good cameras: wide (-46, 9, 1) looking at (0, 4, 8); mid (x, 1.5, 6.4) looking +z at the subject; close
// (x + 1.2, 1.6, 8.5) with render({blur: 1}); high (x, 90, 30) looking down at (x, 0, 0).
//
// createWorld({THREE, canvas, K, loaders, cast = ["woman"], crowd = true}) -> world. Per frame: set world.camera
// (position, lookAt, fov; call updateProjectionMatrix), call world.update(state), then world.render(opts).
// world.render must be used (not renderer.render): it draws the wet-road reflection, bloom and depth of field.
//
// state (every field optional):
//   time        seconds of the shot: drives traffic, steam, billboards, crowd and the default animation clocks
//   people      {<cast id>: {x, z, heading, time, gait: {walk, run}, show}}. z defaults to SUBJECT_Z, y is the
//               ground there (pavement or road). heading radians about +y, 0 faces +z, PI/2 faces east (default).
//               gait weights 0..1 (idle gets the rest); move x by world.gaitSpeed[id].walk * walk (m/s) so feet
//               never slide. time = that person's animation clock (default state.time). show false hides.
//               Cast members not named are hidden. With no people at all the first cast member idles at SPOT.
//   traffic     0..2 multiplier of traffic speed (default 1; 0 freezes the cars where they are)
//   crowd       false hides the pedestrians on the pavements (default true)
//   signal      0 = avenue green (default: traffic flows), 1 = avenue red / cross street green (cars should then
//               be frozen with traffic 0)
//   haze        multiplier of the haze density (default 1; 0.6 for a high view)
//   wind        0..1 how far the steam leans east (default 0.25)
//   focus       {x, y, z} centre of the shadow box and of the lamp lights (default: first visible person, else
//               the point 30 m in front of the camera)
//   shadowRadius metres of the shadow box (default from the camera's distance)
// render(opts): opts.blur 0..1 depth of field (0 none, 1 strong; for the close shot), opts.focusDistance metres
//               (default: camera to the subject's chest), opts.bloom multiplier of the glow (default 1),
//               opts.exposure (default 1.0).
//
// Exposes: world.cast.<id> (loadFigure results), world.person (first cast member's object), world.gaitSpeed[id]
// {walk, run} m/s, world.SPOT (Vector3, x = 0 on the subject's line), world.SUBJECT_Z, world.groundY(x, z),
// world.PAVE, world.KERB_Z (8), world.FRONT_Z (14), world.XC (cross street centres), world.LANES {east, west},
// world.lamps (array of Vector3 lamp heads), world.signs (array of {pos, color} neon signs), world.cars (moving
// cars: {object, lane, dir}), world.carAt(i, time) -> x, world.steam (Vector3 of the stack), world.moon (the
// DirectionalLight casting shadows), world.fill (the PointLight spill that keeps the subject readable).
import { loadFigure } from "../lib/figure.js";

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {}, cast = ["woman"], crowd = true }) {
  const V3 = THREE.Vector3, PI = Math.PI;
  const W = canvas.width || 1920, H = canvas.height || 1080;
  const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
  const SkeletonUtils = await import("three/addons/utils/SkeletonUtils.js");
  const { GLTFLoader } = loaders.GLTFLoader ? loaders : await import("three/addons/loaders/GLTFLoader.js");

  // ---------------------------------------------------------------- renderer, camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 4000);
  camera.layers.enable(2);
  camera.position.set(-46, 9, 1); camera.lookAt(0, 4, 8);

  // ---------------------------------------------------------------- deterministic random
  let seed = 7310;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- layout
  const PAVE = 0.15, KERB_Z = 8, FRONT_Z = 14, SUBJECT_Z = 10.4;
  const XC = [-400, -290, -180, -70, 40, 150, 260, 370], XH = 7;
  const LANES = { east: [1.6, 4.5], west: [-1.6, -4.5] };
  const inCross = (x) => XC.some((c) => Math.abs(x - c) < XH);
  const groundY = (x, z) => {
    const az = Math.abs(z);
    if (az < KERB_Z) return 0;
    if (az > 70 && az < 84) return 0;
    if (Math.abs(x) < 450 && inCross(x)) return 0;
    return PAVE;
  };

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
  const extraIds = crowd ? ["man", "woman"] : [];
  const [BRICK, ASPH, CONC, ROCK, ...figs] = await Promise.all([
    pbrSet("brick"), pbrSet("asphalt"), pbrSet("concrete"), pbrSet("rock"),
    ...cast.map((id) => loadFigure({ THREE, id, clips: ["idle", "walk", "run"] })),
    ...extraIds.map((id) => loadFigure({ THREE, id, clips: ["walk", "idle"] })),
  ]);
  const castFigs = figs.slice(0, cast.length), extraFigs = figs.slice(cast.length);

  async function clipSpeed(id, name, fallback) {
    try {
      const meta = await (await fetch(`${LIB}characters/${id}/character.json`)).json();
      const src = meta.clips[name]; if (!src || src.startsWith("@")) return fallback;
      const g = await new GLTFLoader().loadAsync(`${LIB}characters/${id}/${src}`);
      const c = g.animations[0]; const tr = c.tracks.find((t) => /hips\.position$/i.test(t.name)); if (!tr) return fallback;
      const v = tr.values, n = v.length / 3, dist = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]);
      const hipH = Math.abs(v[1]) || 1, s = dist / hipH * 0.98 * (meta.height || 1.75) / 1.72;
      const sp = s / (tr.times[n - 1] - tr.times[0]);
      return sp > 0.3 && sp < 12 ? sp : fallback;
    } catch (e) { return fallback; }
  }
  const gaitSpeed = {};
  await Promise.all([...new Set([...cast, ...extraIds])].map(async (id) => {
    gaitSpeed[id] = { walk: await clipSpeed(id, "walk", 1.35), run: await clipSpeed(id, "run", 4.8) };
  }));

  // ---------------------------------------------------------------- canvas helpers
  const canvasTex = (w, h, fn, srgb = true) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  };
  const radial = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const smoke = canvasTex(128, 128, (g) => {
    for (let i = 0; i < 26; i++) {
      const x = 64 + rr(-26, 26), y = 64 + rr(-26, 26), r = rr(16, 40);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.22)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  });
  // puddles: soft blobs on a tile that wraps
  const puddleTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, rx = rr(10, 70), ry = rx * rr(0.35, 1);
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rx);
        gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.6, "rgba(255,255,255,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.save(); g.translate(x + ox, y + oy); g.scale(1, ry / rx); g.translate(-(x + ox), -(y + oy));
        g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rx, 0, 7); g.fill(); g.restore();
      }
    }
  }, false);
  puddleTex.wrapS = puddleTex.wrapT = THREE.RepeatWrapping;

  // ---------------------------------------------------------------- the night sky (lit from below by the city)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
    fragmentShader: `
      varying vec3 vDir; uniform float time;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zen = vec3(0.006, 0.010, 0.030), mid = vec3(0.030, 0.034, 0.080), hor = vec3(0.20, 0.12, 0.13);
        float g = exp(-max(h, 0.0) * 7.0);
        vec3 col = mix(mix(zen, mid, exp(-max(h, 0.0) * 2.2)), hor, g);
        vec2 cp = d.xz / max(h + 0.12, 0.05) * 1.3 + vec2(time * 0.004, 0.0);
        float c = smoothstep(0.42, 0.82, fbm(cp));
        vec3 cloud = vec3(0.13, 0.085, 0.09) * (0.45 + 1.4 * g);
        col = mix(col, cloud, c * smoothstep(-0.02, 0.12, h) * 0.85);
        float st = step(0.9985, h21(floor(d.xz / max(h, 0.1) * 300.0))) * smoothstep(0.35, 0.8, h) * (1.0 - c);
        col += vec3(st) * 0.25;
        if (h < 0.0) col = hor * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const HAZE = new THREE.Color(0.075, 0.058, 0.075);
  scene.fog = new THREE.FogExp2(HAZE, 0.0032);

  // environment for reflections (glass, car paint): the sky plus a ring of lit windows and neon
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat); env.add(s2);
    const cols = [[1.6, 1.1, 0.6], [1.2, 1.25, 1.4], [3, 0.4, 1.4], [0.3, 2, 2.6], [2.4, 1.4, 0.4]];
    for (let i = 0; i < 90; i++) {
      const a = rnd() * PI * 2, r = 40, y = rr(-4, 22), c = pick(cols), k = rr(0.25, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(rr(1, 5), rr(0.6, 4)), new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0] * k, c[1] * k, c[2] * k), side: THREE.DoubleSide }));
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r); m.lookAt(0, y, 0); env.add(m);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x0a0909 })); floor.rotation.x = -PI / 2; floor.position.y = -6; env.add(floor);
    scene.environment = pm.fromScene(env, 0.03).texture;
    scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0x4a5a88, 0x3a2a20, 0.9); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xa8bce8, 0.55);
  moon.castShadow = true; moon.shadow.mapSize.set(4096, 4096); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target);
  const moonDir = new V3(-0.35, 0.82, 0.45).normalize();
  const fill = new THREE.PointLight(0xf0e6ff, 4, 9, 2); scene.add(fill);

  // ---------------------------------------------------------------- the wet-road reflection (a planar mirror at y = 0)
  const RW = Math.round(W / 2), RH = Math.round(H / 2);
  const reflRT = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType });
  const mirrorCam = new THREE.PerspectiveCamera();
  const REFL = { tex: { value: reflRT.texture }, mat: { value: new THREE.Matrix4() } };
  const wetMats = [];
  function wetify(mat, wet) {
    mat.userData.wet = true; wetMats.push(mat);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tRefl = REFL.tex; sh.uniforms.reflMat = REFL.mat; sh.uniforms.tPud = { value: puddleTex };
      sh.uniforms.wetK = { value: wet }; sh.uniforms.rpx = { value: new THREE.Vector2(1 / RW, 1 / RH) };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform mat4 reflMat; varying vec4 vRefl; varying vec3 vWp;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvec4 wp4 = modelMatrix * vec4(transformed, 1.0); vWp = wp4.xyz; vRefl = reflMat * wp4;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D tRefl; uniform sampler2D tPud; uniform float wetK; uniform vec2 rpx; varying vec4 vRefl; varying vec3 vWp; float pud;")
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
          pud = smoothstep(0.35, 0.75, texture2D(tPud, vWp.xz / 41.0).r) * wetK;
          roughnessFactor = mix(roughnessFactor * 0.6, 0.05, pud);`)
        .replace("#include <opaque_fragment>", `{
          vec2 ruv = vRefl.xy / vRefl.w + normal.xy * mix(0.018, 0.004, pud);
          float sp = mix(4.0, 0.8, pud);
          vec3 rc = vec3(0.0); float ws = 0.0;
          for (int i = -4; i <= 4; i++) { float fi = float(i); float w = 1.0 - abs(fi) / 5.0;
            rc += texture2D(tRefl, ruv + vec2(fi * 0.3 * sp * rpx.x, fi * sp * 1.8 * rpx.y)).rgb * w; ws += w; }
          rc /= ws;
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float F = 0.03 + 0.97 * pow(1.0 - nv, 5.0);
          F = mix(F * 0.55, max(F, 0.32), pud) * wetK;
          outgoingLight = outgoingLight * (1.0 - F * 0.7) + rc * F;
        }
        #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => "wet" + wet;
    return mat;
  }
  function updateMirror() {
    camera.updateMatrixWorld();
    mirrorCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const fwd = new V3(0, 0, -1).applyMatrix4(rot), up = new V3(0, 1, 0).applyMatrix4(rot);
    fwd.y = -fwd.y; up.y = -up.y;
    mirrorCam.up.copy(up);
    mirrorCam.lookAt(mirrorCam.position.clone().add(fwd));
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    mirrorCam.layers.set(0);
    REFL.mat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
  }

  // ---------------------------------------------------------------- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const surf = (set, color, extra = {}) => std({ ...set, color, ...extra });
  const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
  const M = {
    asphalt: wetify(surf(ASPH, 0x5a5a5e, { roughness: 0.85 }), 1.0),
    pave: wetify(surf(CONC, 0x8e8a86, { roughness: 0.9 }), 0.55),
    kerb: surf(ROCK, 0x6d6a66),
    brick: [surf(BRICK, 0x9c7a6c), surf(BRICK, 0x7a5a50), surf(BRICK, 0xb59a88)],
    stone: [surf(CONC, 0xb8ad98), surf(CONC, 0x8f8a82), surf(CONC, 0xa59a8a), surf(CONC, 0x6e6c6a)],
    roof: surf(CONC, 0x77716a, { roughness: 1 }),
    joint: std({ color: 0x3a3836, roughness: 0.9 }),
    trim: std({ color: 0x1c1c1e, roughness: 0.45, metalness: 0.6 }),
    trimL: std({ color: 0x8a847a, roughness: 0.6 }),
    pole: std({ color: 0x26292c, roughness: 0.4, metalness: 0.7 }),
    paint: wetify(std({ color: 0xbdbcb6, roughness: 0.6 }), 0.7),
    yellow: wetify(std({ color: 0xc9a12a, roughness: 0.6 }), 0.7),
    iron: std({ color: 0x18181a, roughness: 0.5, metalness: 0.7 }),
    awn: [std({ color: 0x5a1418, roughness: 0.9 }), std({ color: 0x143a2a, roughness: 0.9 }), std({ color: 0x15203a, roughness: 0.9 }), std({ color: 0x222222, roughness: 0.9 })],
    hydrant: std({ color: 0xa0221a, roughness: 0.5 }),
    darkGlass: std({ color: 0x0b0f15, roughness: 0.05, metalness: 0.9 }),
    lampLens: glow(9, 7.2, 4.6),
    red: glow(6, 0.25, 0.12), redDim: glow(0.35, 0.02, 0.01),
    green: glow(0.3, 5, 2.2), greenDim: glow(0.01, 0.12, 0.06), amberDim: glow(0.2, 0.1, 0.0),
    beacon: glow(8, 0.3, 0.15),
  };

  // window textures: a 16 x 16 grid of window cells, some lit (warm homes, cool offices), on the facade colour
  function windowTextures(style) {
    const S = 512, N = 16, c = S / N;
    const cc = document.createElement("canvas"); cc.width = cc.height = S; const g = cc.getContext("2d");
    const ec = document.createElement("canvas"); ec.width = ec.height = S; const e = ec.getContext("2d");
    g.fillStyle = style.wall; g.fillRect(0, 0, S, S); e.fillStyle = "#000"; e.fillRect(0, 0, S, S);
    const warm = ["#ffcf8a", "#ffd9a0", "#ffc27a", "#f5b46a"], cool = ["#dfe9ff", "#cfdcf2", "#eef2ff"], tv = ["#7aa0ff"];
    for (let r = 0; r < N; r++) {
      const office = rnd() < style.office;
      let run = 0, lit = false, col = null;
      for (let k = 0; k < N; k++) {
        if (run <= 0) { run = office ? Math.floor(rr(3, 10)) : Math.floor(rr(1, 4)); lit = rnd() < style.lit; col = office ? pick(cool) : (rnd() < 0.05 ? tv[0] : pick(warm)); }
        run--;
        const x = k * c, y = r * c;
        const [wx, wy, ww, wh] = style.ribbon ? [x + 1.5, y + 7, c - 3, c - 11] : [x + 7, y + 5, c - 14, c - 9];
        if (lit) {
          const b = rr(0.55, 1);
          const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, col); gr.addColorStop(1, "#5a4630");
          g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
          e.globalAlpha = b; e.fillStyle = gr; e.fillRect(wx, wy, ww, wh);
          if (!office && rnd() < 0.35) { g.fillStyle = "rgba(40,25,15,0.6)"; g.fillRect(wx, wy, ww * rr(0.2, 0.5), wh); e.fillStyle = "rgba(0,0,0,0.7)"; e.fillRect(wx, wy, ww * 0.35, wh); }
          if (office && rnd() < 0.5) { e.fillStyle = "rgba(0,0,0,0.45)"; for (let q = 0; q < 3; q++) e.fillRect(wx, wy + q * wh / 3, ww, 1.2); }
        } else {
          const v = Math.floor(rr(10, 24));
          g.fillStyle = `rgb(${v},${v + 3},${v + 9})`; g.fillRect(wx, wy, ww, wh);
          if (rnd() < 0.08) { e.globalAlpha = 0.25; e.fillStyle = pick(warm); e.fillRect(wx, wy, ww, wh); }
        }
        e.globalAlpha = 1;
      }
    }
    const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
    const em = mk(ec, true);
    return std({ map: mk(cc, true), emissiveMap: em, emissive: 0xffffff, emissiveIntensity: style.glow || 1.7, roughness: style.ribbon ? 0.18 : 0.6, metalness: style.ribbon ? 0.55 : 0.1 });
  }
  const TOWER = [
    windowTextures({ wall: "#1a1e24", ribbon: true, office: 0.85, lit: 0.42 }),
    windowTextures({ wall: "#2b2a28", ribbon: true, office: 0.7, lit: 0.36 }),
    windowTextures({ wall: "#4a453e", ribbon: false, office: 0.2, lit: 0.4 }),
    windowTextures({ wall: "#3a3631", ribbon: false, office: 0.1, lit: 0.33 }),
    windowTextures({ wall: "#14181e", ribbon: true, office: 0.95, lit: 0.55 }),
  ];
  const CELL_W = 1.6, CELL_H = 3.6, TEX_W = 16 * CELL_W, TEX_H = 16 * CELL_H;

  // a room behind a lit window (for podium windows near the street)
  const roomMats = ["#ffcf8a", "#ffe0b0", "#dfe8ff", "#ffbf78"].map((col) => {
    const t = canvasTex(64, 96, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col); gr.addColorStop(0.7, "#7a5a3a"); gr.addColorStop(1, "#2a1e14");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      if (rnd() < 0.6) { g.fillStyle = "rgba(30,20,12,0.85)"; g.fillRect(0, 0, w * rr(0.15, 0.4), h); }
      g.fillStyle = "rgba(20,14,10,0.6)"; g.fillRect(w * 0.2, h * 0.62, w * 0.5, h * 0.1);
      g.fillStyle = "#222"; g.fillRect(w / 2 - 1, 0, 2, h); g.fillRect(0, h * 0.45, w, 2);
    });
    return std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.2 });
  });

  // ---------------------------------------------------------------- static batching
  const bins = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();
  const mat4 = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(sx, sy, sz)).clone();
  function put(geo, mat, m4, cast = true, recv = true, layer = 0) {
    let g = geo.clone(); if (m4) g.applyMatrix4(m4);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    const key = mat.uuid + (cast ? "c" : "") + (recv ? "r" : "") + layer;
    if (!bins.has(key)) bins.set(key, { mat, cast, recv, layer, list: [] });
    bins.get(key).list.push(g);
  }
  const wetMeshes = [];
  function flush() {
    for (const b of bins.values()) {
      for (let i = 0; i < b.list.length; i += 3000) {
        const g = mergeGeometries(b.list.slice(i, i + 3000), false);
        const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
        mesh.matrixAutoUpdate = false; mesh.layers.set(b.layer); scene.add(mesh);
        if (b.mat.userData.wet) wetMeshes.push(mesh);
      }
    }
    bins.clear();
  }
  // a box whose UVs are in tiles of (tu x tv) metres
  function box(w, h, d, tu = 0, tv = tu, ou = 0, ov = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tu) {
      const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k; uv.setXY(i, ou + uv.getX(i) * dims[f][0] / tu, ov + uv.getY(i) * dims[f][1] / tv);
      }
    }
    return g;
  }
  const UNIT = new THREE.BoxGeometry(1, 1, 1), UNITP = new THREE.PlaneGeometry(1, 1);
  const putBox = (mat, x, y, z, w, h, d, ry = 0, cast = true) => put(UNIT, mat, mat4(x, y, z, ry, 0, 0, w, h, d), cast);
  const decalMats = new Map();
  function decal(x, y, z, sx, sz, color, opacity, ry = 0) {
    const key = color + "/" + opacity;
    if (!decalMats.has(key)) decalMats.set(key, new THREE.MeshBasicMaterial({ map: radial, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    put(UNITP, decalMats.get(key), mat4(x, y, z, ry, -PI / 2, 0, sx, sz, 1), false, false, 2);
  }

  // ---------------------------------------------------------------- ground: one wet asphalt floor, raised pavements
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), M.asphalt);
  { const uv = ground.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1500, uv.getY(i) * 1500); }
  ground.rotation.x = -PI / 2; ground.receiveShadow = true; scene.add(ground); wetMeshes.push(ground);
  const blocks = [];
  const XB = [-1500, ...XC.flatMap((c) => [c - XH, c + XH]), 1500];
  for (let i = 0; i < XB.length; i += 2) {
    const xa = XB[i], xb = XB[i + 1];
    for (const sz of [1, -1]) for (const [za, zb] of [[KERB_Z, 70], [84, 160]]) {
      const z0 = sz > 0 ? za : -zb, z1 = sz > 0 ? zb : -za;
      put(box(xb - xa, PAVE, z1 - z0, 2.4), M.pave, mat4((xa + xb) / 2, PAVE / 2, (z0 + z1) / 2), false);
      if (Math.abs(xa + xb) < 1000) {
        for (const zk of [z0 + 0.15, z1 - 0.15]) put(box(xb - xa, PAVE + 0.01, 0.3, 1.2), M.kerb, mat4((xa + xb) / 2, (PAVE + 0.01) / 2, zk), false);
        for (const xk of [xa + 0.15, xb - 0.15]) put(box(0.3, PAVE + 0.01, z1 - z0, 1.2), M.kerb, mat4(xk, (PAVE + 0.01) / 2, (z0 + z1) / 2), false);
      }
      blocks.push({ xa, xb, z0, z1, sz, inner: za === KERB_Z });
    }
  }
  // pavement joints near the action
  for (const sz of [1, -1]) for (let x = -300; x < 300; x += 1.5) {
    if (inCross(x)) continue;
    put(UNITP, M.joint, mat4(x, PAVE + 0.003, sz * 11, 0, -PI / 2, 0, 0.012, 5.8, 1), false);
  }

  // ---------------------------------------------------------------- road markings
  const mark = (x, z, w, d, m = M.paint) => put(UNITP, m, mat4(x, 0.006, z, 0, -PI / 2, 0, w, d, 1), false);
  for (let x = -1200; x < 1200; x += 3) {
    if (Math.abs(x) < 450 && XC.some((c) => Math.abs(x - c) < 12)) continue;
    mark(x, 0.12, 3, 0.1, M.yellow); mark(x, -0.12, 3, 0.1, M.yellow);
  }
  for (let x = -1200; x < 1200; x += 9) {
    if (Math.abs(x) < 450 && XC.some((c) => Math.abs(x - c) < 12)) continue;
    for (const z of [3.05, -3.05]) mark(x, z, 3, 0.12);
    for (const z of [6.0, -6.0]) mark(x, z, 9, 0.1);
  }
  for (const xc of XC) {
    for (const xs of [xc - 9.5, xc + 9.5]) for (let k = 0; k < 13; k++) mark(xs, -7.2 + k * 1.2, 3.2, 0.6);
    for (const zs of [11, -11]) for (let k = 0; k < 11; k++) mark(xc - 6 + k * 1.2, zs, 0.6, 3.2);
    mark(xc - 11.8, 3.05, 0.45, 6.0); mark(xc + 11.8, -3.05, 0.45, 6.0);
  }

  // ---------------------------------------------------------------- shop signs (neon)
  const NEON = ["#ff2d95", "#22e5ff", "#ffb020", "#ff3b30", "#47ff7a", "#b46bff", "#fff1d8", "#ff6a1a"];
  const WORDS = ["NOODLES", "BAR", "HOTEL", "PHARMACY", "PIZZA", "CAFE", "24 HR", "DELI", "SUSHI", "LIQUOR", "OPEN",
    "CINEMA", "BOOKS", "DINER", "RAMEN", "FLOWERS", "LAUNDRY", "TACOS", "KARAOKE", "BAKERY", "GROCERY", "JAZZ", "PAWN", "MARKET"];
  const signCache = new Map();
  function signMat(word, col, vertical) {
    const key = word + col + vertical;
    if (signCache.has(key)) return signCache.get(key);
    const w = vertical ? 128 : 512, h = vertical ? 512 : 128;
    const t = canvasTex(w, h, (g) => {
      g.fillStyle = "#08070a"; g.fillRect(0, 0, w, h);
      g.strokeStyle = col; g.lineWidth = 4; g.shadowColor = col; g.shadowBlur = 14; g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      if (vertical) {
        const L = word.replace(/ /g, "").split(""); const fs = Math.min(70, 440 / L.length);
        g.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
        for (let pass = 0; pass < 2; pass++) { g.shadowBlur = pass ? 6 : 26; g.fillStyle = pass ? "#fff" : col; L.forEach((ch, i) => g.fillText(ch, 64, 40 + (i + 0.5) * (430 / L.length))); }
      } else {
        const fs = Math.min(84, 820 / word.length);
        g.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
        for (let pass = 0; pass < 2; pass++) { g.shadowBlur = pass ? 6 : 28; g.fillStyle = pass ? "#fff" : col; g.fillText(word, w / 2, h / 2 + 4); }
      }
    });
    const m = std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 3.2, roughness: 0.4 });
    signCache.set(key, m); return m;
  }
  // shop interiors: a warm room with shelves
  // shop interiors of four kinds: shelves (grocery, deli), clothes on rails, a cafe with tables, a closed shutter
  const shopMats = [];
  const shopCols = ["#a89c8c", "#98a2a6", "#b2a690", "#8e9a92", "#a8968a"];
  for (let v = 0; v < 10; v++) {
    const kind = v % 5 === 4 ? 3 : v % 3, col = shopCols[v % shopCols.length];
    const t = canvasTex(512, 256, (g, w, h) => {
      if (kind === 3) {
        g.fillStyle = "#4a4c4e"; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 6) { g.fillStyle = y % 12 ? "#5c5e60" : "#34363a"; g.fillRect(0, y, w, 3); }
        for (let i = 0; i < 5; i++) { g.strokeStyle = `hsl(${rr(0, 360)},45%,${rr(35, 55)}%)`; g.lineWidth = rr(4, 10); g.beginPath(); g.moveTo(rr(0, w), rr(h * 0.3, h)); g.bezierCurveTo(rr(0, w), rr(0, h), rr(0, w), rr(0, h), rr(0, w), rr(h * 0.3, h)); g.stroke(); }
        return;
      }
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#2a2018"); gr.addColorStop(0.07, "#2a2018"); gr.addColorStop(0.08, col); gr.addColorStop(0.62, col); gr.addColorStop(0.8, "#4a3220"); gr.addColorStop(1, "#1c130c");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = "#221a14"; g.fillRect(0, 0, w, 16);
      for (let x = 20; x < w; x += rr(48, 70)) { g.fillStyle = "#fff4dc"; g.fillRect(x - 10, 7, 20, 4); }
      if (kind === 0) {
        let x = rr(0, 30);
        while (x < w - 40) {
          const uw = rr(70, 130), top = rr(60, 90), bot = h - 30, shelves = 4, sh = (bot - top) / shelves;
          g.fillStyle = "rgba(28,20,14,0.92)"; g.fillRect(x, top, uw, bot - top);
          for (let k = 0; k < shelves; k++) {
            const sy = top + (k + 1) * sh; let px = x + 3;
            while (px < x + uw - 8) { const pw = rr(5, 13), ph = rr(sh * 0.25, sh * 0.55); g.fillStyle = `hsl(${rr(0, 360)},${rr(15, 50)}%,${rr(30, 58)}%)`; g.fillRect(px, sy - ph - 2, pw, ph); px += pw + rr(0.5, 2); }
            g.fillStyle = "#a89880"; g.fillRect(x, sy - 2, uw, 2);
          }
          x += uw + rr(30, 90);
        }
      } else if (kind === 1) {
        for (let r = 0; r < 3; r++) {
          const rx = rr(10, w - 180), ry = rr(70, 100); g.fillStyle = "#c8c0b0"; g.fillRect(rx, ry, 170, 3);
          for (let px = rx + 4; px < rx + 165; px += rr(7, 12)) { g.fillStyle = `hsl(${rr(0, 360)},${rr(10, 45)}%,${rr(20, 60)}%)`; g.fillRect(px, ry + 3, rr(6, 10), rr(60, 95)); }
        }
        for (let i = 0; i < 2; i++) { const mx = rr(40, w - 40); g.fillStyle = "#1a1410"; g.beginPath(); g.arc(mx, 92, 9, 0, 7); g.fill(); g.fillRect(mx - 14, 102, 28, 70); g.fillRect(mx - 3, 172, 6, 60); }
      } else {
        for (let i = 0; i < 5; i++) { const x = rr(10, w - 60); g.strokeStyle = "#1a120c"; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 25, 16); g.lineTo(x + 25, 70); g.stroke(); g.fillStyle = "#1a120c"; g.beginPath(); g.moveTo(x + 13, 82); g.lineTo(x + 37, 82); g.lineTo(x + 30, 68); g.lineTo(x + 20, 68); g.fill(); g.fillStyle = "#ffe6b0"; g.fillRect(x + 16, 82, 18, 3); }
        for (let i = 0; i < 5; i++) { const x = rr(10, w - 70); g.fillStyle = "#1c140e"; g.fillRect(x, h * 0.66, 60, 6); g.fillRect(x + 27, h * 0.66, 6, h * 0.3); g.fillRect(x - 12, h * 0.72, 10, h * 0.28); g.fillRect(x + 62, h * 0.72, 10, h * 0.28); }
        g.fillStyle = "rgba(20,14,10,0.85)"; g.fillRect(0, h * 0.55, w * 0.25, h * 0.45);
      }
    });
    shopMats.push(kind === 3 ? std({ map: t, roughness: 0.5, metalness: 0.6 }) : std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.1 }));
  }
  const shopGlass = std({ color: 0x0c1014, roughness: 0.04, metalness: 1, transparent: true, opacity: 0.32, depthWrite: false });
  const signs = [], boards = [];

  // ---------------------------------------------------------------- buildings
  function towerBox(x0, x1, z0, z1, y0, y1, mat) {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0;
    const ou = Math.floor(rr(0, 16)) / 16, ov = Math.floor(rr(0, 16)) / 16 + (y0 % CELL_H) / TEX_H;
    put(box(w, h, d, TEX_W, TEX_H, ou, ov), mat, mat4((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    put(box(w + 0.3, 0.6, d + 0.3, 3), M.roof, mat4((x0 + x1) / 2, y1 + 0.1, (z0 + z1) / 2));
  }
  function roofStuff(x0, x1, z0, z1, y, tall) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    for (let k = 0; k < Math.floor(rr(1, 4)); k++) put(box(rr(2, 5), rr(1.2, 3), rr(2, 4), 2), M.stone[3], mat4(cx + rr(-w / 3, w / 3), y + 1, cz + rr(-d / 3, d / 3)));
    if (tall) {
      for (const [sx, sz] of [[-1, -1], [1, 1]]) put(new THREE.SphereGeometry(0.35, 8, 6), M.beacon, mat4(cx + sx * (w / 2 - 1), y + 1.0, cz + sz * (d / 2 - 1)), false, false);
      if (rnd() < 0.5) { // a lit crown
        const cm = glow(...pick([[2.2, 2.4, 3], [3, 2, 1], [0.6, 2.0, 3.0], [2.8, 1.0, 2.2]]));
        put(UNIT, cm, mat4(cx, y - 3, z0 - 0.05, 0, 0, 0, w * 0.98, 0.5, 0.1), false, false);
        put(UNIT, cm, mat4(cx, y - 3, z1 + 0.05, 0, 0, 0, w * 0.98, 0.5, 0.1), false, false);
        put(UNIT, cm, mat4(x0 - 0.05, y - 3, cz, 0, 0, 0, 0.1, 0.5, d * 0.98), false, false);
        put(UNIT, cm, mat4(x1 + 0.05, y - 3, cz, 0, 0, 0, 0.1, 0.5, d * 0.98), false, false);
        put(new THREE.CylinderGeometry(0.08, 0.2, 14, 6), M.pole, mat4(cx, y + 7, cz));
      }
    }
  }
  // the punched windows of a podium face, with rooms behind the lit ones
  function podiumWindows(x0, x1, zf, sz, y0, floors, detail) {
    const L = x1 - x0, cols = Math.max(1, Math.floor(L / 2.6)), pitch = L / cols, FL = 3.4;
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * pitch, y = y0 + f * FL + 1.7;
      const lit = rnd() < 0.38;
      put(UNITP, lit ? pick(roomMats) : M.darkGlass, mat4(x, y, zf + sz * 0.06, sz > 0 ? 0 : PI, 0, 0, 1.2, 1.9, 1), false, false);
      if (detail) {
        put(UNIT, M.trimL, mat4(x, y - 1.08, zf + sz * 0.1, 0, 0, 0, 1.55, 0.12, 0.2), false);
        put(UNIT, M.trimL, mat4(x, y + 1.1, zf + sz * 0.06, 0, 0, 0, 1.5, 0.22, 0.12), false);
      }
    }
  }
  function storefronts(x0, x1, zf, sz) {
    const L = x1 - x0, bays = Math.max(1, Math.round(L / 4.8)), bw = L / bays, ang = sz > 0 ? 0 : PI;
    const word = pick(WORDS), col = pick(NEON), awn = rnd() < 0.45 ? pick(M.awn) : null, shop = pick(shopMats);
    for (let b = 0; b < bays; b++) {
      const x = x0 + (b + 0.5) * bw;
      put(UNITP, shop, mat4(x, PAVE + 1.75, zf + sz * 0.04, ang, 0, 0, bw - 0.5, 3.1, 1), false, false);
      put(UNITP, shopGlass, mat4(x, PAVE + 1.75, zf + sz * 0.075, ang, 0, 0, bw - 0.5, 3.1, 1), false, false);
      putBox(M.trim, x - bw / 2 + 0.12, PAVE + 1.8, zf + sz * 0.08, 0.24, 3.6, 0.16, 0, false);
      putBox(M.trim, x, PAVE + 0.15, zf + sz * 0.1, bw, 0.3, 0.2, 0, false);
    }
    putBox(M.trim, x1 - 0.12, PAVE + 1.8, zf + sz * 0.08, 0.24, 3.6, 0.16, 0, false);
    // fascia sign over the whole shop
    put(UNITP, signMat(word, col, false), mat4((x0 + x1) / 2, PAVE + 4.15, zf + sz * 0.12, ang, 0, 0, Math.min(L - 1, 9), Math.min(L - 1, 9) / 4 * 0.6, 1), false, false);
    putBox(M.trim, (x0 + x1) / 2, PAVE + 4.15, zf + sz * 0.05, L, 1.2, 0.1, 0, false);
    signs.push({ pos: new V3((x0 + x1) / 2, PAVE + 4.6, zf + sz * 0.9), color: new THREE.Color(col).lerp(new THREE.Color(1, 0.85, 0.65), 0.35) });
    if (awn) put(UNIT, awn, mat4((x0 + x1) / 2, PAVE + 3.3, zf + sz * 0.75, 0, -sz * 0.35, 0, L - 0.4, 0.05, 1.5));
    // the pool of shop light on the wet pavement
    decal((x0 + x1) / 2, PAVE + 0.01, zf + sz * 1.8, L * 1.1, 4.5, 0xffc890, 0.11);
    // a blade sign sticking out from the facade
    if (rnd() < 0.5) {
      const bwd = pick(WORDS), bc = pick(NEON), bx = rnd() < 0.5 ? x0 + 0.8 : x1 - 0.8, hgt = rr(4, 7), by = PAVE + 5.4 + hgt / 2;
      const m = signMat(bwd, bc, true);
      for (const side of [1, -1]) put(UNITP, m, mat4(bx + side * 0.09, by, zf + sz * 0.95, side * PI / 2, 0, 0, 1.4, hgt, 1), false, false);
      putBox(M.trim, bx, by, zf + sz * 0.95, 0.16, hgt + 0.2, 1.6, 0, false);
      putBox(M.iron, bx, by, zf + sz * 0.1, 0.1, hgt * 0.8, 0.2, 0, false);
      signs.push({ pos: new V3(bx, by - hgt / 2, zf + sz * 1.0), color: new THREE.Color(bc) });
    }
  }
  // the front row along the avenue
  for (const b of blocks) {
    const mid = (b.xa + b.xb) / 2, near = Math.abs(mid) < 460;
    const faceIn = b.sz > 0 ? b.z0 + 6 : b.z1 - 6;   // building line 6 m behind the kerb
    const sz = b.sz, back = (z) => faceIn + sz * z;
    if (b.inner) {
      let x = b.xa + 0.5; const xEnd = b.xb - 0.5;
      while (x < xEnd - 1) {
        let w = rr(14, 30); if (xEnd - (x + w) < 12) w = xEnd - x;
        const x0 = x, x1 = x + w; x = x1 + 0.3;
        const d = rr(22, 34), zA = Math.min(faceIn, back(d)), zB = Math.max(faceIn, back(d));
        if (near) {
          const low = rnd() < 0.45, floors = low ? Math.floor(rr(3, 9)) : Math.floor(rr(3, 6));
          const pTop = PAVE + 5 + floors * 3.4;
          const wall = low ? pick(M.brick) : pick(M.stone);
          put(box(w, 5, d, 3), M.trim, mat4((x0 + x1) / 2, PAVE + 2.5, (zA + zB) / 2));
          put(box(w, pTop - PAVE - 5, d, low ? 2 : 2.8), wall, mat4((x0 + x1) / 2, (PAVE + 5 + pTop) / 2, (zA + zB) / 2));
          put(UNIT, M.trimL, mat4((x0 + x1) / 2, pTop - 0.3, faceIn - sz * 0.25, 0, 0, 0, w + 0.2, 0.6, 0.5));
          podiumWindows(x0, x1, faceIn, -sz, PAVE + 5, floors, Math.abs(mid) < 300);
          storefronts(x0, x1, faceIn, -sz);
          if (low) { put(box(w + 0.3, 0.6, d + 0.3, 3), M.roof, mat4((x0 + x1) / 2, pTop + 0.1, (zA + zB) / 2)); roofStuff(x0, x1, zA, zB, pTop, false); }
          else {
            const tH = pTop + rr(40, 190), s = rr(2, 4);
            towerBox(x0 + s, x1 - s, zA + s, zB - s, pTop, tH, pick(TOWER));
            roofStuff(x0 + s, x1 - s, zA + s, zB - s, tH, tH > 100);
          }
          // billboard on the podium roof at a corner
          if ((XC.some((c) => Math.abs(x0 - (c + XH)) < 1 || Math.abs(x1 - (c - XH)) < 1)) && rnd() < 0.8) billboard(x0, x1, faceIn, -sz, pTop);
        } else {
          const tH = PAVE + rr(30, 160);
          towerBox(x0, x1, zA, zB, PAVE, tH, pick(TOWER));
          put(UNIT, glow(...pick([[1.6, 1.1, 0.6], [2, 0.5, 1.2], [0.5, 1.6, 2]])), mat4((x0 + x1) / 2, PAVE + 2.5, faceIn - sz * 0.05, 0, 0, 0, w * 0.8, 3, 0.1), false, false);
          roofStuff(x0, x1, zA, zB, tH, tH > 100);
        }
      }
      // second row behind, inside the same block
      for (let xx = b.xa + 2; xx < b.xb - 10; xx += rr(20, 34)) {
        const w = rr(14, 26), x1 = Math.min(xx + w, b.xb - 2), z0 = Math.min(back(38), back(60)), z1 = Math.max(back(38), back(60));
        const tH = PAVE + (rnd() < 0.3 ? rr(120, 260) : rr(30, 110));
        towerBox(xx, x1, z0, z1, PAVE, tH, pick(TOWER)); roofStuff(xx, x1, z0, z1, tH, tH > 100);
      }
    } else if (Math.abs(mid) < 1000) {
      for (let xx = b.xa + 2; xx < b.xb - 10; xx += rr(22, 40)) {
        const w = rr(16, 30), x1 = Math.min(xx + w, b.xb - 2), z0 = Math.min(b.z0, b.z1) + 4, z1 = Math.max(b.z0, b.z1) - 4;
        const zz0 = rr(z0, (z0 + z1) / 2 - 8), zz1 = Math.min(z1, zz0 + rr(20, 40));
        const tH = PAVE + (rnd() < 0.35 ? rr(140, 320) : rr(40, 140));
        towerBox(xx, x1, zz0, zz1, PAVE, tH, pick(TOWER)); roofStuff(xx, x1, zz0, zz1, tH, tH > 100);
      }
    }
  }
  // a skyline beyond the grid, for the wide and high views
  for (let i = 0; i < 260; i++) {
    const a = rnd() * PI * 2, r = rr(260, 1300), x = Math.cos(a) * r * 1.4, z = Math.sin(a) * r;
    if (Math.abs(z) < 170) continue;
    const w = rr(20, 45), d = rr(20, 45), h = rr(40, 300) * (1 - r / 2000);
    towerBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h, pick(TOWER));
    if (h > 120 && rnd() < 0.7) put(new THREE.SphereGeometry(0.6, 6, 4), M.beacon, mat4(x, h + 1, z), false, false);
  }

  // LED billboards (their picture drifts with time)
  function billboard(x0, x1, zf, sz, y) {
    const w = Math.min(14, x1 - x0 - 2), h = w * 0.45, x = (x0 + x1) / 2;
    const t = canvasTex(512, 256, (g, cw, ch) => {
      const hue = rr(0, 360);
      const gr = g.createLinearGradient(0, 0, cw, ch); gr.addColorStop(0, `hsl(${hue},85%,45%)`); gr.addColorStop(1, `hsl(${(hue + 70) % 360},85%,22%)`);
      g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 6; i++) { g.fillStyle = `hsla(${(hue + rr(0, 120)) % 360},90%,70%,0.35)`; g.beginPath(); g.arc(rr(0, cw), rr(0, ch), rr(20, 90), 0, 7); g.fill(); }
      g.fillStyle = "#fff"; g.font = "bold 64px Helvetica, Arial, sans-serif"; g.textAlign = "left";
      g.fillText(pick(["NOW OPEN", "LIVE TONIGHT", "NEW SEASON", "SALE", "COMING SOON", "LATE SHOW"]), 30, 150);
      g.font = "28px Helvetica, Arial, sans-serif"; g.fillText(pick(["DOWNTOWN", "ALL NIGHT", "THIS WEEKEND", "EVERY DAY"]), 34, 200);
    });
    t.wrapS = THREE.RepeatWrapping;
    const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(2.2, 2.2, 2.2) });
    const zz = zf + sz * 1.0, by = y + 1.2 + h / 2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); mesh.position.set(x, by, zz); mesh.rotation.y = sz > 0 ? 0 : PI; scene.add(mesh);
    putBox(M.iron, x, by, zz - sz * 0.15, w + 0.4, h + 0.4, 0.2, 0, true);
    for (const k of [-1, 1]) putBox(M.iron, x + k * w * 0.35, y + 0.6, zz - sz * 0.15, 0.2, 1.4, 0.2);
    boards.push({ t, k: rr(0.01, 0.03) });
    signs.push({ pos: new V3(x, by - h / 2 - 1, zz + sz * 2), color: new THREE.Color(1, 1, 1) });
  }

  // ---------------------------------------------------------------- street lamps (lit heads, light pools)
  const lampGeo = {
    pole: new THREE.CylinderGeometry(0.08, 0.14, 8.4, 12),
    arm: new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new V3(0, 8.0, 0), new V3(0, 8.9, 0), new V3(0, 8.7, -2.0)), 16, 0.06, 8),
    head: new THREE.BoxGeometry(0.5, 0.18, 1.1),
  };
  const lamps = [];
  for (const sz of [1, -1]) for (let k = -40; k <= 40; k++) {
    const x = (sz > 0 ? 14 : 0) + 28 * k;
    if (Math.abs(x) > 1300 || (Math.abs(x) < 450 && XC.some((c) => Math.abs(x - c) < 10))) continue;
    const z = sz * 8.6, ry = sz > 0 ? 0 : PI, hz = z - sz * 2.1;
    if (Math.abs(x) < 700) {
      put(lampGeo.pole, M.pole, mat4(x, PAVE + 4.2, z));
      put(UNIT, M.pole, mat4(x, PAVE + 0.3, z, 0, 0, 0, 0.34, 0.6, 0.34));
      put(lampGeo.arm, M.pole, mat4(x, PAVE, z, ry));
      put(lampGeo.head, M.pole, mat4(x, PAVE + 8.75, hz, 0));
    }
    put(UNITP, M.lampLens, mat4(x, PAVE + 8.64, hz, 0, PI / 2, 0, 0.4, 0.9, 1), false, false);
    decal(x, 0.012, hz + sz * 0.6, 15, 13, 0xffd2a0, 0.13);
    lamps.push(new V3(x, PAVE + 8.4, hz));
  }
  // lamps on the parallel and cross streets (seen from above)
  for (const zs of [77, -77]) for (let x = -900; x < 900; x += 30) {
    for (const sd of [1, -1]) { put(UNITP, M.lampLens, mat4(x, 8.6, zs + sd * 5, 0, PI / 2, 0, 0.4, 0.9, 1), false, false); decal(x, 0.012, zs + sd * 5, 14, 12, 0xffd2a0, 0.12); }
  }
  for (const xc of XC) for (const sz of [1, -1]) for (let zz = 20; zz < 160; zz += 28) {
    const z = sz * zz; if (Math.abs(Math.abs(z) - 77) < 9) continue;
    put(UNITP, M.lampLens, mat4(xc + 5, 8.6, z, 0, PI / 2, 0, 0.4, 0.9, 1), false, false); decal(xc + 5, 0.012, z, 12, 12, 0xffd2a0, 0.12);
  }

  // ---------------------------------------------------------------- traffic signals
  const signalMeshes = { ave: [], cross: [] };
  const housing = std({ color: 0x1d1f1a, roughness: 0.5, metalness: 0.4 });
  const lensGeo = new THREE.CircleGeometry(0.13, 16);
  function signalHead(x, y, z, ry, group) {
    put(UNIT, housing, mat4(x, y, z, ry, 0, 0, 0.42, 1.15, 0.32));
    const fx = Math.sin(ry) * 0.17, fz = Math.cos(ry) * 0.17;
    const head = { red: null, amber: null, green: null };
    [["red", 0.36], ["amber", 0], ["green", -0.36]].forEach(([k, dy]) => {
      const m = new THREE.Mesh(lensGeo, M.redDim); m.position.set(x + fx, y + dy, z + fz); m.rotation.y = ry; scene.add(m); head[k] = m;
    });
    head.amber.material = M.amberDim; group.push(head);
  }
  for (const xc of XC) {
    if (Math.abs(xc) > 450) continue;
    for (const [cx, cz, ryAve] of [[xc - XH - 0.6, 8.7, -PI / 2], [xc + XH + 0.6, -8.7, PI / 2]]) {
      // mast arm over the avenue, heads facing the oncoming traffic
      put(new THREE.CylinderGeometry(0.16, 0.2, 7, 12), M.pole, mat4(cx, PAVE + 3.5, cz));
      const sz = Math.sign(cz);
      put(new THREE.CylinderGeometry(0.08, 0.1, 7.5, 10), M.pole, mat4(cx, PAVE + 6.6, cz - sz * 3.75, 0, PI / 2));
      for (const L of [2.0, 5.0]) signalHead(cx, PAVE + 5.95, cz - sz * L - sz * 0.2, ryAve, signalMeshes.ave);
      signalHead(cx + (ryAve < 0 ? 0.25 : -0.25), PAVE + 3.4, cz, -ryAve, signalMeshes.cross);
      // a pedestrian head
      put(UNIT, housing, mat4(cx, PAVE + 2.6, cz - sz * 0.3, 0, 0, 0, 0.4, 0.4, 0.25));
      // street name sign
      put(UNIT, std({ color: 0x0e5a32, roughness: 0.4 }), mat4(cx, PAVE + 6.3, cz - sz * 0.5, 0, 0, 0, 0.05, 0.3, 1.6), false);
    }
    for (const [cx, cz] of [[xc + XH + 0.6, 8.7], [xc - XH - 0.6, -8.7]]) {
      put(new THREE.CylinderGeometry(0.12, 0.15, 4, 12), M.pole, mat4(cx, PAVE + 2, cz));
      signalHead(cx, PAVE + 3.4, cz, cz > 0 ? PI : 0, signalMeshes.cross);
    }
  }
  function setSignal(s) {
    const ave = s < 0.5;
    for (const h of signalMeshes.ave) { h.red.material = ave ? M.redDim : M.red; h.green.material = ave ? M.green : M.greenDim; }
    for (const h of signalMeshes.cross) { h.red.material = ave ? M.red : M.redDim; h.green.material = ave ? M.greenDim : M.green; }
  }
  setSignal(0);

  // ---------------------------------------------------------------- kerb furniture
  const kerbItems = [];
  function hydrant(x, z) {
    put(new THREE.CylinderGeometry(0.14, 0.16, 0.62, 14), M.hydrant, mat4(x, PAVE + 0.31, z));
    put(new THREE.SphereGeometry(0.15, 12, 8, 0, PI * 2, 0, PI / 2), M.hydrant, mat4(x, PAVE + 0.62, z));
    put(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), M.hydrant, mat4(x, PAVE + 0.42, z, 0, 0, PI / 2));
  }
  const binMat = std({ color: 0x24382c, roughness: 0.55, metalness: 0.5 });
  function bin(x, z) { put(new THREE.CylinderGeometry(0.32, 0.27, 0.9, 14), binMat, mat4(x, PAVE + 0.45, z)); put(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10), M.iron, mat4(x, PAVE + 0.92, z)); }
  const boxMats = [std({ color: 0x1d4a8a, roughness: 0.5 }), std({ color: 0xb02a20, roughness: 0.5 }), std({ color: 0xd8c420, roughness: 0.5 })];
  function newsBox(x, z) { put(UNIT, pick(boxMats), mat4(x, PAVE + 0.55, z, 0, 0, 0, 0.5, 1.1, 0.45)); }
  function meter(x, z) { put(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), M.pole, mat4(x, PAVE + 0.6, z)); put(UNIT, M.iron, mat4(x, PAVE + 1.3, z, 0, 0, 0, 0.18, 0.32, 0.16)); }
  for (const sz of [1, -1]) for (let x = -420; x < 420; x += rr(7, 13)) {
    if ((sz > 0 && x > -52 && x < 34) || XC.some((c) => Math.abs(x - c) < 13) || lamps.some((l) => Math.abs(l.x - x) < 1.5 && Math.sign(l.z) === sz)) continue;
    const z = sz * rr(8.85, 9.15), r = rnd();
    if (r < 0.12) hydrant(x, z); else if (r < 0.3) bin(x, z); else if (r < 0.42) { newsBox(x, z); newsBox(x + 0.55, z); } else if (r < 0.75) meter(x, z);
    kerbItems.push(new V3(x, 0, z));
  }
  hydrant(-50, 8.95); bin(36, 9.0);

  // ---------------------------------------------------------------- steam: a striped stack in the far parking lane, a manhole wisp
  const STEAM = new V3(-14, 0, -6.6);
  const stripe = canvasTex(64, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#f2f0ea" : "#ff5a12"; g.fillRect(0, i * h / 8, w, h / 8); } });
  const stackMat = std({ map: stripe, roughness: 0.6, emissiveMap: stripe, emissive: 0x332010 });
  put(new THREE.CylinderGeometry(0.32, 0.46, 1.9, 20, 1, true), stackMat, mat4(STEAM.x, 0.95, STEAM.z));
  put(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 20), M.iron, mat4(STEAM.x, 0.04, STEAM.z));
  const MANHOLE = new V3(-4, 0, 3.0);
  put(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 24), M.iron, mat4(MANHOLE.x, 0.01, MANHOLE.z), false);
  const steamMat = new THREE.SpriteMaterial({ map: smoke, color: new THREE.Color(0.55, 0.5, 0.52), transparent: true, depthWrite: false, opacity: 0.5 });
  const puffs = [];
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(steamMat.clone()); s.layers.set(2); scene.add(s);
    puffs.push({ s, src: i < 32 ? STEAM : MANHOLE, i, n: i < 32 ? 32 : 14, ph: rnd(), sx: rr(-1, 1), sz: rr(-1, 1), rot: rr(0, 6) });
  }

  // ---------------------------------------------------------------- cars
  function carGeoms(type) {
    const Hh = type === "suv" ? 1.18 : 1, R = type === "suv" ? 0.37 : 0.33, L = type === "suv" ? 2.35 : 2.3;
    const y = (v) => 0.3 + (v - 0.3) * Hh;
    const s = new THREE.Shape();
    s.moveTo(-L, y(0.32)); s.lineTo(-1.88, y(0.32));
    s.absarc(-1.42, 0.34, R + 0.08, PI, 0, true); s.lineTo(1.0, y(0.32));
    s.absarc(1.42, 0.34, R + 0.08, PI, 0, true); s.lineTo(L - 0.05, y(0.32));
    s.quadraticCurveTo(L + 0.08, y(0.34), L + 0.06, y(0.62)); s.lineTo(L - 0.1, y(0.84));
    s.lineTo(0.95, y(0.96)); s.lineTo(-1.7, y(0.99)); s.lineTo(-L + 0.05, y(0.93));
    s.quadraticCurveTo(-L - 0.06, y(0.86), -L - 0.04, y(0.6)); s.lineTo(-L, y(0.32));
    const body = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 });
    body.translate(0, 0, -0.85);
    const gsh = new THREE.Shape(), rb = type === "suv" ? -2.0 : -1.62;
    gsh.moveTo(rb, y(0.96)); gsh.lineTo(type === "suv" ? -1.9 : -0.98, y(1.4)); gsh.lineTo(0.38, y(1.42)); gsh.lineTo(1.05, y(0.96)); gsh.lineTo(rb, y(0.96));
    const glass = new THREE.ExtrudeGeometry(gsh, { depth: 1.46, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
    glass.translate(0, 0, -0.73);
    const x0 = type === "suv" ? -1.95 : -0.92;
    const roof = new THREE.BoxGeometry(0.3 - x0, 0.07, 1.48); roof.translate((0.3 + x0) / 2, y(1.42) + 0.04, 0);
    const fl = [], rl = [], bump = [];
    for (const sz of [-0.62, 0.62]) {
      const f = new THREE.BoxGeometry(0.06, 0.12, 0.34); f.translate(L + 0.07, y(0.7), sz); fl.push(f);
      const b = new THREE.BoxGeometry(0.06, 0.12, 0.34); b.translate(-L - 0.08, y(0.76), sz); rl.push(b);
    }
    for (const bx of [L + 0.06, -L - 0.06]) { const b = new THREE.BoxGeometry(0.14, 0.16, 1.82); b.translate(bx, y(0.42), 0); bump.push(b); }
    const tire = new THREE.CylinderGeometry(R, R, 0.24, 20); tire.rotateX(PI / 2);
    const rim = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.25, 8); rim.rotateX(PI / 2);
    return { body, glass, roof, front: mergeGeometries(fl), rear: mergeGeometries(rl), bump: mergeGeometries(bump), tire, rim, R, L, hy: y(0.7) };
  }
  const CG = { sedan: carGeoms("sedan"), suv: carGeoms("suv") };
  const paints = [0x111214, 0xc8c9cb, 0x5a5f66, 0x1a2a44, 0x5d1416, 0x2e332c, 0xe2e0da, 0x3b4248].map((c) => std({ color: c, roughness: 0.22, metalness: 0.7 }));
  const taxiPaint = std({ color: 0xe8aa05, roughness: 0.28, metalness: 0.45 });
  const carGlass = std({ color: 0x0a0d10, roughness: 0.04, metalness: 0.95 });
  const rubber = std({ color: 0x0e0e0e, roughness: 0.9 }), chrome = std({ color: 0x9a9ea2, roughness: 0.25, metalness: 1 });
  const plastic = std({ color: 0x151515, roughness: 0.7 });
  const headOn = glow(9, 8.5, 7.5), tailOn = glow(5, 0.15, 0.08), headOff = std({ color: 0xd8d8d0, roughness: 0.1, metalness: 0.5 }), tailOff = std({ color: 0x5a0a0a, emissive: 0x200000, roughness: 0.3 });
  const signTaxi = glow(2.4, 2.2, 1.6);
  const beamMat = new THREE.MeshBasicMaterial({ map: radial, color: 0xfff0d8, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const tailPoolMat = new THREE.MeshBasicMaterial({ map: radial, color: 0xff2a10, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  function makeCar(type, paint, taxi, lit) {
    const g = CG[type], car = new THREE.Group();
    const add = (geo, mat, cs = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cs; m.receiveShadow = true; car.add(m); return m; };
    add(g.body, paint); add(g.glass, carGlass); add(g.roof, paint); add(g.bump, plastic);
    add(g.front, lit ? headOn : headOff, false); add(g.rear, lit ? tailOn : tailOff, false);
    const wheels = [];
    for (const [wx, wz] of [[-1.42, -0.8], [-1.42, 0.8], [1.42, -0.8], [1.42, 0.8]]) {
      const w = new THREE.Group(); w.position.set(wx, g.R, wz);
      const t = new THREE.Mesh(g.tire, rubber), r = new THREE.Mesh(g.rim, chrome); t.castShadow = true; w.add(t, r); car.add(w); wheels.push(w);
    }
    if (taxi) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.26, 0.3), signTaxi); s.position.set(-0.3, 1.58, 0); car.add(s); }
    if (lit) {
      const beam = new THREE.Mesh(UNITP, beamMat); beam.rotation.x = -PI / 2; beam.scale.set(16, 4.2, 1); beam.position.set(g.L + 7.5, 0.02, 0); beam.layers.set(2); car.add(beam);
      const tp = new THREE.Mesh(UNITP, tailPoolMat); tp.rotation.x = -PI / 2; tp.scale.set(5, 3, 1); tp.position.set(-g.L - 1.8, 0.02, 0); tp.layers.set(2); car.add(tp);
      for (const sz of [-0.62, 0.62]) {
        const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: 0xfff2dc, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
        h.scale.set(0.9, 0.9, 1); h.position.set(g.L + 0.2, g.hy, sz); car.add(h);
      }
    }
    car.userData = { R: g.R, wheels };
    return car;
  }
  // parked cars (lights off)
  for (const sz of [1, -1]) {
    let x = -440;
    while (x < 440) {
      const L = 4.9;
      const clear = XC.some((c) => x + L > c - 14 && x < c + 12) || (sz > 0 && x + L > -48 && x < 30) || (sz < 0 && x + L > -18 && x < -10);
      if (!clear && rnd() < 0.78) {
        const taxi = rnd() < 0.06, car = makeCar(rnd() < 0.3 ? "suv" : "sedan", taxi ? taxiPaint : pick(paints), taxi, false);
        car.position.set(x + L / 2, 0, sz * 6.9); car.rotation.y = (sz > 0 ? 0 : PI) + rr(-0.015, 0.015); scene.add(car);
      }
      x += L + rr(0.8, 2.6);
    }
  }
  for (const xc of XC) for (let k = 0; k < 5; k++) {
    const z = rr(18, 140) * (rnd() < 0.5 ? 1 : -1); if (Math.abs(Math.abs(z) - 77) < 9) continue;
    const car = makeCar(rnd() < 0.3 ? "suv" : "sedan", pick(paints), rnd() < 0.2, false); car.position.set(xc + 5.2 * (rnd() < 0.5 ? 1 : -1), 0, z); car.rotation.y = PI / 2; scene.add(car);
  }
  // moving traffic: four lanes, each a loop of cars at their own speeds
  const LOOP = 1700, cars = [];
  for (const [lanes, dir] of [[LANES.east, 1], [LANES.west, -1]]) for (const lz of lanes) {
    const n = 11, sp = lz === lanes[0] ? rr(10.5, 12.5) : rr(8, 9.5);
    for (let i = 0; i < n; i++) {
      const taxi = rnd() < 0.28, car = makeCar(rnd() < 0.3 ? "suv" : "sedan", taxi ? taxiPaint : pick(paints), taxi, true);
      car.rotation.y = dir > 0 ? 0 : PI; scene.add(car);
      cars.push({ object: car, lane: lz, dir, speed: sp, x0: -LOOP / 2 + (i + rr(0.05, 0.6)) * LOOP / n });
    }
  }
  const wrapX = (x) => ((((x + LOOP / 2) % LOOP) + LOOP) % LOOP) - LOOP / 2;
  const carAt = (i, time, traffic = 1) => { const c = cars[i]; return wrapX(c.x0 + c.dir * c.speed * time * traffic); };

  flush();

  // ---------------------------------------------------------------- pooled lights: real light from the lamps and signs near the focus
  const LAMP_N = 10, SIGN_N = 8;
  const lampLights = [], signLights = [];
  for (let i = 0; i < LAMP_N; i++) { const l = new THREE.PointLight(0xffc98a, 0, 34, 2); scene.add(l); lampLights.push(l); }
  for (let i = 0; i < SIGN_N; i++) { const l = new THREE.PointLight(0xffffff, 0, 12, 2); scene.add(l); signLights.push(l); }
  function poolLights(list, lights, focus, power) {
    const d = list.map((o, i) => [((o.pos || o).distanceTo(focus)), i]).sort((a, b) => a[0] - b[0]);
    const edge = d[Math.min(lights.length, d.length - 1)][0];
    lights.forEach((l, k) => {
      const [dist, i] = d[k] || [1e9, 0]; const o = list[i];
      l.position.copy(o.pos || o); if (o.color) l.color.copy(o.color);
      l.intensity = power * sstep(0, 0.3, (edge - dist) / Math.max(edge, 1));
    });
  }

  // ---------------------------------------------------------------- the people: the cast and the crowd
  const people = {};
  cast.forEach((id, i) => { const f = castFigs[i]; f.object.visible = false; scene.add(f.object); people[id] = f; });
  const blobMat = new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const blobs = {};
  for (const id of cast) { const b = new THREE.Mesh(UNITP, blobMat); b.rotation.x = -PI / 2; b.scale.set(1.0, 1.0, 1); b.layers.set(2); scene.add(b); blobs[id] = b; }
  const extras = [];
  if (extraFigs.length) {
    const lanes = [[12.5, 1], [13.2, -1], [-10.6, -1], [-12.4, 1]];
    for (let k = 0; k < 12; k++) {
      const fi = k % 3 === 2 ? 1 : 0, src = extraFigs[fi], [z, dir] = lanes[k % 4];
      const obj = SkeletonUtils.clone(src.object);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      const mixer = new THREE.AnimationMixer(obj);
      const a = mixer.clipAction(src.actions.walk.getClip()); a.play();
      scene.add(obj);
      const b = new THREE.Mesh(UNITP, blobMat); b.rotation.x = -PI / 2; b.layers.set(2); scene.add(b);
      const rate = rr(0.92, 1.05);
      extras.push({ obj, mixer, blob: b, z: z + rr(-0.15, 0.15), dir, x0: rr(-70, 70) + (k < 4 ? (k % 2 ? 22 : -26) : 0), ph: rr(0, 3), speed: gaitSpeed[extraIds[fi]].walk * rate, rate });
    }
  }
  const SPOT = new V3(0, PAVE, SUBJECT_Z);

  // ---------------------------------------------------------------- post: bloom and depth of field
  const sceneRT = (() => { const dt = new THREE.DepthTexture(W, H); dt.type = THREE.UnsignedIntType; return new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: dt, samples: 4 }); })();
  const qW = Math.round(W / 4), qH = Math.round(H / 4), eW = Math.round(W / 8), eH = Math.round(H / 8);
  const mkRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
  const bA = mkRT(qW, qH), bB = mkRT(qW, qH), bC = mkRT(eW, eH), bD = mkRT(eW, eH);
  const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false;
  const qScene = new THREE.Scene(); qScene.add(quad); const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const brightMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2(1 / W, 1 / H) }, th: { value: 2.0 } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D t; uniform vec2 px; uniform float th; varying vec2 vUv;
      void main(){ vec3 c = vec3(0.0);
        for (int i = 0; i < 4; i++) { vec2 o = vec2(float(i - (i/2)*2) * 2.0 - 1.0, float(i/2) * 2.0 - 1.0) * px * 1.5; c += texture2D(t, vUv + o).rgb; }
        c *= 0.25; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(min(c * smoothstep(th, th * 2.5, l), vec3(30.0)), 1.0); }` });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227;
        c += (texture2D(t, vUv + dir * 1.385).rgb + texture2D(t, vUv - dir * 1.385).rgb) * 0.316;
        c += (texture2D(t, vUv + dir * 3.231).rgb + texture2D(t, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(c, 1.0); }` });
  const compMat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: sceneRT.texture }, tDepth: { value: sceneRT.depthTexture }, tB1: { value: bA.texture }, tB2: { value: bC.texture },
      cNear: { value: 0.1 }, cFar: { value: 4000 }, focus: { value: 5 }, maxR: { value: 0 }, bloom: { value: 1 }, px: { value: new THREE.Vector2(1 / W, 1 / H) } },
    vertexShader: VS, depthTest: false, depthWrite: false, toneMapped: true,
    fragmentShader: `
      #include <packing>
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tB1; uniform sampler2D tB2;
      uniform float cNear, cFar, focus, maxR, bloom; uniform vec2 px; varying vec2 vUv;
      float dist(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, cNear, cFar); }
      float coc(float z){ return maxR * clamp(abs(z - focus) / max(z, 0.001) * 1.6, 0.0, 1.0); }
      void main(){
        vec3 acc = texture2D(tColor, vUv).rgb; float wsum = 1.0;
        if (maxR > 0.5) {
          float c0 = coc(dist(vUv));
          if (c0 > 0.5) for (int i = 1; i < 48; i++) {
            float fi = float(i), r = sqrt(fi / 48.0) * c0, a = fi * 2.39996;
            vec2 o = vec2(cos(a), sin(a)) * r * px;
            float w = smoothstep(r - 1.5, r + 0.5, coc(dist(vUv + o)));
            acc += texture2D(tColor, vUv + o).rgb * w; wsum += w;
          }
        }
        vec3 col = acc / wsum + (texture2D(tB1, vUv).rgb * 0.3 + texture2D(tB2, vUv).rgb * 0.35) * bloom;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(qScene, qCam); }

  // ---------------------------------------------------------------- update and render
  const focusPoint = SPOT.clone().add(new V3(0, 1.3, 0));
  const look = new V3();
  function update(state = {}) {
    const time = state.time || 0, traffic = state.traffic ?? 1;
    skyMat.uniforms.time.value = time;
    sky.position.copy(camera.position);
    scene.fog.density = 0.0032 * (state.haze ?? 1);
    setSignal(state.signal || 0);
    // traffic
    cars.forEach((c, i) => {
      const x = carAt(i, time, traffic); c.object.position.set(x, 0, c.lane);
      for (const w of c.object.userData.wheels) w.rotation.z = -(c.speed * time * traffic) / c.object.userData.R;
    });
    // billboards drift
    for (const b of boards) b.t.offset.x = Math.sin(time * 0.6) * 0.02 + time * b.k * 0.2;
    // steam
    const wind = state.wind ?? 0.25;
    for (const p of puffs) {
      const life = p.src === STEAM ? 3.6 : 2.6, age = ((time / life + p.i / p.n + p.ph * 0.02) % 1 + 1) % 1;
      const rise = p.src === STEAM ? 1.9 + age * 6.5 : 0.05 + age * 3.2;
      p.s.position.set(p.src.x + p.sx * 0.15 + age * age * wind * 7 + Math.sin(time * 1.3 + p.i) * 0.2 * age, rise, p.src.z + p.sz * 0.15 + p.sz * age * 0.8);
      const sc = (p.src === STEAM ? 0.7 : 0.6) + age * (p.src === STEAM ? 4.2 : 2.6);
      p.s.scale.set(sc, sc, 1); p.s.material.rotation = p.rot + age * 0.8;
      p.s.material.opacity = (p.src === STEAM ? 0.42 : 0.3) * sstep(0, 0.12, age) * (1 - sstep(0.45, 1, age));
    }
    // people
    const ppl = state.people;
    let first = null;
    cast.forEach((id, i) => {
      const f = people[id], b = blobs[id];
      const p = ppl ? ppl[id] : (i === 0 ? { x: SPOT.x } : null);
      if (!p || p.show === false) { f.object.visible = false; b.visible = false; return; }
      const x = p.x ?? SPOT.x, z = p.z ?? SUBJECT_Z, y = groundY(x, z);
      f.object.visible = true; b.visible = true;
      f.object.position.set(x, y, z); f.object.rotation.set(0, p.heading ?? PI / 2, 0);
      const g = p.gait || {}, walk = g.walk || 0, run = g.run || 0;
      f.pose(p.time ?? time, { idle: Math.max(0, 1 - walk - run), walk, run });
      b.position.set(x, y + 0.01, z);
      if (!first) first = f.object.position;
    });
    const showCrowd = state.crowd !== false;
    for (const e of extras) {
      const x = e.x0 + e.dir * e.speed * time;
      e.obj.visible = e.blob.visible = showCrowd;
      if (!showCrowd) continue;
      e.obj.position.set(x, PAVE, e.z); e.obj.rotation.y = e.dir > 0 ? PI / 2 : -PI / 2;
      e.mixer.setTime(e.ph + time * e.rate);
      e.blob.position.set(x, PAVE + 0.01, e.z); e.blob.scale.set(0.9, 0.9, 1);
    }
    // focus, lights, shadows
    camera.updateMatrixWorld(); camera.getWorldDirection(look);
    const fp = state.focus ? new V3(state.focus.x, state.focus.y ?? 0, state.focus.z) : first ? first.clone() : camera.position.clone().addScaledVector(look, 30);
    if (!state.focus && !first && fp.y < 0) fp.y = 0;
    focusPoint.copy(first ? first.clone().add(new V3(0, 1.3, 0)) : fp);
    poolLights(lamps, lampLights, fp, 260);
    poolLights(signs, signLights, fp, 10);
    if (first) { fill.visible = true; fill.position.set(first.x + 0.6, first.y + 2.6, first.z - 2.4); } else fill.visible = false;
    const rad = state.shadowRadius ?? Math.min(90, Math.max(14, camera.position.distanceTo(fp) * 1.1));
    moon.target.position.copy(fp); moon.position.copy(fp).addScaledVector(moonDir, 150);
    const sc = moon.shadow.camera;
    if (sc.right !== rad) { sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 1; sc.far = 400; sc.updateProjectionMatrix(); }
  }
  function render(opts = {}) {
    renderer.toneMappingExposure = opts.exposure ?? 1.0;
    // 1. the mirror image for the wet road
    updateMirror();
    for (const m of wetMeshes) m.visible = false;
    renderer.setRenderTarget(reflRT); renderer.render(scene, mirrorCam);
    for (const m of wetMeshes) m.visible = true;
    // 2. the scene, HDR
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = true;
    // 3. glow
    brightMat.uniforms.t.value = sceneRT.texture; pass(brightMat, bA);
    blurMat.uniforms.t.value = bA.texture; blurMat.uniforms.dir.value.set(1.4 / qW, 0); pass(blurMat, bB);
    blurMat.uniforms.t.value = bB.texture; blurMat.uniforms.dir.value.set(0, 1.4 / qH); pass(blurMat, bA);
    blurMat.uniforms.t.value = bA.texture; blurMat.uniforms.dir.value.set(1.6 / eW, 0); pass(blurMat, bD);
    blurMat.uniforms.t.value = bD.texture; blurMat.uniforms.dir.value.set(0, 1.6 / eH); pass(blurMat, bC);
    blurMat.uniforms.t.value = bC.texture; blurMat.uniforms.dir.value.set(2.4 / eW, 0); pass(blurMat, bD);
    blurMat.uniforms.t.value = bD.texture; blurMat.uniforms.dir.value.set(0, 2.4 / eH); pass(blurMat, bC);
    // 4. depth of field, glow, tone mapping, to the canvas
    const u = compMat.uniforms;
    u.cNear.value = camera.near; u.cFar.value = camera.far; u.maxR.value = 16 * (opts.blur || 0);
    u.focus.value = opts.focusDistance ?? camera.position.distanceTo(focusPoint);
    u.bloom.value = opts.bloom ?? 1;
    pass(compMat, null);
  }

  update({});
  return {
    renderer, scene, camera, update, render, cast: people, person: people[cast[0]]?.object, gaitSpeed,
    SPOT, SUBJECT_Z, groundY, PAVE, KERB_Z, FRONT_Z, XC, LANES, lamps, signs, cars, carAt, steam: STEAM, moon, fill,
  };
}
