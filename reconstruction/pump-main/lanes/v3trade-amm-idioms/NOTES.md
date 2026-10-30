# Lane v3trade-amm-idioms

Targets: V3 trade handlers in `programs/pump/src/trade_v3.rs` (`trade::buy` 0x147ba0,
`trade::sell` 0x14a8a8, `trade::buy_exact_quote` 0x1489f8). Approach: reuse spellings the same
team uses elsewhere (AMM/Fees/Mayhem and sibling Pump handlers) for the pieces that differ.

Base: branch `swarm/v3trade-coordinates` commit 911710013 (its t01 port), so both lanes compose.
Tools: `~/.cache/pumpfun-reconstruction/lanes/v3trade-amm-idioms/tools/` (`shape.py` structural
opcode/callee diff that ignores registers and stack offsets; `trial.sh` copy-edit-build-score).

## buy_v3 prologue: crossing guard via `v3_fee_exempt` with an argument temporary

The original copies `a.user.key()` into the shared -0xa8 scratch slot and loads `a.global`,
the curve and `real_token_reserves` *before* the `is_mayhem_mode` test, while the memcmp
runs only on the non-mayhem path. That is exactly what the inlined
`v3_fee_exempt(&a.global,&a.bonding_curve,&a.user.key())` call produces: argument
temporaries are evaluated before the callee's `curve.is_mayhem_mode ||` short circuit.
`buy_exact_quote` already spells its `can_cross` this way, so this is the sibling idiom.
A named `user_key` local instead gets its own 32-byte slot (frame +0x20, every stack offset
shifts).

The partial-fill clip as `if partial_fill{amount.min(real)}else{amount}` in the non-crossing
arm of an `(excess,amount)` tuple makes the crossing arm's `amount=real` share one block with
the clip (`mov r8,r7`), as in the original; `partial_fill && amount>=real` select-lowers instead.

| window | d2cb88d | coord t01 (base) | t14 (this) |
|---|---|---|---|
| 0x147ba0 buy | 3800 B, 0.544 | 3712 B, 0.645 | 3688 B, 0.876 |
| 0x14a8a8 sell | 6056 B, 0.443 | 6040 B, 0.950 | 6040 B, 0.950 |
| 0x1489f8 buy_exact_quote | 7800 B, 0.303 | 7656 B, 0.313 | 7656 B, 0.313 |

Official: normalized 1019, raw 188, gains [], losses []. unstripped sha256
cd6e97945c2e632b76f1406a0faad595ca8eb6ac80ec2d3a4227795b3b6d1249. Ledger 0x147ba0
`...-v3-fee-exempt-temp-key-tuple-min-clip-v1` (attempt da7618ee).

Residuals in buy (t14): the non-mayhem memcmp block sits inline (original: out of line after
the NotEnoughTokensToBuy error block, jumping back), after memcmp the original tests
`amount<=real` before the memcmp result, and the shared `Ok` return tail sits after the
v3_buy_costs error check in the original.

Related partials (ledger): `let exempt=v3_fee_exempt(..);` as its own statement plus
`if amount>real && !exempt` (t21) reproduces the original test order exactly (mayhem path
threads straight to excess=0) but swaps the partial/real registers (3680 B, 0.774); with the
`>=` clip (t25) the memcmp block moves out of line and the size is exactly 3672 B, but the
clip select-lowers (slots_diff 328).

## sell_v3: direct `emit_cpi!` (analysis partial, not committed)

Replacing the `emit_sell_cpi` helper with `emit_cpi!(event)` in `sell` (t34) removes the helper's
`r9==2` Result re-check; the invoke_signed error path then jumps straight to the shared return
as in the original, and sell reaches exactly 6032 B (slots_diff 135). Ratio drops 0.950 -> 0.847
because the accounts pointer and result phi swap r8/r9 and one 32-byte key temporary is colored
into the -0x28 slot instead of -0x100. The original therefore has the no-recheck control flow
but the helper-like frame layout; reconciling the two is the open sell problem.

## buy_exact_quote

Frame is 0x18 deeper in the original (0x388 vs 0x370) and most offsets shift by 0x30; partial_fill
lives on the stack in the original (in r8 in ours). Not attacked further in this lane.

## Round 2: `exempt` local + `(amount,excess)` tuple order (buy_v3 0.8764 -> 0.8774, 3680 B)

The t21 spelling (`let exempt=v3_fee_exempt(..);` then `if amount>real && !exempt`) already had the
original test order (memcmp, then `amount<=real`, then the memcmp result) but swapped the
partial_fill/real registers (r6/r7). Declaring the tuple as `(amount,excess)` instead of
`(excess,amount)` (or, equivalently, `let mut excess=0;` before `let mut amount=amount;` in the
mutable form, which is byte-identical) fixes the register assignment: the prologue, clip and
crossing blocks now match the original instruction for instruction (`mov r1,r8; sub r1,r7` in
the crossing arm). MIR local order decides the vreg order and hence r6/r7.

| window | main (t14) | r2-u2 |
|---|---|---|
| 0x147ba0 buy | 3688 B, 0.8764 | 3680 B, 0.8774 |

Official: normalized 1020, raw 188 (vs d2cb88d baseline: gains [0x14f4e0] from main, losses []).
Ledger key `0x147ba0-main-d2cb88d-swapped-tuple-amount-excess-exempt-local-v1`
(attempt 839b545b).

Remaining buy residual: block placement only. The original lays out [clip][amount=real][join]
contiguously and puts the memcmp+crossing chain after the BuyZeroAmount error block (crossing
jumps back to `amount=real`); ours places memcmp+crossing+amount=real before the join. Also the
shared `Ok` exit tail placement. The `partial_fill && amount>=real` clip (t25/u4/w5/x3) moves the
memcmp chain out of line but select-lowers the clip (3672 B, r0.752).

Round-2 rejected (ledger): (amount,excess) with the temp guard (= t14), `!exempt && amount>real`
(= t14), real<amount clips, else-if `amount>real` clips, `real.min(amount)`.
