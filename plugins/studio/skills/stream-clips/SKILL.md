---
name: stream-clips
description: Finds the best moments in long streams and gameplay videos (YouTube, Twitch, Kick links or files, up to 5 at once) and turns the ones the user picks into short clips with a gaming layout (facecam on top and the game below, a crop that follows the face, or the whole frame over a blurred copy), big word-by-word captions and a hook title, then opens them all in the editor for notes. Scores every second by YouTube's "most replayed" heatmap, the live chat's surges on a stream replay, and how loud the moment is against the minutes round it, downloads only the parts that score, never the whole stream. Use when a home page job says `JOB streamclips`, or the user says "clip this stream", "find the best moments of this VOD", "make clips of this streamer", "clip this gameplay video", "turn this Twitch stream into shorts". Not for a talking podcast or interview (that is the ai-editor clips skill), not for editing the user's own short take (start).
license: MIT
compatibility: Python 3.10+, ffmpeg, and the ai-editor plugin installed beside it with its venv (yt-dlp, numpy, OpenCV, Whisper) and renderer (the ai-editor setup skill installs them).
---

# Stream clips

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md, and `${CLAUDE_PLUGIN_ROOT}` the plugin folder two levels above it.

This skill lives in the studio plugin, kept apart from the editor. It calls the editor's code and never edits it.
Find the editor first: `python3 "${CLAUDE_SKILL_DIR}/../animated-video/scripts/studio.py" root` prints its folder; call it `E`.
Read `$E/PRINCIPLES.md` (asking, looking real, privacy, cost): every rule there holds here too.

Every question to the user goes in the question box: call the AskUserQuestion tool (2-4 options, the recommended
one first). The editor window shows it as a card on the open page. Only in an agent without that tool, ask numbered
questions in text.

Run the scripts with `python3` on Mac and Linux, `py` on Windows.
`PY="$E/lib/ai_editor/run.py"` (`python3 "$PY" <script>` runs the editor's venv Python; `py "$PY"` on Windows),
`T="${CLAUDE_SKILL_DIR}/scripts/streamclips.py"`, `H="$E/lib/ai_editor/home.py"`, `R="$E/lib/ai_editor/review.py"`,
`EDIT` the job's `edit=` folder (`<library>/edits/<name>/`).

```
brief.json -> meta (title, most replayed, the sound only) -> moments (scores, the top parts downloaded and
  transcribed) -> previews in the editor -> the user picks -> make -> layout -> build (captions, hook title)
  -> render -> every clip in the editor, one tab each -> notes -> redo the clips named -> again
```

Report each step on the page: `python3 "$H" status streamclips --step "Reading the stream"` (and so on), and at the
end `python3 "$H" status streamclips --result '{"edit": "<EDIT>"}' --done`. On a failure: `--failed "<one line why>"`.
Say every step in the editor too, where the user is watching: `python3 "$R" EDIT status "Reading the stream"`, then
"Finding the best moments", "Making clip 1 of 3", "Rendering". The user never needs the Terminal.

## 0. The brief

`EDIT/brief.json`: `{"links": [...], "count", "min", "max", "layout": "auto"|"facecam"|"follow"|"fit", "captions",
"titles", "aspect", "style"}`. `style` empty is the gaming look (step 4); `mine` or `@handle` styles every clip in
that style (step 4b instead of build and render). Asked in chat instead of the page: make the edit folder (`python3 "$E/lib/ai_editor/library.py"
path`, then `edits/clips-<name>/`), write brief.json yourself, and ask in one question box call: how many clips
(3 recommended / 1 / 5), how long (20-40 s recommended / 40-60 s / 60-90 s). Layout auto, captions and titles on.
Then `python3 "$R" EDIT start --raw --video <any 2 s clip> --stage edit` so the editor has the video.

A link that is not the user's own: say once, in one line on the page, that clips of someone else's stream need the
creator's permission (many streamers run clipping programs) and go on.

## 1. Read the streams

```bash
python3 "$PY" "$T" meta EDIT <every link or file in brief.json>
```

Downloads only each link's sound (a 3 hour stream is about 150 MB) and its details: the title, the length, YouTube's
"most replayed" heatmap and chapters. A YouTube stream replay also gets its live chat (only the times of the
messages are kept). A chat too big to download in 10 minutes is left out and says so; the other signals still score.
Twitch and Kick chat cannot be downloaded: those streams are scored on the sound (and nothing is lost but that signal). Exit 3: the site wants a login. Ask in the question box: "Use my Chrome login
for this download" (recommended) / "Skip that link". On yes, run again with `--cookies-from-browser chrome`, and pass
the same flag to `moments`.

## 2. Find the moments

```bash
python3 "$PY" "$T" moments EDIT --min <min> --max <max> --top <2 x count, at least 6>
```

Every second is scored from what the video has: the most replayed, the chat's surges (messages a second against the
minutes round it, laughing, "W" and "no way" counting double, moved 4 s earlier because chat reacts late) and how
much louder it is than the two minutes round it (a shout, a crowd, an explosion). With all three: 45%, 30%, 25%;
without chat: 60% and 40%; without the most replayed: chat 55%, sound 45%. The first minute is never a moment just because everyone starts there. The peaks
become moments, with most of the clip before the peak (the build-up) and the rest after (the payoff). Only those parts
are downloaded (1080p at most) and transcribed. It takes about 1 to 3 minutes; say so on the page.

