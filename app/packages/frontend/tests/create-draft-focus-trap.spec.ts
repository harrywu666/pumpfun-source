import { expect, test, type Page } from "@playwright/test";

function websiteLink(page: Page) {
  return page
    .getByRole("list", { name: "Draft social links" })
    .getByRole("link", { name: "Website", exact: true });
}

test("Create draft link confirmation keeps Tab focus inside the modal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page
    .getByLabel("Website", { exact: true })
    .fill("https://example.com/focus-trap");
  await websiteLink(page).click();

  const dialog = page.getByRole("dialog", { name: "Open external link?" });
  await expect(dialog).toBeVisible();
  const remember = dialog.getByRole("checkbox", {
    name: "Do not ask again on this browser",
  });
  const cancel = dialog.getByRole("button", {
    name: "Cancel",
    exact: true,
  });
  const open = dialog.getByRole("button", {
    name: "Open link",
    exact: true,
  });

  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(remember).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(open).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(remember).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(open).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(remember).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(websiteLink(page)).toBeFocused();
});
