import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const overlay = (page: Page) =>
  page.getByRole("dialog", { name: "Welcome to Pump.fun!" });

async function denyCookieAccess(page: Page, access: "read" | "write") {
  await page.addInitScript((denied) => {
    const cookie = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie",
    );
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get:
        denied === "read"
          ? () => {
              throw new DOMException(
                "Synthetic cookie denial",
                "SecurityError",
              );
            }
          : cookie?.get,
      set:
        denied === "write"
          ? () => {
              throw new DOMException(
                "Synthetic cookie denial",
                "SecurityError",
              );
            }
          : cookie?.set,
    });
  }, access);
}

test("cookie access denial keeps first-visit consent usable", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await denyCookieAccess(page, "read");

  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  await overlay(page)
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(overlay(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("show-how-it-works")),
  ).toBe("true");

  await page.reload();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(pageErrors).toEqual([]);
});

test("cookie write denial falls back to local storage", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await denyCookieAccess(page, "write");

  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  await overlay(page)
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(overlay(page)).toHaveCount(0);
  const state = await page.evaluate(() => ({
    legacy: localStorage.getItem("show-how-it-works"),
    date: localStorage.getItem("user-tos-accepted-date"),
  }));
  expect(state.legacy).toBe("true");
  expect(Date.parse(state.date!)).toBeGreaterThanOrEqual(
    Date.parse("2026-10-17"),
  );
  expect(pageErrors).toEqual([]);

  await page.reload();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(pageErrors).toEqual([]);
});
