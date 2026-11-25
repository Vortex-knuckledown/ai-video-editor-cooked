"""One setup for everything the studio downloads, so the app itself stays small (about 25 MB) and each computer fetches
the rest from where it is published: the voices, the cut-out model, the 3D kit, the sound effects and the wider craft
library. Everything lands in ONE folder, $AI_EDITOR_HOME (default ~/.ai-video-editor), never beside the videos.

Why each computer fetches its own copy: some of this (the craft library's AGPL and unlicensed projects, two Mixamo
figures, the Pocket voice's model) may be used but not passed on. Fetched from its author it is that computer's own
copy under the author's terms; put in our installer it would be us handing it out. SOURCES.md in the folder records
what was fetched, from where, under which licence and when.

    python3 resources.py status            every pack: ready or not, its size, what is running
    python3 resources.py setup [id ...]    fetch what is missing (all packs, or the ones named), then write SOURCES.md
    python3 resources.py demo
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LONG = HERE.parents[1] / "long-video" / "scripts"
RUN = HERE.parents[3] / "ai-editor" / "lib" / "ai_editor" / "run.py"


def home():
    h = os.environ.get("AI_EDITOR_HOME", "").strip()
    return Path(h) if h else Path.home() / ".ai-video-editor"


def _glob(pat):
    return any(home().glob(pat))


# id, name, what it is for, MB, who publishes it and under what, needs the editor's own setup first, how to tell it is there
PACKS = [
    {"id": "craft", "name": "Craft library", "about": "Open-source video skills the builders learn from", "mb": 200, "base": False,
     "from": "about 94 projects on GitHub, each under its own licence (listed in craft-ext/INDEX.md); for this team's use only",
     "ready": lambda: (home() / "craft-ext" / "INDEX.md").is_file() and _glob("craft-ext/*/.fetched")},
    {"id": "cutout", "name": "Thumbnail tools", "about": "The cut-out model and the headline font", "mb": 180, "base": False,
     "from": "IS-Net general (DIS, Apache-2.0) from the rembg project; Anton (SIL Open Font Licence) from Google Fonts",
     "ready": lambda: (home() / "models" / "isnet-general-use.onnx").is_file() and (home() / "fonts" / "Anton-Regular.ttf").is_file()},
    {"id": "kokoro", "name": "Narrator voice", "about": "The free neural voice", "mb": 350, "base": True,
     "from": "Kokoro v1.0 (Apache-2.0) from the kokoro-onnx project",
     "ready": lambda: (home() / "models" / "kokoro" / "kokoro-v1.0.onnx").is_file() and (home() / "models" / "kokoro" / "voices-v1.0.bin").is_file()},
    {"id": "pocket", "name": "Studio voice", "about": "The voice that can copy your own", "mb": 960, "base": True,
     "from": "Pocket TTS by Kyutai (CC BY 4.0), from PyPI and Hugging Face",
     "ready": lambda: _glob("pocket/lib/python*/site-packages/pocket_tts") or (home() / "pocket" / "Lib" / "site-packages" / "pocket_tts").is_dir()},
    {"id": "three", "name": "3D engine", "about": "three.js for animated scenes", "mb": 30, "base": True,
     "from": "three.js (MIT) from npm",
     "ready": lambda: (home() / "motion" / "node_modules" / "three" / "build" / "three.module.js").is_file()},
    {"id": "kit", "name": "3D kit", "about": "Earth, skies, materials and animated figures", "mb": 230, "base": True,
     "from": "NASA imagery (public domain), Poly Haven (CC0), three.js examples (MIT), two Mixamo figures (free to use, not to pass on)",
     "ready": lambda: (home() / "kit3d" / "kit.json").is_file() and (home() / "library3d" / "figure.js").is_file()},
    {"id": "sfx", "name": "Sound effects", "about": "Recorded whooshes, hits and clicks", "mb": 4, "base": True,
     "from": "CC0 recordings",
     "ready": lambda: (home() / "sfx" / "manifest.json").is_file()},
]
BY = {p["id"]: p for p in PACKS}


def command(pid):
    run = [sys.executable, str(RUN)]
    return {"craft": [sys.executable, str(HERE / "craftx.py"), "setup"],
            "cutout": [sys.executable, str(Path(__file__).resolve()), "cutout"],
            "kokoro": run + [str(HERE / "studio.py"), "kokoro-setup"],
            "pocket": run + [str(HERE / "studio.py"), "pocket-setup"],
            "three": run + [str(HERE / "studio.py"), "three-setup"],
            "kit": run + [str(HERE / "studio.py"), "kit-setup"],
            "sfx": run + [str(LONG / "longvideo.py"), "sfx-setup"]}[pid]


def base_ready():
    """The editor's own setup has run: its Python environment and its motion tools are there."""
    return (home() / "venv").is_dir() and (home() / "motion" / "package.json").is_file()


def state_file():
    return home() / "resources.json"


