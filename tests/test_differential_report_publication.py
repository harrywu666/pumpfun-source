"""Differential CLIs must not publish their report over an input.

These three runners wrote their receipt with a plain ``write_text``/``write_bytes``
to whatever ``--output`` named, so ``--output`` pointing at the captured original,
the candidate or the IDL replaced that input and still exited 0. They now use the
shared ``PumpReport`` publisher, which refuses an aliasing destination and stages
the bytes before replacing a prior report.

Every file here is an independent test-owned copy: a regressed CLI can destroy
only the temporary copy, never a captured repository input.
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

# script -> (captured original, IDL) it consumes
SCRIPTS = {
    'pump_migrate_differential.py': (
        'evidence/original/pump/deployed.so', 'evidence/upstream/pump.json'),
    'pump_holder_distribution_differential.py': (
        'evidence/original/pump/deployed.so', 'evidence/upstream/pump.json'),
    'pump_amm_create_differential.py': (
        'evidence/original/pump_amm/deployed.so', 'evidence/upstream/pump_amm.json'),
}
EVIDENCE = (
    'evidence/original/pump/deployed.so',
    'evidence/upstream/pump.json',
    'evidence/original/pump_amm/deployed.so',
    'evidence/upstream/pump_amm.json',
    'research/imported-lab/analysis/pump_fun/config-snapshot.json',
    'research/imported-lab/analysis/pump_fun/curve-migrate-v2-signed-surfpool.json',
    'research/imported-lab/analysis/pump_fun/amm-v2-trade-fixture.json',
    'evidence/dependencies/spl_token/deployed.so',
    'evidence/dependencies/spl_token_2022/deployed.so',
    'evidence/dependencies/associated_token/deployed.so',
)
BOUNDED_RUN = r'''
import sys
sys.path.insert(0, sys.argv.pop(1))
name = sys.argv.pop(1)
m = __import__(name)
m.cases = m.cases[:1]
m.main()
'''


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class DifferentialReportPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='differential-report-')
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

    def run_cli(self, script, output):
        return subprocess.run(
            [sys.executable, '-B', str(self.root / 'scripts' / script),
             '--candidate', str(self.candidate), '--output', str(output)],
            cwd=self.root, capture_output=True, text=True, timeout=120)

    def test_report_cannot_replace_the_captured_original_the_idl_or_the_candidate(self):
        for script, (original, idl) in SCRIPTS.items():
            for target in (original, idl):
                with self.subTest(script=script, input=target):
                    path = self.root / target
                    before = sha(path)
                    result = self.run_cli(script, path)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn('report output aliases an input', result.stderr)
                    self.assertEqual(sha(path), before)
            with self.subTest(script=script, input='candidate'):
                before = sha(self.candidate)
                result = self.run_cli(script, self.candidate)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn('report output aliases an input', result.stderr)
                self.assertEqual(sha(self.candidate), before)
                self.assertEqual(list(self.candidate.parent.glob('.candidate.so.*')), [])

    def test_bounded_run_still_publishes_a_complete_receipt(self):
        for script in ('pump_migrate_differential.py',
                       'pump_holder_distribution_differential.py'):
            with self.subTest(script=script):
                output = self.root / 'reports' / script / 'report.json'
                result = subprocess.run(
                    [sys.executable, '-B', '-c', BOUNDED_RUN, str(self.root / 'scripts'),
                     script[:-3], '--candidate', str(self.candidate), '--output', str(output)],
                    cwd=self.root, capture_output=True, text=True, timeout=180)
                self.assertEqual(result.returncode, 0, result.stderr)
                receipt = json.loads(output.read_text(encoding='utf-8'))
                self.assertEqual(receipt['case_count'], 1)
                self.assertEqual(receipt['mismatches'], [])
                self.assertEqual(list(output.parent.glob('.report.json.*')), [])


if __name__ == '__main__':
    unittest.main()
