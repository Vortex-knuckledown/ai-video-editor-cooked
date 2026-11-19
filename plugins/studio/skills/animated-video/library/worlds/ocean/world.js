// World "ocean": the open Atlantic seen from just above the surface, under a day sky, a low coastline with a
// lighthouse on the east side.
//
// Axes and units: metres. +x is EAST, -z is NORTH, +y is up. Mean sea level is y = 0.
// The sea is finest within about 300 m of the origin: keep shot cameras near x, z in [-300, 300].
// The coast runs north-south at about x = 460 (coastX(z)); the lighthouse (33 m) stands on a headland at about (440, 18, -60).
//
// update(state) reads (all optional):
//   time         seconds, the phase of the swell and ripples (shot clock)
//   surgeHeight  metres, crest height of the surge above the sea (0 = no surge, 8 to 14 reads as a surge)
//   surgeX       metres east of the origin where the surge crest is; animate it upward to roll the surge east
//   calm         0 = an ordinary Atlantic swell, 1 = glassy and flattened
//   level        metres, mean water level offset (negative = the sea draining away)
//   drift        metres the surface (ripples, buoys) has flowed NORTH; animate it upward for "flowing away north"
//
// Exposes: renderer, scene, camera (PerspectiveCamera, 38 deg, set it before update), update(state), render(),
//   heightAt(x, z) (sea surface y with the current state, for riding a camera or a float on the water),
//   lighthouse (Object3D at its base; lighthouse.userData.lamp = world position of the lamp),
//   buoys (array of Object3D), ship (Object3D, far north-east), sun (DirectionalLight), sunDir (Vector3),
//   coastX(z) (x of the waterline at z), EAST, NORTH (unit Vector3).
// Set world.camera's position and lookAt, call update(state), then world.render() (or renderer.render(scene, camera)).

