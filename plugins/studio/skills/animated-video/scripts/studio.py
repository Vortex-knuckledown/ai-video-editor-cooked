#!/usr/bin/env python3
"""Studio: a fully animated video from a text prompt, no footage. The steps the animated-video skill runs.

    python3 studio.py root                          the ai-editor plugin folder this plugin calls (stdlib only)
    python3 studio.py check-scenes EDIT              scenes.json is well formed; one line per scene
    python3 studio.py voice EDIT [--engine auto|eleven|mac|none] [--voice ID]
                                                     a voiceover per scene (audio/vo-<id>.wav) and timing.json:
                                                     each scene as long as its voice (or its words at reading pace)
    python3 studio.py words EDIT                     words.json on the video's clock: the voice transcribed, or the
                                                     scenes' on-screen words spread over their scenes
    python3 studio.py briefs EDIT                    motion/<id>/ per scene: the full-frame clip template, beat.json
                                                     and brief.md for one ai-editor:clip-builder agent each
    python3 studio.py music EDIT [--mood linear]     audio/mix.wav: music (if on) under the voice (if on), -14 LUFS
    python3 studio.py build EDIT                     studio.scene.json: the clips back to back, captions, the mix
    python3 studio.py render EDIT [--draft]          render.mp4 through the editor's Scene composition
    python3 studio.py stills EDIT                    stills/sheet.png: one frame from the middle of each scene
    python3 studio.py demo                           self-check (offline, no render)

EDIT is <library>/edits/<name>/. brief.json (the page's job) says what was asked: {"prompt", "refs", "aspect",
"length", "voice", "text", "music"}. scenes.json (Claude writes it from the prompt) is the script:
{"title", "mood", "look", "scenes": [{"id", "say", "text", "visual"}]}. "say" is the narration, "text" the words
on screen when there is no voice, "visual" what the animation shows.

Runs in the editor's venv (numpy for the music): `python3 <ai-editor>/lib/ai_editor/run.py studio.py ...`.
Reuses the editor's code and never changes it: motion's template and checks, product-video's sound and voice,
cut's transcriber, the Scene renderer.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FPS = 30
SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080)}
READ_WPS = 2.6           # words a second read on screen with no voice
MIN_SCENE_S = 2.5        # a scene is never shorter
MAX_SCENE_S = 9.0        # nor longer: split the line instead
TAIL_S = 0.35            # air after a scene's voice before the next one
LEAD_S = 0.15            # the first scene's voice starts this late, so nothing lands on frame one
DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"   # product-video's ElevenLabs default
MAC_VOICE = "Samantha"
SCENE_FILE = "studio.scene.json"   # never scene.json: that one belongs to the review page


# ---------------------------------------------------------------- finding the editor
def editor_root():
    """The ai-editor plugin folder: AI_EDITOR_PLUGIN, else beside this plugin in a checkout (plugins/ai-editor), else
    the newest version beside it in Claude Code's plugin cache (<cache>/nextwork/ai-editor/<version>)."""
    env = os.environ.get("AI_EDITOR_PLUGIN")
    if env and (Path(env) / "lib" / "ai_editor").is_dir():
        return Path(env)
    plugin = HERE.parents[2]                       # plugins/studio, or <cache>/nextwork/studio/<version>
    for cand in (plugin.parent / "ai-editor", ):
        if (cand / "lib" / "ai_editor").is_dir():
            return cand
    vers = sorted((plugin.parents[1] / "ai-editor").glob("*/lib/ai_editor"), key=lambda p: p.stat().st_mtime)
    if vers:
        return vers[-1].parents[1]
    sys.exit("ERROR: the ai-editor plugin was not found beside the studio plugin. Install ai-editor@nextwork.")


