# 3D videos are made of a few worlds, not many scenes

A 3D video that looks produced has four to six worlds (a city street, Earth from orbit, a desert, the Moon, the
galaxy), each built once and richly, and every shot is one of those worlds with a different camera and action. A
video of sixty small scenes built from scratch looks generated: plain shapes, a new style every few seconds, nobody
to follow. Measured on a published video of this kind: 5 worlds, about 190 shots, one person on screen throughout, a
data display in the same two corners for ten minutes.

## scenes.json for a 3D video

```json
{"title": "...", "style3d": true,
 "hud": {"left": {"label": "YOUR SPEED", "unit": "km/h"}, "right": {"label": "ENERGY", "unit": "MJ"}},
 "worlds": [{"id": "street", "describe": "A New York side street by day: brick buildings with rows of windows, parked
              cars, street lamps, a wide pavement. The runner is always on the left pavement."},
            {"id": "orbit", "describe": "Earth from low orbit, day side and night side, the Sun low on the limb."}],
 "scenes": [{"id": "walk", "world": "street", "say": "It starts as a normal walk.",
             "visual": "Side on, at head height, tracking the person as they walk past two parked cars.",
             "hud_values": {"left": 5.0, "right": 0.000068}}]}
```

- **Worlds**: 3 to 6. `describe` is what is there and what never changes in it. One world holds the story's person
  (`models/person.glb` walks and runs; `models/robot.glb` for a robot) so the viewer has someone to follow.
- **Scenes**: every scene names its `world`. `visual` is only the camera and what happens in this shot. Stay in a
  world for 6 to 20 scenes in a row before leaving it; come back to it later for the pay-off.
- **`hud`**: one or two quantities that run through the whole video. Each scene gives their values at its end
  (`hud_values`), so the display counts between scenes instead of jumping.
- **Story**: one person and one escalating question ("what if you could not stop speeding up?"), each step measured
  against something the viewer knows. Not a list of facts.

## The kit (`assets/kit/` in every clip, from `studio.py kit-setup`)

| path | what |
|---|---|
| `textures/earth_day.jpg`, `earth_night.png`, `earth_clouds.png`, `earth_specular.jpg`, `earth_normal.jpg`, `moon.jpg` | photographic planet maps (NASA) |
| `sky/day.hdr`, `sky/sunset.hdr` | skies to light a world and fill its background |
| `pbr/<brick|asphalt|concrete|sand|rock>_<diff|nor|rough>.jpg` | tiling surfaces: colour, normal, roughness |
| `models/person.glb` (clips: idle, walk, run, sneak_pose, sad_pose, agree, headShake), `models/soldier.glb` (Idle, Walk, Run), `models/robot.glb` (Idle, Walking, Running, Jump, Wave, ...) | animated figures |
| `models/own/*.glb`, `*.fbx` | the user's own figures, when there are any (the world brief lists them) |
| `jsm/loaders/GLTFLoader.js`, `FBXLoader.js`, `RGBELoader.js`, `jsm/utils/SkeletonUtils.js` | three.js loaders, imported as `three/addons/...` |

**Figures.** The built-in person is a plain grey figure and the soldier is in armour: neither is a realistic civilian.
A figure moves well only with animation made for its own skeleton (tested: the person's walk put on two other clothed
models folded them up), so never put one model's clips on another. For a realistic clothed person the user downloads
one from mixamo.com (free with an Adobe login: pick a character, then the Walking and Running animations, format FBX,
"with skin") into the kit's `models/own/` folder; the world brief then names those files and the world uses them. Tell
the user this once when a video has a person and `models/own/` is empty; do not stop the video for it.

The clip's `index.html` already has the import map: `import * as THREE from "three"` and
`import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"` work.

## How a world must be wired so every frame renders

1. The clip's main script registers its timeline in `window.__timelines[id]` as the template does. Leave that.
2. A `<script type="module">` after it builds the world. Load everything first with `await` (`loadAsync`, or a
   promise round `TextureLoader.load`), then build, then add one tween to the registered timeline:
   `tl.to(state, {t: 1, duration: DURATION, ease: "none", onUpdate: draw}, 0)`, then call `draw()` once.
3. `draw()` sets every position, the camera and each figure's animation from `state.t` alone and renders. Never
   `requestAnimationFrame`, never a clock. A figure: `mixer.setTime(seconds)`, with `walk` and `run` both playing and
   their weights crossfaded.
4. `new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true})`, `outputColorSpace` sRGB,
   `ACESFilmicToneMapping`, shadows on (`PCFShadowMap`) with the light's shadow box following the subject.
5. A custom shader's `#include <tonemapping_fragment>` and `#include <colorspace_fragment>` each go on their own line.
6. Numbers and labels are HTML over the canvas, updated in `draw()`.
7. No shot may read as black. Space and night still need the subject lit (a rim light, city lights, a glow);
   `studio.py build` prints `DARK <scene>` for a shot whose brightness is under 28 of 255, and that scene gets a note.

Two worlds that rendered as written are beside this file: `../worlds/earth-orbit.html` (day and night maps blended by
the Sun's direction, a specular ocean, clouds, an atmosphere shell, stars, an orbiting point with a trail) and
`../worlds/city-street.html` (an HDR sky, brick buildings with windows, a textured road and pavements, lamps, parked
cars, a figure crossfading from walk to run, a tracking camera, shadows). Read the one nearest to what you are
building and start from it; take them further (more detail in the mid-ground, depth haze, a longer lens, motion that
never stops).

## A world is a module

`EDIT/worlds/<id>.js` exports `async function createWorld({THREE, canvas, K, loaders})` (`K` is the kit's address,
`"./assets/kit/"`) and returns `{renderer, scene, camera, update(state)}`: `update` takes
`{time, ...whatever the world documents}` and moves the world (a figure's position and gait, the planet's turn, cars).
Its first comment lists what `state` it reads and what it exposes for a shot to aim a camera at
(`world.person`, `world.sun`, lengths in metres). Every clip that uses it imports it from
`./assets/worlds/<id>.js`, sets the camera and the action for its own shot, and calls `world.renderer.render(...)`.
A shot never rebuilds the world and never changes its look.
