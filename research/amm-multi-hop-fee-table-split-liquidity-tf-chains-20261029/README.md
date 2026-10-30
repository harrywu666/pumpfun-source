# amm-multi-hop-fee-table-split-liquidity-tf-chains-20261029

## Problem

The split route from 3rd #37 (main pool -> POOL2 -> P3; hop 1
selects a fee tier by the v2 cap rule, the tail hop prices off
exotic flat fees) meets main-pool liquidity UNDER transfer fee
on the quote mint. This is the tf combination of two earlier
packets: 3rd #49 (split x liquidity, no fee) and 3rd #40
(split x tf, no liquidity). Every quote-mint leg grosses up at
tf100 (plus tf5000 anchors): the deposit quote leg, the buy
vault and buyback legs, the sell user leg, and the sweep/collect
pipes. The packet pins which of 3rd #49's findings survive the
gross-up, which move, and where the limit gates sit on the tf
basis. Deposit events report NET, withdraw events report GROSS,
sweep/collect events report gross; withheld stays isolated per
hop account.

## Cases

34 cases, 81 steps, 243 receipts (3 images x 81 steps), 25 parts
(24 x 10 + 3). All cases run on the default fixture unless noted;
the split anchors are the same route as 3rd #37/#40 (1e9 quote in
for buys, 1e9 BASE3 in for sells; fee tiers A = (lp 10, proto 111,
creator 333), B = (lp 20, proto 222, creator 444); cross threshold
T_BUY = 182,350,153,971 + 1e9 for buys, T_SELL_MID for sells).
The quote mint carries tf100 unless a case says tf5000. The
three images agree on every case (no divergence).

Family A -- liquidity before a split trade (fresh fixture):

- `a-dep-buy`: deposit 1e9 LP (base -160,619,895,224, quote
  gross -29,608,495 / vault net +29,312,410 / withheld 296,085,
  fee 5,000) then a split buy. Tail out 5,262,920,106,229,
  +9,824,327 vs the fresh tf buy (5,262,910,281,902); buyback
  gross 4,561,082 (net 4,515,471 + withheld 45,611), vault
  quote withheld 10,000,000.
- `a-dep-buy-cross`: deposit, then two buys under tiers AB(T_BUY).
  Buy 1 stays tier A (buyback gross 5,434,181) and buy 2 stays
  tier B (buyback gross 10,750,342): the deposit does NOT flip
  the first buy's tier, exactly as in 3rd #49. Legs still move:
  buy 1 tail out 5,253,722,645,178 (+9,790,017 vs fresh cross
  buy 1) and buy 2 tail out 5,010,435,118,716 (+27,577,776 vs
  fresh cross buy 2).
- `a-dep12-buy-cross`: deposit 1e12 LP (base -160,619,895,223,680,
  quote gross -29,608,494,036 / net +29,312,409,095 / withheld
  296,084,941). Buy 1 still tier A (5,434,181), buy 2 still
  tier B (10,750,342): even a ~24% proportional deposit leaves
  the cap invariant and flips nothing. Buy 1 tail out
  5,261,631,950,451 (+7,919,095,290 vs fresh cross buy 1).
- `a-wd-buy`: withdraw 1e9 LP (base +160,619,895,223, user net
  +29,019,284 / withheld 293,125 / vault gross out 29,312,409)
  then a split buy. Tail out 5,262,900,452,883, -9,829,019 vs
  fresh; buyback gross unchanged at 4,561,082.
- `a-wd-buy-cross`: withdraw, then two buys under AB(T_BUY).
  Buy 1 stays A (5,434,181), buy 2 stays B (10,750,342); legs
  move the other way (buy 1 -9,794,696, buy 2 -27,590,732).
- `a-dep-sell`: deposit then a split sell. Token legs are
  byte-identical to the fresh tf sell (user net 178,541,
  withheld 1,804, buyback gross 846); only lp_supply differs
  (+1e9 from the deposit).
- `a-dep-sell-cross`: deposit, then two sells under
  AB(T_SELL_MID). Sell 1 stays B (net 176,216, withheld 1,780,
  gross 177,996, buyback gross 2,021) and sell 2 stays A (net
  178,215, withheld 1,801, gross 180,016, buyback gross 1,010)
  -- identical to the fresh tf cross.
