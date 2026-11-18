---
name: long-video
description: Makes a long video (2 to 10 minutes, wide for YouTube or tall) from one prompt, edited like a documentary or explainer channel. Researches the topic with sources, writes a script the user approves, records an AI voiceover, then gives every spoken line a new shot every few seconds (seconds of footage found on YouTube, free pictures, the user's own clips, and motion graphics from the script's own numbers: stats, bar charts, lists, quotes, a highlighted source), with captions, music and a sound on the cuts. Hands over the video in the editor with thumbnails and a publishing kit. Use when a home page job says `JOB longvideo`, or the user says "make a 5 minute video about X", "a documentary about X", "a YouTube explainer on X", "a faceless video about X". Not for an animated explainer under 90 seconds (animated-video), a stream (stream-clips), or the user's own talking take (start).
license: MIT
compatibility: Python 3.10+, ffmpeg, Node, and the ai-editor plugin installed beside it with its venv (yt-dlp, Whisper, Pillow, OpenCV, numpy) and renderer (the ai-editor setup skill installs them). macOS `say` for the free voice. Web search for the research.
---

# Long video

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md.

This skill lives in the studio plugin, kept apart from the editor. It calls the editor's code and never edits it.
Find the editor first: `python3 "${CLAUDE_SKILL_DIR}/../animated-video/scripts/studio.py" root` prints its folder; call it `E`.
Read `$E/PRINCIPLES.md` (asking, looking real, privacy, cost): every rule there holds here too.

Every question to the user goes in the question box: call the AskUserQuestion tool (2-4 options, the recommended
one first). The editor window shows it as a card on the open page.

Run the scripts with `python3` on Mac and Linux, `py` on Windows.
`PY="$E/lib/ai_editor/run.py"`, `L="${CLAUDE_SKILL_DIR}/scripts/longvideo.py"`,
`T="${CLAUDE_SKILL_DIR}/../animated-video/scripts/studio.py"`, `H="$E/lib/ai_editor/home.py"`,
`R="$E/lib/ai_editor/review.py"`, `EDIT` the job's `edit=` folder.

```
brief.json -> research (sources) -> scenes.json (lines and their shots) -> the user approves the script
  -> studio.py voice, words -> at once: longvideo.py briefs + one clip-builder agent per animated graphic,
     and longvideo.py find (footage, pictures) -> sheet (look, replace the wrong ones)
  -> sound -> build -> studio.py render -> the editor -> thumbs, kit -> notes -> fix the shots named -> again
```

Report each step on the page: `python3 "$H" status longvideo --step "Researching"` (then "Writing the script",
"Recording the voice", "Finding footage for N shots", "Building the edit", "Rendering"), and at the end
`python3 "$H" status longvideo --result '{"edit": "<EDIT>"}' --done`. On a failure: `--failed "<one line why>"`.
Say every step in the editor too: `python3 "$R" EDIT status "Researching"`. The user never needs the Terminal.

## 0. The brief

`EDIT/brief.json`: `{"prompt", "minutes", "aspect": "16:9"|"9:16", "voice": true, "text", "music",
"footage": {"youtube": true|false, "photos": true|false}, "own": "<a folder of the user's clips>"|null,
"voice_engine": "kokoro"|"eleven", "voice_id", "ai": true|false, "voiceover": "<the user's own recording>"|null}`.
`voice_engine` and `voice_id` are the narrator the user picked on the page: `voice` reads them itself.
Asked in chat instead of the page: make the edit folder (`python3 "$E/lib/ai_editor/library.py" path`, then
`edits/<name>/`), write brief.json (3 minutes, 16:9, everything on), and
`python3 "$R" EDIT start --raw --video <any 2 s clip> --stage edit` so the editor has the video.

`footage.youtube` on: say once on the page, in one line, that the video uses a few seconds each from other people's
YouTube videos, that every one is listed in the publishing kit, and that publishing them is the user's call (fair use
depends on how they are used). Off: no `clip` shots at all, only pictures, the user's own clips and graphics.

## 0c. The user's own voiceover (only when brief.json has `voiceover`)

