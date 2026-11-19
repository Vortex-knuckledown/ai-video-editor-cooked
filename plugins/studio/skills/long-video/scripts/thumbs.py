"""Thumbnails composed the way the ones that get clicked are: one subject cut out of its frame, one to five words in
heavy capitals, a dark ground, white type and one accent colour, readable at phone size.

The pattern is measured from a channel that uses it (ten thumbnails, November 2026): 1 to 5 words, one subject, dark
background, one accent; arrows almost never. The cut-out is the IS-Net general model (DIS, Apache-2.0, 178 MB) run with
the onnxruntime the editor already has; the type is Anton (SIL Open Font Licence). Both are fetched once.

    make(frame, words, out, layout="right", accent="#4D8DFF", mark=None)
"""
import os
import urllib.request
from pathlib import Path

W, H = 1280, 720
MODEL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
FONT = "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf"
GROUND = (10, 12, 18)
LAYOUTS = ("right", "left", "frame")
_SESS = {}


def home():
    h = os.environ.get("AI_EDITOR_HOME", "").strip()
    return Path(h) if h else Path.home() / ".ai-video-editor"


def fetch(url, dest, least):
    dest = Path(dest)
    if dest.is_file() and dest.stat().st_size >= least:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cooked-studio/1.0"}), timeout=600) as r, open(part, "wb") as f:   # noqa: S310
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    part.rename(dest)
    return dest


def font(size):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(str(fetch(FONT, home() / "fonts" / "Anton-Regular.ttf", 50000)), size)
    except Exception:   # noqa: BLE001  (no network the first time: a system heavy face)
        for f in ("/System/Library/Fonts/Supplemental/Impact.ttf", "/System/Library/Fonts/Supplemental/Arial Black.ttf", "C:/Windows/Fonts/impact.ttf"):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                continue
        return ImageFont.load_default()


def cutout(img):
    """The picture's subject on a clear ground (RGBA), or None when the model cannot be had. img: a PIL image."""
    import numpy as np
    from PIL import Image
    try:
        if "s" not in _SESS:
            import onnxruntime as ort
            _SESS["s"] = ort.InferenceSession(str(fetch(MODEL, home() / "models" / "isnet-general-use.onnx", 100_000_000)), providers=["CPUExecutionProvider"])
        s = _SESS["s"]
        x = np.asarray(img.convert("RGB").resize((1024, 1024), Image.LANCZOS), dtype=np.float32) / 255.0
        x = ((x - 0.5) / 1.0).transpose(2, 0, 1)[None]
        m = s.run(None, {s.get_inputs()[0].name: x})[0][0][0]
        m = (m - m.min()) / max(1e-6, float(m.max() - m.min()))
        m = np.clip(m * 1.25, 0, 1) ** 0.75          # thin parts (an antenna, a wing tip, hair) come out faint: lift them, keep the ground at nothing
        a = Image.fromarray((m * 255).astype("uint8")).resize(img.size, Image.LANCZOS)
        out = img.convert("RGBA")
        out.putalpha(a)
        return out
    except Exception:   # noqa: BLE001
        return None


def subject_box(rgba):
    """Where the subject is in a cut-out, and how much of the frame it fills (0 to 1)."""
    import numpy as np
    a = np.asarray(rgba.split()[3]) > 110
    if a.sum() < 400:
        return None, 0.0
    ys, xs = np.where(a)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1), float(a.mean())


