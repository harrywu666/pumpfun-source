#!/usr/bin/env python3
"""Unit tests for the packet invocation census."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import census
import inventory


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Workspace:
    def __init__(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)

    def packet(self, name: str, verify: str | None = None) -> Path:
        directory = self.root / 'research' / name
        directory.mkdir(parents=True)
        if verify is not None:
            (directory / 'verify.py').write_text(verify, encoding='utf-8')
        return directory

    def close(self):
        self._temp.cleanup()


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.workspace = Workspace()
        self.addCleanup(self.workspace.close)

    def test_hidden_and_plain_files_are_not_packets(self):
        self.workspace.packet('alpha')
        self.workspace.packet('.hidden')
        (self.workspace.root / 'research' / 'notes.txt').write_text('x')
        packets = census.discover_packets(self.workspace.root / 'research')
        self.assertEqual([packet.name for packet in packets], ['alpha'])


class ContractTests(unittest.TestCase):
    def test_required_option_is_reported_sorted(self):
        contract = census.required_options(
            "import argparse\n"
            "p = argparse.ArgumentParser()\n"
            "p.add_argument('--root', required=True)\n"
            "p.add_argument('--images', required=True)\n")
        self.assertEqual(contract.required, ('--images', '--root'))
        self.assertIsNone(contract.error)

    def test_optional_and_positional_arguments_are_not_required(self):
        contract = census.required_options(
            "p.add_argument('--root')\n"
            "p.add_argument('inputs')\n"
            "p.add_argument('--x', required=False)\n")
        self.assertEqual(contract.required, ())

    def test_computed_requirement_is_unknown_not_guessed(self):
        contract = census.required_options(
            "p.add_argument('--images', required=not os.environ.get('X'))\n")
        self.assertEqual(contract.required, ())
        self.assertEqual(contract.error, 'required condition is computed')

    def test_unparsable_verifier_is_reported(self):
        contract = census.required_options("def broken(:\n")
        self.assertTrue(contract.error.startswith('syntax error:'))


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.workspace = Workspace()
        self.addCleanup(self.workspace.close)

    def write_report(self, directory: Path, payload: dict, gz: bool = False):
        runtime = directory / 'runtime'
        runtime.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(payload).encode()
        name = 'report.json.gz' if gz else 'report.json'
        (runtime / name).write_bytes(gzip.compress(raw) if gz else raw)

    def test_images_schema_is_read(self):
        directory = self.workspace.packet('one')
        self.write_report(directory, {'images': {'original': sha(b'a'),
                                                 'candidate': sha(b'b')}})
        hashes, recorded = census.image_hashes(
            census.Packet('one', directory))
        self.assertTrue(recorded)
        self.assertEqual(hashes, {'original': sha(b'a'), 'candidate': sha(b'b')})

    def test_image_sha256_schema_inside_gzip_is_read(self):
        directory = self.workspace.packet('two')
        self.write_report(directory, {'image_sha256': {'original': sha(b'a')}},
                          gz=True)
        hashes, recorded = census.image_hashes(
            census.Packet('two', directory))
        self.assertTrue(recorded)
        self.assertEqual(hashes, {'original': sha(b'a')})

    def test_report_without_hashes_is_not_recorded(self):
        directory = self.workspace.packet('three')
        self.write_report(directory, {'cases': []})
        hashes, recorded = census.image_hashes(
            census.Packet('three', directory))
        self.assertEqual((hashes, recorded), ({}, False))

    def test_index_matches_plain_and_gzip_images(self):
        artifacts = self.workspace.root / 'evidence'
        artifacts.mkdir()
        (artifacts / 'deployed.so').write_bytes(b'original')
        (artifacts / 'candidate.so.gz').write_bytes(gzip.compress(b'candidate'))
        index = census.index_images(self.workspace.root)
        self.assertEqual(index[sha(b'original')], ['evidence/deployed.so'])
        self.assertEqual(index[sha(b'candidate')], ['evidence/candidate.so.gz'])

    def test_resolution_reports_missing_roles(self):
        resolved = census.resolve_images(
            {'original': sha(b'original'), 'candidate': sha(b'gone')},
            {sha(b'original'): ['evidence/deployed.so']})
        self.assertEqual(resolved, {'candidate': None,
                                    'original': 'evidence/deployed.so'})


class SummaryTests(unittest.TestCase):
    def test_summary_separates_missing_verifiers_and_arguments(self):
        records = [
            {'has_verify': True, 'required': ['--images'],
             'records_image_hashes': True,
             'images': {'candidate': None, 'original': 'evidence/x.so'}},
            {'has_verify': True, 'required': [], 'records_image_hashes': False,
             'images': {}},
            {'has_verify': False, 'required': [], 'records_image_hashes': False,
             'images': {}},
        ]
        summary = inventory.summarise(records)
        self.assertEqual(summary['total_packets'], 3)
        self.assertEqual(summary['packets_without_verify'], 1)
        self.assertEqual(summary['packets_requiring_arguments'], 1)
        self.assertEqual(summary['required_options'], {'--images': 1})
        self.assertEqual(summary['image_resolution'], {'partial': 1})

    def test_no_hashes_and_no_resolution_are_distinct(self):
        summary = inventory.summarise([
            {'has_verify': True, 'required': ['--images'],
             'records_image_hashes': False, 'images': {}},
            {'has_verify': True, 'required': ['--images'],
             'records_image_hashes': True, 'images': {}},
        ])
        self.assertEqual(summary['image_resolution'],
                         {'no-recorded-hashes': 2})
        summary = inventory.summarise([
            {'has_verify': True, 'required': ['--images'],
             'records_image_hashes': True,
             'images': {'original': None, 'candidate': None}},
            {'has_verify': True, 'required': ['--images'],
             'records_image_hashes': True, 'images': {}},
        ])
        self.assertEqual(summary['image_resolution'],
                         {'no-recorded-hashes': 1, 'none': 1})


if __name__ == '__main__':
    unittest.main()
