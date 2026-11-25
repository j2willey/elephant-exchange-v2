import { expect, test } from "@playwright/test";

// A half-width laptop window gets the laptop layout; only a phone gets the phone one (Jim, 2026-11-25: at 940 px his
// browser got the phone console, and he had to scroll far down).
test.describe("a laptop's browser window, about half the screen", () => {
  test.use({ viewport: { width: 940, height: 900 }, isMobile: false, hasTouch: false });

  test("the demo opens the demo page with the two-column Host console", async ({ page }) => {
    await page.goto("/try");
    await page.getByRole("button", { name: /create demo game/i }).click();
    await expect(page).toHaveURL(/\/games\/[^/]+\/demo$/, { timeout: 15_000 });
    const console = page.frameLocator("iframe").first();
    await expect(console.getByRole("heading", { name: "Participants" })).toBeVisible({ timeout: 15_000 });
    await expect(console.getByRole("heading", { name: "Gift Tracker" })).toBeVisible();
  });
});

test("on a phone the demo opens the phone console", async ({ page }) => {
  await page.goto("/try");
  await page.getByRole("button", { name: /create demo game/i }).click();
  await expect(page).toHaveURL(/\/games\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Gift Tracker" })).not.toBeVisible();
});
