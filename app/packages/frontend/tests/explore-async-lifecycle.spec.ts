import { expect, test, type Route } from "@playwright/test";

test("a newer clear owns the final URL after a delayed search", async ({
  page,
}) => {
  await page.goto("/explore?q=previous", { waitUntil: "networkidle" });
  const input = page.getByLabel("Search captured coins", { exact: true });
  const clearRequests: Route[] = [];
  const searchResponses: Route[] = [];

  await page.route("**/explore**", async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().resourceType() === "document" &&
      !url.searchParams.has("q")
    ) {
      clearRequests.push(route);
      return;
    }
    if (!url.searchParams.has("_rsc")) {
      await route.continue();
      return;
    }
    if (url.searchParams.get("q") === "new draft") {
      searchResponses.push(route);
      return;
    }
    if (!url.searchParams.has("q")) {
      clearRequests.push(route);
      return;
    }
    await route.continue();
  });

  try {
    await input.fill("new draft");
    await input.press("Enter");
    await expect.poll(() => searchResponses.length).toBe(1);

    await page
      .getByRole("button", { name: "Clear", exact: true })
      .click({ noWaitAfter: true });
    await expect.poll(() => clearRequests.length).toBe(1);

    await searchResponses[0].continue();

    await clearRequests[0].continue();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(input).toHaveValue("");
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
