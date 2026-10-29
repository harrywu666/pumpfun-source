# Multi-hop fee-table split x liquidity under transfer fee at depth 4

## Problem

The 3-hop packet (3rd #52) and the 5-hop packet (3rd #53) combined three
ingredients: a fee-table split route (hop 1 picks a fee tier, the tail hop
pays exotic flat fees), a proportional deposit/withdraw on the head pool,
and a transfer fee (100 bps) on the quote mint. Both depths agreed that the
post-trade deposit basis is depth-invariant, but they disagreed on one
rounding point: under transfer fee plus a deposit, the tiers-only rebuild
buy came out exactly +1 over the tier-A buy at 3 hops, and exactly equal
at 5 hops. This packet is the even-depth check: the same 34 cases, the
same fixture, the same transfer-fee override, with the route at 4 hops
(main -> POOL2 -> P3 -> P4, tail token U4; P5 kept only as fixture state
outside the route).

## Cases

34 cases, 81 steps, 243 receipts (3 images x 81 steps), 25 parts of 10
receipts each (24 x 10 + 3). Route: quote in 1,000,000,000, tail out in U4.
Transfer fee 100 bps on the quote mint, except the tf5000 anchor cases
(5000 bps). The head pool (main) starts with virtual quote reserves
-125,882, protocol fees 2,488 and creator fees 123,394.

Families:

- `a-dep-buy`, `a-dep-buy-cross`, `a-dep12-buy-cross`: deposit 1e9 LP
  (1e12 LP for the dep12 case) on main, then buy / cross buy. Deposit
  event reports NET quote 29,312,410 on a gross 29,608,495 (withheld
  296,085).
- `a-wd-buy`, `a-wd-buy-cross`: withdraw 1e9 LP on main, then buy /
  cross buy. Withdraw event reports GROSS quote 29,312,409 on a net
  29,019,284 (withheld 293,125).
- `a-dep-sell`, `a-dep-sell-cross`: deposit 1e9 LP, then sell / cross
  sell.
- `a-dep-exotic`, `a-dep-rebuild`: deposit 1e9 LP, then the exotic
  (25, 5, 333) buy with creator sweep/collect, and the tiers-only
  rebuild buy with creator sweep/collect.
- `b-buy-dep-buy`, `b-buy-wd-buy`, `b-buy-dep-sell`, `b-sell-dep-sell`:
  trade first, then deposit/withdraw on main, then trade again.
- `b-buy-dep-swc-col`: buy, deposit, creator sweep/collect, protocol
  sweep.
- `b-buy-dep-buy-cross`: cross buy, tier-dependent deposit, cross buy.
- `c-swc-buy`, `c-swp-buy`, `c-swc-buy-cross`, `c-swc-sell`: sweep
  first, then trade.
- `e-vq0-buy`, `e-vq0-dep-buy`: main virtual quote reserves patched to
  0, then buy / deposit + buy.
- `z-*`: fresh-route anchors (buy, sell, buy-buy, sell-sell, buy-sell,
  buy-cross, sell-cross).
- `d-buy-dep-limit-*`, `d-buy-wd-limit-*`: post-trade deposit/withdraw
  limit gates, exact and one-off.
- `f-tf5000-buy`, `f-tf5000-dep-buy`: 5000 bps transfer-fee anchors.

## Result

All 34 cases pass on all three images (original, control, candidate):
signatures, token deltas, pool states, withheld amounts, events, error
codes and rollback all agree, with no divergent case. The headline
results, all measured:

- Buys are liquidity-sensitive, sells are liquidity-blind. Deposit 1e9
  LP on main moves the fresh 4-hop buy tail out from 5,235,288,546,505
  to 5,235,298,267,979 (+9,721,474); withdraw 1e9 LP moves it to
  5,235,278,820,388 (-9,726,117). The 3-hop moves were +9,824,327 /
  -9,829,019 and the 5-hop moves +9,620,226 / -9,624,823, so the
  deposit sensitivity is depth-dependent. Cross buy1 moves +9,687,702
  under deposit and -9,692,329 under withdraw; cross buy2 moves
  +26,922,783 and -26,935,436. The 1e12 deposit cross buy1 out is
  5,234,023,596,560 (+7,836,270,501 over the fresh cross buy1) and
  cross buy2 is 4,955,230,647,406 (+21,819,394,942).
- Every sell is byte-identical with or without a deposit or withdraw:
  fresh sell net 178,541 (withheld 1,804, buyback net 837 / withheld 9,
  gross 846); sell after sell 178,539; cross sell1 (tier B) 176,216
  (buyback net 2,000 / withheld 21, gross 2,021); cross sell2 (tier A)
  178,214 (buyback net 999 / withheld 11, gross 1,010); buy-then-sell
  187,248 (buyback net 879 / withheld 9, gross 888). The sell after a
  post-trade deposit is also 178,539, exactly the fresh sell-sell
  second sell.
- The transfer-fee post-trade basis is depth-invariant and identical to
  the 3-hop and 5-hop packets: after a buy, a deposit of 1e9 LP reports
  base -159,348,598,959, quote gross 29,844,714, net 29,546,266,
  withheld 298,448. After a buy, a withdraw of 1e9 LP reports base
  +159,348,598,958, net 29,250,802, withheld 295,463, gross 29,546,265.
  After a cross buy1, the deposit basis is tier-dependent: base
  -159,350,844,289, gross 29,844,293, net 29,545,850, withheld 298,443.
  After a sell, the deposit basis is base -160,620,133,043, gross
  29,608,451, net 29,312,366, withheld 296,085.
- The deposit cap is gross-side and the withdraw floor is net-side,
  with the same values as at 3 and 5 hops: deposit maxquote 29,844,714
  passes and 29,844,713 fails with custom error 6004 and full rollback;
  withdraw minquote 29,250,802 passes and 29,250,803 fails with 6004
  and full rollback. The deposit event reports NET and the withdraw
  event reports GROSS, as at the other depths.
- The tiers-only rebuild buy under a deposit comes out exactly +1 over
  the tier-A cross buy1 under the same deposit: 5,226,197,013,762
  versus 5,226,197,013,761. So the +1 rebuild rounding appears at 3
  hops and at 4 hops under transfer fee plus deposit, but not at 5
  hops, where the rebuild was exactly equal.
- The exotic trap survives under a deposit: the exotic (25, 5, 333) buy
  after a deposit accrues 169,618,839,378 to the tail creator bucket
  (+316,624 over the no-deposit 4-hop transfer-fee exotic buy's
  169,618,522,754), with tail out 5,067,841,299,433, and the creator
  sweep/collect drains exactly that bucket (sweep event amount
  169,618,839,378, bucket 1). The tiers-only rebuild sweep drains only
  the 123,394 seed.
- Sweeps are leg-neutral on the split route under transfer fee: creator
  sweep 123,394 (net 122,160, withheld 1,234) then collect (net
  120,938, withheld 1,222), and protocol sweep 4,563,570 (net
  4,517,934, withheld 45,636), leave the following buy, cross buy and
  sell byte-identical to the fresh ones. Protocol sweep of the 2,488
  seed leaves net 2,463 (withheld 25) and the following buy unchanged.
- Virtual-quote drift: patching main virtual quote reserves to 0 makes
  the buy tail out 5,235,283,312,313 (-5,234,192 from fresh); a deposit
  on the patched pool drifts virtual quote reserves to +30, and the
  following buy out is 5,235,293,033,768, which is 5,234,211 below the
  unpatched deposit buy (19 more than the unpatched vq0 penalty).
- Transfer-fee 5000 anchor: fresh buy tail out 2,675,231,312,484,
  buyback net 1,151,788 / withheld 1,151,789 (gross 2,303,577), vault
  quote withheld 500,000,000; after a deposit the buy out is
  2,675,233,850,951 (+2,538,467; the 3-hop move was +2,552,138 and the
  5-hop move +2,524,906).
- Depth rounding: second sell 178,539 (3-hop 178,540, 5-hop 178,539);
  cross second sell 178,214 (3-hop 178,215, 5-hop 178,214);
  buy-then-sell 187,248 (3-hop transfer-fee 185,288, 5-hop 189,218);
  deposit-buy move +9,721,474 (3-hop +9,824,327, 5-hop +9,620,226).
- Intermediate pools POOL2 and P3 never accrue in any case, and P5
  stays at fixture state; only the tail pool P4 accrues.

## Limits

- The deposit and withdraw amounts are fixed at 1e9 LP (1e12 LP for the
  dep12 case); no other deposit size was measured.
- The transfer fee is 100 bps (5000 bps only for the tf5000 anchors);
  no other rate was measured.
- The route is fixed at 4 hops with the same fixture pools as the 3-hop
  and 5-hop packets; no other fixture was measured.
- The +1 rebuild rounding at 4 hops is reported as a measured
  difference only; no mechanism for it is asserted.
- This packet contains no source change and no claim about any
  program other than the measured behavior above.
