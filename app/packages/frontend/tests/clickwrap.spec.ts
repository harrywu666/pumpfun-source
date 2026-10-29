import { expect, test, type Page } from "@playwright/test";
// Explicit fresh browser state: never inherit the accepted-page regression fixture.
test.use({ storageState: { cookies: [], origins: [] } });
const overlay = (page: Page) =>
  page.getByRole("dialog", { name: "Welcome to Pump.fun!" });
async function expectAccepted(page: Page) {
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
  const state = await page.evaluate(() => ({
    legacy: localStorage.getItem("show-how-it-works"),
    date: localStorage.getItem("user-tos-accepted-date"),
    overflow: document.documentElement.style.overflow,
  }));
  expect(state.legacy).toBe("true");
  expect(Date.parse(state.date!)).toBeGreaterThanOrEqual(
    Date.parse("2026-10-17"),
  );
  expect(state.overflow).not.toBe("hidden");
  const cookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "clickwrap_accepted",
  );
  expect(cookie?.value).toBe("true");
  expect(cookie?.path).toBe("/");
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(31535000);
}

test("fresh visit has the archived dialog, inert shell and no inferred acceptance", async ({
  page,
}) => {
  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  await expect(page.locator("[data-app-shell]")).toHaveAttribute("inert", "");
  await expect(overlay(page).locator("[tabindex='-1']").last()).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe("hidden");
  expect(
    (await page.context().cookies()).filter(
      (c) => c.name === "clickwrap_accepted",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.getItem("show-how-it-works")),
  ).toBeNull();
  await expect(page.locator("[data-local-consent-notice]")).toContainText(
    "local browser preference",
  );
});

test("Continue records the captured browser fields and remains closed after reload", async ({
  page,
}) => {
  await page.goto("/");
  await overlay(page)
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expectAccepted(page);
  await page.reload();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
});

for (const action of ["backdrop", "Escape"] as const)
  test(`${action} preserves the original acceptance quirk and emits one shared event`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(overlay(page)).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { consentEvents: number }).consentEvents = 0;
      window.addEventListener("pump:clickwrap-accepted", () => {
        (window as unknown as { consentEvents: number }).consentEvents++;
      });
    });
    if (action === "Escape") {
      await expect(
        overlay(page).locator("[tabindex='-1']").last(),
      ).toBeFocused();
      await page.keyboard.press("Escape");
    } else
      await overlay(page)
        .getByRole("button", { name: "Dismiss", exact: true })
        .click({ position: { x: 2, y: 2 } });
    await expectAccepted(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { consentEvents: number }).consentEvents,
      ),
    ).toBe(1);
  });

test("keyboard focus wraps inside the dialog, then leaves no inert or scroll lock", async ({
  page,
}) => {
  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page).locator("[tabindex='-1']").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    overlay(page).getByRole("button", { name: "Continue", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    overlay(page).getByRole("link", { name: "Privacy Policy", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    overlay(page).getByRole("button", { name: "Continue", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expectAccepted(page);
  await page
    .locator("[data-app-shell]")
    .evaluate((element) => element.removeAttribute("inert"));
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
});

for (const [label, path] of [
  ["Terms and Conditions", "/docs/terms-and-conditions"],
  ["Privacy Policy", "/docs/privacy-policy"],
] as const)
  test(`${label} navigation does not accept, and Back restores the first visit`, async ({
    page,
  }) => {
    await page.goto("/");
    await overlay(page).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(path + "$"));
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
      "inert",
      "",
    );
    expect(
      (await page.context().cookies()).filter(
        (c) => c.name === "clickwrap_accepted",
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(() => localStorage.getItem("show-how-it-works")),
    ).toBeNull();
    await page.goBack();
    await expect(overlay(page)).toBeVisible();
    await expect(page.locator("[data-app-shell]")).toHaveAttribute("inert", "");
  });

test("an explicit existing cookie hides the dialog without inventing legacy or date values", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "clickwrap_accepted", value: "true", url: baseURL! },
  ]);
  await page.goto("/");
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(
    await page.evaluate(() => [
      localStorage.getItem("show-how-it-works"),
      localStorage.getItem("user-tos-accepted-date"),
    ]),
  ).toEqual([null, null]);
});

