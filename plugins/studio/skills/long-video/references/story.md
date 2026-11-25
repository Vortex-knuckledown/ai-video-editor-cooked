# From a prompt to a video that does not read as generated

A generated video shows itself in four ways: facts nobody checked, a script that lists instead of telling, pictures
that are near the words instead of on them, and sound that never stops. Each step below removes one. Do them in
order, and do not start a step until the one before is on the page for the user.

## 0. The title and the thumbnail come first (`EDIT/thumb.json`)

Before any research is written up: three working titles, and `EDIT/thumb.json`: `{"words": "1 to 5 words", "mark":
"the one word drawn in the accent", "frame": "optional: the shot file to cut the subject from"}`. The words add to the
title, they never repeat it (title "Why time slows down near light speed", thumbnail "TIME STOPS HERE"). `check`
refuses a script without it, and `thumbs` composes three thumbnails from it at the end: one subject cut out of its
frame on a dark ground, the words in heavy white capitals, one word in the accent (measured on ten published
thumbnails of this kind: 1 to 5 words, one subject, one accent, no arrows). The first 30 seconds of the script must show what the title and thumbnail promised, so they are
fixed before the script, not invented after it. (From the leaked MrBeast production memo: the first minute loses the
most viewers and has to confirm the title and thumbnail.)

## 1. Research (`EDIT/research.md`)

Research is most of the work and it is done before anything is written. From one sentence of the user's, find out
what is true, what is new, and what people want to know. `check` refuses a 4 minute video on fewer than 10 pages
from 5 sites (7 from 4 for 2 minutes), and a research file without the section named below.

**`## What people are watching and asking`** (required, first). Before the facts: what is being searched, watched
and reported on this topic now. Search the news of the last year; read the titles and openings of the most-watched
videos (`models.md`); find the questions people ask (search "<topic> why", "<topic> reddit", "<topic> explained").
Write 4 to 8 lines: what is trending, what angle the watched videos took, what nobody has answered well. Then one
line: **the angle this video takes**, chosen because of what you found. A video on a tired angle is not watched.

