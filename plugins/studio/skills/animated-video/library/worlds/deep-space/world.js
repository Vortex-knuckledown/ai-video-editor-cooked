// World "deep-space": deep space far from any planet, built once, shared by every shot. Units are metres.
//
// What is there (never changes):
//   sky        the Milky Way band with its bright core and dark dust lanes, coloured nebula glow (hydrogen red,
//              teal, amber) painted on a sphere at infinity, a distant face-on-ish spiral galaxy, a bright blue-white
//              star that is the key light; three layers of stars at infinity plus a world-fixed layer of nearer
//              stars (parallax when the camera travels)
//   nebulae    9 soft volumetric cloud sheets 1.4-4 km out, in front of the painted sky (depth when you move)
//   field      an asteroid field in a slab about x -1000..1000, y -160..140, z -650..650: ~1150 tumbling rocks
//              (0.4 m to 25 m, the kit's rock surface) and 16 cratered hero rocks (12-38 m) beside the flight
//              corridor, plus drifting dust grains near the corridor. The corridor (radius 22 m round the x axis,
//              y = z = 0) is kept clear so the ship can fly through.
//   ship       a small spacecraft 13.4 m long, 14.6 m across the wings: panelled hull, canopy, swept wings, two
//              nacelles and a main engine with blue exhaust plumes, nav lights (red port, green starboard, white
//              strobe). Nose along its local +z, belly down. Key light from the bright star, blue rim light from
//              behind, a fill from the nebula sky and reflections of the sky on the hull: never black.
//   lighting   key (warm white, shadows in a box that follows the ship), rim (pale blue, opposite side), a warm
//              fill, hemisphere fill, the sky as environment map; a faint dusty haze fades the far rocks into the nebula.
//
// Default flight (when state.ship is not given): shipPath(time) = x -260 + 14 m/s * time, a gentle weave in y (+-5 m)
// and z (+-9 m), banking into its turns. It stays inside the field for time 0..90 s.
//
// update(state) reads (every key optional):
//   time       seconds: the ship's place on its path, the rocks' tumble, the dust drift, the strobe (default 0)
//   ship       {x, y, z, heading, pitch, bank} places the ship by hand instead (heading rad about +y, 0 = nose to +z,
//              PI/2 = nose to +x); any key left out comes from shipPath(time)
//   throttle   0..1 engine glow and plume length (default 0.8)
//   drift      multiplier on the rocks' tumble (default 1)
//   navLights  0..1 (default 1)
//   haze       multiplier on the distance haze (default 1)
//   cast       ignored (the place has no people); createWorld accepts cast=[] for the common contract
// Place world.camera first, then call update(state) or world.render(): rendering keeps the sky centred on the camera
// and hides any small rock the camera would be inside.
//
// Exposes: renderer, scene, camera, update(state), render(), cast ({}),
//   ship (Group: its position/quaternion are the ship's), SHIP_LENGTH 13.4, SHIP_SPAN 14.6,
//   shipPath(time) -> {position, forward, up, side} (pure; side = the ship's right),
//   shipFrame() -> {position, forward, up, side} of the ship now,
//   follow({ahead, side, up, look}) -> {position, target}: a camera place in the ship's own frame (metres; side > 0 is
//     the ship's right, look = metres ahead of the ship's centre to aim at),
//   heroRocks [{position, radius}], clearance(v3) -> metres from v3 to the nearest rock surface,
//   field (Group), nebulae (Group), sky (Group, follows the camera), keyLight, rimLight, starDir (unit Vector3 to the
//   key star), toScreen(v3) -> {x, y, behind} in 1920x1080 px.
export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders, cast = [] } = {}) {
  const W = 1920, H = 1080, SHIP_LENGTH = 13.4, SHIP_SPAN = 14.6, CORRIDOR = 22;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x02030a);
  const HAZE = 0x15130f; scene.fog = new THREE.FogExp2(HAZE, 0.00055);
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 12000);
  camera.position.set(-300, 60, 160); camera.lookAt(-200, 0, 0);

  // ---- the kit's surfaces, all loaded before anything is built
  const TL = new THREE.TextureLoader(), maxA = renderer.capabilities.getMaxAnisotropy();
  const load = async (f, srgb = true, rep = 1) => { const t = await TL.loadAsync(K + f);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxA;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t; };
  const [rockD, rockN, rockR, conD, conN, conR] = await Promise.all([
    load("pbr/rock_diff.jpg"), load("pbr/rock_nor.jpg", false), load("pbr/rock_rough.jpg", false),
    load("pbr/concrete_diff.jpg"), load("pbr/concrete_nor.jpg", false), load("pbr/concrete_rough.jpg", false)]);

  let seed = 90210417; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const Y = new THREE.Vector3(0, 1, 0);

  // ---- shared GLSL noise
  const NOISE = `
    float h3(vec3 p){ p=fract(p*0.3183099+vec3(.1,.2,.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.-2.*f);
      return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<6;i++){ s+=a*vn(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
    float fbm3(vec3 p){ float a=.5,s=0.; for(int i=0;i<3;i++){ s+=a*vn(p); p=p*2.11+vec3(4.1,1.3,7.7); a*=.5; } return s; }`;

  // ---- the sky at infinity: Milky Way, nebula glow, background haze
  const bandAx = new THREE.Vector3(0.32, 0.86, 0.4).normalize();
  const coreDir = new THREE.Vector3(-0.75, 0.05, 0.62); coreDir.addScaledVector(bandAx, -coreDir.dot(bandAx)).normalize();
  const starDir = new THREE.Vector3(0.55, 0.42, 0.72).normalize();
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { ax: { value: bandAx }, core: { value: coreDir }, sdir: { value: starDir }, gain: { value: 1 } },
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 ax; uniform vec3 core; uniform vec3 sdir; uniform float gain; varying vec3 vD; ${NOISE}
      void main(){ vec3 d=normalize(vD); float b=dot(d,ax);
        float c=max(dot(d,core),0.);
        float w=0.11+0.10*c;
        float band=exp(-pow(b/w,2.));
        float n=fbm(d*4.0), n2=fbm(d*13.0+4.0);
        float bulge=exp(-pow(length(d-core)/0.42,2.));
        float lane=smoothstep(0.42,0.68,fbm(d*7.5+2.0))*exp(-pow(b/(w*0.45),2.));
        float mw=(band*(0.30+0.95*n)*(0.55+0.6*n2)+bulge*1.3*(0.5+n))*(1.-0.8*lane);
        vec3 mwc=mix(vec3(0.78,0.76,0.72),vec3(1.0,0.8,0.56),clamp(bulge*1.2+0.25*n2,0.,1.));
        vec3 col=mwc*mw*0.42;
        // nebula glow: three hue families in big soft patches
        float m1=smoothstep(0.56,0.86,fbm(d*1.8+vec3(11.)));
        float m2=smoothstep(0.58,0.88,fbm(d*2.3+vec3(23.)));
        float m3=smoothstep(0.55,0.86,fbm(d*2.0+vec3(37.)));
        float tx=fbm(d*6.0+vec3(5.)), tx2=fbm(d*16.0+vec3(9.));
        col+=vec3(0.72,0.17,0.10)*m1*(0.35+0.9*tx)*(0.7+0.5*tx2)*0.42;
        col+=vec3(0.06,0.42,0.44)*m2*(0.35+0.9*tx2)*0.36;
        col+=vec3(0.85,0.5,0.3)*m3*m1*(0.4+tx)*0.18;
        col+=vec3(0.9,0.75,0.5)*m2*m1*tx2*0.14;
        // general faint glow and a halo round the key star
        col+=vec3(0.030,0.027,0.026)*(0.6+0.8*exp(-pow(b/0.6,2.)));
        float sd=max(dot(d,sdir),0.);
        col+=vec3(0.55,0.7,1.0)*pow(sd,400.)*1.2;
        gl_FragColor=vec4(col*gain,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const sky = new THREE.Group(); scene.add(sky);
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(9000, 96, 48), skyMat); skyDome.renderOrder = -10; skyDome.frustumCulled = false; sky.add(skyDome);

  // round, soft point sprites for stars
  const dotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.62, "rgba(255,255,255,1)");
    gr.addColorStop(0.8, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const tint = () => { const w = rnd(); return w < 0.14 ? [1.0, 0.78, 0.58] : w < 0.32 ? [0.72, 0.84, 1.0] : w < 0.38 ? [1.0, 0.6, 0.5] : [1, 0.97, 0.93]; };
  const tmp = new THREE.Vector3();
  const starLayer = (parent, n, size, bright, bandShare, rMin, rMax) => {
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, th = rnd() * 6.283, q = Math.sqrt(1 - u * u); tmp.set(q * Math.cos(th), u, q * Math.sin(th));
      if (rnd() < bandShare) { tmp.addScaledVector(bandAx, -tmp.dot(bandAx) * (0.78 + 0.22 * rnd())).normalize();
        if (rnd() < 0.35) tmp.lerp(coreDir, 0.3 * rnd()).normalize(); }
      tmp.multiplyScalar(rMin + (rMax - rMin) * rnd()); p.set([tmp.x, tmp.y, tmp.z], i * 3);
      const b = 0.72 * bright * (0.3 + 0.7 * Math.pow(rnd(), 2.2)), tn = tint(); c.set([b * tn[0], b * tn[1], b * tn[2]], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: dotTex, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    m.renderOrder = -8; m.frustumCulled = false; parent.add(m); return m; };
  starLayer(sky, 34000, 2.0, 0.55, 0.5, 8200, 8200);
  starLayer(sky, 9000, 2.8, 0.85, 0.35, 8200, 8200);
  starLayer(sky, 1300, 3.2, 1.0, 0.2, 8200, 8200);
  starLayer(sky, 160, 4.0, 1.0, 0.1, 8200, 8200);
  const nearStars = new THREE.Group(); scene.add(nearStars);
  starLayer(nearStars, 3500, 3.0, 0.9, 0.2, 1500, 6000);

  // a soft glow sprite texture (key star, engines, nav lights)
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(255,255,255,0.7)");
    gr.addColorStop(0.35, "rgba(255,255,255,0.16)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const glow = (color, size, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false })); s.scale.setScalar(size); return s; };
  // the key star, at infinity in the light's direction
  const keyStar = glow(0xa8bce0, 90); keyStar.position.copy(starDir).multiplyScalar(8000); keyStar.renderOrder = -7; sky.add(keyStar);
  
  // the distant spiral galaxy, at infinity
  const galDir = new THREE.Vector3(-0.5, -0.32, -0.8).normalize();
  const galaxy = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; ${NOISE}
      void main(){ vec2 p=vUv*2.-1.; float r=length(p); float th=atan(p.y,p.x);
        float sp=th-3.0*log(r+0.03);
        float arms=pow(0.5+0.5*cos(2.0*sp),3.0);
        float n=fbm(vec3(p*7.,1.3)), n2=fbm(vec3(p*22.,4.));
        float disk=exp(-r*4.2);
        float dust=smoothstep(0.55,0.8,0.5+0.5*cos(2.0*sp+0.9))*smoothstep(0.08,0.3,r);
        vec3 col=vec3(0.75,0.82,0.95)*arms*disk*(0.6+0.9*n)*(0.7+0.6*n2)*(1.-0.6*dust)*1.0;
        col+=vec3(1.0,0.45,0.35)*arms*disk*smoothstep(0.72,0.9,n2)*1.2;
        col+=vec3(1.0,0.86,0.62)*(exp(-r*r*90.)*0.6+disk*0.25);
        float edge=smoothstep(1.0,0.55,r);
        gl_FragColor=vec4(col*edge,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
  galaxy.position.copy(galDir).multiplyScalar(7600); galaxy.lookAt(0, 0, 0); galaxy.rotateX(1.05); galaxy.rotateZ(0.6);
  galaxy.scale.setScalar(1500); galaxy.renderOrder = -9; galaxy.frustumCulled = false; sky.add(galaxy);

  // ---- nebula sheets in front of the sky (they keep their place: parallax and depth)
  const nebulae = new THREE.Group(); scene.add(nebulae);
  const nebMat = (c1, c2, sd) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    uniforms: { c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, sd: { value: sd }, gain: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 c1; uniform vec3 c2; uniform float sd; uniform float gain; varying vec2 vUv; ${NOISE}
      void main(){ vec2 p=vUv*2.-1.; float r=length(p);
        float n=fbm(vec3(p*2.2,sd)), n2=fbm(vec3(p*6.,sd+3.));
        float fall=smoothstep(1.0,0.15,r);
        float dens=smoothstep(0.45,0.9,n*0.9+fall*0.4)*fall;
        vec3 col=mix(c1,c2,smoothstep(0.35,0.75,n2))*dens*(0.55+0.7*n2);
        col*=1.-0.6*smoothstep(0.6,0.8,fbm(vec3(p*4.,sd+9.)));
        gl_FragColor=vec4(min(col*gain*0.24,vec3(0.32)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const NEB = [[0xb8301c, 0xff9a4a], [0x1f8a8a, 0x6de0c0], [0xa02818, 0xe07030], [0xa86040, 0xc8a080], [0x2a7a6a, 0xc0a060],
    [0xb03a20, 0x3a9aa0], [0x2a8a7a, 0xb0d060], [0xc85030, 0x80602a], [0x3a8a90, 0xd0b070]];
  const nebDirs = [];
  NEB.forEach(([a, b], i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nebMat(a, b, i * 7.3 + 1));
    const u = (rnd() * 2 - 1) * 0.8, th = rnd() * 6.283 + i, q = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(q * Math.cos(th), u, q * Math.sin(th)); if (i === 0) d.copy(coreDir).lerp(Y, 0.15).normalize(); if (i === 1) d.set(0.2, -0.85, 0.4).normalize();
    const dist = 1400 + 2600 * rnd(); m.position.copy(d).multiplyScalar(dist); m.scale.set(dist * (0.9 + 0.8 * rnd()), dist * (0.6 + 0.6 * rnd()), 1);
    m.lookAt(0, 0, 0); m.rotateZ(rnd() * 6.283); m.renderOrder = -6; m.frustumCulled = false; nebulae.add(m); nebDirs.push(d); });

  // ---- environment from the sky, so hulls reflect the nebulae and the rocks get a coloured fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envMat = skyMat.clone(); envMat.depthTest = false; envMat.uniforms.gain.value = 2.2;
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), envMat));
  const envRT = pmrem.fromScene(envScene, 0.02, 0.1, 100); scene.environment = envRT.texture;

  // ---- lights
  const keyLight = new THREE.DirectionalLight(0xfff1e2, 2.6); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.03;
  const sc = keyLight.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 260;
  scene.add(keyLight); scene.add(keyLight.target);
  const rimLight = new THREE.DirectionalLight(0xa8ccf0, 2.6); scene.add(rimLight); scene.add(rimLight.target);
  const rimDir = starDir.clone().multiplyScalar(-1).addScaledVector(Y, 0.55).normalize();
  const magentaFill = new THREE.DirectionalLight(0xd07a48, 0.8); scene.add(magentaFill); scene.add(magentaFill.target);
  scene.add(new THREE.HemisphereLight(0x8a8c90, 0x3a2a22, 0.5));

  // ---- rocks: a lumpy, optionally cratered body with smooth normals and per-face box-projected UVs (no stretching)
  const rockGeo = (detail, k, craters = 0) => {
    const g = new THREE.IcosahedronGeometry(1, detail); const p = g.attributes.position, v = new THREE.Vector3(), dir = new THREE.Vector3();
    const f = [rnd() * 2 + 1.2, rnd() * 2 + 1.8, rnd() * 4 + 3.5], ph = [rnd() * 9, rnd() * 9, rnd() * 9];
    const sx = 0.75 + rnd() * 0.5, sy = 0.55 + rnd() * 0.35, sz = 0.85 + rnd() * 0.45;
    const cr = []; for (let i = 0; i < craters; i++) { const u = rnd() * 2 - 1, th = rnd() * 6.283, q = Math.sqrt(1 - u * u);
      cr.push({ c: new THREE.Vector3(q * Math.cos(th), u, q * Math.sin(th)), r: 0.12 + 0.35 * Math.pow(rnd(), 2), d: 0.05 + 0.08 * rnd() }); }
    for (let i = 0; i < p.count; i++) { dir.fromBufferAttribute(p, i).normalize(); v.copy(dir);
      let n = 1 + 0.2 * Math.sin(v.x * f[0] + ph[0]) * Math.cos(v.y * f[1] + ph[1]) + 0.1 * Math.sin(v.z * f[2] + ph[2] + v.x * 3)
        + 0.04 * Math.sin(v.x * 11 + v.y * 7 + k) * Math.sin(v.z * 9 - k)
        - 0.12 * Math.max(0, Math.sin(v.x * 4 + k) * Math.sin(v.y * 3.5 + k * 2) - 0.55) * 4;
      for (const c of cr) { const a = Math.acos(THREE.MathUtils.clamp(dir.dot(c.c), -1, 1)) / c.r;
        if (a < 1) n += (a * a - 1) * c.d; else if (a < 1.6) n += c.d * 0.35 * Math.sin((a - 1) / 0.6 * Math.PI); }
      v.multiplyScalar(n); v.x *= sx; v.y *= sy; v.z *= sz; p.setXYZ(i, v.x, v.y, v.z); }
    // smooth normals: average the face normals of every vertex sharing a position
    const acc = new Map(), key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      fn.subVectors(c, b).cross(a.clone().sub(b)); // area weighted
      for (const j of [i, i + 1, i + 2]) { const kk = key(p.getX(j), p.getY(j), p.getZ(j)); const e = acc.get(kk); if (e) e.add(fn); else acc.set(kk, fn.clone()); } }
    const nrm = new Float32Array(p.count * 3), uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { const e = acc.get(key(p.getX(i), p.getY(i), p.getZ(i))).clone().normalize(); nrm.set([e.x, e.y, e.z], i * 3); }
    for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      fn.subVectors(c, b).cross(a.clone().sub(b)); const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
      for (const j of [i, i + 1, i + 2]) { const x = p.getX(j), y = p.getY(j), z = p.getZ(j);
        const [s, t] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y]; uv.set([s * 0.55 + k * 0.37, t * 0.55 + k * 0.21], j * 2); } }
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere(); return g; };

  const rockMat = new THREE.MeshStandardMaterial({ map: rockD, normalMap: rockN, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: rockR,
    roughness: 1, metalness: 0, color: 0x9a9aa0, envMapIntensity: 0.9 });
  const field = new THREE.Group(); scene.add(field);
  const rocks = [], VAR = 6, ROCKS = 1150, rockData = [], placed = [];
  const axisDist = (x, y, z) => Math.hypot(y, z);
  const clearOf = (pos, r) => { for (const q of placed) if (q.p.distanceTo(pos) < q.r + r + 2) return false; return true; };
  // hero rocks first: big, cratered, flanking the corridor at intervals
  const heroRocks = [];
  const heroSlots = [[-520, 70, -30], [-400, -60, 25], [-300, 52, 18], [-190, -95, -20], [-110, 64, -40], [-30, -48, 30], [60, 88, 10],
    [140, -62, -28], [230, 50, 42], [320, -80, 8], [420, 70, -22], [520, -54, -40], [-250, 140, -70], [80, -150, 60], [300, 160, 70], [-60, 30, -95]];
  heroSlots.forEach(([x, z, y], i) => { const r = 12 + 26 * rnd(); const pos = new THREE.Vector3(x, y, z);
    const need = CORRIDOR + r * 1.15 + 6; const ad = axisDist(x, y, z); if (ad < need) pos.multiplyScalar(1).setZ(z * need / ad).setY(y * need / ad);
    const m = new THREE.Mesh(rockGeo(36, i * 1.7, 18 + Math.floor(rnd() * 14)), rockMat.clone());
    m.material.color.setHSL(0.6, 0.03 * rnd(), 0.55 + 0.12 * rnd());
    m.position.copy(pos); m.scale.setScalar(r); m.castShadow = m.receiveShadow = true;
    m.userData = { ax: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * 0.03, a0: rnd() * 6.283 };
    field.add(m); heroRocks.push({ position: pos, radius: r * 1.15, mesh: m }); placed.push({ p: pos, r: r * 1.15 }); });
  for (let k = 0; k < VAR; k++) { const im = new THREE.InstancedMesh(rockGeo(9, k * 2.3, k % 2 ? 5 : 0), rockMat, Math.ceil(ROCKS / VAR));
    im.frustumCulled = false; im.castShadow = im.receiveShadow = true; im.instanceColor = null; field.add(im); rocks.push(im); }
  const colA = new THREE.Color();
  let tries = 0;
  while (rockData.length < ROCKS && tries < ROCKS * 30) { tries++;
    const near = rnd() < 0.3;
    const x = -1000 + 2000 * rnd();
    let y, z;
    if (near) { const a = rnd() * 6.283, d = CORRIDOR + 4 + 90 * Math.pow(rnd(), 1.5); y = Math.sin(a) * d * 0.7; z = Math.cos(a) * d; }
    else { y = (rnd() + rnd() + rnd() - 1.5) * 130; z = -650 + 1300 * rnd(); y = THREE.MathUtils.clamp(y, -160, 140); }
    const big = rnd(); const s = near ? 0.4 + 5.5 * Math.pow(big, 4) : 0.8 + 24 * Math.pow(big, 6);
    const pos = new THREE.Vector3(x, y, z);
    if (axisDist(x, y, z) < CORRIDOR + s * 1.3 + 1) continue;
    if (s > 2.5 && !clearOf(pos, s * 1.3)) continue;
    if (s > 2.5) placed.push({ p: pos, r: s * 1.3 });
    const i = rockData.length, kv = i % VAR;
    rockData.push({ p: pos, s, ax: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * (s > 6 ? 0.05 : 0.35),
      a0: rnd() * 6.283, k: kv, idx: Math.floor(i / VAR), sq: new THREE.Vector3(1, 1, 1) });
    colA.setHSL(0.6, 0.04 * rnd(), 0.5 + 0.3 * rnd()); rocks[kv].setColorAt(Math.floor(i / VAR), colA); }
  for (let k = 0; k < VAR; k++) { rocks[k].count = rockData.filter(r => r.k === k).length; if (rocks[k].instanceColor) rocks[k].instanceColor.needsUpdate = true; }

  // dust grains near the corridor (they streak past a moving camera, reading as depth)
  const dustN = 9000, dp = new Float32Array(dustN * 3), dcol = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { const a = rnd() * 6.283, d = 4 + 170 * Math.pow(rnd(), 0.8);
    dp.set([-1000 + 2000 * rnd(), Math.sin(a) * d * 0.7, Math.cos(a) * d], i * 3); const b = 0.25 + 0.4 * rnd(); dcol.set([b, b * 0.92, b * 0.85], i * 3); }
  const dustG = new THREE.BufferGeometry(); dustG.setAttribute("position", new THREE.BufferAttribute(dp, 3)); dustG.setAttribute("color", new THREE.BufferAttribute(dcol, 3));
  const dust = new THREE.Points(dustG, new THREE.PointsMaterial({ size: 0.09, sizeAttenuation: true, vertexColors: true, map: dotTex, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
  dust.frustumCulled = false; field.add(dust);

  // ---- the spacecraft
  const ship = new THREE.Group(); scene.add(ship);
  const hullTex = (() => { const S = 1024, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
    g.drawImage(conD.image, 0, 0, S, S); g.globalCompositeOperation = "screen"; g.fillStyle = "rgba(200,205,212,0.82)"; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = "multiply"; g.fillStyle = "rgb(222,226,232)"; g.fillRect(0, 0, S, S); g.globalCompositeOperation = "source-over";
    // panel plates of slightly different shades, then the seams between them
    for (let j = 0; j < 16; j++) for (let i = 0; i < 12; i++) { const l = 205 + Math.floor(rnd() * 30); g.fillStyle = `rgba(${l},${l + 2},${l + 5},0.35)`;
      g.fillRect(i * S / 12, j * S / 16, S / 12, S / 16); }
    g.strokeStyle = "rgba(40,44,52,0.75)"; g.lineWidth = 2.2;
    for (let j = 0; j <= 16; j++) { g.beginPath(); g.moveTo(0, j * S / 16); g.lineTo(S, j * S / 16); g.stroke(); }
    for (let j = 0; j < 16; j++) for (let i = 0; i <= 12; i++) { const x = i * S / 12 + (j % 2 ? S / 24 : 0); g.beginPath(); g.moveTo(x, j * S / 16); g.lineTo(x, (j + 1) * S / 16); g.stroke(); }
    // rivets, hatches, a livery stripe and soot near the tail
    g.fillStyle = "rgba(60,64,72,0.6)"; for (let i = 0; i < 1400; i++) { g.fillRect(rnd() * S, Math.floor(rnd() * 17) * S / 16 - 1, 2, 2); }
    g.fillStyle = "rgba(232,104,36,0.95)"; g.fillRect(0, S * 0.56, S, S * 0.035); g.fillStyle = "rgba(30,34,44,0.9)"; g.fillRect(0, S * 0.6, S, S * 0.012);
    for (let i = 0; i < 6; i++) { g.strokeStyle = "rgba(30,34,40,0.9)"; g.lineWidth = 3; g.strokeRect(rnd() * S * 0.9, S * (0.25 + 0.4 * rnd()), 46, 30); }
    const sg = g.createLinearGradient(0, 0, 0, S * 0.25); sg.addColorStop(0, "rgba(30,26,24,0.55)"); sg.addColorStop(1, "rgba(30,26,24,0)"); g.fillStyle = sg; g.fillRect(0, 0, S, S * 0.25);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxA; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
  conN.repeat.set(3, 3); conR.repeat.set(3, 3);
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTex, normalMap: conN, normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: conR,
    roughness: 0.62, metalness: 0.45, envMapIntensity: 1.2, color: 0xc9ccd2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.45, metalness: 0.8, normalMap: conN, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe0682a, roughness: 0.5, metalness: 0.3, envMapIntensity: 1.0 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1622, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: 2.4, emissive: 0x0c3444, emissiveIntensity: 0.6 });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.95, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = ship) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  // fuselage: a lathe profile along +z, flattened
  const prof = [[0, -6.2], [0.82, -6.05], [1.2, -5.4], [1.34, -3.6], [1.36, -0.6], [1.24, 1.8], [1.0, 3.6], [0.66, 5.2], [0.3, 6.5], [0.0, 7.2]].map(([r, y]) => new THREE.Vector2(r, y));
  const fusG = new THREE.LatheGeometry(prof, 64); fusG.rotateX(Math.PI / 2); fusG.scale(1.15, 0.78, 1);
  { const uv = fusG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.4); }
  add(fusG, hullMat);
  // canopy
  const canG = new THREE.SphereGeometry(0.72, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2); canG.scale(0.95, 0.62, 2.3);
  add(canG, glassMat, 0, 0.72, 3.0);
  const frameG = new THREE.TorusGeometry(0.69, 0.05, 8, 48, Math.PI); frameG.scale(0.95, 0.62, 1);
  for (const z of [2.0, 3.0, 4.0]) { const f = add(frameG, darkMat, 0, 0.72, z); f.scale.set(1, 1 - Math.abs(z - 3.0) * 0.28, 1); }
  // wings: swept, bevelled, slight dihedral
  const wingShape = new THREE.Shape([[0.9, 1.6], [3.2, 0.2], [7.2, -2.6], [7.3, -3.7], [6.4, -3.9], [0.9, -4.9]].map(([x, z]) => new THREE.Vector2(x, z)));
  const wingG = new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 2, curveSegments: 4 });
  wingG.rotateX(Math.PI / 2); wingG.translate(0, 0.08, 0);
  { const p = wingG.attributes.position, uv = wingG.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.14, p.getZ(i) * 0.14); }
  const wingR = add(wingG, hullMat, 0, -0.25, 0); wingR.rotation.z = -0.06; // nose +z, so +x is the ship's left; mirror for the other side
  const wingL = add(wingG, hullMat, 0, -0.25, 0); wingL.scale.x = -1; wingL.rotation.z = 0.06;
  for (const s of [1, -1]) { // wing stripes, wingtip pods, nav lights
    const st = add(new THREE.BoxGeometry(1.6, 0.04, 0.32), accentMat, s * 5.6, -0.03 - 0.25 + 0.06 + 5.6 * 0.06, -2.55); st.rotation.y = s * 0.62; st.rotation.z = -s * 0.06;
    add(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 16).rotateX(Math.PI / 2), darkMat, s * 7.25, -0.25 + 7.25 * 0.06 + 0.08, -3.0);
  }
  // nacelles with intakes and nozzles
  const nozzles = [];
  const bell = new THREE.LatheGeometry([[0.28, 0], [0.44, -0.2], [0.58, -0.62], [0.62, -0.8]].map(([r, y]) => new THREE.Vector2(r, y)), 32); bell.rotateX(-Math.PI / 2);
  for (const s of [1, -1]) {
    const nac = new THREE.CylinderGeometry(0.58, 0.66, 5.4, 40, 1); nac.rotateX(Math.PI / 2);
    { const uv = nac.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 1.3); }
    add(nac, hullMat, s * 2.35, -0.3, -2.3);
    add(new THREE.TorusGeometry(0.6, 0.09, 12, 40), darkMat, s * 2.35, -0.3, 0.42);
    add(new THREE.CircleGeometry(0.56, 32), darkMat, s * 2.35, -0.3, 0.3);
    add(new THREE.BoxGeometry(0.9, 0.28, 2.6), darkMat, s * 1.55, -0.12, -2.0); // pylon
    const n = add(bell.clone(), nozzleMat, s * 2.35, -0.3, -5.0); nozzles.push({ x: s * 2.35, y: -0.3, z: -5.0 - 0.8, r: 0.6 });
    add(new THREE.TorusGeometry(0.62, 0.05, 8, 40), accentMat, s * 2.35, -0.3, -4.0);
  }
  { const mainBell = new THREE.LatheGeometry([[0.4, 0], [0.6, -0.25], [0.78, -0.75], [0.84, -0.95]].map(([r, y]) => new THREE.Vector2(r, y)), 40); mainBell.rotateX(-Math.PI / 2);
    add(mainBell, nozzleMat, 0, 0, -5.95); nozzles.push({ x: 0, y: 0, z: -6.9, r: 0.82 }); }
  // tail fin
  const finShape = new THREE.Shape([[0, 0], [-2.2, 0], [-3.1, 2.3], [-2.4, 2.4], [-0.2, 0.6]].map(([z, y]) => new THREE.Vector2(z, y)));
  const finG = new THREE.ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2 });
  finG.rotateY(-Math.PI / 2); finG.translate(0.06, 0.6, -2.2);
  { const p = finG.attributes.position, uv = finG.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) * 0.2, p.getY(i) * 0.2); }
  add(finG, hullMat, 0, 0, 0);
  add(new THREE.BoxGeometry(0.2, 0.12, 0.75), accentMat, 0, 2.97, -4.95);
  // greebles: dorsal spine and blocks, antennas, a ventral sensor, RCS quads
  add(new THREE.BoxGeometry(0.5, 0.22, 3.4), darkMat, 0, 1.0, -1.4);
  for (const [x, z, w, d] of [[0.55, -0.6, 0.4, 0.8], [-0.6, -1.9, 0.45, 0.6], [0.5, -3.0, 0.35, 1.0], [-0.45, 0.4, 0.3, 0.5]]) add(new THREE.BoxGeometry(w, 0.16, d), darkMat, x, 0.98, z);
  add(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), darkMat, 0.35, 1.6, -3.6);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), darkMat, -0.3, 1.45, -4.3);
  { const dish = add(new THREE.SphereGeometry(0.35, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), darkMat, 0, -1.0, 2.4); dish.rotation.x = Math.PI; }
  add(new THREE.BoxGeometry(1.1, 0.25, 2.2), darkMat, 0, -1.02, -1.4);
  for (const s of [1, -1]) for (const z of [4.4, -4.6]) add(new THREE.BoxGeometry(0.18, 0.18, 0.18), darkMat, s * 1.05, 0.15, z);

  // engine glow: hot discs in the nozzles, plumes and halos
  const plumeMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
    uniforms: { k: { value: 0.8 }, len: { value: 6 } },
    vertexShader: `uniform float len; varying float vA; varying vec3 vN; varying vec3 vV;
      void main(){ vA=clamp(-position.z/len,0.,1.); vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float k; varying float vA; varying vec3 vN; varying vec3 vV;
      void main(){ float core=pow(abs(dot(normalize(vN),normalize(vV))),1.6); float a=pow(1.-vA,2.2);
        vec3 col=mix(vec3(0.2,0.38,0.9),vec3(0.45,0.62,0.95),core*(1.-vA))*a*core*k*0.45;
        gl_FragColor=vec4(col,1.); }` });
  const engine = []; const hotMat = new THREE.MeshBasicMaterial({ color: 0x6a9ad8, toneMapped: false, side: THREE.DoubleSide });
  for (const n of nozzles) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(n.r * 0.82, 32), hotMat); disc.position.set(n.x, n.y, n.z + 0.55); disc.rotation.y = Math.PI; ship.add(disc);
    const L = 1; const pg = new THREE.ConeGeometry(n.r * 0.85, L, 32, 1, true); pg.translate(0, L / 2, 0); pg.rotateX(-Math.PI / 2);
    const pm = plumeMat.clone(); pm.uniforms.len.value = L; const plume = new THREE.Mesh(pg, pm); plume.position.set(n.x, n.y, n.z + 0.3); ship.add(plume);
    const halo = glow(0x8fb8ff, n.r * 5, 0.9); halo.position.set(n.x, n.y, n.z - 0.2); ship.add(halo);
    const pl = new THREE.PointLight(0x8fb4ff, 6, 14, 2); pl.position.set(n.x, n.y, n.z - 1.2); ship.add(pl);
    engine.push({ plume, halo, pl, r: n.r }); }
  // nav lights
  const nav = [];
  const navL = (c, x, y, z, sz) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); b.position.set(x, y, z); ship.add(b);
    const g = glow(c, sz, 0.9); g.position.set(x, y, z); ship.add(g); nav.push({ g, b, sz }); return g; };
  navL(0xff2a2a, 7.32, 0.27, -1.7, 0.7); navL(0x2aff6a, -7.32, 0.27, -1.7, 0.7); // +x is the ship's port (left) side with nose to +z
  const strobe = navL(0xffffff, 0, 3.08, -5.25, 0.9);
  // a soft cockpit glow under the canopy
  const cockpitLight = new THREE.PointLight(0x6ad8ff, 1.2, 3.5, 2); cockpitLight.position.set(0, 0.9, 3.0); ship.add(cockpitLight);
  ship.traverse(o => { if (o.isMesh && o.material === hotMat) o.castShadow = false; });

  // ---- placing things
  const shipPath = (time = 0) => { const t = time;
    const position = new THREE.Vector3(-260 + 14 * t, 5 * Math.sin(0.19 * t), 9 * Math.sin(0.11 * t + 0.5));
    const forward = new THREE.Vector3(14, 5 * 0.19 * Math.cos(0.19 * t), 9 * 0.11 * Math.cos(0.11 * t + 0.5)).normalize();
    const lat = -9 * 0.11 * 0.11 * Math.sin(0.11 * t + 0.5); // sideways acceleration -> bank into the turn
    const bank = THREE.MathUtils.clamp(-lat * 0.9, -0.5, 0.5);
    const side0 = new THREE.Vector3().crossVectors(forward, Y).normalize(); // ship's right
    const up = Y.clone().applyAxisAngle(forward, bank); const side = side0.applyAxisAngle(forward, bank);
    return { position, forward, up, side, bank }; };
  const qa = new THREE.Quaternion(), m4 = new THREE.Matrix4(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), zero = new THREE.Vector3();
  const frame = { position: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1), up: Y.clone(), side: new THREE.Vector3(-1, 0, 0) };
  const placeShip = (s) => { const p = shipPath(s.time ?? 0);
    if (s.ship) { const o = s.ship;
      p.position.set(o.x ?? p.position.x, o.y ?? p.position.y, o.z ?? p.position.z);
      if (o.heading != null || o.pitch != null || o.bank != null) {
        const e = new THREE.Euler(-(o.pitch ?? 0), o.heading ?? Math.PI / 2, -(o.bank ?? 0), "YXZ"); const q = new THREE.Quaternion().setFromEuler(e);
        p.forward.set(0, 0, 1).applyQuaternion(q); p.up.set(0, 1, 0).applyQuaternion(q); p.side.set(-1, 0, 0).applyQuaternion(q); } }
    ship.position.copy(p.position);
    // basis: local +z = forward, +y = up, +x = -side (the ship's left)
    const left = p.side.clone().negate(); m4.makeBasis(left, p.up, p.forward); ship.quaternion.setFromRotationMatrix(m4);
    frame.position.copy(p.position); frame.forward.copy(p.forward); frame.up.copy(p.up); frame.side.copy(p.side); };
  const shipFrame = () => ({ position: frame.position.clone(), forward: frame.forward.clone(), up: frame.up.clone(), side: frame.side.clone() });
  const follow = ({ ahead = 0, side = 20, up = 2, look = 0 } = {}) => {
    const f = frame; const position = f.position.clone().addScaledVector(f.forward, ahead).addScaledVector(f.side, side).addScaledVector(Y, up);
    return { position, target: f.position.clone().addScaledVector(f.forward, look) }; };
  const clearance = (v) => { let d = Infinity; for (const h of heroRocks) d = Math.min(d, v.distanceTo(h.position) - h.radius);
    for (const r of rockData) d = Math.min(d, v.distanceTo(r.p) - r.s * 1.3); return d; };
  const toScreen = v => { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * W, y: (0.5 - p.y * 0.5) * H, behind: p.z > 1 }; };

  let lastTime = 0, lastDrift = 1;
  const poseRocks = () => { const t = lastTime * lastDrift, cp = camera.position;
    for (const r of rockData) { qa.setFromAxisAngle(r.ax, r.a0 + r.spin * t);
      const hide = cp.distanceTo(r.p) < r.s * 1.4 + camera.near + 0.5; sv.setScalar(hide ? 0 : r.s);
      rocks[r.k].setMatrixAt(r.idx, m4.compose(r.p, qa, sv)); }
    for (const im of rocks) im.instanceMatrix.needsUpdate = true;
    for (const h of heroRocks) { const u = h.mesh.userData; h.mesh.quaternion.setFromAxisAngle(u.ax, u.a0 + u.spin * t); } };

  function fit() {
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    // lights follow the ship so its shadows are crisp wherever it is
    const c = frame.position;
    keyLight.position.copy(c).addScaledVector(starDir, 120); keyLight.target.position.copy(c); keyLight.target.updateMatrixWorld();
    rimLight.position.copy(c).addScaledVector(rimDir, 120); rimLight.target.position.copy(c); rimLight.target.updateMatrixWorld();
    magentaFill.position.copy(c).addScaledVector(nebDirs[0], 120); magentaFill.target.position.copy(c); magentaFill.target.updateMatrixWorld();
    poseRocks();
  }

  function update(s = {}) {
    const t = s.time ?? 0; lastTime = t; lastDrift = s.drift ?? 1;
    placeShip(s);
    const k = THREE.MathUtils.clamp(s.throttle ?? 0.8, 0, 1);
    for (const e of engine) { const L = 2 + 7 * k; e.plume.scale.set(1, 1, L); e.plume.material.uniforms.k.value = 0.25 + k;
      e.halo.visible = false; e.pl.intensity = 2 + 7 * k; }
    hotMat.color.setRGB(0.3 + 0.2 * k, 0.5 + 0.2 * k, 0.85);
    const nv = s.navLights ?? 1; const blink = (t % 1.3) < 0.12 ? 1 : 0.05;
    for (const n of nav) { n.g.material.opacity = 0.55 * nv; n.b.visible = nv > 0.01; }
    strobe.material.opacity = nv * blink; strobe.scale.setScalar(0.9 * (0.6 + 0.8 * blink));
    scene.fog.density = 0.00055 * (s.haze ?? 1);
    dust.position.x = -t * 0.6; // the grains drift slowly
    scene.updateMatrixWorld();
    fit();
  }
  const render = () => { fit(); renderer.render(scene, camera); };
  update({});

  return { renderer, scene, camera, update, render, cast: {}, ship, SHIP_LENGTH, SHIP_SPAN, shipPath, shipFrame, follow,
    heroRocks: heroRocks.map(h => ({ position: h.position.clone(), radius: h.radius })), clearance, field, nebulae, sky,
    keyLight, rimLight, starDir: starDir.clone(), toScreen };
}
