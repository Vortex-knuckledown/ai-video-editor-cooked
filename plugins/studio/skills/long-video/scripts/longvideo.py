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

MEDIA = ("clip", "stock", "photo", "own", "ai")
MAX_AI = 6                # AI-generated shots a video: each one is paid for on the user's own account
GRAPHICS = ("title", "stat", "bars", "list", "quote", "source")
MAX_MOTION = 12           # animated hero graphics a video: each is built by its own agent, a few minutes apiece
NEEDS = {"clip": ("query",), "stock": ("query",), "photo": ("query",), "own": ("file",), "motion": ("visual", "fallback"),
         "ai": ("prompt", "fallback"),
         "title": ("text",), "stat": ("value", "label"),
         "bars": ("items",), "list": ("items",), "quote": ("text",), "source": ("title", "highlight")}
MIN_SHOT_S = 1.2          # a shot shorter than this is dropped: the line's other shots take its time
PACE_S = 3.4              # more than this a shot on average reads as slow (edited channels change picture every 1.5 to 2.5 s)
DISPLAY = "Anton"         # the condensed capitals of titles, numbers and labels; everything else is the renderer's sans
LOOK = {"ground": "#0E0F12", "ink": "#FFFFFF", "accent": "#FFD24A"}
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
            if ov is not None and not (kind in MEDIA and isinstance(ov, dict) and any(ov.get(x) for x in ("label", "name", "stat"))):
                errs.append(f"scene {s.get('id')} shot {k}: \"over\" goes on footage or a picture and has a label, a name or a stat")
            for f in NEEDS[kind]:
                if not sh.get(f):
                    errs.append(f"scene {s.get('id')} shot {k} ({kind}): no \"{f}\"")
            if kind in ("bars", "list") and not (isinstance(sh.get("items"), list) and 2 <= len(sh["items"]) <= 6):
                errs.append(f"scene {s.get('id')} shot {k} ({kind}): 2 to 6 items")
            if kind == "motion" and not (isinstance(sh.get("fallback"), dict) and sh["fallback"].get("kind") in GRAPHICS
                                         and all(sh["fallback"].get(f) for f in NEEDS[sh["fallback"]["kind"]])):
                errs.append(f"scene {s.get('id')} shot {k} (motion): \"fallback\" is a whole simple graphic ({', '.join(GRAPHICS)}), shown if the animation fails")
            if kind == "ai" and not (isinstance(sh.get("fallback"), dict) and sh["fallback"].get("kind") in ("clip", "stock", "photo")
                                     and sh["fallback"].get("query")):
                errs.append(f"scene {s.get('id')} shot {k} (ai): \"fallback\" is a clip, stock or photo shot, fetched if the generation fails")
            if kind == "bars" and isinstance(sh.get("items"), list) and any(
                    not (isinstance(i, list) and len(i) == 2 and isinstance(i[1], (int, float))) for i in sh["items"]):
                errs.append(f"scene {s.get('id')} shot {k} (bars): each item is [\"name\", number]")
    return errs


def cmd_check(edit):
    errs = check(edit)
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


def title_score(c):
    """Which search result to try first: plain footage before a presenter's video (which carries a face, titles, a logo)."""
    t = f"{c.get('title', '')} {c.get('channel', '')}"
    return 2 * bool(CLEAN.search(t)) - 2 * bool(BUSY.search(t)) - (c.get("duration", 0) > 1200)


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


def fit_cmd(src, out, w, h, seconds=None, start=0.0):
    """A clip or picture as the frame's own size (cover), 30 fps, no sound."""
    vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    if seconds is None:
        return ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", "-q:v", "2", str(out)]
    return ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-i", str(src), "-t", f"{seconds:.2f}", "-vf", vf + ",fps=30",
            "-an", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", str(out)]


