// World "orbit": Earth from low orbit, built once, shared by every orbit shot.
//
// Units: 1 unit = 637.1 km (Earth radius R = 10). world.KM converts km to units.
// Frame: Earth centre at world.earthPos (origin when state.orbit = 0). The Sun sits along -x/+z
// (world.sunDir), far away (world.sunPos, 800 units). At spin = 0 longitude 0 faces +x and
// positive spin turns the planet east (anticlockwise seen from the north pole).
//
// update(state) reads (every key optional):
//   time      seconds, drives the marker pulse, the wind streaks and the flow ripples
//   spin      rad, the planet's turn about its own axis (0 = stopped Earth in these shots)
//   tilt      rad, axial tilt about z (default 0.409 = 23.4 deg)
//   cloudRot  rad, how far the cloud shell has moved east relative to the ground
//   wind      0..1, cloud bands smear into east-going streaks, fastest at the equator
//   band      0..1, a bright streaming band along the equator
//   water     0..1, oceans drain off the equator and pool in two polar caps (1 = done)
//   flow      0..1, poleward ripples on the moving water
//   landTint  0..1, all land (old and new) shaded as one brown-green continent
//   lights    city-light gain on the night side (default 1)
//   fill      0..1, lifts the night side so the whole globe reads (default 0)
//   bulge     0..1, draws the equatorial-bulge outline (exaggerated by bulgeExag, default 0.07 R)
//   orbit     rad, Earth's position along its orbit round the Sun (0 = origin)
//   showOrbit 0..1, the orbit path round the Sun
//   sunGlow   multiplier on the Sun's glare (default 1)
//   marker    0..1, the glowing New York marker (default 1)
//   clouds    0..1, cloud opacity (default 1)
// Call update() AFTER placing world.camera: it also fits the camera's near/far planes to the scene.
//
// Exposes: renderer, scene, camera, update(state), render(), R, KM,
//   earth (spinning group: children turn with the ground), earthPos (Vector3), sun (Object3D),
//   sunPos, sunDir (from Earth to Sun, world), marker (Object3D on New York),
//   surfacePoint(latDeg, lonDeg, altKm=0) -> world Vector3 (after the current spin/tilt/orbit),
//   up(latDeg, lonDeg) -> world unit normal there, toScreen(v3) -> {x, y, behind} in 1920x1080 px,
//   bulgeAnchor -> world Vector3 at the outline's equator edge (put the "21 km" label there),
//   NY = {lat: 40.71, lon: -74.01}.
export async function createWorld({ THREE, canvas, K = "./assets/kit/" }) {
  const W = 1920, H = 1080, R = 10, KM = R / 6371;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x010207);
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 8000);
  camera.position.set(0, 0, 40); camera.lookAt(0, 0, 0);

  // ---- textures (all loaded before anything is built)
  const TL = new THREE.TextureLoader();
  const load = async (f, srgb) => { const t = await TL.loadAsync(K + "textures/" + f);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.wrapS = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  const [dayT, nightT, specT, normT, cloudT] = await Promise.all([
    load("earth_day.jpg", true), load("earth_night.png", true), load("earth_specular.jpg", false),
    load("earth_normal.jpg", false), load("earth_clouds.png", true)]);

  const SUN0 = new THREE.Vector3(-0.9, 0, 0.44).normalize();
  const sunPos = SUN0.clone().multiplyScalar(800);
  const sunDir = SUN0.clone();
  const earthPos = new THREE.Vector3();

  // shared GLSL: 3D value noise + fbm (seamless on the sphere, no pole pinch)
  const NOISE = `
    float h3(vec3 p){ p=fract(p*0.3183099+vec3(.1,.2,.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
    float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
  `;

  // ---- groups: root (orbit position) > tilt > spin (ground) > clouds
  const root = new THREE.Group(); scene.add(root);
  const tiltG = new THREE.Group(); root.add(tiltG);
  const spinG = new THREE.Group(); tiltG.add(spinG);
  const cloudG = new THREE.Group(); spinG.add(cloudG);

  // ---- the ground: day/night by the Sun, relief, specular ocean, cloud shadows, limb haze, water redistribution
  const earthU = {
    day: { value: dayT }, night: { value: nightT }, spec: { value: specT }, nrm: { value: normT }, cld: { value: cloudT },
    sun: { value: sunDir }, cloudRot: { value: 0 }, water: { value: 0 }, flow: { value: 0 }, landTint: { value: 0 },
    lights: { value: 1 }, fill: { value: 0 }, time: { value: 0 }, clouds: { value: 1 }, wind: { value: 0 } };
  const earthMat = new THREE.ShaderMaterial({ uniforms: earthU,
    vertexShader: `varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying mat3 vM;
      void main(){ vUv=uv; vO=position; vM=mat3(modelMatrix); vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform sampler2D day, night, spec, nrm, cld; uniform vec3 sun; uniform float cloudRot, water, flow, landTint, lights, fill, time, clouds, wind;
      varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying mat3 vM;
      ${NOISE}
      void main(){
        vec3 n0=normalize(vO);
        float lat=asin(clamp(n0.y,-1.,1.)); float alat=abs(lat)*57.2958;
        // relief from the normal map, in a local east/north frame
        vec3 east=normalize(cross(vec3(0.,1.,0.),n0)+vec3(1e-5,0.,0.)); vec3 north=cross(n0,east);
        vec3 tn=texture2D(nrm,vUv).xyz*2.-1.;
        float ocean0=smoothstep(0.35,0.65,texture2D(spec,vUv).r);
        // water redistribution: dry band grows from the equator, polar caps flood from the poles
        float wob=(fbm(n0*6.0)-0.5)*7.0;
        float meet=38.0;
        float dryTo=meet*water, wetFrom=90.0-(90.0-meet)*water;
        float dry=1.0-smoothstep(dryTo-1.5, dryTo+1.5, alat+wob*water);
        float wet=smoothstep(wetFrom-1.5, wetFrom+1.5, alat+wob*water);
        float ocean=clamp(ocean0*(1.0-dry)+wet, 0., 1.);
        float newLand=ocean0*(1.0-ocean); float newSea=(1.0-ocean0)*ocean;
        tn.xy*=0.3*(1.0-ocean)*(1.0-smoothstep(0.02,0.25,texture2D(spec,vUv).r));
        vec3 nObj=normalize(east*tn.x+north*tn.y+n0*max(tn.z,0.2));
        vec3 n=normalize(vM*nObj); vec3 ng=normalize(vM*n0);
        float d=dot(n,sun), dg=dot(ng,sun);
        float k=smoothstep(-0.12,0.22,dg);
        vec3 v=normalize(cameraPosition-vP);
        // colours
        vec3 dc=texture2D(day,vUv).rgb;
        float g=fbm(n0*90.0);   // fine detail under the 2k map
        dc*=0.9+0.22*g;
        vec3 seabed=mix(vec3(0.40,0.33,0.22), vec3(0.27,0.33,0.17), smoothstep(0.35,0.65,fbm(n0*14.0)));
        seabed*=0.8+0.35*fbm(n0*60.0);
        vec3 deep=mix(vec3(0.010,0.045,0.11), vec3(0.02,0.09,0.20), fbm(n0*20.0));
        vec3 landCol=mix(dc, seabed, newLand);
        vec3 tintCol=mix(vec3(0.42,0.36,0.22), vec3(0.24,0.34,0.15), smoothstep(0.3,0.7,fbm(n0*9.0)))*(0.85+0.3*g);
        landCol=mix(landCol, mix(landCol,tintCol,0.75), landTint);
        vec3 seaCol=mix(dc, deep, newSea);
        // shallows along any new shore
        float shore=1.0-smoothstep(0.0,2.5,min(abs(alat+wob*water-dryTo),abs(alat+wob*water-wetFrom)));
        seaCol=mix(seaCol, vec3(0.05,0.30,0.42), shore*0.6*step(0.01,water)*step(water,0.999)+shore*0.25*step(0.999,water));
        // poleward flow ripples on the moving water
        float rip=sin(alat*1.6 - time*6.0 + fbm(n0*8.0)*6.0)*0.5+0.5;
        seaCol+=vec3(0.05,0.18,0.30)*pow(rip,6.0)*flow*ocean;
        vec3 base=mix(landCol, seaCol, ocean);
        // cloud shadows
        vec2 cu=vec2(vUv.x-cloudRot/6.2831853, vUv.y);
        float cs=texture2D(cld,cu+vec2(0.0015,0.0)).a*clouds*(1.0-0.5*wind);
        float lam=max(d,0.0);
        vec3 lit=base*(0.04+1.05*lam)*(1.0-0.45*cs);
        // ocean glint
        vec3 hv=normalize(sun+v); float sp=pow(max(dot(ng,hv),0.),90.)*1.6+pow(max(dot(ng,hv),0.),12.)*0.08;
        lit+=vec3(1.0,0.93,0.8)*sp*ocean*k*(1.0-0.7*cs);
        // night: city lights (only on original land), slightly warm
        vec3 nc=texture2D(night,vUv).rgb; nc=pow(nc,vec3(1.3))*vec3(1.35,1.0,0.6)*3.4*lights*(1.0-ocean)*(1.0-0.6*cs);
        vec3 nightCol=nc+base*0.025+base*0.9*fill;
        vec3 col=mix(nightCol, lit+base*0.35*fill*(1.0-k), k);
        // terminator warmth
        col+=vec3(0.35,0.12,0.03)*exp(-pow(dg/0.08,2.0))*0.25*base*4.0;
        // limb haze: thin blue air seen edge-on
        float mu=max(dot(ng,v),0.0); float haze=pow(1.0-mu,3.0);
        float haze2=pow(1.0-mu,5.0); col=mix(col, vec3(0.30,0.45,0.75)*(0.08+0.6*k), haze2*0.45*(0.2+0.8*k)+haze*0.06*k);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 192), earthMat);
  earth.receiveShadow = true; spinG.add(earth);

  // ---- clouds: their own shell, smearing into streaks with the wind, fastest at the equator
  const cloudU = { cld: { value: cloudT }, sun: { value: sunDir }, wind: { value: 0 }, band: { value: 0 },
    phase: { value: 0 }, clouds: { value: 1 }, fill: { value: 0 } };
  const cloudMat = new THREE.ShaderMaterial({ uniforms: cloudU, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying vec3 vN;
      void main(){ vUv=uv; vO=position; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform sampler2D cld; uniform vec3 sun; uniform float wind, band, phase, clouds, fill;
      varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying vec3 vN;
      ${NOISE}
      void main(){
        vec3 n0=normalize(vO); float lat=asin(clamp(n0.y,-1.,1.)); float cl=cos(lat);
        float sp=cl*cl;                       // speed: fastest on the equator
        float shift=phase*sp;                 // extra eastward slip on top of the shell's turn
        float L=wind*0.045*sp;                // smear length in u
        float a=0.0;
        for(int i=0;i<12;i++){ float f=float(i)/11.0; a+=texture2D(cld, vec2(vUv.x-shift/6.2831853-L*f, vUv.y)).a; }
        a/=12.0;
        float a0=texture2D(cld, vec2(vUv.x-shift/6.2831853, vUv.y)).a;
        a=mix(a0, a, wind);
        // fine detail, then wind streaks: thin lines stretched east-west
        float lon=atan(n0.z,-n0.x);
        a*=0.78+0.45*fbm(n0*45.0);
        float lines=vn(vec3(lon*14.0 - phase*sp*6.0, lat*220.0, 0.5))*vn(vec3(lon*9.0-phase*sp*4.0, lat*60.0, 2.0));
        lines=smoothstep(0.3,0.8,lines)*(0.6+0.4*fbm(n0*30.0));
        a=max(a, lines*wind*0.38*sp);
        float eq=exp(-pow(lat/0.16,2.0))*band;
        a=max(a, eq*(0.35+0.65*lines));
        a=clamp(a*clouds,0.,1.);
        vec3 nw=normalize(vN); float d=dot(nw,sun);
        float lam=smoothstep(-0.2,0.35,d);
        vec3 c=vec3(1.0,0.99,0.97)*(0.03+1.05*max(d,0.0)) + vec3(0.9,0.95,1.0)*0.4*fill;
        c+=vec3(1.0,0.45,0.15)*exp(-pow(d/0.1,2.0))*0.35;     // sunset tint at the terminator
        c+=vec3(0.75,0.9,1.0)*eq*(0.25+0.75*lam)*0.6;          // the glowing band
        gl_FragColor=vec4(c, a*(0.55+0.45*lam));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.006, 192, 128), cloudMat);
  cloudMesh.renderOrder = 1; cloudG.add(cloudMesh);

  // ---- atmosphere: a thin shell, blue where lit, orange where we look towards the Sun
  const atmoU = { sun: { value: sunDir }, centre: { value: earthPos }, glow: { value: 1 } };
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 128, 96), new THREE.ShaderMaterial({
    uniforms: atmoU, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vP; void main(){ vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 sun, centre; uniform float glow; varying vec3 vP;
      void main(){ vec3 rd=normalize(vP-cameraPosition); vec3 oc=centre-cameraPosition; float tc=dot(oc,rd);
        vec3 cp=cameraPosition+rd*max(tc,0.0); float hgt=length(cp-centre)-${R.toFixed(1)};
        if(hgt<0.0) discard;
        float f=0.75*exp(-hgt/0.05)+0.03*exp(-hgt/0.2);
        vec3 up=normalize(cp-centre); float l=dot(up,sun);
        float lit=smoothstep(-0.25,0.35,l);
        float fwd=pow(max(dot(rd,sun),0.0),6.0);
        vec3 col=vec3(0.30,0.48,0.80)*lit + vec3(0.8,0.45,0.2)*fwd*smoothstep(-0.45,0.1,l)*1.2;
        col*=f*glow; col=min(col, vec3(0.42));
        gl_FragColor=vec4(col, 1.0);
      }` }));
  atmo.renderOrder = 2; root.add(atmo);

  // ---- New York marker: a glowing point and a pulsing ring flat on the ground
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(255,240,220,0.95)"); gr.addColorStop(0.3, "rgba(255,200,140,0.35)");
    gr.addColorStop(0.6, "rgba(255,170,100,0.08)"); gr.addColorStop(1, "rgba(255,160,90,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const NY = { lat: 40.71, lon: -74.01 };
  const local = (lat, lon, r) => { const la = lat * Math.PI / 180, ph = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-Math.cos(ph) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(ph) * Math.cos(la) * r); };
  const marker = new THREE.Group(); spinG.add(marker);
  const mPos = local(NY.lat, NY.lon, R * 1.0015); marker.position.copy(mPos);
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mPos.clone().normalize());
  const mDot = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const mCore = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffe7d6, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  mDot.position.z = 0.002; mCore.position.z = 0.004;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a35, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), ringMat);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.94, 1.0, 64), ringMat.clone());
  mDot.renderOrder = mCore.renderOrder = ring.renderOrder = ring2.renderOrder = 3;
  marker.add(mDot, mCore, ring, ring2);

  // ---- the Sun: a white core and a warm glare, occluded by the Earth
  const sun = new THREE.Group(); sun.position.copy(sunPos); scene.add(sun);
  const sunCore = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 5) }));
  const sunGlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xb05a1c, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x5a2e10, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sunGlare.scale.setScalar(90); sunHalo.scale.setScalar(420); sun.add(sunHalo, sunGlare, sunCore);
  const sunLight = new THREE.DirectionalLight(0xfff1e0, 3.0); scene.add(sunLight); scene.add(sunLight.target);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(1024, 1024);
  scene.add(new THREE.AmbientLight(0x223355, 0.08));

  // ---- the orbit path round the Sun
  const opts = []; for (let i = 0; i <= 512; i++) { const a = i / 512 * Math.PI * 2;
    const v = sunPos.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), a).add(sunPos); opts.push(v); }
  const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(opts),
    new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(orbitLine);

  // ---- stars: always at infinity (they follow the camera), a denser Milky Way band
  const NS = 9000, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3); let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bandAx = new THREE.Vector3(0.3, 0.85, -0.42).normalize(), tmp = new THREE.Vector3();
  for (let i = 0; i < NS; i++) {
    const u = rnd() * 2 - 1, th = rnd() * 6.283, q = Math.sqrt(1 - u * u); tmp.set(q * Math.cos(th), u, q * Math.sin(th));
    if (i % 3 === 0) { tmp.addScaledVector(bandAx, -tmp.dot(bandAx) * (0.85 + 0.15 * rnd())).normalize(); }
    tmp.multiplyScalar(4000); sp.set([tmp.x, tmp.y, tmp.z], i * 3);
    const b = 0.25 + 0.75 * Math.pow(rnd(), 4), w = rnd(); sc.set([b * (0.8 + 0.2 * w), b * (0.85 + 0.1 * w), b * (0.75 + 0.25 * (1 - w))], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sg.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  stars.renderOrder = -1; scene.add(stars);

  // ---- equatorial-bulge outline: a true circle (faint, dashed) and the bulged ellipse, both screen-facing
  const SEG = 256;
  const ribbon = (color, dashed) => { const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
    const idx = []; for (let i = 0; i < SEG; i++) { if (dashed && (i % 8) >= 4) continue; const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 10; m.frustumCulled = false; scene.add(m); return m; };
  const trueRing = ribbon(0xbfd4ff, true), bulgeRing = ribbon(0xffd166, false);
  const bulgeAnchor = new THREE.Vector3();
  const setRibbon = (m, C, E, A, a, b, w) => { const p = m.geometry.attributes.position.array;
    for (let i = 0; i <= SEG; i++) { const t = i / SEG * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const nx = c / a, ny = s / b, nl = Math.hypot(nx, ny);
      for (let j = 0; j < 2; j++) { const o = (j ? 0.5 : -0.5) * w / nl;
        const x = a * c + o * nx, y = b * s + o * ny;
        p[(i * 2 + j) * 3] = C.x + E.x * x + A.x * y; p[(i * 2 + j) * 3 + 1] = C.y + E.y * x + A.y * y; p[(i * 2 + j) * 3 + 2] = C.z + E.z * x + A.z * y; } }
    m.geometry.attributes.position.needsUpdate = true; };

  const Y = new THREE.Vector3(0, 1, 0), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const surfacePoint = (lat, lon, altKm = 0) => { scene.updateMatrixWorld(); return spinG.localToWorld(local(lat, lon, R + altKm * KM)); };
  const up = (lat, lon) => surfacePoint(lat, lon, 0).sub(earthPos).normalize();
  const toScreen = v => { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * W, y: (0.5 - p.y * 0.5) * H, behind: p.z > 1 }; };

  function update(s = {}) {
    const time = s.time ?? 0;
    // orbit position and the Sun's direction from Earth
    earthPos.copy(sunPos).negate().applyAxisAngle(Y, s.orbit ?? 0).add(sunPos);
    root.position.copy(earthPos); sunDir.copy(sunPos).sub(earthPos).normalize();
    sunLight.position.copy(earthPos).addScaledVector(sunDir, 60); sunLight.target.position.copy(earthPos);
    tiltG.rotation.z = s.tilt ?? 0.409;
    spinG.rotation.y = s.spin ?? 0;
    cloudG.rotation.y = s.cloudRot ?? 0;
    const wind = s.wind ?? 0, clouds = s.clouds ?? 1, fill = s.fill ?? 0;
    Object.assign(earthU.cloudRot, { value: s.cloudRot ?? 0 }); earthU.water.value = s.water ?? 0; earthU.flow.value = s.flow ?? 0;
    earthU.landTint.value = s.landTint ?? 0; earthU.lights.value = s.lights ?? 1; earthU.fill.value = fill; earthU.time.value = time;
    earthU.clouds.value = clouds; earthU.wind.value = wind;
    cloudU.wind.value = wind; cloudU.band.value = s.band ?? 0; cloudU.clouds.value = clouds; cloudU.fill.value = fill;
    cloudU.phase.value = time * wind * 0.12;
    atmoU.glow.value = s.atmo ?? 1;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const camDist = camera.position.distanceTo(earthPos);
    // marker: constant-ish size on screen, a slow pulse
    const mo = s.marker ?? 1, ms = THREE.MathUtils.clamp((camDist - R) * 0.035, 0.03, 1.2);
    mDot.scale.setScalar(ms * 0.42); mCore.scale.setScalar(ms * 0.2);
    mDot.material.opacity = mo; mCore.material.opacity = mo;
    const ph = (time / 1.6) % 1, ph2 = (time / 1.6 + 0.5) % 1;
    ring.scale.setScalar(ms * (0.5 + 1.6 * ph)); ring.material.opacity = mo * 0.85 * (1 - ph);
    ring2.scale.setScalar(ms * (0.5 + 1.6 * ph2)); ring2.material.opacity = mo * 0.85 * (1 - ph2);
    marker.visible = mo > 0.001;
    // the Sun's glare grows a little as we pull away so it still reads
    const g = s.sunGlow ?? 1, sd = camera.position.distanceTo(sunPos);
    sunGlare.scale.setScalar(Math.max(90, sd * 0.09) * g); sunHalo.scale.setScalar(Math.max(420, sd * 0.35) * g);
    sunHalo.material.opacity = 0.25 * Math.min(1, g); sunGlare.material.opacity = 0.5 * Math.min(1, g);
    orbitLine.material.opacity = 0.55 * (s.showOrbit ?? 0); orbitLine.visible = (s.showOrbit ?? 0) > 0.001;
    stars.position.copy(camera.position);
    // bulge outline in the plane through the centre facing the camera
    const bo = s.bulge ?? 0;
    trueRing.visible = bulgeRing.visible = bo > 0.001;
    if (bo > 0.001) {
      const vd = v1.copy(earthPos).sub(camera.position).normalize();
      const axis = v2.set(0, 1, 0).applyQuaternion(tiltG.getWorldQuaternion(new THREE.Quaternion()));
      const A = axis.addScaledVector(vd, -axis.dot(vd)).normalize(); const E = v3.crossVectors(A, vd).normalize().negate();
      const k = camDist / Math.sqrt(Math.max(camDist * camDist - R * R, 1e-3));
      const pix = 2 * camDist * Math.tan(camera.fov * Math.PI / 360) / H;
      const ex = (s.bulgeExag ?? 0.07) * Math.min(1, bo * 1.3);
      setRibbon(trueRing, earthPos, E, A, R * k, R * k, pix * 2.0);
      setRibbon(bulgeRing, earthPos, E, A, R * k * (1 + ex), R * k, pix * 3.0);
      trueRing.material.opacity = 0.7 * Math.min(1, bo * 2); bulgeRing.material.opacity = Math.min(1, bo * 2);
      bulgeAnchor.copy(earthPos).addScaledVector(E, R * k * (1 + ex));
    }
    // fit the depth range to what is in view
    const surf = Math.max(camDist - R * 1.08, 0.02);
    camera.near = THREE.MathUtils.clamp(surf * 0.5, 0.01, 200); camera.far = Math.max(6000, sd + 1500);
    camera.updateProjectionMatrix();
  }
  const render = () => renderer.render(scene, camera);
  update({});

  return { renderer, scene, camera, update, render, R, KM, earth: spinG, earthPos, sun, sunPos, sunDir, marker,
    surfacePoint, up, toScreen, bulgeAnchor, NY, clouds: cloudG, atmosphere: atmo };
}