The recording is the script: nothing is written, nothing is approved, no AI voice is made.

```bash
python3 "$PY" "$L" voiceover EDIT "<brief.json voiceover>"
```

It transcribes the recording and writes scenes.json with one scene a spoken line (`l01`, `l02`, ...), timing.json
and words.json. Then, in scenes.json: give the video a `title` and `look`, give the lines their `section`s, and
replace every line's placeholder shot with real `shots` (step 2's rules; `say` is what was heard and stays as it
is, mishearings too). Research only to get graphics right (a number the speaker says, a name's spelling), and put
no fact on screen the speaker did not say. `check`, then skip steps 2's approval and 3 entirely (never run
`voice` or `words`: they would replace the recording) and go on at step 4. On a note about the words: say on the
page that the words are the user's recording and only the pictures can change.

## 1. Research

Search the web (WebSearch, then WebFetch the best 3 to 6 pages: a study, an official number, a reputable outlet;
never a content farm). Write `EDIT/research.md`: the angle in one line, then every fact you may use as
`- <the fact, with its number> (<url>)`. A number with no source does not go in the script. No web tool in this
session: say so on the page, write from what you know, use no statistic you are not sure of, and leave `source` out.

## 2. The script: `EDIT/scenes.json`

```json
{"title": "Why honey never spoils", "look": {"ground": "#0E0F12", "ink": "#FFFFFF", "accent": "#FFD24A"},
 "scenes": [{"id": "hook", "section": "The tomb", "say": "one spoken line", "visual": "-",
             "source": "https://... (only on a line that states a researched fact)", "source_label": "Smithsonian",
             "shots": [{"kind": "photo", "query": "Egyptian tomb wall painting"}, {"kind": "stat", "value": "3,000", "label": "years old, and still edible"}]}]}
```

- **Length**: about 150 words a minute of `minutes`. One scene is one spoken line, 8 to 22 words, said the way a
  person talks. 4 to 7 `section`s, each a few words: they become the chapters. `id`: a-z, 0-9 and `-`.
- **Structure**: a hook in the first two lines (a fact, a question or a claim that the video pays off), then the
  sections, each ending on a line that makes the next one wanted, then a close that answers the hook. No "in this
  video", no "let's dive in", no "smash that like button".
