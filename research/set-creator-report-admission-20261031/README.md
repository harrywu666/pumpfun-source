# Set-creator differential: refuse a report destination that is an input

## Defect

`scripts/pump_set_creator_differential.py` took the trouble to hash its inputs
and re-check them just before publishing:

```python
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in hashes.items()),'Input changed during execution'
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
```

Nothing compared `--output` with those inputs. Pointed at one of them, the run
reported success and wrote the receipt over the input:

```
$ python -B scripts/pump_set_creator_differential.py \
    --candidate candidate.so --output evidence/upstream/pump.json
509 []                       # exit 0
# IDL before: 328,788 bytes, sha256 7616681e...
# IDL after:  report,        sha256 86656122...  head {"scope": "Normally signed synthetic...
```

The same happens for `evidence/original/pump/deployed.so`,
`scripts/fees_admin_differential.py` (an input because it defines the fixture)
and the candidate.

## Change

* Import `PumpReport` and construct
  `PumpReport(a.output, ROOT, a.candidate, __file__, extra_inputs=paths)` right
  after the input list is built.
* Call `publisher.check()` immediately before the write, so a destination
  retargeted during the run is refused as well.
* Keep the receipt writer as `write_text` with `encoding='utf-8'`,
  `newline='\n'`.

`PumpReport.check()` refuses a destination that resolves to an input by
resolved path, directory containment, symlink or hardlink, and also covers
every loaded module's `__file__`.

Why not `publisher.write(...)`? `scripts/test_pump_receipt_encoding.py` pins
exactly this file's receipt to a `write_text` that carries UTF-8 and `"\n"`;
moving the bytes into `PumpReport.write` would drop the file from that enforced
list. The reported defect is destination admission, not durability, so the
change adopts the publisher's admission and leaves the writer alone.

## Result

```
ValueError: report output aliases an input: evidence/upstream/pump.json
# exit 1, IDL byte-identical
509 []   # fresh destination, unchanged full run
```

## Tests

`tests/test_set_creator_report_admission.py` (new, on test-owned copies):

* `test_report_cannot_replace_an_input` — four subtests (original, IDL,
  imported script, candidate). All four fail on the base script with exit `0`
  and the input replaced; all pass after. The three file inputs are restored
  between subtests so a base overwrite cannot cascade.
* `test_bounded_run_still_publishes_a_complete_receipt` — control; one real
  case through the CLI, receipt parses with `case_count` 1 and no mismatches.

Also passing: `tests/test_pump_differentials_normal_python.py` (3 tests),
`scripts/test_pump_receipt_encoding.py` (1 test, checked count still 5),
`scripts/test_tooling.py` (228 tests) and `scripts/verify_evidence.py` (9
captures).

## Limits

No differential result changes: admission runs before any fixture work and the
full 509-case run still reports no mismatches. The receipt is still written
directly rather than staged, so a crash mid-write can still truncate a prior
report; that is pre-existing and outside this change.

Source commit for this report: `52c0b087c`. Environment: macOS arm64, Python
3.14.3, solders 0.27.1.
