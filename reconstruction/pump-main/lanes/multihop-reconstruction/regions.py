# regions.py HARNESS cand.so [minlen]: big unmatched regions on op+regs tokens
import sys,re,difflib
H=sys.argv[1]; sys.path.insert(0,H); args=sys.argv[2:]; sys.argv=sys.argv[:1]
import score
from pathlib import Path
w={x['start']:x for x in score.original_windows()}[0x5b3b0]
p=Path(args[0]); blob=p.read_bytes(); cs=score.sections(blob)
s,n,nm=next(f for f in score.candidate_functions(p) if '8swap_hop17h' in f[2])
craw=score.body(blob,cs,s,n)
def toks(raw):
    i=0; out=[]
    while i<len(raw):
        k=16 if raw[i]==0x18 else 8; out.append((i,raw[i:i+2])); i+=k
    return out
o=toks(w['raw']); c=toks(craw)
mn=int(args[1]) if len(args)>1 else 8
sm=difflib.SequenceMatcher(None,[x[1] for x in o],[x[1] for x in c],autojunk=False)
for op,a1,a2,b1,b2 in sm.get_opcodes():
    if op!='equal' and max(a2-a1,b2-b1)>=mn:
        oa=hex(o[a1][0]) if a1<len(o) else 'end'; ca=hex(c[b1][0]) if b1<len(c) else 'end'
        print(f'{op:7} orig {oa:>7} +{a2-a1:4}   ours {ca:>7} +{b2-b1:4}')
