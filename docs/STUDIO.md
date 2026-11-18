# cooked. studio: what this fork adds, and what comes next

This fork (github.com/Vortex-knuckledown/ai-video-editor-cooked) keeps the original editor by NextWork as it is and
adds new kinds of video in a plugin of its own, `plugins/studio`. Nothing is pushed to the original repository.

## How it fits together

| Part | Whose | What it does |
|---|---|---|
| `plugins/ai-editor` | the original | Edits your own footage: the cut, the styled edit, the editor window, b-roll reels, product videos, talking-head clips |
| `plugins/creator-teardown` | the original | Measures a creator's style from their videos |
| `plugins/studio` | this fork | New videos that do not start from your own footage: Create from a prompt, Long video, Make one like this, Clip a stream |

The studio calls the editor's code (its renderer, transcriber, music, face finder, downloader) and never changes it.
The few lines added inside the original are marked `studio:` or `fork:` in the code, so a merge from the original
shows at a glance which lines are ours:

- `home.py` and `home.html`: the cards for the kinds of video on New video, their side panels and their jobs
  (`animated`, `streamclips`, `subtitles`, `longvideo`, `ugc`); Export all on a stream video's card (`/studio/export`); the subtitles
  dialog in a video's menu.
- `start/references/home.md`: which skill takes each new job.
- `launcher.py` and `review.py`: Claude runs hidden in the background (no Terminal windows); Show Claude reveals it.
- `toolhook.py` (branch `fix/idle-banner-while-listening`): no "Claude needs you in the Terminal" banner while a
  Claude is only listening for the next video.
- `links.py`: a download that times out on a network with broken IPv6 runs once more on IPv4.
- `askhook.py`: a hidden Claude's question waits for the next page that opens instead of its unseen Terminal.
- `keys.py`: three more key names (`pexels`, `runway`, `higgsfield`) and their free checks, for the studio's connections.
- `home.py` and `home.html` also carry the voice picker (`/studio/voices`, `/studio/voice/preview`) and the
  Connections card in Settings.

## New video: the five ways in

New video opens on five cards, one for each, with a small drawing; picking one shows its options on the right.
The sixth, **UGC ad** (studio 0.11): a person talking to the camera about a product, as
the pack to film from or, with the clips, several versions with different hooks. The fifth, **Long video** (studio 0.7): a 2 to 10 minute video from one prompt.
Claude researches it with sources and shows you the script. On your OK it records an AI voice and gives every line a
new shot every few seconds: seconds of footage found on YouTube, free pictures, your own clips, and graphics built
from the script's numbers. It ends in the editor with three thumbnails and a publishing kit.

1. **Your clips** (the original): pick or drop your footage, pick a style, Make my video.
2. **Create from a prompt** (studio 0.1): type what the video is about, optionally paste videos whose look you like.
   Pick the shape, the length and any of an AI voiceover, on-screen text and music. Claude writes a script in scenes
   and shows it to you as a card. On your OK it animates every scene and opens the video in the editor.
3. **Make one like this** (studio 0.5): paste a video you like. Claude measures its length, pace, structure and
   look, asks what yours should be about (or suggests topics), and animates a new one built the same way.
4. **Clip a stream** (studio 0.2): paste up to 5 stream or gameplay links (YouTube, Twitch, Kick) or files. Pick how
   many clips, how long, the layout and whether to add captions and a hook title. Claude scores every second by
   YouTube's "most replayed" data and how loud the moment gets. It downloads only the best parts and shows them
   numbered in the editor. You pick which ones become clips. Each clip opens as a tab in the editor, with the facecam on
   top and the game below (or the crop following the face, or the whole frame), captions and the title. Export all on
   the video's card saves every finished clip into one folder, named by its title.

## On a finished video