def fetch_clip(edit, key, sh, need, w, h, used):
    cands = search_youtube(sh["query"])
    if not cands:
        return {"missing": "nothing found on YouTube for this search"}
    first = min(len(cands) - 1, max(0, int(sh.get("pick") or 0)))
    v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    out, why, marked = edit / "shots" / f"{key}.mp4", "the download failed", None
    # a result that carries a channel's logo is passed over for the next one, three tries; a `pick` is taken as it is
    for i in ([first] if sh.get("pick") is not None else list(range(first, min(len(cands), first + 3)))):
        c = cands[i]
        again = used.get(c["id"], 0)
        used[c["id"]] = again + 1
        frac = float(sh["at"]) if sh.get("at") is not None else (0.3 + 0.17 * again) % 0.8
        a = max(2.0, min(c["duration"] - need - 3, c["duration"] * max(0.02, min(0.92, frac))))
        raw = edit / "shots" / f"{key}.raw.mp4"
        raw.unlink(missing_ok=True)
        url = "https://www.youtube.com/watch?v=" + c["id"]
        r = subprocess.run(streamclips.ytdlp() + ["--no-warnings", "--no-playlist", *v4, "-f",
                                                 "bv*[height<=1080][vcodec^=avc1]/bv*[height<=1080]/b[height<=1080]/b",
                                                 "--download-sections", f"*{a:.1f}-{a + need + 2.5:.1f}", "--merge-output-format", "mp4",
                                                 "-o", str(raw), url], capture_output=True, text=True, timeout=300)
        if r.returncode or not raw.exists():
            why = (r.stderr.strip().splitlines() or ["the download failed"])[-1][:160]
            continue
        got = duration(raw)
        tmp = edit / "shots" / f"{key}.try.mp4"
        r = subprocess.run(fit_cmd(raw, tmp, w, h, min(need, max(0.5, got - 0.1)), max(0.0, min(1.0, got - need))), capture_output=True, text=True)
        raw.unlink(missing_ok=True)
        if r.returncode or not tmp.exists():
            why = "the clip could not be read"
            continue
        res = {"file": f"shots/{key}.mp4", "from": url, "title": c["title"], "by": c["channel"], "at": round(a, 1), "picked": i,
               "others": [f"{j}: {x['title'][:60]} ({x['duration']:.0f} s)" for j, x in enumerate(cands)]}
        if not logo_of(tmp):
            tmp.replace(out)
            return res
        if marked is None:              # the first marked one is kept in case every result is marked
            tmp.replace(edit / "shots" / f"{key}.marked.mp4")
            marked = {**res, "logo": True}
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


