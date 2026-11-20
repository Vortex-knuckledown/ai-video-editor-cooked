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

## Graphics on the footage (`over`), and a readout that stays

Measured on published videos of this kind (two documentaries and a Short, November 2026): nearly every shot is real
footage, and the graphics sit ON it as small glass cards and thin white lines. A full-frame graphic is rare: a
chapter title, a ranked list, a chart. One shot in three carries something. So prefer `over` to a graphic shot:

- `"over": {"stat": "406,000", "unit": "km", "kicker": "from Earth", "note": "252,000 mi"}`: a glass data card at the
  right (`"at": "left"` for the left). The number is white and heavy; `kicker` and `note` are small spaced capitals.
- `"over": {"ring": {"x": 44, "y": 44, "r": 30, "text": "27 km", "sub": "16.8 mi"}}`: a thin circle drawn round the
  thing on screen, with its measure beside it. `x`, `y` are where its centre is in the frame, in percent; `r` its
  radius in percent of the frame's short side. Look at the shot (`sheet`) before placing it.
- `"over": {"clip": {"title": "the headline as printed", "highlight": "its few words that matter", "source": "ABC
  News, 14 Oct 2026"}}`: a cutting from the article being quoted, floating at the right. Real headlines only.
- `"over": {"name": "Brian Cox", "role": "Physicist, The Joe Rogan Experience #2217"}` on a sound bite, as before, and
  `"over": {"label": "56 years later"}` for two to four words that punch a line.
- A scene's `"hud": [["EARTH", "00:00:01.3"], ["SHIP", "00:00:00"]]` (1 to 3 rows) is a readout in the top left for
  that line. Give it to every line of a section with the values at that moment and it stays put while the footage
  changes under it: two clocks, a distance, a count. Use it when one quantity runs through a section.

The shape of a video that holds attention, from the same measurements: open on a sound bite of the person or the
moment the video is about (10 to 20 seconds, their name on screen), then the narrator. A new picture every 2 to 3.5
seconds. Words on screen are the caption line at the bottom, small, with the said word lit; everything else is a
number or a name, never a sentence. No yellow headline cards one after another.

## Five more graphics, and two additions

- **`word`**: one to three words filling the frame, one after another on the beat, the last in the accent.
  `{"kind": "word", "text": "time is elastic", "sub": "optional small line"}`. For the idea a section turns on. At
  most three a video: it is the loudest thing there is.
- **`versus`**: exactly two numbers side by side, each on its own rising bar, the larger in the accent.
  `{"kind": "versus", "title": "A day, measured twice", "items": [["Earth", 24], ["Orbit", 38]], "unit": " h",
  "source": "NASA"}`. Use it instead of `bars` when the point is the gap between two things.
- **`timeline`**: 2 to 5 dates on a line that draws left to right. `{"kind": "timeline", "title": "A century of
  tests", "events": [["1905", "Special relativity"], ["1971", "Clocks on jets"]]}`. Each "what" is 2 to 4 words.
- **`place`**: where and when, lower left, the way a documentary opens a chapter. `{"kind": "place", "text": "Bern,
  1905", "sub": "Swiss patent office"}`. It sits on the nearest shot's footage, darkened.
- **`line`**: a line chart drawn point by point, 3 to 12 points, the last value named in the accent. `{"kind":
  "line", "title": "Time stretch by speed", "points": [["0", 1.0], ["0.5c", 1.15], ["0.99c", 7.09]], "unit": "x",
  "source": "Lorentz factor"}`. Only real numbers from a source; only the first and last points are labelled.
- **`paper` with `finding`**: add `"finding": "the result in plain words"` and the paper moves left while a glass
  KEY FINDING card arrives beside it, after the line is marked.
- **`over: {"stamp": "CONFIRMED"}`**: a verdict stamped on footage or a picture, a little turned, in the accent.
  One or two words. For the moment a question in the video is settled, not for decoration.
- **`map`**: where on Earth. `{"kind": "map", "title": "The polar route", "points": [["London", 51.5, -0.12],
  ["Tokyo", 35.68, 139.69]]}`: 1 to 5 places as `["name", latitude, longitude]` (decimal degrees, south and west
  negative, from a source). The world is a dark plate; the camera comes in close for one city and stays wide for two
  continents; each place is pinned in turn.
- **`layers`**: what a thing is made of, as plates that come apart. `{"kind": "layers", "title": "The atmosphere",
  "items": [["Stratosphere", "calm, thin, very cold"], ["Tropopause", "the lid"], ["Troposphere", "all the
  weather"]], "mark": 2}`: 2 to 5 items, top first, each a name or `["name", "note"]`; `mark` is the one in the accent.
- **`over: {"count": {"from": 0, "to": 35000, "unit": "ft", "label": "altitude"}}`**: a number running on the
  footage, lower left: a height climbing, a price, a year. `seconds` sets how long it runs (default 1.6).

## The motion kit: how graphics are drawn

`graphics EDIT` renders every `title`, `word`, `place`, `stat`, `bars`, `versus`, `list`, `tier`, `paper`, `source`,
`layers`, `timeline` and `quote` shot as a clip with real depth: glass panels tilted in space, glossy bars standing
on their reflections, a paper lying in perspective with its one line lit, layers pulled apart, the video's own
footage blurred behind, a slow camera push. Run it before `build`; a graphic that does not render is drawn flat.
Three fields make them read as designed:

- **`kicker`** on any of them: three or four words in small spaced capitals above the title ("Share of weekly sets"
  over "Back gets a third"). Write the title as a finding, not a label.
- **`finding_value`** on a `paper`: the one number of the result ("25"), drawn large on the KEY FINDING card beside
  `finding` ("FFMI was the ceiling for drug-free lifters"); `finding_kicker` for the card's small line ("Key finding
  · 157 athletes").
- **`note`** on a `stat`: one quiet line under the number.

The colours are the video's `look` (ground, ink, accent) from scenes.json, set by the director.