Read `EDIT/shortlist.md` only (never the transcripts or the parts). Judge each moment: does it make sense with no
context, does something happen, does it pay off. Drop an intro, a sponsor read, a "be right back" screen, and one
whose words are all filler. Pick the brief's `count`, best first.

## 3. The user picks

```bash
python3 "$PY" "$T" previews EDIT
python3 "$R" EDIT round --video EDIT/previews.mp4 --stage edit --note "Every moment Claude found, numbered"
```

previews.mp4 plays every moment one after another, each numbered with its video and time; the script prints where
each starts in it. Then one AskUserQuestion call, multiSelect, the question "Which moments become clips? They are
numbered in the video on the editor", up to 4 options: your picks first, each labelled `<number> · <what happens, 5
words> (<time in the preview>)`. The user can type other numbers under Other. Wait for the answer.

## 4. Make the clips

```bash
python3 "$PY" "$T" make EDIT m3 m1 m4                        # clips/clip1, clip2, clip3, in the order picked
python3 "$PY" "$T" layout EDIT clip1 --mode <layout> --aspect <aspect>
python3 "$PY" "$T" build EDIT clip1 --title "<hook>"          # --no-captions when captions is off; no --title when titles is off
python3 "$PY" "$T" render EDIT clip1
```

`layout auto` finds a facecam (a small face that stays near an edge) and puts it on top with the game below, follows
a big moving face (IRL streams), or fits the whole frame over a blurred copy (no cam). It prints what it chose. The
hook title: at most 6 words, true to what happens and what is said in that clip, no clickbait the clip does not pay
off, no names the clip does not say. Look at a frame from the middle of every render (`ffmpeg -ss <mid> -i
clips/clipN/render.mp4 -frames:v 1 -vf scale=360:-2 clips/clipN/look.jpg`): the cam shows a face, the captions sit
clear of it, nothing important is cut off. A wrong layout: `layout` again with another `--mode`, then build and render.

## 4b. In the user's style (brief.json `style` is `mine` or `@handle`)

After `make` and `layout` (no build, no render), for every clip:

```bash
python3 "$PY" "$T" styled EDIT clip1 --as <style>      # EDIT/styled/clip1/: nothing cut, captions on, cards off
# --cards keeps the style's cards: only for a clip whose talk names real things (a game, a product, a site)
```

Then launch one `ai-editor:clip-editor` agent per clip, all in one message, in the background. Give each `EDIT` (the
styled folder that `styled` printed, absolute), `ROOT` (`$E`), the `PY` line, and the answers: aspect 9:16, layout
overlay, music none (the stream's own sound stays), engine whisper, reframe no, no captions burned in. Add these words to
each: "A gameplay stream moment: keep every second. spans.json is already [] and keep.json covers the whole clip:
never change either, skip retake detection and the judge rounds. style.json already has captions on and cards off
for gameplay: never set captions present false, and add no cards. Facecam layout: the top third is the streamer's
webcam." Say "Styling N clips" on the page while they run (a few minutes a clip).

Each returns `{"status", "sheet", ...}`. Look at every `ready` clip's stills sheet: captions clear of the face, no card
over the cam. A `failed` one: say which, and make that clip in the gaming look instead (build and render, step 4).
Then render each styled clip (laptop): `python3 "$PY" "$E/skills/style-edit/scripts/edit.py" render <styled folder>`
gives `<styled folder>/render.mp4`; step 5 hands those over instead of `clips/clipN/render.mp4`. A note on a styled
clip is a style-edit note on its styled folder (the style-edit skill's notes), then render it again.

## 5. The editor

```bash
python3 "$R" EDIT round --video EDIT/clips/clip1/render.mp4 --stage edit
python3 "$R" EDIT alt "Clip 2" --video EDIT/clips/clip2/render.mp4      # one tab for every other clip
python3 "$R" EDIT wait                                                   # in the background: notes or approval
```

Then `status streamclips --result ... --done` and say in one line that the clips are in the editor, one tab each.

On notes (`SEND`): the note's tab names the clip (`alt` "Clip 2" is clip2, no alt is clip1).
- Longer or shorter: `make EDIT <its moment> --number <N> --pad-in <s> --pad-out <s>` (negative pads trim), then
  layout, build, render that clip only.
- The title: `build ... --title "<new>"`; captions off or on: `build` with or without `--no-captions`; then render.
- The layout: `layout ... --mode facecam|follow|fit`, then build and render.
- A different moment: `make EDIT <moment id> --number <N>`, then the rest for that clip.
Then `round` and `alt` again for every clip, and `wait`. On `APPROVE` the clips are done: `EDIT/clips/clip*/render.mp4`.

## If a script stops

| message | do |
|---|---|
| exit 3, "the site wants a login" | the cookie question above |
| `shorter than one clip, skipped` | that video is shorter than the clip length: say so; the others still run |
| `the moment did not transcribe` | run the ai-editor setup skill (the transcription model), then `moments` again |
| `yt-dlp is not installed` | the ai-editor setup skill |

## Rules

- Only download what the user may reuse. Nothing is posted anywhere: the clips stay on the user's computer.
- Every word on screen comes from that clip: captions are what is said, the title is true to what happens.
- Never download a whole stream: `meta` takes the sound and `moments` only the parts that score.
- A network whose IPv6 is broken times every download out: the script uses IPv4 (set `STUDIO_IPV6=1` to stop that).

## Self-check

```bash
python3 "$PY" "$T" demo
```
