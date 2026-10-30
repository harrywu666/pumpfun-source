# amm-multi-hop-five-hop-fee-table-split-liquidity-tf-chains-20261029

## Problem

The split route from 3rd #37/#38 (main pool -> POOL2 -> P3 -> P4
-> P5; hop 1 selects a fee tier by the v2 cap rule, the tail hop
prices off exotic flat fees) meets main-pool liquidity UNDER
transfer fee on the quote mint, at depth 5. This is the 5-hop
generalization of 3rd #52 (split x liquidity x tf, 3 hops), which
itself combined 3rd #49 (split x liquidity, no fee) with 3rd #40
(split x tf, no liquidity). Every quote-mint leg grosses up at
tf100 (plus tf5000 anchors): the deposit quote leg, the buy
vault and buyback legs, the sell user leg, and the sweep/collect
pipes. The packet pins which of 3rd #52's findings survive the
extra two hops, which move by depth rounding, and where the limit
gates sit on the tf basis. Deposit events report NET, withdraw
events report GROSS, sweep/collect events report gross; withheld
stays isolated per hop account.

## Cases

34 cases, 81 steps, 243 receipts (3 images x 81 steps), 25 parts
(24 x 10 + 3). All cases run on the default fixture unless noted;
the split anchors are the same route as 3rd #38/#41 (1e9 quote in
for buys, 1e9 BASE5 in for sells; fee tiers A = (lp 10, proto 111,
creator 333), B = (lp 20, proto 222, creator 444); cross threshold
T_BUY = 182,350,153,971 + 1e9 for buys, T_SELL_MID for sells).
The quote mint carries tf100 unless a case says tf5000. The
three images agree on every case (no divergence).

Family A -- liquidity before a split trade (fresh fixture):

- `a-dep-buy`: deposit 1e9 LP (base -160,619,895,224, quote
  gross -29,608,495 / vault net +29,312,410 / withheld 296,085,
  fee 5,000) then a split buy. Tail out 5,207,964,856,117,
  +9,620,226 vs the fresh tf buy (5,207,955,235,891); buyback
  gross 4,561,082 (net 4,515,471 + withheld 45,611), vault
  quote withheld 10,000,000.
- `a-dep-buy-cross`: deposit, then two buys under tiers AB(T_BUY).
  Buy 1 stays tier A (buyback gross 5,434,181) and buy 2 stays
  tier B (buyback gross 10,750,342): the deposit does NOT flip
  the first buy's tier, exactly as in 3rd #52. Legs still move:
  buy 1 tail out 5,198,958,307,085 (+9,586,983 vs fresh cross
  buy 1) and buy 2 tail out 4,858,243,945,776 (+26,288,988 vs
  fresh cross buy 2).
- `a-dep12-buy-cross`: deposit 1e12 LP (base -160,619,895,223,680,
  quote gross -29,608,494,036 / net +29,312,409,095 / withheld
  296,084,941). Buy 1 still tier A (5,434,181), buy 2 still
  tier B (10,750,342): even a ~24% proportional deposit leaves
  the cap invariant and flips nothing. Buy 1 tail out
  5,206,703,458,431 (+7,754,738,329 vs fresh cross buy 1).
- `a-wd-buy`: withdraw 1e9 LP (base +160,619,895,223, user net
  +29,019,284 / withheld 293,125 / vault gross out 29,312,409)
  then a split buy. Tail out 5,207,945,611,068, -9,624,823 vs
  fresh; buyback gross unchanged at 4,561,082.
- `a-wd-buy-cross`: withdraw, then two buys under AB(T_BUY).
  Buy 1 stays A (5,434,181), buy 2 stays B (10,750,342); legs
  move the other way (buy 1 -9,591,561, buy 2 -26,301,341).
- `a-dep-sell`: deposit then a split sell. Token legs are
  byte-identical to the fresh tf sell (user net 178,541,
  withheld 1,804, buyback gross 846); only lp_supply differs
  (+1e9 from the deposit).
