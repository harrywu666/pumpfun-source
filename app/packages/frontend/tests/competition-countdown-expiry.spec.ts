import { expect, test } from "@playwright/test";

test("live competition countdown stops after its deadline", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-30T00:00:00.000Z") });
  await page.route("**/api/leaderboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: {
          mode: "developer-api",
          label: "Pump developer API",
          fetchedAt: "2026-10-30T00:00:00.000Z",
        },
        data: {
          kind: "competitions",
          live: [
            {
              id: "synthetic-expiring-competition",
              slug: "synthetic-expiring-competition",
              kind: "person",
              title: "Synthetic expiring competition",
              description: "Explicitly synthetic countdown fixture.",
              prizeCopy: "$0 test fixture",
              prizes: [{ rankFrom: 1, rankTo: 1, amount: "$0 test fixture" }],
              minMembers: 1,
              maxMembers: 1,
              registrationOpensAt: "2026-10-29T23:00:00.000Z",
              registrationClosesAt: "2026-10-30T00:00:02.000Z",
              startsAt: "2026-10-29T23:00:00.000Z",
              endsAt: "2026-10-30T00:00:02.000Z",
              maxEntries: 50,
              entriesCount: 1,
              participants: 1,
              joinable: true,
              phase: "live",
              isFinal: false,
            },
          ],
          upcoming: [],
          past: [],
        },
      }),
    });
  });

  await page.goto("/leaderboard?category=competitions");
  const card = page
    .locator(".competition-card")
    .filter({ hasText: "Synthetic expiring competition" });
  await expect(card.getByTestId("cup-countdown")).toContainText("Ends in");

  await page.clock.fastForward(2_100);

  await expect(card.getByTestId("cup-countdown")).toHaveCount(0);
});

test("upcoming competition countdown switches to the live deadline", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-30T00:00:00.000Z") });
  await page.route("**/api/leaderboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: {
          mode: "developer-api",
          label: "Pump developer API",
          fetchedAt: "2026-10-30T00:00:00.000Z",
        },
        data: {
          kind: "competitions",
          live: [],
          upcoming: [
            {
              id: "synthetic-upcoming-competition",
              slug: "synthetic-upcoming-competition",
              kind: "person",
              title: "Synthetic upcoming competition",
              description: "Explicitly synthetic countdown fixture.",
              prizeCopy: "$0 test fixture",
              prizes: [{ rankFrom: 1, rankTo: 1, amount: "$0 test fixture" }],
              minMembers: 1,
              maxMembers: 1,
              registrationOpensAt: "2026-10-29T23:00:00.000Z",
              registrationClosesAt: "2026-10-30T00:00:02.000Z",
              startsAt: "2026-10-30T00:00:02.000Z",
              endsAt: "2026-10-30T00:00:05.000Z",
              maxEntries: 50,
              entriesCount: 1,
              participants: 1,
              joinable: false,
              phase: "upcoming",
              isFinal: false,
            },
          ],
          past: [],
        },
      }),
    });
  });

  await page.goto("/leaderboard?category=competitions&status=upcoming");
  const card = page
    .locator(".competition-card")
    .filter({ hasText: "Synthetic upcoming competition" });
  await expect(card.getByTestId("cup-countdown")).toContainText("Starts in");

  await page.clock.fastForward(2_100);
  await expect(card.getByTestId("cup-countdown")).toContainText("Ends in");

  await page.clock.fastForward(3_100);
  await expect(card.getByTestId("cup-countdown")).toHaveCount(0);
});
