# Long video from the user's own voiceover

The recording is the script: nothing is written, nothing is approved, no AI voice is made.

```bash
python3 "$PY" "$L" voiceover EDIT "<brief.json voiceover>"
```

It transcribes the recording and writes scenes.json with one scene a spoken line (`l01`, `l02`, ...), timing.json
and words.json. Then, in scenes.json: give the video a `title` and `look`, give the lines their `section`s, and
replace every line's placeholder shot with real `shots` (step 2's rules; `say` is what was heard and stays as it
is, mishearings too). Research only to get graphics right (a number the speaker says, a name's spelling), and put
no fact on screen the speaker did not say. `check`, then skip steps 2's approval and 3 entirely (never run
`voice` or `words`: they would replace the recording) and go on at step 4. On a note about the words: say on the
page that the words are the user's recording and only the pictures can change.
