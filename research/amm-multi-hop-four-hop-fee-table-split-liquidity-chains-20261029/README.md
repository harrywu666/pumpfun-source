# amm-multi-hop-four-hop-fee-table-split-liquidity-chains-20261029

## Problem

The split route from 3rd #37/#39 (main pool -> POOL2 -> P3 -> P4;
hop 1 selects a fee tier by the v2 cap rule, the tail hop prices
off exotic flat fees) meets main-pool liquidity at depth 4. This
is the even-hop check of 3rd #49 (split x liquidity, 3 hops) and
3rd #50 (split x liquidity, 5 hops). A deposit or withdraw on the
main pool moves the hop-1 cap (supply * effective_quote /
vault_base) and the vault balances, so it should move the split
trade -- but a proportional deposit scales supply, vault base,
and effective quote together, leaving the cap exactly invariant.
This packet pins what a main-pool deposit/withdraw does and does
not do to a 4-hop split chain: which legs move, which stay
byte-identical, where the limit gates sit on the post-trade
basis, and which depth-rounding shifts the 4-hop route carries
over the 3-hop and 5-hop ones.

## Cases

32 cases, 78 steps, 234 receipts (3 images x 78 steps), 24 parts
(23 x 10 + 4). All cases run on the default fixture unless noted;
the split anchors are the same route as 3rd #39 (1e9 quote in for
buys, 1e9 BASE4 in for sells; fee tiers A = (lp 10, proto 111,
creator 333), B = (lp 20, proto 222, creator 444); cross threshold
T_BUY = 182,350,153,971 + 1e9 for buys, T_SELL_MID for sells).
The three images agree on every case (no divergence).

Family A -- liquidity before a split trade (fresh fixture):

- `a-dep-buy`: deposit 1e9 LP (base -160,619,895,224, quote
  -29,312,410, fee 5,000) then a split buy. Tail out
  5,286,923,989,552, +9,914,148 vs the fresh buy
  (5,286,914,075,404); buyback unchanged at 4,607,153.
- `a-dep-buy-cross`: deposit, then two buys under tiers AB(T_BUY).
  Buy 1 stays tier A (buyback 5,489,071) and buy 2 stays tier B
  (10,858,932): the deposit does NOT flip the first buy's tier.
  Legs still move: buy 1 tail out 5,277,735,168,295 (+9,879,716
  vs fresh cross buy 1) and buy 2 tail out 4,979,792,815,706
  (+27,439,687 vs fresh cross buy 2).
- `a-dep12-buy-cross`: deposit 1e12 LP (base -160,619,895,223,680,
  quote -29,312,409,095). Buy 1 still tier A (5,489,071), buy 2
  still tier B (10,858,932): even a ~24% proportional deposit
  leaves the cap invariant and flips nothing. Buy 1 tail out
  5,285,716,993,829 (+7,991,705,250 vs fresh cross buy 1).
- `a-wd-buy`: withdraw 1e9 LP (base +160,619,895,223, quote
  +29,312,409) then a split buy. Tail out 5,286,904,156,525,
  -9,918,879 vs fresh; buyback unchanged.
- `a-wd-buy-cross`: withdraw, then two buys under AB(T_BUY).
  Buy 1 stays A (5,489,071), buy 2 stays B (10,858,932); legs
  move the other way (buy 1 -9,884,433, buy 2 -27,452,580).
- `a-dep-sell`: deposit then a split sell. Token legs are
  byte-identical to the fresh sell (quote out 180,345, buyback
  846); only lp_supply differs (+1e9 from the deposit).
- `a-dep-sell-cross`: deposit, then two sells under
  AB(T_SELL_MID). Sell 1 stays B (177,996) and sell 2 stays A
  (180,015) -- identical to the fresh cross.
