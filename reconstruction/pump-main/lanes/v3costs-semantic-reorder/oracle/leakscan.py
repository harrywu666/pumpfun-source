#!/usr/bin/env python3
"""Diagnostic: insert a synthetic 1:W leak edge (to a noreturn panic) before the terminator of each block; report whether sret stores use r3 (original) or r6."""
import re,sys,os,subprocess,tempfile
sys.path.insert(0,os.path.dirname(__file__))
from blkscan_lib import *
from concurrent.futures import ThreadPoolExecutor
W=os.environ.get('W','2000')
panic='  call void @_ZN4core6option13expect_failed17h7e2cb204b05dab71E(ptr noalias noundef nonnull readonly align 1 @alloc_c53ee819a6028c03a31d0ed6681cb6a4, i64 noundef 38, ptr noalias noundef nonnull readonly align 8 dereferenceable(24) @alloc_8ba37cc28eaf1e56bec2db807e046a73) #29\n  unreachable'
def run_pat(bl,tag,tt):
    f=m.group(0)[:m.start(1)-m.start(0)]+'\n\n'.join(bl)+'\n}\n'
    t2=tt[:m.start()]+f+tt[m.end():]
    d=tempfile.mkdtemp(dir=OUT+'/tmp'); open(d+'/m.ll','w').write(t2)
    r=subprocess.run([SDK+'/llvm/bin/llc','-O3','-relocation-model=pic','-mattr=+store-imm,+jmp-ext',d+'/m.ll','-filetype=obj','-o',d+'/m.o'],capture_output=True,text=True)
    if r.returncode: return (tag,'ERR',r.stderr[-200:])
    fn=subprocess.run(['sh',OUT+'/bin/fn.sh',d+'/m.o',sym],capture_output=True,text=True).stdout
    subprocess.run(['rm','-rf',d])
    r6=len(re.findall(r'stxdw \[r6 \+ 0x(10|18|8|0)\]',fn)); r3=len(re.findall(r'stxdw \[r3 \+ 0x(10|18|8|0)\]',fn))
    return (tag,'r6=%d r3=%d'%(r6,r3),len(fn.splitlines()))
jobs=[]
for bi,b in enumerate(blocks):
    if bi==0: continue
    L=b.split('\n'); term=L[-1]
    if 'unreachable' in term or 'phi' in b and False: pass
    if 'unreachable' in term: continue
    name=L[0].split(':')[0]
    nb=L[:-1]+[f'  %lk{bi} = icmp eq i64 %quote, 777{bi}',f'  br i1 %lk{bi}, label %leak{bi}, label %cont{bi}, !prof !900000','',f'leak{bi}:',panic,'',f'cont{bi}:',term]
    bl=blocks[:]; bl[bi]='\n'.join(nb)
    # fix phis in successors referencing this block name
    lab='%'+name
    for sj in range(len(bl)):
        if sj==bi: continue
        bl[sj]=re.sub(r'(phi [^\n]*\[ [^\]]+, )'+re.escape(lab)+r'( \])',lambda mm:mm.group(1)+f'%cont{bi}'+mm.group(2),bl[sj])
        bl[sj]=re.sub(r'(\[ [^\],]+, )'+re.escape(lab)+r' \]',lambda mm:mm.group(1)+f'%cont{bi} ]',bl[sj]) if 'phi' in bl[sj] else bl[sj]
    jobs.append((bl,name))
tt=t+f'\n!900000 = !{{!"branch_weights", i32 1, i32 {W}}}\n'
with ThreadPoolExecutor(4) as ex: res=list(ex.map(lambda a:run_pat(a[0],a[1],tt),jobs))
for r in res: print(r)
