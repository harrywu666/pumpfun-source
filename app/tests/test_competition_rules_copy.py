import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("rules_copy", ROOT / "scripts/extract-competition-rules-copy.py")
COPY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COPY)


class RulesCopy(unittest.TestCase):
    def test_cli_round_trip_without_utf8_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for file in ['evidence/web/manifest.json', COPY.SOURCE]:
                destination = root / file
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / file, destination)
            (root / COPY.OUTPUT).parent.mkdir(parents=True)
            command = [sys.executable, '-X', 'utf8=0', str(ROOT / 'scripts/extract-competition-rules-copy.py'), '--root', str(root)]
            environment = dict(os.environ, PYTHONUTF8='0')
            subprocess.run(command, check=True, env=environment, capture_output=True)
            self.assertEqual((root / COPY.OUTPUT).read_bytes(), COPY.generate(ROOT).encode('utf-8'))
            subprocess.run(command + ['--check'], check=True, env=environment, capture_output=True)

    def test_write_rejects_symlinked_output_and_preserves_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for file in ['evidence/web/manifest.json', COPY.SOURCE]:
                destination = root / file
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / file, destination)
            output = root / COPY.OUTPUT
            output.parent.mkdir(parents=True)
            target = root / 'outside-output'
            target.write_text('preserve me', encoding='utf-8')
            output.symlink_to(target)
            command = [sys.executable, str(ROOT / 'scripts/extract-competition-rules-copy.py'), '--root', str(root)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('symlink', result.stderr.lower())
            self.assertEqual(target.read_text(encoding='utf-8'), 'preserve me')

    def test_write_rejects_symlinked_output_ancestor_and_preserves_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for file in ['evidence/web/manifest.json', COPY.SOURCE]:
                destination = root / file
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / file, destination)
            output = root / COPY.OUTPUT
            output.parent.parent.mkdir(parents=True)
            outside = root / 'outside-directory'
            outside.mkdir()
            output.parent.symlink_to(outside, target_is_directory=True)
            target = outside / output.name
            target.write_text('preserve me', encoding='utf-8')
            command = [sys.executable, str(ROOT / 'scripts/extract-competition-rules-copy.py'), '--root', str(root)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('symlink', result.stderr.lower())
            self.assertEqual(target.read_text(encoding='utf-8'), 'preserve me')

    def test_authenticated_output_matches(self):
        self.assertEqual(COPY.generate(ROOT), (ROOT / COPY.OUTPUT).read_text(encoding='utf-8'))

    def test_selects_web_namespace_not_conflicting_mobile_copy(self):
        labels = COPY.extract((ROOT / COPY.SOURCE).read_text(encoding='utf-8'))
        self.assertEqual(len(labels), 32)
        self.assertIn("registration closes", labels["rule_join_solo"])
        self.assertIn("every position you hold at the start", labels["scoring_default"])
        self.assertEqual(labels["close"], "Close")

    def test_rejects_incomplete_or_duplicate_locale_records(self):
        row = {"locale": "en", "resources": {}}
        def script(value):
            return "<script>self.__next_f.push(" + json.dumps([1, value]) + ")</script>"
        with self.assertRaises(ValueError):
            COPY.extract(script("c1:" + json.dumps(row) + "\n"))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            COPY.extract(script("c1:" + json.dumps(row) + "\nc1:" + json.dumps(row) + "\n"))

    def test_rejects_non_json_flight_without_execution(self):
        with self.assertRaises(json.JSONDecodeError):
            COPY.extract('<script>self.__next_f.push([1, globalThis.neverExecute()])</script>')


if __name__ == "__main__":
    unittest.main()
