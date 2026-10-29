import { expect, test } from "@playwright/test";

const entries = Array.from({ length: 11 }, (_, index) => ({
  rank: index + 1,
  walletAddress: `synthetic-wallet-${String(index + 1).padStart(2, "0")}`,
  username: `synthetic-trader-${String(index + 1).padStart(2, "0")}`,
  userId: `synthetic-user-${index + 1}`,
  xUsername: null,
  isVerified: false,
  verifiedBadgeVisible: true,
  pnlUsd: 1_000 - index * 10,
  pnlPercent: 25 - index,
  realizedPnlUsd: 700 - index * 5,
  unrealizedPnlUsd: 300 - index * 5,
  buySpendSol: 10,
  positionsCount: 2,
  lastRefreshedAtMs: 1_700_000_000_000,
}));

test("keyboard pagination keeps focus on the updated page state", async ({
  page,
}) => {
  await page.route("**/api/leaderboard?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: {
          mode: "developer-api",
          label: "Pump developer API",
          fetchedAt: "2026-10-28T12:00:00.000Z",
        },
        data: {
          kind: "traders",
          entries,
          periodLabel: "Synthetic daily test window",
          windowStartSec: 1_700_000_000,
        },
      }),
    });
  });

  await page.goto("/leaderboard");
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("synthetic-trader-11")).toBeVisible();
  const status = page.getByText("Page 2 of 2", { exact: true });
  expect(
    await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      live: document.activeElement?.getAttribute("aria-live"),
    })),
  ).toEqual({ tag: "SPAN", live: "polite" });
  await expect(status).toBeFocused();
});
