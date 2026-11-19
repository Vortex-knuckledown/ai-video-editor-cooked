"""What a script is written FROM, gathered before a word of it exists.

subjects: who and what the video is about (a person, a company, a place, an event, a thing), and their real material:
what Wikipedia says in a paragraph, their photographs on Wikimedia Commons (free to reuse, credited), and the videos
they are actually in (interviews, speeches, official footage, news). The script's shots then point at this material,
so a video about a person shows that person, not a stock photo near the words.

models: the videos on this topic that people actually watched, measured: how they open, how fast they talk, how long
their sentences are, how often they ask a question or say "you". The script is written to those measures, and a draft
is measured the same way beside them.

The functions take longvideo's own search functions as arguments, so this file imports nothing of it.
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

UA = "cooked-studio/1.0 (video editor)"
KINDS = ("person", "company", "place", "event", "thing")
# what to look for on YouTube for each kind of subject: the subject themselves on camera, not someone talking about them
VIDEO_SEARCHES = {"person": ["{n} interview", "{n} speech", "{n} documentary footage"],
                  "company": ["{n} official", "{n} factory tour", "{n} keynote"],
                  "place": ["{n} 4k footage", "{n} aerial", "{n} walking tour"],
                  "event": ["{n} footage", "{n} news report", "{n} documentary"],
                  "thing": ["{n} close up", "{n} how it works", "{n} footage"]}
STOP = set("a an the of in on at by for to and or with from is are was were be been it its this that these those as but if so than then there here "
           "i he she we they them his her their our your my me us not no do does did have has had will would can could should may might just very".split())


def slug(text, n=32):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(text).lower())).strip("-")[:n].strip("-") or "subject"


def get_json(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:   # noqa: S310
        return json.loads(r.read().decode("utf-8"))


def wikipedia(name):
    """{"title", "about", "page"} from Wikipedia's own summary of the best-matching article, or {}."""
    try:
        hit = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "query", "list": "search", "srsearch": name, "srlimit": 1, "format": "json"}))["query"]["search"]
        if not hit:
            return {}
        s = get_json("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(hit[0]["title"].replace(" ", "_"), safe=""))
        return {"title": s.get("title") or hit[0]["title"], "about": str(s.get("extract") or "")[:700],
                "page": ((s.get("content_urls") or {}).get("desktop") or {}).get("page") or ""}
    except Exception:   # noqa: BLE001
        return {}


def gather(subjects, search_commons, search_youtube, photos=10, videos=8):
    """Each subject with its real material. subjects: [{"name", "kind"}]. Returns the same list, each with "slug",
    "about", "page", "photos" [{url, page, title, by, license, w, h}] and "videos" [{id, title, channel, duration}]."""
    out = []
    for s in subjects:
        name, kind = str(s.get("name") or "").strip(), str(s.get("kind") or "thing").lower()
        if not name:
            continue
        kind = kind if kind in KINDS else "thing"
        row = {"name": name, "kind": kind, "slug": slug(name), **wikipedia(name)}
        try:
            row["photos"] = search_commons(name, max(photos, 12))[:photos]
        except Exception as e:   # noqa: BLE001
            row["photos"], row["photos_error"] = [], type(e).__name__
        seen, vids = set(), []
        for q in VIDEO_SEARCHES[kind]:
            try:
                for c in search_youtube(q.format(n=name), 6, True):
                    words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) > 2]
                    title = f"{c.get('title', '')} {c.get('channel', '')}".lower()
                    if c["id"] in seen or not any(w in title for w in words):     # the subject is named in it: it is theirs, not a look-alike
                        continue
                    seen.add(c["id"])
                    vids.append({"id": c["id"], "title": c["title"][:90], "channel": c.get("channel", "")[:40], "duration": round(c["duration"]), "found_by": q.format(n=name)})
            except Exception:   # noqa: BLE001
                continue
        row["videos"] = vids[:videos]
        out.append(row)
    return out


def catalog_md(rows):
    """subjects.md: what there is of each subject, numbered, for the script to point at."""
    out = ["# The real material", "",
           "Shots about a subject use THIS material, by number. A photograph: `{\"kind\": \"photo\", \"subject\": \"<slug>\", \"pick\": N, \"query\": \"<what it shows>\"}`.",
           "A moment of a video: `{\"kind\": \"clip\", \"video\": \"<id>\", \"see\": \"<what is on screen at that moment>\", \"query\": \"<the same, short>\"}`.",
           "A line that names a subject shows that subject at least once. Stock footage and unrelated pictures are for lines that name no one.", ""]
    for r in rows:
        out += [f"## {r['name']} ({r['kind']}): `{r['slug']}`", ""]
        if r.get("about"):
            out += [r["about"], f"[Wikipedia]({r.get('page', '')})", ""]
        out += ["Photographs (Wikimedia Commons, free to reuse, credited in the kit):"] if r.get("photos") else ["No photographs found on Wikimedia Commons."]
        out += [f"- {i}: {p['title']} ({p['w']}x{p['h']}, {p.get('license') or 'see page'})" for i, p in enumerate(r.get("photos") or [])]
        out += ["", "Videos they are in (a few seconds each, credited; publishing them is the user's call):"] if r.get("videos") else ["", "No videos found that name them."]
        out += [f"- `{v['id']}`: {v['title']} ({v['channel']}, {v['duration'] // 60}:{v['duration'] % 60:02d})" for v in r.get("videos") or []]
        out.append("")
    return "\n".join(out)


