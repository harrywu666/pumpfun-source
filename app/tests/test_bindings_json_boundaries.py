import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "verify_bindings_json_boundaries", ROOT / "scripts/verify-bindings.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load binding verifier")
verify_bindings = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_bindings)


class BindingJsonBoundaryTests(unittest.TestCase):
    def test_duplicate_evidence_fields_fail_closed(self):
        bindings = json.loads(
            (ROOT / "contracts/developer-bindings.json").read_text(encoding="utf-8")
        )
        entries = bindings["bindings"] + bindings["observedNotDeclared"]
        inputs = {
            "contracts/developer.openapi.json",
            "contracts/internal-operations.json",
            "contracts/developer-bindings.json",
            "contracts/coverage.json",
            "evidence/web/manifest.json",
        }
        for entry in entries:
            inputs.add(entry["evidence"]["contract"]["source"])
            inputs.update(
                site["source"] for site in entry["evidence"]["clientCallSites"]
            )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in sorted(inputs):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / relative, target)

            coverage = root / "contracts/coverage.json"
            text = coverage.read_text(encoding="utf-8")
            field = '    "implementedNatively": 0,\n'
            self.assertIn(field, text)
            coverage.write_text(
                text.replace(
                    field,
                    '    "implementedNatively": 1,\n' + field,
                    1,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ValueError, "Duplicate JSON key: implementedNatively"
            ):
                verify_bindings.verify(root=root)


if __name__ == "__main__":
    unittest.main()
