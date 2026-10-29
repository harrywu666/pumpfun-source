# Opt-in public balance batches

`POST /v1/portfolio-summary/balances` computes a public batch response from an
explicit operator-owned aggregate-balance snapshot. A valid request has 1–50
Solana-format wallet strings. Every requested identity appears once in the
response; an unavailable local read is null. An available read preserves each
supplied nullable value independently, including actual zero values.

This is an independent, partial local read capability. It is not original backend
source, live Pump data, a chain indexer, fixture replay or qualified API
compatibility. No default balance dataset, provider URL or live RPC is enabled.
No prices, linked EVM wallets, financial totals or ownership are inferred.

## Documented and captured evidence

The official OpenAPI 0.294.0 operation is `post_portfolio_summary_balances`,
`positions.read`, with declared bearer auth on `https://api.pump.fun/v1`.
The JSON pointer is `/paths/~1portfolio-summary~1balances/post`. Both the public
spec and the captured contract establish the 1–50 body limit, every-wallet output,
independent null values and API-host owner restrictions.

Factory 593902 has complete SHA-256
`6a7a4b49fb31f0fa88c3201071ba62759646dfe5674f966e2c47b104b0529ccb`,
UTF-16 half-open range [316171,331650) in
`evidence/web/objects/2b47dd0b38a1608f.js`. The physical capture is 507,700 bytes,
SHA-256 `e78d2f38b06f971847c18dd05457c75afc85208135f50d6e4022a5f197e8839d`,
manifest URL `https://pump.fun/_next/static/immutable/chunks/2cr_aqnw2j4n5.js`.
It imports the same-capture publicRead helper 785036 and defineRoutes 183184;
these previously bound helpers are prerequisites, not new recovery credit.
The exact operation contract is [329163,329231).

The evidence test binds the complete factory/object and index origins, declared
method/path/scope/auth/server/body limits, public privacy descriptions and the
developer binding. Website origin remains unresolved and the binding has no
independent client call site. No rendered UI or website caller is claimed.
Captured JavaScript is never evaluated.

## Public projection and local materialization

`PortfolioBalancesDataset` has a local schema version, explicit `synthetic` or
`local-materialized` classification, valid UTC observation instant and wallet
facts. Each available row supplies only totalValueUsd, solPriceUsd and
nativeBalanceSol as finite JSON numbers or null. A null row explicitly records
unavailability. A wallet absent from this finite materialization is likewise an
unavailable local read, never an invented zero or an assertion about mainnet.

The public API host never establishes viewer ownership:

- Optional fresh and holdings booleans are accepted but grant no refresh or
  private-data capability. No client body field selects a principal.
- Every available public reply has perpCashUsd null, including otherwise known
  zero balances. Holdings is absent even when requested.
- Private holdings/perp-cash fields are rejected at materialization admission;
  they are not silently stored or passed through.
- Duplicate requested wallets collapse to one record key. Case and spelling
  stay exact. Validation checks the base58 alphabet, string bounds and exact
  32-byte decoded key width; this is not a private-key, ownership or
  on-chain-account validation.

The explicit file import happens before startup through
`PORTFOLIO_BALANCES_FILE`. It accepts a regular UTF-8 JSON file up to 16 MiB and
fails closed on corruption. The server never writes it and cannot import a
request-selected path or URL. Its in-memory snapshot and observation stamp stay
fixed until restart; API-host fresh does not reload the file. Classification is
an operator assertion, not provenance certification. Input and output objects do
not share mutable facts.

Run from app after the backend build:

```sh
PORTFOLIO_BALANCES_FILE=/absolute/operator-owned/balances.json \
  node packages/backend/dist/server.js
```

Programmatic integration passes `{ portfolioBalancesStore }` to buildApp.
Without it, the existing harness still returns 501. This does not enable the
other portfolio-summary operation, change the separate live SOL/token inventory
UI, or bypass the existing developer key-shape gate. That gate does not verify
key existence, scopes, revocation or rate limits. HTTP query/unknown-body-field
rejection and local 400 error envelopes are local policy, not upstream error
parity. No browser session, wallet connection, signing, reward or transaction
flow is involved.

## Validation and limits

Tests use clearly synthetic wallet-format identifiers and supplied aggregate
facts. They exercise actual loopback HTTP, public projection with every
fresh/holdings combination, partial unavailability, null versus zero, duplicates,
limits, malformed input, inherited auth, snapshot isolation and file reload on
restart. An updated file remains invisible to API-host fresh until an explicit
restart. Response schemas are checked against the official specification.

There is no valuation engine, canonical EVM-link discovery, production adapter,
cache, rate limiter, provider-failover result or upstream differential fixture.
Global native/qualified operation and feature-milestone counts stay unchanged.
