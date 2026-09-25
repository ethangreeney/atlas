"""Fetch Wiktionary's English IPA for every name (and each word of multi-word names) into wiktionary.json,
using kaikki.org's per-word extracts of Wiktionary.
Usage (from the repo root): python scripts/pronunciation/fetch_wiktionary.py
"""
import json, re, time, urllib.parse, urllib.request

texts = list(json.load(open('src/data/audio.json')).keys())
UA = {'User-Agent': 'AtlasPronunciationBuilder/1.0 (https://github.com/ethangreeney/atlas; ethan@greene.nz)'}


def fetch(word):
    path = '/'.join(urllib.parse.quote(p) for p in (word[:1], word[:2], word + '.jsonl'))
    try:
        body = urllib.request.urlopen(urllib.request.Request(f'https://kaikki.org/dictionary/English/meaning/{path}', headers=UA), timeout=30).read().decode()
    except Exception:
        return []
    out = []
    for line in body.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        for s in e.get('sounds', []):
            if s.get('ipa') and s['ipa'].startswith('/'):
                v = {'ipa': s['ipa'], 'tags': s.get('tags', []), 'pos': e.get('pos')}
                if v not in out:
                    out.append(v)
    return out


words = sorted({t for t in texts} | {w for t in texts if ' ' in t for w in re.split(r'[\s\-]+', t.replace(',', '')) if len(w) > 2})
out = {}
for i, w in enumerate(words):
    out[w] = fetch(w)
    time.sleep(0.05)
json.dump(out, open('scripts/pronunciation/wiktionary.json', 'w'), ensure_ascii=False, indent=1)
print('with IPA:', sum(1 for t in texts if out.get(t)), 'of', len(texts), 'names;', sum(1 for v in out.values() if v), 'of', len(out), 'lookups')