def names_in(text, rows):
    """The subjects a spoken line names: by full name, or by the last word of a person's or company's name."""
    t, hit = " " + re.sub(r"[^a-z0-9 ]+", " ", str(text).lower()) + " ", []
    for r in rows:
        ws = [w for w in re.findall(r"[a-z0-9]+", r["name"].lower()) if w not in STOP]
        keys = {" ".join(ws)} | ({ws[-1]} if ws and r["kind"] in ("person", "company") and len(ws[-1]) > 3 else set())
        if any(f" {k} " in t for k in keys if k):
            hit.append(r["slug"])
    return hit


def subject_gaps(scenes, rows):
    """Lines that name a subject and never show them. [(scene id, slug)]."""
    vids = {v["id"]: r["slug"] for r in rows for v in r.get("videos") or []}
    have = {r["slug"]: bool(r.get("photos") or r.get("videos")) for r in rows}
    bad = []
    for s in scenes:
        if not isinstance(s, dict):
            continue
        shown = {sh.get("subject") for sh in s.get("shots") or [] if isinstance(sh, dict)} | {vids.get(sh.get("video")) for sh in s.get("shots") or [] if isinstance(sh, dict)}
        for sl in names_in(s.get("say"), rows):
            if have.get(sl) and sl not in shown:
                bad.append((s.get("id"), sl))
    return bad


