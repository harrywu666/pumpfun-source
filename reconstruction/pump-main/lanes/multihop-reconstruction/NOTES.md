# Lane multihop-reconstruction: 0x5b3b0 `multi_hop_curve::swap_hop`

Base: origin/main 016a11c7f (includes #1197 callgraph-census, which already carries the
`constant_product::tokens_for_quote` and `trade::sub3` helper calls first proposed by outside
contributor hongikAn in draft PR #1164 `codex/pump-multihop-token-quote`; that work is credited and
not redone here).

## Metrics

`exact` = win.py / target_metric ratio (normalized tokens, so register, stack-offset and jump
differences all count). `opregs` / `op` = the same difflib alignment over (opcode, regs byte) and
opcode only (`shape.py`): they track block order and instruction selection without the stack-frame
noise that dominates `exact` while the frame layout differs.

| build | bytes (orig 18,584) | calls (orig 107) | callee multiset diff | exact | opregs | op |
|---|---:|---:|---|---:|---:|---:|
| main 016a11c (t0) | 19,024 | 108 | clone 11 vs 10 | 0.2229 | 0.4645 | 0.5491 |
| t1 cap before trade_amount | 19,032 | 108 | clone 11 vs 10 | 0.2186 | 0.5702 | 0.6190 |
| t2 + early seeds, clone-free validate | 18,456 | 107 | **none** | 0.1461 | 0.5445 | 0.6828 |
| v546b + if/else-if `buy` at :546 | 18,504 | 107 | none | 0.1319 | 0.5968 | 0.6499 |
| v546btB + completion nested after TradeEvent (PR v1) | 18,360 | 107 | none | 0.1456 | 0.6436 | 0.7378 |
| w1 + post_out join, user key hoisted | 18,360 | 107 | none | 0.1456 | 0.6476 | 0.7396 |
| br1 + per-arm transfer/apply/payout | 18,336 | 107 | none | 0.1457 | 0.6555 | 0.7392 |
| **br3 + TradeFees as an arm-result element** (in source) | 18,376 | 107 | none | 0.0915 | **0.6574** | 0.7370 |

