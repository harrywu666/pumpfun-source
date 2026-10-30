"""The create-control differential must not publish its report over an input.

The runner wrote its receipt with a plain ``write_bytes`` to whatever
``--output`` named, so ``--output`` pointing at the captured original, the IDL,
the imported-lab snapshot, a dependency image or the candidate replaced that
input with a gzip report and still exited 0. It now publishes through the
shared ``PumpReport``, which refuses an aliasing destination and stages the
bytes before replacing a prior report.

Every file here is an independent test-owned copy: a regressed runner can
destroy only the temporary copy, never a captured repository input.
"""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = 'pump_create_control_differential.py'
EVIDENCE = (
    'evidence/original/pump/deployed.so',
    'evidence/original/mayhem/deployed.so',
    'evidence/upstream/pump.json',
    'research/imported-lab/analysis/pump_fun/config-snapshot.json',
    'evidence/dependencies/spl_token/deployed.so',
    'evidence/dependencies/spl_token_2022/deployed.so',
    'evidence/dependencies/associated_token/deployed.so',
    'evidence/dependencies/token_metadata/deployed.so',
)
BOUNDED_RUN = r'''
import sys
sys.path.insert(0, sys.argv.pop(1))
name = sys.argv.pop(1)
m = __import__(name)
first = m.cases
m.cases = lambda: first()[:1]
m.main()
'''


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CreateControlReportPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='create-control-report-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name) / 'private root'
        shutil.copytree(ROOT / 'scripts', cls.root / 'scripts',
                        ignore=shutil.ignore_patterns('__pycache__'))
        for name in EVIDENCE:
            destination = cls.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)
        cls.candidate = cls.root / 'candidate.so'
        shutil.copyfile(ROOT / 'evidence/original/pump/deployed.so', cls.candidate)
        cls.pristine = {name: (cls.root / name).read_bytes() for name in EVIDENCE}

    def restore_inputs(self):
        """Undo a report that a regressed runner published over an input.

        Without this, one subtest's overwrite would make every later runner
        fail while loading its fixture, hiding the aliasing behavior itself.
        """
        for name, data in self.pristine.items():
            path = self.root / name
            if path.read_bytes() != data:
                path.write_bytes(data)
        pristine_candidate = self.pristine['evidence/original/pump/deployed.so']
        if self.candidate.read_bytes() != pristine_candidate:
            self.candidate.write_bytes(pristine_candidate)

    def run_cli(self, output):
        return subprocess.run(
            [sys.executable, '-B', str(self.root / 'scripts' / SCRIPT),
             '--candidate', str(self.candidate), '--output', str(output)],
            cwd=self.root, capture_output=True, text=True, timeout=300)

    def test_report_cannot_replace_any_input(self):
        targets = ('evidence/original/pump/deployed.so',
                   'evidence/original/mayhem/deployed.so',
                   'evidence/upstream/pump.json',
                   'research/imported-lab/analysis/pump_fun/config-snapshot.json',
                   'evidence/dependencies/spl_token/deployed.so')
        for target in targets:
            with self.subTest(input=target):
                try:
                    path = self.root / target
                    before = sha(path)
                    result = self.run_cli(path)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn('report output aliases an input', result.stderr)
                    self.assertEqual(sha(path), before)
                finally:
                    self.restore_inputs()
        with self.subTest(input='candidate'):
            try:
                before = sha(self.candidate)
                result = self.run_cli(self.candidate)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn('report output aliases an input', result.stderr)
                self.assertEqual(sha(self.candidate), before)
                self.assertEqual(list(self.candidate.parent.glob('.candidate.so.*')), [])
            finally:
                self.restore_inputs()

    def test_bounded_run_still_publishes_a_complete_receipt(self):
        output = self.root / 'reports' / 'report.json.gz'
        result = subprocess.run(
            [sys.executable, '-B', '-c', BOUNDED_RUN, str(self.root / 'scripts'),
             SCRIPT[:-3], '--candidate', str(self.candidate), '--output', str(output)],
            cwd=self.root, capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(gzip.decompress(output.read_bytes()))
        self.assertEqual(len(receipt['cases']), 1)
        self.assertEqual(receipt['mismatches'], [])
        self.assertEqual(list(output.parent.glob('.report.json.gz.*')), [])


if __name__ == '__main__':
    unittest.main()
