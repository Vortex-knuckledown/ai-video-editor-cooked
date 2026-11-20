"""The motion kit: a video's graphics drawn with depth, glass and light, from the shot's own data.

Each graphic is an HTML page (CSS 3D, blur, gradients, GSAP) rendered to a clip by the animation tool, with no agent:
glass panels tilted in space, glossy bars standing on their reflections, a paper lying in perspective with one line lit,
layers pulled apart, the video's own footage blurred behind it. The flat text-and-rectangles version stays as the
fallback when a clip does not render.

    part(kind, shot, W, H, look, bg) -> (markup for #scene, a script that adds to the page's GSAP timeline `tl`), or None
"""
import html
import json
import re

KINDS = ("title", "word", "stat", "bars", "versus", "list", "tier", "paper", "source", "layers", "timeline", "quote", "place")

CSS = """
<style>
  .mk { position:absolute; left:0; top:0; width:__W__px; height:__H__px; overflow:hidden; --u:__U__px; --ink:__INK__; --accent:__ACCENT__; --ground:__GROUND__;
        font-family:"SF Pro Display",-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Arial,sans-serif; color:var(--ink); background:var(--ground); }
  .mk * { box-sizing:border-box; }
  .mk-bg { position:absolute; inset:-6%; background:#000 center/cover no-repeat; filter:blur(calc(var(--u)*2.4)) brightness(.34) saturate(.75); }
  .mk-wash { position:absolute; inset:0; background:
      radial-gradient(120% 90% at 50% 108%, color-mix(in srgb, var(--accent) 34%, transparent) 0%, transparent 58%),
      radial-gradient(90% 70% at 50% 40%, transparent 30%, rgba(0,0,0,.62) 100%),
      linear-gradient(180deg, color-mix(in srgb, var(--ground) 78%, transparent), color-mix(in srgb, var(--ground) 52%, transparent)); }
  .mk-grain { position:absolute; inset:0; opacity:.07; mix-blend-mode:overlay;
      background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>"); }
  .mk-cam { position:absolute; inset:0; perspective:calc(var(--u)*150); transform-origin:50% 50%; will-change:transform; }
  .mk-stage { position:absolute; inset:0; transform-style:preserve-3d; }
  .mk-head { position:absolute; left:8%; right:8%; top:__HEADY__%; text-align:center; }
  .mk-kicker { font-weight:600; letter-spacing:.26em; text-transform:uppercase; font-size:calc(var(--u)*1.75); color:color-mix(in srgb, var(--ink) 62%, transparent); }
  .mk-title { margin-top:calc(var(--u)*.9); font-weight:700; letter-spacing:-.038em; font-size:calc(var(--u)*__TS__); line-height:1.03;
      text-shadow:0 calc(var(--u)*.6) calc(var(--u)*3) rgba(0,0,0,.5); }
  .mk-glass { background:linear-gradient(180deg, rgba(255,255,255,.115), rgba(255,255,255,.035)); border:1px solid rgba(255,255,255,.16);
      border-radius:calc(var(--u)*1.9); box-shadow:0 calc(var(--u)*3.4) calc(var(--u)*8) rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.22), inset 0 0 calc(var(--u)*4) color-mix(in srgb, var(--accent) 12%, transparent);
      -webkit-backdrop-filter:blur(calc(var(--u)*2.2)); backdrop-filter:blur(calc(var(--u)*2.2)); }
  .mk-num { font-weight:700; letter-spacing:-.045em; font-variant-numeric:tabular-nums;
      background:linear-gradient(180deg, #fff 8%, color-mix(in srgb, var(--accent) 62%, #fff) 96%); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .mk-sub { color:color-mix(in srgb, var(--ink) 66%, transparent); font-weight:500; letter-spacing:-.01em; }
  .mk-src { position:absolute; right:4%; bottom:13%; font-size:calc(var(--u)*1.35); letter-spacing:.14em; text-transform:uppercase; color:color-mix(in srgb, var(--ink) 42%, transparent); }
  .mk-streak { position:absolute; left:-10%; right:-10%; height:calc(var(--u)*.5); border-radius:50%;
      background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 80%, #fff) 45%, #fff 50%, color-mix(in srgb, var(--accent) 80%, #fff) 55%, transparent);
      box-shadow:0 0 calc(var(--u)*3) calc(var(--u)*.7) color-mix(in srgb, var(--accent) 70%, transparent); filter:blur(.6px); }
  .enter { opacity:0; }
</style>
"""