export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders = {} }) {
  const HDRLoader = loaders.HDRLoader || loaders.RGBELoader ||
    (await import("three/addons/loaders/HDRLoader.js")).HDRLoader;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(canvas.width || 1920, canvas.height || 1080, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, (canvas.width || 1920) / (canvas.height || 1080), 0.2, 40000);

  // ---------- load everything first
  const TL = new THREE.TextureLoader();
  const load = (f) => new Promise((res, rej) => TL.load(K + f, res, undefined, rej));
  const pbrSet = async (name) => {
    const [d, n, r] = await Promise.all(["diff", "nor", "rough"].map((x) => load(`pbr/${name}_${x}.jpg`)));
    for (const t of [d, n, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    d.colorSpace = THREE.SRGBColorSpace;
    return { d, n, r };
  };
  const hdrLoader = new HDRLoader();
  if (hdrLoader.setDataType) hdrLoader.setDataType(THREE.FloatType);
  const [sky, rock, sand, concrete] = await Promise.all([
    hdrLoader.loadAsync(K + "sky/day.hdr"), pbrSet("rock"), pbrSet("sand"), pbrSet("concrete")]);

  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky;
  scene.environment = sky;
  scene.backgroundBlurriness = 0.0;

  // ---------- the sun: the brightest texel of the sky, so the light agrees with the picture
  const img = sky.image, W = img.width, H = img.height, px = img.data, ch = px.length / (W * H);
  let best = -1, bi = 0;
  for (let i = 0; i < W * H; i++) { const v = px[i * ch] + px[i * ch + 1] + px[i * ch + 2]; if (v > best) { best = v; bi = i; } }
  const su = ((bi % W) + 0.5) / W, svRow = Math.floor(bi / W);
  // HDR rows run top to bottom; three's equirect: u = atan(z, x)/2pi + 0.5, v = asin(y)/pi + 0.5 with flipY
  const sv = 1 - (svRow + 0.5) / H;
  let elev = (sv - 0.5) * Math.PI, azim = (su - 0.5) * 2 * Math.PI;
  if (!(elev > 0.12)) elev = 0.6;                       // a sky with the sun below 7 deg: light it from 34 deg anyway
  const sunDir = new THREE.Vector3(Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)).normalize();
  // the haze colour: the average of the sky just above the horizon
  const hz = [0, 0, 0]; let hn = 0;
  for (const rowF of [0.47, 0.48, 0.49]) { const row = Math.floor(rowF * H);
    for (let x = 0; x < W; x += 4) { const i = (row * W + x) * ch; hz[0] += px[i]; hz[1] += px[i + 1]; hz[2] += px[i + 2]; hn++; } }
  const haze = new THREE.Color(hz[0] / hn, hz[1] / hn, hz[2] / hn);
  const hm = Math.max(haze.r, haze.g, haze.b); if (hm > 1.4) haze.multiplyScalar(1.4 / hm);
  scene.fog = new THREE.FogExp2(haze, 0.00032);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 900 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd4ec, 0x1d3440, 0.35));

  // ---------- the sea: one height function, shared by the GPU and heightAt()
  // [direction of travel (rad, 0 = east, negative = north of east), wavelength m, amplitude m, phase]
  const SWELL = [[-0.25, 64, 0.55, 0.0], [0.35, 38, 0.32, 1.7], [-0.85, 23, 0.21, 4.1], [0.95, 15, 0.12, 2.3],
                 [-1.6, 9.5, 0.07, 5.2], [2.4, 6.3, 0.045, 0.9], [-0.5, 4.1, 0.03, 3.3]];
  const S = { time: 0, surgeHeight: 0, surgeX: -400, calm: 0, level: 0, drift: 0 };
  const swellJS = SWELL.map(([a, L, A, ph]) => { const k = 2 * Math.PI / L; return { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), A, ph, L }; });
  const f = (v) => v.toFixed(6);
  const swellGLSL = swellJS.map((s) =>
    `{ float fd = 1.0 / (1.0 + pow(r / ${f(s.L * 25)}, 2.0));
       float th = ${f(s.k)} * dot(vec2(${f(s.dx)}, ${f(s.dz)}), q) - ${f(s.w)} * uTime + ${f(s.ph)};
       h += ${f(s.A)} * amp * fd * (2.0 * pow(0.5 + 0.5 * sin(th), 1.4) - 1.0); }`).join("\n");

  function heightParts(x, z) {
    const qx = x, qz = z + S.drift, r = Math.hypot(x, z), amp = 1 - 0.85 * S.calm;
    let h = 0;
    for (const s of swellJS) {
      const fd = 1 / (1 + Math.pow(r / (s.L * 25), 2));
      const th = s.k * (s.dx * qx + s.dz * qz) - s.w * S.time + s.ph;
      h += s.A * amp * fd * (2 * Math.pow(0.5 + 0.5 * Math.sin(th), 1.4) - 1);
    }
    const u = x - S.surgeX, w = u > 0 ? 38 : 120;
    const md = 1 + 0.12 * Math.sin(z * 0.006 + 1.3) + 0.06 * Math.sin(z * 0.017 + 0.4);
    const sg = S.surgeHeight * md * Math.exp(-(u * u) / (w * w));
    return [h + sg + S.level, sg];
  }
  const heightAt = (x, z) => heightParts(x, z)[0];

  const SEA_COMMON = /* glsl */`
    uniform float uTime, uSurgeH, uSurgeX, uCalm, uLevel, uDrift;
    float seaH(vec2 p, out float sg) {
      vec2 q = vec2(p.x, p.y + uDrift);
      float r = length(p), amp = 1.0 - 0.85 * uCalm, h = 0.0;
      ${swellGLSL}
      float u = p.x - uSurgeX, w = u > 0.0 ? 38.0 : 120.0;
      float md = 1.0 + 0.12 * sin(p.y * 0.006 + 1.3) + 0.06 * sin(p.y * 0.017 + 0.4);
      sg = uSurgeH * md * exp(-(u * u) / (w * w));
      return h + sg + uLevel;
    }`;

  // ripples: shading only, an analytic gradient of many short waves
  const RIP = [];
  { let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 12; i++) { const a = -0.3 + (rnd() - 0.5) * 3.2, L = 0.35 + Math.pow(rnd(), 1.6) * 5.5, k = 2 * Math.PI / L;
      RIP.push({ dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), a: 0.11 / k * (0.6 + rnd() * 0.8) * k * 0.9 / (1 + 0.15 * L), ph: rnd() * 6.28 }); } }
  const ripGLSL = RIP.map((s) =>
    `{ float th = ${f(s.k)} * dot(vec2(${f(s.dx)}, ${f(s.dz)}), q) - ${f(s.w)} * uTime + ${f(s.ph)};
       g += ${f(s.a)} * cos(th) * vec2(${f(s.dx)}, ${f(s.dz)}); }`).join("\n");

  // a grid dense at the origin and sparse towards a 30 km horizon
  const N = 640, B = 7.0, A0 = 240 / B * (N / 2) / 300;   // ~0.8 m spacing at the origin
  const mapc = (u) => Math.sign(u) * A0 * (Math.exp(B * Math.abs(u)) - 1);
  const seaGeo = new THREE.BufferGeometry();
  { const pos = new Float32Array((N + 1) * (N + 1) * 3); let o = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { pos[o++] = mapc(i / N * 2 - 1); pos[o++] = 0; pos[o++] = mapc(j / N * 2 - 1); }
    const idx = new Uint32Array(N * N * 6); o = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    seaGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); seaGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    seaGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); }

  const seaU = { uTime: { value: 0 }, uSurgeH: { value: 0 }, uSurgeX: { value: -400 }, uCalm: { value: 0 }, uLevel: { value: 0 }, uDrift: { value: 0 } };
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x06263a, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.0 });
  seaMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, seaU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + SEA_COMMON + "\nvarying vec3 vSeaW; varying float vSurge; varying float vSurgeU; varying float vSwell;")
      .replace("#include <beginnormal_vertex>", `
        float sg0, sgx, sgz;
        vec2 p0 = position.xz;
        float e = max(0.35, length(p0) * 0.004);
        float h0 = seaH(p0, sg0);
        float hx = seaH(p0 + vec2(e, 0.0), sgx);
        float hz = seaH(p0 + vec2(0.0, e), sgz);
        vec3 objectNormal = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
        vSurge = sg0; vSurgeU = p0.x - uSurgeX; vSwell = h0 - sg0 - uLevel;`)
      .replace("#include <begin_vertex>", "vec3 transformed = vec3(position.x, h0, position.z);\nvSeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime, uSurgeH, uCalm, uDrift;\nfloat vhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y); }\nvarying vec3 vSeaW; varying float vSurge; varying float vSurgeU; varying float vSwell;")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          vec2 q = vec2(vSeaW.x, vSeaW.z + uDrift);
          float dist = length(vSeaW - cameraPosition);
          vec2 g = vec2(0.0);
          ${ripGLSL}
          g *= (1.0 - 0.8 * uCalm) / (1.0 + dist / 140.0);
          normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
          roughnessFactor = mix(0.05, 0.2, smoothstep(60.0, 2500.0, dist));
          float crest = clamp(vSurge / max(uSurgeH, 0.001), 0.0, 1.0) * step(0.3, uSurgeH);
          vec2 fq = q + vec2(uTime * 0.6, uTime * 0.25);
          float nz = 0.55 * vnoise(fq * 0.09) + 0.3 * vnoise(fq * 0.23 + 7.1) + 0.15 * vnoise(fq * 0.61 - 3.7);
          nz = (nz - 0.5) * 1.6 + 0.5;
          float lip = smoothstep(-6.0, 6.0, vSurgeU) * (1.0 - smoothstep(14.0, 34.0, vSurgeU));
          float foam = smoothstep(0.62, 0.92, crest) * lip * smoothstep(0.42, 0.78, nz);
          foam += smoothstep(0.35, 0.8, crest) * smoothstep(0.7, 0.95, nz) * 0.35;
          foam += smoothstep(0.7, 1.0, vSwell) * smoothstep(0.72, 0.9, nz) * 0.5 * (1.0 - uCalm);
          foam = clamp(foam, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.92), foam);
          roughnessFactor = mix(roughnessFactor, 0.75, foam);
          // light through the thin water of a crest
          totalEmissiveRadiance += vec3(0.004, 0.05, 0.055) * (crest * 0.9 + clamp(vSwell, 0.0, 1.0) * 0.6) * (1.0 - foam);
        }`);
  };
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.receiveShadow = true; sea.frustumCulled = false;
  scene.add(sea);

  // ---------- the coast: a beach, then rock cliffs and grassy tops, a headland for the lighthouse
  const coastX = (z) => 460 + 40 * Math.sin(z * 0.004) + 20 * Math.sin(z * 0.011 + 1) - 70 * Math.exp(-Math.pow((z + 60) / 90, 2));
  const nse = (x, z) => Math.sin(x * 0.031 + 1.7) * Math.sin(z * 0.027) + 0.5 * Math.sin(x * 0.083 + z * 0.061) + 0.25 * Math.sin(x * 0.21 - z * 0.17 + 2.0);
  const terrainY = (x, z) => {
    const d = x - coastX(z), head = Math.exp(-Math.pow((z + 60) / 110, 2));
    let y = -4 + Math.min(d, 40) * 0.09 + Math.min(0, d) * 0.0;                                            // the beach slope
    y += (1 - Math.exp(-Math.max(0, d - 30) / 18)) * (15 + 9 * head + 5 * nse(x, z));   // the cliff
    y += Math.max(0, d - 80) * 0.035 + 2.0 * nse(x * 0.4, z * 0.4) * Math.min(1, Math.max(0, d - 40) / 60);
    return y;
  };
  const tGeo = new THREE.PlaneGeometry(1000, 9000, 250, 900); tGeo.rotateX(-Math.PI / 2);
  { const p = tGeo.attributes.position, uv = tGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 850, z = p.getZ(i); p.setX(i, x); p.setY(i, terrainY(x, z)); uv.setXY(i, x / 9, z / 9); }
    tGeo.computeVertexNormals(); }
  const tMat = new THREE.MeshStandardMaterial({ map: rock.d, normalMap: rock.n, roughnessMap: rock.r, roughness: 1 });
  const tU = { uSand: { value: sand.d }, uSandN: { value: sand.n } };
  tMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, tU);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vTW; varying float vTUp;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTUp = normal.y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uSand; varying vec3 vTW; varying float vTUp;")
      .replace("#include <map_fragment>", `
        vec4 rc = texture2D(map, vMapUv);
        vec4 sc = texture2D(uSand, vMapUv * 1.6);
        float sandK = 1.0 - smoothstep(1.2, 3.8, vTW.y + 0.8 * sin(vTW.z * 0.05));
        float grassK = smoothstep(15.0, 20.0, vTW.y) * smoothstep(0.85, 0.95, vTUp);
        vec3 grass = rc.rgb * vec3(0.6, 0.66, 0.42) + vec3(0.015, 0.02, 0.0);
        vec3 c = mix(rc.rgb * vec3(0.9, 0.86, 0.8), grass, grassK);
        float wet = 1.0 - smoothstep(-0.5, 1.2, vTW.y);
        c = mix(c, sc.rgb * vec3(1.0, 0.95, 0.85) * (1.0 - 0.45 * wet), sandK);
        diffuseColor.rgb *= c;`);
  };
  const terrain = new THREE.Mesh(tGeo, tMat); terrain.receiveShadow = true; terrain.castShadow = true;
  scene.add(terrain);

  // ---------- the lighthouse on the headland, a keeper's house, a few houses along the cliff top
  const paint = (hex) => { const m = new THREE.MeshStandardMaterial({ color: hex, normalMap: concrete.n, roughnessMap: concrete.r, roughness: 1 }); m.normalScale.set(0.4, 0.4); return m; };
  const white = paint(0xf2efe8), red = paint(0xb3221c), darkM = new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: 0.45, metalness: 0.6 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.7 }), winM = new THREE.MeshStandardMaterial({ color: 0x19222c, roughness: 0.1, metalness: 0.8 });
  const lhZ = -60, lhX = coastX(lhZ) + 46, lhY = terrainY(lhX, lhZ) - 0.3;
  const lighthouse = new THREE.Group(); lighthouse.position.set(lhX, lhY, lhZ);
  { const TH = 27, _s = lighthouse.scale.setScalar(1.2), seg = [[0, 6, white], [6, 11, red], [11, 17, white], [17, 22, red], [22, 27, white]];
    const rAt = (y) => 3.3 - (y / TH) * 1.2;
    for (const [a, b, m] of seg) { const c = new THREE.Mesh(new THREE.CylinderGeometry(rAt(b), rAt(a), b - a, 40), m); c.position.y = (a + b) / 2; lighthouse.add(c); }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 1.4, 40), paint(0xbdb8ae)); base.position.y = 0.4; lighthouse.add(base);
    const gal = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 2.3, 0.6, 40), darkM); gal.position.y = TH + 0.3; lighthouse.add(gal);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, rl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), darkM); rl.position.set(Math.cos(a) * 2.85, TH + 1.15, Math.sin(a) * 2.85); lighthouse.add(rl); }
    const rail = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.05, 6, 48), darkM); rail.rotation.x = Math.PI / 2; rail.position.y = TH + 1.7; lighthouse.add(rail);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 2.6, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x9fb4c0, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide })); lantern.position.y = TH + 1.9; lighthouse.add(lantern);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffe6a8, emissiveIntensity: 2.2 })); lamp.position.y = TH + 1.9; lighthouse.add(lamp);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, mu = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), darkM); mu.position.set(Math.cos(a) * 1.55, TH + 1.9, Math.sin(a) * 1.55); lighthouse.add(mu); }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.75, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), red); dome.position.y = TH + 3.2; lighthouse.add(dome);
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.9, 10), darkM); vent.position.y = TH + 5.2; lighthouse.add(vent);
    for (const wy of [4, 10, 16, 22]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.9), winM); w.position.set(-rAt(wy) + 0.15, wy, 0); lighthouse.add(w); }
    lighthouse.userData.lamp = new THREE.Vector3(lhX, lhY + (TH + 1.9) * 1.2, lhZ);
    lighthouse.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }
  scene.add(lighthouse);

  const house = (x, z, w, d, h, rot, wall) => {
    const g = new THREE.Group(), y = Math.min(terrainY(x - w / 2, z), terrainY(x + w / 2, z), terrainY(x, z - d / 2), terrainY(x, z + d / 2)) - 0.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.4, d), wall); body.position.y = (h + 0.4) / 2; g.add(body);
    const pr = new THREE.Shape(); pr.moveTo(-d / 2 - 0.3, 0); pr.lineTo(d / 2 + 0.3, 0); pr.lineTo(0, d * 0.42); pr.lineTo(-d / 2 - 0.3, 0);
    const rg = new THREE.ExtrudeGeometry(pr, { depth: w + 0.6, bevelEnabled: false }); rg.translate(0, 0, -(w + 0.6) / 2); rg.rotateY(Math.PI / 2);
    const rf = new THREE.Mesh(rg, roofM); rf.position.y = h + 0.4; g.add(rf);
    const nWin = Math.max(1, Math.floor(w / 2.6));
    for (let i = 0; i < nWin; i++) for (const s of [-1, 1]) { const wn = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.08), winM); wn.position.set(-w / 2 + (i + 0.5) * (w / nWin), h * 0.55 + 0.4, s * (d / 2 + 0.03)); g.add(wn); }
    const wf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.9), winM); wf.position.set(-w / 2 - 0.03, h * 0.55 + 0.4, 0); g.add(wf);
    g.position.set(x, y, z); g.rotation.y = rot;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g); return g;
  };
  house(lhX + 13, lhZ + 3, 9, 6, 3.6, 0.0, white);
  { let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const walls = [paint(0xe9e2d4), paint(0xd8d0c0), paint(0xc9b9a0), paint(0xefece6), paint(0xa9b3b8)];
    for (let z = -700; z < 700; z += 38 + rnd() * 70) { if (Math.abs(z - lhZ) < 45) continue;
      const x = coastX(z) + 75 + rnd() * 90; house(x, z, 7 + rnd() * 6, 5 + rnd() * 3, 3 + rnd() * 2.5, (rnd() - 0.5) * 0.4, walls[Math.floor(rnd() * walls.length)]); } }
  // rocks at the foot of the cliffs and on the beach
  { let sd = 21; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const rm = new THREE.MeshStandardMaterial({ map: rock.d, normalMap: rock.n, roughnessMap: rock.r, color: 0x8d8a85 });
    const rg = new THREE.DodecahedronGeometry(1, 1);
    for (let i = 0; i < 140; i++) { const z = (rnd() - 0.5) * 1800, x = coastX(z) + 5 + rnd() * 40, s = 0.6 + Math.pow(rnd(), 2) * 4.5;
      const m = new THREE.Mesh(rg, rm); m.scale.set(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.5), s * (0.8 + rnd() * 0.6));
      m.position.set(x, terrainY(x, z) - s * 0.25, z); m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); m.castShadow = m.receiveShadow = true; scene.add(m); } }

  // ---------- floats on the water: navigation buoys and a far cargo ship
  const buoyM = new THREE.MeshStandardMaterial({ color: 0xc8261c, roughness: 0.45, metalness: 0.1 });
  const buoyY = new THREE.MeshStandardMaterial({ color: 0xe0b52a, roughness: 0.45, metalness: 0.1 });
  const makeBuoy = (m) => { const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 1.3, 24), m); hull.position.y = 0.15; g.add(hull);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.18, 24), darkM); skirt.position.y = 0.0; g.add(skirt);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6), m); leg.position.set(Math.cos(a) * 0.4, 1.6, Math.sin(a) * 0.4); leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2); g.add(leg); }
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 20), m); top.position.y = 2.75; g.add(top);
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffcc55, emissiveIntensity: 1.2 })); light.position.y = 3.2; g.add(light);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g; };
  const BUOY_AT = [[-18, -42, buoyM], [55, 26, buoyY], [-6, -150, buoyM], [140, -90, buoyY], [-90, 60, buoyM]];
  const buoys = BUOY_AT.map(([x, z, m]) => { const b = makeBuoy(m); b.userData.home = [x, z]; return b; });

  const ship = new THREE.Group();
  { const hullM = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.3 }), boot = new THREE.MeshStandardMaterial({ color: 0x7a2420, roughness: 0.7 });
    const h1 = new THREE.Mesh(new THREE.BoxGeometry(190, 10, 30), hullM); h1.position.y = 6; ship.add(h1);
    const h0 = new THREE.Mesh(new THREE.BoxGeometry(188, 3, 29), boot); h0.position.y = 0.5; ship.add(h0);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 16, 28), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 })); bridge.position.set(-78, 19, 0); ship.add(bridge);
    const cc = [0x8b3a2a, 0x2f5c8a, 0xb88a2e, 0x3d6e4a, 0x9a9a96, 0x6a2f5c];
    let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 12; i++) for (let l = 0; l < 3; l++) { if (rnd() < 0.15) continue; const c = new THREE.Mesh(new THREE.BoxGeometry(12, 2.6, 26), new THREE.MeshStandardMaterial({ color: cc[Math.floor(rnd() * cc.length)], roughness: 0.8 })); c.position.set(-62 + i * 13.2, 12.3 + l * 2.6, 0); ship.add(c); } }
  ship.position.set(900, 0, -3200); ship.rotation.y = 0.35; scene.add(ship);

  // ---------- update and render
  const EAST = new THREE.Vector3(1, 0, 0), NORTH = new THREE.Vector3(0, 0, -1);
  const fwd = new THREE.Vector3();
  function update(state = {}) {
    for (const k of Object.keys(S)) if (state[k] !== undefined) S[k] = state[k];
    seaU.uTime.value = S.time; seaU.uSurgeH.value = S.surgeHeight; seaU.uSurgeX.value = S.surgeX;
    seaU.uCalm.value = S.calm; seaU.uLevel.value = S.level; seaU.uDrift.value = S.drift;
    for (const b of buoys) {
      const [hx, hzz] = b.userData.home, x = hx, z = hzz - S.drift, e = 0.8;
      const y = heightAt(x, z), dx = (heightAt(x + e, z) - y) / e, dz = (heightAt(x, z + e) - y) / e;
      b.position.set(x, y - 0.35, z); b.rotation.set(Math.atan(dz) * 0.8, b.rotation.y, -Math.atan(dx) * 0.8);
    }
    ship.position.y = S.level + 0.2 * Math.sin(S.time * 0.4);
    // the shadow box follows the camera's view
    camera.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); fwd.normalize();
    const c = camera.position.clone().addScaledVector(fwd, 70); c.y = 0;
    sun.target.position.copy(c); sun.position.copy(c).addScaledVector(sunDir, 400);
    sun.target.updateMatrixWorld();
  }
  const render = () => renderer.render(scene, camera);
  update({});
  return { renderer, scene, camera, update, render, heightAt, lighthouse, buoys, ship, sun, sunDir, coastX, terrainY, EAST, NORTH };
}
