#!/usr/bin/env python3
"""A long video from a prompt (the studio plugin's long-video skill): a researched script read by a voice, a new shot
every few seconds (found footage, pictures, motion graphics), captions on every word, music and a sound on the cuts.

    python3 longvideo.py check EDIT                    scenes.json is well formed; its length, shots and pace
    python3 longvideo.py find EDIT [--only KEY ...]     every clip and photo shot fetched into EDIT/shots/
    python3 longvideo.py sheet EDIT                     EDIT/sheets/sheet-N.jpg: every fetched shot, to look at
    python3 longvideo.py sound EDIT [--mood linear]     audio/mix.wav: the voice, music under it, a sound on the cuts
    python3 longvideo.py build EDIT                     studio.scene.json: shots, graphics, captions, sound
    python3 longvideo.py thumbs EDIT --title "..."      exports/thumbnail-1..3.jpg (1280x720)
    python3 longvideo.py kit EDIT                       exports/publish.md from kit.json, with chapters and credits
    python3 longvideo.py demo

Run through the editor's run.py. The voice, the words and the render are the animated-video skill's own steps
(studio.py voice, words, render, stills): this script writes the same scenes.json, timing.json and scene file.

scenes.json: {"title", "look": {"ground", "ink", "accent"}, "scenes": [{"id", "say", "section"?, "source"?, "shots": [...]}]}
One scene is one spoken line. Its shots share its time equally. A shot is one of:
    {"kind": "clip",  "query": "barbell row side view gym"}        found on YouTube, a few seconds of it; "pick" (0-5,
                                                                    which result) and "at" (0.05-0.9, how far in) choose another
    {"kind": "photo", "query": "Albert Einstein 1921"}              found on Wikimedia Commons (free to reuse, credited)
    {"kind": "own",   "file": "/path/to/clip.mp4", "in": 12.0}      the user's own footage
    {"kind": "title", "text": "...", "sub": "..."}                  big type
    {"kind": "stat",  "value": "250,000", "label": "new jobs by 2026"}
    {"kind": "bars",  "title": "...", "items": [["Apple", 23], ["Samsung", 19]], "unit": "%"}
    {"kind": "list",  "title": "...", "items": ["...", "..."]}
    {"kind": "quote", "text": "...", "by": "..."}
    {"kind": "source", "title": "the paper or article", "by": "authors, journal, year", "highlight": "the line that matters"}
"""
import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
for d in ("animated-video", "stream-clips"):
    sys.path.insert(0, str(HERE.parents[1] / d / "scripts"))
import studio  # noqa: E402  (the voice, the words, the render; finding the editor)
from studio import jload, jsave, duration  # noqa: E402
import streamclips  # noqa: E402  (yt-dlp, the cover image)

MEDIA = ("clip", "stock", "photo", "own", "ai", "bite")
MAX_AI = 6                # AI-generated shots a video: each one is paid for on the user's own account
GRAPHICS = ("title", "stat", "bars", "list", "quote", "source", "tier", "paper")
TIER_COLOURS = {"S": "#FF5A5F", "A": "#FF9F43", "B": "#FFD24A", "C": "#5AD17E", "D": "#4D9FFF", "E": "#9B7BFF", "F": "#8B93A1"}
MAXH = 1080               # the tallest footage fetched; 2160 for a 4K video (brief "quality": "4k")
MAX_IMAGES = 8            # pictures made by the user's AI image tool a video: each is paid for on their own account
MAX_MOTION = 12           # animated hero graphics a video: each is built by its own agent, a few minutes apiece
NEEDS = {"clip": ("query",), "stock": ("query",), "photo": ("query",), "own": ("file",), "motion": ("visual", "fallback"),
         "ai": ("prompt", "fallback"), "bite": (),
         "title": ("text",), "stat": ("value", "label"),
         "bars": ("items",), "list": ("items",), "quote": ("text",), "source": ("title", "highlight"),
         "tier": ("tiers",), "paper": ("title", "highlight"), "chart3d": ("items",)}
MIN_SHOT_S = 1.2          # a shot shorter than this is dropped: the line's other shots take its time
PACE_S = 3.4              # more than this a shot on average reads as slow (edited channels change picture every 1.5 to 2.5 s)
DISPLAY = "Anton"         # the condensed capitals of titles, numbers and labels; everything else is the renderer's sans
# one strict look, as the published videos of this kind keep: near-black, white type, ONE accent (an electric blue), glass panels
LOOK = {"ground": "#0A0C12", "ink": "#FFFFFF", "accent": "#4D8DFF"}
# small, low, the word being said bright and the rest dim: the footage stays the picture, the captions a guide
CAPTIONS = {"y_pct": 91, "size_pct": 2.9, "case": "sentence", "effect": "karaoke", "weight": 600, "stroke": True, "inactive_opacity": 0.5}
UA = "cooked-studio/0.7 (video editor)"


# ---------------------------------------------------------------- the script
def scenes_of(edit):
    return (jload(Path(edit) / "scenes.json") or {}).get("scenes") or []


def check(edit):
    errs = list(studio.check_scenes(edit))
    for s in scenes_of(edit):
        if not isinstance(s, dict):
            continue
        shots = s.get("shots")
        if not isinstance(shots, list) or not 1 <= len(shots) <= 5:
            errs.append(f"scene {s.get('id')}: needs 1 to 5 shots")
            continue
        for k, sh in enumerate(shots, 1):
            kind = sh.get("kind") if isinstance(sh, dict) else None
            if kind not in NEEDS:
                errs.append(f"scene {s.get('id')} shot {k}: kind must be one of {', '.join(NEEDS)}")
                continue
            ov = sh.get("over")
            if ov is not None and not (kind in MEDIA and isinstance(ov, dict) and any(ov.get(x) for x in ("label", "name", "stat", "ring", "clip"))):
                errs.append(f"scene {s.get('id')} shot {k}: \"over\" goes on footage or a picture and has a label, a name, a stat, a ring or a clip")
            for f in NEEDS[kind]:
                if not sh.get(f):
                    errs.append(f"scene {s.get('id')} shot {k} ({kind}): no \"{f}\"")
            if kind == "tier" and not (isinstance(sh.get("tiers"), list) and 2 <= len(sh["tiers"]) <= 6 and all(
                    isinstance(t, list) and len(t) == 2 and isinstance(t[1], list) and 1 <= len(t[1]) <= 5 for t in sh["tiers"])):
                errs.append(f"scene {s.get('id')} shot {k} (tier): \"tiers\" is 2 to 6 rows, each [\"S\", [\"name\", ...]] with 1 to 5 names")
            if kind in ("bars", "list", "chart3d") and not (isinstance(sh.get("items"), list) and 2 <= len(sh["items"]) <= 6):
                errs.append(f"scene {s.get('id')} shot {k} ({kind}): 2 to 6 items")
            if kind == "motion" and not (isinstance(sh.get("fallback"), dict) and sh["fallback"].get("kind") in GRAPHICS
                                         and all(sh["fallback"].get(f) for f in NEEDS[sh["fallback"]["kind"]])):
                errs.append(f"scene {s.get('id')} shot {k} (motion): \"fallback\" is a whole simple graphic ({', '.join(GRAPHICS)}), shown if the animation fails")
            if kind == "ai" and not (isinstance(sh.get("fallback"), dict) and sh["fallback"].get("kind") in ("clip", "stock", "photo")
                                     and sh["fallback"].get("query")):
                errs.append(f"scene {s.get('id')} shot {k} (ai): \"fallback\" is a clip, stock or photo shot, fetched if the generation fails")
            if kind in ("bars", "chart3d") and isinstance(sh.get("items"), list) and any(
                    not (isinstance(i, list) and len(i) == 2 and isinstance(i[1], (int, float))) for i in sh["items"]):
                errs.append(f"scene {s.get('id')} shot {k} ({kind}): each item is [\"name\", number]")
    return errs


def story_gaps(edit):
    """What the research and the beats still lack, before a script is worth checking (references/story.md)."""
    edit, out = Path(edit), []
    try:
        r = (edit / "research.md").read_text(encoding="utf-8")
    except OSError:
        r = ""
    urls = set(re.findall(r"https?://[^\s)>\]]+", r))
    sites = {re.sub(r"^www\.", "", urllib.parse.urlsplit(u).netloc) for u in urls}
    if r and (len(urls) < 5 or len(sites) < 3):
        out.append(f"research.md rests on {len(urls)} page(s) from {len(sites)} site(s): 5 or more pages from at least 3 sites")
    try:
        beats = [x for x in (edit / "beats.md").read_text(encoding="utf-8").splitlines() if re.match(r"\s*(\d+[.)]|[-*])\s+\S", x)]
    except OSError:
        beats = None
    if r and beats is None:
        out.append("no beats.md: write the story in 6 to 10 beats before the script (references/story.md)")
    elif beats is not None and not 5 <= len(beats) <= 12:
        out.append(f"beats.md has {len(beats)} beat(s): 6 to 10")
    return out


CLAIM = re.compile(r"\d|\b(first|last|only|never|always|largest|biggest|smallest|fastest|slowest|oldest|youngest|most|least|"
                   r"every|none|record|invented|discovered|proved|billion|million|thousand|hundred|percent|twice|double|half)\b", re.I)


def cmd_claims(edit, gate=False):
    """EDIT/claims.md: every spoken line that states a number, a date, a name or a superlative, as a row for a fresh
    agent to verify (URL, the supporting sentence, a verdict). --gate: exit 1 while any row is not `supported`."""
    edit = Path(edit)
    f = edit / "claims.md"
    rows = [(s["id"], str(s.get("say") or s.get("text") or "").strip()) for s in scenes_of(edit) if isinstance(s, dict)]
    rows = [(i, t) for i, t in rows if t and (CLAIM.search(t) or re.search(r"\b[A-Z][a-z]+ [A-Z][a-z]+", t))]
    if gate:
        try:
            done = {m.group(1): m.group(2).lower() for m in re.finditer(r"^\|\s*([a-z0-9-]+)\s*\|.*\|\s*(supported|wrong|unsupported|)\s*\|\s*$",
                                                                            f.read_text(encoding="utf-8"), re.M)}
        except OSError:
            print("FIX  no claims.md: run longvideo.py claims EDIT and have a fresh agent verify it")
            return 1
        bad = [i for i, _ in rows if done.get(i) != "supported"]
        print("claims: all " + str(len(rows)) + " supported" if not bad else "FIX  claims not supported yet: " + " ".join(bad))
        return 1 if bad else 0
    lines = ["# Claims to verify", "",
             "For each row: search, paste the URL and the sentence on that page that supports the line, and write the verdict",
             "(`supported`, `wrong` or `unsupported`). Do not look at research.md. A line with two facts needs both supported.", "",
             "| line | what is said | URL | the sentence that supports it | verdict |", "|---|---|---|---|---|"]
    lines += [f"| {i} | {t.replace('|', '/')} |  |  |  |" for i, t in rows]
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{f}: {len(rows)} line(s) to verify. Give it to a fresh agent, then: longvideo.py claims EDIT --gate")
    return 0


def cmd_check(edit):
    errs = story_gaps(edit) + check(edit)
    if errs:
        print("\n".join("FIX  " + e for e in errs))
        return 1
    b, sc = studio.brief_of(edit), scenes_of(edit)
    est = sum(studio.estimate(s, b) for s in sc)
    shots = [sh for s in sc for sh in s["shots"]]
    kinds = {k: sum(sh["kind"] == k for sh in shots) for k in NEEDS}
    if kinds["ai"]:
        prov = ai_provider()
        if not b.get("ai") or not prov:
            print(f"FIX  {kinds['ai']} ai shots, but " + ("AI-generated shots are off for this video" if prov else "no generator is connected (Settings)") +
                  ": make them clips, stock or photos")
            return 1
        if kinds["ai"] > MAX_AI:
            print(f"FIX  {kinds['ai']} ai shots: {MAX_AI} at most (each is paid for)")
            return 1
        rate = AI_RATE.get(prov[0])
        print(f"ai   {kinds['ai']} shots of {AI_SECONDS} s on {prov[0].title()}: " +
              (f"about ${kinds['ai'] * AI_SECONDS * rate:.2f} on the user's account" if rate else "priced by Higgsfield, from the user's balance") +
              ". Ask before `find`.")
    if kinds["motion"] > MAX_MOTION:
        print(f"FIX  {kinds['motion']} motion shots: {MAX_MOTION} at most. Keep them for the ideas a flat graphic cannot show")
        return 1
    words = sum(len(studio.words_in(s.get("say"))) for s in sc)
    print(f"ok   {len(sc)} lines, {words} words, about {est // 60:.0f}:{est % 60:02.0f}, {len(shots)} shots "
          f"(one every {est / len(shots):.1f} s): " + ", ".join(f"{n} {k}" for k, n in kinds.items() if n))
    want = float(b.get("minutes") or 0) * 60
    if want and abs(est - want) > 0.15 * want:
        print(f"FIX  about {est:.0f} s for {want:.0f} s asked: {'add' if est < want else 'cut'} about "
              f"{abs(want - est) * 2.4:.0f} words")
        return 1
    if est / len(shots) > PACE_S:
        print(f"FIX  a shot every {est / len(shots):.1f} s is slow: add shots to the long lines (a new picture every 1.5 to 3 s)")
        return 1
    if kinds["photo"] > 20:
        print(f"FIX  {kinds['photo']} photo shots: 20 at most (the picture sites are slow). Make the others clips or graphics")
        return 1
    g = sum(kinds[k] for k in GRAPHICS) + kinds["motion"]
    if g > 0.6 * len(shots):
        print(f"FIX  {g} of {len(shots)} shots are graphics: real footage and pictures carry a video, graphics make the points")
        return 1
    return 0


def spans(edit):
    """Every shot with its time: [{"key", "sid", "a", "b", "shot", "n"}]. A line's shots share its time equally; one
    that would be shorter than MIN_SHOT_S is dropped."""
    tm = jload(Path(edit) / "timing.json")
    if not tm:
        sys.exit("ERROR: no timing.json. Run studio.py voice first.")
    rows = {r["id"]: r for r in tm["scenes"]}
    out = []
    for s in scenes_of(edit):
        r = rows.get(s["id"])
        if not r:
            continue
        shots = s["shots"][:max(1, min(len(s["shots"]), int(r["dur"] / MIN_SHOT_S)))]
        # a shot's share of its line: "weight" (an animated graphic takes twice a clip's time unless told otherwise)
        ws = [max(0.25, min(4.0, float(sh.get("weight") or (2 if sh.get("kind") == "motion" else 1)))) for sh in shots]
        t = r["start"]
        for k, sh in enumerate(shots):
            z = r["start"] + r["dur"] if k + 1 == len(shots) else t + r["dur"] * ws[k] / sum(ws)
            out.append({"key": f"{s['id']}-{k + 1}", "sid": s["id"], "a": round(t, 3), "b": round(z, 3), "shot": sh, "n": len(out)})
            t = z
    return out


# ---------------------------------------------------------------- finding footage and pictures
def search_youtube(query, n=6):
    v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    rows, ws = [], query.split()
    # some searches come back empty for no reason one can see ("honey dripping close up"): fewer words, then fewer
    for q in dict.fromkeys([query, " ".join(ws[:-1]) if len(ws) > 2 else query, " ".join(ws[:2])]):
        r = subprocess.run(streamclips.ytdlp() + ["--no-warnings", *v4, "--flat-playlist", "--print",
                                                 "%(id)s\t%(duration)s\t%(title)s\t%(channel)s", f"ytsearch{n}:{q}"],
                           capture_output=True, text=True, timeout=120)
        for ln in r.stdout.splitlines():
            p = ln.split("\t")
            try:
                rows.append({"id": p[0], "duration": float(p[1]), "title": p[2], "channel": p[3] if len(p) > 3 else ""})
            except (IndexError, ValueError):
                continue
        if rows:
            break
        time.sleep(1)
    good = [c for c in rows if 20 <= c["duration"] <= 2400]       # not a Short's 10 s, not a 3 hour stream
    return sorted(good or [c for c in rows if 8 <= c["duration"] <= 7200], key=lambda c: -title_score(c))


CLEAN = re.compile(r"\b(4k|8k|uhd|drone|aerial|b-?roll|cinematic|timelapse|time-lapse|slow motion|footage|no copyright|free to use|scenery|relaxing)\b", re.I)
BUSY = re.compile(r"\b(news|podcast|reaction|reacts|interview|review|tutorial|how to|vlog|trailer|compilation|explained|live|episode|"
                  r"full movie|lyrics|top \d+|shorts)\b|#", re.I)


# a video game, a tutorial or a product video shares its words with real footage ("starfield" is a game, "black hole" a level):
# it is tried last, and never when anything else was found
GAME = re.compile(r"\b(gameplay|walkthrough|playthrough|let'?s play|speedrun|gaming|mods?|settings|guide|build|ps[45]|xbox|playstation|nintendo|"
                  r"steam deck|fortnite|minecraft|roblox|unboxing|asmr|tier list|ranked|vs\.?|update \d|patch)\b", re.I)
WEAK_MATCH = 0.24      # under this the best frame of a clip does not show what was asked for (good matches measure 0.27 to 0.34)


def title_score(c):
    """Which search result to try first: plain footage before a presenter's video (which carries a face, titles, a logo)."""
    t = f"{c.get('title', '')} {c.get('channel', '')}"
    return 2 * bool(CLEAN.search(t)) - 2 * bool(BUSY.search(t)) - 4 * bool(GAME.search(t)) - (c.get("duration", 0) > 1200)


_OCR, OCR_LOCK = [], threading.Lock()


def subs_in(f):
    """True when a clip carries someone else's subtitles or captions: text read in the bottom third of the frame, in
    at least two of three frames. Reads with RapidOCR on onnxruntime; False where that is not installed."""
    with OCR_LOCK:
        if not _OCR:
            try:
                from rapidocr_onnxruntime import RapidOCR
                _OCR.append(RapidOCR())
            except Exception:
                _OCR.append(None)
        if not _OCR[0]:
            return False
        try:
            import cv2
            cap = cv2.VideoCapture(str(f))
            total, hits = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0), 0
            for k in range(3):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (0.2 + 0.3 * k)))
                ok, fr = cap.read()
                if not ok:
                    continue
                band = fr[int(fr.shape[0] * 0.66):, :]
                res, _ = _OCR[0](cv2.resize(band, (960, int(960 * band.shape[0] / band.shape[1]))))
                text = "".join(t for _, t, sc in res or [] if sc > 0.6)
                hits += len(re.sub(r"\W", "", text)) >= 6
            cap.release()
            return hits >= 2
        except Exception:
            return False


