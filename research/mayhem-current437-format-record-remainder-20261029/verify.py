"""复查格式化记录剩余字节；只记录观察，不把未读取字节计入覆盖。"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import reference_trace as ref

if not __debug__:
    raise RuntimeError('必须启用断言')
P = Path(__file__).resolve().parent
RESIDUAL = ((2, 16), (20, 32), (44, 48))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def inspect(root):
    prior = ref.prior(root)
    prior.check(root / ref.PRIOR, root)
    previous = ref.inspect(root)
    assert previous['intervals'] == [[720328, 720330], [720344, 720348], [720360, 720372]]
    data = prior.prior(root).prior(root).base_reader(root)
    original = (root / 'evidence/original/mayhem/deployed.so').read_bytes()
    candidate = data.inputs(root, 'mayhem-current437-composition-20261028')
    prefix, _, _ = data.readers(root / prior.prior(root).prior(root).BASE, root)
    images = prefix.elves(original, candidate)
    rows = []
    for image, base, site in zip(images, (720328, 700768), (665280, 598960)):
        text = next(x for x in image.sections if x['name'] == '.text')
        section = next(x for x in image.sections if x['name'] == '.rodata')
        at = section['offset'] + base - section['address']
        assert section['address'] <= base and base + 48 <= section['address'] + section['size']
        assert not any(base <= x < base + 48 for x in image.rel)
        references = []
        for pc in range(text['offset'], text['offset'] + text['size'] - 15, 8):
            if image.b[pc] != 0x18 or struct.unpack_from('<I', image.b, pc + 8)[0] != 0:
                continue
            addr = struct.unpack_from('<I', image.b, pc + 4)[0] | struct.unpack_from('<I', image.b, pc + 12)[0] << 32
            if base <= addr < base + 48:
                references.append([pc, addr])
        assert references == [[site, base]]
        assert image.rel[site]['type'] == 8 and image.rel[site]['symbol_index'] == 0
        rows.append({'record_address': base, 'direct_loads': references,
                     'uncredited_hex': [image.b[at+a:at+b].hex() for a, b in RESIDUAL]})
    assert rows[0]['uncredited_hex'] == rows[1]['uncredited_hex']
    return {'rows': rows, 'already_proved': previous['intervals'],
            'uncredited_intervals': [[720328+a, 720328+b] for a,b in RESIDUAL],
            'new_bytes': 0, 'new_intervals': []}

def check(root):
    files = {str(p.relative_to(P)): digest(p) for p in sorted(P.rglob('*')) if p.is_file() and p.name != 'manifest.json'}
    assert files == json.loads((P / 'manifest.json').read_text())
    for name, value in json.loads((P / 'inputs.json').read_text()).items():
        assert digest(root / name) == value
    report = inspect(root)
    assert report == json.loads((P / 'observations.json').read_text())
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    args = parser.parse_args()
    print(json.dumps(check(args.repo.resolve()), ensure_ascii=False))