# ---------------------------------------------------------------- how a script reads, measured
def sentences(text):
    return [x.strip() for x in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", str(text)).strip()) if len(x.strip()) > 1]


def measure(text, seconds=None):
    """How a script reads aloud. {"words", "wpm", "sentence" (mean words), "short" (share of sentences of 8 words or
    fewer), "long" (share over 22), "questions" (a 100 sentences), "you" (a 100 words), "numbers" (a 100 words),
    "open" (the first sentence's words), "hook" (the first 25 words)}."""
    ss = sentences(text)
    ws = re.findall(r"[A-Za-z0-9'%$.,-]+", str(text))
    n = max(1, len(ws))
    lens = [len(x.split()) for x in ss] or [0]
    return {"words": len(ws), "wpm": round(len(ws) / (seconds / 60.0)) if seconds else None,
            "sentence": round(sum(lens) / len(lens), 1), "short": round(sum(k <= 8 for k in lens) / len(lens), 2), "long": round(sum(k > 22 for k in lens) / len(lens), 2),
            "questions": round(100 * sum(x.endswith("?") for x in ss) / max(1, len(ss)), 1),
            "you": round(100 * sum(w.lower().strip(".,") in ("you", "your", "you're", "you'll", "you've") for w in ws) / n, 1),
            "numbers": round(100 * sum(bool(re.search(r"\d", w)) for w in ws) / n, 1),
            "open": lens[0], "hook": " ".join(ws[:25])}


def find_models(topic, search_youtube, subs_of, views_of, n=3):
    """The most-watched videos on a topic that have subtitles, each measured. [{"id", "title", "channel", "views",
    "minutes", "measure", "outline": [(mm:ss, the first words said there)]}]. The words themselves are not kept."""
    cands = []
    for q in dict.fromkeys([topic, topic + " explained", topic + " documentary"]):
        try:
            cands += [c for c in search_youtube(q, 8, True) if 90 <= c["duration"] <= 1500]
        except Exception:   # noqa: BLE001
            continue
    seen, rows = set(), []
    for c in cands:
        if c["id"] not in seen:
            seen.add(c["id"])
            rows.append({**c, "views": views_of(c["id"])})
    out = []
    for c in sorted(rows, key=lambda c: -(c["views"] or 0)):
        subs = subs_of(c["id"])
        if len(subs) < 20:
            continue
        text, last = [], ""
        for _, _, t in subs:            # automatic subtitles repeat each line as it scrolls: keep what is new
            t = re.sub(r"\[[^\]]*\]", " ", t).strip()
            if t and t != last and not last.endswith(t):
                text.append(t)
            last = t or last
        full = re.sub(r"\s+", " ", " ".join(text))
        full = full if re.search(r"[.!?]", full[:600]) else re.sub(r"(\S+(?:\s+\S+){12})\s", r"\1. ", full)   # no punctuation: every 13 words, to have sentences to count
        step = max(1, len(subs) // 7)
        out.append({"id": c["id"], "title": c["title"], "channel": c.get("channel", ""), "views": c["views"], "minutes": round(c["duration"] / 60, 1),
                    "measure": {**measure(full, c["duration"]), "hook": " ".join(full.split()[:25])},
                    "outline": [(f"{int(a) // 60}:{int(a) % 60:02d}", " ".join(t.split()[:9])) for a, _, t in subs[::step]][:8]})
        if len(out) >= n:
            break
    return out


def models_md(topic, rows, mine=None):
    """models.md: the measured videos, their average as the target, and the draft beside it when there is one."""
    if not rows:
        return f"# Models for: {topic}\n\nNo watched video with subtitles was found. Write to the defaults in story.md.\n"
    keys = ("wpm", "sentence", "short", "long", "questions", "you", "numbers", "open")
    label = {"wpm": "words a minute", "sentence": "words in a sentence", "short": "share of sentences of 8 words or fewer", "long": "share of sentences over 22 words",
             "questions": "questions in 100 sentences", "you": "\"you\" in 100 words", "numbers": "numbers in 100 words", "open": "words in the first sentence"}
    avg = {k: round(sum((r["measure"][k] or 0) for r in rows) / len(rows), 2) for k in keys}
    out = [f"# Models for: {topic}", "", "The most-watched videos on this topic, measured. Write the script to the TARGET column. Their words are theirs:",
           "take the shape (how it opens, when it turns, how it pays off), never a sentence.", ""]
    for r in rows:
        out += [f"## {r['title']} ({r['channel']}, {r['views'] or 0:,} views, {r['minutes']} min)", "",
                f"Opens: \"{r['measure']['hook']}...\"", "", "Where it is at each point:"] + [f"- {t}: {w}..." for t, w in r["outline"]] + [""]
    out += ["## The measures", "", "| | " + " | ".join(f"model {i + 1}" for i in range(len(rows))) + " | TARGET |" + (" this draft |" if mine else ""),
            "|---|" + "---|" * (len(rows) + 1 + bool(mine))]
    for k in keys:
        out.append(f"| {label[k]} | " + " | ".join(str(r["measure"][k]) for r in rows) + f" | **{avg[k]}** |" + (f" {mine[k]} |" if mine else ""))
    return "\n".join(out) + "\n"


def draft_gaps(mine, rows):
    """Where a draft reads unlike the videos people watched. Plain sentences to fix, most important first."""
    if not rows:
        return []
    avg = lambda k: sum((r["measure"][k] or 0) for r in rows) / len(rows)   # noqa: E731
    out = []
    if mine["open"] > max(14, avg("open") * 1.5):
        out.append(f"the first sentence is {mine['open']} words; theirs open in about {avg('open'):.0f}. Open on the one fact or question that makes someone stay")
    if mine["sentence"] > avg("sentence") * 1.25 + 1:
        out.append(f"sentences average {mine['sentence']} words; theirs {avg('sentence'):.1f}. Break the long ones where a speaker would breathe")
    if mine["short"] < avg("short") * 0.6:
        out.append(f"only {mine['short'] * 100:.0f}% of sentences are 8 words or fewer; theirs {avg('short') * 100:.0f}%. Short sentences are what land")
    if avg("questions") >= 3 and mine["questions"] < avg("questions") * 0.4:
        out.append(f"{mine['questions']} questions in 100 sentences; theirs {avg('questions'):.1f}. Ask what the viewer is about to ask, then answer it")
    if avg("you") >= 1 and mine["you"] < avg("you") * 0.4:
        out.append(f"\"you\" {mine['you']} times in 100 words; theirs {avg('you'):.1f}. Talk to one person")
    return out


def demo():
    m = measure("Why do planes fly so high? It is not for the view. You would not believe the real reason, and it saves 3 tonnes of fuel.", 10)
    assert m["open"] == 6 and m["questions"] > 30 and m["you"] > 0 and m["numbers"] > 0 and m["wpm"] == 156, m
    rows = [{"name": "Ada Lovelace", "kind": "person", "slug": "ada-lovelace", "photos": [{"title": "Portrait", "w": 2000, "h": 3000}], "videos": [{"id": "abc", "title": "t", "channel": "c", "duration": 300}]}]
    assert names_in("Then Lovelace wrote the first program.", rows) == ["ada-lovelace"] and names_in("A program was written.", rows) == []
    sc = [{"id": "a", "say": "Ada Lovelace saw it first.", "shots": [{"kind": "stock", "query": "old computer"}]},
          {"id": "b", "say": "Lovelace wrote it down.", "shots": [{"kind": "photo", "subject": "ada-lovelace", "pick": 0, "query": "portrait"}]},
          {"id": "c", "say": "Lovelace explained.", "shots": [{"kind": "clip", "video": "abc", "query": "x"}]}]
    assert subject_gaps(sc, rows) == [("a", "ada-lovelace")], subject_gaps(sc, rows)
    assert "ada-lovelace" in catalog_md(rows) and "`abc`" in catalog_md(rows)
    mod = [{"title": "T", "channel": "C", "views": 10, "minutes": 5, "measure": measure("Short one. Why? You know it. " * 20, 60), "outline": [("0:00", "Short one")]}]
    assert "TARGET" in models_md("x", mod, measure("A very long sentence that keeps going and going without any stop for at least thirty words so that the check has something real to complain about today.", 30))
    assert draft_gaps(measure("A very long opening sentence that keeps going and going without any stop for at least thirty words so that the check has something real to complain about today.", 30), mod)
    return 0


if __name__ == "__main__":
    raise SystemExit(demo())
