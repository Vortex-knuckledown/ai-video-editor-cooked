#!/usr/bin/env python3
"""Subtitles in other languages for a finished video (the studio plugin's subtitles skill).

    python3 subs.py cues EDIT                 what is said, in subtitle cues: EDIT/subs/<key>/cues.json per video
    python3 subs.py write EDIT CODE [--reveal]  EDIT/subs/<key>/<CODE>.json (Claude's translation) -> .srt files
    python3 subs.py demo

Run through the editor's run.py (its venv has the transcriber). EDIT is a video's folder in the library. A Clip a
stream video has one finished video per clip (key clip1, clip2, ...); every other video has one (key video).

cues.json: [{"n", "start", "end", "text"}]. A translation is <CODE>.json beside it: a list of strings, one per cue,
in the same order (CODE is the language's two-letter code: es, hi, pt, ...). `write` checks the count, wraps each
cue to two lines at most and writes EDIT/exports/<name>.<CODE>.srt, and <name>.srt in the language spoken, named
like the exported video so a player picks them up.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
for d in ("animated-video", "stream-clips"):
    sys.path.insert(0, str(HERE.parents[1] / d / "scripts"))
import studio  # noqa: E402  (finding the editor, small helpers)
from studio import jload, jsave  # noqa: E402
import streamclips  # noqa: E402  (a stream video's clips and their export names)

MAX_CHARS = 42            # a subtitle line
MAX_CUE_S = 5.0
MIN_CUE_S = 0.7
GAP_S = 0.6               # a pause this long ends a cue


def clean(name):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(name or ""))
    return re.sub(r"\s+", " ", name).strip(" .")[:70].strip()


def videos(edit):
    """[(key, file, name)]: every finished video of the edit, with the name its subtitle files take."""
    edit = Path(edit)
    out = []
    if (edit / "clips").is_dir():
        mj = jload(edit / "moments.json", []) or []
        moments = {m["id"]: m for m in (mj.get("moments", []) if isinstance(mj, dict) else mj) if isinstance(m, dict) and m.get("id")}
        for cid in streamclips.clip_ids(edit):
            f = streamclips.final_of(edit, cid)
            if f:
                cj = jload(edit / "clips" / cid / "clip.json", {}) or {}
                cj.setdefault("text", (moments.get(cj.get("moment")) or {}).get("text"))
                out.append((cid, f, streamclips.export_name(int(cid[4:]), cj)[:-4]))
        if out:
            return out
    rj = jload(edit / "review.json", {}) or {}
    exported = sorted((edit / "exports").glob("*.mp4"), key=lambda f: f.stat().st_mtime)
    cands = [edit / "final.mp4", edit / "render.mp4", Path(str(rj.get("video") or "/nonexistent"))]
    f = next((c for c in cands if c.is_file() and c.name != "placeholder.mp4"), None)
    if f:
        out.append(("video", exported[-1] if exported else f, exported[-1].stem if exported else clean(rj.get("name")) or edit.name))
    return out


def group(words):
    """Words ({"w", "start", "end"}) as subtitle cues: a line's worth, ended early by a pause or a sentence end."""
    cues, cur = [], []

    def close():
        if cur:
            cues.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": " ".join(w["w"] for w in cur)})
            cur.clear()
    for i, w in enumerate(words):
        text = " ".join(x["w"] for x in cur + [w])
        if cur and (len(text) > MAX_CHARS * 2 or w["end"] - cur[0]["start"] > MAX_CUE_S or w["start"] - cur[-1]["end"] >= GAP_S):
            close()
        cur.append(w)
        if re.search(r"[.!?]$", w["w"]) and len(" ".join(x["w"] for x in cur)) >= 12:
            close()
    close()
    for i, c in enumerate(cues):                      # a cue stays up a moment, never into the next one
        nxt = cues[i + 1]["start"] if i + 1 < len(cues) else c["end"] + 1.0
        c["end"] = round(min(max(c["end"] + 0.25, c["start"] + MIN_CUE_S), max(c["end"], nxt - 0.04)), 3)
        c["start"] = round(c["start"], 3)
        c["n"] = i + 1
    return cues


def wrap(text):
    """At most two lines, the break near the middle."""
    text = " ".join(str(text).split())
    if len(text) <= MAX_CHARS or " " not in text:
        return text
    ws, best = text.split(" "), None
    for i in range(1, len(ws)):
        a, b = " ".join(ws[:i]), " ".join(ws[i:])
        if best is None or abs(len(a) - len(b)) < abs(len(best[0]) - len(best[1])):
            best = (a, b)
    return best[0] + "\n" + best[1]


