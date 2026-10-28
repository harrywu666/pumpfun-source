#!/usr/bin/env python3
"""Recompute the five-field attribution ledger from pinned repo inputs."""
from __future__ import annotations

import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]
PKG = pathlib.Path(__file__).resolve().parent
MAYHEM_SRC = ROOT / "programs/mayhem/src"
TIMESERIES = (
    ROOT
    / "research/mayhem-globalparams-field-history/evidence/analysis_timeseries.json"
)

FIELDS = ("field_0", "field_1", "field_3", "field_6", "field_10")

# Serialized account byte intervals including the 8-byte discriminator.
ACCOUNT_INTERVALS = {
    "field_0": [8, 12],
    "field_1": [12, 16],
    "field_3": [24, 32],
    "field_6": [137, 138],
    "field_10": [166, 174],
}

# Recovered storage mapping in programs/mayhem/src/lib.rs (not historical names).
STORAGE = {
    "field_0": "reset_prefix[0..4]",
    "field_1": "reset_prefix[4..8]",
    "field_3": "reset_prefix[16..24]",
    "field_6": "reset_middle[0]",
    "field_10": "field_10",
}

# Trade handlers only touch reset_prefix[8..16], [24..32], [32..40] and reset_middle[9..17].
TRADE_READ_SLICES = {
    "reset_prefix[8..16]",
    "reset_prefix[24..32]",
    "reset_prefix[32..40]",
    "reset_middle[9..17]",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def line_refs(path: pathlib.Path, pattern: str) -> list[dict]:
    text = path.read_text()
    lines = text.splitlines()
    out: list[dict] = []
    for i, line in enumerate(lines, start=1):
        if re.search(pattern, line):
            out.append(
                {
                    "path": str(path.relative_to(ROOT)),
                    "line": i,
                    "text": line,
                    "source_sha256": sha256_bytes(text.encode()),
                }
            )
    return out


def classify_refs(refs: list[dict]) -> dict:
    buckets = {
        "update_transport": [],
        "reset_transport": [],
        "static_consumer": [],
        "trade_handlers": [],
        "other": [],
    }
    for ref in refs:
        p = ref["path"]
        if "instructions/" in p and any(
            name in p
            for name in (
                "buy",
                "sell",
            )
        ):
            buckets["trade_handlers"].append(ref)
        elif p.endswith("lib.rs"):
            line = ref["line"]
            if 120 <= line <= 170:
                buckets["update_transport"].append(ref)
            elif 190 <= line <= 205:
                buckets["reset_transport"].append(ref)
            elif 215 <= line <= 235:
                buckets["static_consumer"].append(ref)
            elif 55 <= line <= 75:
                buckets["other"].append(ref)
            else:
                buckets["other"].append(ref)
        else:
            buckets["other"].append(ref)
    return buckets


def on_chain_summary(field: str) -> dict:
    data = json.loads(TIMESERIES.read_text())
    values: list[int | str] = []
    for tx in data["transactions"]:
        for ins in tx.get("instructions", []):
            if ins.get("instruction") != "update_global_params":
                continue
            args = ins.get("args") or {}
            if field not in args:
                continue
            values.append(args[field])
        for ev in tx.get("update_events", []):
            fields = ev.get("fields") or {}
            if field in fields:
                values.append(fields[field])
    uniq = sorted({v for v in values if isinstance(v, int)})
    return {
        "distinct_values": uniq,
        "value_count_observations": len(values),
        "timeseries_sha256": sha256_bytes(TIMESERIES.read_bytes()),
    }


def trade_slice_hits() -> dict[str, list[dict]]:
    hits: dict[str, list[dict]] = {f: [] for f in FIELDS}
    for path in sorted(MAYHEM_SRC.rglob("*.rs")):
        rel = str(path.relative_to(ROOT))
        for field, storage in STORAGE.items():
            if storage in TRADE_READ_SLICES:
                continue
            for ref in line_refs(path, re.escape(storage)):
                if "instructions/" in rel:
                    hits[field].append(ref)
    return hits


def run() -> dict:
    assert MAYHEM_SRC.is_dir(), "programs/mayhem/src missing"
    assert TIMESERIES.is_file(), "analysis_timeseries.json missing"

    lib = MAYHEM_SRC.parent / "src/lib.rs"
    fields_out = []
    for field in FIELDS:
        storage = STORAGE[field]
        if field == "field_10":
            patterns = [r"\bfield_10\b"]
        elif field == "field_3":
            patterns = [re.escape(storage), r"args\.field_3"]
        else:
            patterns = [re.escape(storage), rf"args\.{field}"]
        refs = []
        seen: set[tuple[str, int]] = set()
        for path in sorted(MAYHEM_SRC.rglob("*.rs")):
            for pattern in patterns:
                for ref in line_refs(path, pattern):
                    key = (ref["path"], ref["line"])
                    if key in seen:
                        continue
                    seen.add(key)
                    refs.append(ref)
        buckets = classify_refs(refs)
        trade_hits = trade_slice_hits()[field]
        oc = on_chain_summary(field)

        entry = {
            "field": field,
            "account_byte_interval": ACCOUNT_INTERVALS[field],
            "recovered_storage": storage,
            "source_reference_count": len(refs),
            "source_buckets": {k: len(v) for k, v in buckets.items()},
            "source_references": refs,
            "trade_handler_reads": trade_hits,
            "on_chain": oc,
            "reset_behavior": (
                "zeroed_by_reset_state"
                if field != "field_10"
                else "preserved_by_reset_state"
            ),
        }

        if field == "field_6":
            init_refs = [
                r
                for r in buckets["static_consumer"]
                if "duration_hours" in r["text"] or "reset_middle[0]" in r["text"]
            ]
            entry["bounded_static_consumer"] = {
                "handler": "initialize_mayhem_state",
                "stopped_lane": True,
                "evidence": init_refs,
                "interpretation_class": "mayhem_mode_duration_hours",
                "interpretation_note": (
                    "Recovered source multiplies this byte by 3600 and adds Clock "
                    "to set MayhemState.end_timestamp. On-chain configuration held "
                    "value 24 at every captured version. This is a bounded class "
                    "hypothesis only; the source identifier field_6 is unchanged."
                ),
            }
        elif field == "field_10":
            entry["bounded_on_chain_class"] = {
                "interpretation_class": "seconds_duration_near_one_day",
                "interpretation_note": (
                    "Captured updates held 86400 then a deliberate single-field "
                    "change to 86280. No non-update read exists in recovered "
                    "programs/mayhem source. Parallels withdrawal-interval fields "
                    "field_8 and field_15 in storage class, but no consumer is "
                    "identified in source."
                ),
            }
        else:
            entry["non_update_source_reads"] = [
                r
                for r in refs
                if r not in buckets["update_transport"]
                and r not in buckets["reset_transport"]
                and r not in trade_hits
            ]

        fields_out.append(entry)

    return {
        "program_id": "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
        "mayhem_source_root": "programs/mayhem/src",
        "mayhem_source_sha256": sha256_bytes(
            b"".join(
                sorted(
                    (p.read_bytes() for p in MAYHEM_SRC.rglob("*.rs")),
                    key=lambda b: sha256_bytes(b),
                )
            )
        ),
        "upstream_packages": [
            "repro/mayhem/global-params-remaining-field-review",
            "repro/mayhem/field-role-crosswalk",
            "research/mayhem-globalparams-field-history",
            "research/mayhem-history-wire",
        ],
        "fields": fields_out,
        "summary": {
            "unknown_roles_remaining": 4,
            "bounded_static_consumer_fields": ["field_6"],
            "bounded_on_chain_class_fields": ["field_10"],
            "no_non_update_read_in_recovered_source": ["field_0", "field_1", "field_3"],
            "source_patch": None,
            "handler_count_delta": 0,
            "whole_file_equal": False,
        },
    }


if __name__ == "__main__":
    print(json.dumps(run(), indent=2, sort_keys=True))
