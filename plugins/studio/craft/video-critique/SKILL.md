---
name: video-critique
description: A 13 pass critique of a finished video from its contact sheet, with a weighted score and caps, plus word budgets by speaking rate and the mechanical checks a video must pass (stills, black gaps, loudness, text size).
---

# video-critique (vendored, MIT)

From github.com/digitalsamba/claude-code-video-toolkit (Digital Samba): `video-design/critique.md` (itself adapted from
taste-skill, MIT), `docs/timing.md` and `docs/qc.md`, copied unchanged. See LICENSE.

- `critique.md`: thirteen passes over a contact sheet (what is seen in one second, one accent, one left edge, type
  sizes, one dominant thing a frame, sameness three in a row, generated-look tells, phone legibility, empty frames).
  Score design 40%, clarity 30%, idea 20%, content 10%. Three rounds at most.
- `timing.md`: words by speaking rate and narration density by scene type.
- `qc.md`: no still over 3 s, no black gap of 0.5 s, loudness at -14 LUFS, no text under 28 px at 1080p.
