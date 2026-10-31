"""Regression checks for optimized-Python rejection in the Mayhem burn-sequence verifier.

Sibling of open #2249, which adds the same guard to the five Mayhem trade
receipt verifiers but cannot reach this sixth Mayhem receipt verifier:
scripts/verify_mayhem_burn_sequence.py expresses every acceptance check as
an assert, so under -O (or PYTHONOPTIMIZE=1) the checks vanish and garbage
receipts verify with success True.

The same verifier pairs each manifest family with a comparison case through a
zip, so a normal-Python run must also refuse a manifest whose family list is
empty or whose length disagrees with the comparison.
"""

from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
SCRIPT = "verify_mayhem_burn_sequence.py"


def run_optimized(args):
    return subprocess.run(
        [sys.executable, "-O", str(SCRIPTS / SCRIPT), *args],
        cwd=SCRIPTS.parent,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def run_normal(args):
    environment = dict(os.environ)
    environment.pop("PYTHONOPTIMIZE", None)
    return subprocess.run(
        [sys.executable, "-B", str(SCRIPTS / SCRIPT), *args],
        cwd=SCRIPTS.parent,
        env=environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def write_inputs(root, families, cases, case_count):
    fixtures = root / "fixtures"
    receipts = root / "receipts"
    fixtures.mkdir()
    receipts.mkdir()
    (fixtures / "fixture-manifest.json").write_text(json.dumps({
        "snapshots": {"eligible": {"accounts": {}}},
        "eligible_families": families,
    }), encoding="utf-8")
    (receipts / "comparison.json").write_text(json.dumps({
        "case_count": case_count,
        "signed_transactions": 12,
        "inputs_unchanged": True,
        "mismatches": [],
        "input_sha256": {},
        "runner_sha256": hashlib.sha256(
            (SCRIPTS / "mayhem_burn_sequence.py").read_bytes()).hexdigest(),
        "cases": cases,
    }), encoding="utf-8")
    return fixtures, receipts


class BurnSequenceOptimizationTests(unittest.TestCase):
    def test_optimized_python_is_rejected(self):
        completed = run_optimized(["--help"])
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("Normal Python is required", completed.stderr)

    def test_optimized_python_cannot_verify_garbage_receipts(self):
        with tempfile.TemporaryDirectory(prefix="burn-sequence-opt-") as temporary:
            root = Path(temporary)
            fixtures = root / "fixtures"
            receipts = root / "receipts"
            fixtures.mkdir()
            receipts.mkdir()
            (fixtures / "fixture-manifest.json").write_text(json.dumps({
                "snapshots": {"eligible": {"accounts": {}}},
                "eligible_families": [],
            }))
            (receipts / "comparison.json").write_text(json.dumps({
                "case_count": 999,
                "signed_transactions": 999,
                "inputs_unchanged": False,
                "mismatches": ["bogus"],
                "input_sha256": {},
                "runner_sha256": "deadbeef",
                "cases": [{"original": {"sequential_second": True, "binary_sha256": "x"},
                           "candidate": {"binary_sha256": "y"}}],
            }))
            completed = run_optimized(["--fixtures", str(fixtures), "--receipts", str(receipts)])
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("Normal Python is required", completed.stderr)
            self.assertFalse((receipts / "verification.json").exists())


def unrelated_case():
    """A comparison case that no eligible family pairs with."""
    return {"original": {"sequential_second": {}, "binary_sha256": "not-a-real-elf"},
            "candidate": {"binary_sha256": "not-a-real-elf"}}


class BurnSequenceBindingTests(unittest.TestCase):
    def test_normal_python_rejects_a_manifest_without_families(self):
        with tempfile.TemporaryDirectory(prefix="burn-sequence-empty-") as temporary:
            root = Path(temporary)
            fixtures, receipts = write_inputs(root, [], [unrelated_case()], 3)
            completed = run_normal(["--fixtures", str(fixtures), "--receipts", str(receipts)])
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("no eligible families", completed.stderr)
            self.assertFalse((receipts / "verification.json").exists())

    def test_normal_python_rejects_fewer_cases_than_families(self):
        with tempfile.TemporaryDirectory(prefix="burn-sequence-short-") as temporary:
            root = Path(temporary)
            families = [{"accounts": {}}, {"accounts": {}}, {"accounts": {}}]
            fixtures, receipts = write_inputs(root, families, [unrelated_case()], 3)
            completed = run_normal(["--fixtures", str(fixtures), "--receipts", str(receipts)])
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("do not match the eligible families", completed.stderr)
            self.assertFalse((receipts / "verification.json").exists())


if __name__ == "__main__":
    unittest.main()
