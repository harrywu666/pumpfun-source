# Mayhem GlobalParams — five remaining field roles (attribution synthesis)

## Problem

`docs/COMPLETION.md` and the corrected
[`mayhem-field-crosswalk`](../../layered-passes/pass-01/followup-results/mayhem-field-crosswalk/REPORT.md)
still list **five neutral `GlobalParams` fields** whose trading or admin semantics
are not established in bounded recovery: `field_0`, `field_1`, `field_3`,
`field_6`, and `field_10`.

Prior packages bound parts of the obligation separately:

| Package | What it establishes |
| --- | --- |
| [`global-params-remaining-field-review`](../global-params-remaining-field-review/REPORT.md) | Setter / event / reset / codec transport for all five; no business rename |
| [`field-role-crosswalk`](../field-role-crosswalk/README.md) | Six trade-handler reads; seven argument roles still unresolved there |
| [`mayhem-globalparams-field-history`](../../../research/mayhem-globalparams-field-history/README.md) | Captured mainnet configuration cohort (versions 0→10) |
| [`mayhem-history-wire`](../../../research/mayhem-history-wire/README.md) | Independent raw-transaction decode of that cohort |

The **30-byte Mayhem dynsym residual** and whole-ELF identity remain covered by
upstream PR [#446](https://github.com/lalalune/pumpfun-source/pull/446); this
packet does not touch linker metadata.

## What this packet adds

`attribution.json` is a **single machine-readable ledger** that merges:

1. **Exhaustive lexical references** in current `programs/mayhem/src/**/*.rs`
   for each of the five fields (including the dynamic `args.field_3` setter loop).
2. **Negative evidence** that none of the six recovered trade handlers read
   `reset_prefix[0..16)`, `reset_prefix[16..24)`, `reset_middle[0]`, or
   `field_10`.
3. **One new bounded static consumer** for `field_6` in
   `initialize_mayhem_state` (`lib.rs` reads `reset_middle[0]`, multiplies by
   `3600`, sets `MayhemState.end_timestamp`). The initializer lane stays
   **stopped**; this is source attribution only, not handler acceptance.
4. **On-chain value summaries** recomputed from the sealed
   `analysis_timeseries.json` (SHA-256
   `c0c3a58fe6a92ba7b4d442159c5e0210441e4cb02266d411c89c29542d09448c`), aligned
   with [`mayhem-history-wire` inputs](../../../research/mayhem-history-wire/inputs.json).

No Rust identifiers are renamed. `source_patch` is null.

### Attribution status after this packet

| Field | Recovered storage | Non-update source consumer | On-chain pattern | Status |
| --- | --- | --- | --- | --- |
| `field_0` | `reset_prefix[0..4]` | none in recovered tree | constant `8000` | **open** |
| `field_1` | `reset_prefix[4..8]` | none | `10→100→50→0` then fixed | **open** |
| `field_3` | `reset_prefix[16..24]` | none | always `20_000_000_000` (= `field_2`) | **open** (native-limit family indicated, check unknown) |
| `field_6` | `reset_middle[0]` | **`initialize_mayhem_state` (stopped)** | constant `24` | **bounded class**: mayhem-mode duration in hours (hypothesis) |
| `field_10` | dedicated u64 | none | `86400` then surgical `86280` | **bounded class**: ~1-day seconds duration (hypothesis); consumer unknown |

**Four** fields remain without a proven consumer in accepted bounded handlers.
**One** field (`field_6`) gains a static consumer in stopped initializer source,
corroborated by the captured constant `24` matching `duration_hours * 3600`.

## Evidence hashes (pinned inputs)

| Path | SHA-256 |
| --- | --- |
| `programs/mayhem/src/lib.rs` | (current tree; see `attribution.json` → `mayhem_source_sha256`) |
| `research/mayhem-globalparams-field-history/evidence/analysis_timeseries.json` | `c0c3a58fe6a92ba7b4d442159c5e0210441e4cb02266d411c89c29542d09448c` |
| `repro/mayhem/global-params-remaining-field-review/REPORT.md` | see `inputs.json` |
| `repro/mayhem/field-role-crosswalk/crosswalk.json` | see `inputs.json` |

Original Mayhem payload (unchanged): SHA-256
`a87fa9f866272514e6acb852b668c4a08aeb173d56c883039991d114d1199bdb`.

## Verify

```sh
python3 -B repro/mayhem/global-params-five-field-attribution/verify.py
python3 -B repro/mayhem/global-params-five-field-attribution/analyze.py \
  > /tmp/attribution.json && diff -u repro/mayhem/global-params-five-field-attribution/attribution.json /tmp/attribution.json
```

The verifier also runs [`field-role-crosswalk`](../field-role-crosswalk/verify.py)
and re-checks the history time-series digest against
[`mayhem-history-wire` inputs](../../../research/mayhem-history-wire/inputs.json).
It does **not** rerun the full wire decoder (that package pins `lib.rs` at git
`ba788351`; current `lib.rs` may differ while transport layout for these five
fields is unchanged).

## Limits

- Lexical scan ≠ proof that the deployed original binary has no extra consumers
  in unattributed windows (see the 339-entry offset survey in
  `global-params-remaining-field-review`).
- On-chain numerics do not prove units except where the recovered source shows
  an explicit multiply (field_6 only).
- Initializer execution, whole-ELF equality, and handler counts are unchanged.
