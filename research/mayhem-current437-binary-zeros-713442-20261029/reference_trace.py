"""Deterministic scanner for .rodata [713442, 713704).

The scanner re-finds every lddw whose 64-bit immediate points into the
target interval and proves that none of them is followed by a mov-imm
length at pc+16. It also proves that .data.rel.ro holds no range
descriptor that could bound the bytes. On that basis the packet reports
zero newly counted bytes.
"""
from pathlib import Path
import hashlib
import struct

if not __debug__:
    raise RuntimeError('must run with assertions enabled')

DEPLOYED = 'evidence/original/mayhem/deployed.so'
SYMBOLS = 'research/mayhem-current437-composition-20261028/builds/first/symbols.so.gz'
DEPLOYED_SHA256 = 'a87fa9f866272514e6acb852b668c4a08aeb173d56c883039991d114d1199bdb'
SYMBOLS_SHA256 = '9c8c50857bfe8b80ebf08ebb50c905c6582676cb8e572d39f45de8647f62fbae'

LO = 713442
HI = 713704
BINARY_END = 713538
ATTRIBUTION = 'provider=OpenCode model=opencode/deepseek-v4.1-flash-free client=opencode CLI 1.19.5'

# (pc, pointer, dst_register) for all nine direct lddw sites in .text.
EXPECTED_SITES = (
    (16168, 713474, 3),
    (17072, 713474, 1),
    (18096, 713474, 3),
    (29112, 713442, 8),
    (31752, 713474, 1),
    (311360, 713442, 1),
    (334240, 713442, 1),
    (605280, 713544, 2),
    (606912, 713624, 2),
)

MOV_IMM_OPCODES = {0xb7, 0x07}  # mov64 imm, add64 imm
OPCODE_NAMES = {0x79: 'ldxdw', 0x85: 'call', 0xb7: 'mov64', 0x07: 'add64'}