- `a-dep-exotic`: deposit, then a split buy with exotic creator
  333 on the tail hop. Tail creator accrual 170,518,495,651
  (+319,991 vs the no-deposit tf exotic buy's 170,518,175,660
  from 3rd #40); tail out 5,094,584,146,611. The SPL tail
  sweep/collect that follow drain it exactly (no tf on BASE2).
- `a-dep-rebuild`: deposit, then a split buy under the
  tiers-only rebuild (fee_tiers only, stable and exotic zeroed).
  Buy 1 is tier A (buyback gross 5,434,181) and the tail
  accrues only the seed 123,394: the rebuild trap survives
  dep under tf. But the rebuild buy out (5,253,722,645,179) is
  exactly +1 vs the tier-A cross buy 1 under the same deposit
  (5,253,722,645,178) -- the no-fee dep rebuild (3rd #49) and
  the tf no-dep rebuild (3rd #40) were both exactly equal, so
  the +1 appears only in the tf+dep combination. Recorded as
  observed only; the mechanism is not asserted.

Family B -- liquidity between split trades (post-trade basis):

- `b-buy-dep-buy`: buy, then deposit 1e9 LP priced off
  post-trade reserves (base -159,348,598,959, quote gross
  -29,844,714 / net +29,546,266 / withheld 298,448 -- NOT the
  fresh-fixture legs, and NOT the no-fee post-trade legs
  -159,335,860,239 / -29,548,629 from 3rd #49, because the tf
  buy leaves different vault state), then a second buy.
  Second buy tail out 5,072,990,104,313, +9,398,036 vs the
  buy->buy second buy (5,072,980,706,277).
- `b-buy-wd-buy`: buy, withdraw 1e9 LP (base +159,348,598,958,
  user net +29,250,802 / withheld 295,463 / vault gross out
  29,546,265), second buy tail out 5,072,971,303,754,
  -9,402,523 vs buy->buy second buy.
- `b-buy-dep-sell`: buy, deposit, sell. Sell net 185,288,
  withheld 1,872, buyback gross 878 -- byte-identical to the
  buy->sell sell; only lp_supply differs. The sell direction
  is deposit-blind even mid-chain, under tf too.
- `b-sell-dep-sell`: sell, deposit (base -160,620,133,044,
  quote gross -29,608,451 / net +29,312,366 / withheld
  296,085 -- post-sell basis), sell. Second sell net 178,540,
  byte-identical to the sell->sell second sell.
- `b-buy-dep-swc-col`: buy, deposit, sweep main creator
  (gross 123,394 -> net 122,160, withheld 1,234), collect it
  (net 120,938, withheld 1,222), sweep main protocol (gross
  4,563,570 -> net 4,517,934, withheld 45,636). The deposit
  leaves both buckets byte-identical to the no-dep tf pipes
  from 3rd #40/#46; the main pool ends at (vq 0, protocol 0,
  creator 0), with the first hop's withheld 1,234 isolated in
  the vault ATA.
- `b-buy-dep-buy-cross`: buy under AB(T_BUY) (tier A), deposit
  priced off post-trade reserves (base -159,350,844,289,
  quote gross -29,844,293 / net +29,545,850 / withheld
  298,443 -- a different post-trade basis than `b-buy-dep-buy`
  because the tier-A cross buy leaves different vault state),
  second buy stays tier B (buyback gross 10,750,342, tail out
  5,010,435,108,148, +9,167,208 vs fresh cross buy 2).

Family C -- sweep before a split trade (leg neutrality, tf):

- `c-swc-buy`: sweep main creator (gross 123,394 -> net
  122,160, withheld 1,234), then a split buy. Token legs
  byte-identical to the fresh tf buy; the pool state differs
  only by the relabel (creator 0, vq shifted by exactly the
  swept 123,394).
- `c-swp-buy`: sweep main protocol (gross 2,488 -> net 2,463,
  withheld 25), then a split buy. Token legs byte-identical
  to the fresh tf buy; pool differs only by the relabel.
- `c-swc-buy-cross`: sweep creator, then two buys under
  AB(T_BUY). Buy 1 tier A and buy 2 tier B, legs byte-identical
  to the fresh tf cross; pool differs only by the relabel.
- `c-swc-sell`: sweep creator, then a split sell. Legs
  byte-identical to the fresh tf sell (net 178,541).

Family D -- limit gates on the post-trade tf basis:

- `d-buy-dep-limit-low`: buy, then deposit with maxquote
  29,844,713 (one below the post-trade gross 29,844,714) ->
  error 6004, full rollback (fee 5,000 only, 0 events).
- `d-buy-dep-limit-exact`: buy, then deposit with maxquote
  exactly 29,844,714 -> succeeds (base -159,348,598,959,
  quote gross -29,844,714 / net +29,546,266). The dep cap is
  gross-side: the net value 29,546,266 as maxquote would fail.
- `d-buy-wd-limit-high`: buy, then withdraw with minquote
  29,250,803 (one above the post-trade net 29,250,802) ->
  error 6004, full rollback.
- `d-buy-wd-limit-exact`: buy, then withdraw with minquote
  exactly 29,250,802 -> succeeds (base +159,348,598,958,
  user net +29,250,802). The wd floor is net-side: the gross
  value 29,546,265 as minquote would fail.

Family E -- virtual-quote drift under the split route (tf):

- `e-vq0-buy`: main vq patched to 0, then a split buy. Tail
  out 5,262,904,992,332, -5,289,570 vs the as-is tf buy: vq
  itself prices the split buy under tf too.
- `e-vq0-dep-buy`: main vq patched to 0, deposit (vq drifts
  0 -> +30, the same floor drift as 3rd #49 / 3rd #3), then a
  split buy. Tail out 5,262,914,816,640 -- the deposit move on
  top of the vq0 buy is +9,824,308, the same ~+9.8M shift as
  on the as-is fixture (+9,824,327, within 19 units).

Family Z -- same-setup anchors (fresh fixture, tf100):

- `z-buy` (tail out 5,262,910,281,902, buyback gross
  4,561,082, vault quote withheld 10,000,000 -- the 3rd #30
  tf100 buy anchor, reproduced),
  `z-sell` (user net 178,541, withheld 1,804, buyback gross
  846 -- the 3rd #30 tf100 sell anchor, reproduced),
  `z-buy-buy` (second buy 5,072,980,706,277),
  `z-sell-sell` (second sell net 178,540),
  `z-buy-sell` (sell net 185,288, withheld 1,872),
  `z-buy-cross` (buy 1 A 5,253,712,851,161, buy 2 B
  5,010,425,940,940),
  `z-sell-cross` (sell 1 B 176,216, sell 2 A 178,215).

Family F -- tf5000 anchors:

- `f-tf5000-buy`: buy under tf5000. Tail out 2,682,425,360,738,
  buyback gross 2,302,577 (net 1,151,788 + withheld 1,151,789),
  vault quote withheld 500,000,000 -- the 3rd #40 tf5000 buy
  anchor, reproduced.
- `f-tf5000-dep-buy`: deposit 1e9 LP under tf5000 (base
  -160,619,895,224, quote gross -58,624,820 / net +29,312,410
  / withheld 29,312,410 -- the 3rd #19 tf5000 dep leg,
  reproduced), then a split buy. Tail out 2,682,427,912,876,
  +2,552,138 vs the fresh tf5000 buy; buyback gross and vault
  withheld unchanged at 2,302,577 / 500,000,000.

## Result

- Buys stay liquidity-sensitive under tf, sells stay
  liquidity-blind: a main-pool deposit/withdraw before or
  between trades moves every buy leg measured (from
  +9,167,208 on a mid-chain cross second buy to
  +7,919,095,290 on a 1e12-deposit cross buy) but leaves every
  sell leg byte-identical, before the trade, between trades,
  and across a tier cross. The sell mechanism is recorded as
  observed only, not asserted.
- The hop-1 tier never flips under liquidity, under tf either:
  proportional deposits/withdraws leave the cap invariant, so
  buy 1 stays tier A and buy 2 stays tier B at every size
  measured (1e9 and 1e12), and a mid-chain deposit does not
  flip the second buy either.
- Post-trade liquidity reprices off post-trade reserves, but
  the tf post-trade basis is NOT the no-fee post-trade basis:
  the tf buy leaves different vault state, so the post-trade
  dep leg is base -159,348,598,959 / quote gross 29,844,714
  (vs no-fee -159,335,860,239 / 29,548,629), and the basis
  further depends on the preceding trade's tier (cross buy1
  gives base -159,350,844,289 / gross 29,844,293). The limit
  gates pin the tf basis exactly, with opposite sides: dep
  cap gross-side (29,844,714 passes, 29,844,713 fails with
  6004), wd floor net-side (29,250,802 passes, 29,250,803
  fails with 6004). Deposit events report net, withdraw
  events report gross.
- Sweeps are leg-neutral for the split route under tf too:
  sweeping either main bucket first (through the TOKEN22
  pipes, gross in / net out / withheld isolated) leaves the
  next split trade's token legs byte-identical.
- The split's exotic tail and the tiers-only rebuild trap both
  survive dep under tf; the tf+dep combination adds one
  rounding nuance neither parent packet showed: the rebuild
  buy out sits +1 above the tier-A cross buy 1 under the same
  deposit (3rd #49 dep rebuild and 3rd #40 tf rebuild were
  both exactly equal). Recorded as observed only.
- The vq + accrued sum stays 0 across split trades and
  sweeps on this fixture, so no dep/wd step hits the
  can_boost drift branch; the vq0 fixture's +30 drift is a
  separate relabel that does not change the size of the
  deposit move (within 19 units).
- All three images (original, control #424, candidate #427)
  agree on every case: no original-vs-rebuilt divergence.

## Limits

- Fixture-specific: one route (main -> POOL2 -> P3), one
  input size per direction (1e9), one deposit/withdraw size
  per case (1e9, plus 1e12 in `a-dep12-buy-cross`), tf100
  throughout except family F (tf5000). The cap-invariance
  argument is exact for proportional deposits, but
  non-proportional liquidity changes (a deposit that changes
  the base/quote ratio) were not measured here.
- The sell-leg blindness is an observed regularity on this
  fixture, not a proven property of the sell path; the
  mechanism is not asserted.
- No source change, no build, no claim of whole-program
  equivalence: the packet records executed receipts only.

## Files

- `producer.py` -- the builder; reruns the harness and rewrites
  `runtime/` (receipts + report).
- `verify.py` -- independent re-verification from the packet
  files alone (signatures, deltas, withheld, events, error
  codes/sites, rollback, 3-image agreement, MANIFEST hashes).
- `runtime/report.json.gz` -- per-case expected values and
  part hashes.
- `runtime/raw-transactions-part01..25.jsonl.gz` -- 243
  receipts, 10 per part except part25 (3).
- `MANIFEST.json` -- sha256 of every packet file except itself.
