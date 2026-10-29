import { expect, test } from "@playwright/test";

test("query-open survives SSR and hydration without server-rendering a portal", async ({
  page,
  request,
}) => {
  const response = await request.get("/?settings=notifications");
  expect(response.status()).toBe(200);
  // The live shell server-renders its closed native search dialog; no other dialog may be SSR'd.
  const dialogs = (await response.text()).match(/<dialog\b[^>]*>/g) ?? [];
  expect(
    dialogs.filter(
      (tag) => !tag.includes('aria-label="Search for coins and users"'),
    ),
  ).toEqual([]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?settings=notifications");
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile deep link escapes the hidden sidebar and restores focus to main", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?settings=notifications");
  await expect(page.locator("#app-sidebar")).toHaveAttribute("inert", "");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (node) => node.closest("[aria-hidden=true], [inert]") === null,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
});

for (const dismissal of ["Escape", "Back"] as const) {
  test(`${dismissal} dismisses settings without closing the mobile sidebar or Live selection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const mint = "7bS1mH6MXbw1GnEkKTU6w5YLTywPkQ1w3YVZXWFupump";
    await page.goto(`/live?stream=${mint}`);
    // Streaming can briefly leave a hidden pre-swap copy of the page outside
    // the live shell's <main>; scope to the rendered page.
    const playback = page
      .locator("#main-content")
      .getByTestId("playback-unavailable");
    await expect(playback).toBeVisible();
    const initialOverflow = await page.evaluate(
      () => document.body.style.overflow,
    );
    await page.getByRole("button", { name: "Open navigation" }).click();
    if (dismissal === "Back") {
      // Playback can be visible in SSR HTML before the router hydrates. Open
      // the real sidebar before seeding native history so Back does not target
      // an uninitialized entry that the router cannot restore.
      await expect(page.locator("[data-app-shell]")).toHaveAttribute(
        "data-mobile-navigation",
        "open",
      );
      await page.evaluate(() =>
        history.pushState(
          null,
          "",
          `${location.pathname}${location.search}&step=2`,
        ),
      );
      await expect(page).toHaveURL(/step=2$/);
    }
    const sidebarOverflow = await page.evaluate(
      () => document.body.style.overflow,
    );
    const launcher = page.getByRole("button", { name: "Open settings" });
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    if (dismissal === "Escape") {
      const search = dialog.getByRole("searchbox", { name: "Search settings" });
      await search.fill("group chats");
      await expect(search).toBeFocused();
      await search.press("Escape");
    } else await page.goBack();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("[data-app-shell]")).toHaveAttribute(
      "data-mobile-navigation",
      "open",
    );
    expect(new URL(page.url()).searchParams.get("stream")).toBe(mint);
    expect(new URL(page.url()).searchParams.has("settings")).toBe(false);
    await expect(playback).toBeVisible();
    await expect(launcher).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      sidebarOverflow,
    );
    await page
      .getByRole("button", { name: "Close navigation", exact: true })
      .click();
    await expect(page.locator("[data-app-shell]")).toHaveAttribute(
      "data-mobile-navigation",
      "closed",
    );
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      initialOverflow,
    );
  });
}

test("modal temporarily locks body scrolling and restores the previous style", async ({
  page,
}) => {
  await page.goto("/");
  const launcher = page.getByRole("button", { name: "Open settings" });
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  // A completed interaction proves hydration before mutating server-rendered
  // body attributes; an enabled SSR button alone does not establish readiness.
  await launcher.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => {
    document.body.style.overflow = "clip";
  });
  await launcher.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "clip");
});

test("open-modal URL transitions clear stale search before focusing a deep link", async ({
  page,
}) => {
  await page.goto("/?settings=notifications");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const search = dialog.getByRole("searchbox", { name: "Search settings" });
  await search.fill("group chats");
  const panelId = await dialog
    .getByRole("tab", { name: "Notifications", exact: true })
    .getAttribute("aria-controls");
  expect(await dialog.getByRole("tabpanel").getAttribute("id")).toBe(panelId);
  await page.evaluate(() =>
    history.pushState(
      null,
      "",
      "/?settings=privacy&setting=privacy.confirmExternalLinks",
    ),
  );
  await expect(search).toHaveValue("");
  await expect(
    dialog.locator('[data-setting-id="privacy.confirmExternalLinks"]'),
  ).toBeFocused();
  await search.fill("language");
  await page.goBack();
  await expect(search).toHaveValue("");
  await expect(
    dialog.getByRole("tab", { name: "Notifications", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("deep link focuses a known setting and close preserves unrelated URL state", async ({
  page,
}) => {
  await page.goto(
    "/explore?q=alpha&tag=a&settings=privacy&tag=b&setting=privacy.confirmExternalLinks#results",
  );
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('[data-setting-id="privacy.confirmExternalLinks"]'),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).not.toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/explore");
  expect(url.searchParams.get("q")).toBe("alpha");
  expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
  expect(url.searchParams.has("settings")).toBe(false);
  expect(url.searchParams.has("setting")).toBe(false);
  expect(url.hash).toBe("#results");
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeFocused();
});

test("malformed or privileged section values do not open the modal", async ({
  page,
}) => {
  for (const query of [
    "settings=",
    "settings=unknown",
    "settings=admin",
    "settings=%3Cscript%3E",
    "settings=notifications&settings=privacy",
    "setting=display.language",
  ]) {
    await page.goto(`/?${query}`);
    await expect(
      page.getByRole("dialog", { name: "Settings", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open settings" }),
    ).toHaveAttribute("aria-expanded", "false");
  }
});

test("search, empty results, clear, tabs and keyboard selection work without preference values", async ({
  page,
}) => {
  await page.goto("/?settings=notifications");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(
    dialog.getByText(/Account values are unavailable, not off/),
  ).toBeVisible();
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  const search = dialog.getByRole("searchbox", { name: "Search settings" });
  await search.fill("GróUP  CHATS");
  await expect(
    dialog.getByRole("heading", { name: "Group chats", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("1 setting found");
  await search.fill("not-a-mapped-setting");
  await expect(
    dialog.getByRole("heading", { name: "No matching settings" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Clear settings search" }).click();
  await expect(search).toHaveValue("");
  await dialog.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page).toHaveURL(/settings=display$/);
  await expect(
    dialog.getByRole("heading", { name: "Language", level: 4 }),
  ).toBeVisible();
  await dialog
    .getByRole("tab", { name: "Display", exact: true })
    .press("ArrowRight");
  await expect(
    dialog.getByRole("tab", { name: "Privacy", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("tab", { name: "Privacy", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("tab", { name: "Privacy", exact: true }).press("Home");
  await expect(
    dialog.getByRole("tab", { name: "Trading", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("heading", { name: "This section is not reconstructed" }),
  ).toBeVisible();
});

for (const [label, modifier, property] of [
  ["Alt", "Alt", "altKey"],
  ["Control", "Control", "ctrlKey"],
  ["Meta", "Meta", "metaKey"],
] as const) {
  test(`${label}+ArrowLeft remains outside settings tab navigation`, async ({
    page,
  }) => {
    await page.goto("/?marker=older");
    await page.goto("/?marker=current&settings=notifications");
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    const notifications = dialog.getByRole("tab", {
      name: "Notifications",
      exact: true,
    });
    await expect(notifications).toHaveAttribute("aria-selected", "true");
    await notifications.focus();
    await page.evaluate(() => {
      window.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft") return;
        setTimeout(() => {
          (
            window as typeof window & {
              settingsShortcut?: {
                altKey: boolean;
                ctrlKey: boolean;
                metaKey: boolean;
                defaultPrevented: boolean;
              };
            }
          ).settingsShortcut = {
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            defaultPrevented: event.defaultPrevented,
          };
        });
      });
    });
    await notifications.press(`${modifier}+ArrowLeft`);
    await expect(page).toHaveURL("/?marker=current&settings=notifications");
    await expect(notifications).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                settingsShortcut?: {
                  altKey: boolean;
                  ctrlKey: boolean;
                  metaKey: boolean;
                  defaultPrevented: boolean;
                };
              }
            ).settingsShortcut,
        ),
      )
      .toMatchObject({ [property]: true, defaultPrevented: false });
  });
}

test("Escape and repeated reopening clear local search and do not add history entries", async ({
  page,
}) => {
  await page.goto("/?marker=older");
  await page.goto("/?marker=current&settings=notifications&setting=unknown");
  const historyBefore = await page.evaluate(() => history.length);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog
    .getByRole("searchbox", { name: "Search settings" })
    .fill("messages");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get("marker")).toBe("current");
  expect(new URL(page.url()).searchParams.has("setting")).toBe(false);
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    dialog.getByRole("searchbox", { name: "Search settings" }),
  ).toHaveValue("");
  await dialog.getByRole("tab", { name: "Privacy", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);
  await page.goBack();
  await expect(page).toHaveURL(/marker=older$/);
  await expect(dialog).not.toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/marker=current$/);
  await expect(dialog).not.toBeVisible();
});

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 640],
]) {
  test(`settings dialog fits ${width}px and its controls remain keyboard reachable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?settings=notifications");
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
    expect(box!.height).toBeLessThanOrEqual(height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      dialog.getByRole("button", { name: "Close settings" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close settings" }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}

test("settings interaction makes no service requests, preference writes or permission prompts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const deny = () => {
      throw new Error(
        "Settings must not request permission or register a subscription",
      );
    };
    if ("Notification" in window) Notification.requestPermission = deny;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register = deny;
  });
  const errors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== "http://127.0.0.1:3010" ||
      url.pathname.startsWith("/api/") ||
      !["GET", "HEAD"].includes(request.method())
    ) {
      unexpectedRequests.push(
        `${request.method()} ${url.origin}${url.pathname}`,
      );
    }
  });
  await page.goto("/?settings=notifications");
  const before = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("searchbox", { name: "Search settings" }).fill("push");
  await expect(
    dialog.getByRole("heading", { name: "Browser notifications", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Privacy", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })),
  ).toEqual(before);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("resizing an open mobile sidebar keeps Settings locked until it closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const initialOverflow = await page.evaluate(
    () => document.body.style.overflow,
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("[data-app-shell]")).toHaveAttribute(
    "data-mobile-navigation",
    "open",
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator("[data-app-shell]")).toHaveAttribute(
    "data-mobile-navigation",
    "closed",
  );
  await expect(dialog).toBeVisible();
  await expect.soft(page.locator("body")).toHaveCSS("overflow", "hidden");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe(initialOverflow);
});
