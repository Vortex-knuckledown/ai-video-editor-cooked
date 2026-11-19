// figure.js: a character from the shared library, with animation made for its own skeleton.
// Copied into the library by `studio.py lib setup`; a world imports it as "../lib/figure.js" (from assets/worlds/)
// or "./assets/lib/figure.js" (from a clip's index.html).
//
//   const sam = await loadFigure({ THREE, id: "woman", clips: ["idle", "walk", "run"] });
//   scene.add(sam.object);                       // feet at y = 0, facing +z, about 1.7 m tall
//   sam.pose(seconds, { walk: 0.3, run: 0.7 });  // in draw(): set the gait from the timeline, never from a clock
//
// Never put one character's clips on another character: the skeletons differ and the figure folds up.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const here = new URL(".", import.meta.url).href;   // the library's own address, wherever it is linked from

async function loadAny(THREE, url) {
  if (/\.fbx$/i.test(url)) {
    const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
    const o = await new FBXLoader().loadAsync(url);
    return { scene: o, animations: o.animations || [] };
  }
  return new GLTFLoader().loadAsync(url);
}

// A walk or run that travels is turned into one on the spot: the shot moves the figure, not the clip.
function onTheSpot(clip) {
  for (const t of clip.tracks) {
    if (!/hips\.position$/i.test(t.name)) continue;
    const v = t.values, n = v.length / 3;
    if (n < 2) continue;
    const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
    const scale = Math.max(Math.abs(v[1]), 1e-6);          // the hips' height, in the clip's own units
    if (Math.hypot(dx, dz) / scale < 0.15) continue;       // already on the spot
    for (let i = 0; i < n; i++) { const k = i / (n - 1); v[i * 3] -= dx * k; v[i * 3 + 2] -= dz * k; }
  }
  return clip;
}

export async function loadFigure({ THREE, id = "man", clips = ["idle", "walk", "run"], lit = true, base = here }) {
  const dir = `${base}characters/${id}/`;
  const meta = await (await fetch(dir + "character.json")).json();
  const body = await loadAny(THREE, dir + meta.body);
  const object = body.scene;
  if (meta.scale && meta.scale !== 1) object.scale.setScalar(meta.scale);
  object.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
    if (lit && o.material && o.material.isMeshBasicMaterial) {   // an unlit avatar would ignore the world's sun and sky
      const m = o.material;
      o.material = new THREE.MeshStandardMaterial({ map: m.map, color: m.color, transparent: m.transparent, opacity: m.opacity,
        alphaTest: m.alphaTest, side: m.side, roughness: 0.82, metalness: 0 });
    }
  });
  const mixer = new THREE.AnimationMixer(object);
  const actions = {}, durations = {};
  for (const name of clips) {
    const src = meta.clips[name];
    if (!src) throw new Error(`character "${id}" has no clip "${name}". It has: ${Object.keys(meta.clips).join(", ")}. More: studio.py lib clip ${id} "<what>"`);
    let clip;
    if (src.startsWith("@")) clip = body.animations.find(a => a.name === src.slice(1));
    else clip = (await loadAny(THREE, dir + src)).animations[0];
    if (!clip) throw new Error(`character "${id}": clip "${name}" (${src}) did not load`);
    clip = onTheSpot(clip.clone());
    const a = mixer.clipAction(clip);
    a.play(); a.setEffectiveWeight(0);
    actions[name] = a; durations[name] = clip.duration;
  }
  // weights: {walk: 0.3, run: 0.7}; a bare name means that clip alone
  function pose(seconds, weights) {
    const w = typeof weights === "string" ? { [weights]: 1 } : (weights || { [clips[0]]: 1 });
    for (const n in actions) actions[n].setEffectiveWeight(w[n] || 0);
    mixer.setTime(Math.max(0, seconds));
  }
  pose(0);
  return { id, object, mixer, actions, durations, pose, height: meta.height || 1.75, describe: meta.describe || "" };
}

// A prop from the library (studio.py lib prop "<what>"), sized in metres, sitting on y = 0.
export async function loadProp({ THREE, id, base = here }) {
  const dir = `${base}props/${id}/`;
  const meta = await (await fetch(dir + "prop.json")).json();
  const g = await new GLTFLoader().loadAsync(dir + meta.file);
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g.scene;
}
