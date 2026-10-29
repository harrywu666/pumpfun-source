import { expect, test, type Page } from "@playwright/test";
const ADDRESS = "So11111111111111111111111111111111111111112";

type Probe = {
  calls: string[];
  reads: number;
  resolve(): void;
  reject(): void;
  change(address: string | null): void;
  unregister(): void;
};
async function installWallet(
  page: Page,
  mode: "success" | "pending" | "reject" | "without-disconnect" = "success",
) {
  await page.addInitScript(
    ({ address, mode }) => {
      let accounts: { address: string; chains: string[] }[] = [];
      const approvedAccounts = [{ address, chains: ["solana:mainnet"] }];
      let change: ((value: unknown) => void) | null = null;
      let unregister = () => {};
      const probe = {
        calls: [] as string[],
        reads: 0,
        resolve: () => {},
        reject: () => {},
        change(address: string | null) {
          accounts = address ? [{ address, chains: ["solana:mainnet"] }] : [];
          change?.({ accounts });
        },
        unregister: () => unregister(),
      };
      const wallet = {
        version: "1.0.0",
        name: "Browser Protocol Wallet",
        chains: ["solana:mainnet"],
        get accounts() {
          probe.reads++;
          return accounts;
        },
        get icon() {
          throw new Error("Wallet icon should not be read");
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            async connect(...args: unknown[]) {
              probe.calls.push(`connect:${args.length}`);
              if (mode === "reject")
                throw new Error("private-provider-payload");
              if (mode === "pending")
                await new Promise<void>((resolve, reject) => {
                  probe.resolve = resolve;
                  probe.reject = () =>
                    reject(new Error("private-provider-payload"));
                });
              return { accounts: approvedAccounts };
            },
          },
          "standard:events": {
            version: "1.0.0",
            on(event: string, callback: typeof change) {
              probe.calls.push(`on:${event}`);
              change = callback;
              return () => {
                probe.calls.push("off");
                change = null;
              };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            async disconnect() {
              probe.calls.push("disconnect");
            },
          },
          get "solana:signMessage"() {
            throw new Error("Signing is forbidden");
          },
          get "solana:signTransaction"() {
            throw new Error("Signing is forbidden");
          },
          get "solana:signIn"() {
            throw new Error("Sign-in is forbidden");
          },
        },
      };
      if (mode === "without-disconnect")
        Reflect.deleteProperty(wallet.features, "standard:disconnect");
      window.addEventListener("wallet-standard:app-ready", ((
        event: CustomEvent,
      ) => {
        unregister = event.detail.register(wallet);
      }) as EventListener);
      Object.assign(window, { __publicWalletProbe: probe });
    },
    { address: ADDRESS, mode },
  );
}
const probe = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __publicWalletProbe: Probe })
      .__publicWalletProbe;
    return { calls: p.calls, reads: p.reads };
  });
const mutate = (page: Page, action: "resolve" | "unregister") =>
  page.evaluate((action) => {
    (window as unknown as { __publicWalletProbe: Probe }).__publicWalletProbe[
      action
    ]();
  }, action);
async function open(page: Page) {
  await page.goto("/explore");
  await page.getByTestId("sign-in-button").click();
  await page
    .getByRole("button", { name: "Connect a public wallet", exact: true })
    .click();
}

test("opt-in public connection, change and disconnect preserve auth/privacy boundary", async ({
  page,
}) => {
  const unexpected: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !["GET", "HEAD"].includes(request.method()) ||
      /\/auth\/|\/privy|wallet.*challenge/i.test(url.pathname)
    )
      unexpected.push(request.url());
  });
  await installWallet(page);
  await page.goto("/explore");
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    cookies: document.cookie,
  }));
  await page.getByTestId("sign-in-button").click();
  expect(await probe(page)).toEqual({ calls: [], reads: 0 });
  await page
    .getByRole("button", { name: "Connect a public wallet", exact: true })
    .click();
  expect(await probe(page)).toEqual({ calls: [], reads: 0 });
  await page
    .getByRole("button", {
      name: "Connect Browser Protocol Wallet",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("public-wallet-address")).toHaveText(ADDRESS);
  await expect(page.getByTestId("public-wallet-panel")).toContainText(
    "ownership unverified",
  );
  await expect(page.getByTestId("auth-google-button")).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("data-pf-auth", "out");
  await page.evaluate(() =>
    (
      window as unknown as { __publicWalletProbe: Probe }
    ).__publicWalletProbe.change("11111111111111111111111111111111"),
  );
  await expect(page.getByTestId("public-wallet-address")).toHaveText(
    "11111111111111111111111111111111",
  );
  await page
    .getByRole("button", { name: "Disconnect and forget address" })
    .click();
  await expect(page.getByTestId("public-wallet-address")).toHaveCount(0);
  expect((await probe(page)).calls).toEqual([
    "connect:0",
    "on:change",
    "off",
    "disconnect",
  ]);
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
      cookies: document.cookie,
    })),
  ).toEqual(storage);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("declined wallet prompt shows no provider payload", async ({ page }) => {
  await installWallet(page, "reject");
  await open(page);
  await page
    .getByRole("button", {
      name: "Connect Browser Protocol Wallet",
      exact: true,
    })
    .click();
  await expect(
    page.getByTestId("public-wallet-panel").getByRole("alert"),
  ).toContainText("Unable to connect");
  await expect(page.getByTestId("public-wallet-panel")).not.toContainText(
    "private-provider-payload",
  );
  expect((await probe(page)).reads).toBe(0);
});

test("closing the dialog forgets connected address and rejects late pending approval", async ({
  page,
}) => {
  await installWallet(page, "pending");
  await open(page);
  await page
    .getByRole("button", {
      name: "Connect Browser Protocol Wallet",
      exact: true,
    })
    .click();
  await page
    .getByTestId("auth-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await mutate(page, "resolve");
  await page.getByTestId("sign-in-button").click();
  await expect(page.getByTestId("public-wallet-address")).toHaveCount(0);
  expect((await probe(page)).reads).toBe(0);
});

for (const width of [320, 1440])
  test(`public wallet chooser fits ${width}px and cleans up on revocation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    await installWallet(page);
    await open(page);
    await page
      .getByRole("button", {
        name: "Connect Browser Protocol Wallet",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("public-wallet-address")).toHaveText(ADDRESS);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const panel = page.getByTestId("public-wallet-panel");
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../../artifacts/public-wallet-${width}.png`,
    });
    await mutate(page, "unregister");
    await expect(page.getByTestId("public-wallet-address")).toHaveCount(0);
    await expect(panel).toContainText("Wallet is no longer available");
  });

test("wallet without disconnect support forgets locally and discloses remaining wallet authorization", async ({
  page,
}) => {
  await installWallet(page, "without-disconnect");
  await open(page);
  await page
    .getByRole("button", {
      name: "Connect Browser Protocol Wallet",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("public-wallet-address")).toHaveText(ADDRESS);
  await page
    .getByRole("button", { name: "Disconnect and forget address" })
    .click();
  await expect(page.getByTestId("public-wallet-address")).toHaveCount(0);
  await expect(
    page.getByTestId("public-wallet-panel").getByRole("alert"),
  ).toContainText("wallet connection may remain active");
  expect((await probe(page)).calls).toEqual(["connect:0", "on:change", "off"]);
});
