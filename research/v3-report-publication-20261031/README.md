# v3 differentials: publish reports through the shared publisher

## Defect

`scripts/pump_v3_configured_fee_differential.py` and
`scripts/pump_v3_token_extensions_differential.py` both ended with a direct
`write_bytes` to `--output`, without comparing the destination with the inputs
they read:

```python
raw=(json.dumps(report,separators=(',',':'))+'\n').encode();a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(gzip.compress(raw,mtime=0) if a.output.suffix=='.gz' else raw)
```

Reproduced on `52c0b087c` in a test-owned copy:

```
$ python -B scripts/<runner>.py --candidate candidate.so --output evidence/upstream/pump.json
{"cases": 372, "mismatches": []}   # pump_v3_configured_fee_differential, exit 0
{"cases": 126, "mismatches": []}   # pump_v3_token_extensions_differential, exit 0
# IDL before: sha256 7616681e...
# IDL after:  173d0727... / 037ec75a...   (a report)
```

The captured original, the shared trade fixture
`research/imported-lab/analysis/pump_fun/curve-fresh-trades-v3-signed-surfpool.json`
and the candidate are replaced the same way.

This is an omission rather than a design choice: `pump_trade_fixture` exports
`REPORT_INPUTS` — "Report writers must protect these paths as well as their
public candidate" — and eleven sibling runners already pass it to `PumpReport`.
These were the last two pump-family runners that did not.

## Change

```python
a=p.parse_args();publisher=PumpReport(a.output,f.R,a.candidate,__file__,extra_inputs=f.REPORT_INPUTS);a.candidate=pin_program(a.candidate) if a.candidate else None
...
publisher.write(gzip.compress(raw,mtime=0) if a.output.suffix=='.gz' else raw)
```

The publisher is built before `pin_program` swaps `a.candidate` for its private
snapshot, so the user-supplied candidate path is protected as well as the
snapshot. `PumpReport` refuses a destination that resolves to an input (resolved
path, directory containment, symlink or hardlink), rechecks for a late alias,
stages the bytes, fsyncs them and only then replaces a prior report.

## Result

```
ValueError: report output aliases an input: evidence/upstream/pump.json
# exit 1, IDL keeps sha256 7616681e...

{"cases": 372, "mismatches": []}   # fresh destination
{"cases": 126, "mismatches": []}   # fresh destination
```

## Tests

`tests/test_v3_report_publication.py` (new, on test-owned copies of `scripts/`,
`evidence/` and `research/imported-lab/`):

* `test_report_cannot_replace_an_input` — four destinations (captured original,
  IDL, shared trade fixture, candidate) for each of the two runners. All eight
  subtests fail on the base scripts with exit 0 and the input replaced; all pass
  after. The three file inputs are restored between subtests.
* `test_bounded_run_still_publishes_a_complete_receipt` — control; one real case
  per runner, gzip receipt parses with `case_count` 1 and no staging leftovers.

Also passing: `tests/test_pump_v3_configured_fee_pinned_image.py` and
`tests/test_pump_v3_token_extensions_pinned_image.py` (6 tests),
`scripts/test_pump_differential_optimized_mode.py` (3 tests),
`scripts/test_tooling.py` (228 tests) and `scripts/verify_evidence.py` (9
captures).

## Limits

No differential result changes: the guard fires before any fixture or VM work
and the full runs still report zero mismatches. The Mayhem fixture modules that
also import `pump_trade_fixture` write no report of their own and are untouched.

Source commit for this report: `52c0b087c`. Environment: macOS arm64, Python
3.14.3, solders 0.27.1.
