"""Pre-generate pronunciation clips for every answer in the deck with Microsoft neural voices (edge-tts).
Usage: <venv>/bin/python scripts/build-audio.py
Writes public/audio/<set>/<n>.mp3 and src/data/audio.json ({text: file}).
"""
import asyncio, json, os, sys
import edge_tts

SETS = {"us": "en-US-AndrewNeural", "gb": "en-GB-RyanNeural"}
deck = json.load(open("src/data/deck.json"))
texts = sorted({t for n in deck["notes"] for t in (n["country"], n["capital"]) if t})
manifest = {t: f"{i}.mp3" for i, t in enumerate(texts)}
json.dump(manifest, open("src/data/audio.json", "w"), ensure_ascii=False)

sem = asyncio.Semaphore(6)

async def gen(voice, text, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, voice, rate="-5%").save(path)
                return
            except Exception as e:  # noqa: BLE001
                await asyncio.sleep(1 + attempt * 2)
        print("FAILED", voice, text, file=sys.stderr)

async def main():
    jobs = []
    for key, voice in SETS.items():
        os.makedirs(f"public/audio/{key}", exist_ok=True)
        for text, file in manifest.items():
            jobs.append(gen(voice, text, f"public/audio/{key}/{file}"))
    await asyncio.gather(*jobs)
    print(f"{len(texts)} texts x {len(SETS)} voices done")

asyncio.run(main())
