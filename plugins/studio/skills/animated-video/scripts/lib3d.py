"""The shared 3D library: characters, worlds and props that every video reuses, kept outside any one video.

It lives in ~/.ai-video-editor/library3d and is linked into every 3D clip as assets/lib:

  characters/<id>/   character.json, the body, and clips made for its own skeleton (walk, run, talk, ...)
  worlds/<id>/       world.js (the module a video's shots import), world.json, thumb.jpg
  props/<id>/        a free model (Poly Haven, CC0) with prop.json
  figure.js          loadFigure() and loadProp(), so no video writes its own model loading

A video takes from it (a world named in scenes.json with "library"), and gives back: every new world that passed is
saved here by `studio.py briefs`. Characters and props are fetched the first time something asks for them.
"""
import json
import os
import re
import shutil
import struct
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "cooked-studio/1.0"}
RPM_REPO = "readyplayerme/animation-library"   # free animations for its own two avatar bodies (not to be passed on as files)
RPM_RAW = f"https://raw.githubusercontent.com/{RPM_REPO}/master/"
# name in the library -> where its file is in the animation set, for the bodies "masculine" and "feminine"
RPM_BASE = {"idle": "idle/{p}_Standing_Idle_001.glb", "walk": "locomotion/{p}_Walk_00{w}.glb", "run": "locomotion/{p}_Run_001.glb",
            "jog": "locomotion/{p}_Jog_001.glb", "talk": "expression/{p}_Talking_Variations_001.glb"}
RPM_BODIES = {"man": ("masculine", "M", "Masculine_TPose.glb", "A man in a dark T-shirt, dark trousers and white trainers.", 1.82),
              "woman": ("feminine", "F", "Feminine_TPose.glb", "A woman in a white T-shirt, black trousers and black trainers, hair tied up.", 1.72)}
# where things are in each body's clothes picture, as fractions of it (x0, y0, x1, y1): the maker's logos, the shirt, the trousers
RPM_ATLAS = {"man": {"logos": [[0.15, 0.685, 0.23, 0.735], [0.33, 0.685, 0.44, 0.76]], "shirt": [0, 0.63, 0.5, 1], "trousers": [0.5, 0, 0.75, 0.25]},
             "woman": {"logos": [[0.145, 0.695, 0.225, 0.755], [0.33, 0.69, 0.45, 0.765]],
                       "shirt": [[0, 0.63, 0.5, 1], [0, 0.5, 0.24, 0.63], [0.25, 0.585, 0.49, 0.63]], "trousers": [0.5, 0, 1, 0.5]}}
KIT_FIGURES = {   # the kit's three figures, with the clips inside each file
    "mannequin": ("models/person.glb", "A plain grey figure with no face or clothes: for a diagram, not a person.",
                  {"idle": "@idle", "walk": "@walk", "run": "@run"}),
    "soldier": ("models/soldier.glb", "A soldier in armour and a helmet.", {"idle": "@Idle", "walk": "@Walk", "run": "@Run"}),
    "robot": ("models/robot.glb", "A small friendly cartoon robot.",
              {"idle": "@Idle", "walk": "@Walking", "run": "@Running", "jump": "@Jump", "wave": "@Wave", "dance": "@Dance"})}
KIT_SCALE = {"robot": 0.35}   # the robot's file is about 4.5 m tall
POLYHAVEN = "https://api.polyhaven.com/"
PROP_MAX_MB = 40   # a whole scanned tree is close to 1 GB: nothing that size goes in the library or a browser
STOP = set("a an the of in on at by for to and or with from near under over into its it is are as that this one two "
           "day night morning evening seen always never where there sky hdr clear far off low high small large wide can person people".split())


def root():
    home = os.environ.get("AI_EDITOR_HOME", "").strip()
    return (Path(home) if home else Path.home() / ".ai-video-editor") / "library3d"


def jload(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def jsave(p, d):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    try:
        from ai_editor import net
        with net.urlopen(req, timeout=timeout) as r:
            return r.read()
    except ImportError:
        with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310
            return r.read()


def fetch(url, dest):
    dest = Path(dest)
    if dest.is_file() and dest.stat().st_size > 500:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    part.write_bytes(get(url, 180))
    part.rename(dest)
    return dest


def words_of(text):
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", str(text).lower()) if w not in STOP and len(w) > 1}


def slug(text, n=28):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(text).lower())).strip("-")[:n].strip("-") or "item"


