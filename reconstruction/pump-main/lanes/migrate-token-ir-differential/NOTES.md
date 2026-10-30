# Lane migrate-token-ir-differential

Target: `0x4c158` `migrate_v2::create_token_account_v2` (programs/pump/src/migrate_v2.rs:415), original 8,368 B.
Approach: compiler-IR differential. MIR, final LLVM IR and MachineIR (finalize-isel, before greedy,
after virtregrewriter, before/after block-placement) were captured in scratch crate copies with
`capture.py` (extra rustc flags only in scratch builds, never in proposed source).

## Mechanism of the shared r8 reload (diagnosis)

- Before greedy, the four return predecessors (nn-ok bb27, nn-err bb26, native-ok bb17, native-err bb16)
  all jump to one return block bb15 that stores `{i64, ptr}` through the hidden output pointer.
- After virtregrewriter both non-native blocks still reload r8 (output pointer) from the spill slot
  separately, like the original.
- The shared reload appears in BranchFolder (control-flow optimizer, post-RA, before placement):
  nn-err bb26 is the **layout predecessor that falls through into bb15**, and `ProfitableToMerge`
  accepts any non-terminator common tail with the fall-through predecessor. The common tail of nn-ok
  and nn-err is exactly the one reload, so it is split into a new block (`bb.133.bb15`).
- The return block sits right after nn-err because rustc creates LLVM blocks on first reference while
  codegenning MIR in reverse postorder: the nn-err `?` chain is the first to `goto` the return block.
  When some outer-scope local keeps a `StorageDead` in the shared return drop tree after GVN, the
  `?` exits jump to that shared block instead, and the return block is created after the native result
  blocks. Then the fall-through predecessor is native-err (no common tail), the 2-instruction
  effective tail is below the merge threshold of 3, and no shared reload is created.
- `token_program`'s own StorageDead markers are removed by MIR GVN, so it does not provide this.

## Results (official builds, zero losses unless stated)

| Trial | Bytes | ratio | calls | Tail merge | Notes |
| --- | ---: | ---: | --- | --- | --- |
| baseline d2cb88d | 8,424 | 0.5628 | 10/1 | yes | |
| `let bump_seed=[bump];` before the branch (round 1) | 8,432 | 0.5781 | 10/1 | no | 1019/188, no gains/losses; bump slot moves, entry r1->r9 copy remains |
| `let tp=&token_program;` + nn meta `tp.key()` (current branch, round 2) | 8,400 | 0.6116 | 10/1 | no | 1019/188, no gains/losses, sha 448c212b; bump stays in native branch; padding at -0x16c like original |

Diagnostic-only captures (not proposed): `if !native` (identical), `match native` (identical),
`if let true=native` (identical), Ok in each arm (identical), nn early return (identical), hoisted
ATA program id (identical), inline helper for nn invoke (drop6 coalesced, 9 callees), hoisted signer
seeds (no tail merge, but key load hoisted, ratio 0.486), `match native as u8` (native codegenned first,
tail merge remains, 0.424).

Ledger attempt ids: 46e85036 (diagnosis), befa8c29, d5d12cc4, 4d00c855, 0d9630a6, c1ca73a3, 7b4cd0d1,
89b9e78f, f3d293a4, f76ec415, 1bfb7e9d (bump_seed).

## Remaining residual

Entry register choice: the original keeps `token_program` in r9 and spills the output pointer r1 between
the two Rc increments; ours copies r1 to r9 first. Untouched by the block-order fix.

## IR-level fast loop and frame clue

- `llc -O3 -filetype=obj -relocation-model=pic -mattr=+store-imm,+jmp-ext module.ll` on the module
  emitted by `capture.py` reproduces the rustc-built target instructions exactly (0 diff lines), about 3 s per run.
  This allows IR mutation experiments without a cargo build.
- Alloca-region stack offsets: the original uses `-0x16c/-0x170` where baseline uses `-0x2a1/-0x2a5`
  (`token_program1.sroa.12`, the 5-byte tail of the cloned AccountInfo). The original's token_program
  clone temporary therefore sits much earlier in alloca order. It is the strongest remaining lead for the
  entry register/spill residual.
- Moving the bump store into the native branch or moving the bump alloca at IR level both lowered the ratio
  (0.570 and 0.545), so the bump_seed local is probably not the original's outer local.

## Round 2: the clone local must not be SSA for MIR GVN

- The 5-byte padding piece of the AccountInfo clone (`*.sroa.12`, read uninitialized into infos[5]) has no lifetime
  markers in the baseline, so it gets a private slot (-0x2a1). llc IR edits showed: lifetime.start just before the
  infos memcpy in each branch plus end at the exits puts it at -0x16c/-0x170 exactly like the original
  (base IR 0.5628 -> 0.6077); an entry-wide lifetime changes nothing. So the original copies padding from a
  branch-local temporary, i.e. the cta_signed argument temp `_18 = move _8` survived GVN.
- GVN only reuses SSA locals; a `let`-bound shared reference to the clone survives ReferencePropagation, so
  `let token_program=token_program.clone();let tp=&token_program;` with the non-native meta using `tp.key()` keeps
  `StorageLive/Dead(token_program)` and the arg temp. That one change gives both the shared exit drop block (no tail
  merge, like the bump_seed hoist) and the native-only padding copy at -0x16c, and leaves the bump store in the
  native branch. Official: 8,400 B, ratio 0.6116, 10/1 calls, 1019/188, no gains/losses.
- Rejected this round: clone at each use (0.204), `let` clone first in each branch (0.210), `let mut` clone,
  `to_account_info()` clone, `*token_program.key` meta (all byte-identical), native call through a closure (0.547).
- Ledger ids: e6654786 (padding lifetime IR analysis), 8979a06b, 1e9c9569, ace77412, d98e0d93, da5a0e34, f67a1b06,
  cc0d5805 (tp ref binding).
- Remaining: entry register choice (r1 copied to r9 first; original keeps token_program in r9 and spills r1 after
  the first Rc increment) and register/spill differences in the non-native metas/infos build.

Rebased on origin/main f4065ddc3 (round-1 PR #1228 merged): main baseline 1020/188, target 8432 B 0.5781; with this change 1020/188, no gains/losses, target 8400 B 0.6116, unstripped sha 9038ea17bf9afaa4da70ffcf259691626b3f05b89a305337e5316e5257241e33.

Follow-ups on the best form: tp borrow declared inside the nn branch and `*tp.key` are byte-identical to it; hoisting `tp.key()` into a let drops to 0.337. The best form's frame (0x448) and set of stack slots now equal the original's; what remains is register assignment and the interleaving of AccountInfo clone field loads vs Rc stores. Ledger ids 7d5d8432, 5b4d4a83 (+ tp-ref-key-hoisted).