def stamp(t):
    ms = int(round(max(0.0, t) * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def srt(cues, texts=None):
    rows = []
    for i, c in enumerate(cues):
        t = wrap(texts[i] if texts is not None else c["text"])
        if t.strip():
            rows.append(f"{len(rows) + 1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{t}\n")
    return "\n".join(rows)


def cmd_cues(edit):
    edit = Path(edit)
    vs = videos(edit)
    if not vs:
        sys.exit("ERROR: no finished video in this folder yet.")
    for key, f, name in vs:
        d = edit / "subs" / key
        d.mkdir(parents=True, exist_ok=True)
        st = d / "source.txt"
        tag = f"{f}|{f.stat().st_mtime:.0f}"
        if not (d / "cues.json").exists() or (st.read_text(encoding="utf-8") if st.exists() else "") != tag:
            (d / "words.json").unlink(missing_ok=True)
            cues = group(streamclips.words_of(f, d / "words.json"))
            jsave(d / "cues.json", cues)
            st.write_text(tag, encoding="utf-8")
        cues = jload(d / "cues.json")
        print(f"{key}: {name} - {len(cues)} cues" + (f', "{cues[0]["text"][:60]}"' if cues else " (nothing is said)"))
    print(f"CUES {len(vs)} video{'s' if len(vs) > 1 else ''} in {edit / 'subs'}")
    return 0


def cmd_write(edit, code, reveal=False):
    edit = Path(edit)
    code = code.lower()
    if not re.fullmatch(r"[a-z]{2,3}(-[a-z0-9]{2,8})?", code):
        sys.exit("ERROR: the language code is two or three letters (es, hi, pt, zh-hans).")
    out = edit / "exports"
    out.mkdir(exist_ok=True)
    made, bad = [], 0
    for key, f, name in videos(edit):
        d = edit / "subs" / key
        cues = jload(d / "cues.json")
        if cues is None:
            sys.exit("ERROR: run subs.py cues first.")
        tr = jload(d / f"{code}.json")
        if not isinstance(tr, list) or len(tr) != len(cues) or any(not isinstance(x, str) for x in tr):
            print(f"FIX  {key}: {d / (code + '.json')} needs a list of {len(cues)} strings, one per cue of cues.json"
                  + (f" (it has {len(tr)})" if isinstance(tr, list) else ""))
            bad += 1
            continue
        empty = [c["n"] for c, x in zip(cues, tr) if c["text"].strip() and not x.strip()]
        if empty:
            print(f"FIX  {key}: cue {empty[0]} has no translation" + (f" (and {len(empty) - 1} more)" if len(empty) > 1 else ""))
            bad += 1
            continue
        if not cues:
            continue
        (out / f"{name}.srt").write_text(srt(cues), encoding="utf-8")
        (out / f"{name}.{code}.srt").write_text(srt(cues, tr), encoding="utf-8")
        made.append(out / f"{name}.{code}.srt")
        print(f"{key} -> {name}.{code}.srt ({len(cues)} cues)")
    if bad:
        return 1
    print(f"WROTE {len(made)} to {out}")
    if reveal and made:
        studio.use_editor()
        import library
        subprocess.Popen(library.reveal_cmd(made[0]), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return 0 if made else 1


def demo():
    ws = [{"w": w, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, w in enumerate(
        "Where is he? They still know I'm up here and they are coming for the bed right now.".split())]
    ws += [{"w": "Go!", "start": 12.0, "end": 12.2}]
    cues = group(ws)
    assert [c["text"] for c in cues][0] == "Where is he?" and cues[-1]["text"] == "Go!", cues
    assert all(c["end"] > c["start"] and (i + 1 == len(cues) or c["end"] <= cues[i + 1]["start"]) for i, c in enumerate(cues)), cues
    assert cues[-1]["end"] - cues[-1]["start"] >= MIN_CUE_S - 1e-6 and [c["n"] for c in cues] == list(range(1, len(cues) + 1))
    assert wrap("short one") == "short one" and wrap("a " * 40).count("\n") == 1
    assert stamp(3661.5) == "01:01:01,500" and stamp(0) == "00:00:00,000"
    s = srt([{"start": 0, "end": 1.5, "text": "Hello there."}, {"start": 2, "end": 3, "text": "Bye."}], ["Hola.", "Adiós."])
    assert s == "1\n00:00:00,000 --> 00:00:01,500\nHola.\n\n2\n00:00:02,000 --> 00:00:03,000\nAdiós.\n", repr(s)
    assert clean('a/b: "c"?') == "a b c"
    with tempfile.TemporaryDirectory() as td:
        e = Path(td)
        (e / "clips" / "clip1").mkdir(parents=True)
        (e / "clips" / "clip1" / "render.mp4").write_bytes(b"x")
        jsave(e / "clips" / "clip1" / "clip.json", {"hook": "First blood"})
        assert [(k, n) for k, _, n in videos(e)] == [("clip1", "01 First blood")]
        (e / "subs" / "clip1").mkdir(parents=True)
        jsave(e / "subs" / "clip1" / "cues.json", [{"n": 1, "start": 0, "end": 1, "text": "Hi."}, {"n": 2, "start": 1, "end": 2, "text": "Go."}])
        jsave(e / "subs" / "clip1" / "es.json", ["Hola."])
        assert cmd_write(e, "es") == 1, "a translation with the wrong count is refused"
        jsave(e / "subs" / "clip1" / "es.json", ["Hola.", "Vamos."])
        assert cmd_write(e, "es") == 0
        assert "Vamos." in (e / "exports" / "01 First blood.es.srt").read_text(encoding="utf-8")
        assert "Go." in (e / "exports" / "01 First blood.srt").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as td:
        e = Path(td) / "my-video"
        e.mkdir()
        (e / "render.mp4").write_bytes(b"x")
        jsave(e / "review.json", {"name": "My: video"})
        assert [(k, n) for k, _, n in videos(e)] == [("video", "My video")]
    print("subs demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("cues"); p.add_argument("edit")
    p = sub.add_parser("write"); p.add_argument("edit"); p.add_argument("code"); p.add_argument("--reveal", action="store_true")
    sub.add_parser("demo")
    a = ap.parse_args(argv)
    if a.cmd == "cues":
        return cmd_cues(a.edit)
    if a.cmd == "write":
        return cmd_write(a.edit, a.code, a.reveal)
    return demo()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
