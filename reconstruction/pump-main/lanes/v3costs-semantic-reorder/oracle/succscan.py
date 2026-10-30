#!/usr/bin/env python3
"""Diagnostic: invert each conditional branch (swap successors) and permute phi incoming order; llc; diff."""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from blkscan_lib import *
from concurrent.futures import ThreadPoolExecutor
jobs=[]
k=0
for bi,b in enumerate(blocks):
    for x in re.findall(r'  br i1 (%\S+), label (%\S+), label (%\S+)',b):
        c,a,bb=x; k+=1
        bl=blocks[:]; bl[bi]=bl[bi].replace(f'  br i1 {c}, label {a}, label {bb}',f'  %inv{k} = xor i1 {c}, true\n  br i1 %inv{k}, label {bb}, label {a}')
        jobs.append((bl,'inv '+c))
    for ph in re.findall(r'  %\S+ = phi [^\n]+',b):
        inc=re.findall(r'\[ [^\]]+ \]',ph)
        if len(inc)<2: continue
        head=ph[:ph.index('[')]
        for r in range(1,len(inc)):
            new=head+', '.join(inc[r:]+inc[:r])
            bl=blocks[:]; bl[bi]=bl[bi].replace(ph,new); jobs.append((bl,f'phirot{r} '+ph.split('=')[0].strip()))
print(len(jobs),'jobs',file=sys.stderr)
with ThreadPoolExecutor(4) as ex: res=list(ex.map(lambda a:run(*a),jobs))
for r in sorted(res)[:25]: print(r)
