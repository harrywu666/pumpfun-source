# Mayhem quote-vault seed-name literals and their pointer/length sites

This packet counts **three `.rodata` seed-name literals totalling 49 bytes** that
form one contiguous original span, and verifies **17 pointer/length sites per
image**: 15 pass the pointer in `r3` with the exact length in `r4`, and 2 store
the pointer to a stack seed field and the exact length to the adjacent eight-byte
field. The literals are uncredited in the merged qualified437 ledger. No callee,
PDA derivation, allocation extent or relocation-table byte is claimed.

## Claim

| Literal | Original interval | Bytes | Candidate pointer | Sites |
| --- | --- | ---: | ---: | --- |
| `mayhem_quote_vault` | `[712132, 712150)` | 18 | `0xa8f01` | 6 argument |
| `pool-v2` | `[712150, 712157)` | 7 | `0xa8f13` | 2 stack |
| `associated_bonding_curve` | `[712157, 712181)` | 24 | `0xa8b90` | 9 argument |

The original three intervals are contiguous (`[712132, 712181)`); the candidate
stores `associated_bonding_curve` elsewhere, so each literal is bounded by its
own sites rather than by the original adjacency.

## Qualified relation

Every pointer-matching type-8 site is one of two shapes:

- **argument**: `lddw r3, literal` (type-8 relocation, symbol index zero) then
  `mov64 r4, <exact length>` within the next instruction.
- **stack**: `lddw r5, literal`, `stxb [r10+off], r5`, then an immediate store of
  the exact length to `[r10+off+8]` within the next 12 instructions.

The packet asserts that the set of pointer-matching sites is exactly the
reported set for each literal and that every site carries the literal's exact
length. The immediate length is the bound. `mayhem_quote_vault` and `pool-v2`
are adjacent in the original image, so a test mutates the second literal and
checks that the first literal's site set is unchanged.

## Coverage

The baseline is the sealed union of the 36 merged qualified437
`coverage-delta.json` files present at `0b6ad45c4`, recomputed from path +
SHA-256 rather than summed; `proof.py` reads the pinned set and totals from
`baseline/sources.json` and asserts the union equals the declared totals instead
of hardcoding them: **24,494 / 26,180 payload bytes** (`.rodata` 17,078 / 18,396;
`.data.rel.ro` 7,416 / 7,784).

After this packet:

- payload: **24,543 / 26,180 bytes**;
- `.rodata`: **17,127 / 18,396** (+49);
- `.data.rel.ro`: **7,416 / 7,784** (unchanged).

The new interval union is exactly `[712132, 712181)`. It is disjoint from merged
#956, #1000/#1003/#1005/#1010/#1012/#1014/#1015/#1017, #1046, #1052, #1066 and
#1073.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B research/mayhem-current437-quote-vault-seed-literals-20261029/verify.py --repo .
PYTHONDONTWRITEBYTECODE=1 python3 -B research/mayhem-current437-quote-vault-seed-literals-20261029/test_verify.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/verify_evidence.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/test_tooling.py
```

`observations.json.gz` records each literal's bytes and every site with its
shape in both images. Tests mutate every literal byte, every site's pointer low
word and high word, every argument-length immediate, every stack-length
immediate and every site-shape opcode; each mutation is rejected. They also
assert that the adjacent literal is not a bound and that the byte after the last
literal is not absorbed, and reject unlisted files, symlinks, FIFOs and resealed
observations/coverage/baseline/input edits.

## Limits

This proof is static. It does not establish that these literals are PDA seeds,
what the call or stack consumer does, reachability, runtime behavior or a stable
layout. It does not claim any byte outside the three intervals, the callee, the
other seed names in the same program, or a full string table. The site set is an
observed mapping for this image pair only. No binary patch or whole-ELF identity
is claimed.

provider=OpenCode model=opencode/deepseek-v4.1-flash-free client=opencode CLI 1.19.5

Made via @slopdotcash
