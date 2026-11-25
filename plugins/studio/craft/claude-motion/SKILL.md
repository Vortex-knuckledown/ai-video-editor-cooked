---
name: claude-motion
description: A motion design toolkit for coding agents: compact motion rules with their numbers, a render-look-fix review loop, sound design rules with a pure Python synth, and a small three.js stage with bloom and punch-ins.
---

# claude-motion (vendored, MIT)

From github.com/whaleyxbt/claude-motion, copied unchanged. See LICENSE.

- `motion-design.md`: the rules and their curves (out `0.16,1,0.3,1`, in `0.6,0,0.9,0.35`, in-out `0.65,0,0.35,1`).
- `review-loop.md`: render a draft, put one frame a beat on a sheet, check it against a list, fix, render again,
  and stop only when a whole pass finds nothing.
- `sound-design.md` and `sfx/`: clicks, pops, whooshes, risers, impacts and pads synthesised with the standard
  library, mixed to -14 LUFS from a timeline.
- `web-sims.md`, `kit/util.js`, `kit/stage3d.js`: one page whose every frame is a function of time; easings, keyframes,
  a seeded random, and a three.js stage with ACES tone mapping, bloom and crisp crop punch-ins.
- `scripts/sheet.mjs`: a labelled contact sheet at every beat of a timeline.

Changed from the original: `sfx/__main__.py` opens its timeline with `encoding="utf-8"` (one line).
