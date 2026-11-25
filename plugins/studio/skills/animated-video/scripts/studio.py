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
    python3 studio.py like EDIT <link or file>       "Make one like this": the liked video in EDIT/like/, measured
                                                     (length, shape, cuts, words a second, its hook, music under the
                                                     voice) into like.json and like.md, and a sheet of 8 frames
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib3d  # noqa: E402  (the shared 3D library, beside this file)

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


DARK_LUMA = 28   # of 255. Measured on a rendered video: a daylight street is about 100, Earth from orbit 35 to 55, a shot that reads as black 23


def luma_of(f):
    """How bright a clip is: the middle value of its frames' mean brightness (0 to 255), two frames a second. None when it cannot be read."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vf", "fps=2,scale=160:-2,signalstats,metadata=print:file=-", "-f", "null", "-"],
                       capture_output=True, text=True)
    ys = sorted(float(x) for x in re.findall(r"YAVG=([\d.]+)", r.stdout))
    return ys[len(ys) // 2] if ys else None


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


# ---------------------------------------------------------------- make one like this
LIKE_FRAMES = 8


def cuts_of(video, thr=0.3):
    """The times the picture cuts (ffmpeg's scene change score over thr, on a small copy)."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-an", "-vf", f"scale=320:-2,select='gt(scene,{thr})',showinfo",
                        "-f", "null", "-"], capture_output=True, text=True)
    return [round(float(t), 2) for t in re.findall(r"pts_time:([\d.]+)", r.stderr)]


def levels(media, step=0.1):
    """dB every `step` seconds of the sound (mono, 8 kHz)."""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(media), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = int(8000 * step)
    if len(x) < n:
        return []
    x = x[:len(x) // n * n].reshape(-1, n)
    return [round(float(v), 1) for v in 20 * np.log10(np.maximum(1e-5, np.sqrt((x * x).mean(axis=1))))]


def music_under(db, words, step=0.1):
    """True when the gaps between words are not quiet (a bed under the voice), False when they are, None when the
    video has too few gaps to tell (under 1.5 s of them) or no words at all."""
    if not words or not db:
        return None
    talk = [False] * len(db)
    for w in words:
        for i in range(max(0, int((w["start"] - 0.15) / step)), min(len(db), int((w["end"] + 0.15) / step) + 1)):
            talk[i] = True
    gap = sorted(v for v, t in zip(db, talk) if not t)
    said = sorted(v for v, t in zip(db, talk) if t)
    if len(gap) * step < 1.5 or not said:
        return None
    g, sp = gap[len(gap) // 2], said[len(said) // 2]
    return g > -45 and g > sp - 18


def hook_of(words, n=16):
    """The video's first sentence (or its first n words)."""
    out = []
    for w in words:
        out.append(w["text"].strip())
        if re.search(r"[.?!]$", out[-1]) or len(out) >= n:
            break
    return " ".join(out)


def cmd_like(edit, src, cookies=None):
    edit = Path(edit).resolve()
    root = use_editor()
    import links
    d = edit / "like"
    d.mkdir(parents=True, exist_ok=True)
    if Path(src).expanduser().is_file():
        video = Path(src).expanduser().resolve()
    else:
        code, msg = links.fetch(src, d, cookies=cookies, max_height=720)
        if code:
            print(("LOGIN: " if code == 3 else "ERROR: ") + msg)
            return code
        video = Path(msg)
    dur = duration(video)
    w, h = (int(x) for x in subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                            "stream=width,height", "-of", "csv=p=0", str(video)],
                                           capture_output=True, text=True).stdout.strip().split(",")[:2])
    raw = d / "words.raw.json"
    if not raw.exists():
        subprocess.run([sys.executable, str(root / "skills" / "cut" / "scripts" / "transcribe.py"), str(video), str(raw),
                        "--engine", "whisper"], capture_output=True, text=True)
    words = [x for x in jload(raw, []) or [] if x.get("type", "word") == "word" and x["text"].strip()]
    cuts = cuts_of(video)
    span = (words[-1]["end"] - words[0]["start"]) if words else 0
    talk = sum(x["end"] - x["start"] for x in words)
    like = {"from": src, "length": round(dur, 1), "aspect": "9:16" if h > w else "16:9", "cuts": len(cuts),
            "shot_s": round(dur / (len(cuts) + 1), 1), "words": len(words),
            "wps": round(len(words) / span, 2) if span > 1 else 0, "speech_share": round(talk / dur, 2) if dur else 0,
            "music": music_under(levels(video), words), "hook": hook_of(words),
            "text": " ".join(x["text"].strip() for x in words)[:1500]}
    jsave(d / "like.json", like)
    frames = []
    for k in range(LIKE_FRAMES):
        f = d / f"frame-{k + 1}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{dur * (k + 0.5) / LIKE_FRAMES:.2f}", "-i", str(video),
                        "-frames:v", "1", "-vf", "scale=270:-2", str(f)], capture_output=True)
        if f.exists():
            frames.append(f)
    if frames:
        subprocess.run(["ffmpeg", "-v", "error", "-y", *sum((["-i", str(f)] for f in frames), []), "-filter_complex",
                        "".join(f"[{k}:v]" for k in range(len(frames))) + f"concat=n={len(frames)}:v=1:a=0,tile=4x2" if len(frames) == 8
                        else "".join(f"[{k}:v]" for k in range(len(frames))) + f"hstack=inputs={len(frames)}" if len(frames) > 1
                        else "null", "-frames:v", "1", str(d / "sheet.jpg")], capture_output=True)
        for f in frames:
            f.unlink()
    music = {True: "yes, a bed under the voice", False: "no (quiet between the words)", None: "can't tell"}[like["music"]]
    (d / "like.md").write_text("\n".join([
        f"# The video to make one like: {src}", "",
        f"- Length {like['length']} s, {like['aspect']}, {like['cuts']} cuts (a new shot about every {like['shot_s']} s)",
        f"- Voice: {like['words']} words, {like['wps']} a second, talking {round(100 * like['speech_share'])}% of the time",
        f"- Music under the voice: {music}",
        f"- Its hook: {like['hook'] or '(no words)'}",
        f"- Frames: like/sheet.jpg (8, start to end: look at it for the colours, type, captions and what fills the frame)",
        "", "## What it says", "", like["text"] or "(nothing: music and pictures only)"]) + "\n", encoding="utf-8")
    print(f"{d / 'like.md'}: {like['length']} s {like['aspect']}, {like['cuts']} cuts, {like['wps']} words/s, music {music}")
    return 0


# ---------------------------------------------------------------- scenes.json
def check_scenes(edit):
    """Errors in scenes.json, [] when it is fine."""
    sc = jload(Path(edit) / "scenes.json")
    if not isinstance(sc, dict) or not isinstance(sc.get("scenes"), list) or not sc["scenes"]:
        return ["scenes.json needs {\"scenes\": [{\"id\", \"say\", \"text\", \"visual\"}, ...]}"]
    b, errs, ids = brief_of(edit), [], set()
    wids = {str(w.get("id")) for w in sc.get("worlds") or [] if isinstance(w, dict)}
    if sc.get("style3d") and not 2 <= len(wids) <= 6:
        errs.append("a 3D video has 2 to 6 worlds in \"worlds\" (each {\"id\", \"describe\"})")
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
        if sc.get("style3d") and s.get("world") not in wids:
            errs.append(f"scene {sid}: its \"world\" must be one of {sorted(wids)}")
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
def tts_eleven(text, out, voice, key, before="", after=""):
    import urllib.request
    from ai_editor import net
    body = {"text": text, "model_id": "eleven_multilingual_v2"}
    if before:
        body["previous_text"] = before[-600:]
    if after:
        body["next_text"] = after[:600]
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
                                 data=json.dumps(body).encode(),
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    mp3 = Path(out).with_suffix(".mp3")
    with net.urlopen(req, 120) as r:
        mp3.write_bytes(r.read())
    to_wav(mp3, out)
    mp3.unlink()


def tts_mac(text, out, voice, rate=None):
    aiff = Path(out).with_suffix(".aiff")
    subprocess.run(["say", "-v", voice] + (["-r", str(rate)] if rate else []) + ["-o", str(aiff), text], check=True)
    to_wav(aiff, out)
    aiff.unlink()


KOKORO_VOICE = "am_michael"     # a calm narrator; the others: am_fenrir, af_heart, bm_george, bf_emma (kokoro voices lists all)
_KOKORO = []


def kokoro_dir():
    import os
    home = os.environ.get("AI_EDITOR_HOME", "").strip()
    return (Path(home) if home else Path.home() / ".ai-video-editor") / "models" / "kokoro"


def kokoro_ready():
    """The free neural voice is there: its package in this Python and its two model files on disk."""
    d = kokoro_dir()
    if not ((d / "kokoro-v1.0.onnx").is_file() and (d / "voices-v1.0.bin").is_file()):
        return False
    try:
        import kokoro_onnx  # noqa: F401
        import soundfile  # noqa: F401
    except ImportError:
        return False
    return True


def tts_kokoro(text, out, voice, speed=1.0):
    """Kokoro (an open neural voice, Apache 2.0) on this computer: nothing is sent anywhere, nothing is billed."""
    import soundfile as sf
    from kokoro_onnx import Kokoro
    if not _KOKORO:
        d = kokoro_dir()
        _KOKORO.append(Kokoro(str(d / "kokoro-v1.0.onnx"), str(d / "voices-v1.0.bin")))
    wav, sr = _KOKORO[0].create(text, voice=voice, speed=max(0.7, min(1.3, speed)), lang="en-gb" if voice[:1] == "b" else "en-us")
    raw = Path(out).with_suffix(".k.wav")
    sf.write(str(raw), wav, sr)
    to_wav(raw, out)
    raw.unlink()


# Microsoft's neural voices through the edge-tts library: free, no key, the most natural of the free ones. The text
# is sent to Microsoft's read-aloud service to be spoken (an unofficial route into it: it may change or stop).
EDGE_VOICE = "en-US-AndrewMultilingualNeural"
EDGE_VOICES = [("en-US-AndrewMultilingualNeural", "Andrew", "American · man"), ("en-US-BrianMultilingualNeural", "Brian", "American · man"),
               ("en-US-ChristopherNeural", "Christopher", "American · man"), ("en-US-GuyNeural", "Guy", "American · man"),
               ("en-US-RogerNeural", "Roger", "American · man"), ("en-US-SteffanNeural", "Steffan", "American · man"),
               ("en-US-AvaMultilingualNeural", "Ava", "American · woman"), ("en-US-EmmaMultilingualNeural", "Emma", "American · woman"),
               ("en-US-AriaNeural", "Aria", "American · woman"), ("en-US-JennyNeural", "Jenny", "American · woman"),
               ("en-US-MichelleNeural", "Michelle", "American · woman"),
               ("en-GB-RyanNeural", "Ryan", "British · man"), ("en-GB-ThomasNeural", "Thomas", "British · man"),
               ("en-GB-SoniaNeural", "Sonia", "British · woman"), ("en-GB-LibbyNeural", "Libby", "British · woman"),
               ("en-IN-PrabhatNeural", "Prabhat", "Indian · man"), ("en-IN-NeerjaExpressiveNeural", "Neerja", "Indian · woman"),
               ("en-AU-WilliamMultilingualNeural", "William", "Australian · man"), ("en-AU-NatashaNeural", "Natasha", "Australian · woman")]


