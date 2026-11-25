# How to write the narration

Unless the user asks for another style, write the way a person explains
something to a friend at a table.

- Use regular, down-to-earth English and everyday words. Explain things in
  simple terms. If you need a technical word, say what it means the first
  time.
- Keep sentences short, about 8 to 18 words, one idea each.
- Say who does what: "The browser asks a resolver."
- Every sentence adds a fact. Cut half sentences that repeat something.
- Do not use em dashes or dashes between phrases. Use a comma or a new
  sentence.
- Leave out slogans and punchlines ("Just code."), "not X, but Y" twists,
  colon reveals, chains of three short sentences, metaphors, and filler words
  like "just", "simply", "really", "actually" and "exactly".
- Do not tell the viewer to do obvious things ("Let's dive in", "Stay tuned").
- End with a plain sentence that sums up the main point.

## Length and pace

- Aim for 45 to 120 seconds unless the user says otherwise. At the default
  speed the voice says about 13 letters a second, which is 165 to 200 words a
  minute in English, depending on how long the words are. A number takes
  longer than its digits suggest, because "1972" is said as "nineteen
  seventy-two". Some voices are slower, like `am_michael`, or faster, like
  `af_jessica`. In Japanese the voice says about 300 characters a minute, and
  in Chinese about 230.
- On top of the speech, each scene adds its lead and its hold, 0.35 and 0.7
  seconds by default, so 1.05 seconds. Each new sentence in a scene adds a
  pause of 0.3 seconds, and a new paragraph adds 0.55. The end of the video
  adds 1.4 seconds. So 105 words in 6 scenes make about 45 seconds, and a
  finished video has about 130 to 155 words a minute.
- Before the narration exists, `voice` and `check` print an estimate, like
  "about 45 s (43 to 47 s): 105 words of speech at about 180 a minute take
  35.0 s. The 6 scenes add 1.05 s each for their lead and hold, and the pauses
  between sentences add 2.1 s. The end of the video adds 1.4 s." The figures
  come from the settings of your video. The voice nearly always lands in the
  range, so aim the middle a little under a target. `explainroo voice videos/<name> --estimate`
  prints only the estimate, with what it means for `targetSeconds`, and makes
  nothing. When it is too long, cut words before you make the voice.
- For an exact length, set `"targetSeconds": 40` in `video.json`. It counts
  for every size, also a quicker one, unless the block of a size under
  `"sizes"` sets its own, or `null` for none. When the video comes out
  shorter, the missing time goes evenly into the holds of its scenes, so it
  ends at 40 seconds. When that adds more than 3 seconds to each scene, or
  when the video runs more than half a second longer, `voice` and `check` say
  so and name the longest scenes. Without `targetSeconds`, a video is as long as its narration.
- Start with the question or problem. Explain it in small steps. Give one
  concrete example, then sum up.
- One idea per scene, usually 1 to 3 sentences (4 to 15 seconds).
- Lists read aloud ("A, B, C and D") only work when each item appears on
  screen.

## Other languages

The rules above count in every language, but the filler words they name are
English. Leave out the same kind of word in the language of the video. The