- `a-dep-sell-cross`: deposit, then two sells under
  AB(T_SELL_MID). Sell 1 stays B (net 176,216, withheld 1,780,
  gross 177,996, buyback gross 2,021) and sell 2 stays A (net
  178,214, withheld 1,801, gross 180,016, buyback gross 1,010)
  -- identical to the fresh tf cross, except the second sell
  sits one below the 3-hop value (178,214 vs 178,215): depth
  rounding, not a liquidity effect.
- `a-dep-exotic`: deposit, then a split buy with exotic creator
  333 on the tail hop. Tail creator accrual 168,728,626,470
  (+313,310 vs the no-deposit 5-hop tf exotic buy's
  168,728,313,160 from 3rd #41); tail out 5,041,377,747,009.
  The SPL tail sweep/collect that follow drain it exactly
  (no tf on BASE4).
- `a-dep-rebuild`: deposit, then a split buy under the
  tiers-only rebuild (fee_tiers only, stable and exotic zeroed).
  Buy 1 is tier A (buyback gross 5,434,181) and the tail
  accrues only the seed 123,394: the rebuild trap survives
  dep under tf at depth 5. But the rebuild buy out
  (5,198,958,307,085) is exactly equal to the tier-A cross buy
  1 under the same deposit -- the +1 seen in the 3-hop tf+dep
  rebuild (3rd #52) does NOT appear at depth 5. Recorded as
  observed only; the mechanism is not asserted.

Family B -- liquidity between split trades (post-trade basis):

- `b-buy-dep-buy`: buy, then deposit 1e9 LP priced off
  post-trade reserves (base -159,348,598,959, quote gross
  -29,844,714 / net +29,546,266 / withheld 298,448 -- the same
  tf post-trade legs as 3rd #52, because the hop-1 legs are
  depth-invariant), then a second buy. Second buy tail out
  4,918,098,103,172, +9,020,298 vs the buy->buy second buy
  (4,918,089,082,874).
- `b-buy-wd-buy`: buy, withdraw 1e9 LP (base +159,348,598,958,
  user net +29,250,802 / withheld 295,463 / vault gross out
  29,546,265), second buy tail out 4,918,080,058,269,
  -9,024,605 vs buy->buy second buy.
- `b-buy-dep-sell`: buy, deposit, sell. Sell net 189,218,
  withheld 1,912, buyback gross 888 -- byte-identical to the
  buy->sell sell; only lp_supply differs. The sell direction
  is deposit-blind even mid-chain, under tf too.
- `b-sell-dep-sell`: sell, deposit (base -160,620,133,044,
  quote gross -29,608,451 / net +29,312,366 / withheld
  296,085 -- post-sell basis), sell. Second sell net 178,539,
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
  4,858,226,458,016, +8,792,228 vs fresh cross buy 2).

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
- These four gate numbers are identical to 3rd #52's: dep/wd
  price off the main pool only, and the hop-1 legs are
  depth-invariant, so the 5-hop basis equals the 3-hop basis.

Family E -- virtual-quote drift under the split route (tf):

- `e-vq0-buy`: main vq patched to 0, then a split buy. Tail
  out 5,207,950,056,210, -5,179,681 vs the as-is tf buy: vq
  itself prices the split buy under tf too.
- `e-vq0-dep-buy`: main vq patched to 0, deposit (vq drifts
  0 -> +30, the same floor drift as 3rd #52 / 3rd #50 / 3rd #3),
  then a split buy. Tail out 5,207,959,676,421 -- the deposit
  move on top of the vq0 buy is +9,620,211, the same ~+9.6M
  shift as on the as-is fixture (+9,620,226, within 15 units).

Family Z -- same-setup anchors (fresh fixture, tf100):

- `z-buy` (tail out 5,207,955,235,891, buyback gross
  4,561,082, vault quote withheld 10,000,000 -- the hop-1
  legs match 3rd #52's fresh tf buy exactly; only the tail
  legs move with depth),
  `z-sell` (user net 178,541, withheld 1,804, buyback gross
  846 -- the 3rd #52 tf100 sell anchor, reproduced),
  `z-buy-buy` (second buy 4,918,089,082,874),
  `z-sell-sell` (second sell net 178,539 -- one below the
  3-hop 178,540, depth rounding),
  `z-buy-sell` (sell net 189,218, withheld 1,912 -- vs the
  3-hop tf 185,288, depth-dependent),
  `z-buy-cross` (buy 1 A 5,198,948,720,102, buy 2 B
  4,858,217,656,788),
  `z-sell-cross` (sell 1 B 176,216, sell 2 A 178,214).

Family F -- tf5000 anchors:

- `f-tf5000-buy`: buy under tf5000. Tail out 2,668,075,748,732,
  buyback gross 2,302,577 (net 1,151,788 + withheld 1,151,789),
  vault quote withheld 500,000,000 -- the 3rd #52 tf5000 buy
  anchor, reproduced.
- `f-tf5000-dep-buy`: deposit 1e9 LP under tf5000 (base
  -160,619,895,224, quote gross -58,624,820 / net +29,312,410
  / withheld 29,312,410 -- the 3rd #19 tf5000 dep leg,
  reproduced), then a split buy. Tail out 2,668,078,273,638,
  +2,524,906 vs the fresh tf5000 buy; buyback gross and vault
  withheld unchanged at 2,302,577 / 500,000,000.

## Result

- Buys stay liquidity-sensitive under tf at depth 5, sells stay
  liquidity-blind: a main-pool deposit/withdraw before or
  between trades moves every buy leg measured (from
  +8,792,228 on a mid-chain cross second buy to
  +7,754,738,329 on a 1e12-deposit cross buy) but leaves every
  sell leg byte-identical, before the trade, between trades,
  and across a tier cross. The sell mechanism is recorded as
  observed only, not asserted.
- The hop-1 tier never flips under liquidity, under tf either:
  proportional deposits/withdraws leave the cap invariant, so
  buy 1 stays tier A and buy 2 stays tier B at every size
  measured (1e9 and 1e12), and a mid-chain deposit does not
  flip the second buy either.
- Post-trade liquidity reprices off post-trade reserves, and
  the 5-hop tf post-trade basis is exactly the 3-hop tf basis:
  the tf buy leaves the same main-pool vault state at any
  depth, so the post-trade dep leg is base -159,348,598,959 /
  quote gross 29,844,714 (vs no-fee -159,335,860,239 /
  29,548,629), and the basis further depends on the preceding
  trade's tier (cross buy1 gives base -159,350,844,289 /
  gross 29,844,293). The limit gates pin the tf basis exactly,
  with opposite sides: dep cap gross-side (29,844,714 passes,
  29,844,713 fails with 6004), wd floor net-side (29,250,802
  passes, 29,250,803 fails with 6004). Deposit events report
  net, withdraw events report gross.
- Sweeps are leg-neutral for the split route under tf too:
  sweeping either main bucket first (through the TOKEN22
  pipes, gross in / net out / withheld isolated) leaves the
  next split trade's token legs byte-identical.
- The split's exotic tail and the tiers-only rebuild trap both
  survive dep under tf at depth 5; the rebuild rounding nuance
  does not: the rebuild buy out sits exactly on the tier-A
  cross buy 1 under the same deposit, where the 3-hop tf+dep
  rebuild (3rd #52) sat +1 above it. Recorded as observed
  only.
- Depth-rounding deltas vs the 3-hop route (3rd #52), all
  measured: second sell 178,539 (vs 178,540), cross second
  sell 178,214 (vs 178,215), buy->sell sell 189,218 (vs
  185,288), dep-buy tail move +9,620,226 (vs +9,824,327);
  hop-1 buy legs, post-trade dep/wd legs, and all limit-gate
  numbers are depth-invariant. Intermediate pools POOL2/P3/P4
  stay at seed in every case.
- All three images (original, control #424, candidate #427)
  agree on every case: no original-vs-rebuilt divergence.

## Limits

- Fixture-specific: one route (main -> POOL2 -> P3 -> P4 -> P5),
  one input size per direction (1e9), one deposit/withdraw size
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