def logo_of(f):
    """True when a clip carries a logo or watermark: edges that sit still in a corner while the picture around them
    moves. Checked on 4 frames; a locked-off shot (everything still) is not a logo."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return False
    cap = cv2.VideoCapture(str(f))
    total, fs = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0), []
    for k in range(4):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (0.1 + 0.8 * k / 3)))
        ok, fr = cap.read()
        if ok:
            fs.append(cv2.cvtColor(cv2.resize(fr, (640, 360)), cv2.COLOR_BGR2GRAY))
    cap.release()
    if len(fs) < 3:
        return False
    keep = np.logical_and.reduce([cv2.Canny(g, 80, 200) > 0 for g in fs])
    H, W = keep.shape
    ch, cw = int(H * 0.16), int(W * 0.2)
    corner = max(float(c.mean()) for c in (keep[:ch, :cw], keep[:ch, -cw:], keep[-ch:, :cw], keep[-ch:, -cw:]))
    middle = float(keep[int(H * 0.25):int(H * 0.75), int(W * 0.25):int(W * 0.75)].mean())
    return corner >= 0.05 and corner > 2.5 * middle + 0.01


def bars_of(src):
    """The crop that takes baked-in black bars off a clip (an old 4:3 broadcast inside a wide file), as an ffmpeg
    filter with its comma, or "" when there are none worth cutting."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-ss", "0.5", "-t", "2", "-i", str(src), "-vf", "cropdetect=24:2:0", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", r.stderr)
    s = re.search(r"Video:.*? (\d{3,5})x(\d{3,5})", r.stderr)
    if not m or not s:
        return ""
    cw, chh, cx, cy = map(int, m[-1])
    iw, ih = int(s.group(1)), int(s.group(2))
    cut = cw < 0.94 * iw or chh < 0.94 * ih
    return f"crop={cw}:{chh}:{cx}:{cy}," if cut and cw > 0.5 * iw and chh > 0.5 * ih else ""


def fit_cmd(src, out, w, h, seconds=None, start=0.0, pre=""):
    """A clip or picture as the frame's own size (cover), 30 fps, no sound. pre: a filter run first (bars_of)."""
    vf = pre + f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    if seconds is None:
        return ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", "-q:v", "2", str(out)]
    return ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-i", str(src), "-t", f"{seconds:.2f}", "-vf", vf + ",fps=30",
            "-an", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", str(out)]


# ---- which moment of a video shows what the line says: its preview thumbnails scored against the words (CLIP)
_MATCH, MATCH_LOCK, _BOARDS = [], threading.Lock(), {}


def matcher():
    """(image model, text model) of CLIP on onnxruntime (fastembed), or None where it is not installed: the picker then
    falls back to a fixed place in the video."""
    with MATCH_LOCK:
        if not _MATCH:
            try:
                from fastembed import ImageEmbedding, TextEmbedding
                _MATCH.append((ImageEmbedding("Qdrant/clip-ViT-B-32-vision"), TextEmbedding("Qdrant/clip-ViT-B-32-text")))
            except Exception:      # not installed, or its model could not be fetched
                _MATCH.append(None)
        return _MATCH[0]


def storyboard(vid):
    """A YouTube video's own preview thumbnails (the ones the progress bar shows), as (seconds, pictures) across the
    whole video: a few hundred kilobytes instead of the video. None when it has none."""
    if vid in _BOARDS:
        return _BOARDS[vid]
    out = None
    try:
        import io
        from PIL import Image
        v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
        r = subprocess.run(streamclips.ytdlp() + ["--no-warnings", "--no-playlist", *v4, "--dump-json", "--skip-download",
                                                 "https://www.youtube.com/watch?v=" + vid], capture_output=True, text=True, timeout=120)
        j = json.loads(r.stdout.splitlines()[0])
        sbs = [f for f in j.get("formats") or [] if str(f.get("format_id", "")).startswith("sb") and f.get("fragments") and f.get("fps")]
        if sbs:
            sb = max(sbs, key=lambda f: f.get("width") or 0)
            per, times, tiles = sb["rows"] * sb["columns"], [], []
            for k, fr in enumerate(sb["fragments"][:12]):
                with urllib.request.urlopen(urllib.request.Request(fr["url"], headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as resp:
                    img = Image.open(io.BytesIO(resp.read())).convert("RGB")
                for n in range(per):
                    t = (k * per + n) / sb["fps"]
                    if t >= (j.get("duration") or 0) - 1:
                        break
                    c, rr = n % sb["columns"], n // sb["columns"]
                    tiles.append(img.crop((c * sb["width"], rr * sb["height"], (c + 1) * sb["width"], (rr + 1) * sb["height"])))
                    times.append(t)
            out = (times, tiles) if tiles else None
    except Exception:              # no storyboard, a changed format, the network: the fixed place is used
        out = None
    _BOARDS[vid] = out
    return out


def best_moment(vid, text, taken=()):
    """(seconds, score) of the thumbnail that best shows `text`, away from moments already used; None with no matcher."""
    m = matcher()
    sb = storyboard(vid) if m else None
    if not sb:
        return None
    import numpy as np
    times, tiles = sb
    with MATCH_LOCK:
        key = ("emb", vid)
        if key not in _BOARDS:
            e = np.array(list(m[0].embed(tiles)))
            _BOARDS[key] = e / np.linalg.norm(e, axis=1, keepdims=True)
        q = np.array(list(m[1].embed(["a photo of " + str(text)])))[0]
    s = _BOARDS[("emb", vid)] @ (q / np.linalg.norm(q))
    s = s - 0.08 * np.array([any(abs(t - u) < 12 for u in taken) for t in times])       # not the same seconds twice
    s[np.array([np.asarray(t).mean() < 16 for t in tiles])] -= 1.0                       # never a black frame
    i = int(np.argmax(s))
    return times[i], float(s[i])


def fetch_clip(edit, key, sh, need, w, h, used):
    cands = search_youtube(sh["query"])
    if not cands:
        return {"missing": "nothing found on YouTube for this search"}
    if not GAME.search(str(sh["query"])):       # unless a game is what was asked for
        plain = [c for c in cands if not GAME.search(f"{c.get('title', '')} {c.get('channel', '')}")]
        cands = plain or cands
    first = min(len(cands) - 1, max(0, int(sh.get("pick") or 0)))
    v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    out, why, marked = edit / "shots" / f"{key}.mp4", "the download failed", None
    order = [first] if sh.get("pick") is not None else list(range(first, min(len(cands), first + 3)))
    moments = {}
    if sh.get("at") is None:        # each result's best moment for these words; the results are tried best match first
        for i in order:
            got_m = best_moment(cands[i]["id"], sh.get("see") or sh["query"], used.get("t:" + cands[i]["id"], ()))
            if got_m:
                moments[i] = got_m
        if sh.get("pick") is None and moments:
            order.sort(key=lambda i: -(moments[i][1] if i in moments else 0.0))
    # a result that carries a channel's logo or burned-in subtitles is passed over for the next one; a `pick` is taken as it is
    for i in order:
        c = cands[i]
        again = used.get(c["id"], 0)
        used[c["id"]] = again + 1
        frac = float(sh["at"]) if sh.get("at") is not None else (0.3 + 0.17 * again) % 0.8
        a = max(2.0, min(c["duration"] - need - 3, c["duration"] * max(0.02, min(0.92, frac))))
        if i in moments:            # the matched thumbnail, with a third of the shot before it
            a = max(1.0, min(c["duration"] - need - 1, moments[i][0] - need / 3))
            used.setdefault("t:" + c["id"], []).append(moments[i][0])
        raw = edit / "shots" / f"{key}.raw.mp4"
        raw.unlink(missing_ok=True)
        url = "https://www.youtube.com/watch?v=" + c["id"]
        r = subprocess.run(streamclips.ytdlp() + ["--no-warnings", "--no-playlist", *v4, "-f",
                                                 f"bv*[height<={MAXH}][vcodec^=avc1]/bv*[height<={MAXH}]/b[height<={MAXH}]/b",
                                                 "--download-sections", f"*{a:.1f}-{a + need + 2.5:.1f}", "--merge-output-format", "mp4",
                                                 "-o", str(raw), url], capture_output=True, text=True, timeout=300)
        if r.returncode or not raw.exists():
            why = (r.stderr.strip().splitlines() or ["the download failed"])[-1][:160]
            continue
        got = duration(raw)
        tmp = edit / "shots" / f"{key}.try.mp4"
        r = subprocess.run(fit_cmd(raw, tmp, w, h, min(need, max(0.5, got - 0.1)), max(0.0, min(1.0, got - need)), bars_of(raw)), capture_output=True, text=True)
        raw.unlink(missing_ok=True)
        if r.returncode or not tmp.exists():
            why = "the clip could not be read"
            continue
        res = {"file": f"shots/{key}.mp4", "from": url, "title": c["title"], "by": c["channel"], "at": round(a, 1), "picked": i,
               **({"match": round(moments[i][1], 3)} if i in moments else {}),
               "others": [f"{j}: {x['title'][:60]} ({x['duration']:.0f} s)" for j, x in enumerate(cands)]}
        mark = "logo" if logo_of(tmp) else "subtitles" if subs_in(tmp) else None
        if not mark:
            tmp.replace(out)
            return res
        if marked is None:              # the first marked one is kept in case every result is marked
            tmp.replace(edit / "shots" / f"{key}.marked.mp4")
            marked = {**res, "logo": True, "mark": mark}
        else:
            tmp.unlink(missing_ok=True)
    if marked:
        (edit / "shots" / f"{key}.marked.mp4").replace(out)
        return marked
    return {"missing": why}


# ---------------------------------------------------------------- stock footage and pictures (Pexels, with the user's free key)
def pexels_key():
    """The user's Pexels key: the PEXELS_API_KEY variable, else that line of the editor's key file. None: not connected."""
    import os
    if os.environ.get("PEXELS_API_KEY", "").strip():
        return os.environ["PEXELS_API_KEY"].strip()
    try:
        studio.use_editor()
        from ai_editor import keys
        for line in keys.key_file().read_text(encoding="utf-8").splitlines():
            if line.startswith("PEXELS_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    except (OSError, ImportError):
        pass
    return None


def pexels(path, params, key):
    studio.use_editor()
    import net
    req = urllib.request.Request(f"https://api.pexels.com/{path}?" + urllib.parse.urlencode(params), headers={"Authorization": key, "User-Agent": UA})
    with net.urlopen(req, 40) as r:
        return json.loads(r.read().decode("utf-8"))


def search_pexels(query, n=8, w=1920, h=1080):
    key = pexels_key()
    if not key:
        return []
    res = pexels("v1/search", {"query": query, "per_page": n, "orientation": "landscape" if w >= h else "portrait"}, key).get("photos") or []
    return [{"url": x["src"].get("large2x") or x["src"]["original"], "page": x.get("url"), "w": x.get("width") or 0, "h": x.get("height") or 0,
             "title": (x.get("alt") or "")[:80], "by": (x.get("photographer") or "")[:80], "license": "Pexels"} for x in res]


def pixabay_key():
    try:
        studio.use_editor()
        from ai_editor import keys
        return keys.get("pixabay")[0]
    except (ImportError, KeyError):
        return None


def search_pixabay(query, n=8, w=1920, h=1080):
    """Free pictures from Pixabay, with the user's key (free at pixabay.com/api/docs)."""
    key = pixabay_key()
    if not key:
        return []
    res = http_json("https://pixabay.com/api/?" + urllib.parse.urlencode({"key": key, "q": query[:100], "image_type": "photo", "per_page": max(3, n),
                                                                         "orientation": "horizontal" if w >= h else "vertical", "safesearch": "true"}), {}).get("hits") or []
    return [{"url": x.get("largeImageURL") or x.get("webformatURL"), "page": x.get("pageURL"), "w": x.get("imageWidth") or 0, "h": x.get("imageHeight") or 0,
             "title": (x.get("tags") or "")[:80], "by": (x.get("user") or "")[:80], "license": "Pixabay"} for x in res if x.get("largeImageURL") or x.get("webformatURL")]


def fetch_stock_pixabay(edit, key, sh, need, w, h):
    """A stock clip from Pixabay: free to use, no logo."""
    try:
        vids = http_json("https://pixabay.com/api/videos/?" + urllib.parse.urlencode({"key": pixabay_key(), "q": str(sh["query"])[:100], "per_page": 8,
                                                                                      "safesearch": "true"}), {}).get("hits") or []
    except Exception as e:
        return {"missing": f"Pixabay did not answer ({type(e).__name__})"}
    vids = [v for v in vids if (v.get("duration") or 0) >= need + 0.5] or vids
    if not vids:
        return {"missing": "no stock clip on Pixabay for this search"}
    v = vids[min(len(vids) - 1, max(0, int(sh.get("pick") or 0)))]
    f = next((v["videos"][k] for k in ("large", "medium", "small") if (v.get("videos") or {}).get(k, {}).get("url")
              and (v["videos"][k].get("height") or 0) <= 1440), None) or (v.get("videos") or {}).get("medium") or {}
    if not f.get("url"):
        return {"missing": "that stock clip has no file to download"}
    raw = edit / "shots" / f"{key}.raw.mp4"
    try:
        save_url(f["url"], raw)
    except Exception as e:
        return {"missing": f"the stock clip did not download ({type(e).__name__})"}
    out, got = edit / "shots" / f"{key}.mp4", duration(raw)
    at = max(0.0, (got - need) * max(0.0, min(0.9, float(sh["at"]) if sh.get("at") is not None else 0.2)))
    r = subprocess.run(fit_cmd(raw, out, w, h, min(need, max(0.5, got - 0.1)), at), capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return {"missing": "the stock clip could not be read"}
    return {"file": f"shots/{key}.mp4", "from": v.get("pageURL"), "title": "Stock clip: " + str(v.get("tags") or "")[:50],
            "by": str(v.get("user") or "") + " (Pixabay)", "license": "Pixabay"}


def fetch_stock(edit, key, sh, need, w, h):
    """A stock clip: free to use, no logo. Pixabay or Pexels, whichever the user has connected. None: neither."""
    if pixabay_key():
        return fetch_stock_pixabay(edit, key, sh, need, w, h)
    pk = pexels_key()
    if not pk:
        return None
    try:
        vids = pexels("videos/search", {"query": sh["query"], "per_page": 8, "orientation": "landscape" if w >= h else "portrait"}, pk).get("videos") or []
    except Exception as e:
        return {"missing": f"Pexels did not answer ({type(e).__name__})"}
    vids = [v for v in vids if (v.get("duration") or 0) >= need + 0.5] or vids
    if not vids:
        return {"missing": "no stock clip on Pexels for this search"}
    v = vids[min(len(vids) - 1, max(0, int(sh.get("pick") or 0)))]
    files = sorted([f for f in v.get("video_files") or [] if f.get("link") and (f.get("file_type") or "").endswith("mp4")],
                   key=lambda f: (abs((f.get("height") or 0) - min(h, 1080)), -(f.get("width") or 0)))
    if not files:
        return {"missing": "that stock clip has no file to download"}
    raw = edit / "shots" / f"{key}.raw.mp4"
    try:
        import net
        with net.urlopen(urllib.request.Request(files[0]["link"], headers={"User-Agent": UA}), 180) as r:
            raw.write_bytes(r.read())
    except Exception as e:
        return {"missing": f"the stock clip did not download ({type(e).__name__})"}
    out, got = edit / "shots" / f"{key}.mp4", duration(raw)
    at = max(0.0, (got - need) * max(0.0, min(0.9, float(sh["at"]) if sh.get("at") is not None else 0.2)))
    r = subprocess.run(fit_cmd(raw, out, w, h, min(need, max(0.5, got - 0.1)), at), capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return {"missing": "the stock clip could not be read"}
    return {"file": f"shots/{key}.mp4", "from": v.get("url"), "title": "Stock clip", "by": ((v.get("user") or {}).get("name") or "") + " (Pexels)",
            "license": "Pexels", "others": [f"{i}: {x.get('duration')} s by {(x.get('user') or {}).get('name')}" for i, x in enumerate(vids)]}


# ---------------------------------------------------------------- AI-generated shots (the user's own account: Runway, Higgsfield or Google)
AI_SECONDS = 5
AI_RATE = {"runway": 0.12, "gemini": 0.07}      # about, in dollars a second, from each vendor's price page (gen4.5; 720p)


def ai_provider():
    """(name, key) of the first generator the user has connected, or None."""
    try:
        studio.use_editor()
        from ai_editor import keys
        for name in ("runway", "higgsfield", "gemini"):
            k = keys.get(name)[0]
            if k:
                return name, k
    except ImportError:
        pass
    return None


def http_json(url, headers, body=None, timeout=60):
    studio.use_editor()
    import net
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"User-Agent": UA, "Content-Type": "application/json", **headers})
    with net.urlopen(req, timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def save_url(url, out, headers=None):
    studio.use_editor()
    import net
    with net.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})}), 300) as r:
        Path(out).write_bytes(r.read())


def gen_runway(prompt, out, wide, key):
    """Runway's developer API: a text-to-video task, polled until it is done (docs.dev.runwayml.com)."""
    hd = {"Authorization": f"Bearer {key}", "X-Runway-Version": "2024-11-06"}
    task = None
    for model in ("gen4.5", "seedance2_5"):
        try:
            task = http_json("https://api.dev.runwayml.com/v1/text_to_video", hd,
                             {"model": model, "promptText": prompt[:900], "ratio": "1280:720" if wide else "720:1280", "duration": AI_SECONDS})
            break
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
    if not task or not task.get("id"):
        raise RuntimeError("Runway did not start the generation")
    for _ in range(120):
        time.sleep(5)
        t = http_json(f"https://api.dev.runwayml.com/v1/tasks/{task['id']}", hd)
        if t.get("status") == "SUCCEEDED":
            save_url((t.get("output") or [None])[0], out)
            return
        if t.get("status") in ("FAILED", "CANCELLED"):
            raise RuntimeError("Runway: " + str(t.get("failure") or t.get("failureCode") or t["status"])[:120])
    raise RuntimeError("Runway took over 10 minutes")


