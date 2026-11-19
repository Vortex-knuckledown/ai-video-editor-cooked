# More graphics, AI images and 4K

## Three more graphics (shot kinds)

- **`tier`**: a ranked tier list. `{"kind": "tier", "title": "Back exercises, ranked", "tiers": [["S", ["Pull-ups",
  "Barbell row"]], ["A", ["Chin-ups", "T-bar row"]], ["B", ["Lat pulldown"]]]}`. 2 to 6 rows, 1 to 5 short names a
  row. The letters S A B C D E F have their own colours. Use it when the line ranks things; the names arrive one at
  a time, so order them the way the voice says them.
- **`paper`**: a study or article that lifts off the page. `{"kind": "paper", "journal": "Clinical Journal of Sport
  Medicine, 1995", "title": "...", "by": "the authors", "abstract": "its own first sentences, up to 420 characters",
  "highlight": "the one sentence that matters, in the paper's own words"}`. Only for a real source you read; never
  invent a title or a sentence. Without an abstract it is the shorter `source` look.
- **`chart3d`**: a real 3D bar chart with a moving camera. `{"kind": "chart3d", "title": "Share of weekly sets",
  "unit": "%", "source": "where the numbers are from", "items": [["Back", 31], ["Shoulders", 15]]}`. 2 to 7 items.
  It is rendered by `longvideo.py charts EDIT` (about 2 minutes a chart, no agent), after the voice is made and
  before `build`. A chart that does not render is shown as flat `bars` with the same numbers, so nothing is lost.
  Keep it for the comparison that carries a section: 3 at most in a video.

## A picture that does not exist: `make`

A `photo` shot may carry `"make": "what the picture shows"`. When no real picture is found for its `query` and the
user has connected OpenAI (Settings, Connections) and AI is on for this video, the picture is made there: about 4
to 20 US cents each on their own account, 8 at most a video. Say how many `make` shots there are and that each is
paid for before `find`. Never use `make` for a real person, a real event or evidence: a made picture is an
illustration, and the publishing kit lists it as AI-generated.

## 4K

`"quality": "4k"` in the brief (the page's Quality choice): `find` keeps footage at up to 2160 lines, and `render`
draws every frame at twice the size (3840 by 2160 for a wide video). Text and graphics are sharp at that size;
footage is as sharp as what was found, and most of YouTube is 1080p. It takes about four times as long to render
and needs the disk space. `studio.py render EDIT --4k` does the same for one render of any video.
