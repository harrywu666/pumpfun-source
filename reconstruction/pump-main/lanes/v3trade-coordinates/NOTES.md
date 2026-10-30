# Lane v3trade-coordinates

Targets: V3 trade handlers in `programs/pump/src/trade_v3.rs`.

## Coordinate archaeology

`coords.py window` vs `coords.py fn` on baseline d2cb88d: every Source{file,line} site in all
three windows already sits on its original line (buy 801/802/842; sell 1126/1127/1148;
buy_exact_quote 881/882/891/926/1001/993/935/971). Line placement is not the residual; slot
offsets differ (code shape before each site), e.g. buy_v3 first site at slot 1208 vs 1144,
buy_exact_quote 891 at 1752 vs 2296.

## Trial t01: port `sell-inline-quote-options` (e38 packet) onto main

Mechanism: `TradeFees` passed by reference into `trade_event`/`v3_emit_buy` (instead of a
4-tuple), inline `if is_sol{None}else{Some(..)}` quote-account args at each payment call,
`init_volume_user` helper, `emit_sell_cpi` helper, `v3_buy_costs` unconditional
`protocol_fee_split` + inline `pre_fee_amount`. The multi_hop_curve_swap hunk was re-applied by
hand (main had split the `Clock::get()` timestamp out).

| window | before (d2cb88d) | after t01 |
|---|---|---|
| 0x14a8a8 sell | 6056 B, ratio 0.443 | 6040 B, ratio 0.950 |
| 0x147ba0 buy | 3800 B, ratio 0.544 | 3712 B, ratio 0.645 |
| 0x1489f8 buy_exact_quote | 7800 B, ratio 0.303 | 7656 B, ratio 0.313 |

Official: normalized 1019, raw 188, gains [], losses []. unstripped sha256
a64a2f8ad78f5d3e2aa71c577f2b57c6b46a1f7b54fde1340b58ba3ea47bb61b. Ledger a45227c77891401a8631b2571d4cc63b.

## Trial b04: buy_v3 guard with scoped user key (adopted)

`let mut excess=0; let amount={let user_key=a.user.key(); if mayhem {if partial_fill{amount.min(real)}else{amount}} else if user_key!=a.global.whitelist_pda && amount>real {excess=amount-real;real} else {same clip}};`

The e38 `event-fees-volume-guard` shape (b01, ratio 0.706) bound the key at function scope, so
it got its own 32-byte stack slot and shifted every frame offset by 0x20. The original stores
the key in the -0xa8 temporary area that later calls reuse, i.e. the key is short-lived. Scoping
it inside the block expression lets stack coloring reuse the slot: frame offsets now match.

| window | t01 | b04 |
|---|---|---|
| 0x147ba0 buy | 3712 B, 0.645 | 3728 B, 0.849 |

Official 1019/188, no gains or losses. unstripped sha256 8336a2200d8502bf8dded3bd2286032a9255112ec466c7b3fd30ae08c3a0e009.
Rejected this round (ledger): single if/else-if chain (b02, b05), mutable-amount chain (b03),
precomputed `whitelisted` bool in either operand order (b07-b09), sell tail-expression
`emit_sell_cpi(..)` (t02: structurally closer but r8/r9 swap, 0.860), user/source quote Option
locals (s03-s05).

Remaining buy_v3 residuals: the original loads `a.global` before the key copy and shares one
partial-fill min clip between the mayhem path and the not-crossing path; the epilogue store/exit
is placed once at the end (ours duplicates it in the middle).

## Trial b23: whitelist reference bound before the key (adopted)

Inside the scoped block: `let whitelist=&a.global.whitelist_pda; let user_key=a.user.key();`
then compare `user_key!=*whitelist`. The original loads `a.global` in the entry block before
the 32-byte key copy and keeps it in r2 for the bcmp; binding the reference first reproduces
that (`let global=&a.global` alone does not: identical ELF to b04).

0x147ba0: 3728 B, ratio 0.849 -> 0.874 (rename-aware differing instructions 71 -> 59).
Official 1019/188, no gains or losses. unstripped sha256 edf9e4342ca16c6808ec90997deb50e2cd1fa17e94766d50beb365ec62d3e5d3.

