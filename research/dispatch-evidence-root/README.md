# Dispatch evidence-root asset transition

`scripts/recover_dispatch.py` now passes the caller's evidence root to
`program_names(root)`. Partial evidence checkouts and their archived selectors
previously selected programs from the tool's own checkout instead.

`transition.json` records this single script change under `scripts/README.md`'s
frozen-set convention. It binds the exact base (`abfda9f1`), the script's
before and after bytes, the revision that landed the change (`1526951b5`,
#2173), every later revision of the same script (`c405e78e9` #2188 and
`67be3f055`), the sealed direct Python script-name set at the base (275 files),
and the unchanged Fees/AMM capture bytes. Historical packages and their source
pins remain intact.

The verifier follows the asset through that lineage: the base bytes, the landed
bytes and each successor must hash to the recorded values, every recorded
revision must be an ancestor of `HEAD`, the working-tree script must equal the
last successor, and the accepted `program_names(root)` selection must still be
present. A successor the record does not name fails the check instead of
silently widening it.

The base script-name set is a historical fact and stays sealed. Later proposals
added 143 direct scripts to `scripts/` after the base and removed none, so the
verifier requires the base names to remain a subset of the current set rather
than equality with it; it also rechecks the sealed base count and digest.

The verifier reads the base commit from Git. In a shallow checkout, first run
`git fetch origin abfda9f14a99e03785e57afbb1e4018b1785219f`.
Run `python -I -B research/dispatch-evidence-root/verify.py`, then
`python -I -B tests/test_dispatch_root.py` and
`python -I -B tests/test_dispatch_transition_lineage.py`. This checks the
accepted asset transition, its lineage and local dispatch behavior; it
establishes no checkpoint acceptance, reconstruction equivalence, source-build
provenance or security clearance.
