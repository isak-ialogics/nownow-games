import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("game hub is responsive, accessible, and has no retired route", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Small game\.\s*Big nerve\.\s*Play Before Midnight\./,
  );
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
  await expect(page.locator("[data-prototype-count]")).toHaveText("03");
  await expect(page.locator("[data-prototype-count]")).toHaveAttribute(
    "aria-label",
    "3 games",
  );
  await expect(page.locator(".prototype-card")).toHaveCount(3);
  const playLinks = page.getByRole("link", { name: /Play now/ });
  await expect(playLinks).toHaveCount(3);
  await expect(playLinks.nth(0)).toHaveAttribute(
    "href",
    "./prototypes/before-midnight/",
  );
  await expect(playLinks.nth(1)).toHaveAttribute(
    "href",
    "./prototypes/latch/",
  );
  await expect(playLinks.nth(2)).toHaveAttribute(
    "href",
    "./prototypes/safe-passage/",
  );
  await expect(
    page.getByRole("heading", { level: 3, name: "Before Midnight", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Hold, release, and outsmart the coast. Can you stop just under the rand cap?",
    ),
  ).toBeVisible();
  await expect(page.getByText("Safe Passage")).toBeVisible();
  await expect(page.getByText("Latch!")).toBeVisible();
  await expect(page.locator('[href*="input-lab"]')).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to games" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to games" })).toBeVisible();

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
