# amm-multi-hop-five-hop-fee-table-split-liquidity-chains-20261029

## Problem

The split route from 3rd #37/#38 (main pool -> POOL2 -> P3 -> P4
-> P5; hop 1 selects a fee tier by the v2 cap rule, the tail hop
prices off exotic flat fees) meets main-pool liquidity at depth
5. This is the 5-hop generalization of 3rd #49 (split x
liquidity, 3 hops). A deposit or withdraw on the main pool moves
the hop-1 cap (supply * effective_quote / vault_base) and the
vault balances, so it should move the split trade -- but a
proportional deposit scales supply, vault base, and effective
quote together, leaving the cap exactly invariant. This packet
pins what a main-pool deposit/withdraw does and does not do to
a 5-hop split chain: which legs move, which stay byte-identical,
where the limit gates sit on the post-trade basis, and which
depth-rounding shifts the 5-hop route carries over the 3-hop one.

## Cases

32 cases, 78 steps, 234 receipts (3 images x 78 steps), 24 parts
(23 x 10 + 4). All cases run on the default fixture unless noted;
the split anchors are the same route as 3rd #38 (1e9 quote in for
buys, 1e9 BASE5 in for sells; fee tiers A = (lp 10, proto 111,
creator 333), B = (lp 20, proto 222, creator 444); cross threshold
T_BUY = 182,350,153,971 + 1e9 for buys, T_SELL_MID for sells).
The three images agree on every case (no divergence).

Family A -- liquidity before a split trade (fresh fixture):

- `a-dep-buy`: deposit 1e9 LP (base -160,619,895,224, quote
  -29,312,410, fee 5,000) then a split buy. Tail out
  5,259,050,280,623, +9,809,885 vs the fresh buy
  (5,259,040,470,738); buyback unchanged at 4,607,153.
- `a-dep-buy-cross`: deposit, then two buys under tiers AB(T_BUY).
  Buy 1 stays tier A (buyback 5,489,071) and buy 2 stays tier B
  (10,858,932): the deposit does NOT flip the first buy's tier.
  Legs still move: buy 1 tail out 5,249,958,011,207 (+9,775,995
  vs fresh cross buy 1) and buy 2 tail out 4,903,163,691,967
  (+26,787,563 vs fresh cross buy 2).
- `a-dep12-buy-cross`: deposit 1e12 LP (base -160,619,895,223,680,
  quote -29,312,409,095). Buy 1 still tier A (5,489,071), buy 2
  still tier B (10,858,932): even a ~24% proportional deposit
  leaves the cap invariant and flips nothing. Buy 1 tail out
  5,257,855,976,955 (+7,907,741,743 vs fresh cross buy 1).
- `a-wd-buy`: withdraw 1e9 LP (base +160,619,895,223, quote
  +29,312,409) then a split buy. Tail out 5,259,030,656,171,
  -9,814,567 vs fresh; buyback unchanged.
- `a-wd-buy-cross`: withdraw, then two buys under AB(T_BUY).
  Buy 1 stays A (5,489,071), buy 2 stays B (10,858,932); legs
  move the other way (buy 1 -9,780,662, buy 2 -26,800,154).
- `a-dep-sell`: deposit then a split sell. Token legs are
  byte-identical to the fresh sell (quote out 180,345, buyback
  846); only lp_supply differs (+1e9 from the deposit).
- `a-dep-sell-cross`: deposit, then two sells under
  AB(T_SELL_MID). Sell 1 stays B (177,996) and sell 2 stays A
  (180,015) -- identical to the fresh cross. Note the 5-hop
  second sell is 180,015, one below the 3-hop 180,016: depth
  rounding, not a liquidity effect.
