import hashlib
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock


APP_ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = APP_ROOT / "scripts/extract-reference-pages.py"
SPEC = importlib.util.spec_from_file_location("extract_reference_pages", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load reference-page extractor")
extractor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = extractor
SPEC.loader.exec_module(extractor)


def synthetic_source(html: bytes, title: str, counts: dict[str, int]):
    return {
        "route": "/synthetic",
        "url": "https://pump.fun/synthetic",
        "title": title,
        "path": "synthetic",
        "bytes": len(html),
        "sha256": hashlib.sha256(html).hexdigest(),
        "counts": counts,
    }


class ReferencePageExtractionTests(unittest.TestCase):
    def test_generated_artifact_is_exactly_reproducible(self):
        expected = extractor.OUTPUT_PATH.read_text(encoding="utf-8")
        self.assertEqual(extractor.generate(), expected)

    def test_inline_labels_keep_their_separating_space(self):
        html = (
            b"<main><h1>Privacy Notice</h1><p>Last Updated: 17 October 2026</p>"
            b"<p><strong>Strictly Necessary: </strong>These Cookies "
            b"<a href=\"/docs/fees\">fees</a> apply.</p></main>"
        )
        source = synthetic_source(
            html,
            "Privacy Notice",
            {"h2": 0, "h3": 0, "p": 2, "table": 0, "ul": 0},
        )
        document = extractor.parse_document_bytes("privacy", source, html)
        rendered = json.dumps(document, ensure_ascii=False)
        self.assertIn('"Strictly Necessary: "', rendered)
        self.assertIn('"These Cookies "', rendered)

    def test_changed_bytes_fail_before_parsing(self):
        source = extractor.SOURCES["fees"]
        data = (APP_ROOT / source["path"]).read_bytes()
        with self.assertRaisesRegex(extractor.ExtractionError, "SHA-256 mismatch"):
            extractor.parse_document_bytes("fees", source, data[:-1] + b"x")

    def test_unexpected_html_structure_is_rejected(self):
        html = (
            b"<main><h1>Privacy Notice</h1>"
            b"<p>Last Updated: 17 October 2026</p><script>bad()</script></main>"
        )
        source = synthetic_source(
            html,
            "Privacy Notice",
            {"h2": 0, "h3": 0, "p": 1, "table": 0, "ul": 0},
        )
        with self.assertRaisesRegex(extractor.ExtractionError, "unexpected document tags"):
            extractor.parse_document_bytes("privacy", source, html)

    def test_missing_required_title_is_rejected(self):
        html = b"<main><h1>Wrong title</h1><p>Last Updated: 17 October 2026</p></main>"
        source = synthetic_source(
            html,
            "Privacy Notice",
            {"h2": 0, "h3": 0, "p": 1, "table": 0, "ul": 0},
        )
        with self.assertRaisesRegex(extractor.ExtractionError, "Expected one document main"):
            extractor.parse_document_bytes("privacy", source, html)

    def test_duplicate_section_identity_is_rejected(self):
        html = (
            b"<main><h1>Privacy Notice</h1><p>Last Updated: 17 October 2026</p>"
            b"<h2>Repeated</h2><h2>Repeated</h2></main>"
        )
        source = synthetic_source(
            html,
            "Privacy Notice",
            {"h2": 2, "h3": 0, "p": 1, "table": 0, "ul": 0},
        )
        with self.assertRaisesRegex(extractor.ExtractionError, "Duplicate section identity"):
            extractor.parse_document_bytes("privacy", source, html)

    def test_failed_write_preserves_existing_artifact(self):
        def write_partial_then_fail(
            path, data, *, encoding=None, errors=None, newline=None
        ):
            with path.open(
                "w", encoding=encoding, errors=errors, newline=newline
            ) as stream:
                stream.write(data[:11])
            raise OSError("simulated write failure")

        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "reference-pages.generated.json"
            output.write_text("previous\n", encoding="utf-8")

            with (
                mock.patch.object(extractor, "OUTPUT_PATH", output),
                mock.patch.object(extractor, "generate", return_value="replacement\n"),
                mock.patch.object(
                    extractor.Path, "write_text", new=write_partial_then_fail
                ),
                mock.patch.object(
                    sys,
                    "argv",
                    ["extract-reference-pages.py", "--write"],
                ),
            ):
                result = extractor.main()

            self.assertEqual(result, 1)
            self.assertEqual(output.read_text(encoding="utf-8"), "previous\n")


if __name__ == "__main__":
    unittest.main()
