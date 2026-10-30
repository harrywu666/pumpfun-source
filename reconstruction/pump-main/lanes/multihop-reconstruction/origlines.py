import sys,json
sys.path.insert(0,sys.argv[1]); sys.argv=sys.argv[:1]
import coords
W={x['start']:x for x in coords.original_windows()}
out=[]
for l in open(sys.argv[0].rsplit('/',1)[0]+'/orig_calls.txt'):
    off,t=l.split(); t=int(t,16)
    w=W.get(t)
    lines=[s['line'] for s in coords.orig_sites(t)] if w else None
    print(off, hex(t), w['bytes'] if w else '?', lines)
