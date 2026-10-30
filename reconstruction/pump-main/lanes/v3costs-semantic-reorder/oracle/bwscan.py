#!/usr/bin/env python3
"""Diagnostic: add branch_weights to each conditional br of v3_buy_costs; llc; diff vs original."""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from blkscan_lib import *
from concurrent.futures import ThreadPoolExecutor
ws=[tuple(map(int,x.split(":"))) for x in os.environ.get("WS","1:1000,1000:1,1:10,10:1,1:1000000,1000000:1").split(",")]
brs=[(bi,x) for bi,b in enumerate(blocks) for x in re.findall(r'  br i1 [^\n]+',b)]
jobs=[]
for bi,x in brs:
  for w in ws:
    bl=blocks[:]; bl[bi]=bl[bi].replace(x,x+', !prof !900000')
    jobs.append((bl,f'{x.strip()} {w}',w))
def run2(bl,tag,w):
    global t
    old=t
    return run_t(bl,tag,t+f'\n!900000 = !{{!"branch_weights", i32 {w[0]}, i32 {w[1]}}}\n')
print(len(jobs),'jobs',file=sys.stderr)
with ThreadPoolExecutor(4) as ex: res=list(ex.map(lambda a:run2(*a),jobs))
res.sort()
for r in res[:30]: print(r)
