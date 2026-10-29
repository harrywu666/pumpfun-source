"""Count four panic Location records and the path literal for pump_amm_interface.rs.

Each 24-byte `.data.rel.ro` record is an eight-byte relocated pointer field,
an eight-byte immediate length, a `u32` line and a `u32` column. The length
counts the 62-byte path plus one trailing NUL byte; the immediate, not the NUL,
is the bound. Only static bytes are read. The merged baseline is recomputed as
a union from path + SHA-256 of the sealed deltas; it is never summed or frozen.
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

PATH_TEXT = b'programs/mayhem-program/src/instructions/pump_amm_interface.rs'
PATH_BYTES = PATH_TEXT + b'\x00'
PATH_ORIGINAL = 0xacc3c
PATH_CANDIDATE = 0xa7f37
PATH_LENGTH = 63
ROWS = (
    dict(original=0xb1640, line=403, column=23),
    dict(original=0xb1658, line=404, column=26),
    dict(original=0xb1670, line=595, column=23),
    dict(original=0xb1688, line=596, column=26),
)
CANDIDATE_ORDER = ((595, 23), (596, 26), (403, 23), (404, 26))

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


def relocation(image, address):
    item = image.secs.get('.rel.dyn')
    assert item is not None
    for position in range(item[4], item[4] + item[5], 16):
        at, info = struct.unpack_from('<QQ', image.b, position)
        if at == address:
            return dict(type=info & 0xffffffff, symbol_index=info >> 32)
    return None


def record(image, address, pointer):
    raw = read(image, '.data.rel.ro', address, 24)
    low, high, length, line, column = struct.unpack('<IIQII', raw)
    assert low == 0, 'record low word is not zero'
    assert high == pointer, (hex(high), hex(pointer))
    assert length == PATH_LENGTH, length
    assert relocation(image, address) == dict(type=8, symbol_index=0)
    assert relocation(image, address + 8) is None, 'length must be raw'
    assert relocation(image, address + 16) is None, 'line/column must be raw'
    return dict(
        offset=address,
        raw_hex=raw.hex(),
        pointer=high,
        length=length,
        line=line,
        column=column,
    )


def candidate_rows(image):
    found = []
    item = image.secs['.data.rel.ro']
    for address in range(item[3], item[3] + item[5] - 23, 8):
        low, high, length, at_line, at_column = struct.unpack(
            '<IIQII', read(image, '.data.rel.ro', address, 24)
        )
        if (low, high, length) == (0, PATH_CANDIDATE, PATH_LENGTH):
            found.append((address, at_line, at_column))
    return found


def candidate_row(image, line, column):
    found = [row for row in candidate_rows(image) if row[1:] == (line, column)]
    assert len(found) == 1, (line, column, found)
    return found[0][0]


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


def verify_images(original, candidate):
    assert len(PATH_BYTES) == PATH_LENGTH
    assert read(original, '.rodata', PATH_ORIGINAL, PATH_LENGTH) == PATH_BYTES
    assert read(candidate, '.rodata', PATH_CANDIDATE, PATH_LENGTH) == PATH_BYTES
    rows = []
    for row in ROWS:
        old = record(original, row['original'], PATH_ORIGINAL)
        assert (old['line'], old['column']) == (row['line'], row['column'])
        new_address = candidate_row(candidate, row['line'], row['column'])
        new = record(candidate, new_address, PATH_CANDIDATE)
        assert (new['line'], new['column']) == (row['line'], row['column'])
        rows.append(dict(
            original=old,
            candidate=new,
            original_line=row['line'],
            original_column=row['column'],
        ))
    order = tuple((line, column) for _, line, column in candidate_rows(candidate))
    assert order == CANDIDATE_ORDER, order
    return dict(
        summary=dict(
            path_bytes=PATH_LENGTH,
            path_text_bytes=len(PATH_TEXT),
            trailing_nul_bytes=1,
            records=len(ROWS),
            record_bytes=24 * len(ROWS),
            mapped_pointer_bytes=8 * len(ROWS),
            raw_record_bytes=16 * len(ROWS),
            new_payload_bytes=PATH_LENGTH + 24 * len(ROWS),
        ),
        path=dict(
            original_ptr=PATH_ORIGINAL,
            candidate_ptr=PATH_CANDIDATE,
            length=PATH_LENGTH,
            text=PATH_TEXT.decode(),
            original_hex=read(original, '.rodata', PATH_ORIGINAL, PATH_LENGTH).hex(),
            candidate_hex=read(candidate, '.rodata', PATH_CANDIDATE, PATH_LENGTH).hex(),
        ),
        rows=rows,
    )


def inspect():
    original = Elf(REPO / ORIGINAL)
    candidate = elf_from_gzip(REPO / CANDIDATE)
    return verify_images(original, candidate)


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
    for name, old in baseline_union(packet).items():
        raw = list(old['raw_intervals'])
        mapped = list(old['mapped_intervals'])
        if name == '.rodata':
            raw.append([PATH_ORIGINAL, PATH_ORIGINAL + PATH_LENGTH])
        elif name == '.data.rel.ro':
            for row in ROWS:
                mapped.append([row['original'], row['original'] + 8])
                raw.append([row['original'] + 8, row['original'] + 24])
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
    assert by_name['.rodata']['new_bytes'] == PATH_LENGTH
    assert by_name['.data.rel.ro']['new_bytes'] == 24 * len(ROWS)
    total = sum(item['covered_bytes'] for item in sections)
    assert total == sources['payload_covered_bytes'] + PATH_LENGTH + 24 * len(ROWS)
    return dict(
        scope='Four observed 24-byte panic Location records and one 63-byte path literal; no code site, allocation extent or relocation-table byte is claimed.',
        baseline_commit=sources['baseline_commit'],
        baseline_deltas=sources['deltas'],
        baseline_payload_bytes=sources['payload_covered_bytes'],
        baseline_rodata_bytes=by_name['.rodata']['covered_bytes'] - PATH_LENGTH,
        baseline_data_rel_ro_bytes=by_name['.data.rel.ro']['covered_bytes'] - 24 * len(ROWS),
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
    assert (
        summary['path_bytes'], summary['path_text_bytes'], summary['trailing_nul_bytes'],
        summary['records'], summary['record_bytes'], summary['mapped_pointer_bytes'],
        summary['raw_record_bytes'], summary['new_payload_bytes'],
    ) == (63, 62, 1, 4, 96, 32, 64, 159)
    assert delta['new_payload_bytes'] == 159
    assert delta['new_rodata_bytes'] == 63
    assert delta['new_data_rel_ro_bytes'] == 96
    assert delta['baseline_payload_bytes'] + 159 == delta['payload_covered_bytes']
    by_name = {item['section']: item for item in delta['sections']}
    assert by_name['.rodata']['new_bytes'] == 63
    assert by_name['.data.rel.ro']['new_bytes'] == 96
    assert report['path']['text'] == PATH_TEXT.decode()
    assert report['path']['original_hex'] == PATH_BYTES.hex()
    assert report['path']['candidate_hex'] == PATH_BYTES.hex()
    for row in report['rows']:
        assert row['original']['pointer'] == PATH_ORIGINAL
        assert row['candidate']['pointer'] == PATH_CANDIDATE
        assert row['original']['length'] == 63
        assert row['candidate']['length'] == 63
        assert row['original']['line'] == row['candidate']['line']
        assert row['original']['column'] == row['candidate']['column']
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
