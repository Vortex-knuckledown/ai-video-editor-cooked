# cooked. studio: what this fork adds, and what comes next

This fork (github.com/Vortex-knuckledown/ai-video-editor-cooked) keeps the original editor by NextWork as it is and
adds new kinds of video in a plugin of its own, `plugins/studio`. Nothing is pushed to the original repository.

## How it fits together

| Part | Whose | What it does |
|---|---|---|
| `plugins/ai-editor` | the original | Edits your own footage: the cut, the styled edit, the editor window, b-roll reels, product videos, talking-head clips |
| `plugins/creator-teardown` | the original | Measures a creator's style from their videos |
| `plugins/studio` | this fork | New videos that do not start from your own footage: Create from a prompt, Clip a stream |

The studio calls the editor's code (its renderer, transcriber, music, face finder, downloader) and never changes it.
The few lines added inside the original are marked `studio:` or `fork:` in the code, so a merge from the original
shows at a glance which lines are ours:

- `home.py` and `home.html`: the two New video buttons, their side panels and their jobs (`animated`, `streamclips`).
- `start/references/home.md`: which skill takes each new job.
- `launcher.py` and `review.py`: Claude runs hidden in the background (no Terminal windows); Show Claude reveals it.
- `toolhook.py` (branch `fix/idle-banner-while-listening`): no "Claude needs you in the Terminal" banner while a
  Claude is only listening for the next video.
- `links.py`: a download that times out on a network with broken IPv6 runs once more on IPv4.

## New video: the three ways in

1. **Your clips** (the original): pick or drop your footage, pick a style, Make my video.
2. **Create from a prompt** (studio 0.1): type what the video is about, optionally paste videos whose look you like.
   Pick the shape, the length and any of an AI voiceover, on-screen text and music. Claude writes a script in scenes
   and shows it to you as a card. On your OK it animates every scene and opens the video in the editor.
3. **Clip a stream** (studio 0.2): paste up to 5 stream or gameplay links (YouTube, Twitch, Kick) or files. Pick how
   many clips, how long, the layout and whether to add captions and a hook title. Claude scores every second by
   YouTube's "most replayed" data and how loud the moment gets. It downloads only the best parts and shows them
   numbered in the editor. You pick which ones become clips. Each clip opens as a tab in the editor, with the facecam on
   top and the game below (or the crop following the face, or the whole frame), captions and the title.

## Released

| Version | What |
|---|---|
| studio 0.1.0 | Create from a prompt; Claude hidden in the background |
| studio 0.3.0 | Clip a stream reads a YouTube stream replay's live chat (released 2026-11-18, tag `studio-v0.3.0`) |
| studio 0.2.0 | Clip a stream; the IPv4 retry for downloads; notes on a finished video work with Claude hidden (released 2026-11-18, tag `studio-v0.2.0`) |

## Next, in order

1. **Clip a stream, better moments.** Done for YouTube stream replays in 0.3: the live chat's surges are a third
   signal. Left: Twitch chat (Twitch's chat API needs a signed-in client now), and
   more than one video's most replayed weighed fairly against another's.
2. **Clips in your style.** Run each clip through the original style-edit (your profile's captions, zooms and
   cards) as an option on the Clip a stream panel.
3. **"Make one like this" from a link.** Paste a video you like; the analysis that already measures a creator's
   look (creator-teardown quick mode) sets the script's pace and look for Create from a prompt, without a prompt box
   first. Today the prompt panel's reference links already do the measuring.
4. **Export all.** One button that saves every approved clip of a stream to a folder, named by title.
5. **Report the music bug upstream.** `product-video/scripts/sound.py score` fails when given a voice (a shape
   mismatch). The studio mixes its own music round it; the fix belongs in the original.

## Keeping up with the original

```bash
git fetch upstream
git checkout main && git merge upstream/main
git checkout feature/studio-animated-video && git merge main
```

Conflicts can only be in the `studio:` and `fork:` lines listed above. Keep both sides. Then run the checks:

```bash
python3 tests/check_plugins.py
python3 plugins/ai-editor/lib/ai_editor/run.py plugins/studio/skills/stream-clips/scripts/streamclips.py demo
python3 plugins/ai-editor/lib/ai_editor/run.py plugins/studio/skills/animated-video/scripts/studio.py demo
python3 plugins/ai-editor/lib/ai_editor/home.py demo
```

`upstream`'s push address is set to `DISABLED-do-not-push-to-original`, so a push can only reach this fork.
