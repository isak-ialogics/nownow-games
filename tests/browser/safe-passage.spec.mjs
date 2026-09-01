import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;

async function pointer(page, type, id) {
  const sky = page.locator("#sky");
  await sky.dispatchEvent("pointerdown", { pointerId: id, pointerType: type, clientX: 120, clientY: 180 });
  await expect(sky).toHaveAttribute("aria-pressed", "true");
  await sky.dispatchEvent("pointerup", { pointerId: id, pointerType: type, clientX: 120, clientY: 180 });
  await expect(sky).toHaveAttribute("aria-pressed", "false");
}

async function key(page, value) {
  const sky = page.locator("#sky");
  await sky.focus();
  await page.keyboard.down(value);
  await expect(sky).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up(value);
  await expect(sky).toHaveAttribute("aria-pressed", "false");
}

test("320px play supports pointer and keyboard parity, failure, and retry", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const response = await page.goto("/prototypes/safe-passage/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByText("Abstract arcade formation")).toBeVisible();
  await expect(page.getByText(/lower red zone always ends/i)).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
  await page.reload();
  const warmCacheInteractive = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation");
    return navigation.domInteractive;
  });
  expect(warmCacheInteractive).toBeLessThan(2000);
  test.info().annotations.push({
    type: "warm-cache-interactive",
    description: Math.round(warmCacheInteractive) + " ms at 320px",
  });

  const sky = page.locator("#sky");
  const box = await sky.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(300);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await sky.focus();
  expect(await sky.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");

  await pointer(page, "touch", 41);
  await pointer(page, "mouse", 42);
  await key(page, "Space");
  await key(page, "Enter");
  await key(page, "ArrowUp");
  await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(sky).toHaveAttribute("aria-pressed", "false");

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, "safe-passage-corridor-mobile.png"), fullPage: true });
  }
  await page.waitForTimeout(6800);

  const result = page.locator("#result");
  await expect(result).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#result-title")).toHaveText("Roofline crossed");
  await expect(page.locator("#announcement")).toContainText("Roofline breaches: 1");
  await expect(page.locator("#result button")).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(requests.every((url) => url.startsWith("http://127.0.0.1:4173/"))).toBe(true);

  const resultAccessibility = await new AxeBuilder({ page }).analyze();
  expect(resultAccessibility.violations).toEqual([]);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, "safe-passage-result-mobile.png"), fullPage: true });
  }

  await page.getByRole("button", { name: "Retry passage" }).click();
  await expect(page.locator("#game")).toBeVisible();
  await expect(result).toBeHidden();
  await expect(page.locator("#time")).toHaveText("50.0");
});

test("reduced motion keeps identical route timing without decorative motion", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    globalThis.__craftY = { A: [], B: [] };
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (text in globalThis.__craftY) globalThis.__craftY[text].push(y);
      return original.call(this, text, x, y, ...rest);
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prototypes/safe-passage/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator("#time")).toHaveText("50.0");
  expect(await page.locator("#sky").evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  await expect(page.locator(".smoke, .parallax, .shake")).toHaveCount(0);
  await page.keyboard.down("Space");
  await page.waitForTimeout(3400);
  await page.keyboard.up("Space");
  const craftY = await page.evaluate(() => ({
    lead: globalThis.__craftY.A.slice(-20),
    follower: globalThis.__craftY.B.slice(-20),
  }));
  for (const samples of Object.values(craftY)) {
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.01);
  }
  await expect(page.locator("#time")).not.toHaveText("50.0");
});
