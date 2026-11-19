// World "solar-system": the solar system seen from outside, built once, shared by every shot.
//
// Not to scale (distances compressed, planets enlarged so each one reads), but in the right order and with
// the right looks. Units are arbitrary "world units". The Sun sits at the origin; orbits lie close to the
// y = 0 plane (small real-ish inclinations), planets go round anticlockwise seen from +y (from above).
//   Sun        radius 12, a granulating surface, corona glow; the only light (a point light with shadows)
//   mercury    r 1.0  orbit  30   moon-map surface, grey-brown
//   venus      r 2.0  orbit  42   thick pale-yellow cloud deck, soft haze
//   earth      r 2.2  orbit  58   photographic day/night maps, specular ocean, clouds, blue atmosphere; the Moon
//   mars       r 1.4  orbit  76   rust surface over real crater relief, polar caps
//   belt       orbit 90..108      ~3000 rocks with the kit's rock surface, plus dust
//   jupiter    r 7.0  orbit 140   bands, turbulence, the Great Red Spot; Io, Europa, Ganymede, Callisto
//   saturn     r 6.0  orbit 192   pale bands, rings with the Cassini division, ring shadow and planet shadow; Titan
//   uranus     r 3.6  orbit 238   pale cyan, tipped on its side, faint rings
//   neptune    r 3.4  orbit 272   deep blue, a dark spot and white cloud streaks
//
// update(state) reads (every key optional):
//   time        seconds; drives every orbit, every spin, the Sun's surface and the belt (default 0)
//   speed       multiplier on orbital motion (default 1: the Earth takes 240 s for one orbit)
//   spinSpeed   multiplier on the planets' turn about their axes (default 1: an Earth day is 30 s)
//   angles      {<planet id>: rad} fixes a planet's place on its orbit instead of time (0 = +x)
//   orbits      0..1, the faint orbit lines (default 1 = shown faintly; 0 = hidden)
//   highlight   a planet id: its orbit line drawn brighter (default none)
//   belt        0..1, asteroid belt visibility (default 1)
//   sunGlow     multiplier on the Sun's corona and glare (default 1)
//   fill        0..1, lifts the night sides so a dark limb still reads (default 0.15)
//   cast        ignored (the place has no people); createWorld accepts cast=[] for the common contract
// Place world.camera first, then call update(state) (or world.render()): both fit the camera's
// near/far planes to whatever is closest and keep the star sphere centred on the camera.
//
// Exposes: renderer, scene, camera, update(state), render(), cast ({}), sun (Object3D at origin), SUN_R,
//   planets.<id> = {id, group (centre, not tilted; children move with the planet), body (tilted, spinning),
//                   radius, orbit, position (Vector3, current centre)} for the eight planets,
//   moons.<id> = {object, radius, parent} for moon, io, europa, ganymede, callisto, titan,
//   ids (the eight planet ids in order), position(id) -> Vector3 (planet or moon centre, current),
//   orbitPosition(id, time, speed=1) -> Vector3 where a planet will be (pure, no side effects; for shot planning),
//   velocity(id) -> unit Vector3 along the planet's motion now, outward(id) -> unit Vector3 away from the Sun,
//   viewFrom(id, {dist, side, up, back}) -> {position, target}: a camera place by a planet, `dist` in planet
//     radii (default 4), side +1/-1 sets which side of the motion, back 0..1 moves round to the night side,
//   belt (Group), orbitLines (Group), stars (Group), toScreen(v3) -> {x, y, behind} in 1920x1080 px.
export async function createWorld({ THREE, canvas, K = "./assets/kit/", loaders, cast = [] } = {}) {
  const W = 1920, H = 1080, SUN_R = 12;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 9000);
  camera.position.set(0, 160, 380); camera.lookAt(0, 0, 0);

  // ---- textures from the kit, all loaded before anything is built
  const TL = new THREE.TextureLoader();
  const maxA = renderer.capabilities.getMaxAnisotropy();
  const load = async (f, srgb = true) => { const t = await TL.loadAsync(K + f);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxA;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; return t; };
  const [dayT, nightT, specT, cloudT, moonT, rockD, rockN, rockR] = await Promise.all([
    load("textures/earth_day.jpg"), load("textures/earth_night.png"), load("textures/earth_specular.jpg", false),
    load("textures/earth_clouds.png"), load("textures/moon.jpg"),
    load("pbr/rock_diff.jpg"), load("pbr/rock_nor.jpg", false), load("pbr/rock_rough.jpg", false)]);
  moonT.wrapT = THREE.ClampToEdgeWrapping;

  const NOISE = `
    float h3(vec3 p){ p=fract(p*0.3183099+vec3(.1,.2,.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
    float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
  `;
  const time = { value: 0 };
  const fillU = { value: 0.15 };

  // ---- a lit surface (MeshStandardMaterial, so it takes the Sun's light and shadows) whose colour comes from
  //      a procedural function of the object-space direction `p`; `base` is the map's colour if there is one
  const SAT_RING = { centre: { value: new THREE.Vector3() }, normal: { value: new THREE.Vector3(0, 1, 0) }, R: { value: 6 } };
  const RING_DENSITY = `
    float ringD(float r){   // r in Saturn radii
      if(r<1.24||r>2.27) return 0.0;
      float d=0.0;
      d+=smoothstep(1.24,1.30,r)*(1.0-smoothstep(1.50,1.53,r))*0.18;          // C ring, faint
      d+=smoothstep(1.52,1.56,r)*(1.0-smoothstep(1.93,1.95,r))*0.92;          // B ring, dense
      d+=smoothstep(2.02,2.04,r)*(1.0-smoothstep(2.25,2.27,r))*0.62;          // A ring
      d*=1.0-0.85*(smoothstep(2.205,2.212,r)*(1.0-smoothstep(2.218,2.225,r)));// Encke gap
      float fine=0.72+0.28*sin(r*610.0)*sin(r*237.0+1.3)+0.12*sin(r*1430.0);
      return clamp(d*fine,0.0,1.0);
    }`;
  function surface(kind, body, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ map: opts.map || null, roughness: opts.rough ?? 0.92, metalness: 0,
      color: 0xffffff });
    m.customProgramCacheKey = () => "planet-" + kind;
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = time; sh.uniforms.uFill = fillU;
      sh.uniforms.ringC = SAT_RING.centre; sh.uniforms.ringN = SAT_RING.normal; sh.uniforms.ringR = SAT_RING.R;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObj; varying vec3 vWP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position; vWP = (modelMatrix*vec4(transformed,1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vObj; varying vec3 vWP; uniform float uTime; uniform float uFill;
          uniform vec3 ringC; uniform vec3 ringN; uniform float ringR;
          ${NOISE}
          ${RING_DENSITY}
          vec3 surf(vec3 p, vec3 base){ ${body} }`)
        .replace("#include <map_fragment>", "#include <map_fragment>\n diffuseColor.rgb = surf(normalize(vObj), diffuseColor.rgb);")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uFill * 0.06;");
    };
    return m;
  }
  // longitude helper used by several bodies
  const LON = `float lon=atan(p.z,p.x);`;

  const SURF = {
    mercury: `float g=fbm(p*14.0); return base*vec3(0.80,0.74,0.68)*(0.85+0.3*g);`,
    venus: `${LON}
      vec3 q=p+0.35*vec3(fbm(p*2.0+uTime*0.004),fbm(p*2.0+7.0),fbm(p*2.0+3.0));
      float s=fbm(vec3(q.x*3.0,q.y*9.0,q.z*3.0)); float c=fbm(q*7.0);
      vec3 col=mix(vec3(0.80,0.66,0.44),vec3(0.97,0.91,0.76),smoothstep(0.3,0.75,s));
      col=mix(col,vec3(0.72,0.58,0.40),0.25*smoothstep(0.55,0.8,c)); return col;`,
    mars: `float lum=dot(base,vec3(0.333)); float g=fbm(p*3.2); float g2=fbm(p*16.0);
      vec3 col=mix(vec3(0.78,0.40,0.20),vec3(0.42,0.22,0.13),smoothstep(0.45,0.62,g));
      col=mix(col,vec3(0.85,0.58,0.38),0.25*smoothstep(0.6,0.8,g2));
      col*=0.45+0.85*lum;
      float cap=smoothstep(0.86,0.9,abs(p.y)+0.05*(fbm(p*9.0)-0.5));
      return mix(col,vec3(0.95,0.93,0.9),cap);`,
    jupiter: `${LON}
      float wl=p.y+0.035*(fbm(vec3(p.x*5.0,p.y*16.0,p.z*5.0)+vec3(uTime*0.01,0.0,0.0))-0.5)
                  +0.012*sin(lon*9.0+p.y*40.0);
      float b=wl*10.5; float i=floor(b); float f=fract(b);
      vec3 P0=vec3(0.92,0.86,0.74), P1=vec3(0.76,0.58,0.42), P2=vec3(0.50,0.33,0.22), P3=vec3(0.84,0.55,0.36), P4=vec3(0.64,0.52,0.44);
      float hA=h3(vec3(i,3.1,7.7)), hB=h3(vec3(i+1.0,3.1,7.7));
      vec3 cA=hA<0.25?P0:hA<0.5?P1:hA<0.7?P2:hA<0.85?P3:P4;
      vec3 cB=hB<0.25?P0:hB<0.5?P1:hB<0.7?P2:hB<0.85?P3:P4;
      vec3 col=mix(cA,cB,smoothstep(0.55,1.0,f));
      col=mix(col,P0,exp(-pow(wl/0.09,2.0))*0.7);                   // the bright equatorial zone
      float tur=fbm(vec3(p.x*9.0,p.y*42.0,p.z*9.0)+vec3(uTime*0.02,0.0,0.0));
      col*=0.84+0.3*tur;
      col=mix(col,vec3(0.55,0.55,0.58),smoothstep(0.72,0.96,abs(p.y))*0.75);   // grey-blue poles
      // the Great Red Spot, 22 deg south
      vec3 c=normalize(vec3(cos(1.2)*0.927,-0.375,sin(1.2)*0.927));
      vec3 e=normalize(cross(vec3(0,1,0),c)); vec3 n=cross(c,e);
      vec3 d=p-c; float ex=dot(d,e)/0.16, ny=dot(d,n)/0.085; float q=ex*ex+ny*ny;
      float ang=atan(ny,ex)+q*2.5; float sw=0.75+0.25*sin(ang*3.0+fbm(p*30.0)*4.0);
      col=mix(col,vec3(0.78,0.36,0.22)*sw,smoothstep(1.0,0.45,q)*step(0.0,dot(p,c)));
      col=mix(col,vec3(0.93,0.86,0.76),smoothstep(1.35,1.0,q)*smoothstep(0.75,1.0,q)*0.5*step(0.0,dot(p,c)));
      return col*0.82;`,
    saturn: `${LON}
      float wl=p.y+0.015*(fbm(vec3(p.x*5.0,p.y*18.0,p.z*5.0))-0.5);
      float b=wl*13.0; float i=floor(b); float f=fract(b);
      float hA=h3(vec3(i,5.3,1.1)), hB=h3(vec3(i+1.0,5.3,1.1));
      vec3 cA=mix(vec3(0.72,0.60,0.42),vec3(0.93,0.84,0.64),hA), cB=mix(vec3(0.72,0.60,0.42),vec3(0.93,0.84,0.64),hB);
      vec3 col=mix(cA,cB,smoothstep(0.5,1.0,f));
      col*=0.9+0.16*fbm(vec3(p.x*8.0,p.y*40.0,p.z*8.0));
      col=mix(col,vec3(0.62,0.66,0.66),smoothstep(0.8,0.97,abs(p.y))*0.6);
      // the rings' shadow on the globe
      vec3 L=normalize(-vWP); float dn=dot(L,ringN);
      if(abs(dn)>1e-4){ float t=dot(ringC-vWP,ringN)/dn; if(t>0.0){ vec3 hit=vWP+L*t;
        float r=length(hit-ringC)/ringR; col*=1.0-0.85*ringD(r); } }
      return col;`,
    uranus: `float s=0.96+0.04*sin(p.y*22.0+fbm(p*4.0)*2.0)+0.03*fbm(p*10.0);
      return vec3(0.62,0.84,0.87)*s;`,
    neptune: `${LON}
      float wl=p.y+0.02*(fbm(p*6.0)-0.5);
      vec3 col=mix(vec3(0.20,0.33,0.80),vec3(0.30,0.46,0.92),0.5+0.5*sin(wl*16.0));
      col*=0.9+0.18*fbm(vec3(p.x*6.0,p.y*24.0,p.z*6.0));
      float streak=smoothstep(0.68,0.82,fbm(vec3(p.x*4.0,p.y*36.0,p.z*4.0)+3.0))*(exp(-pow((p.y-0.45)/0.08,2.0))+exp(-pow((p.y+0.32)/0.06,2.0)));
      col=mix(col,vec3(0.92,0.95,1.0),streak*0.8);
      vec3 c=normalize(vec3(0.8,-0.34,0.5)); vec3 d=p-c; float q=dot(d,d)/0.014;
      col=mix(col,vec3(0.08,0.14,0.42),smoothstep(1.0,0.4,q)*step(0.0,dot(p,c)));
      return col;`,
    moon: `return base*(0.95+0.1*fbm(p*20.0));`,
    io: `float g=fbm(p*9.0); vec3 col=mix(vec3(0.92,0.82,0.42),vec3(0.80,0.55,0.25),smoothstep(0.45,0.7,g));
      col=mix(col,vec3(0.25,0.18,0.12),smoothstep(0.78,0.82,fbm(p*20.0))); return col*(0.7+0.45*dot(base,vec3(0.333)));`,
    europa: `float l=smoothstep(0.48,0.5,fbm(p*12.0))*(1.0-smoothstep(0.5,0.52,fbm(p*12.0)));
      return mix(vec3(0.90,0.87,0.80),vec3(0.55,0.38,0.25),l*0.9+0.15*fbm(p*5.0));`,
    ganymede: `return base*vec3(0.78,0.72,0.66)*(0.8+0.3*fbm(p*6.0));`,
    callisto: `return base*vec3(0.55,0.50,0.46)*(0.8+0.4*fbm(p*18.0));`,
    titan: `return mix(vec3(0.80,0.56,0.26),vec3(0.92,0.70,0.38),fbm(p*3.0));`,
  };

  // ---- the limb glow every atmosphere gets: a thin additive shell, lit only on the Sun's side
  function limb(radius, color, strength = 1, power = 3.0) {
    const u = { col: { value: new THREE.Color(color) }, k: { value: strength }, pw: { value: power } };
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 col; uniform float k; uniform float pw; varying vec3 vN; varying vec3 vP;
        void main(){ vec3 n=normalize(vN); vec3 v=normalize(cameraPosition-vP); vec3 L=normalize(-vP);
          float f=pow(1.0-max(dot(n,v),0.0),pw); float lit=smoothstep(-0.3,0.5,dot(n,L));
          gl_FragColor=vec4(col*f*lit*k,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` }));
    mesh.renderOrder = 2; return mesh;
  }

  // ---- orbits: radius, inclination (deg), node (rad), phase (rad), size, tilt (deg), spin period (s)
  const DEG = Math.PI / 180;
  const YEAR = 240;   // seconds for one Earth orbit at speed 1
  const DEF = [
    { id: "mercury", R: 1.0, orbit: 30, inc: 7.0, node: 0.8, phase: 2.2, tilt: 0.03, day: 120 },
    { id: "venus", R: 2.0, orbit: 42, inc: 3.4, node: 1.3, phase: 4.1, tilt: 177, day: -200 },
    { id: "earth", R: 2.2, orbit: 58, inc: 0.0, node: 0.0, phase: 0.6, tilt: 23.4, day: 30 },
    { id: "mars", R: 1.4, orbit: 76, inc: 1.85, node: 0.86, phase: 3.0, tilt: 25.2, day: 31 },
    { id: "jupiter", R: 7.0, orbit: 140, inc: 1.3, node: 1.75, phase: 1.5, tilt: 3.1, day: 13 },
    { id: "saturn", R: 6.0, orbit: 192, inc: 2.5, node: 1.98, phase: 5.2, tilt: 26.7, day: 14 },
    { id: "uranus", R: 3.6, orbit: 238, inc: 0.8, node: 1.29, phase: 3.9, tilt: 97.8, day: -21 },
    { id: "neptune", R: 3.4, orbit: 272, inc: 1.8, node: 2.3, phase: 0.2, tilt: 28.3, day: 20 },
  ];
  const ids = DEF.map(d => d.id);
  const omega = d => (2 * Math.PI / YEAR) * Math.pow(58 / d.orbit, 1.5);
  const Y = new THREE.Vector3(0, 1, 0);
  function orbitPoint(d, a, out = new THREE.Vector3()) {
    out.set(Math.cos(a) * d.orbit, 0, -Math.sin(a) * d.orbit);
    // tilt the orbit plane about its line of nodes
    const nodeAxis = new THREE.Vector3(Math.cos(d.node), 0, -Math.sin(d.node));
    return out.applyAxisAngle(nodeAxis, d.inc * DEG);
  }

  const planets = {}, moons = {}, limbs = [];
  const geo = (r, w = 160, h = 112) => new THREE.SphereGeometry(r, w, h);
  for (const d of DEF) {
    const group = new THREE.Group(); scene.add(group);
    const tiltG = new THREE.Group(); tiltG.rotation.z = d.tilt * DEG; group.add(tiltG);
    const body = new THREE.Group(); tiltG.add(body);
    let mesh;
    if (d.id === "earth") {
      mesh = new THREE.Mesh(geo(d.R, 192, 128), new THREE.ShaderMaterial({
        uniforms: { day: { value: dayT }, night: { value: nightT }, spec: { value: specT }, fill: fillU },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP; void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform sampler2D spec; uniform float fill; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
          void main(){ vec3 n=normalize(vN); vec3 sun=normalize(-vP); float d=dot(n,sun); float k=smoothstep(-0.15,0.25,d);
            vec3 dc=texture2D(day,vUv).rgb; vec3 nc=pow(texture2D(night,vUv).rgb,vec3(1.2))*vec3(1.3,1.0,0.65)*2.2;
            vec3 v=normalize(cameraPosition-vP); vec3 h=normalize(sun+v); float s=pow(max(dot(n,h),0.),160.)*texture2D(spec,vUv).r*0.4+pow(max(dot(n,h),0.),30.)*texture2D(spec,vUv).r*0.03;
            vec3 col=mix(nc+dc*(0.02+0.12*fill), dc*(0.03+1.05*max(d,0.))+s*vec3(1.0,0.92,0.8), k);
            col+=vec3(0.22,0.09,0.03)*exp(-pow((d-0.03)/0.07,2.0))*dc*0.6;
            float rim=pow(1.-max(dot(n,v),0.),4.0); col=mix(col,vec3(0.42,0.58,0.85)*(0.05+0.55*k),rim*0.55);
            gl_FragColor=vec4(col,1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }` }));
      const clouds = new THREE.Mesh(geo(d.R * 1.012, 160, 112), new THREE.MeshLambertMaterial({ map: cloudT, transparent: true, opacity: 0.9, depthWrite: false }));
      clouds.renderOrder = 1; clouds.name = "clouds"; body.add(clouds);
      const a = limb(d.R * 1.03, 0x6d8fc8, 0.45, 4.0); tiltG.add(a);
    } else {
      const map = ["mercury", "mars"].includes(d.id) ? moonT : null;
      mesh = new THREE.Mesh(geo(d.R), surface(d.id, SURF[d.id], { map, rough: 0.95 }));
      if (d.id === "venus") tiltG.add(limb(d.R * 1.03, 0xffe2b0, 0.9, 2.2));
      if (d.id === "jupiter") tiltG.add(limb(d.R * 1.012, 0xd8c2a0, 0.45, 3.5));
      if (d.id === "saturn") tiltG.add(limb(d.R * 1.012, 0xe0cc9a, 0.4, 3.5));
      if (d.id === "uranus") tiltG.add(limb(d.R * 1.025, 0x9fe8ff, 0.8, 2.6));
      if (d.id === "neptune") tiltG.add(limb(d.R * 1.025, 0x6f9cff, 0.9, 2.6));
    }
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
    planets[d.id] = { id: d.id, group, tilt: tiltG, body, mesh, radius: d.R, orbit: d.orbit, def: d, position: group.position };
  }

  // ---- Saturn's rings (in the tilted frame, so they lean with the planet) and Uranus's faint ones
  {
    const s = planets.saturn, Rs = s.radius;
    const ringGeo = new THREE.RingGeometry(Rs * 1.22, Rs * 2.3, 512, 8); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ringC: SAT_RING.centre, ringN: SAT_RING.normal, ringR: SAT_RING.R },
      vertexShader: `varying vec3 vL; varying vec3 vWP; void main(){ vL=position; vec4 w=modelMatrix*vec4(position,1.); vWP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 ringC; uniform vec3 ringN; uniform float ringR; varying vec3 vL; varying vec3 vWP;
        ${NOISE} ${RING_DENSITY}
        void main(){ float r=length(vL.xz)/ringR; float a=ringD(r); if(a<0.003) discard;
          vec3 col=mix(vec3(0.70,0.60,0.46),vec3(0.95,0.88,0.74),smoothstep(1.5,2.0,r));
          col=mix(col,vec3(0.55,0.50,0.45),1.0-smoothstep(1.3,1.55,r));
          col*=0.88+0.24*vn(vec3(r*180.0,0.0,0.0));
          vec3 L=normalize(-vWP); vec3 V=normalize(cameraPosition-vWP);
          float sideL=sign(dot(L,ringN)), sideV=sign(dot(V,ringN));
          float lit=sideL==sideV ? 0.25+0.85*sqrt(abs(dot(L,ringN))) : 0.18+0.5*(1.0-a);   // the unlit face glows through thin parts
          // Saturn's shadow on the rings
          vec3 oc=vWP-ringC; float b=dot(oc,L); float c=dot(oc,oc)-ringR*ringR*1.0; float disc=b*b-c;
          if(disc>0.0 && -b-sqrt(disc)>0.0) lit*=0.06;
          gl_FragColor=vec4(col*lit*1.1, a*0.95);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.renderOrder = 3; s.tilt.add(ring); s.rings = ring;
    const u = planets.uranus, Ru = u.radius;
    const ug = new THREE.RingGeometry(Ru * 1.6, Ru * 2.05, 256, 1); ug.rotateX(-Math.PI / 2);
    const um = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { R: { value: Ru } },
      vertexShader: `varying vec3 vL; void main(){ vL=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float R; varying vec3 vL; void main(){ float r=length(vL.xz)/R;
        float a=0.0; a+=exp(-pow((r-1.64)/0.006,2.0))*0.5; a+=exp(-pow((r-1.72)/0.005,2.0))*0.4; a+=exp(-pow((r-1.98)/0.012,2.0))*0.9;
        gl_FragColor=vec4(vec3(0.55,0.62,0.66)*a*0.5,1.0); }` });
    const ur = new THREE.Mesh(ug, um); ur.renderOrder = 3; u.tilt.add(ur); u.rings = ur;
  }

  // ---- moons (they orbit in their planet's equatorial plane, Earth's Moon close to the ecliptic)
  const MOONS = [
    { id: "moon", parent: "earth", R: 0.6, orbit: 9.0, period: 40, phase: 4.5, inc: 5.1, map: true },
    { id: "io", parent: "jupiter", R: 0.42, orbit: 11.0, period: 22, phase: 0.4, map: true },
    { id: "europa", parent: "jupiter", R: 0.36, orbit: 14.0, period: 36, phase: 2.0 },
    { id: "ganymede", parent: "jupiter", R: 0.6, orbit: 18.0, period: 60, phase: 3.7, map: true },
    { id: "callisto", parent: "jupiter", R: 0.55, orbit: 23.0, period: 110, phase: 5.3, map: true },
    { id: "titan", parent: "saturn", R: 0.62, orbit: 21.0, period: 80, phase: 1.1 },
  ];
  for (const m of MOONS) {
    const mesh = new THREE.Mesh(geo(m.R, 96, 64), surface(m.id, SURF[m.id], { map: m.map ? moonT : null }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const holder = m.id === "moon" ? planets[m.parent].group : planets[m.parent].tilt;
    const pivot = new THREE.Group(); if (m.inc) pivot.rotation.x = m.inc * DEG; holder.add(pivot); pivot.add(mesh);
    if (m.id === "titan") mesh.add(limb(m.R * 1.08, 0xffb060, 0.9, 2.0));
    moons[m.id] = { id: m.id, object: mesh, radius: m.R, parent: m.parent, def: m, pivot };
  }

  // ---- the Sun: a granulating, limb-darkened surface, a corona and a wide glare, and the one light
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
    const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.1, "rgba(255,240,210,0.9)"); gr.addColorStop(0.25, "rgba(255,190,110,0.35)");
    gr.addColorStop(0.5, "rgba(255,150,70,0.10)"); gr.addColorStop(0.8, "rgba(255,120,50,0.02)"); gr.addColorStop(1, "rgba(255,110,40,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const sun = new THREE.Group(); scene.add(sun);
  const sunMat = new THREE.ShaderMaterial({ uniforms: { uTime: time }, toneMapped: false,
    vertexShader: `varying vec3 vO; varying vec3 vN; varying vec3 vP; void main(){ vO=position; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; varying vec3 vO; varying vec3 vN; varying vec3 vP; ${NOISE}
      void main(){ vec3 p=normalize(vO); float t=uTime*0.06;
        float g=fbm(p*7.0+vec3(t,0.0,-t)); float cells=fbm(p*38.0+vec3(0.0,t*2.0,0.0)); float spots=smoothstep(0.73,0.78,fbm(p*3.0+11.0))*smoothstep(0.55,0.2,abs(p.y));
        float mu=max(dot(normalize(vN),normalize(cameraPosition-vP)),0.0);
        vec3 hot=vec3(1.0,0.93,0.72), warm=vec3(1.0,0.62,0.22);
        vec3 col=mix(warm,hot,smoothstep(0.35,0.75,g*0.6+cells*0.5))*(0.55+0.45*pow(mu,0.45));
        col*=1.0-0.55*spots; col=mix(vec3(1.0,0.45,0.12),col,smoothstep(0.0,0.35,mu));
        gl_FragColor=vec4(col*1.25,1.0);
        #include <colorspace_fragment>
      }` });
  const sunCore = new THREE.Mesh(geo(SUN_R, 128, 96), sunMat);
  const spr = (c, o, s) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: o,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); m.scale.setScalar(s); m.userData = { o, s }; return m; };
  const corona = spr(0xffd9a0, 0.95, SUN_R * 4.2), glare = spr(0xc06a24, 0.45, SUN_R * 14), halo = spr(0x5a2a0c, 0.16, SUN_R * 30);
  sun.add(halo, glare, corona, sunCore);
  const sunLight = new THREE.PointLight(0xfff2e0, 3.4, 0, 0); sun.add(sunLight);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = SUN_R + 1; sunLight.shadow.camera.far = 340; sunLight.shadow.bias = -0.002; sunLight.shadow.normalBias = 0.02;
  scene.add(new THREE.AmbientLight(0x1c2436, 0.12));

  // ---- the asteroid belt: lumpy rocks with the kit's rock surface, and a dust of tiny points
  let seed = 20240917; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const belt = new THREE.Group(); scene.add(belt);
  const rockMat = new THREE.MeshStandardMaterial({ map: rockD, normalMap: rockN, roughnessMap: rockR, roughness: 1, metalness: 0, color: 0x7d746c });
  const lump = (k) => { const g = new THREE.IcosahedronGeometry(1, 3); const p = g.attributes.position, v = new THREE.Vector3();
    const f = [rnd() * 3 + 1.5, rnd() * 3 + 2.5, rnd() * 5 + 4], ph = [rnd() * 9, rnd() * 9, rnd() * 9];
    const sx = 0.7 + rnd() * 0.6, sy = 0.55 + rnd() * 0.4, sz = 0.8 + rnd() * 0.5;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i);
      const n = 1 + 0.18 * Math.sin(v.x * f[0] + ph[0]) * Math.cos(v.y * f[1] + ph[1]) + 0.09 * Math.sin(v.z * f[2] + ph[2] + v.x * 3)
        - 0.12 * Math.max(0, Math.sin(v.x * 5 + k) * Math.sin(v.y * 4 + k * 2) - 0.6) * 4;
      v.multiplyScalar(n); v.x *= sx; v.y *= sy; v.z *= sz; p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g; };
  const ROCKS = 3200, VAR = 5, rocks = [];
  const rockData = [];
  for (let k = 0; k < VAR; k++) { const im = new THREE.InstancedMesh(lump(k), rockMat, Math.ceil(ROCKS / VAR)); im.frustumCulled = false; belt.add(im); rocks.push(im); }
  for (let i = 0; i < ROCKS; i++) {
    const r = 90 + 18 * (0.5 + 0.5 * Math.tanh((rnd() + rnd() + rnd() - 1.5) * 1.6)) ;
    const a = rnd() * Math.PI * 2, y = (rnd() + rnd() - 1) * 2.6 * (r / 99);
    const s = 0.03 + 0.28 * Math.pow(rnd(), 6) + (i < 6 ? 0.3 : 0);
    rockData.push({ r, a, y, s, ax: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * 1.2, k: i % VAR, idx: Math.floor(i / VAR), w: omega({ orbit: r }) });
  }
  const dustN = 26000, dp = new Float32Array(dustN * 3), dc = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { const r = 88 + 22 * (0.5 + 0.5 * Math.tanh((rnd() + rnd() + rnd() - 1.5) * 1.6)), a = rnd() * Math.PI * 2;
    dp.set([Math.cos(a) * r, (rnd() + rnd() - 1) * 3.0, -Math.sin(a) * r], i * 3); const b = 0.25 + 0.35 * rnd(); dc.set([b, b * 0.92, b * 0.82], i * 3); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dp, 3)); dg.setAttribute("color", new THREE.BufferAttribute(dc, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
  belt.add(dust);

  // ---- orbit lines: faint, can be shown, hidden or one picked out
  const orbitLines = new THREE.Group(); scene.add(orbitLines);
  const lineOf = {};
  for (const d of DEF) { const pts = []; for (let i = 0; i <= 720; i++) pts.push(orbitPoint(d, i / 720 * Math.PI * 2));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x8aa6d6, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
    l.renderOrder = 1; orbitLines.add(l); lineOf[d.id] = l; }

  // ---- stars: three layers of points at infinity (they follow the camera), a Milky Way band and its glow
  const stars = new THREE.Group(); scene.add(stars);
  const bandAx = new THREE.Vector3(0.35, 0.82, -0.45).normalize(), tmp = new THREE.Vector3();
  const layer = (n, size, bright, bandShare) => { const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, th = rnd() * 6.283, q = Math.sqrt(1 - u * u); tmp.set(q * Math.cos(th), u, q * Math.sin(th));
      if (rnd() < bandShare) tmp.addScaledVector(bandAx, -tmp.dot(bandAx) * (0.82 + 0.18 * rnd())).normalize();
      tmp.multiplyScalar(4200); p.set([tmp.x, tmp.y, tmp.z], i * 3);
      const b = bright * (0.35 + 0.65 * Math.pow(rnd(), 2.5)), w = rnd();
      const tint = w < 0.15 ? [1.0, 0.8, 0.62] : w < 0.3 ? [0.75, 0.85, 1.0] : [1, 0.97, 0.92];
      c.set([b * tint[0], b * tint[1], b * tint[2]], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true, toneMapped: false }));
    pts.renderOrder = -1; stars.add(pts); };
  layer(26000, 1.1, 0.55, 0.45); layer(7000, 1.7, 0.85, 0.3); layer(900, 2.6, 1.0, 0.15);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 64, 32), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { ax: { value: bandAx } },
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 ax; varying vec3 vD; ${NOISE}
      void main(){ float b=dot(vD,ax); float band=exp(-pow(b/0.16,2.0)); float n=fbm(vD*6.0); float n2=fbm(vD*18.0+4.0);
        float dust=smoothstep(0.45,0.7,fbm(vD*9.0+2.0));
        vec3 col=vec3(0.55,0.5,0.62)*band*(0.35+0.9*n)*(0.6+0.5*n2)*(1.0-0.75*dust*band);
        col+=vec3(0.3,0.22,0.35)*exp(-pow(b/0.5,2.0))*0.08*n;
        col+=vec3(0.010,0.012,0.022);
        gl_FragColor=vec4(col*0.085,1.0);
        #include <colorspace_fragment>
      }` }));
  sky.renderOrder = -2; stars.add(sky);

  // ---- placing things
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const angleOf = (d, s) => (s.angles && s.angles[d.id] != null) ? s.angles[d.id] : d.phase + (s.time ?? 0) * (s.speed ?? 1) * omega(d);
  const orbitPosition = (id, t = 0, speed = 1) => { const d = planets[id].def; return orbitPoint(d, d.phase + t * speed * omega(d)); };
  const position = id => { scene.updateMatrixWorld(); if (planets[id]) return planets[id].group.position.clone();
    return moons[id].object.getWorldPosition(new THREE.Vector3()); };
  const velocity = id => { const p = planets[id].group.position; return v1.set(-p.z, 0, p.x).normalize().negate().clone(); };
  const outward = id => planets[id].group.position.clone().normalize();
  const viewFrom = (id, { dist = 4, side = 1, up = 0.18, back = 0 } = {}) => {
    const p = planets[id], c = p.group.position.clone(), o = c.clone().normalize(), t = velocity(id);
    const dir = o.clone().multiplyScalar(-(1 - back) + back).addScaledVector(t, 0.55 * side).addScaledVector(Y, up).normalize();
    return { position: c.clone().addScaledVector(dir, dist * p.radius), target: c };
  };
  const toScreen = v => { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * W, y: (0.5 - p.y * 0.5) * H, behind: p.z > 1 }; };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();

  function fit() {
    camera.updateMatrixWorld();
    const cp = camera.position;
    let near = cp.length() - SUN_R;
    for (const id of ids) { const p = planets[id]; const r = p.radius * (id === "saturn" ? 2.4 : 1.05); near = Math.min(near, cp.distanceTo(p.group.position) - r); }
    for (const id in moons) { near = Math.min(near, cp.distanceTo(moons[id].object.getWorldPosition(v2)) - moons[id].radius); }
    camera.near = THREE.MathUtils.clamp(near * 0.5, 0.02, 20); camera.far = 9000; camera.updateProjectionMatrix();
    stars.position.copy(cp);
  }

  function update(s = {}) {
    const t = s.time ?? 0, spin = s.spinSpeed ?? 1;
    time.value = t; fillU.value = s.fill ?? 0.15;
    for (const d of DEF) { const p = planets[d.id];
      orbitPoint(d, angleOf(d, s), p.group.position);
      p.body.rotation.y = t * spin * (2 * Math.PI / d.day);
      const cl = p.body.getObjectByName("clouds"); if (cl) cl.rotation.y = t * spin * 0.012; }
    for (const id in moons) { const m = moons[id], d = m.def; const a = d.phase + t * (s.speed ?? 1) * (2 * Math.PI / d.period);
      m.object.position.set(Math.cos(a) * d.orbit, 0, -Math.sin(a) * d.orbit); m.object.rotation.y = -a; }
    scene.updateMatrixWorld();
    // the ring plane, for the shadows the rings and Saturn throw on each other
    const sat = planets.saturn; SAT_RING.centre.value.copy(sat.group.position); SAT_RING.R.value = sat.radius;
    SAT_RING.normal.value.set(0, 1, 0).applyQuaternion(sat.tilt.getWorldQuaternion(q4)).normalize();
    // the belt turns, faster on its inside, every rock tumbling
    const bv = s.belt ?? 1; belt.visible = bv > 0.001; dust.material.opacity = 0.55 * bv;
    if (belt.visible) { for (const r of rockData) { const a = r.a + t * (s.speed ?? 1) * r.w;
        pv.set(Math.cos(a) * r.r, r.y, -Math.sin(a) * r.r); q4.setFromAxisAngle(r.ax, r.spin * t + r.a * 7); sc.setScalar(r.s);
        rocks[r.k].setMatrixAt(r.idx, m4.compose(pv, q4, sc)); }
      for (const im of rocks) im.instanceMatrix.needsUpdate = true;
      dust.rotation.y = t * (s.speed ?? 1) * omega({ orbit: 99 }); }
    // orbit lines
    const ov = s.orbits ?? 1; orbitLines.visible = ov > 0.001;
    for (const id of ids) lineOf[id].material.opacity = (id === s.highlight ? 0.75 : 0.2) * ov;
    // the Sun's glare stays readable from far away
    const g = s.sunGlow ?? 1, sd = camera.position.length();
    for (const sp of [corona, glare, halo]) { sp.material.opacity = sp.userData.o * Math.min(1, g); sp.scale.setScalar(Math.max(sp.userData.s, sd * sp.userData.s / 260) * Math.max(g, 0.2)); }
    fit();
  }
  const render = () => { fit(); renderer.render(scene, camera); };
  update({});

  return { renderer, scene, camera, update, render, cast: {}, sun, SUN_R, planets, moons, ids,
    position, orbitPosition, velocity, outward, viewFrom, belt, orbitLines, stars, toScreen };
}
