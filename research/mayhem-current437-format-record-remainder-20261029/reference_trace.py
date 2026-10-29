"""核对 Custom 格式化记录中由实际读取指令限定的字段。"""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import json
import struct

if not __debug__:
    raise RuntimeError('必须启用断言')
P = Path(__file__).resolve().parent
PRIOR = 'research/mayhem-current437-program-error-messages-20261028'
SLICES = ((0, 2), (16, 20), (32, 44))
sha = lambda b: hashlib.sha256(b).hexdigest()


def prior(root):
    spec = importlib.util.spec_from_file_location('prior_program_error', root / PRIOR / 'proof.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def instructions(e, start, expected):
    for offset, value in expected.items():
        pc = start + offset
        assert pc not in e.rel
        assert struct.unpack_from('<BBhi', e.b, pc) == value, (pc, value)


def pointer(e, pc, expected):
    op, reg, off, low = struct.unpack_from('<BBhI', e.b, pc)
    zero, high = struct.unpack_from('<II', e.b, pc + 8)
    assert (op, reg, off, zero, low | high << 32) == (0x18, 1, 0, 0, expected)
    assert e.rel.get(pc, {}).get('type') == 8 and e.rel[pc]['symbol_index'] == 0
    assert pc + 8 not in e.rel


def trace(e, owner, callee, ptr):
    # tag 0: the two unsigned comparisons and equality jump reach the Custom arm.
    instructions(e, owner, {0:(0x61,0x13,0,0), 8:(0x65,3,9,12),
        16:(0xd5,3,17,5), 160:(0x65,3,26,2), 168:(0x15,3,56,0)})
    site = owner + 640
    instructions(e, site - 16, {0:(7,1,0,4), 8:(0x7b,0x1a,-72,0)})
    pointer(e, site, ptr)
    # Construct stack arguments: record pointer at -32, record count 1 at -24;
    # call with r3 = frame - 64. The other pointer is deliberately not counted.
    instructions(e, site + 16, {0:(0x7b,0x1a,-32,0), 24:(0x7b,0x1a,-64,0),
        32:(0xbf,0xa1,0,0), 40:(7,1,0,-16), 48:(0x7b,0x1a,-48,0),
        72:(0x7b,0x1a,-8,0), 80:(0xbf,0xa1,0,0), 88:(7,1,0,-72),
        96:(0x7b,0x1a,-16,0), 104:(0x7a,0x0a,-24,1),
        112:(0x7a,0x0a,-56,1), 120:(0x7a,0x0a,-40,1),
        128:(0x79,0x24,8,0), 136:(0x79,0x21,0,0),
        144:(0xbf,0xa3,0,0), 152:(7,3,0,-64), 160:(0xbf,0x42,0,0)})
    op, reg, off, imm = struct.unpack_from('<BBhi', e.b, site + 184)
    assert (op, reg, off) == (0x85, 0x10, 0) and site + 192 + imm * 8 == callee
    # The first output callback must return success to reach the record reads.
    # A single record is selected by count=1. Its two 16-bit discriminants are 2.
    expected = {
      0:(0x7b,0x2a,-16,0),8:(0x7b,0x1a,-24,0),16:(0x18,1,0,-536870880),24:(0,0,0,0),32:(0x7b,0x1a,-8,0),
      40:(0x79,0x38,32,0),48:(0x7b,0x3a,-40,0),56:(0x15,8,61,0),64:(0x79,0x39,40,0),72:(0x15,9,92,0),
      80:(0xb7,7,0,0),88:(7,8,0,24),96:(0x27,9,0,48),104:(0x79,0x31,16,0),112:(0x7b,0x1a,-32,0),
      120:(0x79,0x36,0,0),128:(7,6,0,8),136:(0x79,0x63,0,0),144:(0x15,3,6,0),152:(0x79,0xa1,-16,0),
      160:(0x79,0x14,24,0),168:(0x79,0x62,-8,0),176:(0x79,0xa1,-24,0),184:(0x8d,0,0,4),192:(0x55,0,75,0),
      200:(0x69,0x82,-8,0),208:(0x15,2,16,0),216:(0xb7,1,0,0),224:(0x55,2,5,1),232:(0x79,0x81,0,0),
      240:(0x67,1,0,4),248:(0x79,0xa2,-32,0),256:(0x0f,0x12,0,0),264:(0x69,0x21,8,0),272:(0x69,0x82,-24,0),
      280:(0x15,2,10,2),288:(0x55,2,11,1),296:(0x79,0x82,-16,0),344:(0x69,0x81,-6,0),352:(0x69,0x82,-24,0),
      360:(0x55,2,-10,2),368:(0xb7,2,0,0),376:(5,0,1,0),384:(0x69,0x82,-22,0),
      392:(0x79,0x83,8,0),400:(0x61,0x84,16,0),408:(0x6b,0x2a,-2,0)}
    # Restrict checks to the traversed path, including both branch targets.
    path = (0,8,16,24,32,40,48,56,64,72,80,88,96,104,112,120,128,136,144,152,160,168,176,184,192,200,208,344,352,360,368,376,392,400,408)
    instructions(e, callee, {x:expected[x] for x in path})
    section = next(s for s in e.sections if s['name'] == '.rodata')
    assert section['address'] <= ptr and ptr + 44 <= section['address'] + section['size']
    assert not any(ptr + a <= x < ptr + b for a,b in SLICES for x in e.rel)
    data = [e.b[section['offset'] + ptr - section['address'] + a:section['offset'] + ptr - section['address'] + b] for a,b in SLICES]
    assert data == [b'\x02\x00', b'\x02\x00\x00\x00', b'\x00'*8 + bytes.fromhex('200080e0')]
    return {'owner':owner, 'callee':callee, 'record_pointer':ptr, 'fields':[{'offset':a,'length':b-a,'hex':v.hex()} for (a,b),v in zip(SLICES,data)], 'record_load_offsets':[200,344,352,392,400]}


def inspect(root):
    p = prior(root)
    original = (root/'evidence/original/mayhem/deployed.so').read_bytes()
    data = p.prior(root).prior(root).base_reader(root)
    candidate = data.inputs(root, 'mayhem-current437-composition-20261028')
    before = p.inspect(root/PRIOR, original, candidate, root)
    pairs = {tuple(x) for x in before['active_pairs']}
    assert (664640,598320) in pairs and (678096,611776) in pairs
    prefix, _, _ = data.readers(root/p.prior(root).prior(root).BASE, root)
    a,b = prefix.elves(original,candidate)
    left = trace(a,664640,678096,720328)
    right = trace(b,598320,611776,700768)
    assert left['fields'] == right['fields']
    return {'original':left,'candidate':right,'intervals':[[720328+a,720328+b] for a,b in SLICES], 'new_bytes':sum(b-a for a,b in SLICES)}


def inventory(packet):
    return {str(p.relative_to(packet)):sha(p.read_bytes()) for p in sorted(packet.rglob('*')) if p.is_file() and p.name != 'manifest.json'}


def check(packet, root):
    paths = list(packet.rglob('*'))
    assert all(not p.is_symlink() and (p.is_file() or p.is_dir()) for p in paths)
    assert inventory(packet) == json.loads((packet/'manifest.json').read_bytes())
    pins = json.loads((packet/'inputs.json').read_bytes())
    for path, digest in pins.items():
        q = Path(path)
        assert not q.is_absolute() and '..' not in q.parts and sha((root/q).read_bytes()) == digest
    assert {str(p.relative_to(root)) for p in (root/PRIOR).rglob('*') if p.is_file()} <= set(pins)
    prior(root).check(root/PRIOR, root)
    report = inspect(root)
    assert report == json.loads(gzip.decompress((packet/'observations.json.gz').read_bytes()))
    assert report['intervals'] == [[720328,720330],[720344,720348],[720360,720372]] and report['new_bytes'] == 18
    old = json.loads((root/PRIOR/'coverage-delta.json').read_bytes())
    covered = next(s['covered_intervals'] for s in old['sections'] if s['section'] == '.rodata')
    assert not any(a < d and c < b for a,b in report['intervals'] for c,d in covered)
    return report


def seal(root):
    report = inspect(root)
    (P/'observations.json.gz').write_bytes(gzip.compress(json.dumps(report, separators=(',',':')).encode(),mtime=0))
    (P/'manifest.json').write_text(json.dumps(inventory(P),indent=2)+'\n')
