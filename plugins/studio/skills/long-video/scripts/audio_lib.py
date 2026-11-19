"""Real music and real sound effects for the studio's videos, fetched once and kept.

Music: Kevin MacLeod's Incompetech catalogue (about 1,400 tracks, CC BY 4.0: free in monetised videos with a credit
line, which the publishing kit writes). Searched by feel, tempo and length from its own catalogue file.

Sound effects: recordings marked CC0 on Freesound, found through the Openverse API (no key): whooshes, impacts,
risers, clicks and ticks. CC0 needs no credit; the manifest keeps where each came from anyway.

Both live under ~/.ai-video-editor (music/, sfx/), outside any one video.
"""
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "cooked-studio/1.0"}
CATALOG = "https://incompetech.com/music/royalty-free/pieces.json"
TRACK = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/"
CREDIT = '"{title}" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0. https://creativecommons.org/licenses/by/4.0/'
OPENVERSE = "https://api.openverse.org/v1/audio/"
# kind -> (what to search, shortest and longest it may be in seconds, how many to keep)
SFX = {"whoosh": ("whoosh", 0.25, 1.6, 6), "impact": ("impact", 0.3, 3.5, 5), "riser": ("riser", 1.2, 6.0, 4),
       "click": ("click", 0.03, 0.4, 5), "tick": ("pop", 0.03, 0.6, 5), "swipe": ("swish", 0.12, 1.2, 4)}   # one plain word finds the most
# feels a documentary bed can have, in the catalogue's own words (it also has Bouncy, Humorous, Aggressive: not for narration)
CALM = ("Calming", "Mysterious", "Dark", "Relaxed", "Somber", "Mystical", "Suspenseful", "Uplifting", "Epic", "Driving", "Bright", "Intense", "Eerie")


def home():
    h = os.environ.get("AI_EDITOR_HOME", "").strip()
    return Path(h) if h else Path.home() / ".ai-video-editor"


def get(url, timeout=60):
    try:
        from ai_editor import net
        with net.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read()
    except ImportError:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:   # noqa: S310
            return r.read()


def secs(t):
    p = [int(x) for x in str(t).split(":") if x.isdigit()]
    return sum(v * 60 ** i for i, v in enumerate(reversed(p)))


# ---------------------------------------------------------------- music
def catalog():
    """The catalogue, kept for a month: [{"title", "filename", "length", "bpm", "feel", "instruments", "description"}]."""
    f = home() / "music" / "catalog.json"
    try:
        if time.time() - f.stat().st_mtime < 30 * 86400:
            return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    try:
        raw = get(CATALOG, 60)
        d = json.loads(raw)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(d), encoding="utf-8")
        return d
    except Exception:   # noqa: BLE001
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []


def find_music(feel="", bpm=None, min_s=60, words="", n=6):
    """Tracks that fit: every feel asked for is in the track's own feel list, tempo inside bpm (lo, hi), long enough.
    Quiet, sparse pieces first: a bed under a voice, not a song. [(score, track)]."""
    want = [x.strip().lower() for x in re.split(r"[,/]", feel) if x.strip()]
    ws = [w for w in re.findall(r"[a-z]+", words.lower()) if len(w) > 2]
    out = []
    for t in catalog():
        feels = [x.strip().lower() for x in str(t.get("feel") or "").split(",")]
        if want and not all(w in feels for w in want):
            continue
        try:
            b = float(t.get("bpm") or 0)
        except ValueError:
            b = 0
        if bpm and b and not bpm[0] <= b <= bpm[1]:
            continue
        if secs(t.get("length")) < min_s:
            continue
        text = f"{t.get('description', '')} {t.get('instruments', '')} {t.get('title', '')}".lower()
        score = sum(w in text for w in ws) * 2
        score += 2 * any(x in text for x in ("piano", "strings", "pad", "ambient", "synth", "drone", "underscore", "minimal"))
        score -= 3 * any(x in text for x in ("vocal", "choir", "silly", "comedy", "polka", "circus", "christmas", "ukulele", "banjo", "accordion"))
        score -= 2 * any(x in feels for x in ("bouncy", "humorous", "aggressive"))
        out.append((score, t))
    return sorted(out, key=lambda x: (-x[0], x[1].get("title", "")))[:n]