def use_editor():
    root = editor_root()
    for p in (root / "lib", root / "lib" / "ai_editor", root / "skills" / "motion" / "scripts",
              root / "skills" / "product-video" / "scripts", root / "skills" / "style-edit" / "scripts"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    return root


# ---------------------------------------------------------------- small helpers
def jload(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def jsave(p, d):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")


def slug(s, n=24):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:n] or "scene"


def duration(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def brief_of(edit):
    b = jload(Path(edit) / "brief.json", {}) or {}
    b.setdefault("aspect", "9:16")
    for k in ("voice", "text", "music"):
        b[k] = bool(b.get(k, True))
    return b


def size_of(edit):
    return SIZES.get(brief_of(edit)["aspect"], SIZES["9:16"])


def words_in(s):
    return [w for w in re.split(r"\s+", str(s or "").strip()) if w]


# ---------------------------------------------------------------- scenes.json
def check_scenes(edit):
    """Errors in scenes.json, [] when it is fine."""
    sc = jload(Path(edit) / "scenes.json")
    if not isinstance(sc, dict) or not isinstance(sc.get("scenes"), list) or not sc["scenes"]:
        return ["scenes.json needs {\"scenes\": [{\"id\", \"say\", \"text\", \"visual\"}, ...]}"]
    b, errs, ids = brief_of(edit), [], set()
    for i, s in enumerate(sc["scenes"]):
        if not isinstance(s, dict):
            errs.append(f"scene {i + 1} is not an object")
            continue
        sid = s.get("id")
        if not sid or not re.fullmatch(r"[a-z0-9-]{1,30}", str(sid)):
            errs.append(f"scene {i + 1}: id must be 1-30 of a-z, 0-9 and -")
        elif sid in ids:
            errs.append(f"scene {i + 1}: id {sid} twice")
        ids.add(sid)
        if not str(s.get("visual") or "").strip():
            errs.append(f"scene {sid}: no visual (what the animation shows)")
        if b["voice"] and not str(s.get("say") or "").strip():
            errs.append(f"scene {sid}: the voice is on but it has no \"say\"")
        if not b["voice"] and b["text"] and not str(s.get("text") or s.get("say") or "").strip():
            errs.append(f"scene {sid}: text is on but it has no \"text\"")
    return errs


def cmd_check_scenes(edit):
    errs = check_scenes(edit)
    if errs:
        print("\n".join("FIX  " + e for e in errs))
        return 1
    b = brief_of(edit)
    for s in jload(Path(edit) / "scenes.json")["scenes"]:
        line = s.get("say") if b["voice"] else s.get("text") or s.get("say")
        print(f"ok   {s['id']:<24} {estimate(s, b):4.1f}s  \"{str(line or '')[:70]}\"")
    print(f"ok   {len(jload(Path(edit) / 'scenes.json')['scenes'])} scenes, about "
          f"{sum(estimate(s, b) for s in jload(Path(edit) / 'scenes.json')['scenes']):.0f} s")
    return 0


def estimate(s, b):
    """A scene's length before any voice exists: its words at reading pace (a voice reads about as fast)."""
    n = len(words_in(s.get("say") if b["voice"] else s.get("text") or s.get("say")))
    return round(min(MAX_SCENE_S, max(MIN_SCENE_S, n / READ_WPS + TAIL_S)), 2)


# ---------------------------------------------------------------- the voice
def tts_eleven(text, out, voice, key):
    import urllib.request
    from ai_editor import net
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
                                 data=json.dumps({"text": text, "model_id": "eleven_multilingual_v2"}).encode(),
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    mp3 = Path(out).with_suffix(".mp3")
    with net.urlopen(req, 120) as r:
        mp3.write_bytes(r.read())
    to_wav(mp3, out)
    mp3.unlink()


def tts_mac(text, out, voice):
    aiff = Path(out).with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    to_wav(aiff, out)
    aiff.unlink()


def to_wav(src, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(out)],
                   check=True)


def engine_for(want):
    """The voice engine to use: eleven with a key, mac on a Mac, else none. want=auto picks the best there is."""
    if want == "none":
        return "none", None
    key = None
    try:
        use_editor()
        from ai_editor import keys
        key, _ = keys.get("elevenlabs")
    except Exception:   # noqa: BLE001  no editor lib: no key
        key = None
    if want in ("auto", "eleven") and key:
        return "eleven", key
    if want == "eleven":
        sys.exit("No ElevenLabs key saved. Say \"add my elevenlabs key\" (setup), or use --engine mac.")
    if shutil.which("say"):
        return "mac", None
    sys.exit("No voice engine here: no ElevenLabs key and no macOS `say`. Use --engine none (on-screen words only).")


def cmd_voice(edit, engine="auto", voice=None):
    """Each scene's voice, then timing.json: {"scenes": [{"id", "start", "dur", "vo"?}], "length", "engine"}."""
    edit = Path(edit)
    errs = check_scenes(edit)
    if errs:
        sys.exit("ERROR: scenes.json: " + "; ".join(errs))
    b, scenes = brief_of(edit), jload(edit / "scenes.json")["scenes"]
    eng, key = engine_for(engine if b["voice"] else "none")
    (edit / "audio").mkdir(exist_ok=True)
    t, rows = 0.0, []
    for i, s in enumerate(scenes):
        row = {"id": s["id"], "start": round(t, 3)}
        if eng != "none":
            out = edit / "audio" / f"vo-{s['id']}.wav"
            text = str(s["say"]).strip()
            stamp = edit / "audio" / f"vo-{s['id']}.txt"
            if not out.exists() or (stamp.read_text(encoding="utf-8") if stamp.exists() else "") != f"{eng}|{voice}|{text}":
                if eng == "eleven":
                    tts_eleven(text, out, voice or DEFAULT_VOICE, key)
                else:
                    tts_mac(text, out, voice or MAC_VOICE)
                stamp.write_text(f"{eng}|{voice}|{text}", encoding="utf-8")
            lead = LEAD_S if i == 0 else 0.0
            vd = duration(out)
            row.update(vo=str(out.relative_to(edit)), vo_at=round(t + lead, 3), vo_dur=round(vd, 3))
            dur = max(MIN_SCENE_S, lead + vd + TAIL_S)
        else:
            dur = estimate(s, b)
        row["dur"] = round(dur, 3)
        rows.append(row)
        t += dur
    tm = {"engine": eng, "voice": voice or (DEFAULT_VOICE if eng == "eleven" else MAC_VOICE if eng == "mac" else None),
          "length": round(t, 3), "scenes": rows}
    jsave(edit / "timing.json", tm)
    if eng != "none":
        join_voice(edit, tm)
    for r in rows:
        print(f"{r['id']:<24} {r['start']:6.2f}s +{r['dur']:.2f}s" + (f"  voice {r['vo_dur']:.2f}s" if r.get("vo") else ""))
    print(f"{len(rows)} scenes, {t:.1f} s, voice: {eng}" + (" (the free Mac voice; an ElevenLabs key sounds more natural)" if eng == "mac" else ""))
    return 0


def join_voice(edit, tm):
    """audio/vo.wav: every scene's voice at its place on the video's clock."""
    edit = Path(edit)
    parts = [r for r in tm["scenes"] if r.get("vo")]
    inputs, filt = [], []
    for k, r in enumerate(parts):
        inputs += ["-i", str(edit / r["vo"])]
        ms = int(r["vo_at"] * 1000)
        filt.append(f"[{k}:a]adelay={ms}|{ms}[a{k}]")
    filt.append("".join(f"[a{k}]" for k in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0,apad,atrim=0:{tm['length']:.3f}[out]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[out]",
                    "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(edit / "audio" / "vo.wav")], check=True)


# ---------------------------------------------------------------- the words on screen
def cmd_words(edit):
    """words.json, [{"w", "start", "end"}] on the video's clock, for the captions and each clip's WORDS."""
    edit = Path(edit)
    tm, b = jload(edit / "timing.json"), brief_of(edit)
    if not tm:
        sys.exit("ERROR: no timing.json. Run studio.py voice first.")
    scenes = {s["id"]: s for s in jload(edit / "scenes.json")["scenes"]}
    if tm["engine"] != "none":   # each scene's voice on its own, so no word drifts into the next scene
        root = use_editor()
        words = []
        for row in tm["scenes"]:
            if not row.get("vo"):
                continue
            raw = edit / "audio" / f"vo-{row['id']}.words.json"
            r = subprocess.run([sys.executable, str(root / "skills" / "cut" / "scripts" / "transcribe.py"),
                                str(edit / row["vo"]), str(raw), "--engine", "whisper"], capture_output=True, text=True)
            if r.returncode or not raw.exists():
                print(r.stdout[-800:] + r.stderr[-800:])
                sys.exit("ERROR: the voice did not transcribe. Run the setup skill (the transcription model).")
            end = row["start"] + row["dur"] - 0.05
            for w in jload(raw):
                if w.get("type", "word") == "word" and w["text"].strip():
                    a = min(end - 0.1, row["vo_at"] + w["start"])
                    words.append({"w": w["text"].strip(), "start": round(a, 3), "end": round(min(end, max(a + 0.08, row["vo_at"] + w["end"])), 3)})
    else:
        words = []
        for r in tm["scenes"]:
            ws = words_in(scenes[r["id"]].get("text") or scenes[r["id"]].get("say"))
            if not ws:
                continue
            span = max(0.6, r["dur"] - TAIL_S - 0.3)
            step = span / len(ws)
            for k, w in enumerate(ws):
                words.append({"w": w, "start": round(r["start"] + 0.3 + k * step, 3), "end": round(r["start"] + 0.3 + (k + 1) * step, 3)})
    jsave(edit / "words.json", words)
    print(f"{len(words)} words in words.json" + ("" if b["text"] else " (text is off: used for the clips' timing only)"))
    return 0


def scene_words(words, row):
    """A scene's words in clip seconds (clip t=0 is the scene's first frame)."""
    a, z = row["start"], row["start"] + row["dur"]
    return [{"w": w["w"], "t": round(w["start"] - a, 2)} for w in words if a <= w["start"] < z]


# ---------------------------------------------------------------- the animation briefs
BRIEF = """# Scene {id} (a full-frame scene of an animated video)

Read `{card}` first (every gate and approved value), then build this one clip. Do not read the check
scripts' source. First render within about 10 minutes, then iterate on `check` output.

This clip is not a card over footage: it IS the whole picture for this part of an animated video, with no
camera footage anywhere. Ignore the card's rules about a speaker, hair or the band above a head. The
captions are drawn on top of your clip by the video itself, in the lower third, so keep the lower third
calm (no small detail that must be read there) and never draw the narration as text. Text only where it is
the mechanism (a number counting, a typed command, a label inside a real-looking UI).

- Folder (yours alone): `{dir}`. Edit `index.html` only, plus files you add under `assets/`.
- Canvas {w}x{h}, {dur} s, 30 fps, the whole frame. Fill it edge to edge, moving at every moment.
- The video: "{title}". What it is about: "{prompt}"
- The look: {look}
- This scene shows: {visual}
- The narration: "{say}"
  Before it: "{before}"  After it: "{after}"
- When each word lands (clip seconds, already in `WORDS` in index.html): {words}
- Scene {n} of {total}.{first}{last}

{start}Build: `{env}python3 "{run}" "{motion}" check "{dir}"` (the editor's own Python, which has Pillow and OpenCV) runs every gate and the render, writes `gates.json`, `renders/clip.mp4`,
`renders/sheet.png` (1 fps) and `renders/strip.png` (10 fps, first 1.2 s). Look at both sheets after every
render. At most {rounds} checks; then stop and report.
"""


def look_of(sc):
    use_editor()
    import motion
    look = dict(motion.DEFAULT_LOOK)
    want = sc.get("look")
    if isinstance(want, str) and want in motion.PRESETS:
        look.update(motion.PRESETS[want], name=want)
    elif isinstance(want, dict):
        look.update({k: v for k, v in want.items() if k in look or k == "accent"})
    return look


def cmd_briefs(edit):
    edit = Path(edit).resolve()
    root = use_editor()
    import motion
    tm, words = jload(edit / "timing.json"), jload(edit / "words.json")
    if not tm or words is None:
        sys.exit("ERROR: run studio.py voice and words first.")
    ok, why = motion.ensure_tools()
    if not ok:
        sys.exit("ERROR: the motion tools are missing: " + str(why))
    sc, b = jload(edit / "scenes.json"), brief_of(edit)
    scenes = {s["id"]: s for s in sc["scenes"]}
    look = look_of(sc)
    w, h = size_of(edit)
    gsap = motion.home() / "motion" / "node_modules" / "gsap" / "dist" / "gsap.min.js"
    mroot = edit / "motion"
    mroot.mkdir(exist_ok=True)
    beats, rows = [], tm["scenes"]
    for k, r in enumerate(rows):
        s = scenes[r["id"]]
        beat = {"id": r["id"], "type": "scene", "props": {}, "start": r["start"], "dur": round(r["dur"], 2), "clock": "video",
                "size": [w, h], "words": scene_words(words, r), "line": s.get("say") or s.get("text") or "",
                "before": scenes[rows[k - 1]["id"]].get("say", "") if k else "",
                "after": scenes[rows[k + 1]["id"]].get("say", "") if k + 1 < len(rows) else ""}
        d = mroot / r["id"]
        (d / "assets").mkdir(parents=True, exist_ok=True)
        old = jload(d / "beat.json", {}) or {}
        if not (d / "index.html").exists() or abs(old.get("dur", 0) - beat["dur"]) > 0.01:
            (d / "index.html").write_text(motion.fill_template(beat, look), encoding="utf-8")
            for f in ("gates.json",):
                (d / f).unlink(missing_ok=True)
        shutil.copy(root / "skills" / "motion" / "template" / "hyperframes.json", d / "hyperframes.json")
        if gsap.exists():
            shutil.copy(gsap, d / "assets" / "gsap.min.js")
        jsave(d / "beat.json", beat)
        (d / "brief.md").write_text(BRIEF.format(
            id=r["id"], card=root / "skills" / "motion" / "references" / "clip-brief-card.md", dir=d, w=w, h=h, dur=beat["dur"],
            title=sc.get("title") or "", prompt=b.get("prompt") or "", look=json.dumps(look), visual=s.get("visual", ""),
            say=beat["line"], before=beat["before"], after=beat["after"], words=json.dumps(beat["words"]),
            n=k + 1, total=len(rows), first=" The first scene: it hooks in the first second." if k == 0 else "",
            last=" The last scene: it lands the idea and holds its final state." if k + 1 == len(rows) else "",
            start="- Notes on this clip, if any: `notes.md` beside this brief. Do what they say.\n\n",
            env=f'AI_EDITOR_HOME="{os.environ["AI_EDITOR_HOME"]}" ' if os.environ.get("AI_EDITOR_HOME") else "",
            run=root / "lib" / "ai_editor" / "run.py", motion=root / "skills" / "motion" / "scripts" / "motion.py",
            rounds=motion.ROUNDS), encoding="utf-8")
        beats.append(beat)
        print(f"{r['id']:<24} {beat['dur']:5.2f}s  {d / 'brief.md'}")
    jsave(mroot / "beats.json", {"clock": "video", "look": look, "beats": beats})
    print(f"{len(beats)} brief(s). One ai-editor:clip-builder agent per brief, all in one message.")
    return 0


FULL_FRAME_OK = {"tells"}   # gates written for a card over footage that a full-frame scene may fail on purpose
                            # (a sky filling the frame is "flat-saturated-ground" to a card, the point of a scene)


def clip_of(edit, sid):
    """A scene's render that passed, or whose only failures are FULL_FRAME_OK gates; None otherwise."""
    d = Path(edit) / "motion" / sid
    g = jload(d / "gates.json", {}) or {}
    f = d / "renders" / "clip.mp4"
    failed = {k for k, v in (g.get("gates") or {}).items() if not v[0]}
    ok = g.get("pass") or (g.get("gates") and failed and failed <= FULL_FRAME_OK)
    return f if ok and f.exists() else None


def fallback_clip(edit, row, look):
    """A scene whose clip did not pass: its look's ground, moving slowly, so the video still plays end to end."""
    w, h = size_of(edit)
    out = Path(edit) / "motion" / row["id"] / "renders" / "fallback.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    g = (look.get("ground") or "#111111").lstrip("#")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    f"color=c=0x{g}:s={w}x{h}:r={FPS}:d={row['dur']:.3f}", "-vf", "noise=alls=6:allf=t",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


# ---------------------------------------------------------------- music and mix
def cmd_music(edit, mood="linear"):
    edit = Path(edit)
    use_editor()
    import sound
    tm, b = jload(edit / "timing.json"), brief_of(edit)
    if not tm:
        sys.exit("ERROR: no timing.json. Run studio.py voice first.")
    mood = mood if mood in sound.MOODS else "linear"
    vo = edit / "audio" / "vo.wav" if tm["engine"] != "none" and (edit / "audio" / "vo.wav").exists() else None
    out = edit / "audio" / "mix.wav"
    if not b["music"] and not vo:
        out.unlink(missing_ok=True)
        print("no music and no voice: the video is silent")
        return 0
    cuts = [r["start"] for r in tm["scenes"][1:]]
    sections = [(r["start"], "hook" if k == 0 else "payoff" if k == len(tm["scenes"]) - 1 else "action")
                for k, r in enumerate(tm["scenes"])]
    # sound.score's own voice mix pads the voice to `length` but the bed to length + 0.05 s, so the shapes differ;
    # the same steps here with one length for both (compose, read_audio, duck, master are all sound.py's)
    import numpy as np
    n = int((tm["length"] + 0.05) * sound.SR)
    bed = np.zeros((2, n))
    if b["music"]:
        bed, _ = sound.compose(mood, tm["length"], None, cuts, 0, sections)
        bed = np.pad(bed, ((0, 0), (0, max(0, n - bed.shape[1]))))[:, :n] * 0.5
    mix = bed
    if vo:
        v = sound.read_audio(vo, tm["length"] + 0.05)[:, :n]
        mix = (sound.duck(bed, v) if b["music"] else bed) + v
    lufs, tp = sound.master(mix, out)
    print(json.dumps({"file": str(out), "lufs": lufs, "true_peak": tp, "mood": mood if b["music"] else None,
                      "music": b["music"], "voice": bool(vo)}))
    return 0


# ---------------------------------------------------------------- the scene, render, stills
CAPTION_STYLE = {"y_pct": 72, "size_pct": 5.6, "case": "sentence", "effect": "pop", "stroke": True}


def cmd_build(edit):
    edit = Path(edit).resolve()
    use_editor()
    import scene
    tm, words, sc, b = jload(edit / "timing.json"), jload(edit / "words.json") or [], jload(edit / "scenes.json"), brief_of(edit)
    if not tm:
        sys.exit("ERROR: no timing.json. Run studio.py voice first.")
    look = look_of(sc)
    w, h = size_of(edit)
    S = scene.Scene(w, h, FPS, background=look.get("ground") or "#000000", edit=edit)
    fell = []
    for r in tm["scenes"]:
        f = clip_of(edit, r["id"])
        if not f:
            f, _ = fallback_clip(edit, r, look), fell.append(r["id"])
        S.video(str(f.relative_to(edit)), r["start"], r["start"] + r["dur"], track="Scenes", volume=0)
    if b["text"] and words:   # one captions item per scene: a caption page never runs across a cut
        style = {**CAPTION_STYLE, **(sc.get("captions") or {})}
        for r in tm["scenes"]:
            mine = [{"w": x["w"], "start": x["start"], "end": x["end"]} for x in words
                    if r["start"] <= x["start"] < r["start"] + r["dur"]]
            if mine:
                S.captions(mine, style=style, start=r["start"], end=r["start"] + r["dur"], track="Captions")
    if (edit / "audio" / "mix.wav").exists():
        S.audio("audio/mix.wav", 0, tm["length"], track="Sound")
    S.sc["duration"] = tm["length"]
    jsave(edit / SCENE_FILE, S.done())
    print(f"{SCENE_FILE}: {len(tm['scenes'])} scenes, {tm['length']:.1f} s" + (f", captions {len(words)} words" if b["text"] and words else "") +
          (", sound" if (edit / "audio" / "mix.wav").exists() else ", silent"))
    if fell:
        print("FELL BACK (no passed clip, a plain moving ground instead): " + ", ".join(fell))
    return 0


def cmd_render(edit, draft=False):
    edit = Path(edit).resolve()
    use_editor()
    import scene
    if not (edit / SCENE_FILE).exists():
        sys.exit("ERROR: run studio.py build first.")
    out = scene.render(edit, out=edit / "render.mp4", draft=draft, log=edit / "render.studio.log", name=SCENE_FILE)
    print(f"{out} ({duration(out):.1f} s)")
    return 0


def cmd_stills(edit):
    """One frame from the middle of each scene, side by side, from the render."""
    edit = Path(edit).resolve()
    tm, video = jload(edit / "timing.json"), edit / "render.mp4"
    if not tm or not video.exists():
        sys.exit("ERROR: render first.")
    st = edit / "stills"
    st.mkdir(exist_ok=True)
    frames = []
    for r in tm["scenes"]:
        f = st / f"{r['id']}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{r['start'] + r['dur'] * 0.6:.2f}", "-i", str(video),
                        "-frames:v", "1", "-vf", "scale=360:-2", str(f)], check=True)
        frames.append(f)
    cols = min(len(frames), 6)
    rows_n = math.ceil(len(frames) / cols)
    inputs = sum((["-i", str(f)] for f in frames), [])
    w, h = size_of(edit)
    cw, ch = 360, int(360 * h / w) // 2 * 2
    layout = "|".join(f"{(k % cols) * cw}_{(k // cols) * ch}" for k in range(len(frames)))
    sheet = st / "sheet.png"
    if len(frames) == 1:
        shutil.copy(frames[0], sheet.with_suffix(".jpg"))
        sheet = sheet.with_suffix(".jpg")
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex",
                        "".join(f"[{k}:v]" for k in range(len(frames))) + f"xstack=inputs={len(frames)}:layout={layout}:fill=black",
                        "-frames:v", "1", str(sheet)], check=True)
    print(f"{sheet} ({len(frames)} scenes, {cols}x{rows_n})")
    return 0