def edge_ready():
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        return False
    return True


def tts_edge(text, out, voice, speed=1.0):
    import asyncio
    import edge_tts
    mp3 = Path(out).with_suffix(".edge.mp3")
    rate = f"{round((max(0.7, min(1.3, speed)) - 1) * 100):+d}%"
    asyncio.run(edge_tts.Communicate(text, voice, rate=rate).save(str(mp3)))
    to_wav(mp3, out)
    mp3.unlink()


# Pocket TTS (Kyutai): a 100 M voice model on this computer's processor, about 1.3 GB of memory, several times faster
# than real time. It lives in its own Python (~/.ai-video-editor/pocket, about 1 GB) so PyTorch stays out of the editor's.
POCKET_VOICE = "george"
POCKET_VOICES = [("george", "George", "British · man"), ("charles", "Charles", "British · man"), ("paul", "Paul", "British · man"),
                 ("michael", "Michael", "American · man"), ("marius", "Marius", "American · man"), ("javert", "Javert", "American · man"),
                 ("jean", "Jean", "American · man"), ("bill_boerst", "Bill", "American · man"), ("peter_yearsley", "Peter", "British · man"),
                 ("stuart_bell", "Stuart", "British · man"),
                 ("alba", "Alba", "British · woman"), ("anna", "Anna", "British · woman"), ("vera", "Vera", "British · woman"),
                 ("fantine", "Fantine", "British · woman"), ("mary", "Mary", "American · woman"), ("jane", "Jane", "British · woman"),
                 ("eve", "Eve", "American · woman"), ("cosette", "Cosette", "American · woman"), ("eponine", "Eponine", "British · woman"),
                 ("azelma", "Azelma", "American · woman"), ("caro_davy", "Caro", "British · woman")]
POCKET_CREDIT = "Voice: Pocket TTS by Kyutai (CC BY 4.0)"
_POCKET = []


def pocket_py():
    import os
    home = os.environ.get("AI_EDITOR_HOME", "").strip()
    d = (Path(home) if home else Path.home() / ".ai-video-editor") / "pocket"
    return d / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def pocket_ready():
    return pocket_py().is_file() and any(pocket_py().parents[1].glob("lib/python*/site-packages/pocket_tts")) or (
        pocket_py().is_file() and (pocket_py().parents[1] / "Lib" / "site-packages" / "pocket_tts").is_dir())


def cmd_pocket_setup():
    """The studio voice, once: its own Python environment with Pocket TTS (about 1 GB), then its model on first use."""
    if not pocket_ready():
        import venv
        venv.create(pocket_py().parents[1], with_pip=True)
        subprocess.run([str(pocket_py()), "-m", "pip", "install", "-q", "pocket-tts"], check=True)
    print("pocket ready" if pocket_ready() else "ERROR: the Pocket voice did not install")
    return 0 if pocket_ready() else 1


def my_voice():
    """The user's own voice sample (Settings > Connections > Voice), which the Studio voice copies. A path that may not exist."""
    return pocket_py().parents[2] / "voices" / "mine.wav"


def pronounce(text):
    """The text as it should be SPOKEN: ~/.ai-video-editor/pronounce.json maps a word or name to how to say it
    ({"Kyutai": "cue tie", "GIF": "jif"}). Whole words, any case. The script and the captions keep the real spelling."""
    try:
        m = json.loads((pocket_py().parents[2] / "pronounce.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return text
    for k, v in (m.items() if isinstance(m, dict) else []):
        if k and isinstance(v, str):
            text = re.sub(r"(?<!\w)" + re.escape(str(k)) + r"(?!\w)", v, text, flags=re.I)
    return text


def tts_pocket(text, out, voice, speed=1.0):
    """One line in a Pocket voice. `voice`: a catalogue name, or a recording's path to copy the voice of."""
    if not _POCKET or _POCKET[0].poll() is not None:
        import os
        env = dict(os.environ)
        try:                    # only copying a voice needs it: the user's own free Hugging Face token, from Settings
            use_editor()
            from ai_editor import keys
            tok = keys.get("huggingface")[0]
            if tok:
                env["HF_TOKEN"] = tok
        except Exception:   # noqa: BLE001
            pass
        _POCKET[:] = [subprocess.Popen([str(pocket_py()), str(Path(__file__).with_name("pocket_say.py"))], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, text=True, env=env)]
        if not json.loads(_POCKET[0].stdout.readline() or "{}").get("ready"):
            raise RuntimeError("the Pocket voice did not start")
    raw = Path(out).with_suffix(".p.wav")
    _POCKET[0].stdin.write(json.dumps({"text": text, "out": str(raw), "voice": voice}) + "\n")
    _POCKET[0].stdin.flush()
    got = json.loads(_POCKET[0].stdout.readline() or '{"error": "no answer"}')
    if not got.get("ok"):
        raise RuntimeError(got.get("error") or "the Pocket voice failed")
    sp = max(0.75, min(1.3, float(speed or 1.0)))
    if abs(sp - 1.0) >= 0.02:   # the model has no pace of its own: the same voice, stretched without changing its pitch
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", f"atempo={sp:.3f}", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(out)], check=True)
    else:
        to_wav(raw, out)
    raw.unlink()


KOKORO_VOICES = ["am_michael", "am_fenrir", "am_adam", "am_echo", "am_eric", "am_liam", "am_onyx", "am_puck",
                 "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_nova", "af_river", "af_jessica", "af_kore", "af_alloy", "af_aoede",
                 "bm_george", "bm_daniel", "bm_fable", "bm_lewis", "bf_emma", "bf_alice", "bf_isabella", "bf_lily"]
PREVIEW_LINE = "This is how I sound when I tell your story. One fact at a time, at a pace you can follow."


def cmd_preview(engine, voice, out):
    """A few seconds of one voice as a WAV, for the page's voice picker."""
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    if engine == "edge" and voice in [v[0] for v in EDGE_VOICES] and edge_ready():
        tts_edge(PREVIEW_LINE, out, voice)
        print(out)
        return 0
    if engine == "pocket" and voice.startswith("mine") and pocket_ready() and my_voice().is_file():
        tts_pocket(PREVIEW_LINE, out, str(my_voice()))
        print(out)
        return 0
    if engine == "pocket" and voice in [v[0] for v in POCKET_VOICES] and pocket_ready():
        tts_pocket(PREVIEW_LINE, out, voice)
        print(out)
        return 0
    if engine != "kokoro" or voice not in KOKORO_VOICES or not kokoro_ready():
        sys.exit("ERROR: no such voice here.")
    tts_kokoro(PREVIEW_LINE, out, voice)
    print(out)
    return 0


KOKORO_FILES = {"kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
                "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"}


def cmd_kokoro_setup():
    """The free neural voice, once: its package into this Python (the editor's venv) and its model (about 350 MB)."""
    if not kokoro_ready():
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "kokoro-onnx", "soundfile"], check=True)
        use_editor()
        from ai_editor import net
        d = kokoro_dir()
        d.mkdir(parents=True, exist_ok=True)
        for name, url in KOKORO_FILES.items():
            if not (d / name).is_file():
                print(f"downloading {name} ...", flush=True)
                net.retrieve(url, d / (name + ".part"), 1800)
                (d / (name + ".part")).rename(d / name)
    print("kokoro ready" if kokoro_ready() else "ERROR: the Kokoro voice did not install")
    return 0 if kokoro_ready() else 1


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
        sys.exit("No ElevenLabs key saved. Say \"add my elevenlabs key\" (setup), or use --engine kokoro.")
    if want in ("auto", "edge") and edge_ready():
        return "edge", None
    if want == "edge":
        sys.exit("The Edge voices are not installed (pip install edge-tts into the editor's environment), or use --engine kokoro.")
    if want == "pocket":
        if pocket_ready():
            return "pocket", None
        sys.exit("The studio voice is not installed: studio.py pocket-setup (about 1 GB, once), or use --engine kokoro.")
    if want in ("auto", "kokoro") and kokoro_ready():
        return "kokoro", None
    if want == "kokoro":
        sys.exit("The Kokoro voice is not installed: studio.py kokoro-setup (a 350 MB download, once), or use --engine mac.")
    if shutil.which("say"):
        return "mac", None
    sys.exit("No voice engine here: no ElevenLabs key and no macOS `say`. Use --engine none (on-screen words only).")


MAC_RATE, SLOWEST, MAX_AIR_S = 175, 0.8, 1.5     # say's words a minute; never slower than 80%; air after a line


def fit_plan(voiced, n, target, share=0.85):
    """How to reach `target` seconds from `voiced` seconds of speech in n scenes: (speed, air after each line).
    The voice slows first (to SLOWEST at most, it sounds drugged below), then every line gets the same air."""
    if not target or not voiced or not n:
        return 1.0, 0.0
    speed = max(SLOWEST, min(1.0, voiced / (target * share)))
    base = LEAD_S + voiced / speed + n * TAIL_S
    return round(speed, 3), round(max(0.0, min(MAX_AIR_S, (target - base) / n)), 3)


