"""Build scripts/pronunciation/pronunciations.json: Kokoro phonemes (US and British) for every name in the deck.
Order of trust: overrides.json (hand-written) > Wikipedia's English IPA (wiki_ipac.json, from fetch.py) > Wiktionary's
English IPA (wiktionary.json, from fetch_wiktionary.py) > the misaki pronunciation dictionary. Wikipedia matches must start with a sound that fits the word they're attached to.
Usage (from the repo root): python scripts/pronunciation/build.py <path to site-packages containing misaki>
"""
import json, re, sys, unicodedata
P=sys.argv[1]
texts=list(json.load(open('src/data/audio.json')).keys())
wiki=json.load(open('scripts/pronunciation/wiki_ipac.json'))
wikt=json.load(open('scripts/pronunciation/wiktionary.json'))
D={l:(json.load(open(f'{P}/misaki/data/{l}_gold.json')),json.load(open(f'{P}/misaki/data/{l}_silver.json'))) for l in ('us','gb')}
VOW_US={'iː':'i','i':'i','uː':'u','u':'u','ɑː':'ɑ','ɔː':'ɔ','ɒ':'ɑ','æ':'æ','ʌ':'ʌ','ɪ':'ɪ','ʊ':'ʊ','ə':'ə','ɛ':'ɛ','e':'ɛ','eɪ':'A','aɪ':'I','aʊ':'W','ɔɪ':'Y','oʊ':'O','ᵻ':'ᵻ','ɜː':'ɜ','ɔ':'ɔ','ɑ':'ɑ','a':'ɑ','o':'O','y':'i','ø':'ɜ'}
VOW_GB={'iː':'iː','i':'i','uː':'uː','u':'u','ɑː':'ɑː','ɔː':'ɔː','ɒ':'ɒ','æ':'a','ʌ':'ʌ','ɪ':'ɪ','ʊ':'ʊ','ə':'ə','ɛ':'ɛ','e':'ɛ','eɪ':'A','aɪ':'I','aʊ':'W','ɔɪ':'Y','oʊ':'Q','ᵻ':'ɪ','ɜː':'ɜː','ɔ':'ɔː','ɑ':'ɑː','a':'a','o':'Q','y':'iː','ø':'ɜː'}
RV={ # r-coloured: (us, gb_final, gb_prevocalic)
 'ɑːr':('ɑɹ','ɑː','ɑːɹ'),'ɔːr':('ɔɹ','ɔː','ɔːɹ'),'ɔər':('ɔɹ','ɔː','ɔːɹ'),'ɪər':('ɪɹ','ɪə','ɪəɹ'),'ɛər':('ɛɹ','ɛː','ɛəɹ'),
 'ʊər':('ʊɹ','ʊə','ʊəɹ'),'ɜːr':('ɜɹ','ɜː','ɜːɹ'),'ər':('əɹ','ə','əɹ'),'aɪər':('Iəɹ','Iə','Iəɹ'),'aʊər':('Wəɹ','Wə','Wəɹ'),
 'ɒr':('ɔɹ','ɒɹ','ɒɹ'),'ɛr':('ɛɹ','ɛɹ','ɛɹ'),'ær':('ɛɹ','aɹ','aɹ'),'ʌr':('ɜɹ','ʌɹ','ʌɹ'),'ɪr':('ɪɹ','ɪɹ','ɪɹ'),'ʊr':('ʊɹ','ʊɹ','ʊɹ'),'iːr':('ɪɹ','ɪə','iːɹ'),'jʊər':('jʊɹ','jʊə','jʊəɹ'),'eər':('ɛɹ','ɛː','ɛəɹ')}
