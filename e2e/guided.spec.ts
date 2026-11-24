import { expect, test } from "@playwright/test";

// The guided tour is laid out for a laptop: the console, the scoreboard and a phone side by side.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

test("the guided tour walks through the happy path, and Back undoes a step", async ({ page }) => {
  await page.goto("/guided/happy-path");
  const bubble = page.locator(".guided-bubble");
  const count = page.locator(".guided-count");
  const next = page.getByRole("button", { name: /next/i });
  const blanket = page.frameLocator("#guided-console").locator('.lc-gifts li[aria-label="Heated blanket"]');

  await expect(count).toContainText("1 / 50");
  await expect(bubble).toBeVisible({ timeout: 15_000 });

  // Through the opening to just after the first steal (step 12), a bubble at every step.
  for (let step = 2; step <= 12; step++) {
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();
    await expect(count).toContainText(`${step} / 50`);
    await expect(bubble).toBeVisible({ timeout: 15_000 });
  }
  await expect(blanket).toContainText("Cat", { timeout: 15_000 });

  // Back to "Cat steals": a fresh Game, built up to just before the steal.
  await page.getByRole("button", { name: /back/i }).click();
  await expect(count).toContainText("11 / 50");
  await expect(bubble).toBeVisible({ timeout: 30_000 });
  await expect(blanket).toContainText("Ann", { timeout: 15_000 });
  await expect(blanket).not.toContainText("Cat");
});