def cmd_voice(edit, engine="auto", voice=None, fit=None):
    """Each scene's voice, then timing.json: {"scenes": [{"id", "start", "dur", "vo"?}], "length", "engine"}.
    fit: the length to reach (seconds). Default: the liked video's, when brief.json has `like`."""
    edit = Path(edit)
    errs = check_scenes(edit)
    if errs:
        sys.exit("ERROR: scenes.json: " + "; ".join(errs))
    b, scenes = brief_of(edit), jload(edit / "scenes.json")["scenes"]
    want = str(b.get("voice_engine") or "")       # the page's voice picker: "kokoro" or "eleven" with brief voice_id
    if engine == "auto" and want in ("kokoro", "eleven", "edge", "pocket"):
        try:
            eng, key = engine_for(want if b["voice"] else "none")
        except SystemExit:                         # that engine is not there any more (a removed key): the best there is
            eng, key = engine_for("auto" if b["voice"] else "none")
    else:
        eng, key = engine_for(engine if b["voice"] else "none")
    (edit / "audio").mkdir(exist_ok=True)
    if not voice and str(b.get("voice_id") or "").strip():
        vid = str(b["voice_id"]).strip()
        if (eng == "kokoro" and vid in KOKORO_VOICES) or (eng == "eleven" and want == "eleven" and re.fullmatch(r"[A-Za-z0-9]{12,40}", vid)) \
                or (eng == "edge" and vid in [v[0] for v in EDGE_VOICES]) or (eng == "pocket" and (vid in [v[0] for v in POCKET_VOICES] or vid == "mine")):
            voice = vid
    like = jload(edit / "like" / "like.json", {}) if b.get("like") else {}
    if fit is None and like:
        fit = float(b.get("length") or like.get("length") or 0)

    def speak(rate):
        out_d = []
        for s in scenes:
            out = edit / "audio" / f"vo-{s['id']}.wav"
            text = pronounce(str(s["say"]).strip())
            stamp = edit / "audio" / f"vo-{s['id']}.txt"
            want = f"{eng}|{voice}|{text}" + (f"|r{rate}" if rate else "")
            bite = edit / "audio" / f"bite-{s['id']}.wav"       # a sound bite (long-video): the person's own words are the voice
            if s.get("bite") and bite.exists():
                if not out.exists() or out.stat().st_mtime < bite.stat().st_mtime:
                    shutil.copy2(bite, out)
                stamp.write_text("bite", encoding="utf-8")
            elif not out.exists() or (stamp.read_text(encoding="utf-8") if stamp.exists() else "") != want:
                if eng == "eleven":
                    tts_eleven(text, out, voice or DEFAULT_VOICE, key)
                elif eng == "edge":
                    try:
                        tts_edge(text, out, voice or EDGE_VOICE, (rate or 100) / 100.0)
                    except Exception as e:      # offline, or Microsoft's service refused: the voice on this computer
                        if not kokoro_ready():
                            sys.exit(f"ERROR: the Edge voice did not answer ({type(e).__name__}) and no other voice is installed.")
                        print(f"note: the Edge voice did not answer ({type(e).__name__}); this line is in the Kokoro voice")
                        tts_kokoro(text, out, KOKORO_VOICE, (rate or 100) / 100.0)
                elif eng == "kokoro":
                    tts_kokoro(text, out, voice or KOKORO_VOICE, (rate or 100) / 100.0)
                elif eng == "pocket":       # brief "voice_sample": a recording in the edit folder to copy the voice of
                    sample = edit / str(b.get("voice_sample") or "-")
                    if voice == "mine" and not sample.is_file() and b.get("voice_sample") != "":
                        sample = my_voice()
                    pv = POCKET_VOICE if voice in (None, "mine") else voice
                    try:
                        tts_pocket(text, out, str(sample) if sample.is_file() else pv, (rate or 100) / 100.0)
                    except RuntimeError as e:
                        if not sample.is_file():
                            raise
                        print(f"note: could not copy the voice in {sample.name} ({str(e)[:90]}); using {pv}. Copying a voice needs the user's own free "
                              "Hugging Face token in Settings, with the model's terms accepted at huggingface.co/kyutai/pocket-tts.")
                        b["voice_sample"] = ""
                        tts_pocket(text, out, pv, (rate or 100) / 100.0)
                else:
                    tts_mac(text, out, voice or MAC_VOICE, rate)
                stamp.write_text(want, encoding="utf-8")
            out_d.append(duration(out))
        return out_d

    def say_chunk(text, out, rate, before="", after=""):       # some lines in one breath, in the engine the video uses
        text = pronounce(text)
        if eng == "eleven":
            tts_eleven(text, out, voice or DEFAULT_VOICE, key, before, after)
        elif eng == "edge":
            tts_edge(text, out, voice or EDGE_VOICE, (rate or 100) / 100.0)
        elif eng == "kokoro":
            tts_kokoro(text, out, voice or KOKORO_VOICE, (rate or 100) / 100.0)
        elif eng == "pocket":
            sample = my_voice() if voice == "mine" else None
            tts_pocket(text, out, str(sample) if sample and sample.is_file() else (POCKET_VOICE if voice in (None, "mine") else voice), (rate or 100) / 100.0)
        else:
            tts_mac(text, out, voice or MAC_VOICE, rate)

    speed, air, vds, take = 1.0, 0.0, [], False
    if eng != "none" and not b.get("voice_by_line"):
        # One take. Measured on a real video: a line recorded by itself starts its melody again every time, and 1.4 s of
        # silence was added after each to reach the length, so the narration stopped and started 11 times in a minute.
        # The whole script is now spoken in as few breaths as the engine allows, then cut only in its own pauses.
        rate = None
        if b.get("voice_speed") and eng in ("kokoro", "edge", "pocket"):
            try:
                rate = round(100 * max(0.8, min(1.25, float(b["voice_speed"]))))
                speed = rate / 100.0
            except (TypeError, ValueError):
                rate = None
        try:
            vds = one_take(edit, scenes, say_chunk, f"{eng}|{voice}|{rate}", rate)
            take = True
        except Exception as e:   # noqa: BLE001  (no transcription model, an engine that refused a long text): line by line, as before
            print(f"note: the narration could not be made as one take ({type(e).__name__}: {str(e)[:120]}); recording it line by line")
    if take:
        pass
    elif eng != "none":
        vds = speak(None)
        speed, air = fit_plan(sum(vds), len(scenes), fit, like.get("speech_share") or 0.85)
        air = min(air, 0.25)        # never a long silence to reach a length: a short video is said to be short (FIT below)
        if eng == "mac" and speed < 0.97:      # ElevenLabs is paid by the character: one pass, air only
            want = sum(vds) / speed
            rate = round(MAC_RATE * speed)
            vds = speak(rate)
            if abs(sum(vds) - want) > 0.05 * want:        # say's own pace differs a voice to a voice: one correction
                rate = max(round(MAC_RATE * SLOWEST * 0.9), round(rate * sum(vds) / want))
                vds = speak(rate)
        elif eng in ("kokoro", "edge", "pocket") and (fit or b.get("voice_speed")):   # these take a speed: slower when short, a little faster when long
            total = LEAD_S + sum(vds) + len(scenes) * TAIL_S
            speed = round(max(SLOWEST + 0.05, min(1.12, total / fit if total > fit else sum(vds) / (fit * 0.9))), 2) if fit else 1.0
            if b.get("voice_speed"):        # the user's own pace for the narrator (0.8 slow to 1.25 fast) wins
                try:
                    speed = round(max(0.8, min(1.25, float(b["voice_speed"]))), 2)
                except (TypeError, ValueError):
                    pass
            if abs(speed - 1.0) >= 0.03:
                vds = speak(round(100 * speed))
            else:
                speed = 1.0
        elif speed < 0.97:
            speed = 1.0
        if fit:
            air = round(max(0.0, min(0.25, (fit - LEAD_S - sum(vds) - len(scenes) * TAIL_S) / len(scenes))), 3)
    t, rows = 0.0, []
    for i, s in enumerate(scenes):
        row = {"id": s["id"], "start": round(t, 3)}
        if eng != "none":
            lead = LEAD_S if i == 0 else 0.0
            row.update(vo=f"audio/vo-{s['id']}.wav", vo_at=round(t + lead, 3), vo_dur=round(vds[i], 3))
            # one take: each line is exactly its piece of the take (its own pause included), so the pieces join without a seam
            dur = lead + vds[i] + (0.6 if i == len(scenes) - 1 else 0.0) if take else max(MIN_SCENE_S, lead + vds[i] + TAIL_S + air)
        else:
            dur = estimate(s, b)
        row["dur"] = round(dur, 3)
        rows.append(row)
        t += dur
    tm = {"engine": eng, "take": take, "voice": voice or (DEFAULT_VOICE if eng == "eleven" else KOKORO_VOICE if eng == "kokoro" else EDGE_VOICE if eng == "edge" else MAC_VOICE if eng == "mac" else None),
          "length": round(t, 3), "scenes": rows}
    if fit and eng != "none":
        tm["fit"] = {"target": round(fit, 1), "speed": speed, "air": air}
    jsave(edit / "timing.json", tm)
    if eng != "none":
        join_voice(edit, tm)
    for r in rows:
        print(f"{r['id']:<24} {r['start']:6.2f}s +{r['dur']:.2f}s" + (f"  voice {r['vo_dur']:.2f}s" if r.get("vo") else ""))
    print(f"{len(rows)} scenes, {t:.1f} s, voice: {eng}" + (" (the free Mac voice: robotic. studio.py kokoro-setup installs a natural free one)" if eng == "mac" else
                                                           " (Kokoro, a free neural voice on this computer)" if eng == "kokoro" else
                                                           " (a Microsoft neural voice, free; the words were sent to Microsoft to be spoken)" if eng == "edge" else ""))
    if fit and eng != "none":
        print(f"fit   {t:.1f} s for {fit:.0f} s: the voice at {round(100 * speed)}% speed, {air:.2f} s of air after each line")
        words = sum(len(words_in(s.get("say"))) for s in scenes)
        if t < 0.9 * fit:
            print(f"FIT   {fit - t:.0f} s short: add about {round((fit - t) * words / max(1.0, sum(vds)))} words to the say lines, then voice again")
        elif t > 1.1 * fit:
            print(f"FIT   {t - fit:.0f} s long: cut about {round((t - fit) * words / max(1.0, sum(vds)))} words from the say lines, then voice again")
    return 0


def _norm(w):
    return re.sub(r"[^a-z0-9]+", "", str(w).lower())


