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

MEDIA = ("clip", "photo", "own")
GRAPHICS = ("title", "stat", "bars", "list", "quote", "source")
NEEDS = {"clip": ("query",), "photo": ("query",), "own": ("file",), "title": ("text",), "stat": ("value", "label"),
         "bars": ("items",), "list": ("items",), "quote": ("text",), "source": ("title", "highlight")}
MIN_SHOT_S = 1.6          # a shot shorter than this is dropped: the line's other shots take its time
PACE_S = 4.5              # more than this a shot on average reads as slow
LOOK = {"ground": "#0E0F12", "ink": "#FFFFFF", "accent": "#FFD24A"}
CAPTIONS = {"y_pct": 86, "size_pct": 4.0, "case": "sentence", "effect": "pop", "stroke": True}
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
        if not isinstance(shots, list) or not 1 <= len(shots) <= 4:
            errs.append(f"scene {s.get('id')}: needs 1 to 4 shots")
            continue
        for k, sh in enumerate(shots, 1):
            kind = sh.get("kind") if isinstance(sh, dict) else None
            if kind not in NEEDS:
                errs.append(f"scene {s.get('id')} shot {k}: kind must be one of {', '.join(NEEDS)}")
                continue
            for f in NEEDS[kind]:
                if not sh.get(f):
                    errs.append(f"scene {s.get('id')} shot {k} ({kind}): no \"{f}\"")
            if kind in ("bars", "list") and not (isinstance(sh.get("items"), list) and 2 <= len(sh["items"]) <= 6):
                errs.append(f"scene {s.get('id')} shot {k} ({kind}): 2 to 6 items")
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
    words = sum(len(studio.words_in(s.get("say"))) for s in sc)
    print(f"ok   {len(sc)} lines, {words} words, about {est // 60:.0f}:{est % 60:02.0f}, {len(shots)} shots "
          f"(one every {est / len(shots):.1f} s): " + ", ".join(f"{n} {k}" for k, n in kinds.items() if n))
    want = float(b.get("minutes") or 0) * 60
    if want and abs(est - want) > 0.15 * want:
        print(f"FIX  about {est:.0f} s for {want:.0f} s asked: {'add' if est < want else 'cut'} about "
              f"{abs(want - est) * 2.4:.0f} words")
        return 1
    if est / len(shots) > PACE_S:
        print(f"FIX  a shot every {est / len(shots):.1f} s is slow: add shots to the long lines (one every 2 to 4 s)")
        return 1
    g = sum(kinds[k] for k in GRAPHICS)
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
        step = r["dur"] / len(shots)
        for k, sh in enumerate(shots):
            out.append({"key": f"{s['id']}-{k + 1}", "sid": s["id"], "a": round(r["start"] + k * step, 3),
                        "b": round(r["start"] + (k + 1) * step, 3), "shot": sh, "n": len(out)})
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
    return good or [c for c in rows if 8 <= c["duration"] <= 7200]


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
    c = cands[min(len(cands) - 1, max(0, int(sh.get("pick") or 0)))]
    again = used.get(c["id"], 0)
    used[c["id"]] = again + 1
    frac = float(sh["at"]) if sh.get("at") is not None else (0.3 + 0.17 * again) % 0.8
    a = max(2.0, min(c["duration"] - need - 3, c["duration"] * max(0.02, min(0.92, frac))))
    raw = edit / "shots" / f"{key}.raw.mp4"
    raw.unlink(missing_ok=True)
    v4 = [] if __import__("os").environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    url = "https://www.youtube.com/watch?v=" + c["id"]
    r = subprocess.run(streamclips.ytdlp() + ["--no-warnings", "--no-playlist", *v4, "-f",
                                             "bv*[height<=1080][vcodec^=avc1]/bv*[height<=1080]/b[height<=1080]/b",
                                             "--download-sections", f"*{a:.1f}-{a + need + 2.5:.1f}", "--merge-output-format", "mp4",
                                             "-o", str(raw), url], capture_output=True, text=True, timeout=300)
    if r.returncode or not raw.exists():
        return {"missing": (r.stderr.strip().splitlines() or ["the download failed"])[-1][:160]}
    out = edit / "shots" / f"{key}.mp4"
    got = duration(raw)
    r = subprocess.run(fit_cmd(raw, out, w, h, min(need, max(0.5, got - 0.1)), max(0.0, min(1.0, got - need))), capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return {"missing": "the clip could not be read"}
    return {"file": f"shots/{key}.mp4", "from": url, "title": c["title"], "by": c["channel"], "at": round(a, 1),
            "others": [f"{i}: {x['title'][:60]} ({x['duration']:.0f} s)" for i, x in enumerate(cands)]}


def search_commons(query, n=8):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrsearch": f"{query} filetype:bitmap",
                                "gsrnamespace": 6, "gsrlimit": n, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
                                "iiurlwidth": 1920})
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q, headers={"User-Agent": UA})
    studio.use_editor()
    import net
    with net.urlopen(req, 40) as r:
        pages = (json.loads(r.read().decode("utf-8")).get("query") or {}).get("pages") or {}
    out = []
    for p in sorted(pages.values(), key=lambda p: p.get("index", 99)):
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") in ("image/jpeg", "image/png") and (ii.get("width") or 0) >= 900:
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