def load():
    try:
        return json.loads(state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save(st):
    home().mkdir(parents=True, exist_ok=True)
    tmp = state_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1), encoding="utf-8")
    tmp.replace(state_file())


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def status():
    st = load()
    busy = st.get("busy") if alive(st.get("pid")) else None
    rows = []
    for p in PACKS:
        ok = bool(p["ready"]())
        rows.append({"id": p["id"], "name": p["name"], "about": p["about"], "mb": p["mb"], "ready": ok,
                     "busy": busy == p["id"], "waiting": bool(busy) and not ok and busy != p["id"] and p["id"] in (st.get("todo") or []),
                     "error": "" if ok else (st.get("failed") or {}).get(p["id"], "")})
    left = sum(r["mb"] for r in rows if not r["ready"])
    return {"folder": str(home()), "packs": rows, "busy": bool(busy), "ready": all(r["ready"] for r in rows), "left_mb": left,
            "base": base_ready(), "sources": str(home() / "SOURCES.md")}


def sources():
    """SOURCES.md: what this computer fetched, from whom, under which licence, and when."""
    st = load()
    out = ["# What this computer downloaded, and from where", "",
           "Everything here was fetched by this computer from its own publisher, under that publisher's terms. It is for use",
           "on this computer by this team. Do not copy these folders to anyone outside the team or into an installer.", ""]
    for p in PACKS:
        if p["ready"]():
            out.append(f"- **{p['name']}** ({p['about'].lower()}): {p['from']}. Fetched {(st.get('at') or {}).get(p['id'], 'earlier')}.")
    rows = []
    for f in sorted((home() / "craft-ext").glob("*/.fetched")):
        try:
            x = json.loads(f.read_text(encoding="utf-8"))
            rows.append(f"| {x.get('repo')} | {x.get('license') or 'none given'} | https://github.com/{x.get('repo')} |")
        except (OSError, ValueError):
            continue
    if rows:
        out += ["", "## Craft library, project by project", "", "| Project | Licence | Fetched from |", "|---|---|---|"] + rows
    (home() / "SOURCES.md").write_text("\n".join(out) + "\n", encoding="utf-8")


def setup(ids=None, wait_base=2400):
    st = load()
    if alive(st.get("pid")) and st.get("pid") != os.getpid():
        print("setup is already running")
        return 0
    todo = [p["id"] for p in PACKS if (not ids or p["id"] in ids) and not p["ready"]()]
    st = {"pid": os.getpid(), "todo": todo, "busy": None, "failed": {}, "at": st.get("at") or {}}
    save(st)
    for pid in sorted(todo, key=lambda i: BY[i]["base"]):     # what needs nothing first, so it downloads while the editor's own setup runs
        p = BY[pid]
        t0 = time.time()
        while p["base"] and not base_ready() and time.time() - t0 < wait_base:
            st["busy"] = "base"
            save(st)
            time.sleep(10)
        if p["base"] and not base_ready():
            st["failed"][pid] = "Waits for the first setup to finish."
            save(st)
            continue
        st["busy"] = pid
        save(st)
        print(f"fetching {p['name']} ...", flush=True)
        try:
            r = subprocess.run(command(pid), stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600)
            ok, tail = bool(p["ready"]()), ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-1:] or [""]
        except (OSError, subprocess.TimeoutExpired) as e:
            ok, tail = False, [type(e).__name__]
        if ok:
            st["at"][pid] = time.strftime("%Y-%m-%d")
        else:
            st["failed"][pid] = ("It did not download: " + tail[0])[:200]
        save(st)
        print(f"{p['name']}: {'ready' if ok else st['failed'][pid]}", flush=True)
    st["busy"], st["pid"] = None, None
    save(st)
    sources()
    left = [p["name"] for p in PACKS if not p["ready"]()]
    print("RESOURCES ready" if not left else "RESOURCES missing: " + ", ".join(left))
    return 1 if left else 0


def cutout():
    sys.path.insert(0, str(LONG))
    import thumbs
    thumbs.fetch(thumbs.MODEL, thumbs.home() / "models" / "isnet-general-use.onnx", 100_000_000)
    thumbs.fetch(thumbs.FONT, thumbs.home() / "fonts" / "Anton-Regular.ttf", 50000)
    return 0


def demo():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        os.environ["AI_EDITOR_HOME"] = td
        s = status()
        assert not s["ready"] and not s["busy"] and s["left_mb"] == sum(p["mb"] for p in PACKS) and s["folder"] == td and not s["base"]
        (home() / "sfx").mkdir()
        (home() / "sfx" / "manifest.json").write_text("{}", encoding="utf-8")
        assert [r["id"] for r in status()["packs"] if r["ready"]] == ["sfx"]
        assert setup(["sfx"]) == 1 and "Sound effects" in (home() / "SOURCES.md").read_text(encoding="utf-8")   # nothing to fetch; the others still missing
        assert setup(["three"], wait_base=0) == 1 and "first setup" in status()["packs"][4]["error"]
        assert all(Path(command(p["id"])[1]).is_file() for p in PACKS)
    print("resources demo ok")
    return 0


def main(argv):
    cmd = argv[0] if argv else "status"
    if cmd == "setup":
        return setup([a for a in argv[1:] if a in BY] or None)
    if cmd == "cutout":
        return cutout()
    if cmd == "demo":
        return demo()
    print(json.dumps(status(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