def hexrgb(h):
    h = str(h).lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def draw_words(im, words, box, accent, mark=None, align="left"):
    """1 to 5 words stacked in heavy capitals inside box (x0, y0, x1, y1), as large as fits. `mark`: the word drawn in the accent."""
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    ws = [w for w in str(words).upper().split() if w][:5]
    if not ws:
        return
    bw, bh = box[2] - box[0], box[3] - box[1]
    # every way of breaking the words into 1 to 4 lines, in order; the one that lets the type be largest wins
    ways = [[" ".join(ws)]]
    for k in range(2, min(4, len(ws)) + 1):
        def cuts(rest, left):
            if left == 1:
                return [[" ".join(rest)]]
            return [[" ".join(rest[:i])] + t for i in range(1, len(rest) - left + 2) for t in cuts(rest[i:], left - 1)]
        ways += cuts(ws, k)
    f0 = font(100)
    def fits(lines):
        return min(bw / max(d.textlength(ln, font=f0) for ln in lines) * 100, bh / (0.98 * len(lines)))
    lines = max(ways, key=fits)
    size = int(max(40, min(330, fits(lines) * 0.97)))
    f = font(size)
    lh = int(size * 0.98)
    y = box[1] + (bh - lh * len(lines)) // 2
    mk = str(mark or "").upper()
    for ln in lines:
        wline = d.textlength(ln, font=f)
        x = box[0] if align == "left" else box[2] - wline
        for word in ln.split(" "):
            col = accent if mk and word.strip(".,!?") == mk.strip(".,!?") else (255, 255, 255)
            d.text((x + 5, y + 6), word, font=f, fill=(0, 0, 0))                      # a hard shadow keeps it readable on any frame
            d.text((x, y), word, font=f, fill=col, stroke_width=max(2, size // 60), stroke_fill=(0, 0, 0))
            x += d.textlength(word + " ", font=f)
        y += lh


def make(frame, words, out, layout="right", accent="#4D8DFF", mark=None):
    """One 1280x720 thumbnail from a frame (path or PIL image). Layouts: "right"/"left": the subject cut out on that side on
    a dark ground with a glow behind it, the words on the other; "frame": the whole frame, darkened under the words.
    Falls back to "frame" when there is no clear subject. Returns the layout used."""
    from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
    acc = hexrgb(accent)
    src = (Image.open(frame) if not hasattr(frame, "size") else frame).convert("RGB")
    cut = cutout(src) if layout in ("right", "left") else None
    box, fill = subject_box(cut) if cut is not None else (None, 0.0)
    if not box or not 0.04 <= fill <= 0.72:       # nothing stands out, or the "subject" is the whole picture
        layout = "frame"
    im = Image.new("RGB", (W, H), GROUND)
    if layout == "frame":
        s = max(W / src.width, H / src.height)
        bg = src.resize((int(src.width * s) + 1, int(src.height * s) + 1), Image.LANCZOS)
        bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
        bg = ImageEnhance.Contrast(ImageEnhance.Brightness(bg).enhance(0.86)).enhance(1.1)
        shade = Image.new("L", (W, H), 0)
        ImageDraw.Draw(shade).rectangle((0, 0, int(W * 0.62), H), fill=205)
        shade = shade.filter(ImageFilter.GaussianBlur(170))
        im = Image.composite(Image.new("RGB", (W, H), GROUND), bg, shade)
        draw_words(im, words, (56, 70, int(W * 0.6), H - 70), acc, mark)
    else:
        sub = cut.crop(box)
        s = min(H * 0.96 / sub.height, W * 0.47 / sub.width)
        sub = sub.resize((max(1, int(sub.width * s)), max(1, int(sub.height * s))), Image.LANCZOS)
        x = W - sub.width - 30 if layout == "right" else 30
        y = (H - sub.height) // 2 if sub.height < H * 0.8 else H - sub.height
        glow = Image.new("RGB", (W, H), GROUND)                                   # the accent as a soft light behind the subject
        gd = ImageDraw.Draw(glow)
        cx, cy, r = x + sub.width // 2, y + sub.height // 2, int(max(sub.width, sub.height) * 0.42)
        gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=tuple(int(c * 0.55) for c in acc))
        im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(120)), 0.85)
        rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))                              # a thin light edge, so it lifts off the ground
        edge = sub.split()[3].filter(ImageFilter.MaxFilter(9))
        rim.paste(Image.new("RGBA", sub.size, (255, 255, 255, 235)), (x, y), edge)
        im.paste(rim, (0, 0), rim)
        sub = Image.merge("RGBA", (*ImageEnhance.Contrast(sub.convert("RGB")).enhance(1.12).split(), sub.split()[3]))
        im.paste(sub, (x, y), sub)
        tb = (56, 60, x - 36, H - 60) if layout == "right" else (x + sub.width + 36, 60, W - 56, H - 60)
        draw_words(im, words, tb, acc, mark, "left" if layout == "right" else "right")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    im.save(out, quality=93)
    return layout


def demo():
    from PIL import Image, ImageDraw
    import tempfile
    im = Image.new("RGB", (640, 360), (40, 60, 90))
    ImageDraw.Draw(im).ellipse((220, 60, 420, 330), fill=(230, 200, 170))
    with tempfile.TemporaryDirectory() as t:
        got = make(im, "time stops now", Path(t) / "a.jpg", layout="frame", mark="STOPS")
        assert got == "frame" and Image.open(Path(t) / "a.jpg").size == (W, H)
    assert hexrgb("#4D8DFF") == (77, 141, 255)
    return 0
