import { expect, test, type Page } from "@playwright/test";
const MINT = "So11111111111111111111111111111111111111112";
const PDA = "54SthQvXp5vQrse2JBjVUgsZVU3RrCtPAKQhqcn7XJnh";
function payload(address = PDA, empty = false) {
  const programId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const account = {
    tokenAccount: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
    mint: MINT,
    owner: address,
    program: "spl-token",
    programId,
    rawAmount: "9007199254740993",
    decimals: 6,
    amount: "9007199254.740993",
    state: "frozen",
    isNative: false,
    extensions: [],
  };
  return {
    ok: true,
    address,
    cluster: "mainnet-beta",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    commitment: "confirmed",
    observedAt: "2026-10-29T02:00:00.000Z",
    endpointHost: "public-rpc.example",
    sol: {
      lamports: empty ? "0" : "1234567890",
      amount: empty ? "0.000000000" : "1.234567890",
      contextSlot: 123,
    },
    splToken: {
      program: "spl-token",
      programId,
      contextSlot: 124,
      accounts: empty ? [] : [account],
      mints: empty
        ? []
        : [
            {
              mint: MINT,
              program: "spl-token",
              programId,
              rawAmount: account.rawAmount,
              decimals: 6,
              amount: account.amount,
              accountCount: 1,
            },
          ],
    },
    token2022: {
      program: "token-2022",
      programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      contextSlot: 125,
      accounts: [],
      mints: [],
    },
    snapshotAtomic: false,
  };
}
async function derive(page: Page) {
  await page.goto("/holder-rewards");
  await page.getByLabel("Solana mint address", { exact: true }).fill(MINT);
  await page
    .getByRole("button", { name: "Derive address", exact: true })
    .click();
}
const read = (page: Page) =>
  page.getByRole("button", { name: "Read public PDA balances", exact: true });

test("explicit public read uses derived PDA, exact quantities, slots and no credentials or reward inference", async ({
  page,
}) => {
  const requests: {
    method: string;
    address: string | null;
    cookie: string | undefined;
  }[] = [];
  const unexpected: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== "http://127.0.0.1:3010" ||
      !["GET", "HEAD"].includes(request.method())
    )
      unexpected.push(request.url());
  });
  await page.route("**/api/portfolio?*", async (route) => {
    requests.push({
      method: route.request().method(),
      address: new URL(route.request().url()).searchParams.get("address"),
      cookie: route.request().headers()["cookie"],
    });
    await route.fulfill({ json: payload() });
  });
  await derive(page);
  expect(requests).toEqual([]);
  await expect(page.getByTestId("holder-public-balances-result")).toHaveCount(
    0,
  );
  await read(page).click();
  const result = page.getByTestId("holder-public-balances-result");
  await expect(result).toContainText("1.234567890 SOL (1234567890 lamports)");
  await expect(result).toContainText("9007199254740993");
  await expect(result).toContainText("9007199254.740993");
  await expect(result).toContainText("public-rpc.example");
  await expect(result).toContainText("slot 124");
  await expect(result).toContainText("slot 125");
  await expect(result).toContainText("different slots");
  await expect(
    page
      .getByTestId("reward-summary")
      .getByText("Unavailable", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Claim unavailable", exact: true }),
  ).toBeDisabled();
  await expect(
    result.getByRole("link", {
      name: "Open the full public account inventory",
    }),
  ).toHaveAttribute("href", `/portfolio?address=${PDA}`);
  expect(requests).toEqual([
    { method: "GET", address: PDA, cookie: undefined },
  ]);
  expect(unexpected).toEqual([]);
});

test("keyboard focus survives the pending public-balances read", async ({
  page,
}) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/portfolio?*", async (route) => {
    calls++;
    await gate;
    await route.fulfill({ json: payload() });
  });
  await derive(page);
  const button = page.getByTestId("holder-public-balances").getByRole("button");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("holder-public-balances").getByRole("status"),
  ).toBeVisible();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  expect(calls).toBe(1);
  release();
  await expect(page.getByTestId("holder-public-balances-result")).toBeVisible();
  await expect(button).toBeFocused();
});

test("RPC rate limit/error hides provider detail; retry and refresh use a fresh observation", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/portfolio?*", async (route) => {
    calls++;
    await route.fulfill(
      calls === 1
        ? {
            status: 429,
            json: {
              ok: false,
              error: {
                code: "RPC_RATE_LIMITED",
                message: "private-provider-debug",
                retryable: true,
              },
            },
          }
        : { json: payload() },
    );
  });
  await derive(page);
  await read(page).click();
  await expect(
    page.getByTestId("holder-public-balances").getByRole("alert"),
  ).toContainText("rate limited");
  await expect(page.getByTestId("holder-public-balances")).not.toContainText(
    "private-provider-debug",
  );
  await read(page).click();
  await expect(page.getByTestId("holder-public-balances-result")).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh public PDA balances", exact: true })
    .click();
  await expect(page.getByTestId("holder-public-balances-result")).toBeVisible();
  expect(calls).toBe(3);
});

test("response for another PDA fails closed", async ({ page }) => {
  await page.route("**/api/portfolio?*", (route) =>
    route.fulfill({ json: payload(MINT) }),
  );
  await derive(page);
  await read(page).click();
  await expect(
    page.getByTestId("holder-public-balances").getByRole("alert"),
  ).toContainText("did not match this derived address");
  await expect(page.getByTestId("holder-public-balances-result")).toHaveCount(
    0,
  );
});

test("mint edit/clear discards pending and successful observations", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/portfolio?*", async (route) => {
    started();
    await gate;
    await route.fulfill({ json: payload() }).catch(() => {});
  });
  await derive(page);
  await read(page).click();
  await pending;
  await page
    .getByLabel("Solana mint address", { exact: true })
    .fill("11111111111111111111111111111111");
  release();
  await expect(page.getByTestId("holder-public-balances")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Derive address", exact: true })
    .click();
  await expect(page.getByTestId("holder-public-balances-result")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByTestId("holder-public-balances")).toHaveCount(0);
  await expect(page.getByTestId("holder-rewards-no-result")).toBeVisible();
});

for (const width of [320, 1440])
  test(`zero/empty observation stays distinct from rewards at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    await page.route("**/api/portfolio?*", (route) =>
      route.fulfill({ json: payload(PDA, true) }),
    );
    await derive(page);
    await read(page).click();
    const result = page.getByTestId("holder-public-balances-result");
    await expect(result).toContainText("0.000000000 SOL (0 lamports)");
    await expect(
      result.getByText(
        "No token accounts were returned for this program at this observation.",
        { exact: true },
      ),
    ).toHaveCount(2);
    await expect(page.getByTestId("holder-public-balances")).toContainText(
      "Zero balances do not establish whether an account exists",
    );
    await expect(
      page
        .getByTestId("reward-summary")
        .getByText("Unavailable", { exact: true }),
    ).toHaveCount(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../../artifacts/holder-public-balances-${width}.png`,
    });
  });
