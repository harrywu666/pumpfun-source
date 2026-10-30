# shape.py HARNESS cand.so [symregex]  -> ratios: exact(normalized), op+regs, op only
import sys,re,difflib
H=sys.argv[1]; sys.path.insert(0,H); args=sys.argv[2:]; sys.argv=sys.argv[:1]
import score
from pathlib import Path
W={x['start']:x for x in score.original_windows()}
w=W[0x5b3b0]
p=Path(args[0]); blob=p.read_bytes(); cs=score.sections(blob)
rx=re.compile(args[1] if len(args)>1 else r'8swap_hop17h')
s,n,nm=next(f for f in score.candidate_functions(p) if rx.search(f[2]))
craw=score.body(blob,cs,s,n)
OS=score.sections(score.BASE.joinpath('original.so').read_bytes())
def toks(raw,addr,secs):
    norm=score.normalize(raw,addr,secs); i=0; out=[]
    while i<len(raw):
        k=16 if raw[i]==0x18 else 8; out.append((raw[i:i+k],norm[i:i+k])); i+=k
    return out
o=toks(w['raw'],w['start'],OS); c=toks(craw,s,cs)
def r(f):
    return difflib.SequenceMatcher(None,[f(x) for x in o],[f(x) for x in c],autojunk=False).ratio()
print(f"bytes {len(craw)} exact {r(lambda x:x[1]):.4f} opregs {r(lambda x:x[0][:2]):.4f} op {r(lambda x:x[0][:1]):.4f}")