- `a-dep-exotic`: deposit, then a split buy with exotic creator
  333 on the tail hop. Tail creator accrual 170,392,450,600
  (+319,519 vs the no-deposit 5-hop exotic buy's
  170,392,131,081 from 3rd #38); the exotic tail survives the
  deposit, and the sweep/collect that follow drain it exactly.
- `a-dep-rebuild`: deposit, then a split buy under the
  tiers-only rebuild (fee_tiers only, stable and exotic zeroed).
  Buy 1 is tier A and the tail accrues only the seed 123,394:
  the rebuild trap from 3rd #37 survives the deposit. Under
  the deposit the rebuild buy out (5,249,958,011,207) is exactly
  equal to the tier-A cross buy 1 -- the +1 rebuild rounding
  seen in the no-deposit 5-hop route (3rd #38) does not survive
  the deposit.

Family B -- liquidity between split trades (post-trade basis):

- `b-buy-dep-buy`: buy, then deposit 1e9 LP priced off
  post-trade reserves (base -159,335,860,239, quote -29,548,629
  -- not the fresh-fixture -160,619,895,224 / -29,312,410),
  then a second buy. Second buy tail out 4,963,549,649,179,
  +9,192,340 vs the buy->buy second buy (4,963,540,456,839).
- `b-buy-wd-buy`: buy, withdraw 1e9 LP (base +159,335,860,238,
  quote +29,548,628), second buy tail out 4,963,531,260,109,
  -9,196,730 vs buy->buy second buy.
- `b-buy-dep-sell`: buy, deposit, sell. Sell out 191,240,
  buyback 898 -- byte-identical to the buy->sell sell; only
  lp_supply differs. The sell direction is deposit-blind even
  mid-chain.
- `b-sell-dep-sell`: sell, deposit (base -160,620,133,043,
  quote -29,312,366 -- post-sell basis, base one below the
  3-hop post-sell leg by depth rounding), sell. Second sell
  180,343, byte-identical to the sell->sell second sell.
- `b-buy-dep-swc-col`: buy, deposit, creator sweep (123,394),
  collect (123,394), protocol sweep (4,609,642). The main pool
  ends at (0, 0, 0): the deposit does not disturb the sweep /
  collect drain.
- `b-buy-dep-buy-cross`: buy under AB(T_BUY), deposit priced
  off post-trade reserves (base -159,338,127,887, quote
  -29,548,208), second buy stays tier B (10,858,932, tail out
  4,903,145,873,595). The tier does not flip mid-chain either.

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
- These four gate numbers are identical to 3rd #49's: dep/wd
  price off the main pool only, and the hop-1 legs are
  depth-invariant, so the 5-hop basis equals the 3-hop basis.

Family E -- virtual-quote drift:

- `e-vq0-buy`: main vq patched to 0, then a split buy. Tail out
  5,259,035,241,762, -5,228,976 vs the as-is buy: vq itself
  still prices the split buy at depth 5.
- `e-vq0-dep-buy`: vq patched to 0, then deposit, then a split
  buy. The deposit drifts vq 0 -> +30 (the same floor drift as
  3rd #49 / 3rd #3), and the buy tail out is 5,259,045,051,629:
  the dep move on top of vq0 (+9,809,867) matches the dep move
  on the as-is fixture (+9,809,885) to within 18.

Family Z -- anchors (fresh fixture, no liquidity):

- `z-buy`: tail out 5,259,040,470,738, buyback 4,607,153,
  main protocol 4,609,642. Intermediate pools POOL2/P3/P4 stay
  at seed (protocol 2,488, creator 123,394) in every buy case.
- `z-sell`: quote out 180,345, buyback 846.
- `z-buy-buy`: second buy tail out 4,963,540,456,839.
- `z-sell-sell`: second sell 180,343 -- one below the 3-hop
  second sell (180,344), depth rounding.
- `z-buy-sell`: sell out 191,240, buyback 898.
- `z-buy-cross`: buy 1 tier A (5,489,071, tail out
  5,249,948,235,212), buy 2 tier B (10,858,932, tail out
  4,903,136,904,404).
- `z-sell-cross`: sell 1 tier B (177,996, buyback 2,021),
  sell 2 tier A (180,015, buyback 1,010).

## Result

- Buys are liquidity-sensitive at depth 5 exactly as at depth 3:
  a pre-trade deposit/withdraw moves every buy leg by ~+9.8M /
  ~-9.8M at 1e9 scale, a mid-chain deposit/withdraw moves the
  second buy by ~+9.2M / ~-9.2M, and even a 1e12 proportional
  deposit cannot flip hop 1's fee tier because the cap is
  exactly invariant under proportional deposits.
- Sells are liquidity-blind at depth 5 exactly as at depth 3:
  pre-trade, mid-chain, and sweep-first sells are all
  byte-identical to their fresh anchors; only lp_supply moves.
- Sweeps are leg-neutral for the 5-hop split route: creator or
  protocol sweep first leaves the next split trade's token legs
  byte-identical.
- The exotic tail and the tiers-only rebuild trap both survive
  a deposit; the deposit removes the +1 rebuild rounding seen
  in the no-deposit 5-hop route.
- Depth-rounding deltas vs the 3-hop route (3rd #49), all
  measured: second sell 180,343 (vs 180,344), cross second sell
  180,015 (vs 180,016), post-sell deposit base -160,620,133,043
  (vs -160,620,133,044); hop-1 buy legs and all limit-gate
  numbers are depth-invariant.
- All three images (original, control #424, candidate #427)
  agree on every case: no original-vs-rebuilt divergence in
  this packet.

## Limits

- Only the main pool's deposit/withdraw is interleaved; the
  intermediate and tail pools' liquidity is not touched, and
  no transfer fee is applied (split x tf at depth 5 is 3rd
  #41, split x mode x tf at depth 5 is 3rd #47).
- The cap-invariance claim is measured on this fixture's
  proportional deposit/withdraw amounts (1e9, 1e12); it is not
  a proof for arbitrary non-proportional liquidity changes.
- No source change is proposed: this packet pins observed
  behavior for reimplementers, in the same spirit as 3rd #49.

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
