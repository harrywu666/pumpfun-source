"""The v3 differentials must not publish their report over an input.

Both v3 runners wrote their receipt with a plain ``write_bytes`` to whatever
``--output`` named, so ``--output`` pointing at the captured original, the IDL,
the shared trade fixture or the candidate replaced that input with the report
and still exited 0. Every other runner that imports ``pump_trade_fixture``
already publishes through ``PumpReport`` with its ``REPORT_INPUTS``; these two
were the last pump-family omissions.

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
SCRIPTS = ('pump_v3_configured_fee_differential.py',
           'pump_v3_token_extensions_differential.py')
TARGETS = (
    'evidence/original/pump/deployed.so',
    'evidence/upstream/pump.json',
    'research/imported-lab/analysis/pump_fun/curve-fresh-trades-v3-signed-surfpool.json',
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


class V3ReportPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='v3-report-')
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

    def run_cli(self, script, output):
        return subprocess.run(
            [sys.executable, '-B', str(self.root / 'scripts' / script),
             '--candidate', str(self.candidate), '--output', str(output)],
            cwd=self.root, capture_output=True, text=True, timeout=300)

    def test_report_cannot_replace_an_input(self):
        for script in SCRIPTS:
            for target in TARGETS:
                with self.subTest(script=script, input=target):
                    try:
                        path = self.root / target
                        before = sha(path)
                        result = self.run_cli(script, path)
                        self.assertNotEqual(result.returncode, 0, result.stdout)
                        self.assertIn('report output aliases an input', result.stderr)
                        self.assertEqual(sha(path), before)
                    finally:
                        self.restore_inputs()
            with self.subTest(script=script, input='candidate'):
                before = sha(self.candidate)
                result = self.run_cli(script, self.candidate)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn('report output aliases an input', result.stderr)
                self.assertEqual(sha(self.candidate), before)

    def test_bounded_run_still_publishes_a_complete_receipt(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                output = self.root / 'reports' / script / 'report.json.gz'
                result = subprocess.run(
                    [sys.executable, '-B', '-c', BOUNDED_RUN, str(self.root / 'scripts'),
                     script[:-3], '--candidate', str(self.candidate), '--output', str(output)],
                    cwd=self.root, capture_output=True, text=True, timeout=300)
                self.assertEqual(result.returncode, 0, result.stderr)
                receipt = json.loads(gzip.decompress(output.read_bytes()))
                self.assertEqual(receipt['case_count'], 1)
                self.assertEqual(receipt['mismatches'], [])
                self.assertEqual(list(output.parent.glob('.report.json.gz.*')), [])


if __name__ == '__main__':
    unittest.main()