Official score of every build: normalized 1020 / raw 188 vs the d2cb88d baseline (gain 0x14f4e0
is main's), losses none. In-source build (br3) unstripped sha256
`8c4483af3d99afaa20a761fbb841a854caeac5c283aa93765081a2014d772702`.

The exact ratio falls because the stack frame shifted (every `[r10 - X]` differs); the call
sequence, error-site order, closure order and block order are all much closer.

## Evidence (original disassembly, offsets from 0x5b3b0)

Callee sequence with each callee's own Source lines resolved (`origlines.py`, `calls.py`):
closures in original physical order are 571, 673, 692, 589, 744, 624, 736.

1. `fee_config.to_account_info().data_len()` and `buy_fee_market_cap` (0x16f0, 0x17b0) run before
   the buy-only `post_fee_amount(&quote_fee, amount)` (0x18e8): ours computed trade_amount first.
2. 0x1590..0x1700: a temporary `base_mint` AccountInfo clone, then the `[b"bonding-curve", key, &bump]`
   seed slice is written from `clone.key` (lddw "bonding-curve", len 0xd, len 0x20, len 1, bump byte),
   then the clone is dropped, all before the fee_config clone + data_len. So
   `let mint_key = h.base_mint.to_account_info().key; let bump = ..; let seeds = ..;` sits right after
   the :546 check (this is the callgraph-census t6 idea, now placed where the original has it).
3. `validate_buyback_fee_recipient_account` (0x11f8) gets r3 = `a.buyback_fee_recipient` AccountInfo
   pointer, r4 = 0, quote mint = 32-byte copy of `h.quote_mint.key()`, token program = 32-byte copy of
   the key of the `token_program_for` result (`[r10-0xac8]` is that AccountInfo's key pointer). No clones.
4. :546: first memcmp equal -> happy path; second memcmp equal -> happy path; the error block is the
   fallthrough. An `if .. {true} else if .. {false} else {return err!}` chain reproduces that.
5. Tail: after the TradeEvent CPI the original re-reads the curve's `real_token_reserves` (0x36e0,
   `ldxdw [curve+0x58]`, no `buy` test), and only in that branch stores `complete = 1` (0x38c0),
   emits CompleteEvent, then tests `post_fill` (0x3df8: None jumps to the HopOutput block). So the
   post-complete emission is nested inside the completion branch and the complete flag is written
   after the TradeEvent. (TradeEvent does not read `complete`.)

6. Buy arm (orig 0x2848, 0x2b58, 0x2c30): no `capped = min(..)`; the over-reserves arm yields
   `real_token_reserves` plus `post.base_out` (0 when `complete_fill` returns None, and 0 on the
   base <= reserves path) into one join doing `checked_add` (the :624 closure). `a.user.key()` and the
   global pointer are loaded before the mayhem test (0x22c0), so the memcmp block is 9 insns.
7. Each arm ends with its own transfer, apply and payout, then the join computes the transfer-fee
   difference (`r8 - [a70]` sell, `[a78] - r9` buy) and stores post_fill = None on the sell side.
8. The accrue_fees join copies a 64-byte aggregate whose first 32 bytes are
   `TradeFees{pf, cf, p_bps, c_bps}` (accrue_fees r4/r5 come from it) and trade_event's `fees`
   pointer is that copy (-0x730): the arms return a TradeFees value.

## Trials (ledger dedupe keys `0x5b3b0-main-016a11c-<key>-v1`)

| trial | key | result |
|---|---|---|
| t1 | hoist-cap-before-trade-amount | aligned calls 86 -> 93; partial (07bee23e) |
| t2 | early-seeds-clone-key-and-validate-quote-program-key | callee multiset identical; partial (654711e5) |
| v546a | discontinuous-check-if-not-buy-err | byte-identical to t2 (a161a826) |
| v546b | discontinuous-check-if-else-chain-let-buy | :546 error fallthrough as orig (61c3693b) |
| v546c | discontinuous-check-base-first-require | both memcmps unconditional, not orig (e4000a5b) |
| v546btA | completion-nested-after-trade-event-precomputed-bool | little change (20170f7e) |
| v546btB | completion-nested-after-trade-event-fresh-reserves-check | **kept** (e99be158) |
| v546ctB | completion-nested-on-base-first-require | exact 0.2115 but op 0.709 (979c910a) |
| ck1 | admit-vaults-single-curve-key-binding | admit region aligns insn-for-insn but native require_ata block moves and 43 insns of cleanup merge: 18,016 B; not kept (82610c19) |
| ck2/ck3 | admit-vaults-native-first-branch | byte-identical to their bases (e3ceca87) |
| mid1 | buy-post-out-join-checked-add-624 | opregs 0.6467 (1bb84685) |
| w1 | whitelist-check-user-key-hoisted | memcmp block 9 insns as orig, kept (14fadab4) |
| w2/w3 | whitelist-check-operands-swapped / negated-or | no change / identical (f6d2b86c, 5515fca6) |
| br1 | per-branch-transfer-apply-payout | opregs 0.6555, kept (91047878) |
| br2 | post-fill-as-branch-tuple-element | 18,616 B but op 0.687; not kept (d0950ac5) |
| br3 | trade-fees-struct-in-branch-tuple | opregs 0.6574, 590/599 sites separate, kept (1e4eab9e) |
| br3b | complete-fill-fees-bps-into-tuple | no gain, changes semantics (0a245ba2) |

## Remaining large regions (opregs alignment, v546btB)

- Buy-arm block placement: orig lays the buy chain (589 test, base==0, base>reserves, mayhem,
  err599) between the sell `transfer_quote_out` and the accrue join, and makes `complete_fill` the
  fallthrough of the whitelist memcmp; ours lets the sell chain fall into accrue_fees and the memcmp
  fall into err599.
- The orig 64-byte arm-result copy at the accrue join (ours copies less: SROA splits the tuple).
- post_complete_buy_event call block placed before the HopOutput block in orig, after the
  `From<ProgramError>` error block in ours.
- admit_vaults: orig copies the curve key once and reuses it (see ck1), but binding it moves the
  native `require_ata` block; the right spelling is still open.

## Tools (in this directory; run with the swarm `$TOOLS/harness` path as first argument)

`calls.py` (call list with callee Source lines), `origlines.py`, `cmp.py` (aligned orig/ours call
table), `shape.py` (exact/opregs/op ratios), `regions.py` (large unmatched regions), `rdiff.py`
(instruction diff of two ranges, immediates masked), `dis.py`, `trial.sh`, `var.py` (variant crates).
