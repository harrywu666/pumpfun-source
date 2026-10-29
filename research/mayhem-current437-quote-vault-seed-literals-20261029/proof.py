"""Count three quote-vault seed-name literals and their pointer/length sites.

The original literals are contiguous (`mayhem_quote_vault`, `pool-v2`,
`associated_bonding_curve`) and the candidate stores them in a different
arrangement. Every pointer-matching type-8 site either passes the literal to a
call as `lddw r3` + `mov64 r4, length` + `call`, or stores the pointer to a
stack seed field with `stxb [r10+off]` and then stores the exact length to the
adjacent eight-byte field with `stb [r10+off+8], length`. The immediate length,
not adjacency, is the bound. Only static bytes are read. The merged baseline is
recomputed as a union from path + SHA-256 of the sealed deltas; it is never
summed or frozen.
"""
from pathlib import Path
import gzip
import hashlib
import json
import os
import struct
import sys
import tempfile

if not __debug__:
    raise RuntimeError('Assertions are required')

P = Path(__file__).resolve().parent
REPO = next(
    parent for parent in P.parents
    if (parent / 'evidence/original/mayhem/deployed.so').is_file()
)
ORIGINAL = 'evidence/original/mayhem/deployed.so'
CANDIDATE = 'research/mayhem-current437-composition-20261028/builds/first/candidate.so.gz'
BASELINE = 'baseline/sources.json'
sha = lambda data: hashlib.sha256(data).hexdigest()

LITERALS = (
    dict(name='mayhem_quote_vault', text=b'mayhem_quote_vault',
         original=0xaddc4, candidate=0xa8f01, sites=6),
    dict(name='pool-v2', text=b'pool-v2',
         original=0xaddd6, candidate=0xa8f13, sites=2),
    dict(name='associated_bonding_curve', text=b'associated_bonding_curve',
         original=0xadddd, candidate=0xa8b90, sites=9),
)

sys.path.insert(0, str(REPO / 'scripts'))
from window_elf_reader import Elf  # noqa: E402


def union(intervals):
    out = []
    for start, end in sorted(map(tuple, intervals)):
        assert 0 <= start < end
        if out and start <= out[-1][1]:
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return out


def measure(intervals):
    return sum(end - start for start, end in intervals)


def section(image, name, address, size):
    item = image.secs[name]
    assert item[3] <= address and address + size <= item[3] + item[5]
    return item


def read(image, name, address, size):
    item = section(image, name, address, size)
    start = item[4] + address - item[3]
    return image.b[start:start + size]


def decode(image, address):
    raw = image.b[address:address + 8]
    assert len(raw) == 8
    opcode = raw[0]
    registers = raw[1]
    return dict(
        address=address,
        opcode=opcode,
        dst=registers & 0xf,
        src=registers >> 4,
        off=struct.unpack_from('<h', raw, 2)[0],
        imm=struct.unpack_from('<i', raw, 4)[0],
        size=16 if opcode == 0x18 else 8,
    )


def lddw_pointer(image, address):
    raw = image.b[address:address + 16]
    assert len(raw) == 16 and raw[0] == 0x18
    low = struct.unpack_from('<I', raw, 4)[0]
    high = struct.unpack_from('<I', raw, 12)[0]
    return low | (high << 32)


def text_relocations(image):
    item = image.secs.get('.rel.dyn')
    assert item is not None
    text = image.secs['.text']
    for position in range(item[4], item[4] + item[5], 16):
        at, info = struct.unpack_from('<QQ', image.b, position)
        if text[3] <= at < text[3] + text[5]:
            yield at, info & 0xffffffff, info >> 32


def site_shape(image, address, length):
    first = decode(image, address + 16)
    if first['opcode'] == 0xb7:
        assert first['dst'] == 4, 'length is not written to r4'
        assert first['imm'] == length, 'argument length differs'
        return 'argument'
    assert first['opcode'] == 0x7b, 'pointer is not stored'
    assert first['dst'] == 10, 'pointer store is not stack-relative'
    pointer = decode(image, address)
    assert first['src'] == pointer['dst'], 'stored pointer register differs'
    offset = first['off']
    position = address + 32
    for _ in range(12):
        item = decode(image, position)
        if item['opcode'] in (0x72, 0x7a) and item['dst'] == 10 and item['off'] == offset + 8:
            assert item['imm'] == length, 'stack length differs'
            return 'stack'
        position += item['size']
    raise AssertionError('no adjacent stack length store')


