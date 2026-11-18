---
name: ugc-ad
description: Makes UGC-style ads, the short vertical videos where a person talks to the camera about a product. With no footage yet it writes the pack to film from (hooks, a short script, a shot list). With the filmed clips it transcribes them, picks the best takes and cuts several versions of the ad that differ in their first seconds (a different hook each), with captions, the product shown over the voice, a call to action and music, then opens them in the editor one tab each so the user can test which hook works. Use when a home page job says `JOB ugc`, or the user says "make a UGC ad", "UGC video for my product", "cut my creator's clips into ads", "write a UGC script", "test different hooks for this ad". Not for a product film with no person in it (the ai-editor product-video skill), not for a creator's long talking video (start), not for a fake customer review.
license: MIT
compatibility: Python 3.10+, ffmpeg, Node, and the ai-editor plugin installed beside it with its venv (Whisper, numpy) and renderer (the ai-editor setup skill installs them).
---

# UGC ad

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md.

This skill lives in the studio plugin, kept apart from the editor. It calls the editor's code and never edits it.
Find the editor first: `python3 "${CLAUDE_SKILL_DIR}/../animated-video/scripts/studio.py" root` prints its folder; call it `E`.
Read `$E/PRINCIPLES.md`: every rule there holds here too.

Every question to the user goes in the question box (AskUserQuestion, 2-4 options, the recommended one first).

Run the scripts with `python3` on Mac and Linux, `py` on Windows.
`PY="$E/lib/ai_editor/run.py"`, `U="${CLAUDE_SKILL_DIR}/scripts/ugc.py"`, `H="$E/lib/ai_editor/home.py"`,
`R="$E/lib/ai_editor/review.py"`, `EDIT` the job's `edit=` folder.

Report each step on the page: `python3 "$H" status ugc --step "Writing the hooks and script"` (then "Reading your
clips", "Cutting 3 versions", "Rendering"), at the end `python3 "$H" status ugc --result '{"edit": "<EDIT>"}' --done`,
on a failure `--failed "<one line why>"`. Say each step in the editor too: `python3 "$R" EDIT status "..."`.

## 0. The brief

`EDIT/brief.json`: `{"product", "about", "audience", "link", "clips": [files or folders]|[], "product_media":
[pictures or clips of the product]|[], "versions": 3, "captions", "music", "cta"}`. `clips` empty: step 1 only.

## 1. The pack to film from (always, and all there is when there are no clips)

Open `link` if there is one (WebFetch) for what the product is and what it really claims. Write
`EDIT/exports/ugc-script.md`:

- **Hooks**: 5, each one spoken line of at most 12 words that works with the sound off as a caption. One of each
  kind: a problem said plainly, a result with a number the product page supports, a doubt ("I didn't think this
  would work"), a direct address to the audience, a curiosity line.
- **Script**: 20 to 30 seconds (55 to 80 words) in the first person, the way a friend says it: the problem, the
  moment they tried it, what changed, one concrete detail, the ask. No superlatives, no "game changer".
- **Shot list**: what to film, each a few seconds: every hook to camera, the script to camera in one take and again
  in two, hands opening or using the product, the product in the place it is used, one reaction.
- **Filming notes**: vertical, by a window, phone at eye level, say every hook twice.

Every claim is one the product page or the user's own words make. Never a result the page does not promise, never
"doctors recommend", never a price that is not on the page. The person filming says what is true for them: the
script is a draft for them to change, and the file says so in its first line.

No clips: show the hooks and script in one AskUserQuestion ("Here is what to film. Change anything?" with "Looks
good" recommended and "Change it"), say on the page that the pack is in the video's exports folder and that they
come back to UGC ad with the filmed clips, then mark the job done.

## 2. Read the clips

```bash
python3 "$PY" "$U" ingest EDIT <every path in brief.json clips>      # each clip tall, transcribed: clips.md
```

Read `EDIT/clips.md` only. Find the takes: which lines are hooks, which are the body, which are said twice (keep the
cleaner, more energetic take: the later one unless it stumbles).

## 3. The plan: `EDIT/plan.json`

```json
{"cta": "Link in bio", "captions": true, "music": true, "versions": [
  {"id": "a", "hook": "I stopped buying coffee out", "parts": [
    {"clip": "c2", "in": 0.4, "out": 4.9},
    {"clip": "c1", "in": 6.0, "out": 11.2, "show": "<a file from product_media>"}]}]}
```

- brief `versions` of them (3 unless told), ids `a`, `b`, `c`. Each opens on a different spoken hook from the clips
  and then shares the same body, so only the first seconds differ and the test is fair. `hook` is the on-screen
  title for the first 3 seconds: the hook's own words, tightened, at most 8 words.
- A part is one continuous stretch of one clip: `in` and `out` at the starts and ends of sentences from clips.md,
  with 0.1 s of air. Cut every false start, repeat and "um" by ending a part before it and starting the next after.
- 12 to 45 seconds a version. The product's name is said or shown in the first 5 seconds.
- `show`: for a part where the person describes the product or how it is used, one of `product_media` fills the
  frame while their voice goes on. At most half the parts, never the hook.
- `cta`: brief `cta`, else "Link in bio".

```bash
python3 "$PY" "$U" check EDIT          # fix every FIX line
python3 "$PY" "$U" music EDIT          # only when plan.json music is true
python3 "$PY" "$U" build EDIT
python3 "$PY" "$U" render EDIT a       # then b, c: EDIT/versions/<id>.mp4
```

Look at a frame at 1 s and one from the middle of each (`ffmpeg -ss <t> -i EDIT/versions/a.mp4 -frames:v 1 -vf
scale=360:-2 EDIT/look-a.jpg`): the hook title is clear of the face, captions readable, no black frame.

## 4. The editor

```bash
python3 "$R" EDIT round --video EDIT/versions/a.mp4 --stage edit
python3 "$R" EDIT alt "Hook B" --video EDIT/versions/b.mp4       # one tab for every other version
python3 "$PY" "$U" export EDIT                                    # exports/01 <hook>.mp4, ...
python3 "$R" EDIT wait                                            # in the background
```

Then mark the job done and say in one line: N versions are in the editor, one tab each, and in the exports folder.
On notes: the tab names the version; change that version's parts or hook in plan.json, build, render it, `round`
and `alt` again.

## Rules

- A real person's words stay theirs: parts are cut, never reordered inside a sentence to make them say something else.
- Never a made-up customer, review or result. A generated presenter (brief `presenter` "ai") is labelled
  "AI presenter" on screen for the whole ad, and speaks as the brand, never as a customer.
- Nothing is posted anywhere: the ads stay on the user's computer.

## Self-check

```bash
python3 "$PY" "$U" demo
```
