#!/usr/bin/env python3
"""Studio: the best short clips from long streams and gameplay videos. The steps the stream-clips skill runs.

    python3 streamclips.py meta PROJ <link or file> ...   PROJ/src/v<N>/: meta.json (title, length, YouTube's "most
                                     replayed" heatmap, chapters) and the sound (an audio-only download for a link)
    python3 streamclips.py moments PROJ [--min 20 --max 45] [--top 8]
                                     every second scored (most replayed + how loud it gets against the minutes round
                                     it), the peaks become moments, only those parts are downloaded and transcribed:
                                     moments.json and shortlist.md (the only file Claude reads)
    python3 streamclips.py previews PROJ          previews.mp4: every moment numbered, one after another, for the editor
    python3 streamclips.py make PROJ m3 m1 ... [--pad-in S --pad-out S] [--number N]
                                     clips/clip<N>/: the moment trimmed on whole words, words.json
    python3 streamclips.py layout PROJ clip1 [--mode auto|facecam|follow|fit|split] [--aspect 9:16|16:9]
                                     vertical.mp4: facecam on top and the game below, the crop following a face,
                                     or the whole frame over a blurred copy of itself
    python3 streamclips.py build PROJ clip1 [--title "WORDS"] [--no-captions]   studio.clip1.scene.json
    python3 streamclips.py render PROJ clip1 [--draft]                         clips/clip1/render.mp4
    python3 streamclips.py styled PROJ clip1 --as mine|@handle   PROJ/styled/clip1/: the clip as an
                                     ordinary edit for the editor's cut and style-edit, nothing cut, in that style
    python3 streamclips.py demo

PROJ is <library>/edits/<name>/ with brief.json from the page: {"links", "count", "min", "max", "layout",
"captions", "aspect"}. A link is never downloaded whole: its sound first (small), then only the parts that score.
Runs in the editor's venv (numpy, OpenCV): `python3 <ai-editor>/lib/ai_editor/run.py streamclips.py ...`.
Reuses the editor's code and never changes it: links.py's yt-dlp, cut's transcriber, style-edit's face finder,
clips' reframe, the Scene renderer.
"""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import shutil
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "animated-video" / "scripts"))
import studio  # noqa: E402  (finding the editor, small helpers)
from studio import jload, jsave, duration  # noqa: E402

SR = 8000                 # the sound is read at this rate for loudness
PAD_S = 8.0               # each downloaded part is this much longer on both sides, so the trim can move to a word
SNAP_S = 4.0              # a clip's edge moves at most this far to land between words
CONTEXT_S = 120           # loudness is measured against the median of this many seconds round it
INTRO_S = 90              # "starting soon" and sign-off screens: the first and last of this score half
W, H = 1080, 1920
CAM_H = 640               # facecam layout: the cam is the top third, the game the rest
CHAT_S = 600             # the live chat replay downloads for at most this long; a bigger chat is left out
CHAT_LAG_S = 4           # chat reacts a few seconds after the moment: its counts move this much earlier
HYPE = re.compile(r"\b(?:lol|lmao|lmfao|kekw|lul|omegalul|w+|ww+|no way|bro|omg|wtf|clip it|clip that|hahaha+|ha+h)\b|"
                  r"[\U0001F602\U0001F923\U0001F480\U0001F525]", re.I)   # laughing, skull, fire, "W", "clip it"
CAPTIONS = {"size_pct": 6.2, "case": "upper", "effect": "pop", "stroke": True, "words_per_caption": 3}
CAPTION_Y = {"facecam": 34, "follow": 72, "fit": 76, "vertical": 72, "wide": 80, "split": 50}   # split: the words sit on the seam between the two people


