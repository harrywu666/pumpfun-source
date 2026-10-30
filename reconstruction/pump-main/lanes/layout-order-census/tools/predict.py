"""Predict raw membership under hypothetical layouts.
Scenarios:
 S0 current build (sanity: should reproduce 188)
 S1 the 16 unmatched take original sizes (codes match), current order, current data layout
 S2 S1 + data sections identical to original (rodata/data.rel.ro offsets equal and same base)
 S3 S2 + original function order (sanity: all normalized -> raw)
"""
import sys,json,struct,bisect
sys.path.insert(0,'.')
import census as C
from pathlib import Path
cpath=Path(sys.argv[1]); ref=json.load(open(sys.argv[2]))
orig=(C.BASE/'original.so').read_bytes(); osec=C.sections(orig)
cand=cpath.read_bytes(); csec=C.sections(cand)
wins={w['start']:w for w in C.original_windows()}; ost=sorted(wins)
pair={int(k,16):int(v,16) for k,v in ref['pair'].items()}
inv={v:k for k,v in pair.items()}
units={}
for a,s,n in C.candidate_functions(cpath): units.setdefault(a,[s,n])
cst=sorted(units)
extras=[(a,units[a][0],units[a][1]) for a in cst if a not in inv]
UN=set(C.UNMATCHED_NAMES)
print('cand units',len(cst),'paired',len(inv),'extras',len(extras),'extra bytes',sum(e[1] for e in extras))
for e in extras: print('   extra',hex(e[0]),e[1],e[2][:100])
def owin(x):
    i=bisect.bisect_right(ost,x)-1; return ost[i]
def cfn(x):
    i=bisect.bisect_right(cst,x)-1; return cst[i]
def layout(order,sizefn):
    addr={}; p=csec['.text']['addr']
    for a in order: addr[a]=p; p+=sizefn(a)
    return addr,p-csec['.text']['addr']
def run(name,order,sizefn,data_equal):
    na,tsize=layout(order,sizefn)
    rodelta=(osec['.text']['size']-tsize)  # rodata base shift relative to original
    raw=0; fails={'call':0,'text_lddw':0,'data_lddw':0,'call_to_extra':0}; nfail=0
    for s in ost:
        if s in UN: continue
        a=pair[s]; craw=C.body(cand,csec,a,units[a][0])
        oo=C.operands(wins[s]['raw'],s,osec); co=C.operands(craw,a,csec)
        ok=True; why=set()
        for x,y in zip(oo,co):
            if x[1]=='call':
                callee=cfn(y[2]); off=y[2]-callee
                if callee not in na: ok=False; why.add('call_to_extra'); continue
                tgt=na[callee]+off
                if tgt-(na[a]+x[0]+8)!=x[2]-(s+x[0]+8): ok=False; why.add('call')
            else:
                if x[3]=='.text':
                    callee=cfn(y[2]); 
                    if callee not in na or na[callee]+(y[2]-callee)!=x[2]: ok=False; why.add('text_lddw')
                else:
                    if data_equal: continue
                    oo_=x[2]-osec[x[3]]['addr']; co_=y[2]-csec[y[3]]['addr']
                    if not (x[3]==y[3] and oo_==co_ and rodelta==0 and osec[x[3]]['addr']==csec[y[3]]['addr']-(csec['.text']['size']-tsize)):
                        ok=False; why.add('data_lddw')
        raw+=ok
        for w in why: fails[w]+=1
    print(f'{name}: text_size={tsize:#x} (orig {osec[".text"]["size"]:#x}) raw={raw} of {len(ost)-len(UN)} matched; failing windows by cause={fails}')
    return raw
cur=lambda a: units[a][0]
fix=lambda a: wins[inv[a]]['bytes'] if a in inv and inv[a] in UN else units[a][0]
run('S0 current',cst,cur,False)
run('S1 16-fixed, our order, our data',cst,fix,False)
run('S2 16-fixed, our order, data equal',cst,fix,True)
noext=[a for a in cst if a in inv]
run('S2b 16-fixed, our order, no extras, data equal',noext,fix,True)
oorder=[pair[s] for s in ost]
run('S3 16-fixed, original order, no extras, data equal',oorder,fix,True)
run('S3b 16-fixed, original order(+extras at end), data equal',oorder+[e[0] for e in extras],fix,True)

# ---- class decomposition ----
import re
names={a:units[a][1] for a in cst}
mend=[a for a in cst if names[a]=='__rust_alloc_error_handler'][0]
main=[a for a in noext if a<mend]
lstart=next(main[i] for i in range(1,len(main)) if names[main[i]]<names[main[i-1]])
region=lambda a: 'U' if a<lstart else ('L' if a<mend else 'D')
print('local block starts at',hex(lstart),names[lstart][:80])
from collections import Counter
print('region sizes',Counter(region(a) for a in noext))
# cross-region: original neighbours in different region
def reorder(seq,sel,key):
    pos=[i for i,a in enumerate(seq) if sel(a)]
    vals=sorted((seq[i] for i in pos),key=key)
    out=list(seq)
    for i,v in zip(pos,vals): out[i]=v
    return out
okey=lambda a: inv[a]
base=lambda a: re.sub(r'17h[0-9a-f]{16}E$','',names[a])
res={}
for label,sel in [('U',lambda a: region(a)=='U'),('L',lambda a: region(a)=='L'),('D',lambda a: region(a)=='D'),
                  ('U+L',lambda a: region(a) in 'UL'),('U+D',lambda a: region(a) in 'UD'),('L+D',lambda a: region(a) in 'LD')]:
    res[label]=run(f'S4 orig order within {label}',reorder(noext,sel,okey),fix,True)