def one_take(edit, scenes, say_chunk, stamp, rate=None, limit=2400):
    """The narration as one continuous take, then cut into each line's piece only where the voice itself pauses.
    Lines are grouped into breaths of up to `limit` characters (a section, or a few), each spoken in one request with
    what comes before and after it as context; the breaths are joined; the take is transcribed for its word times; each
    line's words are found in it; and the cut between two lines falls at the quietest moment of the pause between them.
    Writes audio/vo-<id>.wav for every line and returns their lengths. A line that is a sound bite keeps its own file."""
    import difflib
    edit = Path(edit)
    aud = edit / "audio"
    lines = [(s["id"], str(s["say"]).strip(), bool(s.get("bite") and (aud / f"bite-{s['id']}.wav").exists())) for s in scenes]
    want = stamp + "|" + "|".join(t for _, t, _ in lines)
    st = aud / "take.txt"
    if st.exists() and st.read_text(encoding="utf-8") == want and all((aud / f"vo-{i}.wav").exists() for i, _, _ in lines):
        return [duration(aud / f"vo-{i}.wav") for i, _, _ in lines]
    root = use_editor()
    # runs of spoken lines between sound bites; each run is one take
    runs, cur = [], []
    for row in lines:
        if row[2]:
            if cur:
                runs.append(cur)
            cur = []
        else:
            cur.append(row)
    if cur:
        runs.append(cur)
    for k, run in enumerate(runs):
        chunks, c = [], []
        for row in run:                                    # breaths: whole lines, up to `limit` characters
            if c and sum(len(t) + 1 for _, t, _ in c) + len(row[1]) > limit:
                chunks.append(c)
                c = []
            c.append(row)
        chunks.append(c)
        parts = []
        for j, c in enumerate(chunks):
            f = aud / f"take-{k}-{j}.wav"
            text = " ".join(t for _, t, _ in c)
            say_chunk(text, f, rate, " ".join(t for _, t, _ in chunks[j - 1]) if j else "", " ".join(t for _, t, _ in chunks[j + 1]) if j + 1 < len(chunks) else "")
            parts.append(f)
        take = aud / f"take-{k}.wav"
        if len(parts) == 1:
            parts[0].replace(take)
        else:
            lst = aud / f"take-{k}.txt"
            lst.write_text("".join(f"file '{f.name}'\n" for f in parts), encoding="utf-8")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:a", "pcm_s16le", str(take)], check=True, cwd=str(aud))
            lst.unlink()
            for f in parts:
                f.unlink(missing_ok=True)
        raw = aud / f"take-{k}.words.json"
        r = subprocess.run([sys.executable, str(root / "skills" / "cut" / "scripts" / "transcribe.py"), str(take), str(raw), "--engine", "whisper"], capture_output=True, text=True)
        if r.returncode or not raw.exists():
            raise RuntimeError("the take did not transcribe")
        heard = [w for w in jload(raw) if w.get("type", "word") == "word" and _norm(w.get("text"))]
        if len(heard) < 3:
            raise RuntimeError("nothing was heard in the take")
        script = [(_norm(w), n) for n, (_, t, _) in enumerate(run) for w in words_in(t) if _norm(w)]
        sm = difflib.SequenceMatcher(None, [w for w, _ in script], [_norm(w["text"]) for w in heard], autojunk=False)
        first, last = {}, {}
        for a0, b0, size in sm.get_matching_blocks():
            for d in range(size):
                n = script[a0 + d][1]
                first.setdefault(n, heard[b0 + d]["start"])
                last[n] = heard[b0 + d]["end"]
        total = duration(take)
        # where each line begins: the quietest 20 ms between the last word heard of the line before and its own first word
        import numpy as np
        pcm = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(take), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout, np.int16).astype(np.float32)
        cuts = [0.0]
        for n in range(1, len(run)):
            lo = last.get(n - 1)
            hi = first.get(n)
            if lo is None or hi is None or hi <= lo:        # a line the transcription lost: by its share of the words
                share = sum(len(words_in(t)) for _, t, _ in run[:n]) / max(1, sum(len(words_in(t)) for _, t, _ in run))
                cuts.append(max(cuts[-1] + 0.3, share * total))
                continue
            a_, z_ = int(lo * 16000), max(int(lo * 16000) + 320, int(hi * 16000))
            seg = np.abs(pcm[a_:z_])
            win = np.convolve(seg, np.ones(320) / 320, mode="valid") if len(seg) > 320 else seg
            at = (a_ + int(np.argmin(win)) + 160) / 16000.0 if len(win) else (lo + hi) / 2
            cuts.append(max(cuts[-1] + 0.2, min(total - 0.1, at)))
        cuts.append(total)
        for n, (sid, _, _) in enumerate(run):
            fade = f"afade=t=in:st=0:d=0.008,afade=t=out:st={max(0.0, cuts[n + 1] - cuts[n] - 0.008):.3f}:d=0.008"    # 8 ms: no click, nothing heard
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{cuts[n]:.3f}", "-t", f"{cuts[n + 1] - cuts[n]:.3f}", "-i", str(take), "-af", fade,
                            "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(aud / f"vo-{sid}.wav")], check=True)
            (aud / f"vo-{sid}.txt").write_text("take", encoding="utf-8")
        raw.unlink(missing_ok=True)
    for sid, _, bite in lines:
        if bite:
            shutil.copy2(aud / f"bite-{sid}.wav", aud / f"vo-{sid}.wav")
    st.write_text(want, encoding="utf-8")
    return [duration(aud / f"vo-{i}.wav") for i, _, _ in lines]


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
    words = join_split(words)
    jsave(edit / "words.json", words)
    print(f"{len(words)} words in words.json" + ("" if b["text"] else " (text is off: used for the clips' timing only)"))
    return 0


def join_split(words):
    """The transcriber now and then hands a number or a hyphenated word over in pieces ("384", ",000"; "light",
    "-years"; "4", ".2"; "3", "%"): a piece that starts with such a mark goes back onto the word before it."""
    out = []
    for w in words:
        t = w["w"]
        piece = t == "%" or (len(t) > 1 and t[0] in "-'\u2019") or re.match(r"^[,.]\d", t)
        if out and piece and w["start"] - out[-1]["end"] < 0.6:
            prev = out[-1]["w"]
            if t[0] == "," and prev.endswith("."):          # "384." then ",000"
                prev = prev[:-1]
            out[-1] = {**out[-1], "w": prev + t, "end": w["end"]}
        else:
            out.append(dict(w))
    return out


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
BRIEF = BRIEF.replace("\n{start}Build:", "\n" + "@@CRAFT@@" + "{start}Build:")   # the craft note is filled in once CRAFT_NOTE exists (below)


# What a clip is built FROM, so it is not written from memory: the block library of the tool that renders it, and craft
# rules written by the people who make these tools (plugins/studio/craft, each with its own licence). No braces in it:
# it is placed in BRIEF before str.format runs.
CRAFT = Path(__file__).resolve().parents[3] / "craft"
HF = Path(os.environ.get("AI_EDITOR_HOME", "").strip() or Path.home() / ".ai-video-editor") / "motion" / "node_modules" / ".bin" / "hyperframes"
CRAFT_NOTE = f"""Start from proven work, not from a blank page:
- **A ready-made block first.** The renderer ships about 450 professional blocks as editable source. Search before
  authoring: `"{HF}" catalog "<what you need>" --json` (try: glass, liquid glass, exploded, chart, map,
  counter, lower third, highlight, light leak, caption). Install the nearest into a scratch folder with
  `"{HF}" add <name> --dir <scratch> --no-clipboard --json`, read its `compositions/<name>.html`, and take
  its structure, easing and layering into your `index.html` in this video's look. Never include a block unchanged:
  its colours and type become the video's.
- **The rules of the craft.** Read the ones this clip needs, then follow them:
  `{CRAFT / "animation-principles" / "SKILL.md"}` (easing, overlap, anticipation: read for every clip),
  `{CRAFT / "motion-art-direction" / "SKILL.md"}` and `{CRAFT / "shot-composition" / "SKILL.md"}` (what leads the eye),
  `{CRAFT / "gsap-timeline" / "SKILL.md"}` and `{CRAFT / "gsap-plugins" / "SKILL.md"}` (SplitText, DrawSVG, MorphSVG are free),
  `{CRAFT / "chart-animation" / "SKILL.md"}` and `{CRAFT / "animated-infographic" / "SKILL.md"}` (a chart or a diagram),
  `{CRAFT / "threejs-lighting" / "SKILL.md"}`, `{CRAFT / "threejs-materials" / "SKILL.md"}` and
  `{CRAFT / "threejs-postprocessing" / "SKILL.md"}` (anything in 3D).
- **What separates made from generated** (measured on films people made; read
  `{CRAFT / "motionmaxxing" / "references" / "slop.md"}` for the full table, `{CRAFT / "motionmaxxing" / "references" / "motion.md"}`
  for the numbers and `{CRAFT / "motionmaxxing" / "references" / "world.md"}` for the frame):
  an entry takes about 12 frames (0.4 s), not 20 to 30; it lands by slowing down (most of its travel in the first 4
  frames: `cubic-bezier(0.16,1,0.3,1)`) and leaves by speeding up; almost nothing fades in (things arrive by moving
  or being uncovered; opacity is a 4 to 6 frame helper); siblings start 1 to 3 frames apart, unevenly; one spring at
  most in a film. Frame 0 is already a finished picture. No run of more than 3 empty frames, no hold over 0.6 s
  without something alive. The subject fills 60 to 85% of the frame, one hero a frame, nothing within 60 px of the
  edge. Every frame is a world: a ground, a key and a rim light with a contact shadow, two or three depth planes,
  a texture. Never: a card on a flat colour, corner labels, "02 / TITLE" counters, a progress bar, a headline left
  and a device right. Words are held still while they are read (1 s, plus 0.25 s a word past three).
- **A runtime that keeps to those numbers.** `assets/motion.js` (needs only GSAP, already loaded) gives
  `Motion.film()` with the measured eases, `enter`, `exit`, `words`, `type` and `cut`; its notes are at the top of the
  file. Use it or plain GSAP, never both on one element.
- **One film.** The look is the video's own (given above, and in the film's direction when the brief names one): its
  ground, its type, its accent, its panels. Fill the frame: the subject large and lit, depth behind it, a camera that
  moves. Never thin lines alone on an empty dark frame, no gradient text, no drop-shadowed clip art.
- **Every element lands on its word.** Use `WORDS`: a number appears on the syllable that says it.

""".replace("{", "{{").replace("}", "}}")


BRIEF = BRIEF.replace("@@CRAFT@@", CRAFT_NOTE)


def motion_note(run, edit, key, dur):
    """The part of a brief that stops a scene being a slide: the events it must have, how it is measured, the rules page."""
    here = Path(__file__).resolve()
    ref = here.parents[2] / "long-video" / "references" / "motion.md"
    lv = here.parents[2] / "long-video" / "scripts" / "longvideo.py"
    lo, hi = max(2, round(dur / 3.0) + 1), max(3, round(dur / 1.6))
    return (f"- **This scene must move like a film, not a slide. Read `{ref}` before you write the timeline; it is short and it is the law here.**\n"
            f"  - First write the events as a comment at the top of the timeline: time, what happens, the spoken word it lands on (the words and their times are above). "
            f"This scene is {dur:.1f} s: {lo} to {hi} events, one at least every 2 to 3 s, the first inside 0.5 s. At t=0 only what the first words name is on screen; "
            "each further piece ARRIVES on the word that names it. Nothing sits finished while the voice is still explaining it.\n"
            "  - One camera on one wrapper, moving with intent from the first frame to the last and going to each new subject as it is named; three depth layers under it. "
            "What stays on screen is alive by what it does (filling, drawing, counting, flowing), never by breathing or floating. Swaps inside the scene are cut at speed, "
            "same direction, never crossfaded. Arrivals 0.35 to 0.6 s `power3.out` or `expo.out` on two or three properties; no bounce, no elastic, no overshoot on numbers.\n"
            f"  - After `check` passes, MEASURE it: `python3 \"{run}\" \"{lv}\" look \"{edit}\" --only {key}`. It must print `ok`: a median change of 2.0 a frame or more "
            "and no whole second under 1.0. A `FIX` names the quiet seconds: give them the next event, a camera arrival or a live inside (never grain, flicker or a wobble), "
            "then check and measure again. Do not hand the scene back while it prints `FIX`.\n")


