---
name: motionmaxxing
description: Measured rules for motion that reads as made by a person, not generated: durations, eases, stagger, what never ships, how a frame becomes a world, how scenes join. With a seek-safe GSAP runtime and a script that finds empty and frozen frames.
---

# motionmaxxing (vendored, Apache-2.0)

From github.com/Tejashmakwana/motionmaxxing by Tejas Makwana. Copied unchanged: `references/`, `runtime/motion.js`,
`scripts/look.py`. Not copied: its bundled GSAP and three.js (this app has its own), and its scripts that call
outside services. See LICENSE and NOTICE.

Read for the job at hand:

- `references/slop.md`: the default of a generated video beside what a professional does, as a table, and the
  checklist a render must pass. Read first, for every clip.
- `references/motion.md`: measured durations, eases and stagger (entries 12 frames, opacity 6, exits 13 to 14).
- `references/world.md`: ground, light, depth and texture, so no frame is a card on a flat colour.
- `references/transitions.md`: 20 ways one scene joins the next, and when to use each.
- `references/layout.md` and `references/type.md`: sizes by role, where things sit, how much may be empty.
- `references/director.md` and `references/judgment.md`: how to plan a film and how to judge one.
- `runtime/motion.js`: one script that needs only GSAP. `Motion.film()` gives named measured eases, `enter`, `exit`,
  `words`, `type`, `cut`, and a self test that every frame is a pure function of time.
- `scripts/look.py FILM.mp4 --out DIR`: a contact sheet, the cuts, frozen stretches, empty frames, the end hold,
  loudness, and `gates.json`. Standard library and ffmpeg (its sheet needs an ffmpeg built with the drawtext filter;
  this app's `longvideo.py look` measures the same gates with OpenCV where that is missing).

Changed from the original: `scripts/look.py` opens its text files with `encoding="utf-8"` (four lines), so it runs on Windows.
