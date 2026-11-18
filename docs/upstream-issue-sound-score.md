# Draft of a bug report for the original repository (not posted)

**Title:** `sound.py score` fails with a shape mismatch when given a voice

**Where:** `plugins/ai-editor/skills/product-video/scripts/sound.py`, the `score` mix.

**What happens:** scoring a video with a voice file stops with a NumPy broadcasting error. The music bed is
composed to `length + 0.05` seconds, and the voice is read (and padded) to `length` seconds, so the two arrays
differ by 0.05 s of samples when they are added.

**To see it:** run `sound.py score` with any mood, a length (for example 30) and a voice WAV of that length.

**Expected:** the bed and the voice are mixed and the file is written.

**A fix that works here:** read the voice to the bed's length (`length + 0.05`), or trim both to the shorter one
before adding. The studio plugin does this itself in `studio.py` (`cmd_music`) to get round it.