BASE_JS = """
<script>
  (function () {
    var E = "power3.out", D = DURATION;
    function inn(sel, from, at, dur) { tl.fromTo(sel, Object.assign({ opacity: 0 }, from), { opacity: 1, x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, scale: 1, duration: dur || 0.7, ease: E, immediateRender: false }, at); }
    function count(sel, to, at, dur, dec, pre, post) {
      var o = { v: 0 }, el = document.querySelector(sel);
      if (!el) return;
      var fmt = function (v) { return (pre || "") + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-US")) + (post || ""); };
      el.textContent = fmt(0);
      tl.to(o, { v: to, duration: dur || 1.1, ease: "power2.out", onUpdate: function () { el.textContent = fmt(o.v); } }, at);
    }
    tl.fromTo("#mk-cam", { scale: 1.0 }, { scale: 1.07, duration: D, ease: "none", immediateRender: false }, 0);
    tl.fromTo("#mk-bg", { scale: 1.12, xPercent: -1.5 }, { scale: 1.2, xPercent: 1.5, duration: D, ease: "none", immediateRender: false }, 0);
    inn(".mk-kicker", { y: 14 }, 0.05, 0.5); inn(".mk-title", { y: 22 }, 0.14, 0.7); inn(".mk-src", {}, 0.6, 0.5);
    __BODY__
  })();
</script>
"""


def esc(t):
    return html.escape(str(t if t is not None else ""), quote=True)


def num(v):
    """(prefix, number, decimals, suffix) of a value like "$1,500", "30%", "2.5 million"; None when it has no number."""
    m = re.fullmatch(r"\s*(\D*?)(\d[\d,]*)(\.\d+)?(.*?)\s*", str(v))
    if not m:
        return None
    return m.group(1), float(m.group(2).replace(",", "") + (m.group(3) or "")), len((m.group(3) or ".")[1:]), m.group(4)


def mid(inner, top=0, bottom=16):
    return f'<div style="position:absolute;left:0;right:0;top:{top}%;bottom:{bottom}%;display:flex;align-items:center;justify-content:center;transform-style:preserve-3d">{inner}</div>'


def head(kicker, title):
    return ('<div class="mk-head">' + (f'<div class="mk-kicker enter">{esc(kicker)}</div>' if kicker else "") +
            (f'<div class="mk-title enter">{esc(title)}</div>' if title else "") + "</div>")


