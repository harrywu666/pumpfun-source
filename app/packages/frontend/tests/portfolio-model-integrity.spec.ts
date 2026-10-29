import { expect, test } from "@playwright/test";

const WALLET = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const SPL_ACCOUNT_ONE = "69gGSxcFan4EoL63vdHsHeP8XNpXgVCEpcSu9P4fn6xa";
const SPL_ACCOUNT_TWO = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SPL_MINT = "Ht3cqPuEUR6jiNiFsF1n93TPokuq1jqiMKujAjDdxXCB";
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function tokenAccount(tokenAccount: string, rawAmount: string) {
  return {
    tokenAccount,
    mint: SPL_MINT,
    owner: WALLET,
    program: "spl-token",
    programId: SPL_TOKEN_PROGRAM_ID,
    rawAmount,
    decimals: 0,
    amount: rawAmount,
    state: "initialized",
    isNative: false,
    extensions: [],
  };
}

test("rejects internally contradictory portfolio totals before rendering", async ({
  page,
}) => {
  await page.route("**/api/portfolio?*", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        address: WALLET,
        cluster: "mainnet-beta",
        genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
        commitment: "confirmed",
        observedAt: "2026-10-30T00:00:00.000Z",
        endpointHost: "api.mainnet.solana.com",
        sol: { lamports: "1", amount: "0.000000001", contextSlot: 1 },
        splToken: {
          program: "spl-token",
          programId: SPL_TOKEN_PROGRAM_ID,
          contextSlot: 1,
          accounts: [
            tokenAccount(SPL_ACCOUNT_ONE, "5"),
            tokenAccount(SPL_ACCOUNT_TWO, "7"),
          ],
          mints: [
            {
              mint: SPL_MINT,
              program: "spl-token",
              programId: SPL_TOKEN_PROGRAM_ID,
              rawAmount: "13",
              decimals: 0,
              amount: "13",
              accountCount: 2,
            },
          ],
        },
        token2022: {
          program: "token-2022",
          programId: TOKEN_2022_PROGRAM_ID,
          contextSlot: 2,
          accounts: [],
          mints: [],
        },
        snapshotAtomic: false,
      },
    });
  });

  await page.goto(`/portfolio?address=${WALLET}`);

  await expect(page.locator(".portfolio-error[role=alert]")).toContainText(
    "The portfolio endpoint returned an invalid response.",
  );
  await expect(page.getByTestId("portfolio-result")).toHaveCount(0);
  await expect(page.getByText("13", { exact: true })).toHaveCount(0);
});