# ---------------------------------------------------------------- self-check
def demo():
    with tempfile.TemporaryDirectory() as t:
        e = Path(t) / "edits" / "demo"
        e.mkdir(parents=True)
        jsave(e / "brief.json", {"prompt": "how a seed becomes a tree", "aspect": "9:16", "voice": False, "text": True, "music": False})
        jsave(e / "scenes.json", {"title": "Seed to tree", "scenes": [{"id": "x", "visual": ""}]})
        assert check_scenes(e) and "no visual" in check_scenes(e)[0], check_scenes(e)
        jsave(e / "scenes.json", {"title": "Seed to tree", "mood": "arc", "scenes": [
            {"id": "seed", "say": "Every tree starts tiny.", "text": "Every tree starts tiny", "visual": "a seed in dark soil"},
            {"id": "roots", "say": "Roots go down first, then a shoot goes up toward the light, slowly.",
             "text": "Roots first, then the shoot", "visual": "roots spreading, a shoot rising"}]})
        assert check_scenes(e) == [], check_scenes(e)
        jsave(e / "brief.json", {"prompt": "x", "aspect": "9:16", "voice": True, "text": True, "music": True})
        jsave(e / "scenes.json", {"scenes": [{"id": "a", "visual": "v"}]})
        assert any("voice is on" in x for x in check_scenes(e)), "voice on needs say"
        jsave(e / "brief.json", {"prompt": "x", "aspect": "16:9", "voice": False, "text": True, "music": False})
        jsave(e / "scenes.json", {"title": "T", "scenes": [{"id": "a", "text": "one two three four five six", "visual": "v"},
                                                            {"id": "b", "text": "hi", "visual": "v"}]})
        assert cmd_voice(e, "auto") == 0
        tm = jload(e / "timing.json")
        assert tm["engine"] == "none" and tm["scenes"][1]["start"] == tm["scenes"][0]["dur"], tm
        assert tm["scenes"][1]["dur"] == MIN_SCENE_S, "a short line still gets the minimum"
        assert abs(tm["length"] - sum(r["dur"] for r in tm["scenes"])) < 1e-6
        assert cmd_words(e) == 0
        ws = jload(e / "words.json")
        assert [w["w"] for w in ws][:2] == ["one", "two"] and all(ws[k]["start"] < ws[k + 1]["start"] for k in range(len(ws) - 1))
        assert all(tm["scenes"][1]["start"] <= w["start"] for w in ws if w["w"] == "hi")
        assert scene_words(ws, tm["scenes"][1]) == [{"w": "hi", "t": 0.3}], scene_words(ws, tm["scenes"][1])
        assert size_of(e) == (1920, 1080)
        assert estimate({"say": "a " * 100}, {"voice": True}) == MAX_SCENE_S, "a long line is capped (split it)"
        if editor_root():
            assert (editor_root() / "lib" / "ai_editor" / "scene.py").exists()
    print("studio demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("root")
    sub.add_parser("demo")
    for name in ("check-scenes", "words", "briefs", "build", "stills"):
        sub.add_parser(name).add_argument("edit")
    v = sub.add_parser("voice")
    v.add_argument("edit")
    v.add_argument("--engine", default="auto", choices=("auto", "eleven", "mac", "none"))
    v.add_argument("--voice")
    m = sub.add_parser("music")
    m.add_argument("edit")
    m.add_argument("--mood", default="linear")
    r = sub.add_parser("render")
    r.add_argument("edit")
    r.add_argument("--draft", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "root":
        print(editor_root())
        return 0
    if a.cmd == "demo":
        return demo()
    return {"check-scenes": lambda: cmd_check_scenes(a.edit), "voice": lambda: cmd_voice(a.edit, a.engine, a.voice),
            "words": lambda: cmd_words(a.edit), "briefs": lambda: cmd_briefs(a.edit),
            "music": lambda: cmd_music(a.edit, a.mood), "build": lambda: cmd_build(a.edit),
            "render": lambda: cmd_render(a.edit, a.draft), "stills": lambda: cmd_stills(a.edit)}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
