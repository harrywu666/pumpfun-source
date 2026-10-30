# sellv2-reconstruction

Target: `0x144508` `sell_v2::execute` (original 13,976 B), programs/pump/src/sell_v2.rs:76.

## Metrics (target_metric.py; official census from score.py)

| trial | bytes | ratio | ordered callees | normalized/raw | gains/losses |
| --- | ---: | ---: | --- | --- | --- |
| baseline (d2cb88d + #1171) | 14,104 | 0.6620 | 79/80 (Clock::get before is_sol memcmp) | 1019/188 | none |
| is_sol before Clock (`issol`) | 14,128 | 0.6655 | 80/80 | 1019/188 | none |
| event snapshot reorder (`ev1B`) | 14,008 | 0.7873 | 80/80 | 1019/188 | none |
| + buyback_fee before bps (`t2_1`) | 13,984 | 0.8358 | 80/80 | 1019/188 | none |
| + sol reserve fields before timestamp (`t2_2`) | 13,992 | 0.8023 | 80/80 | 1019/188 | none |
| both (`t2_12`) | 13,952 | 0.8561 | 80/80 | 1019/188 | none |
| + creator-fee fields before holder fields (`t3_cfirst`) | 13,952 | 0.8660 | 80/80 | 1019/188 | none |
| options as tuple local before each payment (`t4_tuple`, not kept) | 13,984 | 0.8679 | 80/80 | 1019/188 | none |
| helpers take &InterfaceAccount<Mint> (ArgPromotion test, `ap_QU`, rejected) | 13,744 | 0.8844 | 80/80 | 1015/188 | 4 helper losses |
| typed-mint payment wrappers (`w_Qn`) | 13,912 | 0.9175 | 80/80 | 1019/188 | none |
| + `if native{NO_FEE}` const None (`t6_n`) | 13,936 | 0.9197 | 80/80 | 1019/188 | none |
| + `global.whitelist_pda==user.key()` fee check (`t6_w`) | 13,920 | 0.9319 | 80/80 | 1019/188 | none |
| both (`t6_nw`, committed) | 13,944 | 0.9398 | 80/80 | 1019/188 | none |
| ensure_rent_exempt uses `size` (`t7_size`, rejected) | 13,968 | 0.9629 | 80/80 | 1018/188 | 0x3b598 |

## Mechanism (ev1B)

Read from the original's event prelude (0x146658..0x147620):

1. The curve snapshot (four reserves, `creator`, `quote_mint`) is loaded right after the last
   `transfer_to_recipient` and *before* the `sharing_config` clone + `sharing_config_shareholders`.
2. `is_sol` (memcmp of the snapshot quote mint against zero) follows the shareholder drop.
3. `Clock::get` follows the `user`/`base_mint` key copies, i.e. `timestamp:Clock::get()?.unix_timestamp`
   sits inside the `TradeEvent` literal, the idiom the matched legacy sell in lib.rs uses.
4. The event's `quote_mint` field re-reads `c.quote_mint` (descending 0x40..0x28 loads), not the local.

5. In the literal, `buyback_fee:post_fee_amount(..)?` precedes `buyback_fee_basis_points` (the original
   reloads `is_mayhem_mode` after the post_fee_amount call), the virtual/real sol reserve fields precede
   `timestamp` (all three is_sol selects sit between the Clock call and its error check), and the
   creator-fee fields precede the holder-reward fields (LLVM emits these selects in reverse of source order).

6. Payments: the original call sites evaluate the base/quote mint derefs (`info` at +0x58, `decimals` at
   +0x30) after every other argument and after the `if native{None}else{Some(..)}` selects. Small sell_v2
   wrappers `pay_user/pay_owned/pay_recipient` that take `&InterfaceAccount<Mint>` and do the derefs when
   forwarding to `transfer_to_*` reproduce that (inlined; byte-identical with or without `#[inline(always)]`).
   Changing the helpers' own signatures instead does not get argument-promoted by LLVM here and breaks
   four matched helper windows.

7. The native `transfer_fee` is a const `None` (the original zeroes all four words of the Option, the
   `const NO_FEE` idiom `get_transfer_fee` already uses), and the fee-exemption check reads
   `a.global.whitelist_pda==a.user.key()` (original memcmp has the global field as the first operand).

## Open residual: ensure_rent_exempt size argument

All three original callers of the v2 `ensure_rent_exempt` (0x3b598: sell_v2 and both buy_v2 handlers)
materialize `mov r2,0` for the unused `size` argument and reuse that zero for a `None` spill. Our IR
(`--emit=llvm-ir` experiment) shows the function is `hidden` with `i64 %_size` unused, so
DeadArgumentElimination passes `poison` at every call site. Using `size` in `minimum_balance(size)`
fixes the caller (sell_v2 0.963, 13,968 B) but the callee then stops folding the constant and its window
is lost; `pub(crate)` makes DAE delete the parameter. The original must keep the argument live through
DAE while the callee still folds to `minimum_balance(0)`.

## Ledger attempt ids

- baseline control 0b87577c1dca41d9b3a00bab270af284
- is-sol-before-clock 7197c63dc78342208d17057fbc512bcc
- event-snapshot-before-shareholders (local quote_mint) 57e75cb5e6344b94b9ff11cb7296e190
- same with `quote_mint:c.quote_mint` 434effa992f04ff5a103951fa62910c8
- buyback-fee-before-bps 8544a136a4b2414da835a921156ca186
- sol-reserve-fields-before-timestamp 9033cd7d32084abf9df5ec3d0901ffec
- both 2811386b5e8a4c8da88dc0e52400938a
- creator-fee-fields-before-holder-fields d0a19528137c4f4bb13d219792671f11
- options tuple/two locals 57cad20403fc45a1b2bb322d4e07c821, 9f832fbff329404e8a4079ab803ff519 (+ variants 35167d65, 6d8634f8, 28d3d61e)
- argpromotion typed helper signatures a609d2f1eecd47f8a4701f37703fbb8c (rejected)
- typed-mint wrappers e0f6386aa8e94c6ab5482273711e9b64; user-token wrapper 37512c24171d4b599b1db4d755c865a3 (identical)
- NO_FEE const 2caf5e11079642c39b9ba336089df08a; whitelist global-first 83d83996a6de4848a3c3000eb2b671bc; both 99a01fd59f634a70a918febde43b4b9c
- ensure_rent_exempt size used (rejected), pub(crate) (rejected), IR analysis: see ledger keys 0x144508-main-d2cb88d-ensure-rent-exempt-*