# ---------------------------------------------------------------- characters
def rpm_catalog():
    """Every animation in the set, by body: {"masculine": {"M_Walk_001": "masculine/glb/locomotion/M_Walk_001.glb"}}. Kept for a month."""
    import time
    f = root() / "characters" / "catalog.json"
    c = jload(f)
    if c and time.time() - f.stat().st_mtime < 30 * 86400:
        return c
    try:
        tree = json.loads(get(f"https://api.github.com/repos/{RPM_REPO}/git/trees/master?recursive=1"))["tree"]
    except Exception:   # noqa: BLE001
        return c or {}
    c = {}
    for x in tree:
        m = re.fullmatch(r"(masculine|feminine)/glb/[a-z]+/([A-Za-z0-9_]+)\.glb", x["path"])
        if m:
            c.setdefault(m.group(1), {})[m.group(2)] = x["path"]
    jsave(f, c)
    return c


def setup_characters(kit=None):
    """The library's characters, once: a clothed man and woman with idle, walk, run, jog and talk, and the kit's three figures."""
    bad = []
    for cid, (body, p, tpose, describe, height) in RPM_BODIES.items():
        d = root() / "characters" / cid
        meta = jload(d / "character.json") or {"id": cid, "describe": describe, "height": height, "body": "body.glb", "clips": {},
                                               "source": f"github.com/{RPM_REPO}"}
        meta["atlas"], meta["outfit"] = RPM_ATLAS[cid], "shirt and trousers take any colour: loadFigure({..., outfit: {shirt: \"#2f6fdd\", trousers: \"#3b4a6b\"}})"
        try:
            fetch(f"{RPM_RAW}{body}/glb/{tpose}", d / "body.glb")
            for name, pat in RPM_BASE.items():
                rel = pat.format(p=p, w=1 if p == "M" else 2)
                fetch(f"{RPM_RAW}{body}/glb/{rel}", d / "clips" / f"{name}.glb")
                meta["clips"][name] = f"clips/{name}.glb"
        except Exception as e:   # noqa: BLE001
            bad.append(f"{cid} ({type(e).__name__})")
        jsave(d / "character.json", meta)
    for cid, (rel, describe, clips) in KIT_FIGURES.items():
        src = (Path(kit) / rel) if kit else None
        d = root() / "characters" / cid
        if src and src.is_file():
            d.mkdir(parents=True, exist_ok=True)
            if not (d / "body.glb").exists():
                shutil.copy(src, d / "body.glb")
            jsave(d / "character.json", {"id": cid, "describe": describe, "height": 1.6 if cid == "robot" else 1.75, "body": "body.glb", "clips": clips,
                                         "scale": KIT_SCALE.get(cid, 1), "source": "three.js examples"})
    return bad


def add_clip(cid, query):
    """One more animation for a character, found by name in the set ("dance", "crouch walk", "jump"). Returns the clip's name."""
    if cid not in RPM_BODIES:
        raise SystemExit(f"ERROR: more clips can be fetched for: {', '.join(RPM_BODIES)}. \"{cid}\" has only the clips in its file.")
    body, p = RPM_BODIES[cid][:2]
    q = words_of(query)
    best = None
    for name, path in sorted((rpm_catalog().get(body) or {}).items()):
        if not name.startswith(p + "_"):
            continue
        score = len(q & words_of(name.replace("_", " ")))
        if score and (best is None or score > best[0]):
            best = (score, name, path)
    if not best:
        raise SystemExit(f"ERROR: no animation matches \"{query}\". Try: walk, run, jog, crouch, jump, strafe, falling, idle, talking, dance")
    name = slug(query, 20).replace("-", "_")
    d = root() / "characters" / cid
    fetch(RPM_RAW + best[2], d / "clips" / f"{name}.glb")
    meta = jload(d / "character.json")
    meta["clips"][name] = f"clips/{name}.glb"
    jsave(d / "character.json", meta)
    print(f"{cid}: clip \"{name}\" ({best[1]})")
    return name


def add_character(cid, body, clips, describe=""):
    """The user's own figure (.glb or .fbx) with its own clips: {"walk": file, "run": file}; a clip file may be the body file itself."""
    cid = slug(cid)
    d = root() / "characters" / cid
    (d / "clips").mkdir(parents=True, exist_ok=True)
    body = Path(body)
    shutil.copy(body, d / ("body" + body.suffix.lower()))
    meta = {"id": cid, "describe": describe or f"The user's own figure ({body.name}).", "height": 1.75, "body": "body" + body.suffix.lower(), "clips": {},
            "scale": 0.01 if body.suffix.lower() == ".fbx" else 1, "source": "own"}
    for name, f in clips.items():
        f = Path(f)
        shutil.copy(f, d / "clips" / f"{slug(name, 20)}{f.suffix.lower()}")
        meta["clips"][slug(name, 20)] = f"clips/{slug(name, 20)}{f.suffix.lower()}"
    jsave(d / "character.json", meta)
    print(f"character \"{cid}\": {', '.join(meta['clips']) or 'no clips'}")
    return cid