def mmss(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def ytdlp():
    studio.use_editor()
    import links
    y = links.ytdlp()
    if not y:
        sys.exit("ERROR: yt-dlp is not installed. Run the ai-editor setup skill, then again.")
    return y


def is_link(s):
    return bool(re.match(r"https?://", str(s)))


def run_y(args, cookies=None, timeout=1800):
    # IPv4: on a network whose IPv6 is broken (one ISP's video caches answer on IPv6 only) every download times out
    v4 = [] if os.environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    cmd = ytdlp() + ["--no-warnings", "--no-playlist", *v4, *(["--cookies-from-browser", cookies] if cookies else []), *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        err = (r.stderr.strip().splitlines() or ["no answer"])[-1]
        login = re.search(r"sign in|log ?in|not a bot|private|members", r.stderr, re.I)
        print(f"ERROR: {'the site wants a login: ' if login else ''}{err[:300]}")
        sys.exit(3 if login else 1)
    return r.stdout


# ---------------------------------------------------------------- 1. meta and sound
MAX_VIDEOS = 5


def channel_of(s):
    """A channel's link as the pages that list its videos, newest first (its past streams, then its uploads), or
    None: the link is one video, a file, or a site with no listing we can read."""
    m = re.match(r"https?://(?:www\.|m\.)?youtube\.com/(@[^/?#]+|(?:channel|c|user)/[^/?#]+)(?:/(?:streams|videos|featured|live))?/?(?:[?#].*)?$", str(s))
    if m:
        base = "https://www.youtube.com/" + m.group(1)
        return [base + "/streams", base + "/videos"]
    m = re.match(r"https?://(?:www\.|m\.)?twitch\.tv/([A-Za-z0-9_]{3,25})(?:/videos)?/?(?:[?#].*)?$", str(s))
    if m and m.group(1).lower() not in ("videos", "directory", "settings", "downloads"):
        return [f"https://www.twitch.tv/{m.group(1)}/videos?filter=archives&sort=time"]
    return None


def latest_of(pages, n, cookies=None):
    """The newest n finished videos of a channel (a live or upcoming one is left out), as links."""
    v4 = [] if os.environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    for page in pages:
        r = subprocess.run(ytdlp() + ["--no-warnings", *v4, *(["--cookies-from-browser", cookies] if cookies else []),
                                      "--flat-playlist", "--playlist-end", str(n + 3), "--print",
                                      "%(live_status)s|%(webpage_url,url)s", page], capture_output=True, text=True, timeout=180)
        got = [ln.split("|", 1)[1] for ln in r.stdout.splitlines()
               if "|" in ln and ln.split("|", 1)[0] not in ("is_live", "is_upcoming") and is_link(ln.split("|", 1)[1])]
        if got:
            return got[:n]
    return []


def expand(sources, latest=1, cookies=None):
    """Every source as videos: a channel link becomes its newest `latest` videos. MAX_VIDEOS in all."""
    out = []
    for s in sources:
        pages = channel_of(s) if is_link(s) else None
        if not pages:
            out.append(s)
            continue
        got = latest_of(pages, max(1, min(MAX_VIDEOS, latest)), cookies)
        print(f"{s}: " + (f"its newest {len(got)}: " + " ".join(got) if got else "no finished videos found, skipped"))
        out += got
    seen, uniq = set(), []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    if len(uniq) > MAX_VIDEOS:
        print(f"{len(uniq)} videos: only the first {MAX_VIDEOS} are read")
    return uniq[:MAX_VIDEOS]


def cmd_meta(proj, sources, cookies=None, latest=1):
    proj = Path(proj)
    sources = expand(sources, latest, cookies)
    if not sources:
        sys.exit("ERROR: no videos to read (a channel link with no finished videos).")
    for n, s in enumerate(sources, 1):
        d = proj / "src" / f"v{n}"
        d.mkdir(parents=True, exist_ok=True)
        if is_link(s):
            j = json.loads(run_y(["--dump-json", "--skip-download", s], cookies, 120).splitlines()[0])
            meta = {"link": s, "title": j.get("title"), "by": j.get("uploader") or j.get("channel"),
                    "length": j.get("duration"), "heatmap": j.get("heatmap") or [], "chapters": j.get("chapters") or [],
                    "w": j.get("width"), "h": j.get("height")}
            out = run_y(["-f", "bestaudio[ext=m4a]/bestaudio", "-o", str(d / "sound.%(ext)s"),
                         "--print", "after_move:filepath", s], cookies)
            meta["sound"] = Path(out.strip().splitlines()[-1]).name
            if j.get("was_live") or j.get("live_status") == "was_live" or "live_chat" in (j.get("subtitles") or {}):
                meta["chat"] = fetch_chat(s, d, cookies)
        else:
            f = Path(s).expanduser().resolve()
            if not f.is_file():
                sys.exit(f"ERROR: no file at {f}")
            meta = {"file": str(f), "title": f.stem, "length": duration(f), "heatmap": [], "chapters": [], "sound": None}
        jsave(d / "meta.json", meta)
        print(f"v{n}: {meta['title']} ({mmss(meta['length'] or 0)}), most replayed: "
              f"{'yes' if meta['heatmap'] else 'none'}, chat replay: "
              f"{str(len(jload(d / meta['chat']) or [])) + ' messages' if meta.get('chat') else 'none'}")
    return 0


def fetch_chat(link, d, cookies=None, limit=CHAT_S):
    """A YouTube stream replay's live chat as chat.json, [[seconds, hype 0|1], ...], or None: no chat replay, or one
    too big to fetch in `limit` seconds (a part of it would favour the start of the stream)."""
    v4 = [] if os.environ.get("STUDIO_IPV6") else ["--force-ipv4"]
    cmd = ytdlp() + ["--no-warnings", "--no-playlist", *v4, *(["--cookies-from-browser", cookies] if cookies else []),
                     "--skip-download", "--write-subs", "--sub-langs", "live_chat", "-o", str(d / "chat"), link]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=limit)
    except subprocess.TimeoutExpired:
        print(f"chat replay: bigger than {limit // 60} minutes of download, left out")
        for f in d.glob("chat.live_chat.json*"):
            f.unlink()
        return None
    raw = d / "chat.live_chat.json"
    if not raw.exists():
        return None
    msgs = chat_messages(raw.read_text(encoding="utf-8", errors="replace").splitlines())
    raw.unlink()   # 15 MB an hour of chat: only the times are kept
    jsave(d / "chat.json", msgs)
    return "chat.json" if msgs else None


def chat_messages(lines):
    """[[seconds, hype]] from yt-dlp's live_chat json lines (one action a line, its offset in milliseconds)."""
    out = []
    for ln in lines:
        try:
            j = json.loads(ln)
        except ValueError:
            continue
        r = j.get("replayChatItemAction") or {}
        try:
            t = int(r.get("videoOffsetTimeMsec")) / 1000
        except (TypeError, ValueError):
            continue
        for a in r.get("actions") or []:
            it = (a.get("addChatItemAction") or {}).get("item") or {}
            m = it.get("liveChatTextMessageRenderer") or it.get("liveChatPaidMessageRenderer")
            if not m:
                continue
            runs = (m.get("message") or {}).get("runs") or []
            text = " ".join(x.get("text") or ((x.get("emoji") or {}).get("shortcuts") or [""])[0] for x in runs)
            out.append([round(t, 1), 1 if HYPE.search(text) else 0])
    return out


def chat_rate(msgs, n):
    """Messages a second (a laughing or "W" message counts twice), moved CHAT_LAG_S earlier, or None."""
    if not msgs:
        return None
    v = [0.0] * n
    for t, hype in msgs:
        i = int(t) - CHAT_LAG_S
        if 0 <= i < n:
            v[i] += 1 + hype
    return v


# ---------------------------------------------------------------- 2. moments
def loudness(media):
    """dB per second of the sound."""
    import numpy as np
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(media), "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         stdout=subprocess.PIPE)
    out = []
    while True:
        b = p.stdout.read(SR * 2)
        if len(b) < SR:
            break
        x = np.frombuffer(b, np.int16).astype(np.float32) / 32768
        out.append(20 * np.log10(max(1e-5, float(np.sqrt(np.mean(x * x))))))
    p.wait()
    return out


def heat(meta, n):
    """YouTube's most replayed, one value a second (0-1), or None."""
    hm = meta.get("heatmap") or []
    if not hm:
        return None
    v = [0.0] * n
    for b in hm:
        for t in range(int(b["start_time"]), min(n, int(b["end_time"]) + 1)):
            v[t] = max(v[t], float(b["value"]))
    # everyone watches the first seconds, so the heatmap always peaks there: that start says nothing about the
    # moment, it gets the video's median, and the rest is scaled back to 0-1
    start = min(n // 4, max(60, n // 30))
    rest = sorted(v[start:]) or [0.0]
    v[:start] = [rest[len(rest) // 2]] * start
    top = max(v) or 1.0
    return [x / top for x in v]


def surge(x):
    """0-1 a second: how far above the minutes round it (a robust z-score against a rolling median)."""
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view as win
    x = np.array(x, dtype=np.float32)
    k = min(CONTEXT_S | 1, len(x) // 2 * 2 - 1) if len(x) > 4 else 1
    med = np.median(win(np.pad(x, k // 2, mode="edge"), k), axis=1) if k > 1 else x
    rel = x - med
    mad = float(np.median(np.abs(rel))) + 1e-3
    return np.clip(rel / (1.4826 * mad), 0, 6) / 6


# what each signal weighs, by which ones a video has (the sound always)
WEIGHTS = {(True, True): (0.45, 0.30, 0.25), (True, False): (0.6, 0.0, 0.4), (False, True): (0.0, 0.55, 0.45),
           (False, False): (0.0, 0.0, 1.0)}


def scores(db, hm, chat=None):
    """A score a second from the most replayed (YouTube), the chat's surges (a stream replay's live chat, smoothed
    over 5 s) and how loud it is against the minutes round it (shouting, a crowd, an explosion). Smoothed over 3 s.
    Returns (score, loud, chat surge or None)."""
    import numpy as np
    ex = surge(db)
    ch = None
    if chat:
        c = np.convolve(np.array(chat[:len(ex)], dtype=np.float32), np.ones(5) / 5, mode="same")
        ch = surge(c) if c.max() > 0 else None
    wh, wc, wl = WEIGHTS[(bool(hm), ch is not None)]
    s = wl * ex + (wh * np.array(hm[:len(ex)], dtype=np.float32) if hm else 0) + (wc * ch if ch is not None else 0)
    s = np.convolve(s, np.ones(3) / 3, mode="same")
    edge = min(INTRO_S, len(s) // 10)
    s[:edge] *= 0.5
    s[len(s) - edge:] *= 0.5
    return s, ex, ch


def standout(s, v):
    """How far a peak stands above its own video's ordinary second, 0 to 1.5: 0 at the video's median, 1 at its
    99th percentile. A score is only comparable inside one video (its most replayed is scaled to its own top, a
    video with no chat is scored on fewer signals), this is comparable across them."""
    import numpy as np
    med, hi = float(np.median(s)), float(np.percentile(s, 99))
    return round(max(0.0, min(1.5, (v - med) / (hi - med))) if hi - med > 1e-6 else 0.0, 3)


def fair(found, top):
    """The top moments across several videos, by how much each stands out in its own video. Every video's best
    moment stays in, and with more than one video none takes over 60% of the places while another has moments."""
    found = sorted(found, key=lambda m: (-m.get("rank", m["score"]), -m["score"]))
    vids = {m["video"] for m in found}
    cap = top if len(vids) < 2 else max(1, -(-top * 6 // 10))
    best = {}
    for m in found:
        best.setdefault(m["video"], m)
    out, n, later = list(best.values())[:top], {v: 1 for v in best}, []
    for m in found:
        if len(out) >= top:
            break
        if any(m is o for o in out):
            continue
        if n[m["video"]] >= cap:
            later.append(m)
            continue
        out.append(m)
        n[m["video"]] += 1
    out += later[:top - len(out)]
    return sorted(out, key=lambda m: (-m.get("rank", m["score"]), -m["score"]))


def peaks(s, length, top, gap=5):
    """The best non-overlapping windows: each peak with 65% of the clip before it (the build-up) and 35% after."""
    out = []
    for t in sorted(range(len(s)), key=lambda i: -s[i]):
        a = max(0, min(len(s) - length, t - 0.65 * length))
        b = a + length
        if all(b + gap <= o[0] or a >= o[1] + gap for o in out):
            out.append((a, b, t, float(s[t])))
        if len(out) >= top:
            break
    return out


def part(meta, d, a, b, out, cookies=None):
    """One part of a source as a file: downloaded alone for a link, cut from the file otherwise."""
    if out.exists():
        return out
    if meta.get("link"):
        run_y(["-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
               "--download-sections", f"*{a:.1f}-{b:.1f}", "-o", str(out), meta["link"]], cookies)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.2f}", "-i", meta["file"], "-t", f"{b - a:.2f}",
                        "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-c:a", "aac", str(out)], check=True)
    return out


def words_of(media, out):
    root = studio.use_editor()
    if not out.exists():
        r = subprocess.run([sys.executable, str(root / "skills" / "cut" / "scripts" / "transcribe.py"), str(media),
                            str(out), "--engine", "whisper"], capture_output=True, text=True)
        if r.returncode or not out.exists():
            print(r.stdout[-600:] + r.stderr[-600:])
            sys.exit("ERROR: the moment did not transcribe. Run the ai-editor setup skill (the transcription model).")
    return [{"w": w["text"].strip(), "start": w["start"], "end": w["end"]} for w in jload(out)
            if w.get("type", "word") == "word" and w["text"].strip()]


def snap(words, t, end=False):
    """t moved (at most SNAP_S) into the nearest gap between words; a clip's end prefers a sentence end."""
    gaps = [(words[i]["end"] + words[i + 1]["start"]) / 2 for i in range(len(words) - 1)
            if words[i + 1]["start"] - words[i]["end"] >= 0.2]
    if words:
        gaps += [words[0]["start"] - 0.15, words[-1]["end"] + 0.25]
    if end:
        stops = [words[i]["end"] + 0.25 for i in range(len(words)) if re.search(r"[.!?]$", words[i]["w"])]
        near = [g for g in stops if abs(g - t) <= SNAP_S]
        if near:
            return min(near, key=lambda g: abs(g - t))
    if any(w["start"] < t < w["end"] for w in words):   # mid-word: the nearest gap
        near = [g for g in gaps if abs(g - t) <= SNAP_S]
        if near:
            return min(near, key=lambda g: abs(g - t))
    return t


def chapter(meta, t):
    return next((c.get("title") for c in meta.get("chapters") or [] if c["start_time"] <= t < c["end_time"]), None)


def cmd_moments(proj, lo=20, hi=45, top=8, cookies=None):
    proj = Path(proj)
    vids = sorted((proj / "src").glob("v*/meta.json"))
    if not vids:
        sys.exit("ERROR: run streamclips.py meta first.")
    length, found = (lo + hi) / 2, []
    for mf in vids:
        d, meta = mf.parent, jload(mf)
        db = loudness(d / meta["sound"] if meta.get("sound") else meta["file"])
        if len(db) < lo + 2:
            print(f"{d.name}: shorter than one clip, skipped")
            continue
        chat = chat_rate(jload(d / meta["chat"]) if meta.get("chat") else None, len(db))
        s, ex, ch = scores(db, heat(meta, len(db)), chat)
        for a, b, t, sc in peaks(s, min(length, len(db) - 1), top):
            found.append({"video": d.name, "a": a, "b": b, "peak": t, "score": round(sc, 3), "rank": standout(s, sc),
                          "loud": round(float(ex[t]), 2), "chat": round(float(ch[t]), 2) if ch is not None else None, "heat": round((heat(meta, len(db)) or [0] * len(db))[t], 2)})
    found = fair(found, top)
    out = []
    for n, m in enumerate(found, 1):
        d = proj / "src" / m["video"]
        meta = jload(d / "meta.json")
        a0 = max(0.0, m["a"] - PAD_S)
        f = part(meta, d, a0, m["b"] + PAD_S, d / f"part-{int(m['a'])}.mp4", cookies)
        ws = words_of(f, d / f"part-{int(m['a'])}.words.json")
        a, b = snap(ws, m["a"] - a0), snap(ws, m["b"] - a0, end=True)
        a, b = max(0.0, a), min(duration(f), b if b - a <= hi + SNAP_S else a + hi)
        said = [w["w"] for w in ws if a <= w["start"] < b]
        out.append({"id": f"m{n}", **m, "part": str(f.relative_to(proj)), "in": round(a, 2), "out": round(b, 2),
                    "at": round(a0 + a, 1), "length": round(b - a, 1), "title": meta.get("title"),
                    "chapter": chapter(meta, m["peak"]), "text": " ".join(said)})
        print(f"m{n}: {m['video']} {mmss(a0 + a)} ({b - a:.0f} s) score {m['score']}")
    jsave(proj / "moments.json", out)
    lines = ["# Moments, best score first", "",
             "score: 0-1 from YouTube's most replayed, the live chat's surges (a stream replay) and how loud it gets "
             "against its surroundings, weighed by which of them the video has. Judge each on: does it make sense with no context, does something happen, does it pay off.", ""]
    for m in out:
        lines += [f"## {m['id']}: {m['title']} at {mmss(m['at'])}, {m['length']:.0f} s"
                  + (f" ({m['chapter']})" if m["chapter"] else ""),
                  f"score {m['score']} - most replayed {m['heat']} - loudness peak {m['loud']}"
                  + (f" - chat surge {m['chat']}" if m.get("chat") is not None else ""),
                  f"said: {' '.join(m['text'].split()[:70]) or '(no words: gameplay and reactions only)'}", ""]
    (proj / "shortlist.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(out)} moments -> {proj / 'shortlist.md'}")
    return 0


# ---------------------------------------------------------------- 3. previews for the editor
def label(text, out, w=960):
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGBA", (w, 70), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 34)
    except OSError:
        font = ImageFont.load_default()
    box = dr.textbbox((0, 0), text, font=font)
    dr.rounded_rectangle((16, 12, 16 + box[2] - box[0] + 28, 12 + box[3] - box[1] + 22), 12, fill=(0, 0, 0, 190))
    dr.text((30, 20), text, font=font, fill=(255, 255, 255, 255))
    im.save(out)


def cmd_previews(proj):
    proj = Path(proj)
    ms = jload(proj / "moments.json")
    if not ms:
        sys.exit("ERROR: run streamclips.py moments first.")
    tmp, segs, at = proj / "previews", [], 0.0
    tmp.mkdir(exist_ok=True)
    for k, m in enumerate(ms, 1):
        lab, seg = tmp / f"{m['id']}.png", tmp / f"{m['id']}.mp4"
        label(f"{k}  ·  {m['title'][:34] if m['title'] else m['video']}  ·  {mmss(m['at'])}", lab)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(m["in"]), "-i", str(proj / m["part"]), "-i", str(lab),
                        "-t", str(m["length"]), "-filter_complex",
                        "[0:v]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v];[v][1:v]overlay=0:0",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-ar", "48000", "-ac", "2", str(seg)],
                       check=True)
        m["preview_at"] = round(at, 1)
        at += duration(seg)
        segs.append(seg)
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{s.name}'\n" for s in segs), encoding="utf-8")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                    str(proj / "previews.mp4")], check=True)
    jsave(proj / "moments.json", ms)
    print(f"{proj / 'previews.mp4'} ({at:.0f} s, {len(ms)} moments): " + ", ".join(f"{m['id']} at {mmss(m['preview_at'])}" for m in ms))
    return 0


# ---------------------------------------------------------------- 4. clips
def clip_dir(proj, cid):
    d = Path(proj) / "clips" / cid
    if not d.is_dir():
        sys.exit(f"ERROR: no {d}. Run streamclips.py make first.")
    return d


def cmd_make(proj, ids, pad_in=0.0, pad_out=0.0, number=1):
    proj = Path(proj)
    ms = {m["id"]: m for m in jload(proj / "moments.json") or []}
    for n, mid in enumerate(ids, number):
        if mid not in ms:
            sys.exit(f"ERROR: no moment {mid} in moments.json")
        m, d = ms[mid], proj / "clips" / f"clip{n}"
        d.mkdir(parents=True, exist_ok=True)
        a, b = max(0.0, m["in"] - pad_in), m["out"] + pad_out
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-i", str(proj / m["part"]), "-t", f"{b - a:.3f}",
                        "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-c:a", "aac", "-b:a", "192k",
                        "-movflags", "+faststart", str(d / "source.mp4")], check=True)
        raw = proj / m["part"].replace(".mp4", ".words.json")
        ws = [{"w": w["w"], "start": round(w["start"] - a, 3), "end": round(min(b, w["end"]) - a, 3)}
              for w in words_of(proj / m["part"], raw) if a <= w["start"] < b]
        jsave(d / "words.json", ws)
        jsave(d / "clip.json", {"moment": mid, "video": m["video"], "at": m["at"] - (m["in"] - a), "length": round(b - a, 2),
                                "title": m["title"], "part": m["part"], "in": round(a, 3)})
        print(f"{mid} -> {d} ({b - a:.1f} s, {len(ws)} words)")
    return 0


def size(f):
    w, h = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                           "-of", "csv=p=0", str(f)], capture_output=True, text=True, check=True).stdout.strip().split(",")[:2]
    return int(w), int(h)


def decide(heads):
    """auto: a small face that stays in one place near an edge is a facecam; a big or moving face is followed;
    no face is a game with no cam (the whole frame, fitted)."""
    boxes = [h["box"] for h in heads if h.get("box")]
    if len(boxes) < 0.3 * max(1, len(heads)):
        return "fit", None
    med = [statistics.median(b[i] for b in boxes) for i in range(4)]
    cx, cy = med[0] + med[2] / 2, med[1] + med[3] / 2
    still = statistics.median(abs(b[0] + b[2] / 2 - cx) for b in boxes) < 4
    if med[2] < 22 and still and (cx < 38 or cx > 62 or cy < 38 or cy > 62):
        return "facecam", med
    return ("follow", None) if med[2] >= 14 else ("fit", None)


def cam_crop(box, sw, sh):
    """The source rectangle shown as the cam: round the head, the cam band's shape (1080 x CAM_H)."""
    x, y, w, h = (box[0] * sw / 100, box[1] * sh / 100, box[2] * sw / 100, box[3] * sh / 100)
    cw = min(sw, max(w * 2.6, sw * 0.18))
    ch = min(sh, cw * CAM_H / W)
    cw = ch * W / CAM_H
    cx, cy = x + w / 2, y + h * 0.55
    ev = lambda v: int(v) // 2 * 2
    return ev(cw), ev(ch), ev(max(0, min(sw - cw, cx - cw / 2))), ev(max(0, min(sh - ch, cy - ch / 2)))


def game_x(sw, gw, cx, cw):
    """The game's crop, centred, but moved clear of the cam (its overlay is a little wider than the crop round the
    head), so no sliver of the cam shows in the game below it."""
    gx, margin = (sw - gw) // 2, int(sw * 0.04)
    if cx + cw / 2 < sw / 2:
        gx = max(gx, min(sw - gw, cx + cw + margin))
    else:
        gx = min(gx, max(0, cx - gw - margin))
    return gx // 2 * 2


def cmd_layout(proj, cid, mode="auto", aspect="9:16"):
    d = clip_dir(proj, cid)
    src, out = d / "source.mp4", d / "vertical.mp4"
    sw, sh = size(src)
    enc = ["-c:v", "libx264", "-crf", "17", "-preset", "fast", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
    box = None
    if aspect == "16:9":
        mode, vf = "wide", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1"
    elif sh > sw:
        mode, vf = "vertical", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
    else:
        if mode == "split":      # two people side by side (an interview): the left one on top, the right one below
            half = sw // 2 // 2 * 2
            ch = min(sh, int(half * (H / 2) / W) // 2 * 2)
            cy = (sh - ch) // 2
            vf = (f"[0:v]split[a][b];[a]crop={half}:{ch}:0:{cy},scale={W}:{H // 2},setsar=1[top];"
                  f"[b]crop={half}:{ch}:{sw - half}:{cy},scale={W}:{H // 2},setsar=1[bot];[top][bot]vstack=inputs=2")
        if mode in ("auto", "facecam"):
            studio.use_editor()
            import face
            got, box = decide(face.scan(src))
            mode = got if mode == "auto" or got == "facecam" else "fit"   # no cam found: the whole frame
        if mode == "follow":
            root = studio.use_editor()
            sys.path.insert(0, str(root / "skills" / "clips" / "scripts"))
            import clips
            tmp = d / "follow"
            tmp.mkdir(exist_ok=True)
            (tmp / "source.mp4").unlink(missing_ok=True)
            (tmp / "source.mp4").symlink_to(src)
            clips.reframe(tmp)       # the editor's own head-following 9:16 crop
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "source.mp4"), "-vf",
                            f"scale={W}:{H},setsar=1", *enc, str(out)], check=True)
        if mode == "facecam":
            cw, ch, cx, cy = cam_crop(box, sw, sh)
            gw = min(sw, int(sh * W / (H - CAM_H)) // 2 * 2)
            gx = game_x(sw, gw, cx, cw)
            vf = (f"[0:v]split[a][b];[a]crop={cw}:{ch}:{cx}:{cy},scale={W}:{CAM_H},setsar=1[cam];"
                  f"[b]crop={gw}:{sh}:{gx}:0,scale={W}:{H - CAM_H},setsar=1[game];[cam][game]vstack=inputs=2")
        elif mode == "fit":
            vf = (f"[0:v]split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=24:2,"
                  f"eq=brightness=-0.1[bg];[b]scale={W}:-2[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1")
    if mode != "follow":
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex" if mode in ("facecam", "fit", "split") else "-vf",
                        vf, *enc, str(out)], check=True)
    jsave(d / "layout.json", {"mode": mode, "cam": box, "aspect": aspect})
    print(f"{out}: {mode}" + (f" (cam at {box[0]:.0f}%, {box[1]:.0f}%)" if box else ""))
    return 0


def cmd_build(proj, cid, title=None, captions=True):
    proj = Path(proj).resolve()
    d = clip_dir(proj, cid)
    studio.use_editor()
    import scene
    lay = jload(d / "layout.json") or {}
    if not (d / "vertical.mp4").exists():
        sys.exit("ERROR: run streamclips.py layout first.")
    w, h = size(d / "vertical.mp4")
    dur = duration(d / "vertical.mp4")
    S = scene.Scene(w, h, 30, background="#000000", edit=proj)
    S.video(str((d / "vertical.mp4").relative_to(proj)), 0, dur, track="Clip", volume=1)
    words = jload(d / "words.json") or []
    if captions and words:
        S.captions([x for x in words if x["start"] < dur], style={**CAPTIONS, "y_pct": CAPTION_Y.get(lay.get("mode"), 72)},
                   start=0, end=dur, track="Captions")
    if title:   # the hook line over the first seconds
        # facecam: the captions sit on the seam between the cam and the game, so the title goes on top of the cam
        top = 130 if lay.get("mode") == "facecam" else int(h * 0.16)
        S.text(title.upper(), 0, min(3.5, dur), track="Title", y=top, x=w / 2, w=int(w * 0.86), size=int(w * 0.075),
               weight=900, color="#FFFFFF", align="center", box={"color": "#000000", "pad": [22, 10], "radius": 14, "opacity": 0.85},
               anim={"in": "pop", "out": "fade", "dur": 0.25})
    S.sc["duration"] = dur
    jsave(proj / f"studio.{cid}.scene.json", S.done())
    cj = jload(proj / "clips" / cid / "clip.json", {}) or {}
    cj["hook"] = title or ""
    jsave(proj / "clips" / cid / "clip.json", cj)
    print(f"studio.{cid}.scene.json: {dur:.1f} s, {lay.get('mode', '?')}" + (f", {len(words)} words" if captions else "")
          + (f", title {title!r}" if title else ""))
    return 0


def cmd_render(proj, cid, draft=False):
    proj = Path(proj).resolve()
    d = clip_dir(proj, cid)
    studio.use_editor()
    import scene
    out = scene.render(proj, out=d / "render.mp4", draft=draft, log=d / "render.log", name=f"studio.{cid}.scene.json")
    print(f"{out} ({duration(out):.1f} s)")
    return 0


# ---------------------------------------------------------------- in the user's style
def raw_words(proj, cj, d, dur):
    """The clip's transcript in the transcriber's own shape (words and the spacing between them), on the clip's clock:
    cut and style-edit read words.raw.json. From the moment's transcript when clip.json names it, else rebuilt
    from words.json."""
    src = proj / cj["part"].replace(".mp4", ".words.json") if cj.get("part") else None
    if src and src.exists() and cj.get("in") is not None:
        a = cj["in"]
        toks = [{**t, "start": round(max(0.0, t["start"] - a), 3), "end": round(min(dur, t["end"] - a), 3)}
                for t in jload(src) if t["end"] > a and t["start"] < a + dur]
    else:
        toks = []
        for w in jload(d / "words.json") or []:
            if toks:
                toks.append({"text": " ", "start": toks[-1]["end"], "end": w["start"], "type": "spacing"})
            toks.append({"text": w["w"], "start": w["start"], "end": w["end"], "type": "word"})
    while toks and toks[0].get("type") == "spacing":
        toks.pop(0)
    while toks and toks[-1].get("type") == "spacing":
        toks.pop()
    return [t for t in toks if t["end"] > t["start"] or t.get("type") == "spacing"]


def gameplay_style(st, cards=False):
    """The picked style, fitted to a gameplay clip: captions always on (the laid-out clip has none burned in), and no
    cards unless asked (stream talk rarely names a real thing a card could show; a card style's rate would fail)."""
    st = dict(st)
    st["captions"] = {**(st.get("captions") or {}), "present": True}
    if not cards:
        st["cards"] = {**(st.get("cards") or {}), "on": False}
    return st


def final_of(proj, cid):
    """A clip's finished video: its styled render when that is the newer one, else the gaming look's. None: not made."""
    fs = [f for f in (Path(proj) / "styled" / cid / "render.mp4", Path(proj) / "clips" / cid / "render.mp4") if f.exists()]
    return max(fs, key=lambda f: f.stat().st_mtime) if fs else None


def clip_ids(proj):
    return sorted((d.name for d in (Path(proj) / "clips").glob("clip*") if d.name[4:].isdigit()), key=lambda c: int(c[4:]))


def export_name(n, cj):
    """`02 No way he found me.mp4`: the clip's hook title, else its first words, else the stream's title."""
    t = str(cj.get("hook") or "").strip() or " ".join(str(cj.get("text") or "").split()[:6]) or str(cj.get("title") or "")
    t = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .")[:60].strip()
    return f"{n:02d} {t}.mp4" if t else f"{n:02d} Clip {n}.mp4"


def best_frame(video, n=9):
    """The frame for a cover: sharp, bright enough, a face a bonus where OpenCV can find one. Looked for between 15% and 85% of the clip."""
    import cv2
    cap = cv2.VideoCapture(str(video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    faces = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml") \
        if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data") else None      # not in every OpenCV build
    best, top = None, -1.0
    for k in range(n):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (0.15 + 0.7 * k / max(1, n - 1))))
        ok, fr = cap.read()
        if not ok:
            continue
        g = cv2.cvtColor(cv2.resize(fr, (360, int(360 * fr.shape[0] / fr.shape[1]))), cv2.COLOR_BGR2GRAY)
        sharp = min(1.0, cv2.Laplacian(g, cv2.CV_64F).var() / 600.0)
        light = 1.0 - abs(float(g.mean()) - 125.0) / 125.0
        face = 0.5 if faces is not None and len(faces.detectMultiScale(g, 1.2, 4, minSize=(40, 40))) else 0.0
        if sharp + 0.5 * light + face > top:
            best, top = fr, sharp + 0.5 * light + face
    cap.release()
    return best


