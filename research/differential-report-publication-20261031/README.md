# Protect the remaining differential report destinations

Problem: three differential CLIs wrote their report with a plain
`write_text`/`write_bytes` to whatever `--output` named. Pointing `--output`
at the captured original, the IDL or the candidate replaced that input and
still exited 0, leaving a report where the evidence used to be.

Reproduction at base `e2455876b`, in a temp root holding copies of the script,
the evidence and a candidate:

    python3 -B scripts/pump_amm_create_differential.py \
      --candidate candidate.so --output evidence/original/pump_amm/deployed.so
    # base: exit 0; 10,485,715-byte ELF (7f454c46) -> 3,606,349-byte JSON (7b227363)
    # after: exit 1, "report output aliases an input", ELF byte-identical

`pump_migrate_differential.py` and `pump_holder_distribution_differential.py`
behave the same way for the original, the IDL and the candidate.

Fix: adopt `pump_differential_output.PumpReport`, the publisher the Fees
differentials and nine Pump families already use. It refuses an aliasing
destination (resolved path, directory containment, symlink, hardlink), rechecks
before publishing, stages and fsyncs the bytes, and only then replaces a prior
report, so a failed run cannot truncate one.

Tests: `tests/test_differential_report_publication.py` (2 tests) fails 9
subtests on base and passes after, in 0.98s; it also runs one bounded real-VM
case per migrate and holder script. `scripts/test_pump_differential_optimized_mode.py`
3 OK; `scripts/test_tooling.py` 228 OK; `scripts/verify_evidence.py` 9 captures
verified. macOS arm64, Python 3.14.3.

Limits: no differential result changes — the guard fires before any fixture or
VM work, and only one real case per script is re-run. Full case coverage is not
re-executed. `scripts/donation_relay_differential.py` keeps its direct write
because it reads `repro/` only, which this checkout and CI do not contain.
