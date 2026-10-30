"""The set-creator differential must not publish its report over an input.

The runner hashed its inputs, re-checked them, and then wrote the receipt with
``write_text`` to whatever ``--output`` named. ``--output`` pointing at the
captured original, the IDL, one of the scripts it imports or the candidate
replaced that input with the report and still exited 0 — the input check ran
first and said nothing about the destination.

The receipt keeps its pinned UTF-8/LF ``write_text`` writer, which
``scripts/test_pump_receipt_encoding.py`` enforces for this file; the shared
``PumpReport`` is constructed for its destination admission and re-checked
just before the write.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = 'pump_set_creator_differential.py'
TARGETS = (
    'evidence/original/pump/deployed.so',
    'evidence/upstream/pump.json',
    'scripts/fees_admin_differential.py',
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


class SetCreatorReportAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='set-creator-report-')
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name) / 'private root'
        shutil.copytree(ROOT / 'scripts', cls.root / 'scripts',
                        ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(ROOT / 'evidence', cls.root / 'evidence')
        shutil.copytree(ROOT / 'research/imported-lab', cls.root / 'research/imported-lab')
        cls.candidate = cls.root / 'candidate.so'
        shutil.copyfile(ROOT / 'evidence/original/pump/deployed.so', cls.candidate)
        cls.pristine = {name: (cls.root / name).read_bytes() for name in TARGETS}

    def restore_inputs(self):
        """Undo a report that a regressed runner published over an input."""
        for name, data in self.pristine.items():
            path = self.root / name
            if path.read_bytes() != data:
                path.write_bytes(data)

    def run_cli(self, output):
        return subprocess.run(
            [sys.executable, '-B', str(self.root / 'scripts' / SCRIPT),
             '--candidate', str(self.candidate), '--output', str(output)],
            cwd=self.root, capture_output=True, text=True, timeout=300)

    def test_report_cannot_replace_an_input(self):
        for target in TARGETS:
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
            before = sha(self.candidate)
            result = self.run_cli(self.candidate)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn('report output aliases an input', result.stderr)
            self.assertEqual(sha(self.candidate), before)

    def test_bounded_run_still_publishes_a_complete_receipt(self):
        output = self.root / 'reports' / 'report.json'
        result = subprocess.run(
            [sys.executable, '-B', '-c', BOUNDED_RUN, str(self.root / 'scripts'),
             SCRIPT[:-3], '--candidate', str(self.candidate), '--output', str(output)],
            cwd=self.root, capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(receipt['case_count'], 1)
        self.assertEqual(receipt['mismatches'], [])


if __name__ == '__main__':
    unittest.main()