CONS={'dʒ':'ʤ','tʃ':'ʧ','r':'ɹ','g':'ɡ','ɡ':'ɡ','hw':'w','x':'k','ʔ':'ʔ','əl':'əl','ən':'ən','əm':'əm','ts':'ts'}
LABELS={'uk','us','Q','lang','local','also','often','US','UK','audio','...','icon','pron','sometimes','Canada','Aus','NZ','Ireland','Scotland'}
def isvowel(t): return t in VOW_US or t in RV
def variants(raw):
    toks=[t.strip() for t in raw.split('|')]
    out=[]; cur=[]; label=None; bad=False
    def push():
        nonlocal cur,bad
        if cur and not bad: out.append((label,cur))
        cur=[]; bad=False
    for t in toks:
        if '=' in t or t=='' : continue
        if t in ('US','UK'): push(); label=t; continue
        if t=='#': push(); label=None; continue
        if t in ('...','…'): cur+=['_','…','_']; continue
        if t=='-' or t.startswith('-') or t.endswith('-'): bad=True; continue
        if t in LABELS: continue
        if t in (',_',';','_or_',',',', '): push(); continue
        if t in ('(',')'): continue
        cur.append(t)
    push()
    return out
ALIAS=[('a:r','ɑːr'),('u:','uː'),('i:','iː'),('dZ','dʒ'),('əʊ','oʊ'),('ɛəɹ','ɛər'),('ɪəɹ','ɪər'),(':','ː')]
ALIAS_WHOLE={'ɑr':'ɑːr','ɔr':'ɔːr','ɜr':'ɜːr','aː':'ɑː','%':'ˌ'}
UNITS=sorted(set(list(RV)+list(VOW_US)+list(CONS)+list('bdfhjklmnpstvwzŋʃʒθðɹ')+['ˈ','ˌ']),key=len,reverse=True)
def split_units(t):
    if t in ALIAS_WHOLE: t=ALIAS_WHOLE[t]
    for a,b in ALIAS: t=t.replace(a,b)
    if t in RV or t in VOW_US or t in CONS or t in ('_','.',"'",',','ˈ','ˌ'): return [t]
    out=[]; i=0
    while i<len(t):
        for u in UNITS:
            if t.startswith(u,i): out.append(u); i+=len(u); break
        else: return [t]
    return out
def convert(tokens, dia):
    tokens=[u for t in tokens for u in split_units(t)]
    words=[[]]
    for t in tokens:
        if t=='…': words+= [['…'],[]]; continue
        if t in ('_',' '): words.append([]); continue
        if t=='.': continue
        words[-1].append(t)
    res=[]
    for w in words:
        if w==['…']: res.append('…'); continue
        s=''; pend=''
        for i,t in enumerate(w):
            if t in ('ˈ','ˌ',"'",','): pend = 'ˈ' if t in ('ˈ',"'") else 'ˌ'; continue
            nxt=w[i+1] if i+1<len(w) else None
            if t in RV:
                u,gf,gp=RV[t]; sym = u if dia=='us' else (gp if nxt and isvowel(nxt) else gf)
                s+=pend+sym; pend=''
            elif t in VOW_US:
                s+=pend+(VOW_US if dia=='us' else VOW_GB)[t]; pend=''
            elif t in CONS:
                c=CONS[t]
                if t in ('əl','ən','əm'): s+=pend+c; pend=''
                else: s+=c
            elif re.fullmatch(r"[bdfhjklmnpstvwzŋʃʒθðɹ]",t): s+=t
            else: return None, f'unknown token {t!r}'
        if pend: return None,'dangling stress'
        res.append(s)
    return res, None
FIRST={'r':'ɹ','v':'vf','m':'mʌə','n':'nəɛ','o':'ɑOɔəʌɒQuWw','u':'jʌuʊəw','a':'æɑAəɔʌaɒIWɛ','e':'ɛəiɪAjI','i':'ɪIiə','y':'jIɪ','c':'ksʧʃ','g':'ɡʤʒ','j':'ʤjhʒw','q':'k','x':'zks','h':'h','w':'wv','k':'kʧ','s':'sʃz','t':'tʧθð','d':'dʤ','p':'pf','z':'zs','ñ':'n','ș':'ʃs','ø':'ɜ','å':'ɔQoO','é':'A'}
def starts_ok(word, ph):
    w=norm(word).lower().lstrip("'")
    p=ph.lstrip('ˈˌ')
    if not w or not p: return False
    c=w[0]; ok=FIRST.get(c, c)
    return p[0] in ok or (c in 'aeiouy' and p[0] in 'æɑAəɔʌaɒIWɛiɪOQuʊjɜ')
