"""Render a pronunciation clip for every answer in the deck with Kokoro (open-source neural TTS, run locally).

Each clip is spoken from an exact phoneme string in scripts/pronunciation/pronunciations.json, not from spelling,
so names are said the way Wikipedia gives them rather than however the voice guesses. Both accents use af_heart,
Kokoro's best-trained voice (grade A); the British clips get British phonemes, so only the pronunciation changes.

Setup (Python 3.10+):
  pip install kokoro-onnx soundfile
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
Usage (from the repo root): python scripts/build-audio.py <dir with the two model files>
Writes public/voice/<us|gb>/<n>.mp3 and src/data/audio.json ({text: file}). Needs ffmpeg.
"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

VOICES = {"us": ("af_heart", "en-us"), "gb": ("af_heart", "en-gb")}
SPEED = 0.9


def spoken(p):
    """End on a full stop so the voice finishes the word, and lightly stress a final "oh" it would otherwise swallow."""
    return (p[:-1] + "ˌ" + p[-1] if p.endswith(("O", "Q")) else p) + "."


models = sys.argv[1] if len(sys.argv) > 1 else "."
kokoro = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
deck = json.load(open("src/data/deck.json"))
phonemes = json.load(open("scripts/pronunciation/pronunciations.json"))
texts = sorted({t for n in deck["notes"] for t in (n["country"], n["capital"]) if t})
missing = [t for t in texts if t not in phonemes]
if missing:
    sys.exit(f"No pronunciation for: {missing}. Run scripts/pronunciation/build.py first.")
manifest = {t: f"{i}.mp3" for i, t in enumerate(texts)}
json.dump(manifest, open("src/data/audio.json", "w"), ensure_ascii=False)

with tempfile.TemporaryDirectory() as tmp:
    for key, (voice, lang) in VOICES.items():
        os.makedirs(f"public/voice/{key}", exist_ok=True)
        for text, file in manifest.items():
            audio, sr = kokoro.create(spoken(phonemes[text][key]), voice=voice, speed=SPEED, lang=lang, is_phonemes=True)
            pad = np.zeros(int(sr * 0.08), dtype=audio.dtype)
            wav = os.path.join(tmp, "clip.wav")
            sf.write(wav, np.concatenate([pad, audio, pad]), sr)
            # 160k is MP3's ceiling at Kokoro's 24 kHz output
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "24000", "-b:a", "160k",
                            f"public/voice/{key}/{file}"], check=True)
print(f"{len(texts)} texts x {len(VOICES)} voices done")
