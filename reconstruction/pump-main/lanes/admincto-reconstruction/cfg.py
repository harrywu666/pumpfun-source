#!/usr/bin/env python3
"""Basic-block CFG of admin_cto::execute with event annotations (diagnostic).

  cfg.py orig|cand [so] [--blocks]          # one line per block: start, succs, preds, events
  cfg.py orig|cand [so] --dot out.dot

Branch decoding: target = pc + 8 + off*8 (signed 16-bit off). Events as in annotate.py.
Memory-load annotations show [reg+off] loads of the accounts struct to help bind accounts.
"""
import argparse, re, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import annotate as A  # noqa

JMP = {0x05, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d, 0x45, 0x4d, 0x55, 0x5d, 0x65, 0x6d, 0x75, 0x7d,
       0xa5, 0xad, 0xb5, 0xbd, 0xc5, 0xcd, 0xd5, 0xdd}
CC = {0x15: 'jeq', 0x1d: 'jeq', 0x25: 'jgt', 0x2d: 'jgt', 0x35: 'jge', 0x3d: 'jge', 0x45: 'jset', 0x4d: 'jset',
      0x55: 'jne', 0x5d: 'jne', 0x65: 'jsgt', 0x6d: 'jsgt', 0x75: 'jsge', 0x7d: 'jsge', 0xa5: 'jlt', 0xad: 'jlt',
      0xb5: 'jle', 0xbd: 'jle', 0xc5: 'jslt', 0xcd: 'jslt', 0xd5: 'jsle', 0xdd: 'jsle'}


def load(which, cand, sym):
    import hashlib
    from collections import defaultdict as dd
    cblob = cand.read_bytes(); csecs = A.sections(cblob)
    cf = A.candidate_functions(cand)
    cnames = dd(list); csize = {}
    for s, n, nm in cf:
        cnames[s].append(A.demangle(nm)); csize[s] = n
    if which == 'orig':
        byhash = dd(set)
        for s, n in csize.items():
            for nm in cnames[s]:
                byhash[A.hkey(cblob, csecs, s, n)].add(re.sub(r'pump_recovered::', '', nm))
        oblob = (A.BASE / 'original.so').read_bytes(); osecs = A.sections(oblob)
        wins = {w['start']: w['bytes'] for w in A.original_windows()}
        start = 0x22a10; size = wins[start]; blob, secs = oblob, osecs

        def name(t):
            if t not in wins:
                return '?%x' % t
            ns = byhash.get(A.hkey(oblob, osecs, t, wins[t]))
            return ' | '.join(sorted(ns)) if ns else 'UNMATCHED:%x' % t
    else:
        cands = [s for s in csize if any(re.search(sym, x) for x in cnames[s])]
        start = cands[0]; size = csize[start]; blob, secs = cblob, csecs

        def name(t):
            return ' | '.join(sorted(set(re.sub(r'pump_recovered::', '', x) for x in cnames.get(t, ['?%x' % t]))))
    raw = A.body(blob, secs, start, size)
    src = {s['line_slot']: s['line'] for s in A.sites(blob, secs, start, raw) if s['line_slot'] is not None}
    ins = A.decode(raw, start)
    return start, size, blob, secs, ins, src, name


SHORT = [(r'.*Clone>::clone', 'clone'), (r'.*PumpError as core::fmt::Display.*', 'PE::fmt'),
         (r'PumpError::name', 'PE::name'), (r'.*ToString>::to_string', 'to_string'),
         (r'.*From<anchor_lang::error::AnchorError>>::from', 'Err<-Anchor'),
         (r'.*From<solana_program_error::ProgramError>>::from', 'Err<-PE'),
         (r'solana_account_info::AccountInfo::', 'AI::'), (r'solana_pubkey::Pubkey::', ''),
         (r'.*Clock>::get', 'Clock::get'), (r'.*Rent>::get', 'Rent::get'), (r'memcpy \| memmove', 'memcpy'),
         (r'solana_cpi::set_return_data \| .*', 'sol_log_data'), (r'anchor_spl::associated_token::create \| anchor_spl::associated_token::', 'ata::'),
         (r'.*ErrorCode as core::fmt::Display.*', 'EC::fmt'), (r'_<(\w+) as anchor_lang::Event>::data', r'\1::data'),
         (r'.*SpecFromIter.*', 'Vec::from_iter')]


