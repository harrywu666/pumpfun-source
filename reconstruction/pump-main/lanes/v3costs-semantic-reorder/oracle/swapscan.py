#!/usr/bin/env python3
"""Diagnostic: swap adjacent independent IR instructions in v3_buy_costs; llc; report diff vs original."""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from blkscan_lib import *
from concurrent.futures import ThreadPoolExecutor
mem=re.compile(r'\b(load|store|call|memcpy)\b')
jobs=[]
for bi,b in enumerate(blocks):
    L=b.split('\n')
    for i in range(len(L)-1):
        a,c=L[i],L[i+1]
        if not a.startswith('  ') or not c.startswith('  ') or a.lstrip().startswith(';') or c.lstrip().startswith(';'): continue
        if re.search(r'\b(phi|br|ret|unreachable)\b',a+c) : continue
        if mem.search(a) and mem.search(c): continue
        da=re.match(r'\s*(%[\w.$"]+) =',a)
        if da and re.search(re.escape(da.group(1))+r'\b',c): continue
        bl=blocks[:]; L2=L[:]; L2[i],L2[i+1]=c,a; bl[bi]='\n'.join(L2)
        jobs.append((bl,f'{b.split(":")[0]}:{i} '+a.strip()[:50]))
print(len(jobs),'jobs',file=sys.stderr)
with ThreadPoolExecutor(int(os.environ.get('J','4'))) as ex: res=list(ex.map(lambda a:run(*a),jobs))
res.sort()
for r in res[:30]: print(r)
