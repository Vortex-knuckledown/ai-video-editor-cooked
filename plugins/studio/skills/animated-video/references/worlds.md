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
  (a library character: `man`, `woman`, `robot`) so the viewer has someone to follow.
- **Scenes**: every scene names its `world`. `visual` is only the camera and what happens in this shot. Stay in a
  world for 6 to 20 scenes in a row before leaving it; come back to it later for the pay-off.
- **`hud`**: one or two quantities that run through the whole video. Each scene gives their values at its end
  (`hud_values`), so the display counts between scenes instead of jumping.
- **A tall video (a Short)**: the `hud` is one card at the top centre, not two corners; the first scene shows the
  question as a title in heavy white capitals with its number largest ("WHAT IF EVERY PUNCH YOU THREW WAS 2x
  STRONGER?") over the first shot, and the last scene shows it again with "FULL VIDEO ON THE CHANNEL" under it when
  there is a long version. A new shot every 2 seconds.
- **Story**: one person and one escalating question ("what if you could not stop speeding up?"), each step measured
  against something the viewer knows. Not a list of facts.

## The kit (`assets/kit/` in every clip, from `studio.py kit-setup`)

| path | what |
|---|---|
| `textures/earth_day.jpg`, `earth_night.png`, `earth_clouds.png`, `earth_specular.jpg`, `earth_normal.jpg`, `moon.jpg` | photographic planet maps (NASA) |
| `sky/day.hdr`, `sky/sunset.hdr` | skies to light a world and fill its background |
| `pbr/<brick|asphalt|concrete|sand|rock>_<diff|nor|rough>.jpg` | tiling surfaces: colour, normal, roughness |
| `jsm/loaders/GLTFLoader.js`, `FBXLoader.js`, `RGBELoader.js`, `jsm/utils/SkeletonUtils.js` | three.js loaders, imported as `three/addons/...` |

## The shared library (`assets/lib/` in every clip, `../lib/` from a world module)

Characters, worlds and props are kept in one library outside any video (`~/.ai-video-editor/library3d`) and reused.
`studio.py lib list` prints what is in it. Read it before writing the script.

- **Worlds.** When the script is in a place the library has (it says New York, the library has a New York street),
  the world in scenes.json is `{"id": "street", "library": "street", "describe": "..."}` and nothing is built: it is
  copied in. When the place is there but the video needs more of it, add `"extend": "snow on the ground and falling"`:
  the world's agent starts from the library copy and adds that (saved as a new library world; with `"update": true`
  it replaces the library's copy, for an improvement every video should get). A place the library does not have is written as a new
  world, and once it passes it is saved to the library by `studio.py briefs`, so the next video has it. Write a new
  world's `describe` as the place itself (what is there, the time of day), not this video's story, so it can be found
  and reused.
- **Characters.** `import { loadFigure } from "../lib/figure.js"`; `const f = await loadFigure({THREE, id: "woman",
  clips: ["idle", "walk", "run"]})`; `scene.add(f.object)` (feet on y = 0, facing +z, in metres); in `update`,
  `f.pose(seconds, {walk: 0.3, run: 0.7})`. `man` and `woman` are clothed people with idle, walk, run, jog and talk, and
  any of about 130 more movements on request (`studio.py lib clip woman "dance"`). Their shirt and trousers take any colour
  (`loadFigure({..., outfit: {shirt: "#2f6fdd", trousers: "#3b4a6b"}})`), so two bodies give a whole cast: give the
  story's person one outfit and keep it for the whole video; dress passers-by differently. `mannequin`, `soldier` and
  `robot` have only the clips in their files. A figure moves well only with clips made for its own skeleton: never load one
  character's clip onto another (tested: it folds up). A world takes `cast = ["woman"]` and exposes `world.cast.<id>`,
  so the same place works with anyone in it.
- **Props.** A thing the world needs (a bench, a tree, a rock, a sofa, a lamp): `studio.py lib prop "<what>"` lists
  free models, `studio.py lib prop-get <id>` puts the right one in the library for good, and
  `await loadProp({THREE, id})` (from `figure.js`) returns it in metres. Nothing that matches is built from shapes
  and the kit's surfaces.
- **The user's own figure** (a Mixamo download, say): `studio.py lib character <id> <body file> walk=<file> run=<file>`.

The clip's `index.html` already has the import map: `import * as THREE from "three"` and
`import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"` work.

## How a world must be wired so every frame renders

1. The clip's main script registers its timeline in `window.__timelines[id]` as the template does. Leave that.
2. A `<script type="module">` after it builds the world. Load everything first with `await` (`loadAsync`, or a
   promise round `TextureLoader.load`), then build, then add one tween to the registered timeline:
   `tl.to(state, {t: 1, duration: DURATION, ease: "none", onUpdate: draw}, 0)`, then call `draw()` once.
3. `draw()` sets every position, the camera and each figure's animation from `state.t` alone and renders. Never
   `requestAnimationFrame`, never a clock. A figure: `f.pose(seconds, {walk, run})`.
4. `new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true})`, `outputColorSpace` sRGB,
   `ACESFilmicToneMapping`, shadows on (`PCFShadowMap`) with the light's shadow box following the subject.
5. A custom shader's `#include <tonemapping_fragment>` and `#include <colorspace_fragment>` each go on their own line.
6. Numbers and labels are HTML over the canvas, updated in `draw()`.
8. **The finish.** A world renders through `postprocessing` (`import { EffectComposer, RenderPass, EffectPass,
   BloomEffect, DepthOfFieldEffect, VignetteEffect, NoiseEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode }
   from "postprocessing"`): renderer with `antialias: false` and `NoToneMapping`, a composer with
   `frameBufferType: THREE.HalfFloatType`, one `EffectPass` of depth of field (`worldFocusDistance`,
   `worldFocusRange`, the subject sharp and the far distance soft), a restrained bloom (threshold about 0.8) and a
   vignette, then one of SMAA, ACES tone mapping and a little grain. `world.render()` calls `composer.render(1/30)`.
   `n8ao` (`import { N8AOPostPass } from "n8ao"`) adds contact shadows where things meet the ground. Sharp 3D type:
   `import { Text } from "troika-three-text"` and `await` its `sync()` before the first draw. A worked example is
   `plugins/studio/skills/long-video/templates/chart3d.html`. Read `plugins/studio/craft/threejs-postprocessing/SKILL.md`
   and `threejs-lighting/SKILL.md` first. Without this finish a world reads as a game engine preview.
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