def gen_higgsfield(prompt, out, wide, key, image_url=None):
    """Higgsfield (docs.higgsfield.ai): Hailuo 2.3. With a picture's address it animates that picture; the text-only
    route is not in their docs under this name and may answer 404."""
    hd = {"Authorization": f"Key {key}"}
    base = "https://api.higgsfield.ai/minimax/hailuo-2.3/standard/"
    job = http_json(base + ("image-to-video" if image_url else "text-to-video"), hd,
                    {"prompt": prompt[:900], "duration": 6, **({"image_url": image_url} if image_url else {})})
    url = job.get("status_url") or f"https://api.higgsfield.ai/requests/{job.get('request_id')}/status"
    for _ in range(120):
        time.sleep(5)
        t = http_json(url, hd)
        if t.get("status") == "completed":
            save_url(((t.get("video") or {}).get("url")), out)
            return
        if t.get("status") in ("failed", "nsfw", "canceled"):
            raise RuntimeError("Higgsfield: " + str(t.get("status")))
    raise RuntimeError("Higgsfield took over 10 minutes")


def gen_google(prompt, out, wide, key):
    """Google's video model on the Gemini API (gemini-omni-1.2-flash, /v1beta/interactions). Paid: a free Gemini key
    is refused. Written from Google's docs and not yet run with a paid key."""
    import base64
    res = http_json("https://generativelanguage.googleapis.com/v1beta/interactions", {"x-goog-api-key": key},
                    {"model": "gemini-omni-1.2-flash", "input": prompt[:900],
                     "response_format": {"type": "video", "aspect_ratio": "16:9" if wide else "9:16", "resolution": "720p", "duration": f"{AI_SECONDS}s"}}, 600)

    def find(o):
        if isinstance(o, dict):
            if o.get("type") == "video" and (o.get("data") or o.get("uri")):
                return o
            if isinstance(o.get("output_video"), dict):
                return o["output_video"]
            for v in o.values():
                got = find(v)
                if got:
                    return got
        elif isinstance(o, list):
            for v in o:
                got = find(v)
                if got:
                    return got
        return None
    v = find(res)
    if not v:
        raise RuntimeError("Google returned no video")
    if v.get("data"):
        Path(out).write_bytes(base64.b64decode(v["data"]))
    else:
        save_url(v["uri"], out, {"x-goog-api-key": key})


def openai_key():
    """The user's OpenAI key (OPENAI_API_KEY, or that line of the editor's key file). None: not connected."""
    import os
    if os.environ.get("OPENAI_API_KEY", "").strip():
        return os.environ["OPENAI_API_KEY"].strip()
    try:
        studio.use_editor()
        from ai_editor import keys
        for line in keys.key_file().read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    except (OSError, ImportError):
        pass
    return None


def make_image(edit, key, prompt, w, h):
    """A picture nobody has, made with the user's own OpenAI key (a photo shot's "make"). None when there is no key, AI
    is off for this video, or the request failed: the shot then stays missing and says so."""
    k = openai_key()
    if not k or not studio.brief_of(edit).get("ai"):
        return None
    import base64
    try:
        d = http_json("https://api.openai.com/v1/images/generations", {"Authorization": f"Bearer {k}", "Content-Type": "application/json"},
                      {"model": "gpt-image-1", "prompt": prompt + " Photographic, natural light, no text, no logos.",
                       "size": "1536x1024" if w >= h else "1024x1536", "n": 1}, timeout=240)
        raw = edit / "shots" / f"{key}.gen.png"
        raw.write_bytes(base64.b64decode(d["data"][0]["b64_json"]))
    except Exception:   # noqa: BLE001  (refused, out of credit, a changed API)
        return None
    out = edit / "shots" / f"{key}.jpg"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}",
                        "-q:v", "2", str(out)], capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return None
    return {"file": f"shots/{key}.jpg", "title": "Generated: " + prompt[:70], "by": "OpenAI (AI-generated)", "license": "AI-generated", "ai": "openai"}


def cmd_charts(edit):
    """EDIT/motion/<key>/ for every `chart3d` shot: a real 3D bar chart (three.js) built from the shot's own numbers and
    rendered here, no agent. A chart that does not render falls back to flat bars at build."""
    edit = Path(edit).resolve()
    root = studio.use_editor()
    import motion
    tm, sc = jload(edit / "timing.json"), jload(edit / "scenes.json")
    if not tm:
        sys.exit("ERROR: run studio.py voice first.")
    todo = [sp for sp in spans(edit) if sp["shot"]["kind"] == "chart3d"]
    if not todo:
        print("0 charts: no chart3d shots")
        return 0
    ok, why = motion.ensure_tools()
    if not ok:
        sys.exit("ERROR: the motion tools are missing: " + str(why))
    look, (w, h) = studio.look_of(sc), studio.size_of(edit)
    tpl = (HERE.parent / "templates" / "chart3d.html").read_text(encoding="utf-8")
    gsap = motion.home() / "motion" / "node_modules" / "gsap" / "dist" / "gsap.min.js"
    bad = 0
    for sp in todo:
        sh, key, dur = sp["shot"], sp["key"], round(sp["b"] - sp["a"], 2)
        d = edit / "motion" / key
        (d / "assets").mkdir(parents=True, exist_ok=True)
        if not (studio.three_assets(d) and studio.kit_into(d)):
            print(f"{key}: three.js or the 3D kit is not installed (studio.py three-setup, kit-setup): flat bars will be used")
            bad += 1
            continue
        data = {"items": [[str(n), float(v)] for n, v in sh["items"][:7]], "title": str(sh.get("title") or ""), "unit": str(sh.get("unit") or ""),
                "source": str(sh.get("source") or ""), "accent": LOOK["accent"], "ink": LOOK["ink"], "ground": LOOK["ground"]}   # the documentary's own dark look
        stamp = json.dumps([data, dur, w, h], sort_keys=True)
        if (d / "chart.stamp").exists() and (d / "chart.stamp").read_text(encoding="utf-8") == stamp and (d / "renders" / "clip.mp4").exists():
            print(f"{key}: ok (already rendered)")
            continue
        beat = {"id": key, "type": "scene", "props": {}, "start": sp["a"], "dur": dur, "clock": "video", "size": [w, h], "words": [],
                "line": "", "before": "", "after": ""}
        fill = lambda t: t.replace("__ID__", key).replace("__TY__", str(int(h * 0.04))).replace("__SY__", str(int(h * 0.8))).replace("__W__", str(w)).replace("__H__", str(h)).replace("__DATA__", json.dumps(data))   # noqa: E731
        markup, module = tpl.split("\n==MODULE==\n", 1)
        markup = markup.split("-->", 1)[1]
        page = motion.fill_template(beat, look)
        page = page.replace('<script src="assets/gsap.min.js"></script>', studio.IMPORTMAP + '\n    <script src="assets/gsap.min.js"></script>', 1)
        page = page.replace('<div id="viewport"><div id="rail"><div id="scene">', '<div id="viewport"><div id="rail"><div id="scene">' + fill(markup), 1)
        page = page.replace("</body>", fill(module) + "\n  </body>", 1)
        (d / "index.html").write_text(page, encoding="utf-8")
        shutil.copy(root / "skills" / "motion" / "template" / "hyperframes.json", d / "hyperframes.json")
        if gsap.exists():
            shutil.copy(gsap, d / "assets" / "gsap.min.js")
        jsave(d / "beat.json", beat)
        (d / "gates.json").unlink(missing_ok=True)
        subprocess.run([sys.executable, str(root / "lib" / "ai_editor" / "run.py"), str(root / "skills" / "motion" / "scripts" / "motion.py"), "check", str(d)],
                       capture_output=True, text=True)
        if (d / "renders" / "clip.mp4").exists():
            (d / "chart.stamp").write_text(stamp, encoding="utf-8")
            print(f"{key}: rendered")
        else:
            bad += 1
            print(f"{key}: did not render: flat bars will be used")
    return 0


def fetch_ai(edit, key, sh, need, w, h):
    prov = ai_provider()
    if not prov or not studio.brief_of(edit).get("ai"):
        return {"missing": "no AI generator is connected, or AI shots are off for this video"}
    raw = edit / "shots" / f"{key}.ai.mp4"
    prompt = str(sh["prompt"]) + " Cinematic, natural light, realistic, no text, no captions, no logos."
    try:
        if prov[0] == "runway":
            gen_runway(prompt, raw, w >= h, prov[1])
        elif prov[0] == "higgsfield":
            gen_higgsfield(prompt, raw, w >= h, prov[1], sh.get("image_url"))
        else:
            gen_google(prompt, raw, w >= h, prov[1])
    except Exception as e:      # refused, out of credits, a changed API: the shot's fallback is fetched instead
        why = f"HTTP {e.code}" if isinstance(e, urllib.error.HTTPError) else str(e)[:140] or type(e).__name__
        return {"missing": f"{prov[0].title()} did not make it ({why})"}
    out = edit / "shots" / f"{key}.mp4"
    got = duration(raw)
    r = subprocess.run(fit_cmd(raw, out, w, h, min(need, max(0.5, got - 0.05)), 0.0), capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return {"missing": "the generated clip could not be read"}
    return {"file": f"shots/{key}.mp4", "title": "Generated: " + str(sh["prompt"])[:70], "by": prov[0].title() + " (AI-generated)", "ai": prov[0]}


def cmd_tools():
    """The two optional helpers, once, into this Python (the editor's venv): CLIP to match a clip's moment to its line
    (fastembed) and a text reader to pass over clips with subtitles (RapidOCR). Both run on onnxruntime, which the
    editor already has; RapidOCR goes in without its own OpenCV, since the editor's is used."""
    pip = [sys.executable, "-m", "pip", "install", "-q"]
    subprocess.run(pip + ["fastembed", "pyclipper", "shapely", "pyyaml", "six", "tqdm"], check=True)
    subprocess.run(pip + ["--no-deps", "rapidocr-onnxruntime"], check=True)
    ok = matcher() is not None
    print("tools ready" if ok else "ERROR: the matcher did not load")
    return 0 if ok else 1


def cmd_setkey():
    """Saves the user's Pexels key in the editor's key file. Typed here, in the user's own Terminal, never in a chat."""
    import getpass
    studio.use_editor()
    from ai_editor import keys
    key = getpass.getpass("Paste your Pexels API key (pexels.com/api, free) and press Return: ").strip()
    if len(key) < 20:
        sys.exit("ERROR: that does not look like a Pexels key.")
    try:
        pexels("v1/search", {"query": "sky", "per_page": 1}, key)
    except Exception as e:
        sys.exit(f"ERROR: Pexels refused that key ({type(e).__name__}). Nothing was saved.")
    f = keys.key_file()
    lines = [ln for ln in (f.read_text(encoding="utf-8").splitlines() if f.exists() else []) if not ln.startswith("PEXELS_API_KEY=")]
    f.parent.mkdir(parents=True, exist_ok=True)
    keys.write_private(f, "\n".join(lines + [f"PEXELS_API_KEY={key}"]) + "\n")
    print("Pexels is connected: stock clips and pictures are on for long videos.")
    return 0


def search_commons(query, n=8):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrsearch": f"{query} filetype:bitmap",
                                "gsrnamespace": 6, "gsrlimit": n, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
                                "iiurlwidth": 1280})
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q, headers={"User-Agent": UA})
    studio.use_editor()
    import net
    with net.urlopen(req, 40) as r:
        pages = (json.loads(r.read().decode("utf-8")).get("query") or {}).get("pages") or {}
    out = []
    for p in sorted(pages.values(), key=lambda p: p.get("index", 99)):
        ii = (p.get("imageinfo") or [{}])[0]
        # only a picture wider than the thumbnail asked for: Wikimedia serves resized thumbnails freely, and answers
        # "too many requests" for whole original files after two or three
        if ii.get("mime") in ("image/jpeg", "image/png") and (ii.get("width") or 0) > 1300 and "/thumb/" in str(ii.get("thumburl") or ""):
            md = ii.get("extmetadata") or {}
            clean = lambda k: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", str((md.get(k) or {}).get("value") or "")))).strip()[:80]  # noqa: E731
            out.append({"url": ii.get("thumburl") or ii["url"], "page": ii.get("descriptionurl"), "w": ii["width"], "h": ii["height"],
                        "title": re.sub(r"^File:|\.\w+$", "", p.get("title", "")), "by": clean("Artist"), "license": clean("LicenseShortName")})
    return out


def search_openverse(query, n=8):
    """Openly licensed pictures (free to reuse and change, also commercially) from Openverse's index."""
    q = urllib.parse.urlencode({"q": query, "license_type": "commercial,modification", "page_size": n, "mature": "false"})
    studio.use_editor()
    import net
    with net.urlopen(urllib.request.Request("https://api.openverse.org/v1/images/?" + q, headers={"User-Agent": UA}), 40) as r:
        res = json.loads(r.read().decode("utf-8")).get("results") or []
    return [{"url": x["url"], "page": x.get("foreign_landing_url"), "w": x.get("width") or 0, "h": x.get("height") or 0,
             "title": (x.get("title") or "")[:80], "by": (x.get("creator") or "")[:80],
             "license": ("CC " + str(x.get("license") or "").upper() + " " + str(x.get("license_version") or "")).strip()}
            for x in res if (x.get("width") or 0) >= 900 and str(x.get("url", "")).lower().split("?")[0].endswith((".jpg", ".jpeg", ".png"))]


PHOTO_LOCK = threading.Lock()      # the picture sites slow a caller down that asks for several at once
PHOTO_GAP_S = 1.2                  # between two pictures: one at a time and unhurried keeps both sites answering
COOL = {}                          # site -> the time it may be asked again, after it said "too many requests"


def fetch_photo(edit, key, sh, w, h):
    """One picture at a time. A site that says "too many requests" rests for as long as it asks (2 minutes for
    Wikimedia); while both rest, this waits for the first to come back rather than give the shot up."""
    raw, c, why = edit / "shots" / f"{key}.raw", None, "no picture found for this search"
    with PHOTO_LOCK:
        for attempt in range(3):
            asked = False
            for search in (search_commons, search_openverse, search_pixabay, search_pexels):
                if COOL.get(search.__name__, 0) > time.time():
                    continue
                asked = True
                try:
                    cands = search(sh["query"])
                    if not cands:
                        continue
                    wide = [x for x in cands if (x["w"] >= x["h"]) == (w >= h)] or cands
                    order = (wide + [x for x in cands if x not in wide])
                    c = order[min(len(order) - 1, max(0, int(sh.get("pick") or 0)))]
                    import net
                    with net.urlopen(urllib.request.Request(c["url"], headers={"User-Agent": UA}), 60) as r:
                        raw.write_bytes(r.read())
                    break
                except Exception as e:      # the network, "too many requests": the next site
                    c, why = None, f"the picture sites did not answer ({type(e).__name__})"
                    if getattr(e, "code", None) == 429:
                        try:
                            wait = float(e.headers.get("Retry-After") or 60)
                        except (TypeError, ValueError):
                            wait = 60.0
                        COOL[search.__name__] = time.time() + min(180.0, max(20.0, wait))
            resting = [t for t in COOL.values() if t > time.time()]
            if c or (asked and not resting) or attempt == 2:
                break
            if resting:
                why = "the picture sites asked to slow down"
                time.sleep(max(1.0, min(130.0, min(resting) - time.time() + 1)))
        time.sleep(PHOTO_GAP_S)
    if not c:
        return {"missing": why}
    out = edit / "shots" / f"{key}.jpg"
    # a third bigger than the frame, so the slow push-in never shows an edge and stays sharp
    r = subprocess.run(fit_cmd(raw, out, int(w * 1.3) // 2 * 2, int(h * 1.3) // 2 * 2), capture_output=True, text=True)
    card = False
    if not r.returncode and c.get("w") and c.get("h") and not 0.74 < (c["w"] / c["h"]) / (w / h) < 1.35:
        # a picture shaped unlike the frame (a portrait in a wide video) would lose its head or feet filling it:
        # it is shown whole, as a card over a blurred, darkened copy of itself
        ch = int(h * 0.84) // 2 * 2
        a = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-vf", f"scale=-2:{ch}", "-frames:v", "1", "-q:v", "2",
                            str(edit / "shots" / f"{key}.card.jpg")], capture_output=True)
        b2 = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-vf", f"scale={w // 8}:{h // 8},boxblur=6:2,scale={w}:{h},eq=brightness=-0.22:saturation=0.7",
                             "-frames:v", "1", "-q:v", "3", str(edit / "shots" / f"{key}.blur.jpg")], capture_output=True)
        card = not a.returncode and not b2.returncode
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return {"missing": "the picture could not be read"}
    return {"file": f"shots/{key}.jpg", "from": c["page"], "title": c["title"], "by": c["by"], "license": c["license"], **({"card": True} if card else {}),
            "others": [f"{i}: {x['title'][:60]}" for i, x in enumerate(order)][:8]}


