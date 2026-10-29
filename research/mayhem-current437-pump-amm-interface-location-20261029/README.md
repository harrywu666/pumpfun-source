# Mayhem `pump_amm_interface.rs` panic Location records

This packet counts **four 24-byte `core::panic::Location`-shaped records** and the
**63-byte path literal** they point at: **159 new payload bytes**. Both the record
table and this copy of the path literal are uncredited in the merged qualified437
ledger. No code site, allocation extent or relocation-table byte is claimed.

## Claim

- Original path literal: `[707644, 707707)` = 62 path bytes plus one trailing NUL.
- Candidate path literal: `[687927, 687990)` = the same 63 bytes.
- Original records: `0xb1640`, `0xb1658`, `0xb1670`, `0xb1688`
  (union `[726592, 726688)`).
- Candidate records: `0xac9e0`, `0xac9f8`, `0xaca10`, `0xaca28`
  (union `[707040, 707136)`).
- Each record is `(u32 low = 0, u32 pointer, u64 length = 63, u32 line, u32 column)`.
  Exactly one type-8 relocation with symbol index zero sits at the record start;
  the length, line and column halves are raw.
- The four `(line, column)` pairs are `(403, 23)`, `(404, 26)`, `(595, 23)` and
  `(596, 26)`. The candidate stores the same four pairs in a different order
  (`595, 596, 403, 404`), so rows are matched by `(line, column)`, not by offset.

The 63-byte length is the immediate bound. It counts the 62 path bytes and the
NUL byte at offset 62; the NUL is inside the bound and is not used as a boundary.
The following byte at `707707` is a distinct `src/...` literal and is not
absorbed.

## Qualified relation

The four records are one contiguous four-entry table for a single owner, the
source path `programs/mayhem-program/src/instructions/pump_amm_interface.rs`.
Every record reproduces the same relocated pointer and the same immediate length
in both images, and the row order change is the only layout difference. The
candidate has exactly these four records for this pointer; the scan rejects a
fifth row or a duplicate `(line, column)` pair.

## Coverage

The baseline is the sealed union of the merged qualified437 `coverage-delta.json`
files merged at `b19f4af32`, recomputed from path + SHA-256 rather than summed; `proof.py` reads the
pinned set and totals from `baseline/sources.json` and asserts the union equals
the declared totals instead of hardcoding them:
**24,109 / 26,180 payload bytes** (`.rodata` 16,869 / 18,396;
`.data.rel.ro` 7,240 / 7,784).

After this packet:

- payload: **24,268 / 26,180 bytes**;
- `.rodata`: **16,932 / 18,396** (+63);
- `.data.rel.ro`: **7,336 / 7,784** (+96: 32 mapped pointer bytes, 64 raw
  length/line/column bytes).

The new intervals are exactly `[707644, 707707)` and
`[726592, 726688)`. They are disjoint from merged #956 and the eight merged
seed/string packets #1000/#1003/#1005/#1010/#1012/#1014/#1015/#1017.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B research/mayhem-current437-pump-amm-interface-location-20261029/verify.py --repo .
PYTHONDONTWRITEBYTECODE=1 python3 -B research/mayhem-current437-pump-amm-interface-location-20261029/test_verify.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/verify_evidence.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/test_tooling.py
```

Tests mutate every path byte, the record low word, pointer, length, line and
column, the relocation type and symbol index, and a candidate row line. They
also check that the following byte and the following record are not absorbed,
that the NUL is inside the immediate bound, and reject unlisted files, symlinks,
FIFOs, resealed observations/coverage/baseline/input edits.

## Limits

This proof is static. It does not establish that these records are reachable
panic sites, that they describe the current source, or any runtime behavior. It
does not claim a code site, any byte outside the two intervals, or a full
Location-table allocation. The candidate keeps all four rows; only the row order
differs. No binary patch or whole-ELF identity is claimed.

provider=OpenCode model=opencode/deepseek-v4.1-flash-free client=opencode CLI 1.19.5

Made via @slopdotcash