- **Shots**: every line has 1 to 3, sharing its time equally, so a new picture every 2 to 4 seconds. Pick what a
  viewer would want to see while hearing that line:
  - `clip` (`query`): moving footage of the thing itself. The search is typed into YouTube: 3 to 6 plain words for
    what is in the frame ("bees on honeycomb macro", "tokyo crossing night timelapse"), never the line's idea.
  - `stock` (`query`): generic footage with no logo and nothing to credit ("city traffic at night", "hands typing
    laptop"): the mood and texture between the specific shots. It comes from Pexels when the user has connected a
    key; with none, the same words are searched on YouTube.
  - `photo` (`query`): a named person, place, object, painting or historical moment ("Marie Curie laboratory 1911").
  - `own` (`file`, `in`): a clip from the brief's `own` folder, when the line is about what it shows.
  - `stat` (`value`, `label`): one number that carries the line. `bars` (`title`, `items` [["name", number]],
    `unit`, `source`): a comparison of 2 to 6 numbers. `list` (`title`, `items`): 2 to 6 points, each a few
    words. `quote` (`text`, `by`): someone's own words. `source` (`title`, `by`, `highlight`): the paper or article
    a claim comes from, with the sentence that matters, in its own words. `title` (`text`, `sub`): a section's
    opening, or the close.
  - `ai` (`prompt`, `fallback`): a shot generated on the user's own Runway, Higgsfield or Google account, only when
    brief.json `ai` is true: for what nobody filmed and no photo shows (a scene from before cameras, a thing too
    small or too far to film). `prompt`: one sentence of what is in the frame and how the camera moves, no text in
    it, no real person by name. `fallback`: a `clip`, `stock` or `photo` shot fetched if the generation fails. 6 at
    most. Each costs the user money: `check` prints how many and about how much. Before `find`, ask in the
    question box "Generate N AI shots for about $X on your <vendor> account?" with "Yes, generate them"
    (recommended) and "Use footage instead" (then change them to their fallbacks). Never generate without that yes.
  - `motion` (`visual`, `data`, `fallback`): an animated graphic built for this video by its own agent, with depth,
    light and a moving camera: a map with a route drawn across it, a 3D bar chart, a timeline, a cutaway of how a
    thing works, a ranked list of cards, a document with a line lighting up. `visual`: two or three sentences on
    what is seen and how it moves. `data`: every number, name and label it may show (from research.md). `fallback`:
    a whole simple graphic (`stat`, `bars`, `list`, `quote`, `title`) shown if the animation does not pass. One for
    each section's main idea and one in the hook: 1 in every 20 to 30 seconds, 12 at most. It takes twice a
    clip's share of its line (`"weight"` on any shot changes its share), and wants 4 seconds or more.
  Footage and pictures carry the video; graphics make the points (at most 6 in 10 shots). At most 20 `photo` shots
  in a video (the picture sites are slow to a caller with no key): a clip for anything that moves or still exists
  today, a photo only for a named person, document, map or moment in the past. Every number, name and
  quote in a graphic is in research.md. A section opens on footage or a `title`, never on a `list`.
- `look`: a dark ground and one accent that fit the topic. `captions`: leave out for the default.

```bash
python3 "$PY" "$L" check EDIT        # fix every FIX line: the fields, the length against the brief, the pace
```

Show the script on the page: one AskUserQuestion call. The question is the script itself: the title, then each
section's name and its lines as one paragraph (over 700 words: each section's name and first line only, and write
the whole script to `EDIT/script.md`), then "N shots, about M minutes". Options "Looks good, make it"
(recommended), "Change it" (the user types what). On a change, edit scenes.json, `check`, ask again. Never record a
script the user has not approved.

## 3. Voice and words

```bash
python3 "$PY" "$T" voice EDIT --fit <minutes x 60>     # ElevenLabs with a saved key, else Kokoro, else the macOS voice
python3 "$PY" "$T" words EDIT
```

