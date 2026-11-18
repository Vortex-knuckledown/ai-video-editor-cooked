---
name: subtitles
description: Makes subtitle files (.srt) for a finished video in other languages. Transcribes what is said in the finished video (every clip of a Clip a stream video, or the one video of any other edit), groups it into subtitle cues, translates each cue into the languages the user picked, and saves the files beside the exported video, named like it, ready to upload to YouTube, TikTok or Instagram. Use when a home page job says `JOB subtitles`, or the user says "add Spanish subtitles", "translate the captions", "subtitles in Hindi and Portuguese", "make an srt for this video". Not for the captions burned into the video (the style-edit and stream-clips skills make those), not for dubbing the voice.
license: MIT
compatibility: Python 3.10+, ffmpeg, and the ai-editor plugin installed beside it with its venv (Whisper; the ai-editor setup skill installs it).
---

# Subtitles in other languages

Paths: `${CLAUDE_SKILL_DIR}` means the folder containing this SKILL.md.

This skill lives in the studio plugin, kept apart from the editor. It calls the editor's code and never edits it.
Find the editor first: `python3 "${CLAUDE_SKILL_DIR}/../animated-video/scripts/studio.py" root` prints its folder; call it `E`.
Read `$E/PRINCIPLES.md`: every rule there holds here too.

Run the scripts with `python3` on Mac and Linux, `py` on Windows.
`PY="$E/lib/ai_editor/run.py"`, `T="${CLAUDE_SKILL_DIR}/scripts/subs.py"`, `H="$E/lib/ai_editor/home.py"`, `EDIT` the
job's `edit=` folder, `langs=` the languages by name, comma separated (`Spanish,Hindi`).

Asked in chat instead of the page: find the video's folder (`python3 "$E/lib/ai_editor/library.py" path`, then
`edits/<name>/`). No language named: one question box call (AskUserQuestion), "Which languages?", multiSelect, the
options Spanish (recommended), Hindi, Portuguese, French.

Report each step on the page: `python3 "$H" status subtitles --step "Reading what is said"`, then
`--step "Translating into Spanish"` for each language, and at the end
`python3 "$H" status subtitles --result '{"edit": "<EDIT>"}' --done`. On a failure: `--failed "<one line why>"`.

## 1. What is said

```bash
python3 "$PY" "$T" cues EDIT
```

Transcribes every finished video of the edit (each clip of a Clip a stream video; the one video otherwise) and writes
`EDIT/subs/<key>/cues.json`: `[{"n", "start", "end", "text"}]`. About 10 s a minute of video. A video where nothing
is said has 0 cues: say so and leave it out. Exit with "no finished video": mark the job failed with those words.

## 2. Translate

For each language, and each `<key>`: read `cues.json`, and write `EDIT/subs/<key>/<code>.json`, a JSON list of
strings, one per cue, in the same order. `<code>` is the language's two-letter code (Spanish `es`, Hindi `hi`,
Portuguese `pt`, French `fr`, German `de`, Japanese `ja`, Arabic `ar`, Indonesian `id`, Korean `ko`, Chinese `zh`).

- Translate the meaning the way a native speaker would say it out loud, not word for word. Read the cues before and
  after: a sentence often runs over two or three cues, and each translated cue carries its own part of it.
- Keep each cue about as long as the original (it is on screen for the same time); 84 characters at most.
- Names, game terms, product names and numbers stay as they are. Fix nothing the speaker said: no added words, no
  softened swearing, no explanations in brackets.
- A cue that is only a sound ("Oh!", "Whoa") gets the sound a speaker of that language would make.
- Whisper mishears: a cue that makes no sense is translated from what was most likely said, judged from the cues
  round it.

## 3. Write the files

```bash
python3 "$PY" "$T" write EDIT es
python3 "$PY" "$T" write EDIT hi --reveal      # --reveal on the last one: the folder opens
```

Writes `EDIT/exports/<name>.<code>.srt` for every video, and `<name>.srt` in the language spoken, where `<name>` is
the exported video's name (`02 One invisible hit, six diamonds`). A `FIX` line: the count is wrong or a cue is
empty; fix that file and run `write` again. Then mark the job done and say in one line how many files were made and
that they sit beside the exported videos.

## Rules

- Nothing is uploaded anywhere: the transcript and the translations stay on the user's computer.
- The subtitle files are separate from the video. The video's own burned-in captions are not changed.

## Self-check

```bash
python3 "$PY" "$T" demo
```