def craft_ext_note():
    """One line for a brief when the wider craft library is on this computer (craftx.py setup), else nothing."""
    try:
        import craftx
        return craftx.note()
    except Exception:   # noqa: BLE001
        return ""


# braces are doubled: the note goes through str.format with the brief
THREE_NOTE = """
Real 3D is available for this clip: three.js is in `assets/three.module.js` (with `assets/three.core.js` beside it).
Use it when the scene is a thing in space (a globe, a product turning, bars or blocks with depth, a landscape, a
camera flying through); stay with HTML and SVG for flat diagrams. How it must be wired so every frame renders:
- a `<canvas>` the size of the frame inside `#scene`, and a `<script type="module">` after the main script that does
  `import * as THREE from "./assets/three.module.js"`;
- `new THREE.WebGLRenderer({{canvas, antialias: true, preserveDrawingBuffer: true}})`, lights, a camera;
- never `requestAnimationFrame`: one `draw()` that sets every position from a single progress value and renders,
  driven by the clip's own timeline: `tl.to(state, {{t: 1, duration: DURATION, ease: "none", onUpdate: draw}}, 0)`
  with `tl = window.__timelines["<this clip's id>"]`;
- call `draw()` once at the end of the module, with the scene already in its first state, so frame 0 is not empty.
Keep labels and numbers as HTML over the canvas (sharp type), moved by the same timeline.
"""


def three_assets(d):
    """three.js copied into a clip's assets when it is installed beside the motion tools; True when it is there."""
    use_editor()
    import motion
    b = motion.home() / "motion" / "node_modules" / "three" / "build"
    if not (b / "three.module.js").exists():
        return False
    for f in ("three.module.js", "three.core.js"):
        if (b / f).exists():
            shutil.copy(b / f, Path(d) / "assets" / f)
    return True


def cmd_three_setup():
    """three.js (MIT), once, beside the motion tools: real 3D for animated scenes."""
    use_editor()
    import motion
    d = motion.home() / "motion"
    if not (d / "node_modules" / "three" / "build" / "three.module.js").exists():
        subprocess.run(["npm", "i", "three", "--silent"], cwd=d, check=True)
    ok = (d / "node_modules" / "three" / "build" / "three.module.js").exists()
    print("three.js ready" if ok else "ERROR: three.js did not install")
    return 0 if ok else 1


# ---------------------------------------------------------------- the 3D kit: free textures, skies and models for worlds
THREE_RAW = "https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/"
KIT_FILES = {   # where it lands in the kit -> where it comes from. NASA imagery is public domain; Poly Haven is CC0.
    "textures/earth_day.jpg": THREE_RAW + "textures/planets/earth_atmos_2048.jpg",
    "textures/earth_night.png": THREE_RAW + "textures/planets/earth_lights_2048.png",
    "textures/earth_clouds.png": THREE_RAW + "textures/planets/earth_clouds_1024.png",
    "textures/earth_specular.jpg": THREE_RAW + "textures/planets/earth_specular_2048.jpg",
    "textures/earth_normal.jpg": THREE_RAW + "textures/planets/earth_normal_2048.jpg",
    "textures/moon.jpg": THREE_RAW + "textures/planets/moon_1024.jpg",
    "models/person.glb": THREE_RAW + "models/gltf/Xbot.glb",              # a neutral figure: idle, walk, run and more
    "models/soldier.glb": THREE_RAW + "models/gltf/Soldier.glb",          # idle, walk, run
    "models/robot.glb": THREE_RAW + "models/gltf/RobotExpressive/RobotExpressive.glb",   # CC0: walk, run, jump, wave, ...
}
KIT_SKIES = {"sky/day.hdr": "kloofendal_48d_partly_cloudy_puresky", "sky/sunset.hdr": "belfast_sunset_puresky"}
KIT_PBR = {"brick": "red_brick_03", "asphalt": "asphalt_02", "concrete": "brushed_concrete", "sand": "coast_sand_01", "rock": "aerial_rocks_02"}
KIT_JSM = ["loaders/GLTFLoader.js", "loaders/RGBELoader.js", "loaders/HDRLoader.js", "utils/BufferGeometryUtils.js", "utils/SkeletonUtils.js",
           "loaders/FBXLoader.js", "libs/fflate.module.js", "curves/NURBSCurve.js", "curves/NURBSUtils.js",   # FBX: what Mixamo exports
           "postprocessing/Pass.js", "objects/Reflector.js", "environments/RoomEnvironment.js"]   # for the finish: a pass base, a mirror floor, a studio light
# the finish that makes 3D read as produced, from npm in the motion folder: bloom, depth of field, vignette and grain in one
# pass (pmndrs/postprocessing, Zlib), contact shadows (n8ao, ISC), sharp 3D type (troika-three-text and what it needs, MIT)
KIT_VENDOR = {"postprocessing.js": "postprocessing/build/index.js", "n8ao.js": "n8ao/dist/N8AO.js",
              "troika-three-text.js": "troika-three-text/dist/troika-three-text.esm.js", "troika-three-utils.js": "troika-three-utils/dist/troika-three-utils.esm.js",
              "troika-worker-utils.js": "troika-worker-utils/dist/troika-worker-utils.esm.js", "webgl-sdf-generator.js": "webgl-sdf-generator/dist/webgl-sdf-generator.mjs",
              "bidi-js.js": "bidi-js/dist/bidi.mjs"}

def kit_dir():
    import os
    home = os.environ.get("AI_EDITOR_HOME", "").strip()
    return (Path(home) if home else Path.home() / ".ai-video-editor") / "kit3d"