def part(kind, sh, W, H, look, bg=None):
    """One graphic. bg: the name of a picture in assets/ to blur behind it (the video's own footage), or None."""
    if kind not in KINDS:
        return None
    wide = W >= H
    u = min(W, H) / 100.0 * (1.22 if wide else 1.0)      # a wide frame has room: everything a little larger
    body, js, ts, heady = "", "", 5.2, (9 if wide else 11)
    src = f'<div class="mk-src enter">Source: {esc(sh["source"])}</div>' if sh.get("source") and kind not in ("paper", "source") else ""

    if kind in ("title", "word", "place"):
        text = str(sh.get("text") or "")
        big = min(26.0 if kind == "word" else 15.0, (150.0 if wide else 84.0) / max(4, len(text)) * 1.75)
        kick = sh.get("kicker") or (sh.get("sub") if kind == "place" else "")
        sub = sh.get("sub") if kind != "place" else ""
        body = mid(f'<div style="width:88%;text-align:center">'
                + (f'<div class="mk-kicker enter" style="margin-bottom:calc(var(--u)*1.6)">{esc(kick)}</div>' if kick else "")
                + f'<div id="mk-big" class="enter" style="font-weight:800;letter-spacing:-.045em;line-height:.98;font-size:calc(var(--u)*{big:.1f});'
                  f'text-shadow:0 0 calc(var(--u)*5) color-mix(in srgb, var(--accent) 45%, transparent), 0 calc(var(--u)*1) calc(var(--u)*4) rgba(0,0,0,.6)">{esc(text)}</div>'
                + '<div id="mk-streak" class="mk-streak enter" style="position:relative;margin-top:calc(var(--u)*1.8)"></div>'
                + (f'<div class="mk-sub enter" id="mk-subl" style="margin-top:calc(var(--u)*2.2);font-size:calc(var(--u)*2.6)">{esc(sub)}</div>' if sub else "") + "</div>")
        js = ('inn("#mk-big", { scale: 1.12, y: 30 }, 0.1, 0.8);'
              'tl.fromTo("#mk-streak", { opacity: 0, scaleX: 0.05 }, { opacity: 1, scaleX: 1, duration: 0.7, ease: "power3.out", immediateRender: false }, 0.28);'
              'tl.to("#mk-streak", { opacity: 0.35, duration: 1.2, ease: "sine.inOut" }, 1.0); inn("#mk-subl", { y: 16 }, 0.5, 0.6);')

    elif kind == "stat":
        n = num(sh.get("value"))
        val = (f'<span id="mk-v" class="mk-num">{esc(sh.get("value"))}</span>')
        body = (head(sh.get("kicker") if sh.get("title") else "", sh.get("title")) +
                mid(f'<div id="mk-card" class="mk-glass enter" style="padding:calc(var(--u)*4.2) calc(var(--u)*6);min-width:{44 if wide else 74}%;max-width:86%;text-align:left">'
                + (f'<div class="mk-kicker" style="margin-bottom:calc(var(--u)*1)">{esc(sh.get("kicker") or "")}</div>' if sh.get("kicker") and not sh.get("title") else "")
                + f'<div style="display:flex;align-items:baseline;gap:calc(var(--u)*2.2);flex-wrap:wrap"><div style="font-size:calc(var(--u)*{min(19.0, 120.0 / max(3, len(str(sh.get("value") or ""))) * 1.2):.1f});line-height:.95">{val}</div>'
                  f'<div class="mk-sub" style="font-size:calc(var(--u)*3.4);line-height:1.15;max-width:calc(var(--u)*40);color:var(--ink)">{esc(sh.get("label"))}</div></div>'
                + (f'<div class="mk-sub" style="margin-top:calc(var(--u)*1.6);font-size:calc(var(--u)*1.8)">{esc(sh.get("note"))}</div>' if sh.get("note") else "") + "</div>", 8))
        js = 'inn("#mk-card", { y: 60, rotationX: 22, scale: 0.94 }, 0.2, 0.9);'
        if n and n[1] >= 10:
            js += f'count("#mk-v", {n[1]}, 0.35, 1.2, {n[2]}, {json.dumps(n[0])}, {json.dumps(n[3])});'
        ts = 4.2

    elif kind in ("bars", "versus"):
        items = [(str(a), float(b)) for a, b in (sh.get("items") or [])][:6]
        top = max(abs(v) for _, v in items) or 1.0
        best = max(range(len(items)), key=lambda i: items[i][1])
        unit = str(sh.get("unit") or "")
        bw = min(13.0 if wide else 15.0, (96.0 if wide else 78.0) / len(items) * 0.5)
        cols = ""
        for i, (name, v) in enumerate(items):
            hpx = max(4.0, (33.0 if wide else 46.0) * abs(v) / top)
            on = i == best
            fill = ("linear-gradient(180deg, color-mix(in srgb, var(--accent) 92%, #fff) 0%, var(--accent) 38%, color-mix(in srgb, var(--accent) 38%, #05060a) 100%)" if on
                    else "linear-gradient(180deg, rgba(255,255,255,.62) 0%, rgba(255,255,255,.24) 40%, rgba(255,255,255,.08) 100%)")
            glow = "0 0 calc(var(--u)*5) color-mix(in srgb, var(--accent) 60%, transparent)," if on else ""
            cols += (f'<div style="display:flex;flex-direction:column;align-items:center;width:calc(var(--u)*{bw + 6:.1f})">'
                     f'<div id="mk-bv{i}" class="enter" style="font-weight:700;letter-spacing:-.04em;font-size:calc(var(--u)*{5.2 if on else 3.9});margin-bottom:calc(var(--u)*1.1);'
                     f'{"text-shadow:0 0 calc(var(--u)*3) color-mix(in srgb, var(--accent) 70%, transparent);" if on else "color:color-mix(in srgb, var(--ink) 88%, transparent);"}">0</div>'
                     f'<div id="mk-b{i}" style="width:calc(var(--u)*{bw:.1f});height:calc(var(--u)*{hpx:.1f});transform-origin:50% 100%;transform:scaleY(0.001);border-radius:calc(var(--u)*.5) calc(var(--u)*.5) 0 0;'
                     f'background:{fill};box-shadow:{glow} inset 0 2px 0 rgba(255,255,255,.75), inset 1px 0 0 rgba(255,255,255,.22), inset -1px 0 0 rgba(0,0,0,.25)"></div>'
                     f'<div id="mk-br{i}" style="width:calc(var(--u)*{bw:.1f});height:calc(var(--u)*{hpx * 0.55:.1f});transform-origin:50% 0%;transform:scaleY(0.001);background:{fill};opacity:.22;'
                     f'-webkit-mask-image:linear-gradient(180deg, #000, transparent 85%);mask-image:linear-gradient(180deg, #000, transparent 85%);filter:blur(1.5px)"></div>'
                     f'<div class="mk-sub enter" id="mk-bl{i}" style="position:absolute;bottom:calc(var(--u)*-4.2);font-size:calc(var(--u)*2.3);white-space:nowrap;{"color:var(--ink);font-weight:600;" if on else ""}">{esc(name)}</div></div>')
            dec = 0 if float(v).is_integer() else 1
            js += (f'tl.fromTo("#mk-b{i}", {{ scaleY: 0.001 }}, {{ scaleY: 1, duration: 0.95, ease: "power3.out", immediateRender: false }}, {0.35 + i * 0.13:.2f});'
                   f'tl.fromTo("#mk-br{i}", {{ scaleY: 0.001 }}, {{ scaleY: 1, duration: 0.95, ease: "power3.out", immediateRender: false }}, {0.35 + i * 0.13:.2f});'
                   f'inn("#mk-bv{i}", {{ y: 14 }}, {0.45 + i * 0.13:.2f}, 0.5); count("#mk-bv{i}", {v}, {0.45 + i * 0.13:.2f}, 0.9, {dec}, "", {json.dumps(unit)}); inn("#mk-bl{i}", {{ y: 10 }}, {0.3 + i * 0.1:.2f}, 0.5);')
        body = (head(sh.get("kicker") or sh.get("source") and "", sh.get("title")) +
                f'<div id="mk-chart" style="position:absolute;left:0;right:0;top:{24 if wide else 30}%;height:calc(var(--u)*__CH__);display:flex;justify-content:center;align-items:flex-start;'
                f'gap:calc(var(--u)*{2.4 if len(items) > 3 else 6});transform:rotateX(6deg)"><div style="display:flex;align-items:flex-end;gap:inherit;height:calc(var(--u)*__CH__);position:relative">'
                + cols.replace('flex-direction:column;align-items:center;', 'flex-direction:column;align-items:center;justify-content:flex-end;position:relative;height:calc(var(--u)*__CH__);') + "</div></div>")
        # each column: value, bar and (below the floor line) its reflection; the reflection is pulled out of the flow so the bars stand on one line
        body = body.replace("__CH__", "43" if wide else "56").replace('id="mk-br', 'data-r id="mk-br')
        js += 'document.querySelectorAll("[data-r]").forEach(function (r) { r.style.position = "absolute"; r.style.top = "100%"; });'

    elif kind == "list":
        items = [str(x) for x in (sh.get("items") or [])][:6]
        rows = ""
        for i, t in enumerate(items):
            rows += (f'<div id="mk-r{i}" class="mk-glass enter" style="display:flex;align-items:center;gap:calc(var(--u)*2.4);padding:calc(var(--u)*2.2) calc(var(--u)*3);margin-bottom:calc(var(--u)*1.5)">'
                     f'<div style="flex:none;width:calc(var(--u)*5.2);height:calc(var(--u)*5.2);border-radius:calc(var(--u)*1.3);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:calc(var(--u)*2.7);'
                     f'background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, #fff), var(--accent));color:#05060a;box-shadow:0 0 calc(var(--u)*2.4) color-mix(in srgb, var(--accent) 55%, transparent)">{i + 1}</div>'
                     f'<div style="font-weight:600;letter-spacing:-.02em;font-size:calc(var(--u)*{4.0 if len(t) < 34 else 3.1});line-height:1.12">{esc(t)}</div></div>')
            js += f'inn("#mk-r{i}", {{ x: 90, rotationY: -18 }}, {0.3 + i * 0.16:.2f}, 0.7);'
        body = head(sh.get("kicker"), sh.get("title")) + f'<div style="position:absolute;left:{18 if wide else 8}%;right:{18 if wide else 8}%;top:{27 if wide else 26}%;transform:rotateY(-5deg) rotateX(3deg);transform-style:preserve-3d">{rows}</div>'

    elif kind == "tier":
        tiers = [(str(a), [str(x) for x in b][:5]) for a, b in (sh.get("tiers") or [])][:6]
        rows, k = "", 0
        for i, (letter, names) in enumerate(tiers):
            chips = ""
            for name in names:
                chips += (f'<div id="mk-c{k}" class="enter" style="padding:calc(var(--u)*1.1) calc(var(--u)*2);border-radius:calc(var(--u)*1.1);background:rgba(8,10,16,.62);border:1px solid rgba(255,255,255,.14);'
                          f'font-weight:600;font-size:calc(var(--u)*2.8);letter-spacing:-.01em;white-space:nowrap">{esc(name)}</div>')
                js += f'inn("#mk-c{k}", {{ scale: 0.7, y: 16 }}, {0.7 + k * 0.14:.2f}, 0.45);'
                k += 1
            first = i == 0
            rows += (f'<div id="mk-t{i}" class="mk-glass enter" style="display:flex;align-items:center;gap:calc(var(--u)*2.4);padding:calc(var(--u)*1.7) calc(var(--u)*2.6);margin-bottom:calc(var(--u)*1.4);'
                     f'{"background:linear-gradient(90deg, color-mix(in srgb, var(--accent) 34%, transparent), rgba(255,255,255,.05));" if first else ""}">'
                     f'<div style="flex:none;width:calc(var(--u)*6);font-weight:800;font-size:calc(var(--u)*5.2);letter-spacing:-.03em;text-align:center;{"" if first else "color:color-mix(in srgb, var(--ink) 78%, transparent);"}">{esc(letter[:2].upper())}</div>'
                     f'<div style="display:flex;gap:calc(var(--u)*1.2);flex-wrap:wrap">{chips}</div></div>')
            js += f'inn("#mk-t{i}", {{ x: -70, rotationY: 14 }}, {0.25 + i * 0.12:.2f}, 0.65);'
        body = head(sh.get("kicker") or "Tier list", sh.get("title")) + f'<div style="position:absolute;left:{16 if wide else 7}%;right:{16 if wide else 7}%;top:{26 if wide else 24}%;transform:rotateY(7deg) rotateX(2deg);transform-style:preserve-3d">{rows}</div>'

    elif kind in ("paper", "source"):
        lines = "".join(f'<div style="height:calc(var(--u)*.85);margin-top:calc(var(--u)*1.25);border-radius:2px;background:#c9cbd3;width:{w}%"></div>' for w in (96, 100, 92, 98, 64))
        lines2 = "".join(f'<div style="height:calc(var(--u)*.85);margin-top:calc(var(--u)*1.25);border-radius:2px;background:#c9cbd3;width:{w}%"></div>' for w in (99, 94, 100, 58, 97, 90))
        fn = num(sh.get("finding_value")) if sh.get("finding_value") else None
        card = ""
        if sh.get("finding") or sh.get("finding_value"):
            card = (f'<div id="mk-find" class="mk-glass enter" style="position:absolute;left:{57 if wide else 8}%;right:{5 if wide else 8}%;top:{24 if wide else 7}%;padding:calc(var(--u)*3) calc(var(--u)*3.4)">'
                    f'<div class="mk-kicker" style="font-size:calc(var(--u)*1.4)">{esc(sh.get("finding_kicker") or "Key finding")}</div>'
                    '<div style="display:flex;align-items:center;gap:calc(var(--u)*2.2);margin-top:calc(var(--u)*1)">'
                    + (f'<div id="mk-fv" class="mk-num" style="font-size:calc(var(--u)*9);line-height:.95">{esc(sh.get("finding_value"))}</div>' if sh.get("finding_value") else "")
                    + f'<div style="font-weight:600;letter-spacing:-.02em;font-size:calc(var(--u)*{2.7 if sh.get("finding_value") else 3.3});line-height:1.14">{esc(sh.get("finding") or "")}</div></div></div>')
            js += 'inn("#mk-find", { y: -40, rotationX: -18 }, 1.25, 0.8);'
            if fn and fn[1] >= 10:
                js += f'count("#mk-fv", {fn[1]}, 1.35, 1.0, {fn[2]}, {json.dumps(fn[0])}, {json.dumps(fn[3])});'
        body = (card +
                f'<div id="mk-paper" class="enter" style="position:absolute;left:{7 if wide else 9}%;width:{46 if wide else 82}%;top:{10 if wide else 30}%;padding:calc(var(--u)*4) calc(var(--u)*4.2) calc(var(--u)*7);'
                'background:linear-gradient(180deg,#fbfaf6,#efede6);color:#17181c;border-radius:calc(var(--u)*.5);transform-origin:50% 100%;'
                'box-shadow:0 calc(var(--u)*5) calc(var(--u)*10) rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.06);font-family:Georgia,\'Times New Roman\',serif">'
                + (f'<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-weight:600;letter-spacing:.2em;text-transform:uppercase;font-size:calc(var(--u)*1.15);color:#6b6e78">{esc(sh.get("journal"))}</div>' if sh.get("journal") else "")
                + f'<div style="margin-top:calc(var(--u)*1.6);font-size:calc(var(--u)*3.6);line-height:1.14;letter-spacing:-.01em">{esc(sh.get("title"))}</div>'
                + (f'<div style="margin-top:calc(var(--u)*1.2);font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:calc(var(--u)*1.35);color:#55585f">{esc(sh.get("by"))}</div>' if sh.get("by") else "")
                + f'<div style="margin-top:calc(var(--u)*2.4);border-top:1px solid #dcdcd6;padding-top:calc(var(--u)*.6)">{lines}'
                  f'<div id="mk-hl" style="position:relative;margin-top:calc(var(--u)*1.4);padding:calc(var(--u)*.7) calc(var(--u)*1);font-family:-apple-system,Helvetica,Arial,sans-serif;font-weight:700;'
                  f'font-size:calc(var(--u)*2.3);line-height:1.3;border-radius:calc(var(--u)*.4)"><div id="mk-hlbg" style="position:absolute;inset:0;border-radius:inherit;transform-origin:0 50%;transform:scaleX(0.001);'
                  'background:color-mix(in srgb, var(--accent) 34%, #fff);box-shadow:0 0 calc(var(--u)*2.4) color-mix(in srgb, var(--accent) 60%, transparent)"></div>'
                  f'<span style="position:relative">{esc(sh.get("highlight"))}</span></div>{lines2}</div></div>')
        js += ('tl.fromTo("#mk-paper", { opacity: 0, y: 140, rotationX: 46, rotationZ: -7, scale: 0.86 }, { opacity: 1, y: 0, rotationX: 16, rotationZ: -2.5, scale: 1, duration: 1.1, ease: "power3.out", immediateRender: false }, 0.1);'
               'tl.to("#mk-paper", { rotationX: 11, rotationZ: -1.2, y: -14, duration: Math.max(0.5, D - 1.2), ease: "sine.inOut" }, 1.2);'
               'tl.fromTo("#mk-hlbg", { scaleX: 0.001 }, { scaleX: 1, duration: 0.7, ease: "power2.inOut", immediateRender: false }, 0.85);')

    elif kind == "layers":
        items = [(i if isinstance(i, list) else [i, ""]) for i in (sh.get("items") or [])][:5]
        n = len(items)
        mark = int(sh.get("mark") or 0)
        planes, labels = "", ""
        for i, (name, note) in enumerate(items):
            on = mark == i + 1
            z = (n - 1 - i) * 11.0
            planes += (f'<div id="mk-p{i}" class="mk-glass" style="position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;transform:translateZ(0px);'
                       f'{"background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 60%, transparent), color-mix(in srgb, var(--accent) 18%, transparent));border-color:color-mix(in srgb, var(--accent) 70%, #fff);" if on else ""}">'
                       f'<div style="position:absolute;left:8%;top:14%;right:8%;height:8%;border-radius:99px;background:rgba(255,255,255,{.5 if on else .22})"></div>'
                       f'<div style="position:absolute;left:8%;top:32%;width:{44 + (i * 13) % 34}%;height:6%;border-radius:99px;background:rgba(255,255,255,.14)"></div></div>')
            ly = 30 + (58.0 / max(1, n - 1)) * i if n > 1 else 50
            labels += (f'<div id="mk-l{i}" class="enter" style="position:absolute;left:{58 if wide else 10}%;top:{ly if wide else 62 + i * 6.2:.1f}%;transform:translateY(-50%)">'
                       f'<div style="font-weight:700;letter-spacing:-.025em;font-size:calc(var(--u)*{3.3 if wide else 3.0});{"color:var(--accent);" if on else ""}">{esc(name)}</div>'
                       + (f'<div class="mk-sub" style="font-size:calc(var(--u)*1.85);margin-top:calc(var(--u)*.3)">{esc(note)}</div>' if note else "") + "</div>")
            js += (f'tl.fromTo("#mk-p{i}", {{ opacity: 0, z: 0 }}, {{ opacity: 1, z: 0, duration: 0.4, ease: "power2.out", immediateRender: false }}, {0.15 + i * 0.06:.2f});'
                   f'tl.to("#mk-p{i}", {{ z: {z * u:.1f}, duration: 1.1, ease: "power3.inOut" }}, 0.7); inn("#mk-l{i}", {{ x: 30 }}, {1.25 + i * 0.14:.2f}, 0.55);')
        body = (head(sh.get("kicker"), sh.get("title")) +
                f'<div style="position:absolute;left:{21 if wide else 20}%;top:{50 if wide else 24}%;width:calc(var(--u)*{34 if wide else 46});height:calc(var(--u)*{23 if wide else 29});transform-style:preserve-3d;'
                f'transform:rotateX(60deg) rotateZ(-32deg)" id="mk-stack">{planes}</div>' + labels)
        js += 'tl.fromTo("#mk-stack", { rotationZ: -40 }, { rotationZ: -26, duration: D, ease: "none", immediateRender: false }, 0);'

    elif kind == "timeline":
        ev = [(str(a), str(b)) for a, b in (sh.get("events") or [])][:5]
        n = len(ev)
        cards = ""
        for i, (when, what) in enumerate(ev):
            last = i == n - 1
            x = 13 + 74.0 * i / max(1, n - 1) if n > 1 else 50
            up = i % 2 == 0
            cards += (f'<div id="mk-d{i}" class="enter" style="position:absolute;left:{x:.1f}%;top:50%;width:calc(var(--u)*{2.6 if last else 1.8});height:calc(var(--u)*{2.6 if last else 1.8});border-radius:50%;transform:translate(-50%,-50%);'
                      f'background:{"var(--accent)" if last else "#fff"};box-shadow:0 0 calc(var(--u)*3) {"var(--accent)" if last else "rgba(255,255,255,.6)"}"></div>'
                      f'<div id="mk-e{i}" class="mk-glass enter" style="position:absolute;left:{x:.1f}%;{"bottom" if up else "top"}:calc(50% + var(--u)*4);transform:translateX(-50%);padding:calc(var(--u)*1.5) calc(var(--u)*2.2);'
                      f'width:calc(var(--u)*{min(24.0, (116.0 if wide else 84.0) / n):.1f});text-align:center"><div class="{"mk-num" if last else ""}" style="font-weight:700;letter-spacing:-.04em;font-size:calc(var(--u)*4.8);line-height:1">{esc(when)}</div>'
                      f'<div class="mk-sub" style="margin-top:calc(var(--u)*.7);font-size:calc(var(--u)*2.1);line-height:1.2;color:var(--ink)">{esc(what)}</div></div>')
            t0 = 0.5 + i * (1.2 / max(1, n - 1)) if n > 1 else 0.5
            js += f'inn("#mk-d{i}", {{ scale: 0.2 }}, {t0:.2f}, 0.4); inn("#mk-e{i}", {{ y: {28 if up else -28}, rotationX: {-16 if up else 16} }}, {t0 + 0.05:.2f}, 0.6);'
        body = (head(sh.get("kicker"), sh.get("title")) +
                f'<div style="position:absolute;left:4%;right:4%;top:{30 if wide else 26}%;height:{50 if wide else 46}%;transform:rotateX(4deg);transform-style:preserve-3d">'
                '<div id="mk-rail" style="position:absolute;left:13%;right:13%;top:50%;height:2px;transform-origin:0 50%;transform:scaleX(0.001);background:linear-gradient(90deg, rgba(255,255,255,.2), rgba(255,255,255,.7), var(--accent));'
                f'box-shadow:0 0 calc(var(--u)*1.4) color-mix(in srgb, var(--accent) 60%, transparent)"></div>{cards}</div>')
        js += 'tl.fromTo("#mk-rail", { scaleX: 0.001 }, { scaleX: 1, duration: 1.5, ease: "power2.inOut", immediateRender: false }, 0.3);'

    elif kind == "quote":
        text = str(sh.get("text") or "")
        body = mid(f'<div id="mk-q" class="mk-glass enter" style="position:relative;width:{66 if wide else 86}%;padding:calc(var(--u)*5) calc(var(--u)*6) calc(var(--u)*4.4)">'
                '<div style="position:absolute;left:0;top:14%;bottom:14%;width:calc(var(--u)*.5);border-radius:99px;background:var(--accent);box-shadow:0 0 calc(var(--u)*2.4) var(--accent)"></div>'
                '<div class="mk-num" style="font-family:Georgia,serif;font-size:calc(var(--u)*12);line-height:.6;height:calc(var(--u)*5)">&ldquo;</div>'
                f'<div style="font-family:Georgia,\'Times New Roman\',serif;font-style:italic;letter-spacing:-.01em;font-size:calc(var(--u)*{5.4 if len(text) < 60 else 4.2 if len(text) < 110 else 3.3});line-height:1.22">{esc(text)}</div>'
                + (f'<div class="mk-kicker" style="margin-top:calc(var(--u)*2.6)">{esc(sh.get("by"))}</div>' if sh.get("by") else "") + "</div>")
        js = 'inn("#mk-q", { y: 50, rotationX: 16, scale: 0.95 }, 0.15, 0.9);'

    page = (CSS.replace("__W__", str(W)).replace("__H__", str(H)).replace("__U__", f"{u:.3f}").replace("__INK__", look.get("ink") or "#FFFFFF")
            .replace("__ACCENT__", look.get("accent") or "#4D8DFF").replace("__GROUND__", look.get("ground") or "#0A0C12").replace("__HEADY__", str(heady)).replace("__TS__", str(ts))
            + '<div class="mk">' + (f'<div id="mk-bg" class="mk-bg" style="background-image:url(assets/{esc(bg)})"></div>' if bg else '<div id="mk-bg" class="mk-bg" style="background:radial-gradient(60% 60% at 30% 30%, #1a2233, #05060a)"></div>')
            + '<div class="mk-wash"></div><div id="mk-cam" class="mk-cam"><div class="mk-stage">' + body + src + '</div></div><div class="mk-grain"></div></div>')
    return page, BASE_JS.replace("__BODY__", js)