def characters():
    d = root() / "characters"
    return [m for m in (jload(f) for f in sorted(d.glob("*/character.json"))) if m] if d.is_dir() else []


# ---------------------------------------------------------------- props (Poly Haven, CC0)
def prop_catalog():
    import time
    f = root() / "props" / "catalog.json"
    c = jload(f)
    if c and time.time() - f.stat().st_mtime < 30 * 86400:
        return c
    try:
        raw = json.loads(get(POLYHAVEN + "assets?t=models"))
    except Exception:   # noqa: BLE001
        return c or {}
    c = {k: {"name": v.get("name", k), "tags": sorted(set((v.get("tags") or []) + (v.get("categories") or [])))} for k, v in raw.items()}
    jsave(f, c)
    return c


def prop_matches(query, n=8):
    q = words_of(query)
    out = []
    for pid, v in prop_catalog().items():
        name, tags = words_of(v["name"]) | words_of(pid.replace("_", " ")), words_of(" ".join(v["tags"]))
        score = 3 * len(q & name) + len(q & tags)
        if q & name or len(q & tags) >= max(1, len(q)):
            out.append((score, pid, v["name"] + " [" + ", ".join(v["tags"][:6]) + "]"))
    return sorted(out, key=lambda x: (-x[0], x[1]))[:n]


def add_prop(pid):
    """A free model fetched into the library by its id (from prop_matches). Fetched once, then there for every video."""
    d = root() / "props" / pid
    if not (d / "prop.json").is_file():
        try:
            files = json.loads(get(POLYHAVEN + "files/" + urllib.parse.quote(pid)))
        except Exception:   # noqa: BLE001
            files = {}
        g = (files.get("gltf") or {}).get("1k", {}).get("gltf")
        if not g:
            print(f"{pid}: no such free model")
            return None
        inc = g.get("include") or {}
        heavy = (g.get("size", 0) + sum(x.get("size", 0) for x in inc.values())) > PROP_MAX_MB * 1e6
        if not heavy:
            fetch(g["url"], d / f"{pid}.gltf")
        for rel, x in inc.items():
            if not heavy or rel.startswith("textures/"):   # a model too heavy to load still gives its surfaces (bark, leaves)
                fetch(x["url"], d / rel)
        v = prop_catalog().get(pid) or {}
        jsave(d / "prop.json", {"id": pid, "name": v.get("name", pid), "tags": v.get("tags", []), "file": None if heavy else f"{pid}.gltf",
                                "textures": sorted(r for r in inc if r.startswith("textures/")), "source": f"polyhaven.com/a/{pid} (CC0)"})
    meta = jload(d / "prop.json") or {}
    if meta.get("file"):
        print(f"prop \"{pid}\" is in the library: await loadProp({{THREE, id: \"{pid}\"}})")
    else:
        print(f"prop \"{pid}\": the model is over {PROP_MAX_MB} MB, too heavy to load. Only its textures were kept, in "
              f"../lib/props/{pid}/textures/ ({', '.join(x.split('/')[-1] for x in meta.get('textures', [])[:4])} ...): build the shape yourself and use them.")
    return pid


def props():
    d = root() / "props"
    return [m for m in (jload(f) for f in sorted(d.glob("*/prop.json"))) if m] if d.is_dir() else []


# ---------------------------------------------------------------- worlds
def worlds():
    d = root() / "worlds"
    return [m for m in (jload(f) for f in sorted(d.glob("*/world.json"))) if m] if d.is_dir() else []


def head_comment(js):
    """A world module's first comment: what state it reads and what it exposes."""
    out = []
    for line in Path(js).read_text(encoding="utf-8").splitlines():
        if line.startswith("//"):
            out.append(line[2:].strip())
        elif out or line.strip():
            break
    return "\n".join(out)


