# From a prompt to a video that does not read as generated

A generated video shows itself in four ways: facts nobody checked, a script that lists instead of telling, pictures
that are near the words instead of on them, and sound that never stops. Each step below removes one. Do them in
order, and do not start a step until the one before is on the page for the user.

## 1. Research (`EDIT/research.md`)

- Read 5 to 8 pages from at least 3 different sites. Prefer the primary source: the paper, the agency's own number,
  the company's own statement, the interview itself. A blog repeating a number is not a source for it.
- Write the angle in one line and **the one question the video answers** in another. If you cannot write the
  question, there is no video yet: narrow the topic.
- List every fact you may use, one a line, with its number and its URL. Check each number against a second page when
  the video leans on it. Mark a number the sources disagree on, and say so in the script.
- List who has said something on camera about it (a scientist, the person the video is about, a witness), with the
  video it is in. One of them opens the video.
- List what can be SEEN: the real place, object, machine, event, document. A line nothing can be shown for is a
  line to cut or to give a graphic.

## 2. The beats (`EDIT/beats.md`)

Before any script, the story in 6 to 10 beats, one line each: what the viewer learns and why they keep watching.

1. **Open**: a person saying the surprising thing in their own words (a sound bite), or the single strangest fact.
2. **The question**: said plainly, in the first 20 seconds.
3. to n-2. **Steps**, each one answering part of the question and raising the next part. Order them so each is
   stranger or closer to the viewer than the last: far to near, small to large, old to now.
4. **The turn**: the beat where the obvious answer turns out wrong or incomplete.
5. **Proof**: the experiment, the measurement, the day it was shown to be true.
6. **Close**: the answer to the question in one line, brought back to the viewer's own life. No summary, no
   "so next time you".

Show the beats to yourself against the research: every beat has at least one sourced fact and at least one thing to
see. A beat with neither goes.

## 3. The script

- One line is one thought, 8 to 22 words, written to be said: short words, the number last, no brackets.
- Numbers a person can picture: "seven thousand times slower", not "a Lorentz factor of 7,000".
- No line that could open any video ("Have you ever wondered", "In this video", "Let's dive in", "But here's the
  thing", "It turns out"). No three-part lists for rhythm. No question the next line does not answer.
- Every line that states a researched fact carries its `source`.
- Read it aloud in your head at speaking pace. Where you would breathe, end the line.

The user approves the script before anything is recorded. Show it with its section names and say how many sources
it rests on.

## 4. The storyboard (the shots on each line)

- For each line, write what is on screen second by second: the specific thing first (the named person in an
  interview, the actual machine, the actual place), generic footage only between them.
- Give every `clip` a `see`. Two shots never share the same picture.
- Decide the graphics from the beats, not the lines: where a number carries the beat it gets a data card on the
  footage; where one quantity runs through a section it gets a `hud`; where the beat is a comparison it gets one
  chart. A full-frame graphic at most once a section.
- After `find`, look at every sheet (`longvideo.py sheet`). A shot that does not show its line is changed now. `WEAK`
  and `MISSING` lines from `find` are a list of shots to fix, not warnings to read past.

## 5. The preview, before the final render

Build with what is found (animated graphics not built yet show their simple fallback), render a draft
(`studio.py render EDIT --draft`), and put it in the editor:
`review.py EDIT round --video EDIT/render.mp4 --stage edit --note "Preview: check the pictures and the sound, then
approve for the final render."` Wait for the notes. Only on approval: build the animated graphics and charts, render
in full (4K if asked), run `qa`, and hand over with the thumbnails and the kit. Notes on a preview are cheap to act
on; notes on a final render cost the whole render again.

## 6. Sound

`sound` makes a quiet bed under the voice that rests: out under a sound bite, out before a new section, out for the
first words. It marks a section, a number and a graphic with a sound, and nothing else: a plain change of footage is
silent. It prints `FLAT MIX` when the loud and quiet moments are less than 9 dB apart (published videos of this kind
measure 11 to 12). Fix a flat mix before the preview: leave air between lines in the voice (`voice --fit`), or turn
the music off for that video. Never raise the music to "fill" a pause: the pause is the production value.
