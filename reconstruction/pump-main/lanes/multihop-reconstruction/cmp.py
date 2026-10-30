import sys,difflib,re
def load(p):
    r=[]
    for l in open(p):
        f=l.split()
        if len(f)<3: continue
        r.append((f[0],f[2] if len(f)>3 else '?',' '.join(f[3:])))
    return r
o=[]
for l in open(sys.argv[1]):
    f=l.split(None,3); o.append((f[0],f[1],f[3].strip() if len(f)>3 else ''))
c=load(sys.argv[2])
# orig names: map by target via ours? use lines only + name from ours by target? keep simple
import json
names={}
ko=[x[1]+x[2] for x in o]
# map orig targets to names using sys.argv[3] (census orig_sequence) if given
cj=json.load(open(sys.argv[3]))['targets']; cj=cj['0x5b3b0'] if isinstance(cj,dict) else cj[0]
on=[x['callee'] for x in cj['orig_sequence']]
cn=[x['callee'] for x in cj['our_sequence']]
A=[n.split('::')[-1][-28:]+o[i][2] for i,n in enumerate(on)]
B=[n.split('::')[-1][-28:]+(c[i][2] if i<len(c) else '') for i,n in enumerate(cn)]
sm=difflib.SequenceMatcher(None,A,B,autojunk=False)
for op,a1,a2,b1,b2 in sm.get_opcodes():
  for i in range(max(a2-a1,b2-b1)):
    L=(o[a1+i][0],A[a1+i]) if a1+i<a2 else ('','')
    R=(c[b1+i][0],B[b1+i]) if b1+i<b2 else ('','')
    print(f'{op[:3]:3} {L[0]:>7} {L[1]:40} | {R[0]:>7} {R[1]}')
