# From a prompt to a video that does not read as generated

A generated video shows itself in four ways: facts nobody checked, a script that lists instead of telling, pictures
that are near the words instead of on them, and sound that never stops. Each step below removes one. Do them in
order, and do not start a step until the one before is on the page for the user.

## 0. The title and the thumbnail come first (`EDIT/thumb.json`)

Before any research is written up: three working titles, and `EDIT/thumb.json`: `{"words": "1 to 5 words", "mark":
"the one word drawn in the accent", "frame": "optional: the shot file to cut the subject from"}`. The words add to the
title, they never repeat it (title "Why time slows down near light speed", thumbnail "TIME STOPS HERE"). `check`
refuses a script without it, and `thumbs` composes three thumbnails from it at the end: one subject cut out of its
frame on a dark ground, the words in heavy white capitals, one word in the accent (measured on ten published
thumbnails of this kind: 1 to 5 words, one subject, one accent, no arrows). The first 30 seconds of the script must show what the title and thumbnail promised, so they are
fixed before the script, not invented after it. (From the leaked MrBeast production memo: the first minute loses the
most viewers and has to confirm the title and thumbnail.)

## 1. Research (`EDIT/research.md`)

The method is Anthropic's own research pattern (the deep-research skill and the claude-cookbooks research prompts)
with open_deep_research's stopping rule. When the `deep-research` skill is in your skills list, run it on the topic
and write its findings into research.md in the format below; otherwise do the same steps yourself:

- Split the topic into 3 to 5 parts that do not overlap and research each (one researcher agent a part, all at once,
  when agents are available).
- Search with **short queries, under 5 words**, broad first, then narrower. Never the same query twice. **Fetch the
  whole page**, not the search snippet. 5 to 15 tool calls a part, 20 at most. Stop a part when it has 3 good
  sources or the last two searches said nothing new. At most one extra round.
- Prefer the primary source: the paper, the agency's own number, the company's own statement, the interview itself.
  Flag and avoid: an aggregator in place of the original, nameless sources in the passive voice, marketing language,
  cherry-picked numbers, a prediction dressed as a fact.
- Notes, one fact a line: `- <fact, with its number> [Source](URL)`. Where two sources disagree:
  `...; contradicted by [Source B](URL)`, and settle it by which is newer and which the others agree with, or say
  both in the script. Your own inferences go under **Inferences**, what you could not source under **Gaps**. The
  script may use nothing from Gaps and no number without a URL.
- Then: the angle in one line, **the one question the video answers**, who has said something on camera about it
  (with the video it is in; one of them opens the video), and what can be SEEN (the real place, object, machine,
  event, document).
- To find the angle (Stanford STORM's method): list the two or three viewpoints existing videos and articles take,
  and ask what each would say the others get wrong. The gap between them is usually the video.

5 to 8 pages from at least 3 sites, or `check` refuses the script.

## 2. The beats (`EDIT/beats.md`)

Before any script, the story in 6 to 10 beats, one line each: what the viewer learns and why they keep watching.

- **0 to 5 s: the grab.** A person saying the surprising thing in their own words, or the single strangest fact.
- **5 to 15 s: the exact promise.** What this video will show, in one plain line. It matches the title.
- **15 to 30 s: the stakes.** Why it matters to the viewer.
- **The loops.** Each middle beat is a setup, a tension and a payoff, and its payoff raises the next setup. Write the
  payoffs first, then the setups that earn them. 5 to 7 loops in ten minutes; 2 to 3 in two.
- **Re-engagement.** In a video over 4 minutes, something new at about 3:00 and 6:00: a turn, a new person, a change
  of place or scale. Every 30 seconds or so a change the eye or ear notices (a number on screen, a sound bite, a
  graphic, a new kind of footage).
- **The turn**: where the obvious answer turns out wrong or incomplete.
- **Proof**: the experiment, the measurement, the day it was shown to be true.
- **The close**: the answer in one line, brought back to the viewer's life, and stop. No summary, no "so next
  time you", no sign-off. End on the payoff.

Every beat has at least one sourced fact and at least one thing to see. A beat with neither goes.

## 3. The script, written with its pictures

Write it as two columns, one row a shot: what is said, and what is seen while it is said. scenes.json is that
table: `say` is the left column, `shots` the right. Decide the picture as you write the line; a line you cannot
show is rewritten or cut.

Writing for the ear (NPR's training rules: the listener cannot rewind):
- One line is one thought, 8 to 22 words. Short words. The number comes last. No brackets, no dependent clauses
  stacked in front of the point.
- Numbers a person can picture: "seven thousand times slower", not "a Lorentz factor of 7,000".
- Say it aloud in your head. Where you would breathe, end the line. If you would not say it that way to a friend,
  rewrite it.

Then take the tells of generated writing out (the `humanizer` and `stop-slop` skills when they are in your skills
list; these rules when they are not). None of these may be in the script:
- An opener any video could use: "Have you ever wondered", "In this video", "Let's dive in", "Imagine", "Picture this".
- Throat-clearing: "But here's the thing", "It turns out", "The truth is", "Here's where it gets interesting",
  "Now,", "So,", "Well,".
- "It's not X, it's Y" reveals. Three-part lists for rhythm. A question the next line does not answer.
- Stock intensifiers and praise: "incredible", "fascinating", "mind-blowing", "truly", "actually", "literally".
- Vague claims of importance: "plays a crucial role", "changed everything", "a testament to", "in today's world".
- A tidy moral or a summary at the end.
Score the draft 1 to 10 on each of directness, rhythm, trust, authenticity and density (stop-slop's rubric) and
rewrite until it totals 35 or more.

## 3b. Every claim is checked before the voice is recorded (`EDIT/claims.md`)

After the user approves the script, `longvideo.py claims EDIT` lists every line that states a number, a date, a
name or a superlative. Give that file to a fresh agent that has not seen your research (so it cannot agree with
you out of habit; this is Chain-of-Verification, with Google DeepMind's SAFE method of checking one atomic fact at
a time): for each row it searches, pastes the URL and the sentence that supports it, and writes `supported`,
`wrong` or `unsupported`. A `wrong` or `unsupported` line is fixed or cut, and the user is told what changed.
`longvideo.py claims EDIT --gate` refuses to go on while any row is open.

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
