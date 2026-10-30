#!/usr/bin/env python3
"""Measure which packet verifiers the repository-wide audit cannot execute.

  python3 inventory.py --repo . --output census.json --markdown census.md

The frozen revalidator calls every ``verify.py`` with no packet-specific
arguments and reports a non-zero exit as ``fail``. An argparse usage error is
therefore indistinguishable, in its summary, from an evidence mismatch. This
census separates the two and records whether the missing inputs exist in the
repository.

Exit 0 after writing both files. Exit 1 on an unreadable packet directory.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import sys

import census

OPTION_ROLE = {
    '--images': 'images from outside the packet',
    '--repo-root': 'a repository root the revalidator does not pass',
    '--repo': 'a repository root the revalidator does not pass',
}


def tracked_names(root: Path) -> set[str] | None:
    """Top-level ``research/`` directories that contain a tracked file.

    A working tree may retain ignored packet directories from another branch.
    The audit's population is what the branch tracks, so callers can restrict
    discovery to these names.
    """
    files = tracked_files(root)
    if files is None:
        return None
    names = set()
    for path in files:
        parts = path.relative_to(root).parts
        if len(parts) >= 2 and parts[0] == 'research':
            names.add(parts[1])
    return names


def tracked_files(root: Path,
                  suffixes: tuple[str, ...] | None = None) -> list[Path] | None:
    """Every file this branch tracks, optionally limited to suffixes."""
    try:
        listing = subprocess.check_output(
            ['git', '-C', str(root), 'ls-files', '-z'],
            stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        return None
    files = []
    for raw in listing.split(b'\0'):
        if not raw:
            continue
        path = root / Path(raw.decode('utf-8', 'surrogateescape'))
        if suffixes is not None and not path.name.endswith(suffixes):
            continue
        files.append(path)
    return files


def packet_record(packet: census.Packet,
                  index: dict[str, list[str]]) -> dict:
    """Classify one packet from its verifier contract and retained reports."""
    record: dict = {
        'packet': packet.name,
        'has_verify': packet.verify_path.is_file(),
        'required': [],
        'required_error': None,
        'records_image_hashes': False,
        'images': {},
    }
    if not record['has_verify']:
        return record
    try:
        source = packet.verify_path.read_text(encoding='utf-8')
    except OSError as error:
        record['required_error'] = f'unreadable verifier: {error}'
        return record
    contract = census.required_options(source)
    record['required'] = list(contract.required)
    record['required_error'] = contract.error
    hashes, recorded = census.image_hashes(packet)
    record['records_image_hashes'] = recorded
    record['images'] = census.resolve_images(hashes, index)
    return record


def role_summary(image_packets: list[dict]) -> dict:
    """Per-role resolution counts across the packets that require images."""
    roles = sorted({role for record in image_packets for role in record['images']})
    summary = {}
    for role in roles:
        resolved = sum(1 for record in image_packets
                       if record['images'].get(role))
        recorded = sum(1 for record in image_packets if role in record['images'])
        summary[role] = {
            'recorded': recorded,
            'resolved': resolved,
            'unresolved': recorded - resolved,
            'not_recorded': len(image_packets) - recorded,
        }
    return summary


def summarise(records: list[dict]) -> dict:
    required = Counter(option for record in records
                       for option in record['required'])
    image_packets = [record for record in records
                     if '--images' in record['required']]
    resolved_roles = Counter(
        'all' if roles and all(roles.values())
        else 'none' if roles and not any(roles.values())
        else 'partial' if roles else 'no-recorded-hashes'
        for roles in (record['images'] for record in image_packets))
    return {
        'total_packets': len(records),
        'packets_with_verify': sum(record['has_verify'] for record in records),
        'packets_without_verify': sum(not record['has_verify']
                                      for record in records),
        'packets_requiring_arguments': sum(1 for record in records
                                           if record['required']),
        'required_options': dict(sorted(required.items())),
        'packets_requiring_images': len(image_packets),
        'image_packets_recording_hashes': sum(
            record['records_image_hashes'] for record in image_packets),
        'image_resolution': dict(sorted(resolved_roles.items())),
        'image_roles': role_summary(image_packets),
    }


def markdown(summary: dict) -> str:
    lines = [
        '# Packet verifier invocation census',
        '',
        '| Measure | Packets |',
        '| --- | --- |',
        f'| Research packets | {summary["total_packets"]} |',
        f'| With `verify.py` | {summary["packets_with_verify"]} |',
        f'| Without `verify.py` | {summary["packets_without_verify"]} |',
        f'| Requiring a command-line argument | '
        f'{summary["packets_requiring_arguments"]} |',
    ]
    for option, count in summary['required_options'].items():
        lines.append(f'| Requiring `{option}` | {count} |')
    lines += [
        '',
        'Image resolution covers the roles each packet records. `none` means no '
        'role resolved to bytes present in the repository; `partial` means at '
        'least one role did and at least one did not.',
        '',
        '| Image packets | Packets |',
        '| --- | --- |',
    ]
    for key, count in summary['image_resolution'].items():
        lines.append(f'| {key} | {count} |')
    if summary['image_roles']:
        lines += ['', '| Role | Recorded | Resolved | Unresolved | Not recorded |',
                  '| --- | --- | --- | --- | --- |']
        for role, counts in summary['image_roles'].items():
            lines.append(f"| {role} | {counts['recorded']} | {counts['resolved']} "
                         f"| {counts['unresolved']} | {counts['not_recorded']} |")
    return '\n'.join(lines) + '\n'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--markdown', type=Path)
    parser.add_argument('--exhaustive', action='store_true',
                        help='hash every repository file, not only ELF candidates')
    parser.add_argument('--tracked-only', action='store_true',
                        help='ignore packet directories this branch does not track')
    args = parser.parse_args(argv)

    root = args.repo.resolve()
    research = root / 'research'
    if not research.is_dir():
        print(f'no research directory under {root}', file=sys.stderr)
        return 1
    packets = census.discover_packets(research)
    tracked = tracked_names(root) if args.tracked_only else None
    if args.tracked_only:
        if tracked is None:
            print('cannot read the tracked packet list', file=sys.stderr)
            return 1
        packets = [packet for packet in packets if packet.name in tracked]
    # A tracked-only census hashes exactly what the branch ships, so a packet
    # cannot appear resolvable because of an ignored file left in the checkout.
    index_paths = (tracked_files(root, census.IMAGE_NAME_SUFFIXES)
                   if args.tracked_only else None)
    if args.tracked_only and index_paths is None:
        print('cannot read the tracked file list', file=sys.stderr)
        return 1
    index = census.index_images(root, exhaustive=args.exhaustive,
                                paths=index_paths)
    records = [packet_record(packet, index) for packet in packets]
    summary = summarise(records)
    document = {
        'schema': 1,
        'method': {
            'exhaustive_index': args.exhaustive,
            'tracked_only': args.tracked_only,
            'image_suffixes': list(census.IMAGE_SUFFIXES),
            'required_argument_source': 'literal required=True in verify.py',
        },
        'summary': summary,
        'packets': records,
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + '\n',
                           encoding='utf-8')
    if args.markdown:
        args.markdown.write_text(markdown(summary), encoding='utf-8')
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