The voice, best first: ElevenLabs (the user's key, billed to their plan); Kokoro, a free neural voice that runs on
this computer (brief.json `voice_id` picks which: am_michael, am_fenrir, af_heart, bm_george, bf_emma); the macOS
voice, which is robotic. The last line says which it used. On the macOS voice: run
`python3 "$PY" "$T" kokoro-setup` (a 350 MB download, once; say so on the page) and `voice` again.
Write every `say` line for the ear: numbers as they are spoken ("twenty-one thousand"), no brackets, a comma where
a breath falls.

`--fit` brings a voice that reads fast up to the length asked: it slows a little (never under 80%) and each line
gets a short pause. A `FIT` line that says it is still more than a tenth short or long: add or cut that many words
(the user approved the script, so only lengthen or trim lines, never change what they say), then `voice` again.

Say which voice it used. The Mac voice: tell the user once that an ElevenLabs key (setup skill, "add my elevenlabs
key") sounds like a person and bills their own ElevenLabs plan. Before the first ElevenLabs voice on a video over
2 minutes, say that it will use about `words x 6` characters of their plan.

## 4. Animated graphics, footage and pictures

Start the animated graphics first, since they take the longest, then find the footage while they build:

```bash
python3 "$PY" "$L" briefs EDIT         # EDIT/motion/<key>/brief.md for every motion shot
```

Launch one `ai-editor:clip-builder` agent per brief, all in one message, in the background, each given only the
full path of its brief.md. Each returns `{"clip", "pass", "render", "what", "failing"}`. When they are back, look at
every passed clip's `renders/sheet.png`: one that shows the wrong idea, reads as a slide, or leaves the frame empty
gets one note to its agent (SendMessage) before the build. One that does not pass shows its `fallback` graphic;
say which. No clip-builder agent in this session: say so once and go on, the fallbacks are drawn.

```bash
python3 "$PY" "$L" find EDIT           # every clip and photo into EDIT/shots/, 4 at a time; about 10 s a clip
python3 "$PY" "$L" sheet EDIT          # EDIT/sheets/sheet-N.jpg, 20 shots a sheet, each labelled with its key
```

The free picture sites allow few pictures a minute to a caller with no key (Wikimedia rests for 2 minutes once it
says slow down), so `find` fetches pictures one at a time and waits when told to: about 5 s a picture, sometimes
minutes more. Say "Finding N clips and M pictures" on the page. A picture still `MISSING` with "the picture sites":
run `find` again once (it only fetches what is missing), then make what is left a clip or a graphic.

`find` passes over a search result that carries a channel's logo or watermark (it tries the next two) and prints
`LOGO <key>` when every one it tried has one: change that shot's words, or make it `stock` or a photo.

Look at every sheet (Read the image). A shot is wrong when it does not show what its line says, shows a talking
presenter or a title card, carries big burned-in text or a watermark across the frame, or is blurry. For each wrong
or `MISSING` one, change its shot in scenes.json and fetch it alone:

- another result of the same search: `"pick": 1` (0 to 5; shots.json lists the results under `others`);
- another moment of the same video: `"at": 0.6` (how far in, 0.05 to 0.9);
- other words in `query`; or another `kind` (a photo for a clip nobody filmed, a graphic for an idea).

```bash
python3 "$PY" "$L" find EDIT --only hook-2 water-1
```

Two rounds at most, then make what is still wrong a graphic or a photo. No `MISSING` shot may be left: the frame
would be empty.

## 5. Sound, build, render

```bash
python3 "$PY" "$L" sound EDIT [--mood linear]      # the voice, music under it, a sound on every cut and graphic
python3 "$PY" "$L" build EDIT
python3 "$PY" "$T" render EDIT                      # EDIT/render.mp4; about 2 minutes of rendering a minute of video
```

Look at 6 frames across the render (`ffmpeg -ss <t> -i EDIT/render.mp4 -frames:v 1 -vf scale=640:-2 EDIT/look-N.jpg`),
one of them on a graphic: the captions are readable and clear of the graphics, no frame is empty.

## 6. The editor, thumbnails, the kit

```bash
python3 "$R" EDIT round --video EDIT/render.mp4 --stage edit
python3 "$PY" "$L" thumbs EDIT --title "<3 to 5 words, the video's promise>"      # exports/thumbnail-1..3.jpg
```

Write `EDIT/kit.json`: `{"titles": [three options, under 60 characters, true to the video], "description": "<two
short paragraphs: what the viewer learns, no hashtags>", "tags": [8 to 12]}`, then `python3 "$PY" "$L" kit EDIT`
(`exports/publish.md`: the titles, the description with chapters from the sections, the sources, a credit line for
every clip and picture, the tags). Then `status longvideo --result ... --done`, `python3 "$R" EDIT wait` in the
background, and one line on the page: the video is in the editor, the thumbnails and the kit are in its exports
folder.

On notes (`SEND`): each note has a time; `EDIT/timing.json` says which line it falls in, and that line's shots share
its time in order. A shot: change it in scenes.json, `find --only <key>`, build, render. The words: change `say`,
then voice, words, find (lengths change), sound, build, render. The music: `sound --mood <m>`. Then `round` again.
On `APPROVE` the video is done: `EDIT/render.mp4`.

## Rules

- Every fact said or shown has a source in research.md; the user's approval of the script is the second check.
- A found clip is a few seconds, with its own sound off, under the user's narration, and credited in the kit. Never
  a whole video, never a clip as the point of the video.
- Pictures come only from Wikimedia Commons, Openverse and Pexels (free to reuse, credited in the kit).
- Pexels, Runway, Higgsfield and ElevenLabs are connected by the user in the app's Settings (Connections for new
  videos), never in the chat. A generated shot is credited in the kit as AI-generated.
- Nothing is uploaded or posted: the video and the kit stay on the user's computer.
- Never paste or ask for an API key in the chat.

## Self-check

```bash
python3 "$PY" "$L" demo
```