def save_world(js, describe, name=None, sheet=None, video="", replace=None):
    """A world that passed, kept for every later video. The same file saved again is not a second copy. Returns its library id."""
    js = Path(js)
    text = js.read_text(encoding="utf-8")
    wid = base = slug(replace or name or js.stem)
    k = 1
    while not replace and (root() / "worlds" / wid / "world.js").is_file():
        if (root() / "worlds" / wid / "world.js").read_text(encoding="utf-8") == text:
            return wid
        k += 1
        wid = f"{base}-{k}"
    d = root() / "worlds" / wid
    d.mkdir(parents=True, exist_ok=True)
    (d / "world.js").write_text(text, encoding="utf-8")
    if sheet and Path(sheet).is_file():
        shutil.copy(sheet, d / ("thumb" + Path(sheet).suffix.lower()))
    needs = sorted(x["id"] for x in props() if re.search(r"[\"'/`]" + re.escape(x["id"]) + r"[\"'/`]", text))
    jsave(d / "world.json", {"id": wid, "describe": describe, "tags": sorted(words_of(describe)), "exposes": head_comment(js), "props": needs,
                             "made_for": video, "thumb": ("thumb" + Path(sheet).suffix.lower()) if sheet and Path(sheet).is_file() else ""})
    return wid


def use_world(wid, dest):
    """Copy a library world into a video (EDIT/worlds/<id>.js). False when the library has no such world."""
    src = root() / "worlds" / wid / "world.js"
    if not src.is_file():
        return False
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dest)
    for pid in (jload(src.with_name("world.json")) or {}).get("props") or []:   # on another computer the world's props may not be there yet
        if not (root() / "props" / pid / "prop.json").is_file():
            add_prop(pid)
    return True


def find(text, n=5):
    """Library worlds nearest to a description, by the words they share: [(score, id, describe)]."""
    q = words_of(text)
    out = []
    for w in worlds():
        t = set(w.get("tags") or []) | words_of(w["id"].replace("-", " "))
        hit = len(q & t)
        score = round(hit / max(1, min(len(q), len(t))), 2)
        if hit >= 2 and score >= 0.3 or (hit and len(q) <= 2):   # a shared "sky" and "day" is not the same place
            out.append((score, w["id"], w.get("describe", "")))
    return sorted(out, key=lambda x: -x[0])[:n]


def link_into(clip_dir):
    """The library linked into a clip's assets as assets/lib."""
    link = Path(clip_dir) / "assets" / "lib"
    if not link.exists() and root().is_dir():
        try:
            link.symlink_to(root(), target_is_directory=True)
        except OSError:
            pass
    return link.exists()


def setup(kit=None):
    root().mkdir(parents=True, exist_ok=True)
    for sub in ("characters", "worlds", "props"):
        (root() / sub).mkdir(exist_ok=True)
    shutil.copy(Path(__file__).with_name("figure.js"), root() / "figure.js")
    seed = Path(__file__).resolve().parents[1] / "library" / "worlds"   # the worlds that come with the plugin: a new computer starts with them
    for w in sorted(seed.glob("*/world.json")) if seed.is_dir() else []:
        if not (root() / "worlds" / w.parent.name / "world.js").is_file():
            shutil.copytree(w.parent, root() / "worlds" / w.parent.name, dirs_exist_ok=True)
    bad = setup_characters(kit)
    size = sum(f.stat().st_size for f in root().rglob("*") if f.is_file()) / 1e6
    print(f"library3d: {len(characters())} characters, {len(worlds())} worlds, {len(props())} props, {size:.0f} MB in {root()}" +
          (f"; MISSING {', '.join(bad)}" if bad else ""))
    return 1 if bad else 0


def listing():
    """What is in the library, short enough to read before writing a script."""
    out = ["CHARACTERS (loadFigure({THREE, id, clips}))"]
    out += [f"  {c['id']:<12} {c.get('describe', '')}  clips: {', '.join(c.get('clips') or [])}" for c in characters()] or ["  none: studio.py lib setup"]
    out.append("WORLDS (in scenes.json: {\"id\": ..., \"library\": \"<id>\"})")
    out += [f"  {w['id']:<20} {w.get('describe', '')[:150]}" for w in worlds()] or ["  none yet: a video's worlds are saved here once they pass"]
    out.append("PROPS (loadProp({THREE, id})); more with: studio.py lib prop \"<what>\"")
    out += [f"  {p['id']:<24} {p.get('name', '')}" + ("" if p.get("file") else " (textures only)") for p in props()] or ["  none fetched yet"]
    return "\n".join(out)


def thumb(kind, iid):
    """A library item's picture, or None. Only names the library itself made are looked up."""
    if kind not in ("worlds", "characters", "props") or not re.fullmatch(r"[A-Za-z0-9_-]{1,60}", iid or ""):
        return None
    for name in ("thumb.png", "thumb.jpg"):
        f = root() / kind / iid / name
        if f.is_file():
            return f
    return None


