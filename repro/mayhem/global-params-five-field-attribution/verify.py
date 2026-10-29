#!/usr/bin/env python3
"""Portable verifier for the five-field attribution ledger (Python 3.11+)."""
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys

sys.dont_write_bytecode = True
PKG = pathlib.Path(__file__).resolve().parent
ROOT = PKG.parents[2]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    manifest = json.loads((PKG / "manifest.json").read_text())
    paths = list(PKG.rglob("*"))
    assert not any(p.is_symlink() for p in paths), "symlink"
    actual = {
        p.relative_to(PKG).as_posix()
        for p in paths
        if p.is_file() and p.name != "manifest.json"
    }
    assert actual == set(manifest), "file set"
    for name, record in manifest.items():
        blob = (PKG / name).read_bytes()
        assert record == {"bytes": len(blob), "sha256": sha(blob)}, name

    inputs = json.loads((PKG / "inputs.json").read_text())
    for entry in inputs["pinned_inputs"]:
        path = ROOT / entry["path"]
        data = path.read_bytes()
        assert len(data) == entry["bytes"] and sha(data) == entry["sha256"], entry["path"]

    proc = subprocess.run(
        [sys.executable, "-B", str(PKG / "analyze.py")],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    computed = json.loads(proc.stdout)
    expected = json.loads((PKG / "attribution.json").read_text())
    assert computed == expected, "attribution.json stale; rerun analyze.py"

    summary = expected["summary"]
    assert summary["source_patch"] is None
    assert summary["handler_count_delta"] == 0
    assert summary["unknown_roles_remaining"] == 4
    assert summary["bounded_static_consumer_fields"] == ["field_6"]

    by_name = {row["field"]: row for row in expected["fields"]}
    assert by_name["field_0"]["on_chain"]["distinct_values"] == [8000]
    assert by_name["field_1"]["on_chain"]["distinct_values"] == [0, 10, 50, 100]
    assert by_name["field_3"]["on_chain"]["distinct_values"] == [20_000_000_000]
    assert by_name["field_6"]["on_chain"]["distinct_values"] == [24]
    assert by_name["field_10"]["on_chain"]["distinct_values"] == [86280, 86400]

    f6 = by_name["field_6"]["bounded_static_consumer"]
    assert f6["stopped_lane"] is True
    assert f6["handler"] == "initialize_mayhem_state"
    assert any(r["line"] == 222 for r in f6["evidence"])

    for field in ("field_0", "field_1", "field_3", "field_10"):
        assert by_name[field]["trade_handler_reads"] == []
    for field in ("field_0", "field_1", "field_3"):
        assert by_name[field]["non_update_source_reads"] == []

    wire_inputs = json.loads((ROOT / "research/mayhem-history-wire/inputs.json").read_text())
    ts_row = next(
        r
        for r in wire_inputs["files"]
        if r["path"].endswith("analysis_timeseries.json")
    )
    ts_path = ROOT / ts_row["path"]
    ts_bytes = ts_path.read_bytes()
    assert len(ts_bytes) == ts_row["bytes"] and sha(ts_bytes) == ts_row["sha256"]
    assert (
        by_name["field_0"]["on_chain"]["timeseries_sha256"] == ts_row["sha256"]
    )

    crosswalk = subprocess.run(
        [sys.executable, "-B", str(ROOT / "repro/mayhem/field-role-crosswalk/verify.py")],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert crosswalk.returncode == 0, (crosswalk.stdout, crosswalk.stderr)

    print(
        json.dumps(
            {
                "status": "PASS",
                "sealed_files": len(manifest),
                "unknown_roles_remaining": summary["unknown_roles_remaining"],
                "bounded_static_consumer_fields": summary["bounded_static_consumer_fields"],
                "field_role_crosswalk": "PASS",
                "history_timeseries_binding": ts_row["sha256"][:16],
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