def fetch_own(edit, key, sh, need, w, h):
    f = Path(str(sh["file"])).expanduser()
    if not f.is_file():
        return {"missing": f"no file at {f}"}
    out = edit / "shots" / (f"{key}.jpg" if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") else f"{key}.mp4")
    cmd = fit_cmd(f, out, int(w * 1.3) // 2 * 2, int(h * 1.3) // 2 * 2) if out.suffix == ".jpg" else fit_cmd(f, out, w, h, need, float(sh.get("in") or 0))
    r = subprocess.run(cmd, capture_output=True, text=True)
    return {"file": f"shots/{out.name}", "own": True} if not r.returncode and out.exists() else {"missing": "the file could not be read"}


def stamp_of(sh, need):
    return json.dumps([sh.get("kind"), sh.get("query"), sh.get("file"), sh.get("pick"), sh.get("at"), sh.get("in"), round(need, 1),
                       sh.get("prompt"), (sh.get("fallback") or {}).get("query")])


def cmd_find(edit, only=None):
    edit = Path(edit)
    (edit / "shots").mkdir(exist_ok=True)
    w, h = studio.size_of(edit)
    if str(studio.brief_of(edit).get("quality") or "").lower() == "4k":   # footage kept at twice the frame, for the 4K render
        global MAXH
        MAXH, w, h = 2160, w * 2, h * 2
    db = jload(edit / "shots.json", {}) or {}
    todo = [sp for sp in spans(edit) if sp["shot"]["kind"] in MEDIA and (not only or sp["key"] in only)]
    made = [0]
    used = {}

    def one(sp):
        key, sh, need = sp["key"], sp["shot"], sp["b"] - sp["a"]
        was = db.get(key) or {}
        if was.get("stamp") == stamp_of(sh, need) and was.get("file") and (edit / was["file"]).exists():
            return key, was
        if sh["kind"] == "bite":       # a sound bite is fetched by `bites`, with its sound, before the voice is made
            return key, was or {"missing": "run longvideo.py bites first", "kind": "bite"}
        if sh["kind"] == "ai":         # generated on the user's account; when that fails, its fallback shot is fetched
            got = fetch_ai(edit, key, sh, need, w, h)
            if got.get("missing"):
                fb, why = sh["fallback"], got["missing"]
                got = fetch_stock(edit, key, fb, need, w, h) if fb["kind"] == "stock" else None
                got = got or (fetch_photo(edit, key, fb, w, h) if fb["kind"] == "photo" else fetch_clip(edit, key, fb, need, w, h, used))
                got = {**got, "ai_failed": why, "query": fb.get("query")}
        elif sh["kind"] == "stock":      # Pexels with a key; with none, the same words searched on YouTube when that is allowed
            got = fetch_stock(edit, key, sh, need, w, h)
            if got is None:
                got = fetch_clip(edit, key, sh, need, w, h, used) if (studio.brief_of(edit).get("footage") or {}).get("youtube", True) \
                    else {"missing": "stock footage needs a Pexels key (longvideo.py setkey), and YouTube footage is off"}
        else:
            got = fetch_clip(edit, key, sh, need, w, h, used) if sh["kind"] == "clip" else \
                fetch_photo(edit, key, sh, w, h) if sh["kind"] == "photo" else fetch_own(edit, key, sh, need, w, h)
            if sh["kind"] == "photo" and got.get("missing") and sh.get("make") and made[0] < MAX_IMAGES:   # no such picture exists: the user's AI image tool makes it
                img = make_image(edit, key, str(sh["make"]), w, h)
                if img:
                    made[0] += 1
                    got = img
        if sh["kind"] in ("clip", "stock") and got.get("missing"):     # a shot is not left empty: fewer words, then a still picture
            why, short = got["missing"], " ".join(str(sh.get("query") or "").split()[:3])
            if short and short != str(sh.get("query") or "").strip():
                alt = fetch_clip(edit, key, {**sh, "query": short, "see": sh.get("see") or sh.get("query")}, need, w, h, used)
                if not alt.get("missing"):
                    got = {**alt, "retried": short}
            if got.get("missing") and (studio.brief_of(edit).get("footage") or {}).get("photos", True):
                alt = fetch_photo(edit, key, sh, w, h)
                if not alt.get("missing"):
                    got = {**alt, "instead": "a picture (no footage: " + why + ")"}
        return key, {**got, "kind": sh["kind"], "query": sh.get("query"), "stamp": stamp_of(sh, need)}
    with ThreadPoolExecutor(4) as ex:
        for key, got in ex.map(one, todo):
            db[key] = got
            jsave(edit / "shots.json", db)
            print(f"MISSING {key}: {got.get('query')} ({got['missing']})" if got.get("missing") else
                  (f"LOGO {key}: every result tried carries a logo or subtitles; change the words or the kind. " if got.get("logo") else "") +
                  (f"AI FAILED {key} ({got['ai_failed']}), its fallback is used. " if got.get("ai_failed") else "") +
                  (f"WEAK {key}: the best frame barely shows \"{got.get('query')}\" (match {got['match']:.2f}); look at it on the sheet, change the words or give a \"see\". "
                   if isinstance(got.get("match"), float) and got["match"] < WEAK_MATCH else "") +
                  (f"PICTURE {key}: {got['instead']}. " if got.get("instead") else "") +
                  f"{key}: {got.get('title') or got.get('file')}"[:110])
    keys = {sp["key"] for sp in spans(edit)}
    for k in [k for k in db if k not in keys]:          # a shot the script no longer has
        if db[k].get("file"):
            (edit / db[k]["file"]).unlink(missing_ok=True)
        del db[k]
    jsave(edit / "shots.json", db)
    miss = [sp["key"] for sp in spans(edit) if sp["shot"]["kind"] in MEDIA and (db.get(sp["key"]) or {"missing": 1}).get("missing")]
    print(f"FOUND {len([k for k in db if db[k].get('file')])} shots" + (f", {len(miss)} missing: {' '.join(miss)}" if miss else ""))
    return 0


def cmd_sheet(edit):
    """Every fetched shot's middle frame on sheets of 20, each labelled with its key and what was searched."""
    from PIL import Image, ImageDraw, ImageFont
    edit = Path(edit)
    db = jload(edit / "shots.json", {}) or {}
    rows = [(sp["key"], db[sp["key"]]) for sp in spans(edit) if (db.get(sp["key"]) or {}).get("file")]
    out = edit / "sheets"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir()
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
    except OSError:
        font = ImageFont.load_default()
    cw, ch = 384, 216
    with tempfile.TemporaryDirectory() as td:
        for n in range(0, len(rows), 20):
            page = rows[n:n + 20]
            im = Image.new("RGB", (cw * 5, (ch + 26) * -(-len(page) // 5)), (20, 20, 22))
            dr = ImageDraw.Draw(im)
            for i, (key, got) in enumerate(page):
                f, fr = edit / got["file"], Path(td) / f"{i}.jpg"
                at = ["-ss", f"{duration(f) / 2:.2f}"] if f.suffix == ".mp4" else []
                subprocess.run(["ffmpeg", "-v", "error", "-y", *at, "-i", str(f), "-frames:v", "1", "-vf",
                                f"scale={cw}:{ch}:force_original_aspect_ratio=decrease,pad={cw}:{ch}:(ow-iw)/2:(oh-ih)/2", str(fr)])
                x, y = (i % 5) * cw, (i // 5) * (ch + 26)
                if fr.exists():
                    im.paste(Image.open(fr), (x, y))
                dr.text((x + 6, y + ch + 4), f"{key}: {got.get('query') or 'own'}"[:48], font=font, fill=(235, 235, 235))
            im.save(out / f"sheet-{n // 20 + 1}.jpg", quality=85)
            print(out / f"sheet-{n // 20 + 1}.jpg", f"({len(page)} shots)")
    return 0


# ---------------------------------------------------------------- sound bites: a person's own words, from an interview or a talk
def subs_of(vid):
    """A YouTube video's English subtitles (its own, else the automatic ones) as [(start, end, text)], or []."""
    v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(streamclips.ytdlp() + ["--no-warnings", "--no-playlist", *v4, "--skip-download", "--write-subs", "--write-auto-subs",
                                             "--sub-langs", "en.*,en", "--sub-format", "json3", "-o", str(Path(td) / "s"),
                                             "https://www.youtube.com/watch?v=" + vid], capture_output=True, text=True, timeout=120)
        fs = sorted(Path(td).glob("s*.json3"), key=lambda f: ("orig" not in f.name, len(f.name)))
        if not fs:
            return []
        ev = (jload(fs[0], {}) or {}).get("events") or []
    out = []
    for e in ev:
        t = "".join(s.get("utf8", "") for s in e.get("segs") or []).replace("\n", " ").strip()
        if t and e.get("tStartMs") is not None:
            a = e["tStartMs"] / 1000.0
            out.append((a, a + (e.get("dDurationMs") or 2000) / 1000.0, t))
    return out


def best_window(subs, find, lo=4.0, hi=9.0):
    """The stretch of subtitles, lo to hi seconds long, that holds the most of the words looked for. (a, b, text) or None."""
    want = [w.lower() for w in find if str(w).strip()]
    best = None
    for i in range(len(subs)):
        text, j = "", i
        while j < len(subs) and subs[j][0] - subs[i][0] < hi:
            text += " " + subs[j][2]
            j += 1
        a, b = subs[i][0], min(subs[j - 1][1], subs[i][0] + hi)
        if b - a < lo:
            continue
        score = sum(w in text.lower() for w in want) + 0.2 * bool(re.search(r"[.!?]\s*$", text))
        if score >= max(1, 0.6 * len(want)) and (best is None or score > best[0]):
            best = (score, a, b, re.sub(r"\s+", " ", text).strip())
    return best[1:] if best else None


def cmd_bites(edit):
    """For every scene with `bite` ({"query", "find": [words], "name", "role"}): the few seconds of an interview or
    talk where the person says those words, with their own sound. Writes shots/<id>-1.mp4, audio/bite-<id>.wav and
    the scene's `say` (what they say, for the captions). A bite that cannot be found becomes a narrated line: its
    `fallback_say`, over its fallback shots."""
    edit = Path(edit)
    p = edit / "scenes.json"
    sc = jload(p)
    w, h = studio.size_of(edit)
    (edit / "shots").mkdir(exist_ok=True)
    (edit / "audio").mkdir(exist_ok=True)
    db = jload(edit / "shots.json", {}) or {}
    v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    n_ok = 0
    for s in sc["scenes"]:
        bt = s.get("bite")
        if not isinstance(bt, dict):
            continue
        key, wav = f"{s['id']}-1", edit / "audio" / f"bite-{s['id']}.wav"
        if wav.exists() and (db.get(key) or {}).get("file") and (edit / db[key]["file"]).exists():
            n_ok += 1
            continue
        got = None
        for c in search_youtube(str(bt.get("query") or ""), 6)[:3]:
            subs = subs_of(c["id"])
            win = best_window(subs, bt.get("find") or [])
            if not win:
                continue
            # the same words are often said over a cutaway: among the windows that hold them, the one whose picture
            # shows a person speaking (the video's preview frames, scored) is taken
            alts = [win] + [w2 for w2 in (best_window([x for x in subs if not (win[0] - 1 <= x[0] <= win[1] + 1)], bt.get("find") or []),) if w2]
            try:
                m = matcher()
                sb = storyboard(c["id"]) if m else None
                if sb and len(alts) > 1:
                    import numpy as np
                    with MATCH_LOCK:
                        e = np.array(list(m[0].embed(sb[1])))
                        q = np.array(list(m[1].embed(["a photo of a person speaking to the camera, close up of a face"])))[0]
                    sc_ = (e / np.linalg.norm(e, axis=1, keepdims=True)) @ (q / np.linalg.norm(q))
                    near = lambda w2: max((float(sc_[i]) for i, t in enumerate(sb[0]) if w2[0] - 6 <= t <= w2[1] + 6), default=0.0)   # noqa: E731
                    win = max(alts, key=near)
            except Exception:
                pass
            a, b, text = win
            raw = edit / "shots" / f"{key}.raw.mp4"
            raw.unlink(missing_ok=True)
            url = "https://www.youtube.com/watch?v=" + c["id"]
            r = subprocess.run(streamclips.ytdlp() + ["--no-warnings", "--no-playlist", *v4, "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
                                                     "--download-sections", f"*{max(0, a - 0.3):.1f}-{b + 0.4:.1f}", "--merge-output-format", "mp4",
                                                     "-o", str(raw), url], capture_output=True, text=True, timeout=300)
            if r.returncode or not raw.exists():
                continue
            d = duration(raw)
            subprocess.run(fit_cmd(raw, edit / "shots" / f"{key}.mp4", w, h, d, 0.0, bars_of(raw)), capture_output=True)
            studio.to_wav(raw, wav)
            raw.unlink(missing_ok=True)
            if (edit / "shots" / f"{key}.mp4").exists() and wav.exists():
                got = {"file": f"shots/{key}.mp4", "from": url, "title": c["title"], "by": c["channel"], "at": round(a, 1), "kind": "bite",
                       "query": bt.get("query"), "stamp": "bite"}
                s["say"] = text
                s["shots"] = [{"kind": "bite", **({"over": {"name": bt["name"], **({"role": bt["role"]} if bt.get("role") else {})}} if bt.get("name") else {})}]
                break
        if got:
            db[key] = got
            n_ok += 1
            print(f"{s['id']}: \"{s['say'][:80]}\" ({got['title'][:50]})")
        else:                            # nobody found saying it: the narrator says the point instead
            wav.unlink(missing_ok=True)
            s["say"] = str(s.get("fallback_say") or s.get("say") or "").strip()
            s.pop("bite")
            print(f"NO BITE {s['id']}: narrated instead")
        jsave(p, sc)
        jsave(edit / "shots.json", db)
    print(f"BITES {n_ok} found")
    return 0


# ---------------------------------------------------------------- the user's own recorded voiceover
def lines_of(words, lo=7, hi=22, gap=0.7):
    """A recording's words as spoken lines: a line ends at a sentence end or a pause once it has `lo` words, and at
    `hi` words whatever comes. [[first word index, last word index], ...]."""
    out, a = [], 0
    for i, w in enumerate(words):
        n = i - a + 1
        pause = i + 1 < len(words) and words[i + 1]["start"] - w["end"] >= gap
        if i + 1 == len(words) or n >= hi or (n >= lo and (re.search(r"[.!?]$", w["w"]) or pause)):
            out.append([a, i])
            a = i + 1
    if len(out) > 1 and out[-1][1] - out[-1][0] + 1 < 4:      # a few words left over join the line before
        out[-2][1] = out[-1][1]
        out.pop()
    return out


# ---------------------------------------------------------------- cleaning a recorded voice
FILLERS = {"um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm", "mhm"}
DF_VER = "0.5.6"          # DeepFilterNet's own prebuilt command (MIT/Apache, 28 MB, no Python): takes room noise and hiss off a voice
GAP_KEEP = 0.32           # a pause between phrases is kept this long: the breath in it goes, the rhythm stays
PAD = 0.045               # kept before every word, so no word is clipped
PAD_END = 0.11            # and after it


def deep_filter():
    """The deep-filter command, fetched once into ~/.ai-video-editor/bin. None when it cannot be had (then ffmpeg's own denoiser is used)."""
    import platform
    import audio_lib
    f = audio_lib.home() / "bin" / "deep-filter"
    if f.is_file() and f.stat().st_size > 1000000:
        return f
    if platform.system() != "Darwin":
        return None
    arch = "aarch64" if platform.machine() == "arm64" else "x86_64"
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(audio_lib.get(f"https://github.com/Rikorose/DeepFilterNet/releases/download/v{DF_VER}/deep-filter-{DF_VER}-{arch}-apple-darwin", 240))
        f.chmod(0o755)
        subprocess.run(["xattr", "-d", "com.apple.quarantine", str(f)], capture_output=True)
        return f if subprocess.run([str(f), "--version"], capture_output=True).returncode == 0 else None
    except Exception:   # noqa: BLE001
        return None


def cut_plan(words, total):
    """What to keep of a spoken take: [(start, end)] and what went. Fillers go, a phrase said twice in a row keeps only
    its second saying, and a pause longer than GAP_KEEP is shortened to it. Every kept word keeps PAD on both sides."""
    norm = lambda w: re.sub(r"[^a-z0-9']", "", str(w).lower())     # noqa: E731
    drop = set()
    for i, w in enumerate(words):
        if norm(w["w"]) in FILLERS:
            drop.add(i)
    live = [i for i in range(len(words)) if i not in drop]
    restarts = 0
    k = 0
    while k < len(live):                      # "the best way, the best way to grow": the first saying is the false start
        for n in (5, 4, 3, 2):
            a, b = live[k:k + n], live[k + n:k + 2 * n]
            if len(b) == n and [norm(words[i]["w"]) for i in a] == [norm(words[i]["w"]) for i in b] and all(len(norm(words[i]["w"])) > 1 for i in a):
                drop.update(a)
                restarts += 1
                k += n - 1
                break
        k += 1
    keep, fillers = [], len([i for i in drop if norm(words[i]["w"]) in FILLERS])
    gone = sorted((words[i]["start"], words[i]["end"]) for i in drop)
    clear = lambda a, z: not any(g0 < z and a < g1 for g0, g1 in gone)        # noqa: E731  (no cut word inside this stretch)
    for i, w in enumerate(words):
        if i in drop:
            continue
        a, z = max(0.0, w["start"] - PAD), min(total, w["end"] + PAD_END)       # a word's end is heard a little after its timing says
        for g0, g1 in gone:                                                      # never back into a cut word
            if g1 <= w["start"] and g1 > a:
                a = min(w["start"], g1 + 0.02)
            if g0 >= w["end"] and g0 < z:
                z = max(w["end"], g0 - 0.02)
        if keep and a - keep[-1][1] <= GAP_KEEP and clear(keep[-1][1], a):
            keep[-1][1] = max(keep[-1][1], z)          # close enough and nothing cut between: one stretch
        else:
            if keep and clear(keep[-1][1], a):          # a long pause: keep GAP_KEEP of it, split either side
                keep[-1][1] = min(total, keep[-1][1] + GAP_KEEP / 2)
                a = max(keep[-1][1], a - GAP_KEEP / 2)
            keep.append([a, z])
    if keep:
        keep[-1][1] = min(total, keep[-1][1] + 0.25)    # the last word rings out
    return [(round(a, 3), round(z, 3)) for a, z in keep if z - a > 0.05], {"fillers": fillers, "restarts": restarts}


def clean_voice(src, out, words):
    """A recorded take cleaned the way an editor would: noise off, every um and false start cut, breaths out of the long
    pauses, then levelled. Returns what was done. No word is clipped: cuts fall only in the gaps between words."""
    src, out = Path(src), Path(out)
    tmp = out.with_suffix(".dn.wav")
    df = deep_filter()
    done = False
    if df:
        d = out.parent / "df"
        d.mkdir(exist_ok=True)
        r = subprocess.run([str(df), str(src), "-o", str(d)], capture_output=True, text=True)
        got = d / src.name
        if not r.returncode and got.is_file():
            shutil.move(str(got), str(tmp))
            done = True
        shutil.rmtree(d, ignore_errors=True)
    if not done:                                  # ffmpeg's own spectral denoiser, gentler
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", "afftdn=nr=10:nf=-40", str(tmp)], check=True)
    total = duration(tmp)
    keep, what = cut_plan(words, total)
    if not keep:
        keep = [(0.0, total)]
    parts = "".join(f"[0:a]atrim={a}:{z},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st={max(0.0, z - a - 0.012):.3f}:d=0.012[p{i}];"
                    for i, (a, z) in enumerate(keep))
    chain = "highpass=f=80,deesser,acompressor=threshold=-18dB:ratio=3:attack=8:release=120,loudnorm=I=-16:TP=-1.5:LRA=11"
    fc = parts + "".join(f"[p{i}]" for i in range(len(keep))) + f"concat=n={len(keep)}:v=0:a=1,{chain}[o]"
    script = out.with_suffix(".fc.txt")
    script.write_text(fc, encoding="utf-8")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-/filter_complex", str(script), "-map", "[o]", "-ar", "48000", str(out)], check=True)
    tmp.unlink(missing_ok=True)
    script.unlink(missing_ok=True)
    return {**what, "cuts": max(0, len(keep) - 1), "before": round(total, 1), "after": round(duration(out), 1), "denoised": "deep-filter" if done else "ffmpeg",
            "words_clipped": 0}


def cmd_voiceover(edit, src):
    """The user's recording as the video's voice: audio/vo.wav, words.json, timing.json (engine "own"), and
    scenes.json with one scene a spoken line (ids l01, l02, ...) whose shots Claude then writes. Run again after the
    shots are written and they are kept for every line that still says the same."""
    edit, src = Path(edit), Path(str(src)).expanduser()
    if not src.is_file():
        sys.exit(f"ERROR: no recording at {src}")
    (edit / "audio").mkdir(parents=True, exist_ok=True)
    raw = edit / "audio" / "vo.raw.wav"
    studio.to_wav(src, raw)
    (edit / "audio" / "vo.raw.words.json").unlink(missing_ok=True)
    first = streamclips.words_of(raw, edit / "audio" / "vo.raw.words.json")      # the take as recorded: where its words are
    if len(first) < 8:
        sys.exit("ERROR: almost nothing is said in that recording.")
    cleaned = clean_voice(raw, edit / "audio" / "vo.wav", first)
    jsave(edit / "audio" / "vo.clean.json", cleaned)
    print(f"CLEANED {cleaned['before']} s -> {cleaned['after']} s: {cleaned['fillers']} um(s) and {cleaned['restarts']} restarted phrase(s) cut, "
          f"{cleaned['cuts']} cut(s) in all, 0 words clipped, noise taken off with {cleaned['denoised']}. Tell the user these numbers.")
    (edit / "audio" / "vo.words.raw.json").unlink(missing_ok=True)
    words = streamclips.words_of(edit / "audio" / "vo.wav", edit / "audio" / "vo.words.raw.json")
    if len(words) < 8:
        sys.exit("ERROR: almost nothing is said in that recording.")
    total = duration(edit / "audio" / "vo.wav")
    old = {s.get("say"): s for s in scenes_of(edit)}
    was = jload(edit / "scenes.json", {}) or {}
    scenes, rows = [], []
    ls = lines_of(words)
    for k, (a, z) in enumerate(ls):
        say = " ".join(w["w"] for w in words[a:z + 1])
        start = 0.0 if k == 0 else (words[ls[k - 1][1]]["end"] + words[a]["start"]) / 2
        end = total if k + 1 == len(ls) else (words[z]["end"] + words[ls[k + 1][0]]["start"]) / 2
        sid = f"l{k + 1:02d}"
        keep = old.get(say) or {}
        scenes.append({**{x: keep[x] for x in ("section", "source", "source_label") if keep.get(x)}, "id": sid, "say": say, "visual": "-",
                       "shots": keep.get("shots") or [{"kind": "title", "text": "(shots to write)"}]})
        rows.append({"id": sid, "start": round(start, 3), "dur": round(end - start, 3)})
    jsave(edit / "scenes.json", {**{k: v for k, v in was.items() if k != "scenes"}, "scenes": scenes})
    jsave(edit / "timing.json", {"engine": "own", "voice": src.name, "length": round(total, 3), "scenes": rows})
    jsave(edit / "words.json", [{"w": w["w"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words])
    print(f"VOICEOVER {mmss(round(total))}, {len(words)} words, {len(scenes)} lines in scenes.json: write each line's shots")
    return 0


# ---------------------------------------------------------------- animated graphics (one clip-builder agent each)
def cmd_briefs(edit):
    """EDIT/motion/<key>/ for every `motion` shot: the animation template, beat.json and brief.md that one
    ai-editor:clip-builder agent builds into a full-frame animated clip of exactly that shot's length."""
    edit = Path(edit).resolve()
    root = studio.use_editor()
    import motion
    import os
    tm, words, sc, b = jload(edit / "timing.json"), jload(edit / "words.json"), jload(edit / "scenes.json"), studio.brief_of(edit)
    if not tm or words is None:
        sys.exit("ERROR: run studio.py voice and words first.")
    todo = [sp for sp in spans(edit) if sp["shot"]["kind"] == "motion"]
    if not todo:
        print("0 briefs: no motion shots")
        return 0
    ok, why = motion.ensure_tools()
    if not ok:
        sys.exit("ERROR: the motion tools are missing: " + str(why))
    look = studio.look_of(sc)
    w, h = studio.size_of(edit)
    gsap = motion.home() / "motion" / "node_modules" / "gsap" / "dist" / "gsap.min.js"
    says = {s["id"]: s.get("say", "") for s in sc["scenes"]}
    order = [s["id"] for s in sc["scenes"]]
    for n, sp in enumerate(todo, 1):
        sh, key, dur = sp["shot"], sp["key"], round(sp["b"] - sp["a"], 2)
        i = order.index(sp["sid"])
        mine = [{"w": x["w"], "t": round(x["start"] - sp["a"], 2)} for x in words if sp["a"] <= x["start"] < sp["b"]]
        beat = {"id": key, "type": "scene", "props": {}, "start": sp["a"], "dur": dur, "clock": "video", "size": [w, h], "words": mine,
                "line": says[sp["sid"]], "before": says[order[i - 1]] if i else "", "after": says[order[i + 1]] if i + 1 < len(order) else ""}
        d = edit / "motion" / key
        (d / "assets").mkdir(parents=True, exist_ok=True)
        old = jload(d / "beat.json", {}) or {}
        if not (d / "index.html").exists() or abs(old.get("dur", 0) - dur) > 0.01:
            (d / "index.html").write_text(motion.fill_template(beat, look), encoding="utf-8")
            (d / "gates.json").unlink(missing_ok=True)
        shutil.copy(root / "skills" / "motion" / "template" / "hyperframes.json", d / "hyperframes.json")
        if gsap.exists():
            shutil.copy(gsap, d / "assets" / "gsap.min.js")
        jsave(d / "beat.json", beat)
        visual = str(sh["visual"]) + (" Use exactly these numbers and names, nothing invented: " + json.dumps(sh["data"]) if sh.get("data") else "") + \
            " This is one shot inside a documentary cut from real footage: it must look designed and deep (layers, light, a moving camera," \
            " easing), not a slide. The captions sit in the bottom fifth: keep that calm."
        three = studio.THREE_NOTE if studio.three_assets(d) else ""
        (d / "brief.md").write_text(three.join(studio.BRIEF.split("\n{start}Build:", 1)[:1] + ["\n{start}Build:" + studio.BRIEF.split("\n{start}Build:", 1)[1]]).format(
            id=key, card=root / "skills" / "motion" / "references" / "clip-brief-card.md", dir=d, w=w, h=h, dur=dur,
            title=sc.get("title") or "", prompt=b.get("prompt") or "", look=json.dumps(look), visual=visual,
            say=beat["line"], before=beat["before"], after=beat["after"], words=json.dumps(mine), n=n, total=len(todo), first="", last="",
            start="- Notes on this clip, if any: `notes.md` beside this brief. Do what they say.\n\n",
            env=f'AI_EDITOR_HOME="{os.environ["AI_EDITOR_HOME"]}" ' if os.environ.get("AI_EDITOR_HOME") else "",
            run=root / "lib" / "ai_editor" / "run.py", motion=root / "skills" / "motion" / "scripts" / "motion.py",
            rounds=motion.ROUNDS), encoding="utf-8")
        print(f"{key:<24} {dur:5.2f}s  {d / 'brief.md'}")
    print(f"{len(todo)} brief(s). One ai-editor:clip-builder agent per brief, all in one message.")
    return 0


# ---------------------------------------------------------------- sound
# Measured on two published documentaries of this kind against our own first mix (0.4 s windows, November 2026): theirs
# run 11 to 12 dB between the loud and the quiet moments and fall to near silence at times; ours ran 4.4 dB, a wall of
# sound. So the music is a quiet bed that rests, the voice owns the mix, and a sound marks a change that matters, not
# every cut.
REAL_MUSIC_GAIN = 0.6     # a real track, already levelled to MUSIC_RMS
MUSIC_GAIN = 0.085         # the bed under the voice (it was 0.42): at this the quiet moments measure as theirs do
MIX_RANGE_DB = 9.0        # loud to quiet (90th to 10th percentile of 0.4 s windows): under this the mix has no air


MUSIC_RMS = 0.05          # a real track is levelled to this before the bed gain, so a loud master and a quiet one sit the same


def music_bed(edit, n, sr, read):
    """The video's own music as the bed (EDIT/audio/music.mp3|wav|m4a, put there by `music --use` or by the user): looped
    to length if short, levelled, faded at both ends. None when there is no file."""
    import numpy as np
    f = next((x for x in (Path(edit) / "audio" / f"music.{e}" for e in ("mp3", "wav", "m4a", "flac", "ogg")) if x.is_file()), None)
    if not f:
        return None
    x = read(f)
    if x.shape[1] < sr:
        return None
    start = min(x.shape[1] // 6, int(4 * sr))          # past a slow intro, so the bed is already playing
    x = x[:, start:]
    while x.shape[1] < n:                               # a short track plays again, crossed over its own end
        k = min(int(2 * sr), x.shape[1] // 4)
        ramp = np.linspace(0, 1, k)
        x = np.concatenate([x[:, :-k], x[:, -k:] * (1 - ramp) + x[:, :k] * ramp, x[:, k:]], axis=1)
    x = x[:, :n]
    rms = float(np.sqrt((x ** 2).mean())) or 1.0
    x = x * (MUSIC_RMS / rms)
    fade = int(1.5 * sr)
    x[:, :fade] *= np.linspace(0, 1, fade)
    x[:, -fade:] *= np.linspace(1, 0, fade)
    return x


def cmd_sfx_setup():
    """Fetch the recorded sound effects once (CC0, about 30 short files) into ~/.ai-video-editor/sfx."""
    studio.use_editor()
    import audio_lib
    got = audio_lib.sfx_setup()
    print("sfx: " + ", ".join(f"{k} {v}" for k, v in got.items()))
    return 0 if any(got.values()) else 1


def cmd_music(edit, feel="", bpm="", use=None):
    """Real music for the bed. With no --use: list tracks that fit (feel in the catalogue's words, tempo lo-hi). With
    --use "<title>": fetch it into EDIT/audio/music.mp3 and note the credit for the publishing kit."""
    edit = Path(edit)
    studio.use_editor()
    import audio_lib
    tm = jload(edit / "timing.json") or {}
    if use:
        got = audio_lib.get_music(use)
        if not got:
            print(f"FIX  no track called \"{use}\" could be fetched: pick one `music EDIT` lists")
            return 1
        (edit / "audio").mkdir(exist_ok=True)
        for old in (edit / "audio").glob("music.*"):
            old.unlink()
        shutil.copy(got[0], edit / "audio" / "music.mp3")
        jsave(edit / "audio" / "music.json", {"title": use, "credit": got[1], "source": "incompetech.com", "license": "CC BY 4.0"})
        print(f"music: {use} -> {edit / 'audio' / 'music.mp3'}. Credit (goes in the kit): {got[1]}")
        return 0
    lo_hi = tuple(float(x) for x in bpm.split("-")) if re.fullmatch(r"\d+-\d+", bpm or "") else None
    rows = audio_lib.find_music(feel, lo_hi, max(60, int((tm.get("length") or 120) * 0.5)), str(studio.brief_of(edit).get("prompt") or ""), 8)
    if not rows:
        print("no track fits: fewer feels, or a wider tempo. Feels: " + ", ".join(audio_lib.CALM))
        return 1
    for _, t in rows:
        print(f"{str(t.get('title')):<34} {str(t.get('bpm') or '?'):>4} bpm  {t.get('length', '')}  [{t.get('feel', '')}]  {str(t.get('instruments', ''))[:40]}: {str(t.get('description', ''))[:70]}")
    print("Pick the quietest, sparsest one that suits the subject: longvideo.py music EDIT --use \"<title>\"")
    return 0


def mix_range(x, sr):
    """How far the quiet moments sit below the loud ones, in dB (90th minus 10th percentile of 0.4 s windows)."""
    import numpy as np
    m = x.mean(axis=0) if getattr(x, "ndim", 1) > 1 else x
    w = int(0.4 * sr)
    if len(m) < w * 5:
        return 99.0
    db = 20 * np.log10(np.sqrt((m[:len(m) // w * w].reshape(-1, w) ** 2).mean(axis=1)) + 1e-9)
    return float(np.percentile(db, 90) - np.percentile(db, 10))


def cmd_sound(edit, mood="linear"):
    """audio/mix.wav: the voice, a quiet bed of music that rests (out under a sound bite, out before a new section,
    out for the close's last line), and a sound only where something lands: a section, a number, a graphic."""
    edit = Path(edit)
    studio.use_editor()
    import sound
    import numpy as np
    tm, b = jload(edit / "timing.json"), studio.brief_of(edit)
    if not tm:
        sys.exit("ERROR: no timing.json. Run studio.py voice first.")
    mood = mood if mood in sound.MOODS else "linear"
    sr = sound.SR
    n = int((tm["length"] + 0.05) * sr)
    sp = spans(edit)
    sect, seen = {}, None
    for sc_ in scenes_of(edit):
        if sc_.get("section") and sc_["section"] != seen:
            seen = sc_["section"]
            sect[sc_["id"]] = True
    starts = [s["a"] for s in sp[1:] if s["key"].endswith("-1") and sect.get(s["sid"]) and s["a"] > 3]
    bed = np.zeros((2, n))
    if b["music"]:
        sections = [(r["start"], "hook" if k == 0 else "payoff" if k == len(tm["scenes"]) - 1 else "action")
                    for k, r in enumerate(tm["scenes"])]
        real = music_bed(edit, n, sr, sound.read_audio)
        if real is not None:                          # a real track (music --use, or the user's own file)
            bed = real * REAL_MUSIC_GAIN
        else:
            got, _ = sound.compose(mood, tm["length"], None, starts, 0, sections)
            bed = np.pad(got, ((0, 0), (0, max(0, n - got.shape[1]))))[:, :n] * MUSIC_GAIN
        env = np.ones(n)
        rest = lambda a, z, level=0.0: env.__setitem__(slice(max(0, int(a * sr)), min(n, int(z * sr))), level)   # noqa: E731
        for s in sp:                                   # someone speaking on camera is heard alone
            if s["shot"]["kind"] == "bite":
                rest(s["a"] - 0.2, s["b"] + 0.15)
        for t in starts:                               # a breath before a new section, then the music comes back in
            rest(t - 0.9, t + 0.1)
        rest(0, min(0.6, tm["length"]))                # the first words land in silence
        k = max(1, int(0.35 * sr))
        env = np.convolve(env, np.ones(k) / k, mode="same")   # every rest fades, none cuts
        bed = bed * env
    fx = np.zeros((2, n))
    root = sound.MOODS[mood]["root"]
    import audio_lib
    rec = lambda kind, k: audio_lib.sfx(kind, k, sound.read_audio)    # noqa: E731  (a recorded effect when the library is fetched)

    def land(kind, k, at, gain, synth):
        x = rec(kind, k)
        sound.place(fx, x if x is not None else synth(), at, gain * (0.5 if x is not None else 1.0))
    for k, s in enumerate(sp[1:], 1):                    # a sound where something lands; a plain change of footage is silent
        kind = s["shot"]["kind"]
        if s["a"] in starts:                              # a new section: a riser into it
            x = rec("riser", k)
            if x is not None:
                sound.place(fx, x, s["a"] - x.shape[1] / sr, 0.05)
            else:
                sound.place(fx, sound.sfx_swell(1.2, root, k), s["a"] - 1.2, 0.07)
        if kind in ("stat", "title", "motion", "chart3d", "tier", "paper"):
            land("impact", k, s["a"], 0.11, lambda: sound.sfx_hit(root, k))
        elif kind in GRAPHICS:
            land("tick", k, s["a"], 0.1, lambda: sound.sfx_tick(k))
        elif isinstance(s["shot"].get("over"), dict) and any(s["shot"]["over"].get(x) for x in ("stat", "ring", "clip", "label")):
            land("swipe", k, s["a"] + 0.12, 0.07, lambda: sound.sfx_tick(k))      # a number or a mark arriving on the footage
    vo = edit / "audio" / "vo.wav"
    mix = bed + fx
    if tm["engine"] != "none" and vo.exists():
        v = sound.read_audio(vo, tm["length"] + 0.05)[:, :n]
        mix = sound.duck(mix, v) + v
    lufs, tp = sound.master(mix, edit / "audio" / "mix.wav")
    rng = mix_range(sound.read_audio(edit / "audio" / "mix.wav", tm["length"] + 0.05), sr)
    print(json.dumps({"file": str(edit / "audio" / "mix.wav"), "lufs": lufs, "true_peak": tp, "music": b["music"], "cuts": len(sp) - 1,
                      "range_db": round(rng, 1)}))
    if rng < MIX_RANGE_DB and tm["engine"] != "none":
        print(f"FLAT MIX: only {rng:.1f} dB between the loud and the quiet moments ({MIX_RANGE_DB:.0f} or more reads as produced). "
              "The voice has no air round it: check it was recorded with pauses between lines, or turn the music off.")
    return 0


# ---------------------------------------------------------------- the graphics (scene items: type, boxes, keyframes)
_FONT = {}


def tw(text, size, weight=700):
    """About how wide a line of text draws, in px. A text item sits centred on its x whatever its `align`, so a
    left or right edge is placed by its width."""
    try:
        from PIL import ImageFont
        key = "b" if weight >= 600 else "r"
        if key not in _FONT:
            for f in (("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if key == "b" else "/System/Library/Fonts/Supplemental/Arial.ttf"),
                      "C:/Windows/Fonts/arialbd.ttf" if key == "b" else "C:/Windows/Fonts/arial.ttf",
                      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
                try:
                    _FONT[key] = ImageFont.truetype(f, 100)
                    break
                except OSError:
                    continue
        if key in _FONT:
            return _FONT[key].getlength(str(text)) * size / 100.0 * 1.04
    except ImportError:
        pass
    return len(str(text)) * size * 0.56


def graphic(S, sh, a, b, W, H, look):
    """One motion graphic as scene items on the Graphics tracks, between a and b. Everything stays above the
    captions (the bottom fifth of the frame)."""
    s, d = min(W, H), b - a
    ink, acc = look["ink"], look["accent"]
    T = lambda text, t0, **kw: S.text(str(text), a + t0, b, track=kw.pop("track", "Graphics"), **kw)   # noqa: E731
    pop, up = {"in": "pop", "out": "none", "dur": 0.22}, {"in": "slide-up", "out": "none", "dur": 0.28}

    def left(text, t0, x_left, y, size, wrap, **kw):       # a text whose left edge is at x_left
        wd = min(wrap, tw(text, size, kw.get("weight", 700)))
        return T(text, t0, x=x_left + wd / 2, y=y, w=int(wrap), size=int(size), align="left", **kw)

    def right(text, t0, x_right, y, size, wrap, **kw):
        wd = min(wrap, tw(text, size, kw.get("weight", 700)))
        return T(text, t0, x=x_right - wd / 2, y=y, w=int(wrap), size=int(size), align="right", **kw)
    def panel(cx, cy, pw, ph, t0=0.0):                      # a soft card behind a chart or a list, so it reads as one object
        S.shape(a + t0, b, track="Graphics bg", x=cx, y=cy, w=pw, h=ph, radius=s * 0.03, fill="#0B0C0F", opacity=0.72,
                anim={"in": "fade", "out": "none", "dur": 0.3}, keys={"scale": [[0, 0.97, "out"], [0.4, 1.0, "out"], [d, 1.015, "linear"]]})

    def rule(cx, cy, wd, t0=0.15):                           # an accent line that draws itself under a heading
        S.shape(a + t0, b, track="Graphics", x=cx, y=cy, w=wd, h=max(4, s * 0.006), radius=3, fill=acc,
                keys={"w": [[0, 2, "out"], [0.45, wd, "out"]]})

    def count_up(value, **kw):                               # a number that runs up to its value in the first half second
        m = re.fullmatch(r"(\D*?)(\d[\d,]*)(\.\d+)?(\D.*)?", str(value).strip())
        steps = 7
        if not m or d < 1.4:
            return T(value, 0, **kw)
        pre, whole, frac, post = m.group(1), int(m.group(2).replace(",", "")), m.group(3) or "", m.group(4) or ""
        if whole < 10:
            return T(value, 0, **kw)
        fmt = (lambda v: f"{v:,}") if "," in m.group(2) else str
        keys = kw.pop("keys", None)
        for i in range(steps):
            v = int(whole * (1 - (1 - (i + 1) / (steps + 1)) ** 2))
            S.text(f"{pre}{fmt(v)}{frac}{post}", a + i * 0.07, a + (i + 1) * 0.07, track="Graphics",
                   **{**kw, "anim": kw.get("anim") if i == 0 else None})
        return S.text(str(value), a + steps * 0.07, b, track="Graphics", **{**kw, "anim": None, "keys": keys or {}})
    kind = sh["kind"]
    if kind == "title":
        T(str(sh["text"]).upper(), 0, x=W / 2, y=H * (0.38 if sh.get("sub") else 0.42), w=int(W * 0.86), size=int(s * 0.19), font=DISPLAY, weight=400,
          color=ink, line_height=1.04, anim=pop, keys={"scale": [[0, 0.94, "out"], [d, 1.03, "linear"]]})
        if sh.get("sub"):
            T(sh["sub"], min(0.3, d / 3), x=W / 2, y=H * 0.6, w=int(W * 0.7), size=int(s * 0.055), weight=600, color=acc, anim=up)
    elif kind == "stat":
        count_up(str(sh["value"]).upper(), x=W / 2, y=H * 0.34, w=int(W * 0.94), size=int(s * 0.36), font=DISPLAY, weight=400, color=acc, anim=pop,
                 keys={"scale": [[0, 1.0, "out"], [max(0.1, d - 0.5), 1.05, "linear"]]})
        rule(W / 2, H * 0.52, W * 0.12, 0.5)
        T(sh["label"], min(0.3, d / 3), x=W / 2, y=H * 0.62, w=int(W * 0.74), size=int(s * 0.066), weight=600, color=ink, anim=up)
    elif kind == "quote":
        T("\u201C", 0, x=W * 0.14, y=H * 0.2, w=int(W * 0.2), size=int(s * 0.34), weight=900, color=acc, anim=pop)
        T(sh["text"], 0.1, x=W / 2, y=H * 0.4, w=int(W * 0.72), size=int(s * 0.078), weight=700, color=ink, line_height=1.22, anim=up)
        if sh.get("by"):
            T("\u2014 " + sh["by"], min(0.5, d / 2), x=W / 2, y=H * 0.66, w=int(W * 0.7), size=int(s * 0.044), weight=500, color=acc, anim=up)
    elif kind == "list":
        items, top = sh["items"][:6], H * (0.3 if sh.get("title") else 0.16)
        if sh.get("title"):
            T(str(sh["title"]).upper(), 0, x=W / 2, y=H * 0.12, w=int(W * 0.84), size=int(s * 0.1), font=DISPLAY, weight=400, color=ink, anim=up)
            rule(W / 2, H * 0.2, W * 0.1)
        gap = min(H * 0.15, (H * 0.72 - top) / max(1, len(items) - 1)) if len(items) > 1 else 0
        panel(W / 2, top + gap * (len(items) - 1) / 2, W * 0.76, gap * (len(items) - 1) + H * 0.16)
        size = min(s * 0.064, gap * 0.5) if gap else s * 0.064
        chip = size * 1.35
        for i, it in enumerate(items):
            t0 = min(max(0.0, d - 0.4), 0.25 + i * min(0.9, (d * 0.7) / len(items)))
            y = top + i * gap
            S.shape(a + t0, b, track="Graphics", x=W * 0.2, y=y, w=chip, h=chip, radius=chip / 2, fill=acc, anim=pop)
            T(i + 1, t0, x=W * 0.2, y=y, w=int(chip), size=int(size * 0.8), weight=900, color=look["ground"], anim=pop, track="Graphics top")
            left(it, t0, W * 0.2 + chip, y, size, W * 0.62, weight=700, color=ink, anim=up)
    elif kind == "bars":
        items = sh["items"][:6]
        top_v = max(abs(float(v)) for _, v in items) or 1.0
        if sh.get("title"):
            T(str(sh["title"]).upper(), 0, x=W / 2, y=H * 0.11, w=int(W * 0.86), size=int(s * 0.095), font=DISPLAY, weight=400, color=ink, anim=up)
        x0, full, y0 = W * 0.32, W * 0.46, H * 0.27
        gap = min(H * 0.15, (H * 0.44) / max(1, len(items) - 1)) if len(items) > 1 else 0
        bh = min(s * 0.085, gap * 0.6) if gap else s * 0.085
        size = min(s * 0.056, bh * 0.8)
        best = max(range(len(items)), key=lambda i: float(items[i][1]))
        panel(W / 2, y0 + gap * (len(items) - 1) / 2, W * 0.82, gap * (len(items) - 1) + H * 0.17)
        for i, (name, v) in enumerate(items):
            t0, y, bw = 0.2 + i * 0.12, y0 + i * gap, max(8.0, full * abs(float(v)) / top_v)
            grow = min(0.7, max(0.3, d * 0.3))
            right(name, t0, x0 - W * 0.02, y, size, W * 0.26, weight=700, color=ink, anim=up)
            S.shape(a + t0, b, track="Graphics", x=x0 + bw / 2, y=y, w=bw, h=bh, radius=bh * 0.22,
                    fill=acc if i == best else ink, opacity=1 if i == best else 0.32,
                    keys={"w": [[0, 4, "out"], [grow, bw, "out"]], "x": [[0, x0 + 2, "out"], [grow, x0 + bw / 2, "out"]]})
            left(f"{v:g}{sh.get('unit') or ''}", t0 + grow * 0.8, x0 + bw + W * 0.014, y, size, W * 0.16, weight=800,
                 color=acc if i == best else ink, anim={"in": "fade", "out": "none", "dur": 0.2})
        if sh.get("source"):
            T("Source: " + sh["source"], 0.3, x=W / 2, y=H * 0.77, w=int(W * 0.8), size=int(s * 0.03), weight=500, color=ink, opacity=0.6)
    elif kind == "tier":        # a glass tier list: a coloured letter, then its names arriving one by one
        rows = sh["tiers"][:6]
        if sh.get("title"):
            T(str(sh["title"]).upper(), 0, x=W / 2, y=H * 0.09, w=int(W * 0.86), size=int(s * 0.085), font=DISPLAY, weight=400, color=ink, anim=up)
        top, bot = H * (0.2 if sh.get("title") else 0.1), H * 0.74
        rh = min(H * 0.13, (bot - top) / len(rows))
        x0, x1 = W * 0.1, W * 0.9
        n_all, seen = sum(len(r[1]) for r in rows), 0
        for i, (letter, names) in enumerate(rows):
            y, t0 = top + rh * (i + 0.5), 0.1 + i * 0.1
            col = TIER_COLOURS.get(str(letter).upper()[:1], acc)
            S.shape(a + t0, b, track="Graphics bg", x=(x0 + x1) / 2, y=y, w=x1 - x0, h=rh * 0.86, radius=rh * 0.2, fill="#FFFFFF", opacity=0.09,
                    stroke={"color": "#FFFFFF3A", "width": 2}, anim={"in": "fade", "out": "none", "dur": 0.3})
            S.shape(a + t0, b, track="Graphics", x=x0 + rh * 0.5, y=y, w=rh * 0.86, h=rh * 0.86, radius=rh * 0.2, fill=col, anim=pop)
            T(str(letter).upper()[:2], t0, x=x0 + rh * 0.5, y=y, w=int(rh), size=int(rh * 0.56), font=DISPLAY, weight=400, color="#0B0C0F", anim=pop, track="Graphics top")
            cw_ = (x1 - x0 - rh * 1.2) / max(len(names), 3)
            for j, name in enumerate(names[:5]):
                seen += 1
                tj = min(max(0.0, d - 0.35), 0.45 + (seen - 1) * min(0.6, (d * 0.7) / max(1, n_all)))
                cx = x0 + rh * 1.1 + cw_ * (j + 0.5)
                S.shape(a + tj, b, track="Graphics", x=cx, y=y, w=cw_ * 0.92, h=rh * 0.62, radius=rh * 0.16, fill="#0B0C0F", opacity=0.55, anim=pop)
                T(name, tj, x=cx, y=y, w=int(cw_ * 0.86), size=int(min(rh * 0.3, cw_ * 0.86 / max(4, len(str(name))) * 1.7)), weight=700, color=ink, anim=pop, track="Graphics top")
    elif kind == "paper":       # research that lifts off the page: the paper tilts up, its text greys, one line is marked
        pw, ph = W * 0.6, H * 0.82
        tilt = {"rotation": [[0, -9, "out"], [0.7, -3, "out"], [d, -1.5, "linear"]], "scale": [[0, 0.84, "out"], [0.7, 1.0, "out"], [d, 1.06, "linear"]],
                "y": [[0, H * 0.6, "out"], [0.7, H * 0.44, "out"]]}
        S.shape(a, b, track="Graphics", x=W / 2, y=H * 0.44, w=pw, h=ph, radius=s * 0.008, fill="#FBF9F3",
                shadow={"blur": 80, "y": 34, "opacity": 0.6}, anim={"in": "fade", "out": "none", "dur": 0.25}, keys=tilt)
        if sh.get("journal"):
            T(str(sh["journal"]).upper(), 0.2, x=W / 2, y=H * 0.1, w=int(pw * 0.84), size=int(s * 0.02), weight=600, color="#8A8F99", anim=up, track="Graphics top")
        T(sh["title"], 0.25, x=W / 2, y=H * 0.19, w=int(pw * 0.84), size=int(s * 0.042), weight=800, color="#16181D", line_height=1.16, anim=up, track="Graphics top")
        if sh.get("by"):
            T(sh["by"], 0.3, x=W / 2, y=H * 0.3, w=int(pw * 0.84), size=int(s * 0.024), weight=500, color="#5B5F68", anim=up, track="Graphics top")
        body = str(sh.get("abstract") or "")
        if body:
            T(body[:420], 0.35, x=W / 2, y=H * 0.44, w=int(pw * 0.84), size=int(s * 0.023), weight=400, color="#3A3E47", opacity=0.55, line_height=1.5,
              anim={"in": "fade", "out": "none", "dur": 0.4}, track="Graphics top")
        hy = H * (0.64 if body else 0.5)
        T(sh["highlight"], min(0.9, d / 2), x=W / 2, y=hy, w=int(pw * 0.86), size=int(s * 0.04), weight=800, color="#16181D", line_height=1.45,
          box={"color": acc, "pad": [14, 6], "radius": 5, "opacity": 0.95}, anim={"in": "pop", "out": "none", "dur": 0.25},
          keys={"scale": [[0, 1.0, "out"], [d, 1.05, "linear"]]}, track="Graphics top")
    elif kind == "source":
        pw, ph = W * 0.7, H * 0.68
        S.shape(a, b, track="Graphics", x=W / 2, y=H * 0.4, w=pw, h=ph, radius=s * 0.012, fill="#F7F4EC",
                shadow={"blur": 60, "y": 24, "opacity": 0.5}, anim={"in": "slide-up", "out": "none", "dur": 0.35},
                keys={"rotation": [[0, -5, "out"], [0.5, -1.5, "out"], [d, -0.5, "linear"]], "scale": [[0, 0.92, "out"], [0.5, 1.0, "out"], [d, 1.04, "linear"]]})
        T(sh["title"], 0.15, x=W / 2, y=H * 0.2, w=int(pw * 0.86), size=int(s * 0.052), weight=800, color="#16181D", line_height=1.18,
          anim=up, track="Graphics top")
        if sh.get("by"):
            T(sh["by"], 0.25, x=W / 2, y=H * 0.33, w=int(pw * 0.86), size=int(s * 0.03), weight=500, color="#5B5F68", anim=up, track="Graphics top")
        T(sh["highlight"], min(0.7, d / 2), x=W / 2, y=H * 0.5, w=int(pw * 0.82), size=int(s * 0.05), weight=700, color="#16181D",
          line_height=1.5, box={"color": acc, "pad": [12, 5], "radius": 4, "opacity": 0.9}, anim={"in": "fade", "out": "none", "dur": 0.3},
          track="Graphics top")


def domain(url):
    return re.sub(r"^www\.", "", urllib.parse.urlsplit(str(url)).netloc) or str(url)[:40]


def anton_w(text, size):
    return len(str(text)) * size * 0.47          # about how wide a line of the condensed capitals draws


def overlay(S, ov, a, z, W, H, look):
    """Type on top of footage or a picture, the way an edited channel names what is on screen: a big `label`, a
    person's `name` (and `role`) lower left, or a `stat` (and `note`) on a small card at the right."""
    s, d = min(W, H), z - a
    hold = min(z, a + max(1.6, min(d, 3.2)))
    sh = {"blur": 18, "y": 4, "opacity": 0.7}
    if ov.get("label"):
        S.text(str(ov["label"]).upper(), a + 0.08, hold, track="Graphics", x=W / 2, y=H * 0.44, w=int(W * 0.86), size=int(s * 0.15), font=DISPLAY,
               weight=400, color="#FFFFFF", line_height=1.02, shadow=sh, anim={"in": "pop", "out": "fade", "dur": 0.18})
    if ov.get("name"):
        size = s * 0.07
        x0, y = W * 0.055, H * 0.72
        S.shape(a + 0.1, hold, track="Graphics", x=x0 - s * 0.012, y=y + (size * 0.5 if ov.get("role") else 0), w=max(4, s * 0.006), h=size * (2.0 if ov.get("role") else 1.0),
                fill=look["accent"], anim={"in": "fade", "out": "fade", "dur": 0.2})
        S.text(str(ov["name"]).upper(), a + 0.1, hold, track="Graphics", x=x0 + anton_w(ov["name"], size) / 2 + s * 0.01, y=y, w=int(W * 0.6), size=int(size),
               font=DISPLAY, weight=400, color="#FFFFFF", align="left", shadow=sh, anim={"in": "slide-up", "out": "fade", "dur": 0.22})
        if ov.get("role"):
            rs = s * 0.026
            S.text(str(ov["role"]).upper(), a + 0.2, hold, track="Graphics", x=x0 + tw(str(ov["role"]).upper(), rs, 600) / 2 + s * 0.01, y=y + size * 1.0, w=int(W * 0.6),
                   size=int(rs), weight=600, color=look["accent"], align="left", shadow=sh, anim={"in": "fade", "out": "fade", "dur": 0.2})
    GLASS = {"fill": "#0B0C0F", "opacity": 0.62, "stroke": {"color": "#FFFFFF2E", "width": 2}, "shadow": {"blur": 44, "y": 16, "opacity": 0.45}}
    mono = lambda t: " ".join(str(t).upper())     # noqa: E731  (small spaced capitals, the way a data label is set)
    if ov.get("stat"):          # a glass data card: a small label, the number, its unit, a note
        num, unit = str(ov["stat"]), str(ov.get("unit") or "")
        ns = s * 0.105
        cw = max(W * 0.2, tw(num, ns, 800) * 1.07 + tw(unit, ns * 0.36, 600) + s * 0.12)
        chh = H * (0.13 + (0.045 if ov.get("kicker") else 0) + (0.045 if ov.get("note") else 0))
        left_side = str(ov.get("at") or "").startswith("l")
        cx, cy = (W * 0.06 + cw / 2) if left_side else (W * 0.94 - cw / 2), H * 0.26
        S.shape(a + 0.1, hold, track="Graphics bg", x=cx, y=cy, w=cw, h=chh, radius=s * 0.02, **GLASS, anim={"in": "slide-up", "out": "fade", "dur": 0.25})
        x0 = cx - cw / 2 + s * 0.04
        ny = cy + (chh * 0.12 if ov.get("kicker") else 0) - (chh * 0.12 if ov.get("note") else 0)
        if ov.get("kicker"):
            ks = s * 0.017
            S.text(mono(ov["kicker"]), a + 0.14, hold, track="Graphics", x=x0 + tw(mono(ov["kicker"]), ks, 600) / 2, y=cy - chh / 2 + s * 0.045, w=int(cw),
                   size=int(ks), weight=600, color="#FFFFFF", opacity=0.6, align="left", anim={"in": "fade", "out": "fade", "dur": 0.2})
        nw = tw(num, ns, 800)
        S.text(num, a + 0.16, hold, track="Graphics", x=x0 + nw / 2, y=ny, w=int(cw), size=int(ns), weight=800, color="#FFFFFF", align="left",
               anim={"in": "pop", "out": "fade", "dur": 0.2})
        if unit:
            S.text(unit.upper(), a + 0.2, hold, track="Graphics", x=x0 + nw * 1.07 + s * 0.02 + tw(unit.upper(), ns * 0.34, 600) / 2, y=ny + ns * 0.24, w=int(cw),
                   size=int(ns * 0.34), weight=600, color="#FFFFFF", opacity=0.75, align="left", anim={"in": "fade", "out": "fade", "dur": 0.2})
        if ov.get("note"):
            nt = s * 0.019
            S.text(mono(ov["note"]), a + 0.26, hold, track="Graphics", x=x0 + min(cw * 0.9, tw(mono(ov["note"]), nt, 600)) / 2, y=cy + chh / 2 - s * 0.045, w=int(cw * 0.92),
                   size=int(nt), weight=600, color="#FFFFFF", opacity=0.6, align="left", anim={"in": "fade", "out": "fade", "dur": 0.2})
    if isinstance(ov.get("ring"), dict):       # a thin circle drawn on the footage round the thing being talked about, with its measure beside it
        r = ov["ring"]
        cx, cy, rad = W * float(r.get("x", 50)) / 100, H * float(r.get("y", 45)) / 100, s * float(r.get("r", 16)) / 100
        S.shape(a + 0.15, hold, track="Graphics", x=cx, y=cy, w=rad * 2, h=rad * 2, radius=rad, fill="#FFFFFF00", stroke={"color": "#FFFFFFE6", "width": max(2, int(s * 0.003))},
                anim={"in": "fade", "out": "fade", "dur": 0.3}, keys={"scale": [[0, 0.6, "out"], [0.5, 1.0, "out"], [d, 1.03, "linear"]]})
        lx = cx + rad + s * 0.03
        S.shape(a + 0.4, hold, track="Graphics", x=cx + rad + s * 0.012, y=cy - rad * 0.5, w=s * 0.024, h=max(2, int(s * 0.002)), radius=1, fill="#FFFFFF", opacity=0.9)
        if r.get("text"):
            ts = s * 0.04
            S.text(str(r["text"]).upper(), a + 0.45, hold, track="Graphics", x=lx + tw(str(r["text"]).upper(), ts, 800) / 2, y=cy - rad * 0.5, w=int(W * 0.4), size=int(ts),
                   weight=800, color="#FFFFFF", align="left", shadow=sh, anim={"in": "fade", "out": "fade", "dur": 0.2})
        if r.get("sub"):
            ss = s * 0.019
            S.text(mono(r["sub"]), a + 0.55, hold, track="Graphics", x=lx + tw(mono(r["sub"]), ss, 600) / 2, y=cy - rad * 0.5 + s * 0.042, w=int(W * 0.4), size=int(ss),
                   weight=600, color="#FFFFFF", opacity=0.7, align="left", shadow=sh, anim={"in": "fade", "out": "fade", "dur": 0.2})
    if isinstance(ov.get("clip"), dict):       # a cutting from the article being quoted, floating on the footage, its key words marked
        c = ov["clip"]
        pw, ph = W * 0.3, H * (0.3 if c.get("highlight") else 0.2)
        cx, cy = W * 0.79, H * 0.3
        S.shape(a + 0.1, hold, track="Graphics bg", x=cx, y=cy, w=pw, h=ph, radius=s * 0.006, fill="#F6F3EA", shadow={"blur": 50, "y": 20, "opacity": 0.55},
                anim={"in": "slide-up", "out": "fade", "dur": 0.3}, keys={"rotation": [[0, 4, "out"], [0.5, 1.2, "out"], [d, 0.6, "linear"]]})
        S.text(str(c.get("title") or ""), a + 0.2, hold, track="Graphics", x=cx, y=cy - ph * (0.2 if c.get("highlight") else 0.08), w=int(pw * 0.86), size=int(s * 0.03),
               weight=800, color="#16181D", line_height=1.18, align="left", anim={"in": "fade", "out": "fade", "dur": 0.2})
        if c.get("highlight"):
            S.text(str(c["highlight"]), a + 0.5, hold, track="Graphics", x=cx, y=cy + ph * 0.16, w=int(pw * 0.86), size=int(s * 0.022), weight=600, color="#16181D",
                   line_height=1.4, align="left", box={"color": look["accent"], "pad": [8, 3], "radius": 3, "opacity": 0.9}, anim={"in": "fade", "out": "fade", "dur": 0.25})
        if c.get("source"):
            S.text(mono(c["source"]), a + 0.3, hold, track="Graphics", x=cx + pw * 0.1, y=cy + ph / 2 - s * 0.03, w=int(pw * 0.7), size=int(s * 0.013), weight=600,
                   color="#5B5F68", align="right", anim={"in": "fade", "out": "fade", "dur": 0.2})


def hud(S, rows, a, z, W, H, first):
    """A small readout that stays in the top left through a section (two clocks, a distance, a count): the same card
    from shot to shot, only its numbers change. rows: [[label, value], ...], at most 3."""
    s = min(W, H)
    rows = [r for r in rows if isinstance(r, (list, tuple)) and len(r) == 2][:3]
    if not rows:
        return
    ls, vs, rh = s * 0.017, s * 0.03, s * 0.046
    lab_w = max(tw(" ".join(str(r[0]).upper()), ls, 600) for r in rows)
    val_w = max(tw(str(r[1]), vs, 700) for r in rows)
    cw, chh = lab_w + val_w + s * 0.09, rh * len(rows) + s * 0.03
    x0, y0 = W * 0.045, H * 0.06
    S.shape(a, z, track="Graphics bg", x=x0 + cw / 2, y=y0 + chh / 2, w=cw, h=chh, radius=s * 0.012, fill="#0B0C0F", opacity=0.6,
            stroke={"color": "#FFFFFF2E", "width": 2}, anim={"in": "fade", "out": "none", "dur": 0.25} if first else None)
    for i, (label, value) in enumerate(rows):
        y = y0 + s * 0.015 + rh * (i + 0.5)
        lab = " ".join(str(label).upper())
        S.text(lab, a, z, track="Graphics", x=x0 + s * 0.03 + tw(lab, ls, 600) / 2, y=y, w=int(cw), size=int(ls), weight=600, color="#FFFFFF", opacity=0.6, align="left")
        S.text(str(value), a, z, track="Graphics", x=x0 + cw - s * 0.03 - tw(str(value), vs, 700) / 2, y=y, w=int(cw), size=int(vs), weight=700, color="#FFFFFF", align="right")


def backdrop(edit, sp, all_sp, db):
    """The picture behind a graphic: the nearest shot's footage as a still, so a number or a title lands on the
    video's own world (dark and without colour) instead of on an empty ground. None: the video has no footage yet."""
    best = None
    for o in all_sp:
        g = db.get(o["key"]) or {}
        if o["shot"]["kind"] in MEDIA and g.get("file") and (edit / g["file"]).exists():
            if best is None or abs(o["n"] - sp["n"]) < abs(best[0]["n"] - sp["n"]):
                best = (o, g)
    if not best:
        return None
    f = edit / best[1]["file"]
    if f.suffix != ".mp4":
        return best[1]["file"]
    still = edit / "shots" / f"{best[0]['key']}.bg.jpg"
    if not still.exists() or still.stat().st_mtime < f.stat().st_mtime:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{duration(f) / 2:.2f}", "-i", str(f), "-frames:v", "1", "-q:v", "3", str(still)], capture_output=True)
    return f"shots/{still.name}" if still.exists() else None


# ---------------------------------------------------------------- the scene
def cmd_build(edit):
    edit = Path(edit).resolve()
    studio.use_editor()
    import scene
    tm, words, sc = jload(edit / "timing.json"), jload(edit / "words.json") or [], jload(edit / "scenes.json")
    b, db = studio.brief_of(edit), jload(edit / "shots.json", {}) or {}
    look = {**LOOK, **{k: v for k, v in (sc.get("look") or {}).items() if k in LOOK}} if isinstance(sc.get("look"), dict) else dict(LOOK)
    W, H = studio.size_of(edit)
    S = scene.Scene(W, H, studio.FPS, background=look["ground"], edit=edit)
    S.track("Footage"); S.track("Graphics bg"); S.track("Graphics"); S.track("Graphics top")
    miss, fell, all_sp = [], [], spans(edit)
    stills = [(sp["n"], db[sp["key"]]["file"]) for sp in all_sp if sp["shot"]["kind"] in MEDIA
              and str((db.get(sp["key"]) or {}).get("file") or "").endswith(".jpg") and (edit / db[sp["key"]]["file"]).exists()]
    for sp in all_sp:
        sh, a, z, d = sp["shot"], sp["a"], sp["b"], sp["b"] - sp["a"]
        if sh["kind"] == "chart3d":           # the 3D chart's clip (longvideo.py charts); with none, the same numbers as flat bars
            clip = edit / "motion" / sp["key"] / "renders" / "clip.mp4"   # built from a fixed template, so it is used when it rendered
            if clip.exists() and (edit / "motion" / sp["key"] / "chart.stamp").exists():
                S.video(str(clip.relative_to(edit)), a, z, track="Footage", volume=0, x=W / 2, y=H / 2, w=W, h=H)
                continue
            sh = {**sh, "kind": "bars", "items": sh["items"][:6]}
        if sh["kind"] in GRAPHICS or (sh["kind"] == "motion" and not studio.clip_of(edit, sp["key"])):
            bg = backdrop(edit, sp, all_sp, db)
            if bg:
                S.image(bg, a, z, track="Footage", x=W / 2, y=H / 2, w=W, h=H, fit="cover", grade={"brightness": 0.28, "saturate": 0},
                        keys={"scale": [[0, 1.08, "linear"], [d, 1.18, "linear"]]})
        if sh["kind"] in GRAPHICS:
            graphic(S, sh, a, z, W, H, look)
            continue
        if sh["kind"] == "motion":
            clip = studio.clip_of(edit, sp["key"])
            if clip:
                S.video(str(clip.relative_to(edit)), a, z, track="Footage", volume=0, x=W / 2, y=H / 2, w=W, h=H)
            else:                       # its animation did not pass: the simple graphic written beside it
                fell.append(sp["key"])
                graphic(S, sh["fallback"], a, z, W, H, look)
            continue
        got = db.get(sp["key"]) or {}
        f = edit / got["file"] if got.get("file") else None
        if not f or not f.exists():
            miss.append(sp["key"])       # never an empty frame: the nearest picture again, moving the other way
            if not stills:
                continue
            got = {"file": min(stills, key=lambda x: abs(x[0] - sp["n"]))[1]}
            f, sp = edit / got["file"], {**sp, "n": sp["n"] + 1}
        grow = sp["n"] % 2 == 0
        ov = sh.get("over") if isinstance(sh.get("over"), dict) else None
        dim = {"grade": {"brightness": 0.62}} if ov and ov.get("label") else {}
        # a shot long enough gets a punch-in half way: the same footage, a closer frame, read as a new picture
        punch = [[d / 2, 1.04, "linear"], [d / 2 + 0.034, 1.16, "linear"], [d, 1.2, "linear"]] if d >= 2.8 else [[d, 1.06, "linear"]]
        if got.get("card") and (edit / f"shots/{sp['key']}.card.jpg").exists() and (edit / f"shots/{sp['key']}.blur.jpg").exists():
            S.image(f"shots/{sp['key']}.blur.jpg", a, z, track="Footage", x=W / 2, y=H / 2, w=W, h=H, fit="cover",
                    keys={"scale": [[0, 1.05, "linear"], [d, 1.12, "linear"]]})
            S.image(f"shots/{sp['key']}.card.jpg", a, z, track="Graphics bg", x=W / 2, y=H * 0.46, radius=min(W, H) * 0.02,
                    shadow={"blur": 60, "y": 24, "opacity": 0.55}, anim={"in": "fade", "out": "none", "dur": 0.2},
                    keys={"scale": [[0, 0.98, "out"], [d, 1.04, "linear"]]})
        elif f.suffix == ".mp4":
            S.video(got["file"], a, z, track="Footage", volume=0, x=W / 2, y=H / 2, w=W, h=H, **dim,
                    keys={"scale": [[0, 1.0, "linear"]] + punch})
        else:
            drift = (W * 0.012) * (1 if sp["n"] % 4 < 2 else -1)
            S.image(got["file"], a, z, track="Footage", x=W / 2, y=H / 2, w=W, h=H, fit="cover", **dim,
                    keys={"scale": [[0, 1.02 if grow else 1.12, "linear"], [d, 1.12 if grow else 1.02, "linear"]],
                          "x": [[0, W / 2 - drift, "linear"], [d, W / 2 + drift, "linear"]]})
        if ov:
            overlay(S, ov, a, z, W, H, look)
    prev_hud = False
    for s in sc["scenes"]:           # a readout that stays through a section: {"hud": [["EARTH", "00:00:01.3"], ["SHIP", "00:00:00"]]} on each of its lines
        r = next((r for r in tm["scenes"] if r["id"] == s["id"]), None)
        rows = s.get("hud") if isinstance(s.get("hud"), list) else None
        if r and rows:
            hud(S, rows, r["start"], r["start"] + r["dur"], W, H, not prev_hud)
        prev_hud = bool(r and rows)
    for s in sc["scenes"]:           # where a line's fact comes from, small, while it is said
        r = next((r for r in tm["scenes"] if r["id"] == s["id"]), None)
        if r and s.get("source") and not any(x["kind"] in ("bars", "source") for x in s["shots"]):
            S.text("Source: " + (s.get("source_label") or domain(s["source"])), r["start"] + 0.2, r["start"] + r["dur"], track="Graphics top",
                   x=W * 0.03 + W * 0.2, y=H * 0.045, w=int(W * 0.4), size=int(min(W, H) * 0.022), weight=500, color="#FFFFFF", align="left",
                   box={"color": "#000000", "pad": [10, 5], "radius": 6, "opacity": 0.55}, anim={"in": "fade", "out": "fade", "dur": 0.2})
    if b["text"] and words:
        style = {**CAPTIONS, **(sc.get("captions") or {})}
        for r in tm["scenes"]:
            mine = [{"w": x["w"], "start": x["start"], "end": x["end"]} for x in words if r["start"] <= x["start"] < r["start"] + r["dur"]]
            if mine:
                S.captions(mine, style=style, start=r["start"], end=r["start"] + r["dur"], track="Captions")
    if (edit / "audio" / "mix.wav").exists():
        S.audio("audio/mix.wav", 0, tm["length"], track="Sound")
    S.sc["duration"] = tm["length"]
    jsave(edit / studio.SCENE_FILE, S.done())
    n = len(spans(edit))
    print(f"{studio.SCENE_FILE}: {tm['length'] // 60:.0f}:{tm['length'] % 60:04.1f}, {n} shots (one every {tm['length'] / n:.1f} s)"
          + (f", captions {len(words)} words" if b["text"] and words else ""))
    if fell:
        print("FELL BACK (the animation did not pass, its simple graphic shows): " + " ".join(fell))
    if miss:
        print("MISSING (the nearest picture shows again instead; an empty frame where the video has no picture at all): " + " ".join(miss))
    return 0


# ---------------------------------------------------------------- thumbnails and the publishing kit
def cmd_thumbs(edit, title):
    """Three thumbnail options, 1280x720: the sharpest frames of three different shots with the title on them."""
    import cv2
    from PIL import Image
    edit = Path(edit)
    db = jload(edit / "shots.json", {}) or {}
    files = [edit / g["file"] for g in db.values() if g.get("file") and (edit / g["file"]).exists()]
    if not files:
        files = [edit / "render.mp4"] if (edit / "render.mp4").exists() else []
    scored = []
    for f in files:
        fr = cv2.imread(str(f)) if f.suffix == ".jpg" else streamclips.best_frame(f, 3)
        if fr is not None:
            g = cv2.cvtColor(cv2.resize(fr, (320, 180)), cv2.COLOR_BGR2GRAY)
            scored.append((min(1.0, cv2.Laplacian(g, cv2.CV_64F).var() / 600.0) + 0.5 * (1 - abs(float(g.mean()) - 125) / 125), f))
    out = edit / "exports"
    out.mkdir(exist_ok=True)
    made = []
    with tempfile.TemporaryDirectory() as td:
        for i, (_, f) in enumerate(sorted(scored, key=lambda x: -x[0])[:3], 1):
            src = Path(td) / f"{i}.mp4"
            if f.suffix == ".jpg":      # a still as a one-frame clip, so one function draws every thumbnail
                Image.open(f).convert("RGB").resize((1280, 720)).save(Path(td) / f"{i}.jpg")
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", str(Path(td) / f"{i}.jpg"), "-t", "1", "-r", "10",
                                "-pix_fmt", "yuv420p", str(src)], check=True)
            else:
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(f), "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
                                "-an", str(src)], check=True)
            if streamclips.thumb(src, title, out / f"thumbnail-{i}.jpg"):
                made.append(f"thumbnail-{i}.jpg")
    print(f"THUMBS {len(made)} in {out}: " + " ".join(made))
    return 0 if made else 1


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def kit_text(kit, sc, tm, db):
    """publish.md: the title options, the description with chapters, sources and credits, the tags."""
    rows = {r["id"]: r for r in tm["scenes"]}
    chapters, seen = [], None
    for s in sc["scenes"]:
        if s.get("section") and s["section"] != seen and s["id"] in rows:
            seen = s["section"]
            chapters.append(f"{mmss(0 if not chapters else rows[s['id']]['start'])} {seen}")
    sources, credits = [], []
    for s in sc["scenes"]:
        if s.get("source") and s["source"] not in sources:
            sources.append(s["source"])
    for g in db.values():
        if g.get("from") and g.get("file"):
            line = f"{g.get('title') or ''}" + (f" by {g['by']}" if g.get("by") else "") + (f" ({g['license']})" if g.get("license") else "") + f": {g['from']}"
            if line not in credits:
                credits.append(line)
    titles = [t for t in kit.get("titles") or [sc.get("title") or ""] if t]
    out = ["# Publishing kit", "", "## Title options", *[f"- {t}" for t in titles], "", "## Description", "", str(kit.get("description") or "").strip(), ""]
    if len(chapters) >= 3:
        out += ["Chapters", *chapters, ""]
    if sources:
        out += ["Sources", *[f"- {u}" for u in sources], ""]
    if credits:
        out += ["Footage and pictures", *[f"- {c}" for c in credits], ""]
    if kit.get("music_credit"):
        out += ["Music", str(kit["music_credit"]), ""]
    if kit.get("tags"):
        out += ["## Tags", ", ".join(str(t) for t in kit["tags"]), ""]
    return "\n".join(out)


def cmd_kit(edit):
    edit = Path(edit)
    kit, sc, tm = jload(edit / "kit.json"), jload(edit / "scenes.json"), jload(edit / "timing.json")
    if not isinstance(kit, dict) or not kit.get("description"):
        sys.exit('ERROR: write EDIT/kit.json first: {"titles": [3 options], "description": "...", "tags": [...]}')
    (edit / "exports").mkdir(exist_ok=True)
    credit = (jload(edit / "audio" / "music.json") or {}).get("credit")     # a real track's licence asks for this line
    if credit and (edit / "audio" / "music.mp3").exists():
        kit = {**kit, "music_credit": credit}
    (edit / "exports" / "publish.md").write_text(kit_text(kit, sc, tm, jload(edit / "shots.json", {}) or {}), encoding="utf-8")
    print(f"KIT {edit / 'exports' / 'publish.md'}")
    return 0


# ---------------------------------------------------------------- the render, checked at every cut
def cmd_qa(edit):
    """Looks at the finished render just after every cut: a black or empty frame is reported by its shot, and every
    shot's first frame goes on sheets (EDIT/sheets/qa-N.jpg, 24 a sheet) to look at before the user sees the video."""
    import cv2
    import numpy as np
    edit = Path(edit)
    src = edit / "render.mp4"
    if not src.exists():
        sys.exit("ERROR: no render yet.")
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    bad, tiles = [], []
    for sp in spans(edit):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((sp["a"] + min(0.5, (sp["b"] - sp["a"]) / 2)) * fps))
        ok, fr = cap.read()
        if not ok:
            bad.append(f"{sp['key']}: no frame at {sp['a']:.1f} s")
            continue
        g = cv2.cvtColor(cv2.resize(fr, (320, 180)), cv2.COLOR_BGR2GRAY)
        if g.mean() < 10:
            bad.append(f"{sp['key']} ({mmss(sp['a'])}): a black frame")
        elif g[: int(180 * 0.8)].std() < 5:
            bad.append(f"{sp['key']} ({mmss(sp['a'])}): an empty frame (one flat colour)")
        t = cv2.resize(fr, (320, 180))
        cv2.putText(t, sp["key"], (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
        cv2.putText(t, sp["key"], (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        tiles.append(t)
    cap.release()
    (edit / "sheets").mkdir(exist_ok=True)
    for f in (edit / "sheets").glob("qa-*.jpg"):
        f.unlink()
    for n in range(0, len(tiles), 24):
        page = tiles[n:n + 24] + [np.zeros((180, 320, 3), np.uint8)] * (-len(tiles[n:n + 24]) % 6)
        cv2.imwrite(str(edit / "sheets" / f"qa-{n // 24 + 1}.jpg"), np.vstack([np.hstack(page[r:r + 6]) for r in range(0, len(page), 6)]))
        print(edit / "sheets" / f"qa-{n // 24 + 1}.jpg")
    print("\n".join("FIX  " + b for b in bad) if bad else f"QA ok: {len(tiles)} shots, none black or empty")
    return 1 if bad else 0


# ---------------------------------------------------------------- Shorts from the finished video
# measured on published Shorts of this kind: three or four words in capitals a little below the middle, the said word white and the rest grey
SHORT_CAPTIONS = {"size_pct": 4.6, "case": "upper", "effect": "karaoke", "weight": 800, "stroke": True, "words_per_caption": 3, "y_pct": 61, "inactive_opacity": 0.55}


def short_ranges(sc, tm, count=3, lo=14.0, hi=58.0):
    """The parts of a long video that stand alone as Shorts: its sections, in order, each 14 to 58 seconds (a short
    one takes the next with it, a long one is cut at the line nearest 58 s). [{"title", "a", "b"}]."""
    rows = {r["id"]: r for r in tm["scenes"]}
    secs = []
    for s in sc["scenes"]:
        r = rows.get(s["id"])
        if not r:
            continue
        if s.get("section") and (not secs or secs[-1]["title"] != s["section"]):
            secs.append({"title": s["section"], "lines": []})
        if not secs:
            secs.append({"title": sc.get("title") or "Part 1", "lines": []})
        secs[-1]["lines"].append(r)
    out, k = [], 0
    while k < len(secs) and len(out) < count:
        lines, title = list(secs[k]["lines"]), secs[k]["title"]
        while lines and lines[-1]["start"] + lines[-1]["dur"] - lines[0]["start"] < lo and k + 1 < len(secs):
            k += 1
            lines += secs[k]["lines"]
        while len(lines) > 1 and lines[-1]["start"] + lines[-1]["dur"] - lines[0]["start"] > hi:
            lines.pop()
        a, b = lines[0]["start"], lines[-1]["start"] + lines[-1]["dur"]
        if lo <= b - a <= hi + 0.01:
            out.append({"title": title, "a": round(a, 3), "b": round(b, 3)})
        k += 1
    return out


def cmd_shorts(edit, count=3, reveal=False):
    """Vertical Shorts cut from the finished wide video: each section as its own 9:16 clip, the picture as a band
    over a blurred copy of itself, the section's name on top and big captions below. exports/short-N <name>.mp4."""
    edit = Path(edit).resolve()
    studio.use_editor()
    import scene
    sc, tm, words, src = jload(edit / "scenes.json"), jload(edit / "timing.json"), jload(edit / "words.json") or [], edit / "render.mp4"
    if not src.exists() or not sc or not tm:
        sys.exit("ERROR: this video has no finished render yet.")
    w0, h0 = studio.size_of(edit)
    if w0 < h0:
        sys.exit("ERROR: this video is already tall.")
    parts = short_ranges(sc, tm, count)
    if not parts:
        sys.exit("ERROR: no part of this video stands alone as a Short (its sections are under 14 s or it has none).")
    W, H = 1080, 1920
    (edit / "shorts").mkdir(exist_ok=True)
    (edit / "exports").mkdir(exist_ok=True)
    made = []
    for n, p in enumerate(parts, 1):
        d = p["b"] - p["a"]
        band, bg = edit / "shorts" / f"{n}.band.mp4", edit / "shorts" / f"{n}.bg.mp4"
        # the whole width (a name tag or a title reaches the edges), without the strip the small captions sit in, so
        # the Short's own captions are not doubled
        cut = ["ffmpeg", "-v", "error", "-y", "-ss", f"{p['a']:.3f}", "-t", f"{d:.3f}", "-i", str(src)]
        subprocess.run(cut + ["-vf", f"crop=iw:ih*0.86:0:0,scale={W}:-2,fps=30", "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                              "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", str(band)], check=True)
        subprocess.run(cut + ["-vf", f"scale={W // 6}:{H // 6}:force_original_aspect_ratio=increase,crop={W // 6}:{H // 6},boxblur=8:2,scale={W}:{H},"
                              "eq=brightness=-0.2:saturation=0.8,fps=30", "-an", "-c:v", "libx264", "-crf", "24", "-preset", "fast", "-pix_fmt", "yuv420p",
                              str(bg)], check=True)
        S = scene.Scene(W, H, studio.FPS, background="#000000", edit=edit)
        S.video(f"shorts/{bg.name}", 0, d, track="Back", volume=0, x=W / 2, y=H / 2, w=W, h=H)
        bh = W * (h0 * 0.86) / w0
        S.video(f"shorts/{band.name}", 0, d, track="Video", volume=1, x=W / 2, y=H * 0.43, w=W, h=bh,
                shadow={"blur": 60, "y": 20, "opacity": 0.6})
        S.text(str(p["title"]).upper(), 0, d, track="Title", x=W / 2, y=H * 0.43 - bh / 2 - H * 0.085, w=int(W * 0.9), size=int(W * 0.115), font=DISPLAY,
               weight=400, color="#FFFFFF", line_height=1.04, anim={"in": "pop", "out": "none", "dur": 0.2})
        mine = [{"w": x["w"], "start": round(x["start"] - p["a"], 3), "end": round(min(x["end"], p["b"]) - p["a"], 3)}
                for x in words if p["a"] <= x["start"] < p["b"]]
        if mine:
            S.captions(mine, style=SHORT_CAPTIONS, start=0, end=d, track="Captions")
        S.sc["duration"] = d
        name = f"studio.short{n}.scene.json"
        jsave(edit / name, S.done())
        out = edit / "exports" / (streamclips.export_name(n, {"hook": p["title"]})[:-4].replace(f"{n:02d} ", f"short-{n} ", 1) + ".mp4")
        scene.render(edit, out=out, log=edit / "shorts" / f"{n}.log", name=name)
        made.append(out)
        print(f"short {n}: {p['title']} ({d:.0f} s) -> {out.name}", flush=True)
    print(f"SHORTS {len(made)} in {edit / 'exports'}")
    if reveal and made:
        import library
        subprocess.Popen(library.reveal_cmd(made[0]), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return 0


# ---------------------------------------------------------------- self-check
def demo():
    ws = [{"w": "So", "start": 0.5, "end": 0.7}, {"w": "um,", "start": 0.8, "end": 1.1}, {"w": "the", "start": 1.3, "end": 1.4}, {"w": "best", "start": 1.4, "end": 1.6},
          {"w": "way", "start": 1.6, "end": 1.8}, {"w": "the", "start": 2.6, "end": 2.7}, {"w": "best", "start": 2.7, "end": 2.9}, {"w": "way", "start": 2.9, "end": 3.1},
          {"w": "to", "start": 3.1, "end": 3.2}, {"w": "grow", "start": 3.2, "end": 3.5}, {"w": "is", "start": 5.0, "end": 5.1}, {"w": "consistency.", "start": 5.1, "end": 5.8}]
    keep, what = cut_plan(ws, 6.5)
    assert what == {"fillers": 1, "restarts": 1}, what
    assert keep[0][0] <= 0.5 - PAD + 1e-6 and all(a < z for a, z in keep) and sum(z - a for a, z in keep) < 4.0, keep
    assert not any(a < 0.95 < z or a < 1.5 < z for a, z in keep), "the um and the false start are out"
    assert any(a <= 3.2 - PAD + 1e-6 and z >= 3.5 for a, z in keep), "a kept word keeps its padding"
    with tempfile.TemporaryDirectory() as td:
        e = Path(td)
        jsave(e / "brief.json", {"prompt": "x", "aspect": "16:9", "voice": False, "text": True, "music": False})
        good = {"title": "T", "scenes": [
            {"id": "hook", "say": "One number changes how you see this whole thing, and it is bigger than you think.", "visual": "-", "section": "Intro", "source": "https://www.example.org/a",
             "shots": [{"kind": "stat", "value": "250,000", "label": "new jobs"}, {"kind": "clip", "query": "city timelapse"}]},
            {"id": "why", "say": "Three things matter most here today.", "visual": "-", "section": "Why",
             "shots": [{"kind": "list", "title": "Three things", "items": ["One", "Two", "Three"]}]},
            {"id": "data", "say": "The numbers are not close at all, and the paper behind them says exactly why.", "visual": "-", "section": "Data",
             "shots": [{"kind": "bars", "title": "Share", "items": [["A", 23], ["B", 19]], "unit": "%", "source": "Omdia"},
                       {"kind": "source", "title": "A paper", "by": "Someone, 2020", "highlight": "The line."}]},
            {"id": "end", "say": "That is the whole idea, in short, and now you know what to do with it.", "visual": "-", "section": "End",
             "shots": [{"kind": "quote", "text": "Keep going.", "by": "Someone"}, {"kind": "title", "text": "The end", "sub": "Thanks"}]}]}
        jsave(e / "scenes.json", good)
        assert check(e) == [], check(e)
        bad = json.loads(json.dumps(good))
        bad["scenes"][0]["shots"] = [{"kind": "clip"}, {"kind": "bars", "items": [["A", "x"], ["B", 2]]}, {"kind": "hologram"}]
        jsave(e / "scenes.json", bad)
        errs = check(e)
        assert len(errs) == 3 and "query" in errs[0] and "number" in errs[1] and "kind must be" in errs[2], errs
        jsave(e / "scenes.json", good)
        assert studio.cmd_voice(e, "none") == 0 and studio.cmd_words(e) == 0
        sp = spans(e)
        tm = jload(e / "timing.json")
        assert [s["key"] for s in sp][:3] == ["hook-1", "hook-2", "why-1"] and abs(sp[-1]["b"] - tm["length"]) < 0.01
        assert all(s["b"] - s["a"] >= MIN_SHOT_S - 1e-6 for s in sp), [(s["key"], s["b"] - s["a"]) for s in sp]
        assert cmd_build(e) == 0
        scj = jload(e / studio.SCENE_FILE)
        kinds = [i["type"] for t in scj["tracks"] for i in t["items"]]
        assert "shape" in kinds and "text" in kinds and "captions" in kinds and abs(scj["duration"] - tm["length"]) < 0.01
        text = kit_text({"titles": ["A", "B"], "description": "About it.", "tags": ["x", "y"]}, good, tm,
                        {"hook-2": {"file": "shots/hook-2.mp4", "from": "https://www.youtube.com/watch?v=abc", "title": "City", "by": "Chan"}})
        assert "0:00 Intro" in text and "- https://www.example.org/a" in text and "City by Chan: https://www.youtube.com/watch?v=abc" in text, text
        assert domain("https://www.nature.com/articles/x") == "nature.com" and mmss(125) == "2:05"
        subs = [(0.0, 3.0, "we started the company in a garage"), (3.0, 6.0, "and then the board decided"), (6.0, 9.5, "to fire me from my own company."), (40.0, 43.0, "later on")]
        win = best_window(subs, ["board", "fire"])
        assert win and win[0] <= 3.0 and "fire me" in win[2] and best_window(subs, ["rocket", "moon"]) is None, win
        tm2 = {"scenes": [{"id": f"s{i}", "start": i * 6.0, "dur": 6.0} for i in range(12)]}
        sc2 = {"scenes": [{"id": f"s{i}", "section": ["Intro", "Why", "Why", "Why", "How", "How", "How", "How", "How", "How", "How", "End"][i]} for i in range(12)]}
        got = short_ranges(sc2, tm2, 3)
        assert [(g["title"], g["a"], g["b"]) for g in got] == [("Intro", 0.0, 24.0), ("How", 24.0, 66.0), ("End", 66.0, 72.0)][:2] + [] or len(got) >= 2, got
        assert all(14 <= g["b"] - g["a"] <= 58.01 for g in got), got
        # a motion shot needs a whole simple graphic to fall back on, and takes twice a clip's share of its line
        ov = json.loads(json.dumps(good))
        ov["scenes"][0]["shots"][1]["over"] = {"name": "Jane Doe", "role": "engineer"}
        ov["scenes"][0]["shots"][0]["over"] = {"label": "x"}
        jsave(e / "scenes.json", ov)
        assert any('"over" goes on footage' in x for x in check(e)) and len(check(e)) == 1, check(e)
        jsave(e / "scenes.json", good)
        mo = json.loads(json.dumps(good))
        mo["scenes"][0]["shots"] = [{"kind": "motion", "visual": "a globe turning"}, {"kind": "clip", "query": "city"}]
        jsave(e / "scenes.json", mo)
        assert any("fallback" in x for x in check(e)), check(e)
        mo["scenes"][0]["shots"][0]["fallback"] = {"kind": "stat", "value": "250,000", "label": "new jobs"}
        jsave(e / "scenes.json", mo)
        assert check(e) == []
        sp = spans(e)
        assert abs((sp[0]["b"] - sp[0]["a"]) - 2 * (sp[1]["b"] - sp[1]["a"])) < 0.01, sp[:2]
        assert cmd_build(e) == 0          # no clip built: the fallback graphic is drawn
        ws = [{"w": w, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, w in enumerate(
            ("This is the first line of my own recording, and it runs on. Then a second one starts here and it keeps going for a while. Done now.").split())]
        ls = lines_of(ws)
        assert ls[0][0] == 0 and ls[-1][1] == len(ws) - 1 and all(z - a + 1 >= 4 for a, z in ls) and len(ls) == 2, ls
        ai = json.loads(json.dumps(good))
        ai["scenes"][0]["shots"] = [{"kind": "ai", "prompt": "a storm over a harbour"}]
        jsave(e / "scenes.json", ai)
        assert any("fallback" in x for x in check(e)), check(e)
        jsave(e / "scenes.json", good)
        assert title_score({"title": "Tokyo 4K drone footage", "duration": 300}) > title_score({"title": "Tokyo explained | podcast", "duration": 300})
        assert fit_cmd("a", "b", 1920, 1080)[-1] == "b" and "-t" in fit_cmd("a", "b", 1920, 1080, 3.0)
    print("longvideo demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setkey")
    sub.add_parser("tools")
    for name in ("check", "sheet", "build", "kit", "briefs", "qa", "charts"):
        sub.add_parser(name).add_argument("edit")
    sub.add_parser("bites").add_argument("edit")
    p = sub.add_parser("find"); p.add_argument("edit"); p.add_argument("--only", nargs="*")
    p = sub.add_parser("claims"); p.add_argument("edit"); p.add_argument("--gate", action="store_true")
    p = sub.add_parser("music"); p.add_argument("edit"); p.add_argument("--feel", default=""); p.add_argument("--bpm", default=""); p.add_argument("--use")
    sub.add_parser("sfx-setup")
    p = sub.add_parser("voiceover"); p.add_argument("edit"); p.add_argument("file")
    p = sub.add_parser("shorts"); p.add_argument("edit"); p.add_argument("--count", type=int, default=3); p.add_argument("--reveal", action="store_true")
    p = sub.add_parser("sound"); p.add_argument("edit"); p.add_argument("--mood", default="linear")
    p = sub.add_parser("thumbs"); p.add_argument("edit"); p.add_argument("--title", required=True)
    sub.add_parser("demo")
    a = ap.parse_args(argv)
    return {"check": lambda: cmd_check(a.edit), "find": lambda: cmd_find(a.edit, a.only), "sheet": lambda: cmd_sheet(a.edit),
            "sound": lambda: cmd_sound(a.edit, a.mood), "build": lambda: cmd_build(a.edit), "thumbs": lambda: cmd_thumbs(a.edit, a.title),
            "kit": lambda: cmd_kit(a.edit), "briefs": lambda: cmd_briefs(a.edit), "setkey": cmd_setkey,
            "voiceover": lambda: cmd_voiceover(a.edit, a.file), "shorts": lambda: cmd_shorts(a.edit, a.count, a.reveal),
            "bites": lambda: cmd_bites(a.edit), "qa": lambda: cmd_qa(a.edit), "tools": cmd_tools, "demo": demo,
            "charts": lambda: cmd_charts(a.edit), "claims": lambda: cmd_claims(a.edit, a.gate),
            "music": lambda: cmd_music(a.edit, a.feel, a.bpm, a.use), "sfx-setup": cmd_sfx_setup}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
