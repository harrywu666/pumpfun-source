#!/usr/bin/env python3
"""Diagnostic: move each IR block of v3_buy_costs to each position; llc; report best by diff count vs original."""
import re,sys,subprocess,os,difflib,tempfile
from concurrent.futures import ThreadPoolExecutor
OUT=os.path.expanduser('~/.cache/pumpfun-reconstruction/lanes/v3costs-semantic-reorder')
SDK=os.path.expanduser('~/.cache/solana/v1.44/platform-tools')
base=sys.argv[1] if len(sys.argv)>1 else OUT+'/ir/r2base/one.ll'
t=open(base).read()
m=re.search(r'^define[^\n]*12v3_buy_costs[^\n]*\{\n(.*?)^\}\n',t,re.M|re.S)
sym=re.search(r'@(\S+?)\(',m.group(0)).group(1)
body=m.group(1)
blocks=re.split(r'\n\n',body.strip('\n'))
o=[re.sub(r'([+-]0x[0-9a-f]+)$','J',l.strip()) if re.match(r'(ja|j[a-z]+ )',l.strip()) else l.strip() for l in open(OUT+'/notes/orig-norm.txt').read().splitlines()]
def run(bl,tag):
    return run_t(bl,tag,t)
def run_t(bl,tag,t):
    f=m.group(0)[:m.start(1)-m.start(0)]+'\n\n'.join(bl)+'\n}\n'
    tt=t[:m.start()]+f+t[m.end():]
    d=tempfile.mkdtemp(dir=OUT+'/tmp')
    open(d+'/m.ll','w').write(tt)
    r=subprocess.run([SDK+'/llvm/bin/llc','-O3','-relocation-model=pic','-mattr=+store-imm,+jmp-ext',d+'/m.ll','-filetype=obj','-o',d+'/m.o'],capture_output=True,text=True)
    if r.returncode: return (9999,9999,tag)
    fn=subprocess.run(['sh',OUT+'/bin/fn.sh',d+'/m.o',sym],capture_output=True,text=True).stdout
    fn=re.sub(r'call -?0x[0-9a-f]+','call X',fn); fn=re.sub(r'lddw (r\d+), 0x[0-9a-f]+',r'lddw \1, X',fn)
    c=[re.sub(r'([+-]0x[0-9a-f]+)$','J',l.strip()) if re.match(r'(ja|j[a-z]+ )',l.strip()) else l.strip() for l in fn.splitlines()]
    diff=list(difflib.unified_diff(o,c,n=0,lineterm=''))
    mi=sum(1 for l in diff if l[:1]=='-' and l[:3]!='---')
    sz=sum(16 if l.startswith('lddw') else 8 for l in c)
    subprocess.run(['rm','-rf',d])
    return (mi,sz,tag)
os.makedirs(OUT+'/tmp',exist_ok=True)
