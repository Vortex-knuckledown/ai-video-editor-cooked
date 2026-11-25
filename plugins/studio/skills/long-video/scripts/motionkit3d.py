"""The motion kit in real 3D: the graphics that carry a film (bars, a number, a tier list, a document, exploded layers)
drawn by three.js on one lit stage, templates/stage3d.js: studio light, chrome, glass that refracts the video's own
footage behind it, a black mirror floor that really reflects, and a camera that travels. Same data as motionkit.py and
the same contract: part(kind, sh, W, H, look, bg) -> (markup, script) for the clip page, or None when this kind is not
one of these (then motionkit.py draws it). Every frame is worked out from the timeline's time alone.
"""
import html
import json
import re
from pathlib import Path

KINDS = ("bars", "versus", "stat", "tier", "paper", "source", "layers")
STAGE = Path(__file__).resolve().parents[1] / "templates" / "stage3d.js"
ASSETS = ("stage3d.js",)      # copied beside three.module.js in the clip's assets

CSS = """
<style>
  .k3 { position:absolute; left:0; top:0; width:__W__px; height:__H__px; overflow:hidden; background:__GROUND__; --u:__U__px;
        font-family:"SF Pro Display",-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Arial,sans-serif; color:__INK__; }
  .k3 canvas { position:absolute; left:0; top:0; width:__W__px; height:__H__px; display:block; }
  .k3-vig { position:absolute; inset:0; background:radial-gradient(95% 80% at 50% 46%, transparent 42%, rgba(0,0,0,.5) 100%); }
  .k3-head { position:absolute; left:6%; right:6%; top:__HEADY__%; text-align:center; }
  .k3-kicker { font-weight:600; letter-spacing:.26em; text-transform:uppercase; font-size:calc(var(--u)*1.7); opacity:.66; }
  .k3-title { margin-top:calc(var(--u)*.8); font-weight:700; letter-spacing:-.035em; font-size:calc(var(--u)*4.2); line-height:1.04;
        text-shadow:0 calc(var(--u)*.5) calc(var(--u)*2.6) rgba(0,0,0,.6); }
</style>
"""


def esc(t):
    return html.escape(str(t if t is not None else ""), quote=True)


def num(v):
    m = re.fullmatch(r"\s*(\D*?)(\d[\d,]*)(\.\d+)?(.*?)\s*", str(v))
    if not m:
        return None
    return [m.group(1), float(m.group(2).replace(",", "") + (m.group(3) or "")), len((m.group(3) or ".")[1:]), m.group(4)]


def data_of(kind, sh):
    """The shot as the stage's component takes it, or None when it has nothing to draw."""
    if kind in ("bars", "versus"):
        items = [[str(a), float(b)] for a, b in (sh.get("items") or [])][:6]
        unit = str(sh.get("unit") or "")
        pre = unit if unit in ("$", "\u00a3", "\u20ac", "\u20b9") else ""
        return {"items": items, "pre": pre, "unit": "" if pre else ((" " if unit and unit[0].isalnum() else "") + unit)} if len(items) >= 2 else None
    if kind == "stat":
        if not sh.get("value"):
            return None
        n = num(sh.get("value"))
        return {"value": str(sh["value"]), "n": n if n and n[1] >= 10 else None, "label": str(sh.get("label") or ""), "note": str(sh.get("note") or "")}
    if kind == "tier":
        tiers = [[str(a), [str(x) for x in b][:5]] for a, b in (sh.get("tiers") or [])][:6]
        return {"tiers": tiers} if tiers else None
    if kind in ("paper", "source"):
        if not (sh.get("title") or sh.get("highlight")):
            return None
        fn = num(sh.get("finding_value")) if sh.get("finding_value") else None
        return {"title": str(sh.get("title") or ""), "by": str(sh.get("by") or ""), "kicker": str(sh.get("kicker") or sh.get("source") or ""),
                "highlight": str(sh.get("highlight") or ""), "finding": str(sh.get("finding") or ""), "finding_value": str(sh.get("finding_value") or ""),
                "finding_kicker": str(sh.get("finding_kicker") or ""), "fn": fn if fn and fn[1] >= 10 else None}
    if kind == "layers":
        items = [[str(i[0]), str(i[1]) if len(i) > 1 else ""] if isinstance(i, list) else [str(i), ""] for i in (sh.get("items") or [])][:5]
        return {"items": items, "mark": int(sh.get("mark") or 0)} if len(items) >= 2 else None
    return None


