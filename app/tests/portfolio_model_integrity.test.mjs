import assert from "node:assert/strict";
import test from "node:test";
import {
  isPortfolioResponse,
  MAINNET_GENESIS_HASH,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../packages/frontend/src/app/portfolio/types.ts";

function tokenAccount({
  tokenAccount,
  mint,
  program,
  programId,
  rawAmount,
  decimals = 0,
  amount = rawAmount,
}) {
  return {
    tokenAccount,
    mint,
    owner: "synthetic-owner",
    program,
    programId,
    rawAmount,
    decimals,
    amount,
    state: "initialized",
    isNative: false,
    extensions: [],
  };
}

function valid() {
  const first = tokenAccount({
    tokenAccount: "synthetic-account-one",
    mint: "synthetic-mint-one",
    program: "spl-token",
    programId: SPL_TOKEN_PROGRAM_ID,
    rawAmount: "5",
  });
  const second = tokenAccount({
    tokenAccount: "synthetic-account-two",
    mint: "synthetic-mint-one",
    program: "spl-token",
    programId: SPL_TOKEN_PROGRAM_ID,
    rawAmount: "7",
  });
  const token2022 = tokenAccount({
    tokenAccount: "synthetic-account-three",
    mint: "synthetic-mint-two",
    program: "token-2022",
    programId: TOKEN_2022_PROGRAM_ID,
    rawAmount: "1",
  });
  return {
    ok: true,
    address: "synthetic-owner",
    cluster: "mainnet-beta",
    genesisHash: MAINNET_GENESIS_HASH,
    commitment: "confirmed",
    observedAt: "2026-10-30T00:00:00Z",
    endpointHost: "example.invalid",
    sol: { lamports: "1", amount: "0.000000001", contextSlot: 1 },
    splToken: {
      program: "spl-token",
      programId: SPL_TOKEN_PROGRAM_ID,
      contextSlot: 1,
      accounts: [first, second],
      mints: [
        {
          mint: "synthetic-mint-one",
          program: "spl-token",
          programId: SPL_TOKEN_PROGRAM_ID,
          rawAmount: "12",
          decimals: 0,
          amount: "12",
          accountCount: 2,
        },
      ],
    },
    token2022: {
      program: "token-2022",
      programId: TOKEN_2022_PROGRAM_ID,
      contextSlot: 2,
      accounts: [token2022],
      mints: [
        {
          mint: "synthetic-mint-two",
          program: "token-2022",
          programId: TOKEN_2022_PROGRAM_ID,
          rawAmount: "1",
          decimals: 0,
          amount: "1",
          accountCount: 1,
        },
      ],
    },
    snapshotAtomic: false,
  };
}

test("portfolio response guard accepts a consistent holdings model", () => {
  assert.equal(isPortfolioResponse(valid(), "synthetic-owner"), true);
});

const invalidModels = [
  [
    "rejects a mint total that disagrees with its token accounts",
    (response) => {
      response.splToken.mints[0].rawAmount = "13";
      response.splToken.mints[0].amount = "13";
    },
  ],
  [
    "rejects a mint account count that disagrees with its token accounts",
    (response) => {
      response.splToken.mints[0].accountCount = 3;
    },
  ],
  [
    "rejects mint decimals that disagree with its token accounts",
    (response) => {
      response.splToken.mints[0].decimals = 1;
      response.splToken.mints[0].amount = "1.2";
    },
  ],
  [
    "rejects a token account without a mint summary",
    (response) => {
      response.splToken.mints = [];
    },
  ],
  [
    "rejects a mint summary without token accounts",
    (response) => {
      response.splToken.mints.push({
        ...response.splToken.mints[0],
        mint: "synthetic-mint-three",
        rawAmount: "1",
        amount: "1",
        accountCount: 1,
      });
    },
  ],
  [
    "rejects duplicate token account identities within one program",
    (response) => {
      response.splToken.accounts[1].tokenAccount =
        response.splToken.accounts[0].tokenAccount;
    },
  ],
  [
    "rejects duplicate token account identities across programs",
    (response) => {
      response.token2022.accounts[0].tokenAccount =
        response.splToken.accounts[0].tokenAccount;
    },
  ],
  [
    "rejects a mint reported under both token programs",
    (response) => {
      const mint = "synthetic-mint-one";
      response.token2022.accounts[0].mint = mint;
      response.token2022.mints[0].mint = mint;
    },
  ],
];

for (const [name, mutate] of invalidModels) {
  test(name, () => {
    const response = valid();
    mutate(response);
    assert.equal(isPortfolioResponse(response, "synthetic-owner"), false, name);
  });
}