def fetch_stock(edit, key, sh, need, w, h):
    """A stock clip from Pexels: free to use, no logo, no credit owed (one is given anyway)."""
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
            for search in (search_commons, search_openverse, search_pexels):
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
    db = jload(edit / "shots.json", {}) or {}
    todo = [sp for sp in spans(edit) if sp["shot"]["kind"] in MEDIA and (not only or sp["key"] in only)]
    used = {}

    def one(sp):
        key, sh, need = sp["key"], sp["shot"], sp["b"] - sp["a"]
        was = db.get(key) or {}
        if was.get("stamp") == stamp_of(sh, need) and was.get("file") and (edit / was["file"]).exists():
            return key, was
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
        return key, {**got, "kind": sh["kind"], "query": sh.get("query"), "stamp": stamp_of(sh, need)}
    with ThreadPoolExecutor(4) as ex:
        for key, got in ex.map(one, todo):
            db[key] = got
            jsave(edit / "shots.json", db)
            print(f"MISSING {key}: {got.get('query')} ({got['missing']})" if got.get("missing") else
                  (f"LOGO {key}: every result tried carries a logo; change the words or the kind. " if got.get("logo") else "") +
                  (f"AI FAILED {key} ({got['ai_failed']}), its fallback is used. " if got.get("ai_failed") else "") +
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


def cmd_voiceover(edit, src):
    """The user's recording as the video's voice: audio/vo.wav, words.json, timing.json (engine "own"), and
    scenes.json with one scene a spoken line (ids l01, l02, ...) whose shots Claude then writes. Run again after the
    shots are written and they are kept for every line that still says the same."""
    edit, src = Path(edit), Path(str(src)).expanduser()
    if not src.is_file():
        sys.exit(f"ERROR: no recording at {src}")
    (edit / "audio").mkdir(parents=True, exist_ok=True)
    studio.to_wav(src, edit / "audio" / "vo.wav")
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
        (d / "brief.md").write_text(studio.BRIEF.format(
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
def cmd_sound(edit, mood="linear"):
    """audio/mix.wav: the voice, the music ducked under it, and a quiet sound on the cuts (a tick when a graphic
    lands, a soft whoosh on every third change of footage)."""
    edit = Path(edit)
    studio.use_editor()
    import sound
    import numpy as np
    tm, b = jload(edit / "timing.json"), studio.brief_of(edit)
    if not tm:
        sys.exit("ERROR: no timing.json. Run studio.py voice first.")
    mood = mood if mood in sound.MOODS else "linear"
    n = int((tm["length"] + 0.05) * sound.SR)
    sp = spans(edit)
    bed = np.zeros((2, n))
    if b["music"]:
        sections = [(r["start"], "hook" if k == 0 else "payoff" if k == len(tm["scenes"]) - 1 else "action")
                    for k, r in enumerate(tm["scenes"])]
        got, _ = sound.compose(mood, tm["length"], None, [s["a"] for s in sp[1:]], 0, sections)
        bed = np.pad(got, ((0, 0), (0, max(0, n - got.shape[1]))))[:, :n] * 0.42
    fx = np.zeros((2, n))
    root = sound.MOODS[mood]["root"]
    sect, seen = {}, None
    for sc_ in scenes_of(edit):
        if sc_.get("section") and sc_["section"] != seen:
            seen = sc_["section"]
            sect[sc_["id"]] = True
    for k, s in enumerate(sp[1:], 1):                    # a sound on every change of picture, quiet under the voice
        kind, first = s["shot"]["kind"], s["key"].endswith("-1") and sect.get(s["sid"])
        if first and s["a"] > 3:                          # a new section: a swell into it
            sound.place(fx, sound.sfx_swell(1.4, root, k), s["a"] - 1.4, 0.13)
        if kind in ("stat", "title", "motion"):
            sound.place(fx, sound.sfx_hit(root, k), s["a"], 0.24)
        elif kind in GRAPHICS:
            sound.place(fx, sound.sfx_tick(k), s["a"], 0.3)
            if kind in ("list", "bars"):                  # each row lands with its own tick
                for j in range(1, min(6, len(s["shot"].get("items") or []))):
                    sound.place(fx, sound.sfx_tick(k + j), s["a"] + 0.25 + j * 0.3, 0.16)
        elif k % 2 == 0:
            sound.place(fx, sound.sfx_whoosh(0.55, True, k % 3), s["a"] - 0.45, 0.085, pan=(-0.4 if k % 4 == 0 else 0.4))
        else:
            sound.place(fx, sound.sfx_click(k % 5), s["a"], 0.14)
    vo = edit / "audio" / "vo.wav"
    mix = bed + fx
    if tm["engine"] != "none" and vo.exists():
        v = sound.read_audio(vo, tm["length"] + 0.05)[:, :n]
        mix = sound.duck(mix, v) + v
    lufs, tp = sound.master(mix, edit / "audio" / "mix.wav")
    print(json.dumps({"file": str(edit / "audio" / "mix.wav"), "lufs": lufs, "true_peak": tp, "music": b["music"], "cuts": len(sp) - 1}))
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
    if ov.get("stat"):
        cw, chh = W * 0.27, H * (0.27 if ov.get("note") else 0.19)
        cx, cy = W * 0.81, H * 0.27
        S.shape(a + 0.1, hold, track="Graphics bg", x=cx, y=cy, w=cw, h=chh, radius=s * 0.022, fill="#0B0C0F", opacity=0.82,
                shadow={"blur": 40, "y": 14, "opacity": 0.5}, anim={"in": "slide-up", "out": "fade", "dur": 0.25})
        S.text(str(ov["stat"]).upper(), a + 0.16, hold, track="Graphics", x=cx, y=cy - (chh * 0.12 if ov.get("note") else 0), w=int(cw * 0.9), size=int(s * 0.1),
               font=DISPLAY, weight=400, color=look["accent"], anim={"in": "pop", "out": "fade", "dur": 0.2})
        if ov.get("note"):
            S.text(str(ov["note"]), a + 0.26, hold, track="Graphics", x=cx, y=cy + chh * 0.27, w=int(cw * 0.86), size=int(s * 0.027), weight=600,
                   color="#FFFFFF", opacity=0.85, anim={"in": "fade", "out": "fade", "dur": 0.2})


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
    if kit.get("tags"):
        out += ["## Tags", ", ".join(str(t) for t in kit["tags"]), ""]
    return "\n".join(out)


def cmd_kit(edit):
    edit = Path(edit)
    kit, sc, tm = jload(edit / "kit.json"), jload(edit / "scenes.json"), jload(edit / "timing.json")
    if not isinstance(kit, dict) or not kit.get("description"):
        sys.exit('ERROR: write EDIT/kit.json first: {"titles": [3 options], "description": "...", "tags": [...]}')
    (edit / "exports").mkdir(exist_ok=True)
    (edit / "exports" / "publish.md").write_text(kit_text(kit, sc, tm, jload(edit / "shots.json", {}) or {}), encoding="utf-8")
    print(f"KIT {edit / 'exports' / 'publish.md'}")
    return 0


# ---------------------------------------------------------------- self-check
def demo():
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
    for name in ("check", "sheet", "build", "kit", "briefs"):
        sub.add_parser(name).add_argument("edit")
    p = sub.add_parser("find"); p.add_argument("edit"); p.add_argument("--only", nargs="*")
    p = sub.add_parser("voiceover"); p.add_argument("edit"); p.add_argument("file")
    p = sub.add_parser("sound"); p.add_argument("edit"); p.add_argument("--mood", default="linear")
    p = sub.add_parser("thumbs"); p.add_argument("edit"); p.add_argument("--title", required=True)
    sub.add_parser("demo")
    a = ap.parse_args(argv)
    return {"check": lambda: cmd_check(a.edit), "find": lambda: cmd_find(a.edit, a.only), "sheet": lambda: cmd_sheet(a.edit),
            "sound": lambda: cmd_sound(a.edit, a.mood), "build": lambda: cmd_build(a.edit), "thumbs": lambda: cmd_thumbs(a.edit, a.title),
            "kit": lambda: cmd_kit(a.edit), "briefs": lambda: cmd_briefs(a.edit), "setkey": cmd_setkey,
            "voiceover": lambda: cmd_voiceover(a.edit, a.file), "demo": demo}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