Tried and identical/rejected: cmp::min / explicit-if / && clip spellings (b16-b20), crossing
condition order (b21), negated mayhem branch or match (b25, b27: same ELF), flat OR guard (b26),
excess-first then threaded clip (b13-b15), mutable assignment chains (b10-b12).

Remaining buy_v3 residuals are block placement: the non-mayhem whitelist block sits after the
NotEnoughTokensToBuy error block in the original (ours: right after the mayhem test, with the
clip head tail-duplicated), and the shared `?` error-return block (store r6/r7 to sret; exit)
is last in the original but mid-function in ours.

## Rebase note

#1210 (t01 + b04) merged into main as 298bf0858. This branch was reset onto main 016a11c7f
(which also has #1199 and #1189) and carries only the b23 change; official 1020/188 on that base,
no losses. Follow-up PR #1227.

## sell_v3 residual analysis (0x14a8a8, 6040 vs 6032 B)

Three shapes of the event-CPI tail, each right in a different way:
- `emit_sell_cpi(&ctx,&event)?; Ok(())` (current, t01): frame matches, because the helper's
  allocas are LLVM-inlined ahead of the MIR-inlined `Clock::get()?` residual temp. Costs a
  `tag==2` re-check of the `From<ProgramError>` result (the +8 B).
- inline `emit_cpi!(event); Ok(())` (s06): 6032 B, the original `jeq Ok / ja Err` branch and a
  direct return of the converted error. But the macro's locals then sit below the residual temp
  (frame top -0x28 vs -0x100), and the accounts pointer and result tag swap r8/r9.
- helper as the tail expression (t02, s08, s10): no re-check, but `jne` instead of `jeq`+`ja`
  (inlined helper block order), and the same r8/r9 swap.
Helper with `#[inline]` or no attribute is not inlined (s13/s14). An immediately-invoked closure
is not inlined (s11). Option locals for the payout accounts (s03-s05) are worse.

## buy_exact_quote analysis (0x1489f8)

`skel.py` (lane out dir) shows the call multisets match the original exactly (66 calls).
The differences are block order and frame: the original lays out the non-whitelist
`net_quote_for_budget` path first, materializes `can_cross` as a 0/1 phi tested with `&1`
(ours is jump-threaded per mayhem path), and has a 0x18-byte larger frame with the formatter at
the top and the fmt::Error ZST merged at -0x68 (ours unmerged at -0x1). With frame offsets
masked, 487 of 952 instructions still differ. User-key locals (e01-e03) and can_cross spellings
(e05-e08) did not help.

## Round 2 (base main 60bdd8a7a: buy 0.876 / sell 0.950 / exact 0.313, official 1020/188)

### sell_v3 payout wrappers (r05): 0.950 -> 0.987, rename-aware diff 47 -> 10

In the original, both payout calls load the Box pointers (`quote_mint`, `bonding_curve`,
`base_mint`) before the `if is_sol{None}else{Some(..)}` select, and dereference the mints
(`base_mint` info, `quote_mint.decimals`, `quote_mint` info) only after it. Rust evaluates
arguments left to right, so with `a.quote_mint.decimals` etc. written at the call site the
derefs are scheduled before the select. Fix: `#[inline(always)] fn pay_user` / `pay_owned`
wrappers that take `&InterfaceAccount<Mint>` for both mints and do `.as_ref()` / `.decimals`
inside, so the derefs come after all arguments, including the Options. Both wrappers are
needed (r06 user only: diff 30; r07 owned only: diff 27). The wrappers sit on the
`use crate::buy_fee_market_cap;` line so no Source line moves. Attempt id 2a6dd1547f56.

Residual (10 slots): the `-0x358` lea at the top of the prologue is scheduled 3 slots later,
and the event-CPI tail still has the helper's `tag==2` re-check.

### Rejected this round
- r01: `emit_sell_cpi` returning a raw `ProgramResult` (manual emit_cpi expansion) with
  `.map_err(Error::from)?` in the handler: 5904 B, frame and r8/r9 shifted.
- r02: `emit!` moved into the helper: byte-identical to main.
- x01-x03 (buy_exact_quote): the original disassembly at 0x149dc0-0x149e50 shows an unconditional
  `available.saturating_sub(first)` and a bitwise `can_cross & (available>first)`. Writing exactly
  that reproduces the local block, but the register-allocation cascade raises the masked diff from
  487 to 655 (x02 with `&&` 492, frame 0x378; original frame 0x388).