def fetch_photo(edit, key, sh, w, h):
    raw, c, why = edit / "shots" / f"{key}.raw", None, "no picture found for this search"
    with PHOTO_LOCK:
        for search in (search_commons, search_openverse):
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
                time.sleep(1.0)
                break
            except Exception as e:      # the network, "too many requests": the next site, else the shot is missing
                c, why = None, f"the picture sites did not answer ({type(e).__name__})"
                time.sleep(1.0)
    if not c:
        return {"missing": why}
    out = edit / "shots" / f"{key}.jpg"
    # a third bigger than the frame, so the slow push-in never shows an edge and stays sharp
    r = subprocess.run(fit_cmd(raw, out, int(w * 1.3) // 2 * 2, int(h * 1.3) // 2 * 2), capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    if r.returncode or not out.exists():
        return {"missing": "the picture could not be read"}
    return {"file": f"shots/{key}.jpg", "from": c["page"], "title": c["title"], "by": c["by"], "license": c["license"],
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
    return json.dumps([sh.get("kind"), sh.get("query"), sh.get("file"), sh.get("pick"), sh.get("at"), sh.get("in"), round(need, 1)])


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
        got = fetch_clip(edit, key, sh, need, w, h, used) if sh["kind"] == "clip" else \
            fetch_photo(edit, key, sh, w, h) if sh["kind"] == "photo" else fetch_own(edit, key, sh, need, w, h)
        return key, {**got, "kind": sh["kind"], "query": sh.get("query"), "stamp": stamp_of(sh, need)}
    with ThreadPoolExecutor(4) as ex:
        for key, got in ex.map(one, todo):
            db[key] = got
            jsave(edit / "shots.json", db)
            print(f"MISSING {key}: {got.get('query')} ({got['missing']})" if got.get("missing") else
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
    for k, s in enumerate(sp[1:], 1):
        if s["shot"]["kind"] in GRAPHICS:
            sound.place(fx, sound.sfx_tick(k), s["a"], 0.32)
        elif k % 3 == 0:
            sound.place(fx, sound.sfx_whoosh(0.6, True, k % 3), s["a"] - 0.5, 0.09)
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
    kind = sh["kind"]
    if kind == "title":
        T(sh["text"], 0, x=W / 2, y=H * (0.38 if sh.get("sub") else 0.42), w=int(W * 0.84), size=int(s * 0.14), weight=900, color=ink,
          line_height=1.08, anim=pop, keys={"scale": [[0, 0.94, "out"], [d, 1.03, "linear"]]})
        if sh.get("sub"):
            T(sh["sub"], min(0.3, d / 3), x=W / 2, y=H * 0.6, w=int(W * 0.7), size=int(s * 0.055), weight=600, color=acc, anim=up)
    elif kind == "stat":
        T(sh["value"], 0, x=W / 2, y=H * 0.34, w=int(W * 0.94), size=int(s * 0.32), weight=900, color=acc, anim=pop,
          keys={"scale": [[0, 0.8, "out"], [0.35, 1.0, "out"], [d, 1.05, "linear"]]})
        T(sh["label"], min(0.3, d / 3), x=W / 2, y=H * 0.62, w=int(W * 0.74), size=int(s * 0.066), weight=600, color=ink, anim=up)
    elif kind == "quote":
        T("\u201C", 0, x=W * 0.14, y=H * 0.2, w=int(W * 0.2), size=int(s * 0.34), weight=900, color=acc, anim=pop)
        T(sh["text"], 0.1, x=W / 2, y=H * 0.4, w=int(W * 0.72), size=int(s * 0.078), weight=700, color=ink, line_height=1.22, anim=up)
        if sh.get("by"):
            T("\u2014 " + sh["by"], min(0.5, d / 2), x=W / 2, y=H * 0.66, w=int(W * 0.7), size=int(s * 0.044), weight=500, color=acc, anim=up)
    elif kind == "list":
        items, top = sh["items"][:6], H * (0.3 if sh.get("title") else 0.16)
        if sh.get("title"):
            T(sh["title"], 0, x=W / 2, y=H * 0.12, w=int(W * 0.84), size=int(s * 0.078), weight=800, color=ink, anim=up)
        gap = min(H * 0.15, (H * 0.72 - top) / max(1, len(items) - 1)) if len(items) > 1 else 0
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
            T(sh["title"], 0, x=W / 2, y=H * 0.11, w=int(W * 0.86), size=int(s * 0.072), weight=800, color=ink, anim=up)
        x0, full, y0 = W * 0.32, W * 0.46, H * 0.27
        gap = min(H * 0.15, (H * 0.44) / max(1, len(items) - 1)) if len(items) > 1 else 0
        bh = min(s * 0.085, gap * 0.6) if gap else s * 0.085
        size = min(s * 0.056, bh * 0.8)
        best = max(range(len(items)), key=lambda i: float(items[i][1]))
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
    S.track("Footage"); S.track("Graphics"); S.track("Graphics top")
    miss = []
    for sp in spans(edit):
        sh, a, z, d = sp["shot"], sp["a"], sp["b"], sp["b"] - sp["a"]
        if sh["kind"] in GRAPHICS:
            graphic(S, sh, a, z, W, H, look)
            continue
        got = db.get(sp["key"]) or {}
        f = edit / got["file"] if got.get("file") else None
        if not f or not f.exists():
            miss.append(sp["key"])       # the ground shows, the captions carry the line
            continue
        grow = sp["n"] % 2 == 0
        if f.suffix == ".mp4":
            S.video(got["file"], a, z, track="Footage", volume=0, x=W / 2, y=H / 2, w=W, h=H,
                    keys={"scale": [[0, 1.0 if grow else 1.05, "linear"], [d, 1.05 if grow else 1.0, "linear"]]})
        else:
            drift = (W * 0.012) * (1 if sp["n"] % 4 < 2 else -1)
            S.image(got["file"], a, z, track="Footage", x=W / 2, y=H / 2, w=W, h=H, fit="cover",
                    keys={"scale": [[0, 1.02 if grow else 1.12, "linear"], [d, 1.12 if grow else 1.02, "linear"]],
                          "x": [[0, W / 2 - drift, "linear"], [d, W / 2 + drift, "linear"]]})
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
    if miss:
        print("MISSING (the plain ground shows instead): " + " ".join(miss))
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
        assert fit_cmd("a", "b", 1920, 1080)[-1] == "b" and "-t" in fit_cmd("a", "b", 1920, 1080, 3.0)
    print("longvideo demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "sheet", "build", "kit"):
        sub.add_parser(name).add_argument("edit")
    p = sub.add_parser("find"); p.add_argument("edit"); p.add_argument("--only", nargs="*")
    p = sub.add_parser("sound"); p.add_argument("edit"); p.add_argument("--mood", default="linear")
    p = sub.add_parser("thumbs"); p.add_argument("edit"); p.add_argument("--title", required=True)
    sub.add_parser("demo")
    a = ap.parse_args(argv)
    return {"check": lambda: cmd_check(a.edit), "find": lambda: cmd_find(a.edit, a.only), "sheet": lambda: cmd_sheet(a.edit),
            "sound": lambda: cmd_sound(a.edit, a.mood), "build": lambda: cmd_build(a.edit), "thumbs": lambda: cmd_thumbs(a.edit, a.title),
            "kit": lambda: cmd_kit(a.edit), "demo": demo}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