def demo():
    look = {"ground": "#0A0C12", "ink": "#FFFFFF", "accent": "#4D8DFF"}
    for kind, sh in (("stat", {"value": "1,500", "label": "people hurt"}), ("bars", {"title": "Share", "items": [["A", 31], ["B", 15]], "unit": "%"}),
                     ("list", {"title": "T", "items": ["one", "two"]}), ("tier", {"tiers": [["S", ["x"]], ["A", ["y", "z"]]]}),
                     ("paper", {"title": "A <paper>", "highlight": "the line", "finding": "it works", "finding_value": "25"}),
                     ("layers", {"items": [["Top", "note"], "Bottom"], "mark": 1}), ("timeline", {"events": [["1908", "Tunguska"], ["2013", "Chelyabinsk"]]}),
                     ("quote", {"text": "Hello", "by": "Someone"}), ("title", {"text": "The end"}), ("word", {"text": "size"}), ("place", {"text": "Siberia, 1908"})):
        got = part(kind, sh, 1920, 1080, look, "bg.jpg")
        assert got and "mk-cam" in got[0] and "DURATION" in got[1] and "__" not in got[0].replace("__proto__", ""), kind
    assert "&lt;paper&gt;" in part("paper", {"title": "A <paper>", "highlight": "x"}, 1080, 1920, look)[0]
    assert part("map", {}, 1920, 1080, look) is None and num("$1,500 a day") == ("$", 1500.0, 0, " a day")
    return 0
