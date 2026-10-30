#!/usr/bin/env python3
"""Diagnostic: mark each call site in v3_buy_costs cold; llc; diff vs original."""
import re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from blkscan_lib import *
from concurrent.futures import ThreadPoolExecutor
jobs=[]
for bi,b in enumerate(blocks):
    for x in re.findall(r'  (?:%\S+ = )?(?:tail )?call [^\n]+',b):
        if 'llvm.' in x: continue
        y=re.sub(r'\) #(\d+)',lambda mm:') #9'+mm.group(1).zfill(2),x,count=1) if re.search(r'\) #\d+',x) else x+' #900'
        if y==x: continue
        bl=blocks[:]; bl[bi]=bl[bi].replace(x,y,1); jobs.append((bl,b.split(':')[0]+' '+re.search(r'@("[^"]+"|\S+?)\(',x).group(1)[:60]))
tc=t+'\nattributes #900 = { cold }\n'+''.join('attributes #9%s = { cold %s\n'%(a.zfill(2),b) for a,b in re.findall(r'^attributes #(\d+) = \{ (.*)$',t,re.M))
with ThreadPoolExecutor(4) as ex: res=list(ex.map(lambda a:run_t(a[0],a[1],tc),jobs))
for r in sorted(res): print(r)
