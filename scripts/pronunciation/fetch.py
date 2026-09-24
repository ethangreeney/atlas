"""Fetch each name's English pronunciation ({{IPAc-en}}) from the lead of its Wikipedia article into wiki_ipac.json.
Usage (from the repo root): python scripts/pronunciation/fetch.py
"""
import json, re, time, urllib.request, urllib.parse
deck=json.load(open('src/data/deck.json'))
texts=list(json.load(open('src/data/audio.json')).keys())
cands={}
for n in deck['notes']:
    c=n['country']; cands.setdefault(c,[]).append(c)
    if n['capital']:
        for cap in re.split(r',\s*(?![^()]*\))', n['capital']) if ', ' in n['capital'] and n['capital'] not in texts else [n['capital']]:
            cands.setdefault(cap,[]).extend([f"{cap}, {c}", cap])
titles=sorted({t for v in cands.values() for t in v})
UA={'User-Agent':'AtlasPronunciationBuilder/1.0 (https://github.com/ethangreeney/atlas; ethan@greene.nz)'}
pages={}
def get(batch):
    q=urllib.parse.urlencode({'action':'query','prop':'revisions','rvprop':'content','rvslots':'main','redirects':1,'format':'json','formatversion':2,'titles':'|'.join(batch)})
    req=urllib.request.Request('https://en.wikipedia.org/w/api.php?'+q,headers=UA)
    return json.load(urllib.request.urlopen(req,timeout=30))
for i in range(0,len(titles),40):
    r=get(titles[i:i+40])['query']
    alias={}
    for k in ('normalized','redirects'):
        for m in r.get(k,[]): alias[m['from']]=m['to']
    content={p['title']:(p.get('revisions') or [{}])[0].get('slots',{}).get('main',{}).get('content','') for p in r['pages'] if not p.get('missing')}
    for t in titles[i:i+40]:
        tt=t
        for _ in range(3): tt=alias.get(tt,tt)
        pages[t]=content.get(tt,'')
    time.sleep(0.3)
out={}
for text in texts:
    found=None
    for t in cands.get(text,[text]):
        wt=pages.get(t,'')
        if not wt or wt.lstrip().lower().startswith('#redirect') : continue
        if '{{disambiguation' in wt.lower() or 'may refer to' in wt[:600]: continue
        lead=wt.split('\n==',1)[0]
        # Keep every template: articles often give UK and US forms in separate ones.
        m=re.findall(r'\{\{\s*IPAc-en\s*\|([^{}]*)\}\}', lead)
        if m: found={'title':t,'raw':'|#|'.join(m)}; break
    out[text]=found
json.dump(out,open('scripts/pronunciation/wiki_ipac.json','w'),ensure_ascii=False,indent=1)
print('with IPAc-en:',sum(1 for v in out.values() if v),'of',len(out))
