# amm-multi-hop-fee-table-split-liquidity-chains-20261029

## Problem

The split route from 3rd #37 (main pool -> POOL2 -> P3; hop 1
selects a fee tier by the v2 cap rule, the tail hop prices off
exotic flat fees) meets main-pool liquidity. A deposit or withdraw
on the main pool moves the hop-1 cap
(supply * effective_quote / vault_base) and the vault balances,
so it should move the split trade -- but a proportional deposit
scales supply, vault base, and effective quote together, leaving
the cap exactly invariant. This packet pins what a main-pool
deposit/withdraw does and does not do to a split chain: which
legs move, which stay byte-identical, and where the limit gates
sit on the post-trade basis.

## Cases

32 cases, 78 steps, 234 receipts (3 images x 78 steps), 24 parts
(23 x 10 + 4). All cases run on the default fixture unless noted;
the split anchors are the same route as 3rd #37 (1e9 quote in for
buys, 1e9 BASE3 in for sells; fee tiers A = (lp 10, proto 111,
creator 333), B = (lp 20, proto 222, creator 444); cross threshold
T_BUY = 182,350,153,971 + 1e9 for buys, T_SELL_MID for sells).

Family A -- liquidity before a split trade (fresh fixture):

- `a-dep-buy`: deposit 1e9 LP (base -160,619,895,224, quote
  -29,312,410, fee 5,000) then a split buy. Tail out
  5,315,094,742,041, +10,020,083 vs the fresh buy
  (5,315,084,721,958); buyback unchanged at 4,607,153.
- `a-dep-buy-cross`: deposit, then two buys under tiers AB(T_BUY).
  Buy 1 stays tier A (buyback 5,489,071) and buy 2 stays tier B
  (10,858,932): the deposit does NOT flip the first buy's tier.
  Legs still move: buy 1 tail out 5,305,807,822,796 (+9,985,098
  vs fresh cross buy 1) and buy 2 tail out 5,058,296,009,968
  (+28,113,831 vs fresh cross buy 2).
- `a-dep12-buy-cross`: deposit 1e12 LP (base -160,619,895,223,680,
  quote -29,312,409,095). Buy 1 still tier A (5,489,071), buy 2
  still tier B (10,858,932): even a ~24% proportional deposit
  leaves the cap invariant and flips nothing. Buy 1 tail out
  5,313,874,850,864 (+8,077,013,166 vs fresh cross buy 1).
- `a-wd-buy`: withdraw 1e9 LP (base +160,619,895,223, quote
  +29,312,409) then a split buy. Tail out 5,315,074,697,094,
  -10,024,864 vs fresh; buyback unchanged.
- `a-wd-buy-cross`: withdraw, then two buys under AB(T_BUY).
  Buy 1 stays A (5,489,071), buy 2 stays B (10,858,932); legs
  move the other way (buy 1 -9,989,863, buy 2 -28,127,038).
- `a-dep-sell`: deposit then a split sell. Token legs are
  byte-identical to the fresh sell (quote out 180,345, buyback
  846); only lp_supply differs (+1e9 from the deposit).
- `a-dep-sell-cross`: deposit, then two sells under
  AB(T_SELL_MID). Sell 1 stays B (177,996) and sell 2 stays A
  (180,016) -- identical to the fresh cross.