CLASSES = {
    713442: 'fixed-offset-32B-compare',
    713474: 'fixed-offset-64B-compare',
    713544: 'static-usize-9-argument',
    713624: 'static-usize-17-argument',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sections(b):
    """Return ELF sections parsed from a little-endian ELF64 image."""
    assert b[:6] == b'\x7fELF\x02\x01'
    (_, _, _, _, _, shoff, _, _, _, _, shsize, shnum, shstr) = struct.unpack_from(
        '<HHIQQQIHHHHHH', b, 16)
    assert shsize == 64 and shnum > 0
    raw = [struct.unpack_from('<IIQQQQIIQQ', b, shoff + i * shsize) for i in range(shnum)]
    names = b[raw[shstr][4]:raw[shstr][4] + raw[shstr][5]]
    out = []
    for s in raw:
        name = names[s[0]:].split(b'\0')[0].decode()
        out.append({'name': name, 'offset': s[4], 'size': s[5], 'address': s[3]})
    return out


def find_section(all_sections, name):
    return next(s for s in all_sections if s['name'] == name)


def scan_lddw(b, text, lo, hi):
    """Every aligned lddw in .text whose immediate targets [lo, hi)."""
    sites = []
    for pc in range(text['offset'], text['offset'] + text['size'] - 15, 8):
        if b[pc] != 0x18:
            continue
        if struct.unpack_from('<I', b, pc + 8)[0] != 0:
            continue
        low = struct.unpack_from('<I', b, pc + 4)[0]
        high = struct.unpack_from('<I', b, pc + 12)[0]
        pointer = low | high << 32
        if lo <= pointer < hi:
            sites.append((pc, pointer, b[pc + 1] & 0x0f))
    return sites


def scan_descriptors(b, datarelro, lo, hi):
    """Range descriptors and (pointer, length) pairs that could bound [lo, hi)."""
    triples = []
    pairs = []
    start = datarelro['offset']
    stop = start + datarelro['size']
    for off in range(start, stop - 23, 8):
        low, high, length = struct.unpack_from('<QQQ', b, off)
        if low == 0 and lo <= high < hi and length > 0:
            triples.append([off, low, high, length])
    for off in range(start, stop - 15, 8):
        pointer, length = struct.unpack_from('<QQ', b, off)
        if lo <= pointer < hi and 0 < length < 4096:
            pairs.append([off, pointer, length])
    return triples, pairs


def site_row(b, pc, pointer, reg):
    op, dstreg, off, imm = struct.unpack_from('<BBhi', b, pc + 16)
    assert op not in MOV_IMM_OPCODES, (pc, 'mov-imm length at pc+16')
    return {
        'pc': pc,
        'pointer': pointer,
        'dst_register': reg,
        'next_opcode': op,
        'next_name': OPCODE_NAMES.get(op, hex(op)),
        'next_operands': [dstreg, off, imm],
        'length_immediate_at_pc_plus_16': None,
        'pointer_class': CLASSES[pointer],
        'why_not_counted': (
            'pc+16 is ldxdw; a constant-offset read has no length immediate'
            if op == 0x79 else
            'pc+16 is call; the immediate value is not a byte length'),
    }


def require_no_claim(report, interval):
    """Guard: refuse any counted interval that overlaps the open span."""
    low, high = interval
    assert report['new_bytes'] == 0
    assert not (low < HI and LO < high), (
        'no counted interval may cover [%d, %d); bytes are not proven' % (low, high))


def inspect(root):
    root = Path(root)
    deployed = (root / DEPLOYED).read_bytes()
    assert sha(deployed) == DEPLOYED_SHA256
    assert sha((root / SYMBOLS).read_bytes()) == SYMBOLS_SHA256

    all_sections = sections(deployed)
    text = find_section(all_sections, '.text')
    rodata = find_section(all_sections, '.rodata')
    datarelro = find_section(all_sections, '.data.rel.ro')
    assert rodata['address'] <= LO and HI <= rodata['address'] + rodata['size']

    assert struct.unpack_from('<Q', deployed, 713544)[0] == 9
    assert struct.unpack_from('<Q', deployed, 713624)[0] == 17
    assert not any(deployed[off] for off in range(713538, 713544))
    assert not any(deployed[off] for off in range(713552, 713624))
    assert not any(deployed[off] for off in range(713632, HI))

    found = scan_lddw(deployed, text, LO, HI)
    assert tuple(found) == EXPECTED_SITES, found

    sites = [site_row(deployed, *site) for site in found]
    groups = {}
    for site in sites:
        groups.setdefault(site['pointer'], []).append(site['pc'])
    assert sorted(groups) == [713442, 713474, 713544, 713624]
    assert sorted(groups[713442]) == [29112, 311360, 334240]
    assert sorted(groups[713474]) == [16168, 17072, 18096, 31752]
    assert groups[713544] == [605280]
    assert groups[713624] == [606912]

    triples, pairs = scan_descriptors(deployed, datarelro, LO, HI)
    assert triples == [] and pairs == []

    return {
        'attribution': ATTRIBUTION,
        'target_interval': [LO, HI],
        'new_bytes': 0,
        'new_intervals': [],
        'still_open': [[LO, HI]],
        'image': {
            'deployed_sha256': DEPLOYED_SHA256,
            'symbols_sha256': SYMBOLS_SHA256,
            'text': [text['address'], text['size']],
            'rodata': [rodata['address'], rodata['size']],
            'data_rel_ro': [datarelro['address'], datarelro['size']],
        },
        'gap': {
            'binary_interval': [LO, BINARY_END],
            'binary_hex': deployed[LO:BINARY_END].hex(),
            'zeros_interval': [BINARY_END, HI],
            'u64_markers': [[713544, 9], [713624, 17]],
        },
        'lddw_sites': sites,
        'pointer_classes': [
            {'pointer': 713442, 'pcs': sorted(groups[713442]),
             'span': 32, 'class': CLASSES[713442],
             'why_not_counted': 'unrolled fixed-offset qword reads; pc+16 is ldxdw, no length immediate'},
            {'pointer': 713474, 'pcs': sorted(groups[713474]),
             'span': 64, 'class': CLASSES[713474],
             'why_not_counted': 'unrolled fixed-offset qword reads; pc+16 is ldxdw, no length immediate'},
            {'pointer': 713544, 'pcs': sorted(groups[713544]),
             'value': 9, 'class': CLASSES[713544],
             'why_not_counted': 'pc+16 is call; the 9 is a static &usize argument, not a byte length'},
            {'pointer': 713624, 'pcs': sorted(groups[713624]),
             'value': 17, 'class': CLASSES[713624],
             'why_not_counted': 'pc+16 is call; the 17 is a static &usize argument, not a byte length'},
        ],
        'descriptor_scan': {
            'data_rel_ro': [datarelro['address'], datarelro['size']],
            'triples_low0_high_in_gap': len(triples),
            'ptr_len_pairs_into_gap': len(pairs),
        },
        'rejection_reasons': {
            'classic_ptr_plus_imm': 'all nine lddw sites have ldxdw or call at pc+16, never mov64 imm',
            'index_equal': 'no explicit index upper-bound immediate plus read width gates these bytes',
            'unrolled_qword_compare': 'matching 32B/64B blobs are not a counted bound and no merged packet accepted this grammar',
            'descriptor': 'no (low=0, high in gap, length) descriptor and no (pointer, length) pair in .data.rel.ro',
        },
    }