- **Export all** (a Clip a stream video's card): every clip into one folder, named by its title, each with a cover
  image and a caption to paste when posting.
- **Subtitles in other languages** (any video's menu): pick languages, Claude translates what is said, the .srt
  files land beside the exported video.

## Released

| Version | What |
|---|---|
| studio 0.1.0 | Create from a prompt; Claude hidden in the background |
| studio 0.13.0 | Natural free voices (edge-tts); real 3D in animated shots (three.js); sound bites that show the speaker (released 2026-11-19, tag `studio-v0.13.0`) |
| studio 0.12.0 | Long video picks the matching moment of each clip, passes over subtitled clips, and checks the render at every cut (released 2026-11-19, tag `studio-v0.12.0`) |
| studio 0.11.0 | UGC ad; Make Shorts from a Long video; sound bites; black bars cropped; Pixabay (released 2026-11-19, tag `studio-v0.11.0`) |
| studio 0.10.0 | Long video cut like an edited channel: a new picture every 2 s, type on the footage, condensed capitals, small lit captions (released 2026-11-19, tag `studio-v0.10.0`) |
| studio 0.9.0 | A narrator picker with previews; connections for Pexels, Runway and Higgsfield; AI-generated shots and your own voiceover in Long video (released 2026-11-19, tag `studio-v0.9.0`) |
| studio 0.8.0 | A natural free voice (Kokoro); animated graphics, logo-free clips, fuller sound and Pexels stock in Long video (released 2026-11-18, tag `studio-v0.8.0`) |
| studio 0.7.0 | Long video: a 2 to 10 minute video from one prompt, with thumbnails and a publishing kit (released 2026-11-18, tag `studio-v0.7.0`) |
| studio 0.6.0 | Subtitles in other languages; a cover image and a post caption with every exported clip; Clip a stream from a channel link (released 2026-11-18, tag `studio-v0.6.0`) |
| studio 0.5.0 | Make one like this; the four kinds of video as cards on New video; Export all; several streams ranked fairly (released 2026-11-18, tag `studio-v0.5.0`) |
| studio 0.4.0 | Clip a stream in your style; a hidden Claude's question waits for a page (released 2026-11-18, tag `studio-v0.4.0`) |
| studio 0.3.0 | Clip a stream reads a YouTube stream replay's live chat (released 2026-11-18, tag `studio-v0.3.0`) |
| studio 0.2.0 | Clip a stream; the IPv4 retry for downloads; notes on a finished video work with Claude hidden (released 2026-11-18, tag `studio-v0.2.0`) |

## Next, in order

0. **From other open-source projects** (researched 2026-11-19). Adopted: frame matching with CLIP through fastembed
   and subtitle reading with RapidOCR (both on onnxruntime, installed by `longvideo.py tools`); the audio fade at
   cuts and the check of the render at every cut, after browser-use/video-use. Tried and dropped: Chatterbox (it
   ran a 16 GB Mac out of memory). Not tried: WhisperX for who-is-speaking in sound bites (it needs torch).
0. **Needs a real key to try** (built from each service's docs, never run): ElevenLabs voices in the picker, Pexels,
   Runway, Higgsfield, Google's video model. Higgsfield's text-only route and Google's response format are the
   least certain.
0. **UGC ad, still open.** Tried only with stand-in takes, never with a real person's selfie clips. An AI presenter
   (HeyGen or similar) is not built: brief `presenter` "ai" only adds the on-screen label.
0. **Long video, still open.** Found clips with burned-in subtitles are not detected (only logos); a sound bite's
   picture is whatever the source shows in those seconds (it may be the audience, not the speaker); a check that drops
   found clips with burned-in subtitles or a channel's logo; 4K; more graphic templates (a tier list, a map, a
   timeline); full 3D is not planned.

1. **Twitch and Kick chat.** Not built: neither site offers a public way to read a past stream's chat (Twitch's needs
   its own site's key, Kick's sits behind a bot check). Those streams are scored on sound.
2. **Report the music bug upstream.** `product-video/scripts/sound.py score` fails when given a voice (a shape
   mismatch). The studio mixes its own music round it; the fix belongs in the original. A draft of the report is in
   `docs/upstream-issue-sound-score.md`; posting it is the owner's call.

## Keeping it light

The studio is a Claude Code plugin with the cooked. app page, and stays one for now. Shipping it as software that
someone installs once (a desktop app carrying Python, the renderer and ffmpeg, with a connection layer that is not
tied to Claude) was raised and set aside on 2026-11-19: possible, separate work, not started.

Even so, everything it uses has to run on an ordinary laptop. Before adding a library, a model or code from another
repository, it should pass all four:

1. **A licence that lets us ship it**: MIT, Apache 2.0, BSD or similar. Never GPL or AGPL code (MoneyPrinterV2,
   LosslessCut), and check a model's own licence apart from its code's.
2. **One environment**: it installs into the editor's own Python environment (`~/.ai-video-editor/venv`) or its Node
   one. Nothing that needs a second environment or pins a different version of a package we already use.
3. **A modest download**: say what it adds. Today the whole tool is about 2.6 GB (the renderer 1.2 GB, the speech
   models 0.8 GB, Python packages 0.5 GB, the animation tools 0.1 GB), plus ffmpeg and Node.
4. **It runs on 16 GB of memory**, beside the renderer and the transcriber, faster than real time.

| Looked at | Verdict |
|---|---|
| Kokoro (voice, Apache 2.0, 350 MB, runs on onnxruntime) | In. The offline voice |
| edge-tts (Microsoft's neural voices, free, a few kB) | In, 2026-11-19. The default free voice. It uses an unofficial route into Microsoft's service, so it may change; the offline voice is the fallback |
| three.js (MIT, 1.3 MB) | In, 2026-11-19. Real 3D for animated shots, rendered by HyperFrames |
| fastembed CLIP, RapidOCR (onnxruntime) | In, 0.12. Frame matching and subtitle reading |
| LatentSync, MuseTalk (lip sync), LTX-Video, Wan (video generation) | Not on this computer: they need a graphics card with far more memory than a 16 GB laptop has. Through a hosted service with the user's key (fal.ai or Replicate run all four), not built |
| WhisperX | Not added: it needs torch. The speaker in a sound bite is found by frame matching instead |
| MoneyPrinterTurbo (MIT) | Its ideas taken: a free neural voice with no key (edge-tts), stock sources. Its code is for simpler stock-footage shorts |
| Chatterbox (voice, MIT) | Out, 2026-11-19. 4.3 GB, needs its own environment with an older torch, 2 to 2.7 times slower than real time on an M4, and it ran a 16 GB Mac out of memory |
| ElevenLabs, Pixabay, Runway, Higgsfield, Google | In as connections: nothing to bundle, the user's own key |
| OpenCLIP, EasyOCR, WhisperX | Not tried. Each brings torch (about 1 GB and more memory); a version on onnxruntime would pass, check before adding |
| video-use (MIT) | Its ideas (an audio fade at every cut, checking the render at each cut) need no new dependency |

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
