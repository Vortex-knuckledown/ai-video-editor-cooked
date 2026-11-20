# The director's pass: one film, designed before any scene is built

The user gives one sentence. Nobody directs the film but you, and you do it here, once, after the script is approved
and before any brief is written. Without this step every scene is made by a helper that has never seen the others,
and the video is a row of unrelated ten-second ideas. `briefs` refuses to run until this is done and reviewed.

Everything goes in `EDIT/direction/`.

## 1. Decide what kind of film this topic is (`mode.json`)

Decide this BEFORE the script, from the research and `subjects.md`, because it decides which shots the script may
use (`check` enforces it). Write `{"visuals": "...", "why": "one sentence"}`. The rest of this page is done after the
script is approved.

- **`real`**: the video is about real people, companies, places or events that were photographed and filmed (an
  actor's career, a company's fall, a war, a product launch). The picture is their photographs, their interviews,
  news footage, with clean 2D graphics for the numbers and names. A drawing of a person who has a face the viewer
  knows is always worse than their photograph.
- **`animated`**: the video is about something no camera can show: a hypothetical ("what if a meteor hit Earth"),
  something too big, too small, too far or too long ago (the inside of a star, a cell, the early universe), or a
  mechanism (how an engine, a market or an algorithm works). Use depth and a moving camera (three.js) when the thing
  has a body in space: a planet, an impact, a machine, a landscape. Stay flat (SVG, canvas) when it is a diagram, a
  system or a flow. One film may use both, in the same design system.
- **`mixed`**: real material for what is named and was filmed, animation for what cannot be filmed. Most
  documentaries and explainers about science, money and history are this.

If the brief already has `visuals` set to one of these, the user chose it: write the same value and say why it fits.

## 2. The design system (`direction.md` and `system.css`)

Write `direction.md`, a page a stranger could build from:

- **The idea in a line.** What this film looks like, said as a comparison a designer would understand ("a NASA
  mission briefing at night", "a 1970s newspaper investigation", "a clean lab bench in daylight"). It comes from the
  topic, not from habit: a film about a wedding industry is not near-black with blue lines.
- **Colour.** A ground, a second surface, the text colour, ONE accent, one colour for danger or contrast when the
  story needs it, as hex values. Say what each is for. Check the text on the ground is easy to read.
- **Type.** One display face for headlines and numbers, one text face for labels, with sizes as a share of the
  frame's height (a label is never under 2.4% of it).
- **Shapes and surfaces.** How a panel looks (corner, edge, fill, shadow), how a line is drawn (weight, ends), how
  depth is shown (blur, haze, light), what texture sits over everything (grain, none).
- **Light and camera.** Where the light comes from. How the camera moves (slow push, orbit, track) and how fast.
  One language for the whole film.
- **Motion.** The easing every move uses, how things arrive and leave, how one scene hands over to the next.
- **What recurs.** The two or three things the viewer will see again and again (the same Earth, the same character,
  the same chart style), so the film has a memory.
- **Every scene, a paragraph each, by its id.** What fills the frame (the subject large, at least half its height),
  where it sits, what is behind it, what moves, and what it carries over from the scene before. This paragraph is
  what the scene's builder builds.

Then write `system.css`: the system as code, which every scene links and uses instead of inventing its own. CSS
variables for every colour, size, radius, shadow and easing; classes for the things that recur (`.panel`, `.label`,
`.kicker`, `.number`, `.rule`, `.grain`); `@font-face` only for fonts that are on the computer. Add `system.js` when
the film has shared drawing code (the same Earth, the same particle field, the same three.js lights and post chain).

## 3. Style frames (`frames/*.html`, then `frames EDIT`)

Build 3 to 5 still frames, each one HTML page the size of the video that links `../system.css`: the opening frame,
the frame of the most important moment, a frame with a number or a chart on it, and (in a real or mixed film) a frame
with a photograph under graphics (use any picture from `subjects.json`, or a grey block of the right shape). These
are finished frames, composed and lit, not wireframes.

```bash
python3 "$PY" "$L" frames EDIT      # direction/frames/*.png and direction/frames.jpg
```

Look at `direction/frames.jpg` yourself with the Read tool. Fix what is weak before anyone else sees it.

## 4. The frames are judged by someone who did not make them (`review.md`)

Give a fresh agent `direction/frames.jpg`, `direction.md` and this rubric. It writes `direction/review.md`: a mark
out of 5 on each line with what to change, ending `verdict: pass` (every mark 4 or 5) or `verdict: redo`.

1. **Designed, not generated.** Would a person believe a designer made these? Or are they thin lines and small
   shapes on an empty dark ground, default colours, centred text?
2. **The frame is full.** Is the subject large and lit, with something behind it and something in front? No frame
   that is mostly empty.
3. **One film.** Put any two frames side by side: same colours, type, edges, light?
4. **It fits the topic.** Does the look come from what the video is about?
5. **Readable on a phone.** Is every label large enough and clear of the bottom fifth, where the captions sit?
6. **Nothing cheap.** No clip art, no emoji, no gradient text, no stock-looking icon set, no plain default 3D
   shapes standing in for real things.

Redo the frames until it passes. Two rounds is normal.

## 5. After the scenes are built: the film is judged whole (`filmsheet EDIT`)

```bash
python3 "$PY" "$L" filmsheet EDIT   # sheets/film-N.jpg: every animated scene's first, middle and last frame, in order
```

Give a fresh agent the film sheets, `direction/frames.jpg` and `direction.md`. For each scene it answers: does it
look like the approved frames (colour, type, light)? Is the frame full and the subject large? Does its last frame
lead into the next scene's first? Is anything broken (overlapping text, a blank stretch, a default-looking shape)?
For every scene that fails it writes `motion/<key>/notes.md` saying exactly what to change, and lists them. Send each
of those scenes back to a builder with its brief (the brief tells it to read `notes.md`), then `filmsheet` again.
Two rounds at most; a scene that still fails is replaced by its fallback graphic. Never show the user a film whose
sheets you have not looked at.