def cmd_kit_setup():
    """The 3D kit, once (about 20 MB): photographic Earth and Moon textures, two skies, five surface materials (colour,
    normal, roughness), three animated figures and three.js's model loaders. Everything is public domain, CC0 or MIT
    except the two Mixamo figures (free to use in your own videos, not to pass on as files)."""
    use_editor()
    import motion
    from ai_editor import net
    k = kit_dir()
    todo = dict(KIT_FILES)
    for dest, pid in KIT_SKIES.items():
        todo[dest] = f"https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/{pid}_1k.hdr"
    for name, pid in KIT_PBR.items():
        for part, suf in (("diff", "diff"), ("nor", "nor_gl"), ("rough", "rough")):
            todo[f"pbr/{name}_{part}.jpg"] = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{pid}/{pid}_{suf}_1k.jpg"
    bad = []
    for dest, url in todo.items():
        f = k / dest
        if f.is_file() and f.stat().st_size > 1000:
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        try:
            net.retrieve(url, f.with_suffix(f.suffix + ".part"), 180)
            f.with_suffix(f.suffix + ".part").rename(f)
        except Exception as e:   # noqa: BLE001
            bad.append(f"{dest} ({type(e).__name__})")
    jsm = motion.home() / "motion" / "node_modules" / "three" / "examples" / "jsm"
    for rel in KIT_JSM:
        if (jsm / rel).is_file():
            (k / "jsm" / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(jsm / rel, k / "jsm" / rel)
        else:
            bad.append(f"jsm/{rel} (three.js is not installed: studio.py three-setup)")
    nm = motion.home() / "motion" / "node_modules"
    if not (nm / "postprocessing").is_dir():        # the finishing libraries, once (about 5 MB)
        subprocess.run(["npm", "install", "--no-audit", "--no-fund", "postprocessing", "n8ao", "troika-three-text"], cwd=nm.parent, capture_output=True)
    for name, rel in KIT_VENDOR.items():
        if (nm / rel).is_file():
            (k / "vendor").mkdir(exist_ok=True)
            shutil.copy(nm / rel, k / "vendor" / name)
        else:
            bad.append(f"vendor/{name} (npm install postprocessing n8ao troika-three-text in {nm.parent})")
    jsave(k / "kit.json", {"files": sorted(str(f.relative_to(k)) for f in k.rglob("*") if f.is_file() and f.name != "kit.json")})
    print(f"kit3d: {sum(f.stat().st_size for f in k.rglob('*') if f.is_file()) / 1e6:.0f} MB in {k}" + (f"; MISSING {', '.join(bad)}" if bad else ""))
    return max(1 if bad else 0, lib3d.setup(k))   # the shared library's characters come with the kit


def kit_into(d):
    """The kit linked into a clip's assets as assets/kit (a symlink: 20 MB is not copied per clip). True when it is there."""
    k = kit_dir()
    if not (k / "kit.json").is_file():
        return False
    link = Path(d) / "assets" / "kit"
    if not link.exists():
        try:
            link.symlink_to(k, target_is_directory=True)
        except OSError:
            shutil.copytree(k, link)
    return True


IMPORTMAP = ('<script type="importmap">{"imports":{"three":"./assets/three.module.js","three/addons/":"./assets/kit/jsm/",'
             '"three/examples/jsm/":"./assets/kit/jsm/","postprocessing":"./assets/kit/vendor/postprocessing.js","n8ao":"./assets/kit/vendor/n8ao.js",'
             '"troika-three-text":"./assets/kit/vendor/troika-three-text.js","troika-three-utils":"./assets/kit/vendor/troika-three-utils.js",'
             '"troika-worker-utils":"./assets/kit/vendor/troika-worker-utils.js","webgl-sdf-generator":"./assets/kit/vendor/webgl-sdf-generator.js",'
             '"bidi-js":"./assets/kit/vendor/bidi-js.js"}}</script>')


def scaffold3d(d, edit):
    """A clip folder made ready for a world: three.js and the kit in its assets, the video's worlds linked in as
    assets/worlds, and the import map in its index.html. True when three.js and the kit are both installed."""
    d, edit = Path(d), Path(edit)
    ok = three_assets(d) and kit_into(d)
    lib3d.link_into(d)
    (edit / "worlds").mkdir(exist_ok=True)
    link = d / "assets" / "worlds"
    if not link.exists():
        try:
            link.symlink_to((edit / "worlds").resolve(), target_is_directory=True)
        except OSError:
            pass
    f = d / "index.html"
    if f.exists():
        h = f.read_text(encoding="utf-8")
        if "importmap" not in h and '<script src="assets/gsap.min.js"></script>' in h:
            f.write_text(h.replace('<script src="assets/gsap.min.js"></script>', IMPORTMAP + '\n    <script src="assets/gsap.min.js"></script>', 1), encoding="utf-8")
    return ok


def hud_note(sc, scene, prev):
    """The data display a 3D video carries in the same corners throughout, and this scene's values for it."""
    hud = sc.get("hud") or {}
    if not hud:
        return ""
    out = ["- The video's data display, the same in every scene (HTML over the canvas, updated in draw()): a dark translucent",
           "  card 56 px from the top and from each side, a small spaced capital label over a heavy 58 px number with its unit small."]
    for side in ("left", "right"):
        h = hud.get(side)
        if h:
            a, z = (prev.get("hud_values") or {}).get(side), (scene.get("hud_values") or {}).get(side)
            out.append(f"  {side}: \"{h.get('label', '')}\" in {h.get('unit', '')}" + (f", running from {a} to {z} over this scene" if z is not None and a is not None
                       else f", ending this scene at {z}" if z is not None else ""))
    return "\n".join(out) + "\n"


WORLD_NOTE = """
This video is 3D and made of a few worlds. Read `{ref}` first: the kit, how a world must be wired, the module contract.
- This scene is one shot in the world `{wid}` ({wdesc})
  The world is already built: `import {{ createWorld }} from "./assets/worlds/{wid}.js"`. Read that file's first
  comment for what it exposes. Do not rebuild or restyle it: set this shot's camera and action only, then render.
- Three.js is `import * as THREE from "three"`; loaders are `three/addons/...`; the kit is at `./assets/kit/`.
{hud}"""


WORLD_BRIEF = """# World {wid} (a 3D world for the video "{title}")

Read `{ref}` first (the kit, how a world must be wired, the module contract), then the example nearest to this world
in `{examples}`.

Build `{js}`: the module that exports `async function createWorld({{THREE, canvas, K, loaders}})`. It is built once and
used by {n} shots of the video, each with its own camera, so it must hold up from close and from far, and from every
side a camera may reasonably be.

The world: {wdesc}
What the video is about: "{prompt}"
The shots that will use it (their cameras and actions; the world must make each of these possible):
{shots}

What makes it look produced and not generated, in order: real surfaces from the kit on everything large; a sky that
lights the scene; shadows; depth (haze or fall-off into the distance); detail in the mid-ground (windows, lamps, cars,
kerbs, craters, clouds); one figure with a believable gait if the world has a person; nothing floating, nothing
intersecting. The look is realistic, not a diagram. Light it so the subject reads: a night side or deep space still
needs a rim light or glow, never a frame that is mostly black.
{start}
The shared library is at `./assets/lib/` in every clip (`../lib/` from this module). Use it, do not write your own:
- A person: `import {{ loadFigure }} from "../lib/figure.js"`, then
  `const sam = await loadFigure({{THREE, id: "woman", clips: ["idle", "walk", "run"]}})`; `scene.add(sam.object)`; in
  `update`, `sam.pose(seconds, {{walk: 0.3, run: 0.7}})`. Characters: {chars}.
  Do not fix who it is: `createWorld({{..., cast = ["woman"]}})` loads the characters named in `cast` and exposes them as
  `world.cast.<id>` (each a loadFigure result), so another video can walk someone else through the same place.
  `update(state)` places and poses them from `state.people = {{<id>: {{x, z, heading, time, gait: {{walk, run}}}}}}`.
  `cast` entries may also be `{{id, outfit: {{shirt: "#2f6fdd", trousers: "#3b4a6b"}}, as: "sam"}}` (man and woman only):
  pass `outfit` on to loadFigure, so one body gives differently dressed people, and expose that one as `world.cast.<as>`.
  Another movement (a dance, a crouch, a jump): `{lib} clip <id> "<what>"`, then name it in `clips`.
- A thing the world needs (a bench, a tree, a rock, a sofa): `{lib} prop "<what>"` lists free models, `{lib} prop-get <id>`
  puts the right one in the library, then `import {{ loadProp }} from "../lib/figure.js"` and `await loadProp({{THREE, id}})`. In it already: {props}.
  When nothing matches, build it from shapes and the kit's surfaces.

Then prove it in the demo clip `{demo}`: its `index.html` imports the world and, over {dur} s, moves the camera
through three framings the shots above need (a wide establishing view, a medium one, a close one on the action).
Check it: `{env}python3 "{run}" "{motion}" check "{demo}"`. Look at `renders/sheet.png` after every render and fix
what looks wrong (an empty frame, a figure sliding, a texture stretched, a camera inside a wall). The `motion` gate's
"frame 0 flash" means the first frame was drawn before the world loaded: make the canvas black until `draw()` has run.
At most 5 checks. Then report `{{"world": "{wid}", "pass": true|false, "what": "<what is in it and what it exposes>",
"failing": [...]}}`.
"""


def save_worlds(edit, sc):
    """Every world this video built (or extended) goes into the shared library, so the next video starts with it."""
    saved = []
    for wd in sc.get("worlds") or []:
        js = Path(edit) / "worlds" / f"{wd.get('id')}.js"
        if js.is_file() and (not wd.get("library") or wd.get("extend")):
            sheet = Path(edit) / "worlds" / f"demo-{wd['id']}" / "renders" / "sheet.png"
            describe = (wd.get("describe") or "") + ((" Also: " + wd["extend"]) if wd.get("extend") else "")
            saved.append(lib3d.save_world(js, describe, name=wd.get("name") or wd["id"], sheet=sheet, video=sc.get("title") or "",
                                          replace=wd["library"] if wd.get("library") and wd.get("update") else None))   # "update": the library's own copy is improved
    if saved:
        print("library: kept " + ", ".join(saved))
    return saved


def cmd_lib(args):
    """studio.py lib setup | list | find "<place>" | prop "<thing>" | prop-get <id> | clip <character> "<movement>" | save EDIT | character <id> <body> name=file ..."""
    use_editor()
    what, rest = (args[0] if args else "list"), args[1:]
    if what == "setup":
        return lib3d.setup(kit_dir())
    if what == "list":
        print(lib3d.listing())
    elif what == "find" and rest:
        hits = lib3d.find(" ".join(rest))
        print("\n".join(f"{h[0]:.2f}  {h[1]:<20} {h[2][:140]}" for h in hits) or "nothing in the library is this place: write it as a new world")
    elif what == "prop" and rest:      # the free models that match, to choose from
        hits = lib3d.prop_matches(" ".join(rest))
        print("\n".join(f"{h[1]:<28} {h[2]}" for h in hits) or "no free model matches: build it from shapes and the kit's surfaces")
        if hits:
            print("Take the one that is the thing meant: studio.py lib prop-get <id>")
    elif what == "prop-get" and rest:
        return 0 if lib3d.add_prop(rest[0]) else 1
    elif what == "clip" and len(rest) >= 2:
        lib3d.add_clip(rest[0], " ".join(rest[1:]))
    elif what == "save" and rest:
        save_worlds(Path(rest[0]).resolve(), jload(Path(rest[0]).resolve() / "scenes.json") or {})
    elif what == "character" and len(rest) >= 2:
        lib3d.add_character(rest[0], rest[1], dict(x.split("=", 1) for x in rest[2:] if "=" in x))
    else:
        sys.exit("ERROR: " + cmd_lib.__doc__)
    return 0


def cmd_worlds(edit):
    """EDIT/worlds/: for each world of a 3D video, its brief (<id>.md) and a demo clip (demo-<id>/) to prove it in.
    One agent per world builds <id>.js; every scene's clip then imports that module."""
    edit = Path(edit).resolve()
    root = use_editor()
    import motion
    sc, b = jload(edit / "scenes.json"), brief_of(edit)
    worlds = sc.get("worlds") or []
    if not worlds:
        print("0 worlds: scenes.json has no \"worlds\"")
        return 0
    ok, why = motion.ensure_tools()
    if not ok:
        sys.exit("ERROR: the motion tools are missing: " + str(why))
    look, (w, h) = look_of(sc), size_of(edit)
    gsap = motion.home() / "motion" / "node_modules" / "gsap" / "dist" / "gsap.min.js"
    ref = Path(__file__).resolve().parents[1] / "references" / "worlds.md"
    (edit / "worlds").mkdir(exist_ok=True)
    missing, reused = False, 0
    for wd in worlds:
        wid = str(wd.get("id") or "")
        if not re.fullmatch(r"[a-z0-9-]{1,24}", wid):
            sys.exit(f"ERROR: a world's id is 1-24 of a-z, 0-9 and -: {wid!r}")
        lib_from = False
        if wd.get("library"):          # a world the library already has: copied in, nothing to build
            lib_from = lib3d.use_world(str(wd["library"]), edit / "worlds" / f"{wid}.js") if not (edit / "worlds" / f"{wid}.js").exists() else True
            if not lib_from:
                print(f"{wid:<16} NOTE: the library has no world \"{wd['library']}\": it will be built new")
            elif not wd.get("extend"):
                (edit / "worlds" / f"{wid}.md").unlink(missing_ok=True)
                print(f"{wid:<16} from the library ({wd['library']}): nothing to build")
                reused += 1
                continue
        else:
            near = lib3d.find(wd.get("describe") or "")
            if near and not (edit / "worlds" / f"{wid}.js").exists():
                print(f"{wid:<16} NOTE: the library has a world that may be this place: " + "; ".join(f"{x[1]} ({x[2][:70]})" for x in near[:2]) +
                      f". To reuse it, add \"library\": \"{near[0][1]}\" to this world in scenes.json and run worlds again.")
        demo = edit / "worlds" / f"demo-{wid}"
        (demo / "assets").mkdir(parents=True, exist_ok=True)
        beat = {"id": f"demo-{wid}", "type": "scene", "props": {}, "start": 0, "dur": 6.0, "clock": "video", "size": [w, h], "words": [],
                "line": "", "before": "", "after": ""}
        if not (demo / "index.html").exists():
            (demo / "index.html").write_text(motion.fill_template(beat, look), encoding="utf-8")
        shutil.copy(root / "skills" / "motion" / "template" / "hyperframes.json", demo / "hyperframes.json")
        if gsap.exists():
            shutil.copy(gsap, demo / "assets" / "gsap.min.js")
        jsave(demo / "beat.json", beat)
        missing = not scaffold3d(demo, edit) or missing
        shots = [f"  - {s['id']}: {s.get('visual', '')}" for s in sc["scenes"] if s.get("world") == wid]
        (edit / "worlds" / f"{wid}.md").write_text(WORLD_BRIEF.format(
            wid=wid, title=sc.get("title") or "", ref=ref, examples=ref.parents[1] / "worlds", js=edit / "worlds" / f"{wid}.js", n=len(shots),
            wdesc=wd.get("describe") or "", prompt=b.get("prompt") or "", shots="\n".join(shots) or "  (none yet)", demo=demo, dur=6,
            env=f'AI_EDITOR_HOME="{os.environ["AI_EDITOR_HOME"]}" ' if os.environ.get("AI_EDITOR_HOME") else "",
            run=root / "lib" / "ai_editor" / "run.py", motion=root / "skills" / "motion" / "scripts" / "motion.py",
            start=(f"It is already in the library and copied to `{edit / 'worlds' / (wid + '.js')}`. Keep everything it does and add: "
                   f"{wd['extend']}") if lib_from and wd.get("extend") else "",
            chars="; ".join(f"`{c['id']}` ({c.get('describe', '')} clips: {', '.join(c.get('clips') or [])})" for c in lib3d.characters()) or "none (studio.py kit-setup)",
            props=", ".join(f"`{x['id']}`" for x in lib3d.props()) or "nothing yet",
            lib=f'python3 "{Path(__file__).resolve()}" lib'), encoding="utf-8")
        print(f"{wid:<16} {len(shots):3d} shots  {edit / 'worlds' / (wid + '.md')}")
    if missing:
        print("NOTE: three.js or the 3D kit is not installed: studio.py three-setup, then studio.py kit-setup, then worlds again")
    print(f"{len(worlds) - reused} world brief(s), {reused} world(s) from the library. One ai-editor:clip-builder agent per brief, all in one message; build the scenes only after they pass.")
    return 0


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
    save_worlds(edit, sc)
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
        if (CRAFT / "motionmaxxing" / "runtime" / "motion.js").is_file():     # the measured-ease runtime (craft/motionmaxxing, Apache-2.0)
            shutil.copy(CRAFT / "motionmaxxing" / "runtime" / "motion.js", d / "assets" / "motion.js")
        jsave(d / "beat.json", beat)
        three = THREE_NOTE if three_assets(d) else ""
        if sc.get("style3d") and s.get("world"):       # a shot in one of the video's worlds
            scaffold3d(d, edit)
            wd = next((x for x in sc.get("worlds") or [] if x.get("id") == s["world"]), {})
            three = WORLD_NOTE.format(ref=Path(__file__).resolve().parents[1] / "references" / "worlds.md", wid=s["world"],
                                      wdesc=str(wd.get("describe") or "")[:400],
                                      hud=hud_note(sc, s, scenes[rows[k - 1]["id"]] if k else {})).replace("{", "{{").replace("}", "}}")
        (d / "brief.md").write_text(three.join(BRIEF.split("\n{start}Build:", 1)[:1] + ["\n{start}Build:" + BRIEF.split("\n{start}Build:", 1)[1]]).format(
            id=r["id"], card=root / "skills" / "motion" / "references" / "clip-brief-card.md", dir=d, w=w, h=h, dur=beat["dur"],
            title=sc.get("title") or "", prompt=b.get("prompt") or "", look=json.dumps(look), visual=s.get("visual", ""),
            say=beat["line"], before=beat["before"], after=beat["after"], words=json.dumps(beat["words"]),
            n=k + 1, total=len(rows), first=" The first scene: it hooks in the first second." if k == 0 else "",
            last=" The last scene: it lands the idea and holds its final state." if k + 1 == len(rows) else "",
            start=motion_note(root / "lib" / "ai_editor" / "run.py", edit, r["id"], beat["dur"]) + craft_ext_note() + "- Notes on this clip, if any: `notes.md` beside this brief. Do what they say.\n\n",
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
        real = next((x for x in (edit / "audio" / f"music.{e}" for e in ("mp3", "wav", "m4a")) if x.is_file()), None)
        if real:                # a recorded track chosen for this video (longvideo.py music EDIT --use "<title>"): past its intro, looped, levelled
            x = sound.read_audio(real)
            x = x[:, min(x.shape[1] // 6, 4 * sound.SR):]
            while x.shape[1] < n:
                x = np.concatenate([x, x], axis=1)
            x = x[:, :n] * (0.05 / (float(np.sqrt((x[:, :n] ** 2).mean())) or 1.0))
            f_ = int(1.5 * sound.SR)
            x[:, :f_] *= np.linspace(0, 1, f_)
            x[:, -f_:] *= np.linspace(1, 0, f_)
            bed = x * ((0.6 / 0.11) if tm["engine"] != "none" else 4.8)     # under a voice it lands where long videos keep it; alone, full
        bed = np.pad(bed, ((0, 0), (0, max(0, n - bed.shape[1]))))[:, :n] * (0.11 if tm["engine"] != "none" else 0.5)   # a quiet bed under a voice (measured: 0.5 buried it); full when the music is all there is
    mix, v, dg = bed, None, np.ones(n)
    if vo:
        v = sound.read_audio(vo, tm["length"] + 0.05)[:, :n]
        # one steady level under the whole narration. It used to dip under every sentence and come back in every pause, which
        # the user heard as the music starting and dropping with each clip
        dg = np.full(n, 10 ** (-9 / 20)) if b["music"] else dg
        k = min(n // 2, int(1.5 * sound.SR))
        if b["music"] and k > 0:
            dg[:k] = np.linspace(1.0, dg[0], k)             # it opens at its own level, then settles under the first words
        mix = bed * dg + v
    lufs, tp = sound.master(mix, out)
    write_stems(edit, tm, sound, mix, bed if b["music"] else None, v, [], dg)
    print(json.dumps({"file": str(out), "lufs": lufs, "true_peak": tp, "mood": mood if b["music"] else None,
                      "music": b["music"], "voice": bool(vo)}))
    return 0


# ---------------------------------------------------------------- the sound as layers
def write_stems(edit, tm, sound, mix, bed, v, landed, dg):
    """The same sound as separate pieces, so one can be changed without the others: each narration line, the music, each
    effect (audio/stems/, listed in audio/stems.json). Together they are the mix: the same levels, the same ducking."""
    import numpy as np
    sr, n = sound.SR, mix.shape[1]
    d = edit / "audio" / "stems"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    done = sound.read_audio(edit / "audio" / "mix.wav", tm["length"] + 0.05)[:, :n]
    g = float(np.sqrt((done ** 2).mean()) / max(1e-9, np.sqrt((mix ** 2).mean())))       # the gain the master gave the whole mix (its limiter shifts it in time, so by level)
    out = {"gain": round(g, 4), "voice": [], "music": None, "fx": []}
    soft = lambda x: np.where(np.abs(x) > 0.6, np.sign(x) * (0.6 + 0.15 * np.tanh((np.abs(x) - 0.6) / 0.15)), x)   # noqa: E731  (the master's limiter is not on a single piece: its peaks are rounded off under -1 dB)
    if v is not None:
        rows = tm["scenes"]
        for i, r in enumerate(rows):                     # cut where each line begins, so nothing between two lines is lost
            a = 0 if i == 0 else int(r["start"] * sr)
            z = n if i == len(rows) - 1 else int(rows[i + 1]["start"] * sr)
            if z - a < sr // 10 or float(np.abs(v[:, a:z]).max()) < 1e-4:
                continue
            f = d / f"voice-{i + 1:02d}-{r['id']}.wav"
            tmp = d / "piece.wav"
            sound.write_wav(tmp, v[:, a:z])        # as recorded; the level and the ceiling are given by a look-ahead limiter, as the master does it
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af", f"volume={g:.4f},alimiter=limit=0.78:attack=3:release=80:level=false",
                            "-ar", str(sr), "-c:a", "pcm_s16le", str(f)], check=True)
            tmp.unlink()
            out["voice"].append({"id": r["id"], "file": f"audio/stems/{f.name}", "at": round(a / sr, 3), "dur": round((z - a) / sr, 3)})
    if v is not None and float(np.abs(v).max()) > 1e-4:
        # the narration whole, as ONE piece. Measured: the editor played 13 line-by-line pieces with a small gap at every
        # join, and the voice sounded cut; a video whose voice was one file played smoothly. The pieces stay on disk for
        # re-voicing one line; the timeline carries the whole take.
        tmp = d / "whole.wav"
        sound.write_wav(tmp, v)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af", f"volume={g:.4f},alimiter=limit=0.78:attack=3:release=80:level=false",
                        "-ar", str(sr), "-c:a", "pcm_s16le", str(d / "narration.wav")], check=True)
        tmp.unlink()
        out["narration"] = {"file": "audio/stems/narration.wav", "at": 0, "dur": round(n / sr, 3)}
    if bed is not None and float(np.abs(bed).max()) > 1e-5:
        sound.write_wav(d / "music.wav", bed * dg * g)
        out["music"] = {"file": "audio/stems/music.wav", "at": 0, "dur": round(n / sr, 3)}
    for k, (kind, x, at, gain) in enumerate(landed, 1):
        x = np.stack([x, x]) if x.ndim == 1 else x
        a = int(round(at * sr))
        if a >= n or a + x.shape[1] <= 0:
            continue
        x, a = (x[:, -a:], 0) if a < 0 else (x, a)
        x = x[:, :n - a] * gain * dg[a:a + x.shape[1]][: x.shape[1]] * g
        f = d / f"fx-{k:02d}-{kind}.wav"
        sound.write_wav(f, x)
        out["fx"].append({"kind": kind, "file": f"audio/stems/{f.name}", "at": round(a / sr, 3), "dur": round(x.shape[1] / sr, 3)})
    jsave(edit / "audio" / "stems.json", out)
    return out


def add_sound(S, edit, tm, scenes=None):
    """The sound on the timeline: Narration, Music and Sound effects as their own tracks when the stems are there and
    as new as the mix, else the mix as one piece."""
    mixf, st = edit / "audio" / "mix.wav", jload(edit / "audio" / "stems.json", None)
    if not mixf.exists():
        return 0
    ok = isinstance(st, dict) and (edit / "audio" / "stems.json").stat().st_mtime >= mixf.stat().st_mtime - 2 and all(
        (edit / x["file"]).exists() for x in (st.get("voice") or []) + (st.get("fx") or []) + ([st["music"]] if st.get("music") else []))
    if not ok:
        S.audio("audio/mix.wav", 0, tm["length"], track="Sound")
        return 1
    say = {str(x.get("id")): " ".join(str(x.get("say") or "").split()[:6]) for x in (scenes or []) if isinstance(x, dict)}
    if st.get("narration") and (edit / st["narration"]["file"]).exists():
        S.audio(st["narration"]["file"], 0, st["narration"]["dur"], track="Narration", name="Narration")
    else:
        for x in st.get("voice") or []:
            S.audio(x["file"], x["at"], x["at"] + x["dur"], track="Narration", name=("Narration: " + say.get(str(x["id"]), str(x["id"])))[:60])
    if st.get("music"):
        S.audio(st["music"]["file"], 0, st["music"]["dur"], track="Music", name="Music")
    for x in st.get("fx") or []:
        S.audio(x["file"], x["at"], x["at"] + x["dur"], track="Sound effects", name=str(x["kind"]).title())
    return len(st.get("voice") or []) + len(st.get("fx") or []) + bool(st.get("music"))


# ---------------------------------------------------------------- the scene, render, stills
CAPTION_STYLE = {"y_pct": 72, "size_pct": 5.6, "case": "sentence", "effect": "pop", "stroke": True}
# a 3D video: the picture is the subject, so the words sit small at the bottom and light up as they are said
# a tall 3D video (a Short): measured on published ones, three or four words in capitals a little below the middle, the said word lit
CAPTION_3D_TALL = {"y_pct": 61, "size_pct": 4.6, "case": "upper", "effect": "karaoke", "weight": 800, "stroke": True, "words_per_caption": 3, "inactive_opacity": 0.55}
CAPTION_3D = {"y_pct": 91, "size_pct": 2.9, "case": "sentence", "effect": "karaoke", "weight": 600, "stroke": True, "inactive_opacity": 0.5}


FILM_DISSOLVE_S = 0.3     # how long one generated scene takes to melt into the next inside the film


def film_of(edit, parts, w, h, dissolve=FILM_DISSOLVE_S, name="film.mp4"):
    """The generated picture as ONE file: every scene's clip in order, each melting into the next (its last frame is
    held under the dissolve, so nothing moves off its words). parts: [(file, seconds)]. The user's words for why
    (November 2026): "when you're generating, it needs to generate a single file", with only what is added on top
    (captions, graphics, voice, music) as its own layer. Returns the file, or None when it could not be made."""
    import hashlib
    edit = Path(edit)
    out = edit / name
    parts = [(Path(f), float(d)) for f, d in parts if d > 0.05]
    if not parts:
        return None
    key = hashlib.sha256(json.dumps([[str(f), f.stat().st_mtime_ns, round(d, 3)] for f, d in parts] + [w, h, dissolve]).encode()).hexdigest()[:16]
    st = out.with_suffix(".stamp")
    if out.is_file() and st.is_file() and st.read_text(encoding="utf-8") == key:
        return out
    D = dissolve if len(parts) > 1 and all(d > dissolve * 3 for _, d in parts) else 0.0
    ins, filt, total = [], [], sum(d for _, d in parts)
    for i, (f, d) in enumerate(parts):
        ins += ["-i", str(f)]
        hold = D if i < len(parts) - 1 else 0.0
        filt.append(f"[{i}:v]trim=0:{d:.3f},setpts=PTS-STARTPTS,fps={FPS},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,"
                    f"tpad=stop_mode=clone:stop_duration={hold + 0.2:.3f},trim=0:{d + hold:.3f},setpts=PTS-STARTPTS,format=yuv420p[v{i}]")
    if D:
        last, at = "v0", 0.0
        for i in range(1, len(parts)):
            at += parts[i - 1][1]
            filt.append(f"[{last}][v{i}]xfade=transition=fade:duration={D:.3f}:offset={at:.3f}[x{i}]")
            last = f"x{i}"
    else:
        filt.append("".join(f"[v{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0[x]")
        last = "x"
    script = edit / "film.filter"
    script.write_text(";\n".join(filt), encoding="utf-8")
    tmp = out.with_name(out.stem + ".part.mp4")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *ins, "-/filter_complex", str(script), "-map", f"[{last}]", "-t", f"{total:.3f}", "-an",
                        "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp)], capture_output=True, text=True)
    script.unlink(missing_ok=True)
    if r.returncode or not tmp.is_file():
        tmp.unlink(missing_ok=True)
        print("note: the scenes could not be joined into one film (" + (r.stderr.strip().splitlines() or ["ffmpeg failed"])[-1][:140] + "); they stay as clips")
        return None
    tmp.replace(out)
    st.write_text(key, encoding="utf-8")
    return out


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
    fell, dark, parts = [], [], []
    for r in tm["scenes"]:
        f = clip_of(edit, r["id"])
        if not f:
            f, _ = fallback_clip(edit, r, look), fell.append(r["id"])
        elif sc.get("style3d"):
            y = luma_of(f)
            if y is not None and y < DARK_LUMA:
                dark.append(f"{r['id']} ({y:.0f})")
        parts.append((f, r["dur"]))
    film = film_of(edit, parts, w, h)       # the picture is one continuous file; the scenes' own clips stay on disk to remake one
    if film:
        S.video(film.name, 0, tm["length"], track="Film", volume=0, name="Film")
    else:
        for (f, _), r in zip(parts, tm["scenes"]):
            S.video(str(f.relative_to(edit)), r["start"], r["start"] + r["dur"], track="Scenes", volume=0)
    if b["text"] and words:   # one captions item per scene: a caption page never runs across a cut
        style = {**((CAPTION_3D_TALL if h > w else CAPTION_3D) if sc.get("style3d") else CAPTION_STYLE), **(sc.get("captions") or {})}
        for r in tm["scenes"]:
            mine = [{"w": x["w"], "start": x["start"], "end": x["end"]} for x in words
                    if r["start"] <= x["start"] < r["start"] + r["dur"]]
            if mine:
                S.captions(mine, style=style, start=r["start"], end=r["start"] + r["dur"], track="Captions")
    add_sound(S, edit, tm, jload(edit / "scenes.json")["scenes"])
    S.sc["duration"] = tm["length"]
    jsave(edit / SCENE_FILE, S.done())
    print(f"{SCENE_FILE}: {len(tm['scenes'])} scenes, {tm['length']:.1f} s" + (f", captions {len(words)} words" if b["text"] and words else "") +
          (", sound" if (edit / "audio" / "mix.wav").exists() else ", silent"))
    if fell:
        print("FELL BACK (no passed clip, a plain moving ground instead): " + ", ".join(fell))
    if dark:
        print(f"DARK (reads as nearly black; brightness out of 255, under {DARK_LUMA}): " + ", ".join(dark) +
              ". Send each scene's agent a note to light the subject (a rim light, a brighter key, a closer camera), then build again.")
    return 0


def cmd_render(edit, draft=False, uhd=False):
    """--4k (or "quality": "4k" in the brief): every frame drawn at twice the size, 3840 x 2160 for a wide video. Type and
    graphics are sharp at that size; footage is as sharp as what was found. About four times as long to render."""
    edit = Path(edit).resolve()
    use_editor()
    import scene
    if not (edit / SCENE_FILE).exists():
        sys.exit("ERROR: run studio.py build first.")
    if (uhd or str(brief_of(edit).get("quality") or "").lower() == "4k") and not draft:
        os.environ["FW_SCALE"] = "2"
        print("4K: rendering at twice the size. This takes about four times as long as 1080p.")
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
    jw = join_split([{"w": "384", "start": 0, "end": .3}, {"w": ",000", "start": .3, "end": .6}, {"w": "light", "start": 1, "end": 1.2},
                     {"w": "-years", "start": 1.2, "end": 1.5}, {"w": "3", "start": 2, "end": 2.1}, {"w": "%", "start": 2.1, "end": 2.2},
                     {"w": "-", "start": 5, "end": 5.1}, {"w": ".", "start": 9, "end": 9.1}, {"w": "12.", "start": 10, "end": 10.2},
                     {"w": ",700", "start": 10.2, "end": 10.5}])
    assert [x["w"] for x in jw] == ["384,000", "light-years", "3%", "-", ".", "12,700"] and jw[0]["end"] == .6, jw
    # fit: slow the voice first (never under 80%), then the same air after every line, capped
    assert fit_plan(30.0, 8, 48.0) == (0.8, round((48 - 0.15 - 37.5 - 8 * 0.35) / 8, 3)), fit_plan(30.0, 8, 48.0)
    assert fit_plan(41.0, 8, 48.0)[0] == 1.0 and fit_plan(10.0, 4, 60.0) == (0.8, MAX_AIR_S)
    assert fit_plan(30.0, 8, 0) == (1.0, 0.0) and fit_plan(60.0, 8, 48.0) == (1.0, 0.0)
    # make one like this: music under the voice, its hook
    ws = [{"text": "Did", "start": 0.0, "end": 0.3}, {"text": "you", "start": 0.3, "end": 0.5}, {"text": "know?", "start": 0.5, "end": 0.9},
          {"text": "Bees", "start": 3.0, "end": 3.4}]
    loud_gaps = [-20.0 if i < 10 or 30 <= i < 35 else -28.0 for i in range(60)]
    quiet_gaps = [-20.0 if i < 10 or 30 <= i < 35 else -70.0 for i in range(60)]
    assert music_under(loud_gaps, ws) is True and music_under(quiet_gaps, ws) is False
    assert music_under(loud_gaps[:12], ws) is None and music_under(loud_gaps, []) is None
    assert hook_of(ws) == "Did you know?" and hook_of([]) == ""
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
    assert lib3d.demo() == 0
    print("studio demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("root")
    sub.add_parser("demo")
    sub.add_parser("kokoro-setup")
    sub.add_parser("pocket-setup")
    sub.add_parser("three-setup")
    sub.add_parser("kit-setup")
    sub.add_parser("lib").add_argument("args", nargs="*")
    pv = sub.add_parser("preview")
    pv.add_argument("--engine", default="kokoro")
    pv.add_argument("--voice", required=True)
    pv.add_argument("--out", required=True)
    for name in ("check-scenes", "words", "briefs", "build", "stills", "worlds"):
        sub.add_parser(name).add_argument("edit")
    v = sub.add_parser("voice")
    v.add_argument("edit")
    v.add_argument("--engine", default="auto", choices=("auto", "eleven", "edge", "kokoro", "mac", "none"))
    v.add_argument("--voice")
    v.add_argument("--fit", type=float, help="seconds to reach: the voice slows a little, then each line gets air")
    m = sub.add_parser("music")
    m.add_argument("edit")
    m.add_argument("--mood", default="linear")
    lk = sub.add_parser("like")
    lk.add_argument("edit")
    lk.add_argument("src")
    lk.add_argument("--cookies-from-browser")
    r = sub.add_parser("render")
    r.add_argument("edit")
    r.add_argument("--draft", action="store_true")
    r.add_argument("--4k", dest="uhd", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "root":
        print(editor_root())
        return 0
    if a.cmd == "demo":
        return demo()
    if a.cmd == "like":
        return cmd_like(a.edit, a.src, a.cookies_from_browser)
    if a.cmd == "kokoro-setup":
        return cmd_kokoro_setup()
    if a.cmd == "pocket-setup":
        return cmd_pocket_setup()
    if a.cmd == "three-setup":
        return cmd_three_setup()
    if a.cmd == "kit-setup":
        return cmd_kit_setup()
    if a.cmd == "lib":
        return cmd_lib(a.args)
    if a.cmd == "preview":
        return cmd_preview(a.engine, a.voice, a.out)
    return {"check-scenes": lambda: cmd_check_scenes(a.edit), "voice": lambda: cmd_voice(a.edit, a.engine, a.voice, a.fit),
            "words": lambda: cmd_words(a.edit), "briefs": lambda: cmd_briefs(a.edit), "worlds": lambda: cmd_worlds(a.edit),
            "music": lambda: cmd_music(a.edit, a.mood), "build": lambda: cmd_build(a.edit),
            "render": lambda: cmd_render(a.edit, a.draft, a.uhd), "stills": lambda: cmd_stills(a.edit)}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