def page():
    """The library as a page for the app: what every 3D video can reuse."""
    import html
    e = html.escape

    def card(kind, iid, title, text, foot=""):
        pic = (f'<img src="/studio/library/thumb?kind={kind}&id={e(iid)}" alt="">' if thumb(kind, iid)
               else f'<div class="ph">{e(title[:1].upper())}</div>')
        return f'<div class="c">{pic}<div class="t">{e(title)}</div><div class="d">{e(text)}</div><div class="f">{e(foot)}</div></div>'

    def sec(title, note, cards, empty):
        return f'<h2>{title} <span>{len(cards)}</span></h2><p class="n">{note}</p><div class="g">{"".join(cards) or f"<p class=n>{empty}</p>"}</div>'

    ws = [card("worlds", w["id"], w["id"].replace("-", " "), w.get("describe", ""), "first made for: " + w["made_for"] if w.get("made_for") else "") for w in worlds()]
    cs = [card("characters", c["id"], c["id"], c.get("describe", ""), "moves: " + ", ".join(c.get("clips") or [])) for c in characters()]
    ps = [card("props", p["id"], p.get("name", p["id"]), ", ".join(p.get("tags", [])[:6]), p.get("source", "")) for p in props()]
    return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Library</title><style>
:root{color-scheme:dark}body{margin:0;background:#101012;color:#eee;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:36px 20px 80px}h1{font-size:28px;margin:0 0 6px}h2{font-size:19px;margin:38px 0 2px}
h2 span{color:#888;font-weight:400;font-size:15px;margin-left:6px}.n{color:#9a9aa2;margin:0 0 14px;max-width:760px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.c{background:#1a1a1e;border:1px solid #2a2a30;border-radius:12px;overflow:hidden;padding-bottom:12px}
.c img,.ph{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#232329}
.ph{display:flex;align-items:center;justify-content:center;font-size:44px;color:#555;font-weight:700}
.t{font-weight:650;padding:10px 14px 2px;text-transform:capitalize}.d{padding:0 14px;color:#b9b9c0;font-size:13.5px;
display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.f{padding:6px 14px 0;color:#7d7d86;font-size:12.5px}
</style></head><body><main><h1>Library</h1>
<p class="n">Everything a 3D video can reuse. A new video takes the places, people and things it needs from here, and any new place
it builds is saved here for the next one. Nothing here has to be made twice.</p>""" + \
        sec("Worlds", "Places, built once in detail. A script that is set in one of these uses it as it is.", ws,
            "None yet. The first 3D video's places are saved here.") + \
        sec("Characters", "People and figures, each with movements made for its own skeleton. Ask for any movement by name (a dance, a jump, a crouch) and it is fetched.", cs,
            "None yet: they arrive with the 3D kit.") + \
        sec("Props", "Free models fetched the first time a world needs one (a bench, a tree, a lamp), then kept.", ps, "None fetched yet.") + \
        "</main></body></html>"


def glb_json(f):
    b = Path(f).read_bytes()
    return json.loads(b[20:20 + struct.unpack("<I", b[12:16])[0]])


def demo():
    import tempfile
    old = os.environ.get("AI_EDITOR_HOME")
    with tempfile.TemporaryDirectory() as t:
        os.environ["AI_EDITOR_HOME"] = t
        try:
            js = Path(t) / "street.js"
            js.write_text("// World street\n// update(state) reads: time\nexport async function createWorld() {}\n", encoding="utf-8")
            a = save_world(js, "A New York side street by day: brick buildings, parked cars, street lamps.", video="demo")
            assert a == "street" and save_world(js, "x") == "street", "the same file is not saved twice"
            js.write_text("// other\nexport async function createWorld() { return 1 }\n", encoding="utf-8")
            assert save_world(js, "A street in Paris at night") == "street-2"
            assert find("We are in New York, on a street with parked cars")[0][1] == "street", find("New York street")
            assert find("the surface of Mars") == []
            assert worlds()[0]["exposes"].startswith("World street") and use_world("street", Path(t) / "e" / "worlds" / "s.js")
            assert not use_world("nowhere", Path(t) / "x.js")
            assert words_of("The parked cars of New York") == {"parked", "car", "new", "york"}, words_of("The parked cars of New York")
            assert "none yet" not in listing() and "street-2" in listing()
        finally:
            if old is None:
                os.environ.pop("AI_EDITOR_HOME", None)
            else:
                os.environ["AI_EDITOR_HOME"] = old
    return 0