test("legacy false still hides and migrates only the cookie, without fabricating an acceptance date", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("show-how-it-works", "false"),
  );
  await page.goto("/");
  await expect(overlay(page)).toHaveCount(0);
  expect(
    (await page.context().cookies()).find(
      (c) => c.name === "clickwrap_accepted",
    )?.value,
  ).toBe("true");
  expect(
    await page.evaluate(() => localStorage.getItem("user-tos-accepted-date")),
  ).toBeNull();
});

test("cross-tab legacy storage updates hide the dialog; migration happens on subsequent mount", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  const other = await context.newPage();
  await other.goto(baseURL + "/docs/fees");
  await other.evaluate(() => localStorage.setItem("show-how-it-works", "true"));
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(
    (await context.cookies()).filter((c) => c.name === "clickwrap_accepted"),
  ).toEqual([]);
  await page.reload();
  expect(
    (await context.cookies()).find((c) => c.name === "clickwrap_accepted")
      ?.value,
  ).toBe("true");
  await other.close();
});

test("blocked consent storage still permits cookie-only Continue", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (["show-how-it-works", "user-tos-accepted-date"].includes(key))
        throw new DOMException("blocked", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (["show-how-it-works", "user-tos-accepted-date"].includes(key))
        throw new DOMException("blocked", "SecurityError");
      set.call(this, key, value);
    };
  });
  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  await overlay(page)
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(overlay(page)).toHaveCount(0);
  expect(
    (await page.context().cookies()).find(
      (c) => c.name === "clickwrap_accepted",
    )?.value,
  ).toBe("true");
});

test("cookie acceptance reaches another tab when local storage writes fail", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto(baseURL!);
  await expect(overlay(page)).toBeVisible();

  const accepting = await context.newPage();
  await accepting.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (["show-how-it-works", "user-tos-accepted-date"].includes(key))
        throw new DOMException("quota exhausted", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await accepting.goto(baseURL!);
  await expect(overlay(accepting)).toBeVisible();
  await accepting
    .getByRole("dialog", { name: "Welcome to Pump.fun!" })
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(overlay(accepting)).toHaveCount(0);

  await page.bringToFront();
  await expect(overlay(page)).toHaveCount(0);
  await accepting.close();
});

test("the modal repairs removed shell inertness while open", async ({
  page,
}) => {
  await page.goto("/");
  await expect(overlay(page)).toBeVisible();
  await page
    .locator("[data-app-shell]")
    .evaluate((element) => element.removeAttribute("inert"));
  await expect(page.locator("[data-app-shell]")).toHaveAttribute("inert", "");
});

test("first-visit and accepted pre-paint states work with hydration bundles blocked", async ({
  browser,
  baseURL,
}) => {
  for (const accepted of [false, true]) {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    if (accepted)
      await context.addCookies([
        { name: "clickwrap_accepted", value: "true", url: baseURL! },
      ]);
    const page = await context.newPage();
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto(baseURL!, { waitUntil: "domcontentloaded" });
    if (accepted) {
      await expect(overlay(page)).toBeHidden();
      await expect(page.locator("[data-app-shell]")).not.toHaveAttribute(
        "inert",
        "",
      );
    } else {
      await expect(overlay(page)).toBeVisible();
      await expect(page.locator("[data-app-shell]")).toHaveAttribute(
        "inert",
        "",
      );
    }
    await context.close();
  }
});

test("all target widths keep the text and controls reachable without horizontal overflow", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 640],
    [375, 812],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(overlay(page)).toBeVisible();
    await overlay(page)
      .getByRole("button", { name: "Continue", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      overlay(page).getByRole("button", { name: "Continue", exact: true }),
    ).toBeInViewport();
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  }
});

test("the browser-only workflow issues no external or mutating requests or console errors", async ({
  page,
  baseURL,
}) => {
  const violations: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).origin !== new URL(baseURL!).origin ||
      !["GET", "HEAD"].includes(request.method())
    )
      violations.push(request.method() + " " + request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await overlay(page)
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