def norm(w):
    w=w.replace('ʻ',"'").replace('’',"'")
    return ''.join(c for c in unicodedata.normalize('NFD',w) if unicodedata.category(c)!='Mn')
STOP={'sea','islands','island','south','north','east','west','french','saint','and','the','of','gulf','bay','strait','ocean','republic','new','city','united','democratic','northern','arab','kingdom','federated','states','virgin','british','port','san','santo','sint','st.','de','la','del','el','da','do','dos','das','le','les','au','ocean'}
WIKT_FIX=[('ɚ','ər'),('ɝ','ɜːr'),('ɹ','r'),('ɫ','l'),('ɾ','t'),('ˑ',''),('ʔ',''),('ɐ','ə'),('ɵ','ə'),('ɘ','ə'),('ʉː','uː'),('ʉ','u'),('ɜ','ɜː'),('ːː','ː')]
def wikt_pick(word, dia):
    """Wiktionary IPA for a word or name, preferring one tagged for the dialect, converted to Kokoro phonemes (None if unusable)."""
    vs=[v for v in wikt.get(word,[]) if v.get('pos')=='name']
    want=('US','General-American','GenAm') if dia=='us' else ('UK','Received-Pronunciation','RP','British')
    order=[v for v in vs if any(t in want for t in v['tags'])]+[v for v in vs if not v['tags']]+vs
    for v in order:
        ipa=v['ipa'].strip('/').split(',')[0].strip()
        if re.search(r'[()\-…]',ipa): continue
        ipa=ipa.replace('.','')
        for a,b in WIKT_FIX: ipa=ipa.replace(a,b)
        ipa=ipa.replace('ɜːːr','ɜːr')
        ws,err=convert([t for w in ipa.split(' ') for t in ([w,'_'])][:-1],dia)
        ws=[x for x in (ws or []) if x]
        if ws: return ws
    return None
def look(word, dia):
    g,s=D[dia]
    for d,tag in ((g,'dict'),(s,'dict2')):
        for k in (word, word.lower(), word.capitalize(), norm(word), norm(word).lower(), norm(word).capitalize()):
            v=d.get(k)
            if isinstance(v,dict): v=v.get('DEFAULT') or next((x for x in v.values() if x),None)
            if v: return v,tag
    return None,None
