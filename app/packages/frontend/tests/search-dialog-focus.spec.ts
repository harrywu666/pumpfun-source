import { expect, test } from "@playwright/test";
import { openShellSearch } from "./shell-controls";

test("clearing global search keeps focus in the search field", async ({
  page,
}) => {
  await page.goto("/explore?q=alpha");
  const input = await openShellSearch(page);
  await expect(input).toHaveValue("alpha");

  const clear = page.getByRole("button", {
    name: "Clear search",
    exact: true,
  });
  await clear.focus();
  await expect(clear).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/explore$/);
  await expect(input).toHaveValue("");
  expect(
    await page.evaluate(() => document.activeElement?.tagName ?? "NONE"),
  ).toBe("INPUT");
  await expect(input).toBeFocused();
});
