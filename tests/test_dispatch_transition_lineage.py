#!/usr/bin/env python3
"""The dispatch transition record must follow the asset through its successors."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

REPO = Path(__file__).resolve().parents[1]
PACKET = REPO / 'research/dispatch-evidence-root'
ASSET = 'scripts/recover_dispatch.py'


def load_verifier():
    spec = importlib.util.spec_from_file_location('dispatch_transition', PACKET / 'verify.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(data):
    return hashlib.sha256(data).hexdigest()


CURRENT = b'return {n: recover(n, root) for n in program_names(root)}\n'

RECORD = {
    'baseRevision': 'a' * 40,
    'asset': {
        'path': ASSET,
        'beforeSha256': sha(b'before'),
        'afterSha256': sha(b'landed'),
        'landedIn': 'b' * 40,
        'successors': [
            {'commit': 'c' * 40, 'sha256': sha(b'successor one')},
            {'commit': 'd' * 40, 'sha256': sha(CURRENT)},
        ],
    },
}


def blobs(record):
    return {
        (record['baseRevision'], ASSET): b'before',
        (record['asset']['landedIn'], ASSET): b'landed',
        (record['asset']['successors'][0]['commit'], ASSET): b'successor one',
        (record['asset']['successors'][1]['commit'], ASSET): CURRENT,
    }


class LineageTests(unittest.TestCase):
    def setUp(self):
        self.verifier = load_verifier()

    def run_check(self, record, current=CURRENT, memberships=None):
        table = blobs(record)
        members = {record['baseRevision'], record['asset']['landedIn']}
        members |= {item['commit'] for item in record['asset']['successors']}
        if memberships is not None:
            members = memberships
        return self.verifier.check(record,
                                   lambda commit, path: table[(commit, path)],
                                   lambda commit: commit in members,
                                   current)

    def test_recorded_lineage_passes(self):
        self.assertTrue(self.run_check(copy.deepcopy(RECORD)))

    def test_current_asset_must_equal_the_last_successor(self):
        with self.assertRaises(SystemExit) as caught:
            self.run_check(copy.deepcopy(RECORD), current=b'return 1\n')
        self.assertIn('current script drift', str(caught.exception))

    def test_every_successor_must_be_in_history(self):
        record = copy.deepcopy(RECORD)
        with self.assertRaises(SystemExit) as caught:
            self.run_check(record, memberships={record['baseRevision'],
                                                record['asset']['landedIn'],
                                                record['asset']['successors'][0]['commit']})
        self.assertIn('successor 1 is not in history', str(caught.exception))

    def test_landed_revision_must_carry_the_accepted_change(self):
        record = copy.deepcopy(RECORD)
        record['asset']['afterSha256'] = sha(b'other')
        with self.assertRaises(SystemExit) as caught:
            self.run_check(record)
        self.assertIn('landed script drift', str(caught.exception))

    def test_evidence_root_change_must_survive_the_successors(self):
        record = copy.deepcopy(RECORD)
        without_root = b'return {n: recover(n) for n in program_names()}\n'
        record['asset']['successors'][-1]['sha256'] = sha(without_root)
        table = blobs(record)
        table[(record['asset']['successors'][-1]['commit'], ASSET)] = without_root
        members = {record['baseRevision'], record['asset']['landedIn']}
        members |= {item['commit'] for item in record['asset']['successors']}
        with self.assertRaises(SystemExit) as caught:
            self.verifier.check(record, lambda c, p: table[(c, p)],
                                lambda c: c in members, without_root)
        self.assertIn('accepted evidence-root change is gone', str(caught.exception))

    def test_published_record_matches_this_checkout(self):
        import subprocess
        table = {}

        def show(commit, path):
            key = (commit, path)
            if key not in table:
                table[key] = subprocess.check_output(['git', '-C', str(REPO), 'show',
                                                      f'{commit}:{path}'])
            return table[key]

        def ancestor(commit):
            return subprocess.call(['git', '-C', str(REPO), 'merge-base',
                                    '--is-ancestor', commit, 'HEAD']) == 0

        record = self.verifier.record
        self.assertTrue(self.verifier.check(record, show, ancestor,
                                            (REPO / ASSET).read_bytes()))


if __name__ == '__main__':
    unittest.main()