def shortname(n):
    for a, b in SHORT:
        n2 = re.sub(a, b, n)
        if n2 != n:
            return n2
    return n


def blocks(start, ins, src, name, blob, secs):
    pcs = [p for p, *_ in ins]
    rel = lambda p: p - start
    leaders = {start}
    succ = {}
    for k, (pc, op, regs, off, imm) in enumerate(ins):
        nxt = ins[k + 1][0] if k + 1 < len(ins) else None
        if op in JMP:
            t = pc + 8 + off * 8
            leaders.add(t)
            if nxt: leaders.add(nxt)
        elif op == 0x95 and nxt:
            leaders.add(nxt)
    L = sorted(leaders)
    bl = {}
    cur = None
    for k, (pc, op, regs, off, imm) in enumerate(ins):
        if pc in leaders:
            cur = pc; bl[cur] = {'ins': [], 'succ': [], 'ev': []}
        b = bl[cur]; b['ins'].append((pc, op, regs, off, imm))
        r = rel(pc)
        if op == 0x85:
            if regs >> 4 == 1 and imm != -1:
                b['ev'].append(shortname(name(pc + 8 + imm * 8)))
            else:
                b['ev'].append('LOG' if imm == -1 else 'sys%x' % (imm & 0xffffffff))
        elif op == 0x18:
            s = A.rodata_str(blob, secs, imm)
            if s and not s.endswith('.rs'):
                b['ev'].append('"%s"' % s[:24])
        if r in src:
            b['ev'].append('L%d' % src[r])
        if op in (0x62, 0x7a) and 6000 <= imm < 6300 and r not in src:
            b['ev'].append('#%d' % imm)
    for k, (s, b) in enumerate(sorted(bl.items())):
        pc, op, regs, off, imm = b['ins'][-1]
        nxt = sorted(bl)[k + 1] if k + 1 < len(bl) else None
        if op == 0x05:
            b['succ'] = [pc + 8 + off * 8]
        elif op in JMP:
            cond = '%s r%d,%s' % (CC[op], regs & 15, ('r%d' % (regs >> 4)) if op & 8 else str(imm))
            b['cond'] = cond
            b['succ'] = [pc + 8 + off * 8, nxt]
        elif op == 0x95:
            b['succ'] = []
            b['ev'].append('EXIT')
        else:
            b['succ'] = [nxt]
    pred = defaultdict(list)
    for s, b in bl.items():
        for t in b['succ']:
            pred[t].append(s)
    return bl, pred


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('which', choices=['orig', 'cand'])
    ap.add_argument('cand', nargs='?', type=Path, default=A.DEF_CAND)
    ap.add_argument('--sym', default=r'admin_cto::execute$')
    ap.add_argument('--dot')
    a = ap.parse_args()
    start, size, blob, secs, ins, src, name = load(a.which, a.cand, a.sym)
    bl, pred = blocks(start, ins, src, name, blob, secs)
    r = lambda p: '%04x' % (p - start) if p is not None else '----'
    print('# %s blocks=%d bytes=%d' % (a.which, len(bl), size))
    for s in sorted(bl):
        b = bl[s]
        print('%s n=%-3d %-16s -> %-12s <- %-20s %s' % (
            r(s), len(b['ins']), b.get('cond', ''), ','.join(r(t) for t in b['succ']),
            ','.join(r(p) for p in sorted(pred[s]))[:20], ' '.join(b['ev'])))


if __name__ == '__main__':
    main()
