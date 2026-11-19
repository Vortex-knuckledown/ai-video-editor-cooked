"""Speaks lines with Pocket TTS (Kyutai, MIT code, CC-BY 4.0 voices) in its own Python, so its PyTorch stays out of
the editor's environment. One model load for a whole video: reads one JSON object a line on stdin
({"text", "out", "voice"}), writes a WAV, answers one JSON line ({"ok": true} or {"error": "..."}).
`voice`: a catalogue name (alba, marius, george ...) or the path of a recording to copy the voice of (cloning needs the
user's own Hugging Face login, having accepted the model's terms at huggingface.co/kyutai/pocket-tts)."""
import json
import sys


def main():
    import scipy.io.wavfile
    from pocket_tts import TTSModel
    model, states = TTSModel.load_model(), {}
    print(json.dumps({"ready": True, "cloning": bool(getattr(model, "has_voice_cloning", False))}), flush=True)
    for line in sys.stdin:
        try:
            j = json.loads(line)
            v = j.get("voice") or "alba"
            if v not in states:
                states[v] = model.get_state_for_audio_prompt(v)
            audio = model.generate_audio(states[v], j["text"])
            scipy.io.wavfile.write(j["out"], model.sample_rate, audio.numpy())
            print(json.dumps({"ok": True}), flush=True)
        except Exception as e:   # noqa: BLE001
            print(json.dumps({"error": f"{type(e).__name__}: {e}"[:300]}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
