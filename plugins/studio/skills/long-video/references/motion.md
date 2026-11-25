# How a scene moves: the rules every animated scene is built and measured by

Our scenes looked designed and read as slides: everything arrived in the first second, then one slow push until the
cut. Measured, they changed 0.6 to 2.4 a frame where films people made change 4 to 10. These rules are what working
motion designers and the best open-source motion skills agree on (sources at the end). `look` measures them; a scene
that fails is rebuilt.

## 1. Plan the scene as events on the spoken words

Before any code, write the scene's events as a list in a comment at the top of the timeline: time, what happens, the
word it lands on (the brief gives every word's time).

- **Something new at least every 2 to 3 seconds, and something in flight in every second.** A new event is a piece
  arriving, a value changing, a line drawing, a highlight landing, the camera arriving somewhere new. Never more than
  3 s without one. A 5 s scene has 3 to 5 events; a 9 s scene has 5 to 8.
- **Nothing is front-loaded.** At t=0 only what the first words name is on screen, and it is already moving (first
  motion inside 0.5 s). Each further piece arrives ON the word that names it. If everything is on screen by a quarter
  of the scene, it is a slide: split it.
- **A reading hold keeps evolving.** A chart or diagram may stay 5 to 12 s only while it gains something: the next
  bar, a label, a ring round the number, a crop to the part being said.
- **One short stillness is allowed**: 0.3 to 0.75 s between an action and its result (the hit, then the number).

## 2. How each thing moves

- **Arrive**: 0.35 to 0.6 s (never over 0.8 s), `power3.out` (`power4.out` for a fast arrival), two or three properties at once
  (position and opacity and blur, or scale and opacity), never opacity alone, never linear on a move.
- **Leave**: 65 to 75% of the arrival's time, `power3.in`.
- **Groups**: 40 to 80 ms between items, the whole stagger under 0.5 s; from the ninth item on, they arrive together.
- **Who follows whom**: a child trails its parent by 50 to 150 ms; a shadow or label lands 50 to 100 ms after its
  panel; a secondary part moves 30 to 50% as far as the main one; the ground moves 20 to 30% the other way.
- **Overshoot**: none. An overshoot on a number or a bar reads as a real value, and on a panel it reads as a toy.
  `back`, `elastic`, `expo` and bounce are refused by `check`.
- **Numbers and charts**: a count-up 0.8 to 1.2 s `power2.out`; bars grow about 1 s each, 0.3 to 0.45 s apart, on the
  same axis; a line draws itself (`strokeDashoffset`) in 1 to 1.5 s; a marker sweep takes about 1 s a line.
- **Live insides, not breathing.** A thing that stays on screen is kept alive by what it IS doing: water rising,
  gauges turning, dashes flowing along a path, a counter running, light crossing glass. Never by scaling a card up and
  down or floating panels on a sine.

## 3. The camera

- One camera for the scene, on one `.world` wrapper (or the three.js camera), moving from the first frame to the
  last with intent: wide, travel, arrive. Scale 1 to 1.06 up to 1.12 over the scene with a counter-translate toward
  the subject (about 1.5 to 2% a second). It never starts a new drift in the back half of a scene, where it only
  pulls the eye off what is being read.
- When the subject changes, the camera goes there: a move of 0.5 to 0.8 s that accelerates, travels, and settles
  long (10% of the distance in the first 20% of the time, 65% in the next 18%, the rest in the last 62%). New things
  appear during the fast middle.
- Depth: at least three layers that move by different amounts under the camera (front 1.0, middle 0.5, back 0.2,
  far 0.1), the far one blurred. In CSS 3D, give layers a `translateZ` under one `perspective` and move only the
  camera. Text is never on a parallax layer.

## 4. Cuts inside a scene are made at speed

When a scene swaps one thing for another (a line of text, a panel, a view), never crossfade and never cut between
two things at rest.

- **Same direction, at peak speed.** The old one accelerates out (`power4.in`, 0.3 to 0.35 s, about 12% of the frame,
  its fade finished in the first 30% of the travel); the new one is already moving the same way when it appears
  (`power4.out`, from the same distance, starting at opacity 0.35).
- **Through the lens** for a text or panel swap: out with scale 1 to 1.2 and blur 0 to 10 px in 0.2 s (`power3.in`),
  in from 0.75 to 1 and blur 10 to 0 in 0.5 s (`power4.out`). The scale keeps growing across the cut.
- Two or three kinds of cut in a film, repeated; not a new one each time.

## 5. Measure, then fix

After `motion.py check` passes, run the measure the brief gives (`look EDIT --only <scene>`). It fails a scene when

- the picture changes less than 2.0 a frame at its median (films people made: 4 to 10), or
- any whole second changes less than 1.0 (that second is a slide), or
- frames are empty or frozen.

Fix a quiet second with the next event, a camera arrival or a live inside, in that order. Never with grain, a
flicker, a pulsing glow or a wobble: the measure is taken on a small soft frame that those do not move, and the
reviewer rejects them.

## Sources

Motify motion doctrine and cut-the-curve (Apache-2.0, `craft/motify/`); LottieFiles motion-design skill (MIT,
`craft/lottie-motion/`); HyperFrames motion doctrine; Remotion's animation docs; School of Motion on follow-through;
a study of 4,412 scenes in 33 faceless long-form videos (median scene 3.6 s, 81% under 6 s; a chart held 5 to 12 s
only while it changes); tutorials on document highlights, 2.5D photos and Vox-style maps. Where sources disagree
(idle motion), this page takes the stricter: move the camera and the subject's insides, never wobble the layout.