def get_music(title):
    """The track's file, fetched once: (path, credit line). None when there is no such title or it does not download."""
    t = next((x for x in catalog() if str(x.get("title", "")).lower() == str(title).lower()), None)
    if not t:
        return None
    f = home() / "music" / re.sub(r"[^A-Za-z0-9._ -]", "", t["filename"])
    if not (f.is_file() and f.stat().st_size > 100000):
        try:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(get(TRACK + urllib.parse.quote(t["filename"]), 240))
        except Exception:   # noqa: BLE001
            return None
    return f, CREDIT.format(title=t["title"])


# ---------------------------------------------------------------- sound effects
def sfx_dir():
    return home() / "sfx"


def sfx_setup(force=False):
    """Fetch the effects once: a few CC0 recordings of each kind, trimmed of silence and levelled. Returns how many are there."""
    d = sfx_dir()
    man = {}
    try:
        man = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    for kind, (q, lo, hi, keep) in SFX.items():
        have = [m for m in man.get(kind, []) if (d / m["file"]).is_file()]
        if len(have) >= keep and not force:
            man[kind] = have
            continue
        try:
            res = json.loads(get(OPENVERSE + "?" + urllib.parse.urlencode({"q": q, "license": "cc0", "page_size": 20, "source": "freesound"}), 40)).get("results", [])
        except Exception:   # noqa: BLE001
            res = []
        for r in res:
            if len(have) >= keep:
                break
            dur = (r.get("duration") or 0) / 1000.0
            if not lo <= dur <= hi or not r.get("url") or any(m["source"] == r.get("foreign_landing_url") for m in have):
                continue
            raw, out = d / kind / f"{r['id']}.src", d / kind / f"{r['id']}.wav"
            try:
                raw.parent.mkdir(parents=True, exist_ok=True)
                raw.write_bytes(get(r["url"], 60))
                p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
                                    "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                                    "loudnorm=I=-20:TP=-2", "-ac", "2", "-ar", "48000", str(out)], capture_output=True)
                raw.unlink(missing_ok=True)
                if p.returncode or not out.is_file() or out.stat().st_size < 2000:
                    continue
            except Exception:   # noqa: BLE001
                continue
            have.append({"file": f"{kind}/{out.name}", "title": r.get("title", ""), "by": r.get("creator", ""), "license": "CC0",
                         "source": r.get("foreign_landing_url") or r.get("url")})
        man[kind] = have
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(man, indent=1), encoding="utf-8")
    return {k: len(v) for k, v in man.items()}


_CACHE = {}


def sfx(kind, k=0, read=None):
    """One recorded effect of that kind as a stereo array (the k-th, so neighbours differ), or None when none is fetched."""
    if kind not in _CACHE:
        try:
            man = json.loads((sfx_dir() / "manifest.json").read_text(encoding="utf-8")).get(kind, [])
        except (OSError, ValueError):
            man = []
        _CACHE[kind] = [sfx_dir() / m["file"] for m in man if (sfx_dir() / m["file"]).is_file()]
    files = _CACHE[kind]
    if not files or read is None:
        return None
    f = files[k % len(files)]
    if f not in _CACHE:
        try:
            _CACHE[f] = read(f)
        except Exception:   # noqa: BLE001
            _CACHE[f] = None
    return _CACHE[f]


def demo():
    assert secs("00:05:07") == 307 and secs("3:10") == 190
    global catalog
    real = catalog
    catalog = lambda: [{"title": "Quiet One", "filename": "Quiet One.mp3", "length": "00:03:00", "bpm": "80", "feel": "Calming, Mysterious",   # noqa: E731
                        "instruments": "Piano, Strings", "description": "soft underscore"},
                       {"title": "Silly Polka", "filename": "Silly Polka.mp3", "length": "00:02:00", "bpm": "140", "feel": "Bouncy, Humorous",
                        "instruments": "Accordion", "description": "comedy polka"},
                       {"title": "Short", "filename": "Short.mp3", "length": "00:00:20", "bpm": "80", "feel": "Calming", "instruments": "Piano", "description": ""}]
    try:
        got = find_music("Calming", (60, 100), 60)
        assert [t["title"] for _, t in got] == ["Quiet One"], got
        assert find_music("Bouncy")[0][1]["title"] == "Silly Polka" and find_music("Calming, Humorous") == []
        assert "Quiet One" in CREDIT.format(title="Quiet One")
    finally:
        catalog = real
    return 0