def sites(image, pointer, length):
    found = []
    for at, kind, symbol in text_relocations(image):
        if kind != 8 or symbol != 0:
            continue
        if lddw_pointer(image, at) != pointer:
            continue
        found.append(dict(address=at, shape=site_shape(image, at, length)))
    return tuple(sorted(found, key=lambda row: row['address']))


def literal_row(image, row, pointer_key):
    pointer = row[pointer_key]
    length = len(row['text'])
    return dict(
        name=row['name'],
        pointer=pointer,
        length=length,
        text=row['text'].decode(),
        hex=read(image, '.rodata', pointer, length).hex(),
        sites=list(sites(image, pointer, length)),
    )


def verify_images(original, candidate):
    rows = []
    total = 0
    for row in LITERALS:
        old = literal_row(original, row, 'original')
        new = literal_row(candidate, row, 'candidate')
        assert old['hex'] == new['hex'] == row['text'].hex()
        assert old['length'] == new['length'] == len(row['text'])
        assert len(old['sites']) == len(new['sites']) == row['sites'], (row['name'], old['sites'], new['sites'])
        rows.append(dict(
            name=row['name'],
            length=len(row['text']),
            original=old,
            candidate=new,
        ))
        total += len(row['text'])
    return dict(
        summary=dict(
            literals=len(LITERALS),
            literal_bytes=total,
            argument_sites=sum(1 for row in rows for site in row['original']['sites'] if site['shape'] == 'argument'),
            stack_sites=sum(1 for row in rows for site in row['original']['sites'] if site['shape'] == 'stack'),
            argument_sites_candidate=sum(1 for row in rows for site in row['candidate']['sites'] if site['shape'] == 'argument'),
            stack_sites_candidate=sum(1 for row in rows for site in row['candidate']['sites'] if site['shape'] == 'stack'),
            new_payload_bytes=total,
        ),
        literals=rows,
        scope='Three quote-vault seed-name literals and their relocated pointer + immediate length sites (call arguments or adjacent stack seed fields); no callee, PDA derivation or runtime behavior is claimed.',
    )


def inspect():
    original = Elf(REPO / ORIGINAL)
    candidate = elf_from_gzip(REPO / CANDIDATE)
    return verify_images(original, candidate)


def elf_from_gzip(path):
    temporary = tempfile.NamedTemporaryFile(delete=False, suffix='.so')
    try:
        temporary.write(gzip.decompress(path.read_bytes()))
        temporary.close()
        return Elf(Path(temporary.name))
    finally:
        try:
            os.unlink(temporary.name)
        except FileNotFoundError:
            pass


def baseline_union(packet=P):
    sources = json.loads((packet / BASELINE).read_bytes())
    sections = {}
    for section_name, total in (('.rodata', 18396), ('.data.rel.ro', 7784)):
        raw = []
        mapped = []
        covered = []
        for path, digest in sources['deltas'].items():
            data = (REPO / path).read_bytes()
            assert sha(data) == digest, path
            delta = json.loads(data)
            item = next(row for row in delta['sections'] if row['section'] == section_name)
            raw.extend(item['raw_intervals'])
            mapped.extend(item['mapped_intervals'])
            covered.extend(item['covered_intervals'])
        raw = union(raw)
        mapped = union(mapped)
        covered = union(covered)
        assert union(raw + mapped) == covered, section_name
        assert all(0 <= start < end for start, end in covered)
        sections[section_name] = dict(
            section=section_name,
            total_bytes=total,
            raw_intervals=raw,
            mapped_intervals=mapped,
            covered_intervals=covered,
            raw_equal_bytes=measure(raw),
            pointer_only_bytes=measure(covered) - measure(raw),
            covered_bytes=measure(covered),
        )
    assert sum(item['covered_bytes'] for item in sections.values()) == sources['payload_covered_bytes']
    assert sum(item['total_bytes'] for item in sections.values()) == sources['payload_total_bytes']
    return sections