- `a-dep-exotic`: deposit, then a split buy with exotic creator
  333 on the tail hop. Tail creator accrual 171,300,354,006
  (+322,933 vs the no-deposit 4-hop exotic buy's
  171,300,031,073 from 3rd #39); tail out 5,117,824,209,171
  (+9,598,680 vs the no-deposit exotic out 5,117,814,610,491).
  The exotic tail survives the deposit, and the sweep/collect
  that follow drain it exactly.
- `a-dep-rebuild`: deposit, then a split buy under the
  tiers-only rebuild (fee_tiers only, stable and exotic zeroed).
  Buy 1 is tier A and the tail accrues only the seed 123,394:
  the rebuild trap from 3rd #37 survives the deposit. Under
  the deposit the rebuild buy out (5,277,735,168,296) is
  exactly +1 vs the tier-A cross buy 1 under the same deposit
  (5,277,735,168,295) -- the +1 rebuild rounding that the
  no-deposit 4-hop route (3rd #39) did NOT show, and that the
  5-hop deposit route (3rd #50) did NOT show either, appears
  here in the 4-hop deposit combination. Recorded as observed
  only; the mechanism is not asserted.

Family B -- liquidity between split trades (post-trade basis):

- `b-buy-dep-buy`: buy, then deposit 1e9 LP priced off
  post-trade reserves (base -159,335,860,239, quote -29,548,629
  -- not the fresh-fixture -160,619,895,224 / -29,312,410),
  then a second buy. Second buy tail out 5,041,523,374,222,
  +9,383,687 vs the buy->buy second buy (5,041,513,990,535).
- `b-buy-wd-buy`: buy, withdraw 1e9 LP (base +159,335,860,238,
  quote +29,548,628), second buy tail out 5,041,504,602,369,
  -9,388,166 vs buy->buy second buy.
- `b-buy-dep-sell`: buy, deposit, sell. Sell out 189,230,
  buyback 888 -- byte-identical to the buy->sell sell; only
  lp_supply differs. The sell direction is deposit-blind even
  mid-chain.
- `b-sell-dep-sell`: sell, deposit (base -160,620,133,043,
  quote -29,312,366 -- post-sell basis, base equal to the 5-hop
  post-sell leg and one below the 3-hop leg by depth rounding),
  sell. Second sell 180,343, byte-identical to the sell->sell
  second sell.
- `b-buy-dep-swc-col`: buy, deposit, creator sweep (123,394),
  collect (123,394), protocol sweep (4,609,642). The main pool
  ends at (0, 0, 0): the deposit does not disturb the sweep /
  collect drain.
- `b-buy-dep-buy-cross`: buy under AB(T_BUY), deposit priced
  off post-trade reserves (base -159,338,127,887, quote
  -29,548,208), second buy stays tier B (10,858,932, tail out
  4,979,774,530,622, +9,154,603 vs fresh cross buy 2). The tier
  does not flip mid-chain either.

Family C -- sweep before a split trade (leg-neutral):

- `c-swc-buy`: creator sweep (123,394) then a split buy. Token
  legs are byte-identical to the fresh buy; only the main pool
  relabel differs (creator bucket starts at 0).
- `c-swp-buy`: protocol sweep (2,488) then a split buy. Token
  legs are byte-identical to the fresh buy; the main protocol
  bucket accrues 4,607,154 instead of 4,609,642 because it
  started drained.
- `c-swc-buy-cross`: creator sweep, then two buys under
  AB(T_BUY). Buy 1 stays A, buy 2 stays B, legs byte-identical
  to the fresh cross: the sweep is tier-neutral too.
- `c-swc-sell`: creator sweep then a split sell. Token legs
  byte-identical to the fresh sell (180,345, buyback 846).

Family D -- limit gates on the post-trade basis:

- `d-buy-dep-limit-low`: buy, then deposit with maxquote
  29,548,628 (one below the post-trade leg) -> 6004, full
  rollback.
- `d-buy-dep-limit-exact`: buy, then deposit with maxquote
  29,548,629 -> success. The gate sits exactly on the
  post-trade leg, not the fresh-fixture leg.
- `d-buy-wd-limit-high`: buy, then withdraw with minquote
  29,548,629 (one above the post-trade leg) -> 6004, full
  rollback.
- `d-buy-wd-limit-exact`: buy, then withdraw with minquote
  29,548,628 -> success.
- These four gate numbers are identical to 3rd #49's and 3rd
  #50's: dep/wd price off the main pool only, and the hop-1
  legs are depth-invariant, so the 4-hop basis equals the
  3-hop and 5-hop bases.

Family E -- virtual-quote drift:

- `e-vq0-buy`: main vq patched to 0, then a split buy. Tail out
  5,286,908,790,852, -5,284,552 vs the as-is buy: vq itself
  still prices the split buy at depth 4.
- `e-vq0-dep-buy`: vq patched to 0, then deposit, then a split
  buy. The deposit drifts vq 0 -> +30 (the same floor drift as
  3rd #49 / 3rd #50 / 3rd #3), and the buy tail out is
  5,286,918,704,981: the dep move on top of vq0 (+9,914,129)
  matches the dep move on the as-is fixture (+9,914,148) to
  within 19.

Family Z -- anchors (fresh fixture, no liquidity):

- `z-buy`: tail out 5,286,914,075,404, buyback 4,607,153,
  main protocol 4,609,642. Intermediate pools POOL2/P3 stay
  at seed (protocol 2,488, creator 123,394) in every buy case;
  P5 stays at fixture state throughout (not part of the route).
- `z-sell`: quote out 180,345, buyback 846.
- `z-buy-buy`: second buy tail out 5,041,513,990,535.
- `z-sell-sell`: second sell 180,343 -- one below the 3-hop
  second sell (180,344), depth rounding; equal to the 5-hop
  second sell.
- `z-buy-sell`: sell out 189,230, buyback 888 -- depth-dependent:
  3-hop 187,229 (buyback 879), 5-hop 191,240 (buyback 898).
- `z-buy-cross`: buy 1 tier A (5,489,071, tail out
  5,277,725,288,579), buy 2 tier B (10,858,932, tail out
  4,979,765,376,019).
- `z-sell-cross`: sell 1 tier B (177,996, buyback 2,021),
  sell 2 tier A (180,015, buyback 1,010).

## Result

- Buys are liquidity-sensitive at depth 4 exactly as at depths 3
  and 5: a pre-trade deposit/withdraw moves every buy leg by
  ~+9.9M / ~-9.9M at 1e9 scale, a mid-chain deposit/withdraw
  moves the second buy by ~+9.4M / ~-9.4M, and even a 1e12
  proportional deposit cannot flip hop 1's fee tier because the
  cap is exactly invariant under proportional deposits.
- Sells are liquidity-blind at depth 4 exactly as at depths 3
  and 5: pre-trade, mid-chain, and sweep-first sells are all
  byte-identical to their fresh anchors; only lp_supply moves.
- Sweeps are leg-neutral for the 4-hop split route: creator or
  protocol sweep first leaves the next split trade's token legs
  byte-identical.
- The exotic tail and the tiers-only rebuild trap both survive
  a deposit; the deposit combination adds one rounding nuance
  the other depths did not show: the rebuild buy out sits +1
  above the tier-A cross buy 1 under the same deposit.
- Depth-rounding deltas vs the 3-hop route (3rd #49), all
  measured: buy->sell sell 189,230 (vs 187,229), second sell
  180,343 (vs 180,344), cross second sell 180,015 (vs 180,016),
  post-sell deposit base -160,620,133,043 (vs -160,620,133,044);
  hop-1 buy legs and all limit-gate numbers are depth-invariant.
  Vs the 5-hop route (3rd #50): buy->sell sell 189,230 (vs
  191,240), dep-buy tail move +9,914,148 (vs +9,809,885),
  dep rebuild out +1 vs tier-A (vs exactly equal).
- All three images (original, control #424, candidate #427)
  agree on every case: no original-vs-rebuilt divergence in
  this packet.

## Limits

- Only the main pool's deposit/withdraw is interleaved; the
  intermediate and tail pools' liquidity is not touched, and
  no transfer fee is applied (split x tf at depth 4 is 3rd
  #42, split x mode x tf at depth 4 is 3rd #48).
- The cap-invariance claim is measured on this fixture's
  proportional deposit/withdraw amounts (1e9, 1e12); it is not
  a proof for arbitrary non-proportional liquidity changes.
- No source change is proposed: this packet pins observed
  behavior for reimplementers, in the same spirit as 3rd #49
  and 3rd #50.

## Files

- `producer.py` -- the builder; reruns the harness and rewrites
  `runtime/` (receipts + report).
- `verify.py` -- independent re-verification from the packet
  files alone (signatures, deltas, events, error codes/sites,
  rollback, 3-image agreement, MANIFEST hashes).
- `runtime/report.json.gz` -- per-case expected values and
  part hashes.
- `runtime/raw-transactions-part01..24.jsonl.gz` -- 234
  receipts, 10 per part except part24 (4).
- `MANIFEST.json` -- sha256 of every packet file except itself.
