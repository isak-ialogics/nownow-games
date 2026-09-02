import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;

async function pointerHold(page, pointerType, milliseconds) {
  const pump = page.locator("#pump");
  const pointerId = pointerType === "touch" ? 41 : 42;
  await pump.dispatchEvent("pointerdown", {
    pointerId,
    pointerType,
    clientX: 40,
    clientY: 40,
  });
  await expect(pump).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(milliseconds);
  await pump.dispatchEvent("pointerup", {
    pointerId,
    pointerType,
    clientX: 40,
    clientY: 40,
  });
  await expect(pump).toHaveAttribute("aria-pressed", "false");
}

async function keyboardHold(page, key, milliseconds) {
  const pump = page.locator("#pump");
  await pump.focus();
  await page.keyboard.down(key);
  await expect(pump).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
  await expect(pump).toHaveAttribute("aria-pressed", "false");
}

async function expectResultThenRound(page, category, nextRound) {
  const feedback = page.locator("#feedback");
  await expect(feedback).toBeVisible();
  await expect(feedback).toHaveAttribute("data-result", category);
  if (nextRound) {
    await expect(page.locator("#round-count")).toHaveText(`${nextRound} / 7`);
  }
}

test("seven fills support touch, mouse, Space, Enter, results, and retry", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const response = await page.goto("/prototypes/before-midnight/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Before Midnight",
  );
  await expect(page.getByText("Seven fills. One exacting cap.")).toBeVisible();
  await expect(page.getByText(/not a price calculator/i)).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);

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

  const pump = page.locator("#pump");
  const box = await pump.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await pump.focus();
  expect(await pump.evaluate((node) => getComputedStyle(node).outlineStyle))
    .not.toBe("none");

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.reload();
  await expect(
    page.getByLabel("Result symbols").getByRole("listitem"),
  ).toHaveText(["[+] Safe", "[~] Near cap", "[X] Over cap"]);
  await expect(page.locator("#round-count")).toHaveText("1 / 7");

  await pointerHold(page, "touch", 120);
  await expectResultThenRound(page, "safe", 2);

  await pointerHold(page, "mouse", 1690);
  await expectResultThenRound(page, /near|precision/, 3);

  await keyboardHold(page, "Space", 800);
  await expectResultThenRound(page, "safe", 4);

  await keyboardHold(page, "Enter", 3000);
  await expectResultThenRound(page, "overshoot");
  await expect(page.locator("#feedback")).toContainText("OVER CAP");
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "before-midnight-overshoot-mobile.png"),
      fullPage: true,
    });
  }
  await expect(page.locator("#round-count")).toHaveText("5 / 7");

  await keyboardHold(page, "Space", 120);
  await expectResultThenRound(page, "safe", 6);
  await pointerHold(page, "mouse", 120);
  await expectResultThenRound(page, "safe", 7);
  await keyboardHold(page, "Enter", 120);

  const result = page.locator("#result-card");
  await expect(result).toBeVisible();
  await expect(page.locator("#total-units")).toContainText("units");
  await expect(page.locator("#overshoots")).toHaveText("1 / 7");
  await expect(page.locator("#best-accuracy")).toContainText("%");
  await expect(page.locator("#personal-best")).toContainText("pts");
  await expect(page.locator("#retry")).toHaveCount(1);
  await expect(page.locator("#result-card button")).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.length)).toBe(1);

  const resultAccessibility = await new AxeBuilder({ page }).analyze();
  expect(resultAccessibility.violations).toEqual([]);
  if (evidenceDir) {
    await page.screenshot({
      path: join(evidenceDir, "before-midnight-result-mobile.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Retry seven fills" }).click();
  await expect(page.locator("#round-count")).toHaveText("1 / 7");
  await expect(result).toBeHidden();
  expect(
    requests.every((url) => url.startsWith("http://127.0.0.1:4173/")),
  ).toBe(true);
});

test("reduced motion removes bounce and steps the live counter", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prototypes/before-midnight/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  await page.keyboard.down("Space");
  await page.waitForTimeout(380);
  const motion = await page.locator(".needle").evaluate((node) => ({
    animationName: getComputedStyle(node).animationName,
    sampleMs: Number(document.getElementById("pump").dataset.sampleMs),
  }));
  expect(motion.animationName).toBe("none");
  expect(motion.sampleMs % 250).toBe(0);
  await page.keyboard.up("Space");
});
