#!/usr/bin/env python3
"""UGC ads (the studio plugin's ugc-ad skill): a person talking to the camera about a product, cut into several short
vertical ads that differ in their first seconds, so the user can test which hook works.

    python3 ugc.py ingest EDIT <clip or folder> ...     every clip as 1080x1920 with its words: clips.json, clips.md
    python3 ugc.py check EDIT                            plan.json is well formed; each version's length
    python3 ugc.py build EDIT                            studio.<version>.scene.json for every version of plan.json
    python3 ugc.py render EDIT <version> [--draft]       EDIT/versions/<version>.mp4
    python3 ugc.py export EDIT                           every rendered version into EDIT/exports/, named by its hook
    python3 ugc.py demo

Run through the editor's run.py. plan.json (Claude writes it from clips.md):
    {"cta": "Link in bio", "captions": true, "music": true,
     "versions": [{"id": "a", "hook": "I stopped buying coffee out", "parts": [
         {"clip": "c2", "in": 0.4, "out": 4.9},                         the person, from second 0.4 to 4.9 of clip c2
         {"clip": "c1", "in": 6.0, "out": 11.2, "show": "/path/pour.mp4"}   their voice goes on, the product fills the frame
     ]}]}
A version is 12 to 45 seconds. `show` is one of the product's own pictures or clips (brief.json `product_media`).
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
for d in ("animated-video", "stream-clips"):
    sys.path.insert(0, str(HERE.parents[1] / d / "scripts"))
import studio  # noqa: E402
from studio import jload, jsave, duration  # noqa: E402
import streamclips  # noqa: E402  (the transcriber, a file-safe name)

W, H, FPS = 1080, 1920, 30
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".mkv", ".webm")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
CAPTIONS = {"size_pct": 5.4, "case": "sentence", "effect": "pop", "stroke": True, "words_per_caption": 3, "y_pct": 70}
CTA_S = 2.2


def fit(src, out, with_sound=True, seconds=None):
    """A clip (or a picture, as `seconds` of still) as the tall frame's own size, cover-cropped, 30 fps."""
    vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}"
    still = Path(src).suffix.lower() in IMAGE_EXT
    cmd = ["ffmpeg", "-v", "error", "-y"] + (["-loop", "1", "-t", f"{seconds or 4:.2f}"] if still else []) + ["-i", str(src)]
    cmd += ["-vf", vf, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p"]
    cmd += ["-c:a", "aac", "-ar", "48000", "-ac", "2"] if with_sound and not still else ["-an"]
    return subprocess.run(cmd + [str(out)], capture_output=True, text=True)


def cmd_ingest(edit, sources):
    edit = Path(edit)
    files = []
    for s in sources:
        p = Path(str(s)).expanduser()
        files += sorted(f for f in p.iterdir() if f.suffix.lower() in VIDEO_EXT) if p.is_dir() else [p]
    files = [f for f in files if f.is_file() and f.suffix.lower() in VIDEO_EXT][:24]
    if not files:
        sys.exit("ERROR: no video clips there (.mp4, .mov).")
    (edit / "clips").mkdir(parents=True, exist_ok=True)
    rows, md = [], ["# The clips, with what is said in each (seconds from the clip's start)", ""]
    for n, f in enumerate(files, 1):
        cid, out = f"c{n}", edit / "clips" / f"c{n}.mp4"
        if not out.exists() or out.stat().st_mtime < f.stat().st_mtime:
            r = fit(f, out)
            if r.returncode or not out.exists():
                print(f"SKIPPED {f.name}: it could not be read")
                continue
            (edit / "clips" / f"{cid}.words.json").unlink(missing_ok=True)
        words = streamclips.words_of(out, edit / "clips" / f"{cid}.words.json")
        rows.append({"id": cid, "file": f"clips/{cid}.mp4", "from": str(f), "dur": round(duration(out), 2), "words": words})
        md += [f"## {cid}: {f.name}, {rows[-1]['dur']:.1f} s", ""]
        line, start = [], None
        for i, w in enumerate(words):          # a line a sentence or a pause, each with the second it starts and ends
            start = w["start"] if start is None else start
            line.append(w["w"])
            gap = i + 1 < len(words) and words[i + 1]["start"] - w["end"] > 0.5
            if i + 1 == len(words) or gap or re.search(r"[.!?]$", w["w"]):
                md.append(f"- {start:.1f}-{w['end']:.1f}: {' '.join(line)}")
                line, start = [], None
        md.append("" if words else "- (nothing is said)\n")
        print(f"{cid}: {f.name}, {rows[-1]['dur']:.1f} s, {len(words)} words")
    jsave(edit / "clips.json", rows)
    (edit / "clips.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"INGESTED {len(rows)} clips: read {edit / 'clips.md'}")
    return 0 if rows else 1


def check(edit):
    edit = Path(edit)
    plan, clips = jload(edit / "plan.json"), {c["id"]: c for c in jload(edit / "clips.json", []) or []}
    if not isinstance(plan, dict) or not isinstance(plan.get("versions"), list) or not plan["versions"]:
        return ['plan.json needs {"versions": [{"id", "hook", "parts": [{"clip", "in", "out"}]}]}']
    errs, ids = [], set()
    for v in plan["versions"]:
        vid = str(v.get("id") or "")
        if not re.fullmatch(r"[a-z0-9]{1,8}", vid) or vid in ids:
            errs.append(f"version {vid!r}: id is 1-8 of a-z and 0-9, each once")
        ids.add(vid)
        if not str(v.get("hook") or "").strip():
            errs.append(f"version {vid}: no hook")
        total = 0.0
        for k, p in enumerate(v.get("parts") or [], 1):
            c = clips.get(p.get("clip"))
            if not c:
                errs.append(f"version {vid} part {k}: no clip {p.get('clip')!r} in clips.json")
                continue
            a, z = float(p.get("in") or 0), float(p.get("out") or c["dur"])
            if not 0 <= a < z <= c["dur"] + 0.05 or z - a < 0.6:
                errs.append(f"version {vid} part {k}: in {a} to out {z} is not inside {c['id']} ({c['dur']} s), or under 0.6 s")
            if p.get("show") and not Path(str(p["show"])).expanduser().is_file():
                errs.append(f"version {vid} part {k}: no file at {p['show']}")
            total += max(0.0, z - a)
        if not v.get("parts"):
            errs.append(f"version {vid}: no parts")
        elif not 8 <= total <= 60:
            errs.append(f"version {vid}: {total:.0f} s; an ad is 12 to 45 s")
    return errs


def cmd_check(edit):
    errs = check(edit)
    if errs:
        print("\n".join("FIX  " + e for e in errs))
        return 1
    for v in jload(Path(edit) / "plan.json")["versions"]:
        t = sum(float(p.get("out") or 0) - float(p.get("in") or 0) for p in v["parts"])
        print(f"ok   {v['id']}: {t:.1f} s, {len(v['parts'])} parts, hook \"{v['hook']}\"")
    return 0


def cmd_build(edit):
    edit = Path(edit).resolve()
    errs = check(edit)
    if errs:
        sys.exit("ERROR: plan.json: " + "; ".join(errs))
    studio.use_editor()
    import scene
    plan, clips, b = jload(edit / "plan.json"), {c["id"]: c for c in jload(edit / "clips.json")}, jload(edit / "brief.json", {}) or {}
    (edit / "media").mkdir(exist_ok=True)
    for v in plan["versions"]:
        S = scene.Scene(W, H, FPS, background="#000000", edit=edit)
        S.track("Clips"); S.track("Product"); S.track("Type")
        t, words = 0.0, []
        for k, p in enumerate(v["parts"]):
            c = clips[p["clip"]]
            a, z = float(p.get("in") or 0), float(p.get("out") or c["dur"])
            d = z - a
            # the person talks: their clip with its sound; a small push-in on every other part keeps the frame alive
            S.video(c["file"], t, t + d, track="Clips", volume=1, x=W / 2, y=H / 2, w=W, h=H, **{"in": a},
                    keys={"scale": [[0, 1.0 if k % 2 == 0 else 1.08, "linear"], [d, 1.05 if k % 2 == 0 else 1.12, "linear"]]})
            if p.get("show"):                   # the product over their voice
                src = Path(str(p["show"])).expanduser()
                out = edit / "media" / f"{v['id']}-{k + 1}.mp4"
                if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
                    fit(src, out, with_sound=False, seconds=d + 0.2)
                if out.exists():
                    S.video(f"media/{out.name}", t, t + min(d, duration(out)), track="Product", volume=0, x=W / 2, y=H / 2, w=W, h=H,
                            anim={"in": "fade", "out": "fade", "dur": 0.15}, keys={"scale": [[0, 1.0, "linear"], [d, 1.06, "linear"]]})
            words += [{"w": w["w"], "start": round(t + w["start"] - a, 3), "end": round(t + min(w["end"], z) - a, 3)}
                      for w in c["words"] if a <= w["start"] < z]
            t += d
        hook = str(v["hook"]).strip()
        S.text(hook, 0, min(3.2, t), track="Type", x=W / 2, y=H * 0.2, w=int(W * 0.86), size=int(W * 0.068), weight=800, color="#111111",
               line_height=1.18, box={"color": "#FFFFFF", "pad": [22, 12], "radius": 14}, anim={"in": "pop", "out": "fade", "dur": 0.2})
        if b.get("presenter") == "ai":          # a generated presenter is said to be one, on screen, for the whole ad
            S.text("AI presenter", 0, t, track="Type", x=W * 0.83, y=H * 0.035, w=int(W * 0.3), size=int(W * 0.026), weight=600, color="#FFFFFF",
                   box={"color": "#000000", "pad": [10, 5], "radius": 8, "opacity": 0.55})
        if plan.get("captions", True) and words:
            S.captions(words, style=CAPTIONS, start=0, end=t, track="Captions")
        cta = str(plan.get("cta") or "").strip()
        if cta:
            S.shape(t, t + CTA_S, track="Clips", x=W / 2, y=H / 2, w=W, h=H, fill="#0E0F12")
            S.text(cta.upper(), t + 0.1, t + CTA_S, track="Type", x=W / 2, y=H * 0.46, w=int(W * 0.84), size=int(W * 0.12), font="Anton", weight=400,
                   color="#FFFFFF", line_height=1.05, anim={"in": "pop", "out": "none", "dur": 0.2})
            if b.get("product"):
                S.text(str(b["product"])[:40], t + 0.3, t + CTA_S, track="Type", x=W / 2, y=H * 0.6, w=int(W * 0.8), size=int(W * 0.042), weight=600,
                       color="#FFD24A", anim={"in": "slide-up", "out": "none", "dur": 0.25})
            t += CTA_S
        if plan.get("music", True) and (edit / "audio" / "bed.wav").exists():
            S.audio("audio/bed.wav", 0, t, track="Music", volume=0.5, fade_out=0.8)
        S.sc["duration"] = t
        jsave(edit / f"studio.{v['id']}.scene.json", S.done())
        print(f"studio.{v['id']}.scene.json: {t:.1f} s, {len(v['parts'])} parts, {len(words)} words")
    return 0


def cmd_music(edit, mood="linear"):
    """audio/bed.wav: a quiet bed long enough for the longest version, made for this ad (nothing to licence)."""
    edit = Path(edit)
    studio.use_editor()
    import sound
    plan = jload(edit / "plan.json")
    longest = max(sum(float(p.get("out") or 0) - float(p.get("in") or 0) for p in v["parts"]) for v in plan["versions"]) + CTA_S + 1
    bed, _ = sound.compose(mood if mood in sound.MOODS else "linear", longest, None, [], 0, None)
    (edit / "audio").mkdir(exist_ok=True)
    sound.write_wav(edit / "audio" / "bed.wav", bed * 0.16)
    print(f"audio/bed.wav: {longest:.0f} s")
    return 0


def cmd_render(edit, vid, draft=False):
    edit = Path(edit).resolve()
    studio.use_editor()
    import scene
    (edit / "versions").mkdir(exist_ok=True)
    out = scene.render(edit, out=edit / "versions" / f"{vid}.mp4", draft=draft, log=edit / "versions" / f"{vid}.log", name=f"studio.{vid}.scene.json")
    print(f"{out} ({duration(out):.1f} s)")
    return 0


def cmd_export(edit):
    edit = Path(edit)
    plan = jload(edit / "plan.json") or {"versions": []}
    out = edit / "exports"
    out.mkdir(exist_ok=True)
    made = []
    for n, v in enumerate(plan["versions"], 1):
        f = edit / "versions" / f"{v['id']}.mp4"
        if f.exists():
            name = streamclips.export_name(n, {"hook": v.get("hook")})
            shutil.copy2(f, out / name)
            made.append(name)
            print(f"{v['id']} -> {name}")
    print(f"EXPORTED {len(made)} to {out}")
    return 0 if made else 1


def demo():
    with tempfile.TemporaryDirectory() as td:
        e = Path(td)
        (e / "clips").mkdir()
        for cid, dur in (("c1", 6), ("c2", 5)):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=gray:s=270x480:r=30:d={dur}", "-f", "lavfi", "-i",
                            f"sine=frequency=300:duration={dur}", "-shortest", "-pix_fmt", "yuv420p", str(e / "clips" / f"{cid}.mp4")], check=True)
        ws = [{"w": w, "start": 0.3 + i * 0.4, "end": 0.6 + i * 0.4} for i, w in enumerate("I stopped buying coffee out and saved money.".split())]
        jsave(e / "clips.json", [{"id": "c1", "file": "clips/c1.mp4", "dur": 6.0, "words": ws}, {"id": "c2", "file": "clips/c2.mp4", "dur": 5.0, "words": ws[:4]}])
        jsave(e / "brief.json", {"product": "Brew Box"})
        jsave(e / "plan.json", {"cta": "Link in bio", "versions": [{"id": "a", "hook": "x", "parts": [{"clip": "c9", "in": 0, "out": 3}]}]})
        assert "no clip" in check(e)[0], check(e)
        jsave(e / "plan.json", {"cta": "Link in bio", "captions": True, "music": False, "versions": [
            {"id": "a", "hook": "I stopped buying coffee out", "parts": [{"clip": "c1", "in": 0.2, "out": 5.8}, {"clip": "c2", "in": 0.0, "out": 4.0}]},
            {"id": "b", "hook": "This saved me money", "parts": [{"clip": "c2", "in": 0.0, "out": 4.5}, {"clip": "c1", "in": 0.2, "out": 5.8}]}]})
        assert check(e) == [], check(e)
        assert cmd_build(e) == 0
        sa = jload(e / "studio.a.scene.json")
        kinds = [i["type"] for t in sa["tracks"] for i in t["items"]]
        assert kinds.count("video") == 2 and "captions" in kinds and abs(sa["duration"] - (5.6 + 4.0 + CTA_S)) < 0.01, (kinds, sa["duration"])
        caps = next(i for t in sa["tracks"] for i in t["items"] if i["type"] == "captions")
        assert abs(caps["words"][0]["start"] - 0.1) < 0.01, caps["words"][0]      # words move with their part: 0.3 in the clip, cut from 0.2
    print("ugc demo ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest"); p.add_argument("edit"); p.add_argument("sources", nargs="+")
    for name in ("check", "build", "export"):
        sub.add_parser(name).add_argument("edit")
    p = sub.add_parser("music"); p.add_argument("edit"); p.add_argument("--mood", default="linear")
    p = sub.add_parser("render"); p.add_argument("edit"); p.add_argument("version"); p.add_argument("--draft", action="store_true")
    sub.add_parser("demo")
    a = ap.parse_args(argv)
    return {"ingest": lambda: cmd_ingest(a.edit, a.sources), "check": lambda: cmd_check(a.edit), "build": lambda: cmd_build(a.edit),
            "music": lambda: cmd_music(a.edit, a.mood), "render": lambda: cmd_render(a.edit, a.version, a.draft),
            "export": lambda: cmd_export(a.edit), "demo": demo}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
