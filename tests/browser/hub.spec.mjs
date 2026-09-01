import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("prototype hub is responsive, accessible, and has no retired route", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Small games",
  );
  await expect(page.locator("[data-prototype-count]")).toHaveText("02");
  await expect(page.locator("[data-prototype-count]")).toHaveAttribute(
    "aria-label",
    "2 prototypes",
  );
  await expect(page.locator(".prototype-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Open prototype/ })).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Open prototype/ }).nth(1))
    .toHaveAttribute("href", "./prototypes/latch/");
  await expect(page.getByText("Before Midnight")).toBeVisible();
  await expect(page.getByText("Latch!")).toBeVisible();
  await expect(page.locator('[href*="input-lab"]')).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to prototypes" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to prototypes" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.reload();
  const warmCacheInteractive = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation");
    return navigation.domInteractive;
  });
  expect(warmCacheInteractive).toBeLessThan(2000);
  test.info().annotations.push({
    type: "warm-cache-interactive",
    description: `${Math.round(warmCacheInteractive)} ms on Pixel 7 emulation`,
  });

  if (process.env.EVIDENCE_SCREENSHOT) {
    await page.screenshot({
      path: process.env.EVIDENCE_SCREENSHOT,
      fullPage: true,
    });
  }
});