def part(kind, sh, W, H, look, bg=None):
    """One graphic on the 3D stage. bg: a picture in assets/ (the video's own footage) seen blurred behind and through the glass."""
    data = data_of(kind, sh) if kind in KINDS else None
    if not data:
        return None
    wide = W >= H
    u = min(W, H) / 100.0 * (1.22 if wide else 1.0)
    has_head = kind not in ("paper", "source") and (sh.get("title") or sh.get("kicker"))
    head = ""
    if has_head:
        head = ('<div class="k3-head">' + (f'<div id="k3-kick" class="k3-kicker" style="opacity:0">{esc(sh.get("kicker"))}</div>' if sh.get("kicker") else "")
                + (f'<div id="k3-title" class="k3-title" style="opacity:0">{esc(sh.get("title"))}</div>' if sh.get("title") else "") + "</div>")
    page = (CSS.replace("__W__", str(W)).replace("__H__", str(H)).replace("__U__", f"{u:.3f}").replace("__INK__", look.get("ink") or "#FFFFFF")
            .replace("__GROUND__", look.get("ground") or "#0A0C12").replace("__HEADY__", str(6 if wide else 9))
            + f'<div class="k3"><canvas id="k3" width="{W}" height="{H}"></canvas>'
            + (f'<img id="k3bg" src="assets/{esc(bg)}" alt="" style="position:absolute;width:1px;height:1px;opacity:0">' if bg else "")
            + '<div class="k3-vig"></div>' + head + "</div>")
    cfg = {"kind": kind, "w": W, "h": H, "accent": look.get("accent") or "#4D8DFF", "ground": look.get("ground") or "#0A0C12", "bg": bool(bg), "data": data}
    script = ("""
<script>
  (function () {
    [["#k3-kick", 0.05, 14], ["#k3-title", 0.14, 22]].forEach(function (r) {
      if (document.querySelector(r[0])) tl.fromTo(r[0], { opacity: 0, y: r[2] }, { opacity: r[0] === "#k3-kick" ? 0.66 : 1, y: 0, duration: 0.6, ease: "power3.out", immediateRender: false }, r[1]);
    });
    window.__k3 = Object.assign(__CFG__, { dur: DURATION });
  })();
</script>
<script type="module">
  import { run } from "./assets/stage3d.js";
  run(window.__k3);
</script>
""").replace("__CFG__", json.dumps(cfg))
    return page, script


def demo():
    look = {"ground": "#0A0C12", "ink": "#FFFFFF", "accent": "#4D8DFF"}
    for kind, sh in (("stat", {"value": "1,500", "label": "people hurt"}), ("bars", {"title": "Share", "items": [["A", 31], ["B", 15]], "unit": "%"}),
                     ("tier", {"tiers": [["S", ["x"]], ["A", ["y", "z"]]]}), ("paper", {"title": "A <paper>", "highlight": "the line", "finding_value": "25"}),
                     ("layers", {"items": [["Top", "note"], "Bottom"], "mark": 1})):
        got = part(kind, sh, 1920, 1080, look, "bg.jpg")
        assert got and 'id="k3"' in got[0] and "stage3d.js" in got[1] and "__" not in got[0], kind
    assert part("quote", {"text": "x"}, 1920, 1080, look) is None and part("bars", {"items": [["A", 1]]}, 1920, 1080, look) is None
    assert data_of("bars", {"items": [["A", 1], ["B", 2]], "unit": "$"})["pre"] == "$" and data_of("stat", {"value": "2 h 40"})["n"] is None
    assert STAGE.is_file() and "export function run" in STAGE.read_text(encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(demo() or print("motionkit3d demo ok") or 0)