def thumb(video, title, out):
    """A cover image the clip's own size: its best frame with the title on it, big, white, outlined."""
    import cv2
    from PIL import Image, ImageDraw, ImageFont
    fr = best_frame(video)
    if fr is None:
        return False
    im = Image.fromarray(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
    w, h = im.size
    title = " ".join(str(title or "").upper().split())
    if title:
        size = int(w * (0.115 if h > w else 0.075))
        font = None
        for f in ("/System/Library/Fonts/Supplemental/Impact.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                  "/System/Library/Fonts/Helvetica.ttc", "C:/Windows/Fonts/impact.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            try:
                font = ImageFont.truetype(f, size)
                break
            except OSError:
                continue
        font = font or ImageFont.load_default()
        dr = ImageDraw.Draw(im)
        lines, line = [], ""
        for word in title.split():
            if line and dr.textlength(line + " " + word, font=font) > w * 0.86:
                lines.append(line)
                line = word
            else:
                line = (line + " " + word).strip()
        lines = (lines + [line])[:3]
        y = int(h * (0.52 if h > w else 0.62)) - len(lines) * size // 2
        for ln in lines:
            x = (w - dr.textlength(ln, font=font)) / 2
            dr.text((x, y), ln, font=font, fill=(255, 255, 255), stroke_width=max(4, size // 9), stroke_fill=(0, 0, 0))
            y += int(size * 1.12)
    im.save(out, quality=90)
    return True


def post_text(pj):
    """A clip's post.json ({"caption", "hashtags": [...]}, Claude writes it) as the text to paste when posting."""
    if not isinstance(pj, dict) or not str(pj.get("caption") or "").strip():
        return None
    tags = []
    for t in pj.get("hashtags") or []:
        t = "#" + re.sub(r"[^\w]", "", str(t), flags=re.UNICODE)
        if len(t) > 1 and t.lower() not in [x.lower() for x in tags]:
            tags.append(t)
    return str(pj["caption"]).strip() + ("\n\n" + " ".join(tags[:8]) if tags else "") + "\n"


def cmd_export(proj, to=None, thumbs=True):
    """Every finished clip of the project copied into one folder, numbered and named by its title. The folder is
    PROJ/exports/ (where the editor's own Export saves, so the home page shows it) unless --to names another."""
    proj = Path(proj)
    out = Path(to).expanduser() if to else proj / "exports"
    out.mkdir(parents=True, exist_ok=True)
    was = jload(out / ".studio-export.json", []) or []
    for name in was:                                   # last time's copies, so a renamed clip does not leave two
        if re.fullmatch(r"\d\d .+\.(mp4|jpg|txt)", str(name)) and (out / name).is_file():
            (out / name).unlink()
    mj = jload(proj / "moments.json", []) or []
    moments = {m["id"]: m for m in (mj.get("moments", []) if isinstance(mj, dict) else mj) if isinstance(m, dict) and m.get("id")}
    made, n_clips = [], 0
    for cid in clip_ids(proj):
        f = final_of(proj, cid)
        if not f:
            print(f"{cid}: not rendered yet, left out")
            continue
        cj = jload(proj / "clips" / cid / "clip.json", {}) or {}
        cj.setdefault("text", (moments.get(cj.get("moment")) or {}).get("text"))
        name = export_name(int(cid[4:]), cj)
        shutil.copy2(f, out / name)
        made.append(name)
        extra = []
        if thumbs:
            try:
                if thumb(f, cj.get("hook") or "", out / (name[:-4] + ".jpg")):
                    made.append(name[:-4] + ".jpg")
                    extra.append("a cover")
            except ImportError:
                thumbs = False
                print("no covers: Pillow or OpenCV is missing (the ai-editor setup skill installs them)")
        txt = post_text(jload(proj / "clips" / cid / "post.json", None))
        if txt:
            (out / (name[:-4] + ".txt")).write_text(txt, encoding="utf-8")
            made.append(name[:-4] + ".txt")
            extra.append("a caption")
        n_clips += 1
        print(f"{cid} -> {name}" + (" with " + " and ".join(extra) if extra else ""))
    jsave(out / ".studio-export.json", made)
    print(f"EXPORTED {n_clips} to {out}")
    return 0 if n_clips else 1


def cmd_styled(proj, cid, as_, cards=False):
    """PROJ/styled/<clip>/: the laid-out clip as an ordinary edit for the editor's own cut and
    style-edit (the ai-editor:clip-editor agent), in the style `as_` (mine or @handle). Gameplay keeps every second:
    spans.json is empty (no cuts) and keep.json covers the whole clip (no pause is tightened)."""
    proj = Path(proj).resolve()
    d = clip_dir(proj, cid)
    if not (d / "vertical.mp4").exists():
        sys.exit("ERROR: run streamclips.py layout first.")
    if not re.fullmatch(r"mine|@[a-z0-9._-]+", as_ or ""):
        sys.exit("ERROR: --as takes mine or @handle (a style from the Styles page).")
    root = studio.use_editor()
    e = proj / "styled" / cid   # inside the project: Your videos lists every folder of edits/, and this is not one
    e.mkdir(parents=True, exist_ok=True)
    src = e / "source.mp4"
    src.unlink(missing_ok=True)
    try:
        os.link(d / "vertical.mp4", src)
    except OSError:
        shutil.copy2(d / "vertical.mp4", src)
    dur = duration(src)
    cj = jload(d / "clip.json") or {}
    jsave(e / "words.raw.json", raw_words(proj, cj, d, dur))
    jsave(e / "spans.json", [])
    jsave(e / "keep.json", [{"start": 0.0, "end": round(dur, 3)}])
    jsave(e / "clip.json", {**cj, "from": str(proj), "clip": cid, "keep_all": True,
                            "layout": (jload(d / "layout.json") or {}).get("mode")})
    r = subprocess.run([sys.executable, str(root / "lib" / "ai_editor" / "profile.py"), "style", str(e), "--as", as_],
                       capture_output=True, text=True, cwd=str(proj.parent.parent))   # the library: its styles
    if r.returncode:
        print(r.stdout[-400:] + r.stderr[-400:])
        sys.exit(f"ERROR: the style {as_} could not be written for {e.name}.")
    jsave(e / "style.json", gameplay_style(jload(e / "style.json") or {}, cards))
    print(f"{e} ({dur:.1f} s, style {as_}, nothing cut, captions on, cards {'on' if cards else 'off'})")
    return 0


# ---------------------------------------------------------------- self-check
def demo():
    import numpy as np
    # several videos: ranked by how far each moment stands out in its own video, no video takes every place
    flat = np.array([0.1] * 990 + [0.9] * 10)
    assert standout(flat, 0.9) >= 1.0 and standout(flat, 0.1) == 0.0 and standout(np.ones(50), 1.0) == 0.0
    ms = [{"video": "v1", "score": 0.9 - i / 100, "rank": 1.2 - i / 100} for i in range(6)] + \
         [{"video": "v2", "score": 0.5 - i / 100, "rank": 0.8 - i / 100} for i in range(6)]
    got = fair(ms, 5)
    assert [m["video"] for m in got].count("v1") == 3 and len(got) == 5 and got[0]["rank"] == 1.2, got
    assert len(fair(ms[:6], 5)) == 5 and len(fair(ms[:2] + ms[6:7], 5)) == 3
    # export: numbered, named by the hook, safe as a file name
    assert export_name(2, {"hook": 'No way: he "found" me?'}) == "02 No way he found me.mp4", export_name(2, {"hook": 'No way: he "found" me?'})
    assert export_name(1, {"text": "where is he where is he they still know"}) == "01 where is he where is he.mp4"
    assert export_name(3, {}) == "03 Clip 3.mp4"
    with tempfile.TemporaryDirectory() as td:
        pj = Path(td)
        for k, hook in ((1, "First blood"), (2, ""), (3, "Never made")):
            (pj / "clips" / f"clip{k}").mkdir(parents=True)
            jsave(pj / "clips" / f"clip{k}" / "clip.json", {"hook": hook, "title": "A stream"})
        (pj / "clips" / "clip1" / "render.mp4").write_bytes(b"a")
        (pj / "clips" / "clip2" / "render.mp4").write_bytes(b"b")
        (pj / "styled" / "clip2").mkdir(parents=True)
        (pj / "styled" / "clip2" / "render.mp4").write_bytes(b"styled")
        os.utime(pj / "clips" / "clip2" / "render.mp4", (1, 1))
        jsave(pj / "clips" / "clip1" / "post.json", {"caption": "He never saw it coming.", "hashtags": ["minecraft", "#Bed Wars", "minecraft"]})
        assert cmd_export(pj, thumbs=False) == 0
        assert (pj / "exports" / "01 First blood.txt").read_text(encoding="utf-8") == "He never saw it coming.\n\n#minecraft #BedWars\n"
        assert sorted(f.name for f in (pj / "exports").glob("*.mp4")) == ["01 First blood.mp4", "02 A stream.mp4"]
        assert (pj / "exports" / "02 A stream.mp4").read_bytes() == b"styled"
        jsave(pj / "moments.json", [{"id": "m1", "text": "from the moment"}])
        jsave(pj / "clips" / "clip1" / "clip.json", {"hook": "Renamed", "moment": "m1"})
        assert cmd_export(pj, thumbs=False) == 0 and not (pj / "exports" / "01 First blood.mp4").exists()
        assert not (pj / "exports" / "01 First blood.txt").exists() and (pj / "exports" / "01 Renamed.txt").exists()
    # a channel link is its listing pages; one video, a file and a Twitch VOD are not
    assert channel_of("https://www.youtube.com/@somebody") == ["https://www.youtube.com/@somebody/streams", "https://www.youtube.com/@somebody/videos"]
    assert channel_of("https://youtube.com/channel/UC123/videos")[0].endswith("/channel/UC123/streams")
    assert channel_of("https://www.twitch.tv/somebody")[0].startswith("https://www.twitch.tv/somebody/videos")
    assert channel_of("https://www.youtube.com/watch?v=abc") is None and channel_of("https://www.twitch.tv/videos/123") is None
    assert channel_of("/tmp/a.mp4") is None and post_text({"caption": " "}) is None
    db = [-40.0] * 600
    for t in range(300, 306):
        db[t] = -12.0                          # a shout at 5:00
    s, ex, _ = scores(db, None)
    assert ex[302] > 0.9 and ex[100] < 0.05, (ex[302], ex[100])
    pk = peaks(s, 30, 3)
    assert pk[0][0] <= 302 <= pk[0][1] and abs(pk[0][2] - 302) <= 3, pk[0]
    assert all(b + 5 <= a2 or a >= b2 + 5 for i, (a, b, *_) in enumerate(pk) for (a2, b2, *_) in pk[i + 1:]), "no overlap"
    hm = heat({"heatmap": [{"start_time": 100, "end_time": 110, "value": 1.0}]}, 600)
    s2, _, _ = scores([-40.0] * 600, hm)
    assert 100 <= int(np.argmax(s2)) <= 110, "most replayed wins with flat sound"
    rate = chat_rate([[t / 10, 0] for t in range(4000)] + [[t / 20 + 254, 1] for t in range(100)], 600)
    s3, _, ch = scores([-40.0] * 600, None, rate)
    assert ch is not None and 245 <= int(np.argmax(s3)) <= 255, int(np.argmax(s3))   # a chat burst at 4:14, moved 4 s earlier
    line = json.dumps({"replayChatItemAction": {"videoOffsetTimeMsec": "61500", "actions": [{"addChatItemAction": {"item": {
        "liveChatTextMessageRenderer": {"message": {"runs": [{"text": "NO WAY "}, {"emoji": {"shortcuts": [":skull:"]}}]}}}}}]}})
    assert chat_messages([line, "not json", json.dumps({"x": 1})]) == [[61.5, 1]], chat_messages([line])
    assert chat_rate(None, 10) is None
    hs = heat({"heatmap": [{"start_time": 0, "end_time": 20, "value": 1.0}, {"start_time": 200, "end_time": 210, "value": 0.4}]}, 600)
    assert hs[5] < 0.1 and hs[205] == 1.0, "the start's peak is not a moment"
    ws = [{"w": "no", "start": 0.0, "end": 0.4}, {"w": "way.", "start": 0.5, "end": 0.9}, {"w": "look", "start": 1.6, "end": 2.0}]
    assert snap(ws, 1.7) == (0.9 + 1.6) / 2, snap(ws, 1.7)
    assert snap(ws, 1.0, end=True) == 0.9 + 0.25
    assert snap(ws, 30.0) == 30.0, "far from words: unchanged"
    cam = [{"t": i, "box": [78.0, 4.0, 9.0, 16.0]} for i in range(20)]
    assert decide(cam)[0] == "facecam"
    assert decide([{"t": i, "box": [40.0 + i % 3, 20.0, 25.0, 40.0]} for i in range(20)])[0] == "follow"
    assert decide([{"t": i, "box": None} for i in range(20)])[0] == "fit"
    cw, ch, cx, cy = cam_crop([78.0, 4.0, 9.0, 16.0], 1920, 1080)
    assert abs(cw / ch - W / CAM_H) < 0.02 and cx + cw <= 1920 and cy + ch <= 1080 and cy >= 0, (cw, ch, cx, cy)
    assert game_x(1920, 912, 0, 400) >= 400 + 76 and game_x(1920, 912, 1500, 400) + 912 <= 1500, "the game clears the cam"
    assert game_x(1920, 912, 0, 100) == 504, "a small cam leaves the game centred"
    with tempfile.TemporaryDirectory() as t:   # words.json -> the transcriber's shape, spacing between words
        cd = Path(t)
        jsave(cd / "words.json", [{"w": "no", "start": 0.1, "end": 0.4}, {"w": "way", "start": 0.6, "end": 0.9}])
        toks = raw_words(cd, {}, cd, 5.0)
        assert [x["type"] for x in toks] == ["word", "spacing", "word"] and toks[1]["start"] == 0.4, toks
        jsave(cd / "part-1.words.json", [{"text": "a", "start": 9.0, "end": 9.5, "type": "word"},
                                         {"text": " ", "start": 9.5, "end": 10.2, "type": "spacing"},
                                         {"text": "b", "start": 10.2, "end": 10.6, "type": "word"}])
        toks = raw_words(cd, {"part": "part-1.mp4", "in": 10.0}, cd, 5.0)
        assert [x["text"] for x in toks] == ["b"] and toks[0]["start"] == 0.2, toks
    g = gameplay_style({"captions": {"present": False, "y_pct": 72}, "cards": {"rate": 20}})
    assert g["captions"] == {"present": True, "y_pct": 72} and g["cards"] == {"rate": 20, "on": False}, g
    assert "on" not in gameplay_style({"cards": {"rate": 20}}, cards=True)["cards"]
    assert mmss(3725) == "1:02:05" and mmss(65) == "1:05"
    with tempfile.TemporaryDirectory() as t:
        jsave(Path(t) / "x.json", {"a": 1})
        assert jload(Path(t) / "x.json") == {"a": 1}
    print("streamclips demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="streamclips.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("meta"); p.add_argument("proj"); p.add_argument("sources", nargs="+"); p.add_argument("--cookies-from-browser")
    p.add_argument("--latest", type=int, default=1, help="a channel link becomes its newest N videos")
    p = sub.add_parser("moments"); p.add_argument("proj"); p.add_argument("--min", type=float, default=20)
    p.add_argument("--max", type=float, default=45); p.add_argument("--top", type=int, default=8); p.add_argument("--cookies-from-browser")
    p = sub.add_parser("previews"); p.add_argument("proj")
    p = sub.add_parser("make"); p.add_argument("proj"); p.add_argument("ids", nargs="+")
    p.add_argument("--pad-in", type=float, default=0); p.add_argument("--pad-out", type=float, default=0)
    p.add_argument("--number", type=int, default=1, help="the first clip's number (redo one clip: --number 2)")
    p = sub.add_parser("layout"); p.add_argument("proj"); p.add_argument("clip")
    p.add_argument("--mode", default="auto", choices=("auto", "facecam", "follow", "fit", "split")); p.add_argument("--aspect", default="9:16")
    p = sub.add_parser("build"); p.add_argument("proj"); p.add_argument("clip"); p.add_argument("--title"); p.add_argument("--no-captions", action="store_true")
    p = sub.add_parser("render"); p.add_argument("proj"); p.add_argument("clip"); p.add_argument("--draft", action="store_true")
    p = sub.add_parser("styled"); p.add_argument("proj"); p.add_argument("clip"); p.add_argument("--as", dest="as_", required=True)
    p.add_argument("--cards", action="store_true", help="keep the style's cards (only for a clip whose talk names real things)")
    p = sub.add_parser("export"); p.add_argument("proj"); p.add_argument("--to"); p.add_argument("--no-thumbs", action="store_true")
    sub.add_parser("demo")
    a = ap.parse_args(argv)
    if a.cmd == "meta":
        return cmd_meta(a.proj, a.sources, a.cookies_from_browser, a.latest)
    if a.cmd == "moments":
        return cmd_moments(a.proj, a.min, a.max, a.top, a.cookies_from_browser)
    if a.cmd == "previews":
        return cmd_previews(a.proj)
    if a.cmd == "make":
        return cmd_make(a.proj, a.ids, a.pad_in, a.pad_out, a.number)
    if a.cmd == "layout":
        return cmd_layout(a.proj, a.clip, a.mode, a.aspect)
    if a.cmd == "build":
        return cmd_build(a.proj, a.clip, a.title, not a.no_captions)
    if a.cmd == "render":
        return cmd_render(a.proj, a.clip, a.draft)
    if a.cmd == "export":
        return cmd_export(a.proj, a.to, not a.no_thumbs)
    if a.cmd == "styled":
        return cmd_styled(a.proj, a.clip, a.as_, a.cards)
    return demo()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