def coverage(report, packet=P):
    sources = json.loads((packet / BASELINE).read_bytes())
    sections = []
    total_new = sum(len(row['text']) for row in LITERALS)
    for name, old in baseline_union(packet).items():
        raw = list(old['raw_intervals'])
        mapped = list(old['mapped_intervals'])
        if name == '.rodata':
            for row in LITERALS:
                raw.append([row['original'], row['original'] + len(row['text'])])
        elif name == '.data.rel.ro':
            pass
        else:
            raise AssertionError(name)
        raw = union(raw)
        mapped = union(mapped)
        covered = union(raw + mapped)
        sections.append(dict(
            section=name,
            total_bytes=old['total_bytes'],
            raw_intervals=raw,
            mapped_intervals=mapped,
            covered_intervals=covered,
            raw_equal_bytes=measure(raw),
            pointer_only_bytes=measure(covered) - measure(raw),
            covered_bytes=measure(covered),
            new_bytes=measure(covered) - old['covered_bytes'],
        ))
    by_name = {item['section']: item for item in sections}
    assert by_name['.rodata']['new_bytes'] == total_new
    assert by_name['.data.rel.ro']['new_bytes'] == 0
    total = sum(item['covered_bytes'] for item in sections)
    assert total == sources['payload_covered_bytes'] + total_new
    return dict(
        scope='Three observed quote-vault seed-name literals and their pointer + immediate-length call/stack sites; no callee, PDA derivation or runtime behavior is claimed.',
        baseline_commit=sources['baseline_commit'],
        baseline_deltas=sources['deltas'],
        baseline_payload_bytes=sources['payload_covered_bytes'],
        baseline_rodata_bytes=by_name['.rodata']['covered_bytes'] - total_new,
        baseline_data_rel_ro_bytes=by_name['.data.rel.ro']['covered_bytes'],
        sections=sections,
        new_payload_bytes=sum(item['new_bytes'] for item in sections),
        new_rodata_bytes=by_name['.rodata']['new_bytes'],
        new_data_rel_ro_bytes=by_name['.data.rel.ro']['new_bytes'],
        payload_covered_bytes=total,
        payload_total_bytes=sum(item['total_bytes'] for item in sections),
    )


def check(packet=P, root=REPO):
    paths = list(packet.rglob('*'))
    assert not any(path.is_symlink() for path in paths), 'packet symlink'
    assert all(path.is_file() or path.is_dir() for path in paths), 'packet special file'
    found = {
        str(path.relative_to(packet)): sha(path.read_bytes())
        for path in paths
        if path.is_file()
        and path.name != 'manifest.json'
        and '__pycache__' not in path.parts
        and path.suffix != '.pyc'
    }
    assert found == json.loads((packet / 'manifest.json').read_bytes()), 'packet inventory differs'
    pins = json.loads((packet / 'inputs.json').read_bytes())
    for path, digest in pins.items():
        relative = Path(path)
        assert not relative.is_absolute() and '..' not in relative.parts
        assert sha((root / relative).read_bytes()) == digest, path
    report = inspect()
    assert report == json.loads(gzip.decompress((packet / 'observations.json.gz').read_bytes())), 'fresh observations differ'
    delta = coverage(report, packet)
    assert delta == json.loads((packet / 'coverage-delta.json').read_bytes()), 'coverage delta differs'
    summary = report['summary']
    assert (summary['literals'], summary['literal_bytes'], summary['argument_sites'],
            summary['stack_sites'], summary['argument_sites_candidate'],
            summary['stack_sites_candidate'], summary['new_payload_bytes']) == (3, 49, 15, 2, 15, 2, 49)
    assert delta['new_payload_bytes'] == 49
    assert delta['new_rodata_bytes'] == 49
    assert delta['new_data_rel_ro_bytes'] == 0
    assert delta['baseline_payload_bytes'] + 49 == delta['payload_covered_bytes']
    by_name = {item['section']: item for item in delta['sections']}
    assert by_name['.rodata']['new_bytes'] == 49
    assert by_name['.data.rel.ro']['new_bytes'] == 0
    expected = {row['name']: row for row in LITERALS}
    for row in report['literals']:
        spec = expected[row['name']]
        assert row['length'] == len(spec['text'])
        assert row['original']['text'] == row['candidate']['text'] == spec['text'].decode()
        assert row['original']['pointer'] == spec['original']
        assert row['candidate']['pointer'] == spec['candidate']
        assert len(row['original']['sites']) == len(row['candidate']['sites']) == spec['sites']
    return summary


def seal(packet=P, root=REPO):
    packet = Path(packet)
    report = inspect()
    (packet / 'observations.json.gz').write_bytes(
        gzip.compress(json.dumps(report, separators=(',', ':')).encode(), mtime=0)
    )
    (packet / 'coverage-delta.json').write_text(
        json.dumps(coverage(report), indent=2) + '\n'
    )
    inventory = {
        str(path.relative_to(packet)): sha(path.read_bytes())
        for path in sorted(packet.rglob('*'))
        if path.is_file()
        and path.name != 'manifest.json'
        and '__pycache__' not in path.parts
        and path.suffix != '.pyc'
    }
    (packet / 'manifest.json').write_text(json.dumps(inventory, indent=2) + '\n')
    return report['summary']


if __name__ == '__main__':
    print(json.dumps(seal(), indent=2))
