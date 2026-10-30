# Create-control differential: publish reports through the shared publisher

## Defect

`scripts/pump_create_control_differential.py` ended with

```python
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(gzip.compress(json.dumps(report,indent=2).encode(),mtime=0))
```

`--output` was never compared with the inputs the run reads. Passing the
captured original replaced it with the gzip receipt and exited 0:

```
$ before=$(shasum -a 256 evidence/original/pump/deployed.so)
$ python -B scripts/pump_create_control_differential.py \
    --candidate candidate.so --output evidence/original/pump/deployed.so
85 cases 0 mismatches            # exit 0
before 7a19affa...
after  74a4569f...               # head is now 1f8b0800 (gzip), not 7f454c46 (ELF)
```

The damage does not stay local: the next run of the same fixture dies while
loading its own program (`FileNotFoundError: invalid account data for
instruction`), so a single mistaken `--output` poisons every later attempt.
The same happens for `evidence/upstream/pump.json`,
`research/imported-lab/analysis/pump_fun/config-snapshot.json`, the token
dependency images, the Mayhem image the `create_v2` cases use, and the
candidate.

## Change

Build `pump_differential_output.PumpReport(a.output, ROOT, a.candidate,
__file__, extra_inputs=[ROOT/'evidence/original/mayhem/deployed.so'])` after
argument parsing and publish with `publisher.write(...)`. This is the same
publisher the Fees, migrate, holder-distribution, AMM-create and eleven other
Pump report families already use: it refuses a destination that resolves to an
input (resolved path, directory containment, symlink or hardlink), rechecks for
a late alias, stages the bytes, fsyncs them and only then replaces a prior
report. `evidence/original/mayhem/deployed.so` is added explicitly because the
publisher's shared defaults do not name it.

## Result

```
Use a fresh ... ValueError: report output aliases an input: evidence/original/pump/deployed.so
# exit 1, ELF byte-identical
85 cases 0 mismatches   # unchanged full run into /tmp/cc-out/report.json.gz
```

## Tests

`tests/test_create_control_report_publication.py` (new, runs against a
test-owned copy of `scripts/` and the evidence it reads):

* `test_report_cannot_replace_any_input` — six subtests (original, Mayhem
  image, IDL, config snapshot, dependency image, candidate). All six fail on
  the base script with exit 0 and the input replaced; all pass after. Each
  subtest restores the pristine input afterwards so a base overwrite cannot
  cascade into the next one.
* `test_bounded_run_still_publishes_a_complete_receipt` — control; runs one
  real case through the CLI and checks the gzip receipt parses with no staging
  leftovers.

Also passing: `tests/test_pump_differentials_normal_python.py` (3 tests),
`scripts/test_tooling.py` (228 tests) and `scripts/verify_evidence.py` (9
captures).

## Limits

No differential result changes: the guard fires before any fixture or VM work
and the full 85-case run still reports zero mismatches. The test proves the
destination contract for this runner only; other scripts that still write
reports directly are outside this change.

Source commit for this report: `52c0b087c`. Environment: macOS arm64, Python
3.14.3, solders 0.27.1.