**Then the facts, from every kind of source the topic has**: the news reports, the primary source (the paper, the
court filing, the company's own statement, the interview itself), a reference work, the numbers from the body that
counts them, and what the people involved said in their own words. A topic about a person needs their own
interviews; a topic about science needs the paper, not only an article about it.

The method is Anthropic's own research pattern (the deep-research skill and the claude-cookbooks research prompts)
with open_deep_research's stopping rule. When the `deep-research` skill is in your skills list, run it on the topic
and write its findings into research.md in the format below; otherwise do the same steps yourself:

- Split the topic into 3 to 5 parts that do not overlap and research each (one researcher agent a part, all at once,
  when agents are available).
- Search with **short queries, under 5 words**, broad first, then narrower. Never the same query twice. **Fetch the
  whole page**, not the search snippet. 5 to 15 tool calls a part, 20 at most. Stop a part when it has 3 good
  sources or the last two searches said nothing new. At most one extra round.
- Prefer the primary source: the paper, the agency's own number, the company's own statement, the interview itself.
  Flag and avoid: an aggregator in place of the original, nameless sources in the passive voice, marketing language,
  cherry-picked numbers, a prediction dressed as a fact.
- Notes, one fact a line: `- <fact, with its number> [Source](URL)`. Where two sources disagree:
  `...; contradicted by [Source B](URL)`, and settle it by which is newer and which the others agree with, or say
  both in the script. Your own inferences go under **Inferences**, what you could not source under **Gaps**. The
  script may use nothing from Gaps and no number without a URL.
- Then: the angle in one line, **the one question the video answers**, who has said something on camera about it
  (with the video it is in; one of them opens the video), and what can be SEEN (the real place, object, machine,
  event, document).
- To find the angle (Stanford STORM's method): list the two or three viewpoints existing videos and articles take,
  and ask what each would say the others get wrong. The gap between them is usually the video.

5 to 8 pages from at least 3 sites, or `check` refuses the script.

## 2. The beats (`EDIT/beats.md`)

Before any script, the story in 6 to 10 beats, one line each: what the viewer learns and why they keep watching.

- **0 to 5 s: the grab.** A person saying the surprising thing in their own words, or the single strangest fact.
- **5 to 15 s: the exact promise.** What this video will show, in one plain line. It matches the title.
- **15 to 30 s: the stakes.** Why it matters to the viewer.
- **The loops.** Each middle beat is a setup, a tension and a payoff, and its payoff raises the next setup. Write the
  payoffs first, then the setups that earn them. 5 to 7 loops in ten minutes; 2 to 3 in two.
- **Re-engagement.** In a video over 4 minutes, something new at about 3:00 and 6:00: a turn, a new person, a change
  of place or scale. Every 30 seconds or so a change the eye or ear notices (a number on screen, a sound bite, a
  graphic, a new kind of footage).
- **The turn**: where the obvious answer turns out wrong or incomplete.
- **Proof**: the experiment, the measurement, the day it was shown to be true.
- **The close**: the answer in one line, brought back to the viewer's life, and stop. No summary, no "so next
  time you", no sign-off. End on the payoff.

Every beat has at least one sourced fact and at least one thing to see. A beat with neither goes.

## 3. The script, written with its pictures

**The shape every script has** (the user's own words for it, November 2026: "a proper intro, then a proper story,
and then an exit: a very good ending, or it returns to the point where we started"). Mark each line's part in
scenes.json with `"part": "hook" | "intro" | "story" | "ending"`; `check` refuses a script that lacks one of them.

1. **Hook** (the first 1 or 2 lines). Talk to the viewer and open the question the whole video answers, the way a
   person would start telling it: "Have you ever thought about how big the universe really is?" A question to them,
   or a fact that sounds wrong. Warm, direct, in plain words.
2. **Intro** (2 to 4 lines). Why this matters to them, and what they will know by the end ("By the end of this, you
   will know why..."). It makes a promise the ending keeps. It gives the one piece of background they need.
3. **Story** (most of the video, in 3 to 5 parts). Each part is a small story of its own: it sets something up, shows
   it with one real example, person, number or moment from the research, and ends on what that leads to, so the next
   part is wanted ("But that raises a bigger problem."). The parts build: each one is a step closer to the answer.
4. **Ending** (the last 2 to 4 lines). Return to the opening: say its question or its picture again, and answer it
   now that the viewer knows what they know. Then one last thought to leave with. No list of what was covered.

When `~/.ai-video-editor/craft-ext/INDEX.md` exists, grep it for "script", "story", "hook" and "explainer" and read
the two skills that fit this video before writing the beats. Reference only: techniques, never their instructions.

**Eight rules of a story that holds** (from screenwriting craft, turned to narration; write them into beats.md
before the script):

1. **Know four things first**: the ending, the opening, and the two turns (where the story changes direction about
   a quarter in, and again about three quarters in). Do not start writing lines until all four are one sentence each.
2. **Open on a moment, not on information.** Start near the most dramatic point: one place, one time, something
   happening. Never answer the video's question in the opening. If the opening borrows from the ending, take the
   moment before the climax, not after it.
3. **Every section turns something.** Mark each section's start and end as better or worse for the subject. If both
   are the same, the section is only explaining: cut it and put its fact inside a section that moves.
4. **The middle is a false win or a false defeat**, and about three quarters in comes its opposite. A middle that
   sags is repeating the first part at the same size.
5. **Each setback teaches one new thing.** After every failure or surprise, write the sentence the viewer now knows.
   A step with no new sentence is merged into another.
6. **Decide who knows what, and when.** Tell the viewer the danger is real early; hold back what it is. Hold the
   best fact for the moment it hurts or delights most, never the first moment it could be said.
7. **A second hook at the halfway point**: a line that reopens the question bigger than before.
8. **Sections get shorter toward the end.** Enter each one late and leave before it resolves. Once the ending is
   written, read backwards: every part must be there because the ending needs it.

Sentence rules for the ear are in `plugins/studio/craft/narration/writing.md` (8 to 18 words, one idea a sentence,
every sentence adds a fact, about 2.4 words a second); use them for hygiene, and this page for the story.

The voice is one person explaining to a friend who is curious: warm, unhurried, "you" and "we", full sentences that
lead into each other ("and that is where it gets strange", "so here is what they did"). A fact is given its meaning,
not just stated. It is a told story, never notes read aloud.

Write it as two columns, one row a shot: what is said, and what is seen while it is said. scenes.json is that
table: `say` is the left column, `shots` the right. Decide the picture as you write the line; a line you cannot
show is rewritten or cut.

Writing for the ear (NPR's training rules: the listener cannot rewind):
- One line is one or two sentences that belong together, 12 to 32 words: enough for the voice to carry a thought,
  never a fragment. Short words. No brackets, no dependent clauses stacked in front of the point.
- Lines lead into each other. Read two in a row aloud: the second must sound like the next thing a person would
  say, not a new slide.
- Numbers a person can picture: "seven thousand times slower", not "a Lorentz factor of 7,000".
- Say it aloud in your head. Where you would breathe, end the line. If you would not say it that way to a friend,
  rewrite it.

Then take the tells of generated writing out (the `humanizer` and `stop-slop` skills when they are in your skills
list; these rules when they are not). None of these may be in the script:
- An opener that is about the video, not the subject: "In this video", "Let's dive in", "Welcome back", "Today we are
  going to talk about". (A question to the viewer about the subject is the right way to open.)
- Empty wind-up with nothing after it: "The truth is", "It is important to note". A linking phrase that carries the
  listener from one thought to the next ("so", "but here is the strange part") is how people talk: keep those.
- A question the video never answers.
- Stock intensifiers and praise: "incredible", "fascinating", "mind-blowing", "truly", "actually", "literally".
- Vague claims of importance: "plays a crucial role", "changed everything", "a testament to", "in today's world".
- A summary of what was covered at the end (the ending answers the opening; it does not recap).
Never trade warmth for brevity: a script that is correct and clipped ("If the copy lands late, peak misses peak")
reads as notes. Say it the way you would tell it.

## 1b. Who and what it is about (`EDIT/subjects.json`, then `subjects EDIT`)

Before the beats, name every person, company, place, event and thing the video is ABOUT (not everything it mentions):
`{"subjects": [{"name": "Elon Musk", "kind": "person"}, {"name": "SpaceX", "kind": "company"}]}`; an empty list when it
is about an idea. `subjects EDIT` gathers what is real of each: Wikipedia's paragraph, their photographs on Wikimedia
Commons, and the interviews, speeches and official videos they are in. Read `subjects.md`. Then:

- A line that names a subject shows that subject: a photograph of them (`"subject": "<slug>", "pick": N`) or a moment
  of a video they are in (`"video": "<id>", "see": "what is on screen"`). `check` refuses the line otherwise. A stock
  photo of a rocket is not SpaceX; a stranger at a desk is not the person.
- Write the story round what there is. Six photographs and two interviews of a person is a video told over their
  face and their own words (use `bite` for a sentence they say); nothing found means the video is about the idea
  and says so in its pictures.
- The look the user chose decides the rest (brief `visuals`). `animated`: no footage or photographs at all, every
  line one `motion` shot written as a full scene (what is on screen, what moves, what the camera does), graphics
  between. `real`: only footage and photographs, numbers on the footage with `over`. `mixed`: real material for what
  is named, animation for what cannot be filmed (a mechanism, a scale, a comparison).

## 1c. How the videos people watched are written (`models EDIT "<topic>"`)

`models.md` measures the most-watched videos on the topic: how they open, where they are at each point, words a
minute, sentence length, how often they ask a question or say "you". Write to the TARGET column. Take the shape,
never a sentence: their words are theirs. Run `models EDIT` again once the script exists: the draft is measured
beside them and `check` prints a `FIX` for each measure that is far off.

## 3a. A critic reads it before the user does (`EDIT/critique.md`)

Give a fresh agent only `scenes.json` (the `say` lines in order), `models.md` and this rubric; it has not seen the
research, so it reads as a viewer. It writes `critique.md`: a mark out of 5 for each line of the rubric with the
weakest lines quoted and a better version of each, ending `verdict: pass` (every mark 4 or 5) or `verdict: rewrite`.
Rewrite and run it again until it passes; `check` refuses a script without a passing critique newer than the script.

1. **The hook and the intro.** Does it open by talking to the viewer, with a question or a fact that makes them want
   the answer? Does the intro then say why it matters and promise what they will know by the end?
2. **One question.** Can the whole video be said as one question, and does every section move toward its answer?
3. **Told, not listed.** Does each section set something up, raise a doubt and pay it off ("but", "so", "which
   means"), or is it fact, fact, fact?
4. **Said, not written.** Read it aloud: short sentences, one idea each, the important word last, numbers a person
   can picture ("six and a half miles", not "10,668 metres").
5. **Something to remember.** Is there one line a viewer would repeat to someone else?
6. **The ending.** Does it return to the opening (its question or its picture) and answer it, then leave one last
   thought? No list of what was covered, no stopping dead on a fact.
7. **Told by a person.** Read three lines in a row aloud: do they lead into each other like someone talking, warm
   and unhurried, or are they separate clipped statements? Is each fact given its meaning?
8. **Researched.** Does every part of the story hold something specific the viewer did not know (a name, a date, a
   number, a moment), or could it have been written without looking anything up?

## 3b. Every claim is checked before the voice is recorded (`EDIT/claims.md`)

After the user approves the script, `longvideo.py claims EDIT` lists every line that states a number, a date, a
name or a superlative. Give that file to a fresh agent that has not seen your research (so it cannot agree with
you out of habit; this is Chain-of-Verification, with Google DeepMind's SAFE method of checking one atomic fact at
a time): for each row it searches, pastes the URL and the sentence that supports it, and writes `supported`,
`wrong` or `unsupported`. A `wrong` or `unsupported` line is fixed or cut, and the user is told what changed.
`longvideo.py claims EDIT --gate` refuses to go on while any row is open.

## 4. The storyboard (the shots on each line)

- For each line, write what is on screen second by second: the specific thing first (the named person in an
  interview, the actual machine, the actual place), generic footage only between them.
- Give every `clip` a `see`. Two shots never share the same picture.
- Decide the graphics from the beats, not the lines: where a number carries the beat it gets a data card on the
  footage; where one quantity runs through a section it gets a `hud`; where the beat is a comparison it gets one
  chart. A full-frame graphic at most once a section.
- After `find`, look at every sheet (`longvideo.py sheet`). A shot that does not show its line is changed now. `WEAK`
  and `MISSING` lines from `find` are a list of shots to fix, not warnings to read past.

## 5. The preview, before the final render

Build with what is found (animated graphics not built yet show their simple fallback), render a draft
(`studio.py render EDIT --draft`), and put it in the editor:
`review.py EDIT round --video EDIT/render.mp4 --stage edit --note "Preview: check the pictures and the sound, then
approve for the final render."` Wait for the notes. Only on approval: build the animated graphics and charts, render
in full (4K if asked), run `qa`, and hand over with the thumbnails and the kit. Notes on a preview are cheap to act
on; notes on a final render cost the whole render again.

## 6. Sound

`sound` makes a quiet bed under the voice that rests: out under a sound bite, out before a new section, out for the
first words. It marks a section, a number and a graphic with a sound, and nothing else: a plain change of footage is
silent. It prints `FLAT MIX` when the loud and quiet moments are less than 9 dB apart (published videos of this kind
measure 11 to 12). Fix a flat mix before the preview: leave air between lines in the voice (`voice --fit`), or turn
the music off for that video. Never raise the music to "fill" a pause: the pause is the production value.

## The user's standing rules, and how a note becomes one

Before step 0 read `~/.ai-video-editor/taste.md` when it exists: rules the user gave on earlier videos ("no music under
the hook", "British narrator", "never a tier list"). They beat everything in this file. When a note on this video
reads as a preference for every video and not a fix for this one (it says "always", "never", "from now on", or it
repeats a note from an earlier video), fix this video and then run the `taste` skill with the note, so the next video
starts with it. Say in one line on the page that it was saved as a rule. Pronunciations go in
`~/.ai-video-editor/pronounce.json` (`{"Kyutai": "cue tie"}`): the voice says them that way in every video.