- `a-dep-exotic`: deposit, then a split buy with exotic creator
  333 on the tail hop. Tail creator accrual 172,217,984,424
  (+326,402 vs the no-deposit exotic buy's 172,217,658,022);
  tail out 5,145,098,593,894 (+9,701,260 vs 5,145,088,892,634).
- `a-dep-rebuild`: deposit, then a split buy under the
  tiers-only rebuild (fee_tiers only, stable and exotic zeroed).
  Buy 1 is tier A and the tail accrues only the seed 123,394:
  the rebuild trap from 3rd #37 survives the deposit.

Family B -- liquidity between split trades (post-trade basis):

- `b-buy-dep-buy`: buy, then deposit 1e9 LP priced off
  post-trade reserves (base -159,335,860,239, quote -29,548,629
  -- not the fresh-fixture -160,619,895,224 / -29,312,410),
  then a second buy. Second buy tail out 5,121,414,934,635,
  +9,581,068 vs the buy->buy second buy (5,121,405,353,567).
- `b-buy-wd-buy`: buy, withdraw 1e9 LP (base +159,335,860,238,
  quote +29,548,628), second buy tail out 5,121,395,767,923,
  -9,585,644 vs buy->buy second buy.
- `b-buy-dep-sell`: buy, deposit, sell. Sell out 187,229,
  buyback 879 -- byte-identical to the buy->sell sell; only
  lp_supply differs. The sell direction is deposit-blind even
  mid-chain.
- `b-sell-dep-sell`: sell, deposit (base -160,620,133,044,
  quote -29,312,366 -- post-sell basis), sell. Second sell
  180,344, byte-identical to the sell->sell second sell.
- `b-buy-dep-swc-col`: buy, deposit, sweep main creator
  (123,394), collect it, sweep main protocol (4,609,642).
  The deposit leaves both buckets byte-identical; the main
  pool ends at (vq 0, protocol 0, creator 0).
- `b-buy-dep-buy-cross`: buy under AB(T_BUY) (tier A), deposit,
  second buy. Second buy stays tier B (10,858,932); tail out
  5,058,277,241,962 (+9,345,825 vs fresh cross buy 2).

Family C -- sweep before a split trade (leg neutrality):

- `c-swc-buy`: sweep main creator (123,394), then a split buy.
  Token legs byte-identical to the fresh buy; the pool state
  differs only by the relabel (creator 0, vq shifted by
  exactly the swept 123,394).
- `c-swp-buy`: sweep main protocol (2,488), then a split buy.
  Token legs byte-identical to the fresh buy; pool differs
  only by the relabel (protocol 4,607,154 vs 4,609,642).
- `c-swc-buy-cross`: sweep creator, then two buys under
  AB(T_BUY). Buy 1 tier A and buy 2 tier B, legs byte-identical
  to the fresh cross; pool differs only by the relabel.
- `c-swc-sell`: sweep creator, then a split sell. Legs
  byte-identical to the fresh sell; pool differs only by the
  relabel.

Family D -- limit gates on the post-trade basis:

- `d-buy-dep-limit-low`: buy, then deposit with maxquote
  29,548,628 (one below the post-trade quote 29,548,629) ->
  error 6004, full rollback (fee 5,000 only, 0 events).
- `d-buy-dep-limit-exact`: buy, then deposit with maxquote
  exactly 29,548,629 -> succeeds (base -159,335,860,239,
  quote -29,548,629).
- `d-buy-wd-limit-high`: buy, then withdraw with minquote
  29,548,629 (one above the post-trade quote 29,548,628) ->
  error 6004, full rollback.
- `d-buy-wd-limit-exact`: buy, then withdraw with minquote
  exactly 29,548,628 -> succeeds (base +159,335,860,238,
  quote +29,548,628).

Family E -- virtual-quote drift under the split route:

- `e-vq0-buy`: main vq patched to 0, then a split buy. Tail
  out 5,315,079,380,941, -5,341,017 vs the as-is buy: vq
  itself prices the split buy.
- `e-vq0-dep-buy`: main vq patched to 0, deposit (vq drifts
  0 -> +30, the same floor drift as 3rd #3), then a split
  buy. Tail out 5,315,089,401,004 -- the deposit move on top
  of the vq0 buy is +10,020,063, the same ~+10M shift as on
  the as-is fixture (within 20 units).

Family Z -- same-setup anchors (fresh fixture, no liquidity):

- `z-buy` (tail out 5,315,084,721,958, buyback 4,607,153),
  `z-sell` (180,345, 846), `z-buy-buy` (second buy
  5,121,405,353,567), `z-sell-sell` (second sell 180,344),
  `z-buy-sell` (sell 187,229, 879), `z-buy-cross` (buy 1 A
  5,305,797,837,698, buy 2 B 5,058,267,896,137),
  `z-sell-cross` (sell 1 B 177,996, sell 2 A 180,016).

## Result

- Buy legs are liquidity-sensitive, sell legs are
  liquidity-blind: a main-pool deposit/withdraw before or
  between trades moves every buy leg measured (from
  +9,581,068 on a mid-chain second buy to +8,077,013,166 on
  a 1e12-deposit cross buy) but leaves every sell leg
  byte-identical, before the trade, between trades, and
  across a tier cross. The sell mechanism is recorded as
  observed only, not asserted.
- The hop-1 tier never flips under liquidity: proportional
  deposits/withdraws leave the cap invariant, so buy 1 stays
  tier A and buy 2 stays tier B at every size measured
  (1e9 and 1e12), and a mid-chain deposit does not flip
  the second buy either.
- Post-trade liquidity reprices off post-trade reserves:
  the buy->deposit legs (-159,335,860,239 / -29,548,629)
  differ from the fresh legs, and the limit gates pin that
  basis exactly (deposit maxquote 29,548,629 passes,
  29,548,628 fails with 6004; withdraw minquote 29,548,628
  passes, 29,548,629 fails with 6004).
- Sweeps are leg-neutral for the split route: sweeping
  either main bucket before a split trade leaves the trade's
  token legs byte-identical (buys, sells, and cross buys);
  only the pool relabel differs (bucket zeroed, vq shifted
  by exactly the swept amount).
- The split's exotic tail and the tiers-only rebuild trap
  both survive liquidity: the deposit moves the exotic tail
  legs but does not restore the tail fee under the rebuild.
- The vq + accrued sum stays 0 across split trades and
  sweeps on this fixture, so no dep/wd step hits the
  can_boost drift branch; the vq0 fixture's +30 drift is a
  separate relabel that does not change the size of the
  deposit move.
- All three images (original, control #424, candidate #427)
  agree on every case: no original-vs-rebuilt divergence.

## Limits

- Fixture-specific: one route (main -> POOL2 -> P3), one
  input size per direction (1e9), one deposit/withdraw size
  per case (1e9, plus 1e12 in `a-dep12-buy-cross`). The
  cap-invariance argument is exact for proportional
  deposits, but non-proportional liquidity changes (a
  deposit that changes the base/quote ratio) were not
  measured here.
- The sell-leg blindness is an observed regularity on this
  fixture, not a proven property of the sell path; the
  mechanism is not asserted.
- No source change, no build, no claim of whole-program
  equivalence: the packet records executed receipts only.
