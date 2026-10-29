"""Verify the zero-byte result for .rodata [713442, 713704)."""
from pathlib import Path
import argparse
import hashlib
import json
import reference_trace as ref

if not __debug__:
    raise RuntimeError('must run with assertions enabled')

P = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(packet):
    return {
        str(path.relative_to(packet)): digest(path)
        for path in sorted(packet.rglob('*'))
        if path.is_file() and path.name != 'manifest.json'
    }


def check(root):
    root = Path(root)
    assert inventory(P) == json.loads((P / 'manifest.json').read_text())
    for name, value in json.loads((P / 'inputs.json').read_text()).items():
        assert digest(root / name) == value, name
    report = ref.inspect(root)
    assert report == json.loads((P / 'observations.json').read_text())
    assert report['new_bytes'] == 0
    assert report['new_intervals'] == []
    assert report['still_open'] == [[ref.LO, ref.HI]]
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    args = parser.parse_args()
    print(json.dumps(check(args.repo.resolve()), ensure_ascii=False))