out={}
for text in texts:
    t2=re.sub(r'\bSt\. ', 'Saint ', text)
    tw=[w for w in re.split(r"[\s\-]+", t2.replace(',', '')) if w]
    row={'words':tw}
    for dia in ('us','gb'):
        assign=[None]*len(tw); src=['?']*len(tw)
        w=wiki.get(text)
        if w:
            vs=variants(w['raw'])
            lab='UK' if dia=='gb' else 'US'
            pick=next((v for l,v in vs if l==lab),None) or next((v for l,v in vs if l is None),None) or (vs[0][1] if vs else None)
            if pick:
                ws,err=convert(pick,dia)
                ws=[x for x in (ws or []) if x] or None
                if ws and len(re.sub('[ˈˌː]','',''.join(ws))) < 0.45*len(re.sub(r'[^A-Za-zÀ-ÿ]','',text if len(ws)>=len(tw) else max(tw,key=len))): row.setdefault('rejected',{})[dia]=ws; ws=None
                if ws and '…' in ws:
                    g=ws.index('…'); head,tail=ws[:g],ws[g+1:]
                    if len(head)+len(tail)<=len(tw) and all(starts_ok(tw[i],head[i]) for i in range(len(head))) and all(starts_ok(tw[len(tw)-len(tail)+i],tail[i]) for i in range(len(tail))):
                        for i,x in enumerate(head): assign[i]=x; src[i]='wiki'
                        for i,x in enumerate(tail): assign[len(tw)-len(tail)+i]=x; src[len(tw)-len(tail)+i]='wiki'
                    else: row.setdefault('rejected',{})[dia]=ws
                    ws=None
                if ws:
                    if len(ws)==len(tw) and all(starts_ok(tw[i],ws[i]) for i in range(len(tw))): assign=ws[:]; src=['wiki']*len(tw)
                    elif len(ws)==len(tw): row.setdefault('rejected',{})[dia]=ws
                    elif len(ws)==1 and len(tw)>1:
                        letters=sum(len(x) for x in tw); plen=len(re.sub('[ˈˌː]','',ws[0]))
                        if '-' in text and ' ' not in text and plen>=0.6*letters: assign=[ws[0]]+['']*(len(tw)-1); src=['wiki']*len(tw)
                        else:
                            cand=[i for i,x in enumerate(tw) if x.lower() not in STOP and starts_ok(x,ws[0])]
                            if cand:
                                i=max(cand,key=lambda i:len(tw[i])); assign[i]=ws[0]; src[i]='wiki'
                            else: row.setdefault('rejected',{})[dia]=ws
                    elif len(ws)==1 and len(tw)==1 and not starts_ok(tw[0],ws[0]): row.setdefault('rejected',{})[dia]=ws; assign=[None]
                else: row.setdefault('err',{})[dia]=err
        known=[look(x,dia)[1]=='dict' for x in tw]
        if len(tw)==1 and assign[0] is None and not known[0]:
            ws=wikt_pick(text,dia)
            if ws and len(ws)==len(tw) and all(starts_ok(tw[i],ws[i]) for i in range(len(tw))): assign=ws[:]; src=['wikt']*len(tw)
        for i,x in enumerate(tw):
            if assign[i] is None and not known[i] and not (x.lower() in STOP and len(tw)>1):
                ws=wikt_pick(x,dia)
                if ws and len(ws)==1 and starts_ok(x,ws[0]): assign[i]=ws[0]; src[i]='wikt'
        for i,x in enumerate(tw):
            if assign[i] is None:
                v,tag=look(x,dia)
                if v: assign[i]=v; src[i]=tag
        def fix(p):
            p=p.replace('dʒ','ʤ').replace('tʃ','ʧ').replace('əʊ','O' if dia=='us' else 'Q')
            if 'ˈ' not in p and 'ˌ' not in p:
                m=re.search(r'[æɑAəɔʌaɒIWɛiɪOQuʊɜY]',p)
                if m: p=p[:m.start()]+'ˈ'+p[m.start():]
            return p
        FUNC={'and':'ənd','of':'əv','the':'ðə'}
        assign=[FUNC[tw[i].lower()] if tw[i].lower() in FUNC and len(tw)>1 and assign[i] is not None else assign[i] for i in range(len(tw))]
        row[dia]=' '.join(fix(a) if a not in FUNC.values() else a for a in assign if a) if all(a is not None for a in assign) else None
        row[dia+'_src']=src
        if row[dia] is None: row.setdefault('missing',{})[dia]=[tw[i] for i,a in enumerate(assign) if a is None]
    if row.get('us') and len(tw)==1 and row['us_src']==['wiki']:
        v,_=look(tw[0],'us')
        if v:
            import difflib
            a=re.sub('[ˈˌː]','',v); b=re.sub('[ˈˌː]','',row['us'])
            r=difflib.SequenceMatcher(None,a,b).ratio()
            if r<0.7: row['disagree']={'dict':v,'wiki':row['us'],'ratio':round(r,2)}
    out[text]=row
ov=json.load(open('scripts/pronunciation/overrides.json'))
for k,v in ov.items():
    assert k in out, k
    out[k]['us']=v[0]; out[k]['gb']=v[1]; out[k]['us_src']=out[k]['gb_src']=['hand']
def source(v):
    s=set(v['us_src'])
    if 'hand' in s: return 'hand'
    named=[x for x in ('wiki','wikt') if x in s]
    label={'wiki':'wikipedia','wikt':'wiktionary'}
    return '+'.join(label[x] for x in named)+('+dictionary' if s-{'wiki','wikt'} else '') if named else 'dictionary'
json.dump({k:{'us':v['us'],'gb':v['gb'],'source':source(v)} for k,v in out.items()},open('scripts/pronunciation/pronunciations.json','w'),ensure_ascii=False,indent=1)
miss=[k for k,v in out.items() if v['us'] is None or v['gb'] is None]
print('complete',len(out)-len(miss),'incomplete',len(miss))
print(json.dumps({k:out[k].get('missing') for k in miss},ensure_ascii=False))
print('errors',{k:v['err'] for k,v in out.items() if 'err' in v})
