---
name: animated-video
description: Makes a fully animated video from a text prompt, with no camera footage. Writes a script split into scenes, has the user approve it, then animates every scene full frame (one ai-editor clip-builder agent per scene), adds any of an AI voiceover (ElevenLabs with the user's key, else the free macOS voice), word-timed on-screen text and generated music, renders it and opens it in the editor for notes. Optional reference links set the look and pace, measured only, never reused. Use when a home page job says `JOB animated`, or the user says "make an animated video about", "animated explainer", "create a video from a prompt", "text to video", "make a video with no footage". Not for editing the user's own footage (that is the ai-editor start skill), not for a product film of a website (product-video), not for copying a reel onto b-roll (broll-reel).
license: MIT
compatibility: Python 3.10+, ffmpeg, Node, and the ai-editor plugin installed beside it with its venv, motion tools (HyperFrames, GSAP) and renderer (the ai-editor setup skill installs them). macOS `say` for the free voice.
---

# Animated video

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md, and `${CLAUDE_PLUGIN_ROOT}` the plugin folder two levels above it.

This skill lives in the studio plugin, kept apart from the editor. It calls the editor's code and never edits it.
Find the editor first: `python3 "${CLAUDE_SKILL_DIR}/scripts/studio.py" root` prints its folder; call it `E`.
Read `$E/PRINCIPLES.md` (asking, looking real, motion, privacy, cost): every rule there holds here too.

Every question to the user goes in the question box: call the AskUserQuestion tool (2-4 options, the recommended
one first). The editor window shows it as a card on the open page. Only in an agent without that tool, ask numbered
questions in text.

Run the scripts with `python3` on Mac and Linux, `py` on Windows.
`PY="$E/lib/ai_editor/run.py"` (`python3 "$PY" <script>` runs the editor's venv Python; `py "$PY"` on Windows),
`T="${CLAUDE_SKILL_DIR}/scripts/studio.py"`, `H="$E/lib/ai_editor/home.py"`, `R="$E/lib/ai_editor/review.py"`,
`EDIT` the job's `edit=` folder (`<library>/edits/<name>/`).

```
brief.json -> (refs: creator-teardown quick mode for the look and pace) -> scenes.json -> the user approves the script
  -> studio.py voice -> words -> briefs -> one ai-editor:clip-builder agent per scene (all at once) + studio.py music
  -> build -> render -> stills (look) -> review.py round (the editor) -> notes -> fix the scenes named -> again
```

Report each step on the page: `python3 "$H" status animated --step "Writing the script"` (and so on), and at the end
`python3 "$H" status animated --result '{"edit": "<EDIT>"}' --done`. On a failure: `--failed "<one line why>"`.

## 0. The brief

`EDIT/brief.json`: `{"prompt", "refs": [links], "aspect": "9:16"|"16:9", "length": seconds, "voice", "text", "music"}`
(the last three true or false: what the user ticked). Asked in chat instead of the page: make the edit folder with
`python3 "$E/lib/ai_editor/library.py" path`, then `edits/<slug>/`, write brief.json yourself, and ask in one question
box call: shape (Tall 9:16 recommended / Wide 16:9), length (30 s recommended / 15 s / 60 s), and which to include
(voice, text and music recommended / no voice / no music). Then `python3 "$R" EDIT start --raw --video <any 2 s clip>
--stage edit` so the editor has the video.

## 1. The reference links (only when `refs` has any)

Only their style is measured, never their footage, words or music. Run the creator-teardown skill's quick mode on
the links (its SKILL.md, the links in `picks.txt`), then read its `style.json`: the pace (words a second, so the
script's line lengths), the caption look (its `captions` block goes into scenes.json `captions`), and the colours
and type the look notes name (scenes.json `look`). Say in one line what you took from them.

## 2. The script: `EDIT/scenes.json`

```json
{"title": "How a black hole forms", "mood": "linear", "look": "board",
 "captions": {},
 "scenes": [{"id": "hook", "say": "What happens when a star runs out of fuel?",
             "text": "When a star runs out of fuel", "visual": "a bright star flickering, its glow shrinking inward"}]}
```

- About one scene per 4-6 s of the asked length. Each `say` is one sentence of at most 16 words (a voice reads about
  2.6 words a second); longer: split it into two scenes. The first scene hooks in its first second with a question
  or a surprising claim; the last lands the one idea the viewer keeps.
- `id`: short kebab-case, unique. `visual`: one concrete picture that makes the line understood (a mechanism, a
  count, a before and after, a real-looking UI), never a stock image or words on a plain ground.
- `text`: the on-screen words when there is no voice (the voice is off and text is on). With a voice the captions
  are the spoken words, so `text` may be left out.
- `look`: one of `board` (near-black, the default for explainers), `editorial`, `editorial-dark`, `paper`, `mono`,
  or an object `{"ground", "ink", "accent", "font"}` from the reference's colours. `mood` for the music: `linear`
  (calm, the default), `apple` (upbeat), `stripe` (light), `arc` (playful), `raycast` (fast, dark).
- Facts must be true. Unsure of a fact: leave it out or say it less precisely. No names of real people unless the
  user's prompt names them.

`python3 "$PY" "$T" check-scenes EDIT` prints each scene with its length; fix every FIX line.

Show the script on the page: one AskUserQuestion call, the question listing each scene as `1. <say>` (or its text),
options "Looks good, make it" (recommended), "Change it" (the user types what). On a change, edit scenes.json and
ask again. Never animate a script the user has not approved.

## 3. Voice, words, briefs

```bash
python3 "$PY" "$T" voice EDIT          # --engine auto: ElevenLabs with a saved key, else the macOS voice; none when voice is off
python3 "$PY" "$T" words EDIT          # words.json on the video's clock (the voice transcribed per scene)
python3 "$PY" "$T" briefs EDIT         # EDIT/motion/<id>/ per scene: template, beat.json, brief.md
```

The voice is the `voice` step's line: say which engine it used. `auto` falls to the Mac voice with no ElevenLabs key;
tell the user once that a key (setup skill, "add my elevenlabs key") sounds more natural and costs a little per
video on their ElevenLabs plan. A 401 from ElevenLabs: the key lacks text to speech; say so and use `--engine mac`.
`briefs` stops when the motion tools are missing: run the editor's setup skill (`setup.py motion`), then again.

## 4. Animate every scene

Launch one `ai-editor:clip-builder` agent per scene, all in one message, in the background, each given only the
full path of its `EDIT/motion/<id>/brief.md`. While they build, run the music (it needs only the timing):

```bash
python3 "$PY" "$T" music EDIT --mood <scenes.json mood>   # audio/mix.wav: music under the voice, -14 LUFS (skips what is off)
```

Each agent returns `{"clip", "pass", "render", "what", "failing"}`. Look at every passed clip's `renders/sheet.png`
yourself: a scene that shows the wrong idea, reads as generic, or leaves the frame empty gets one note to its agent
(SendMessage, its id from the launch) before you build. A scene that does not pass after its checks falls back to a
plain moving ground in `build`; say which ones.

## 5. Build, render, look

```bash
python3 "$PY" "$T" build EDIT          # studio.scene.json: the clips back to back, captions per scene, the mix
python3 "$PY" "$T" render EDIT         # EDIT/render.mp4 (Remotion, the editor's Scene composition)
python3 "$PY" "$T" stills EDIT         # EDIT/stills/sheet.jpg|png: the middle of every scene
```

Look at the stills sheet: captions readable and clear of the animation's important parts, every scene filled,
nothing cut off at the edges. Fix before handing over (a caption clash: scenes.json `captions` `{"y_pct": 80}`,
build and render again).

## 6. The editor

```bash
python3 "$R" EDIT round --video EDIT/render.mp4 --stage edit
python3 "$R" EDIT wait                  # in the background: the user's notes or approval
```

Then `status animated --result ... --done` (above) and say in one line that it is in the editor.

On notes (`SEND`): each note has a time; the scene it falls in is the row of `EDIT/timing.json` whose start and
length hold it. A note on the picture: write it to `EDIT/motion/<id>/notes.md` and send that scene's agent the note
(SendMessage; a new `ai-editor:clip-builder` agent with the brief path if it is gone). A note on the words: change
that scene's `say` in scenes.json, then voice, words and briefs again (only changed scenes get new voice and a new
template; a scene whose length changed must be rebuilt by its agent). A note on the voice, music or captions:
`voice --voice <id>`, `music --mood <m>`, or scenes.json `captions`. Then build, render, stills, and
`python3 "$R" EDIT round --video EDIT/render.mp4 --stage edit` again. On `APPROVE` the video is done:
`EDIT/render.mp4`.

## Rules

- No footage, music or words from a reference video ever go into the video: only measured style.
- Every number, name and claim on screen or in the voice is from the prompt or true to your knowledge; the user's
  approval of the script is the check.
- Never paste or ask for an API key in the chat; keys are saved with the setup skill's commands in the user's
  own terminal.
- Spending: the ElevenLabs voice bills the user's own plan. Say so before the first ElevenLabs voice on a video
  longer than 60 s.