# hash-group only: permute each same-base group to original order
seq=list(noext)
groups={}
for a in seq: groups.setdefault((region(a),base(a)),[]).append(a)
for g,mem in groups.items():
    if len(mem)>1: seq=reorder(seq,lambda a,m=set(mem): a in m,okey)
run('S5 hash-groups permuted to original order only',seq,fix,True)
seq2=reorder(seq,lambda a: region(a)=='D',okey)
run('S5b hash-groups + deps original',seq2,fix,True)
# local def-order only, hash groups unchanged

# L at def granularity: groups keep our internal order, groups placed in original order of their first member
def defkey_factory(seqL):
    g={}
    for a in seqL: g.setdefault(base(a),[]).append(inv[a])
    first={k:min(v) for k,v in g.items()}
    ourpos={a:i for i,a in enumerate(seqL)}
    return lambda a:(first[base(a)],ourpos[a])
Lunits=[a for a in noext if region(a)=='L']
dk=defkey_factory(Lunits)
sL=reorder(noext,lambda a: region(a)=='L',dk)
run('S6 L def-level original (within-group ours)',sL,fix,True)
sLU=reorder(sL,lambda a: region(a)=='U',okey)
run('S6b L def-level + U original',sLU,fix,True)
sLUD=reorder(sLU,lambda a: region(a)=='D',okey)
run('S6c L def-level + U + D original',sLUD,fix,True)
# count L groups with >1 member whose internal order differs
diff=0;tot=0
g={}
for a in Lunits: g.setdefault(base(a),[]).append(a)
for k,m in g.items():
    if len(m)>1:
        tot+=1
        if sorted(m)!=sorted(m,key=okey): diff+=1
print('L multi-member groups',tot,'with internal order differing',diff)
g={}
for a in [x for x in noext if region(x)=='U']: g.setdefault(base(a),[]).append(a)
d2=sum(1 for m in g.values() if len(m)>1 and sorted(m)!=sorted(m,key=okey)); print('U multi groups',sum(1 for m in g.values() if len(m)>1),'differing',d2)
# region crossing: original-order neighbours
ordd=[pair[s] for s in ost]
cross=[(hex(inv[a]),region(a),names[a][:80]) for i,a in enumerate(ordd[1:-1],1) if region(a)!=region(ordd[i-1]) and region(a)!=region(ordd[i+1])]
print('isolated region crossings in original order:',len(cross))
for c in cross: print('  ',c)

# S7: original order but each hash group (same base name, same region) keeps OUR internal relative order in the group's original slots
def hash_scramble(seq):
    out=list(seq); gs={}
    for i,a in enumerate(seq): gs.setdefault((region(a),base(a)),[]).append(i)
    for k,idx in gs.items():
        if len(idx)>1:
            mem=sorted((seq[i] for i in idx))  # our order = our address order
            for i,v in zip(idx,mem): out[i]=v
    return out
o3=[pair[s] for s in ost]
run('S7 original order but our within-hash-group order',hash_scramble(o3),fix,True)
# S7b: same, but deps fully original (dep hashes are fixed by dep crate metadata, not by our crate)
def hash_scramble_sel(seq,regs):
    out=list(seq); gs={}
    for i,a in enumerate(seq):
        if region(a) in regs: gs.setdefault((region(a),base(a)),[]).append(i)
    for k,idx in gs.items():
        if len(idx)>1:
            mem=sorted((seq[i] for i in idx))
            for i,v in zip(idx,mem): out[i]=v
    return out
run('S7b original order; our hash order in U+L only (deps original)',hash_scramble_sel(o3,'UL'),fix,True)
run('S7c original order; our hash order in U only',hash_scramble_sel(o3,'U'),fix,True)
run('S7d original order; our hash order in L only',hash_scramble_sel(o3,'L'),fix,True)

# current-state (sizes as built, extras present, data as built): effect of reordering classes now
full=list(cst)
run('C0 current',full,cur,False)
run('C1 current + L original order',reorder(full,lambda a: a in inv and region(a)=='L',okey),cur,False)
run('C2 current + U original order',reorder(full,lambda a: a in inv and region(a)=='U',okey),cur,False)
run('C3 current + D original order',reorder(full,lambda a: a in inv and region(a)=='D',okey),cur,False)
run('C4 current + all original order (extras in place)',reorder(full,lambda a: a in inv,okey),cur,False)

# handler relocation into #[program] module position (after pump_recovered::pump_recovered::create)
H=[pair[s] for s in (0x13b9b8,0x13f630,0x144508,0x147ba0,0x1489f8,0x14a8a8)]
crt=[a for a in cst if names[a].startswith('_ZN14pump_recovered14pump_recovered6create17h')][0]
def move_after(seq,items,anchor):
    s=[a for a in seq if a not in items]; i=s.index(anchor)+1
    return s[:i]+items+s[i:]
mv=move_after(full,H,crt)
run('C5 current + 6 handlers moved into program-mod slot',mv,cur,False)
run('C5b C5 + L original order otherwise',reorder(mv,lambda a: a in inv and region(a)=='L' and a not in H,okey),cur,False)
run('S8 16-fixed,no extras,data equal + handlers moved',move_after(noext,H,crt),fix,True)
