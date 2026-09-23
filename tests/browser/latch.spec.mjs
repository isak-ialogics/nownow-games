import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectResultDiscovery } from "./result-discovery.mjs";

const localOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;

function eventPaths(requests) {
  return requests
    .map((request) => new URL(request))
    .filter((url) => url.pathname === "/analytics/count")
    .map((url) => url.searchParams.get("p"));
}

async function waitForThreat(page, doorNumber) {
  const door = page.locator(".door").nth(doorNumber - 1);
  await expect(door).toHaveAttribute("data-threatened", "true", {
    timeout: 5000,
  });
  return door;
}

test("touch, mouse, number key, focus activation, results, and retry work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { globalThis.__copiedResult = value; } },
    });
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const response = await page.goto("/prototypes/latch/");
  expect(response?.ok()).toBe(true);
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/latch/play-started/new").length).toBe(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Latch!");
  await expect(page.getByText(/stay inside and secure only/i)).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);

  const doors = page.getByRole("button", { name: /Door [1-4]/ });
  await expect(doors).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    const box = await page.locator(".door").nth(index).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(64);
    expect(box.height).toBeGreaterThanOrEqual(64);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  const warmCacheInteractive = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation");
    return navigation.domInteractive;
  });
  expect(warmCacheInteractive).toBeLessThan(2000);
  test.info().annotations.push({
    type: "warm-cache-interactive",
    description: Math.round(warmCacheInteractive) + " ms at 320x568",
  });

  const touchDoor = await waitForThreat(page, 1);
  const touchBox = await touchDoor.boundingBox();
  const x = touchBox.x + touchBox.width / 2;
  const y = touchBox.y + touchBox.height / 2;
  await touchDoor.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: x,
    clientY: y,
  });
  await touchDoor.dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    clientX: x,
    clientY: y,
  });
  await expect(page.locator("#score")).not.toHaveText("0");

  await (await waitForThreat(page, 4)).click();
  await waitForThreat(page, 3);
  await page.keyboard.press("3");
  await waitForThreat(page, 2);
  await page.locator(".door").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".door").nth(1)).toBeFocused();
  await page.keyboard.press("Space");

  const scoreBeforeWrong = await page.locator("#score").textContent();
  await page.keyboard.press("1");
  await expect(page.locator("#feedback")).toContainText("Panic tap");
  await expect(page.locator("#score")).toHaveText(scoreBeforeWrong);

  const result = page.locator("#result-card");
  await expect(result).toBeVisible({ timeout: 10000 });
  await expectResultDiscovery(page, result, {
    crossGameName: "One Lucky Bloom",
    crossGamePath: "/games/one-lucky-bloom/",
    retryName: "Retry Latch!",
  });
  await expect(page.locator("#final-hits")).toHaveText("4");
  await expect(page.locator("#final-false")).toHaveText("1");
  await expect(result).toContainText(/keep your distance/i);
  await expect(page.locator("#result-card button")).toHaveCount(2);
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/latch/play-completed/new").length).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "latch-result-mobile.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Share game link" }).click();
  await expect(page.locator("#share-status")).toHaveText("Result copied.");
  expect(await page.evaluate(() => globalThis.__copiedResult)).toBe(
    "I played Latch! Try it: https://nownowgames.co.za/prototypes/latch/",
  );
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/latch/share-triggered/new").length).toBe(1);
  const startsBeforeRetry = eventPaths(requests).filter((path) =>
    path === "/event/latch/play-started/new").length;
  await page.getByRole("button", { name: "Retry Latch!" }).click();
  await expect(result).toBeHidden();
  await expect(page.locator("#score")).toHaveText("0");
  await expect(page.locator("#timer")).toHaveText("55");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/latch/play-started/new").length).toBe(startsBeforeRetry + 1);
  expect(
    requests.every((url) => url.startsWith(`${localOrigin}/`)),
  ).toBe(true);
});

test("reduced motion keeps the static warning wedge and progress ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prototypes/latch/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  const door = await waitForThreat(page, 1);
  const signal = await door.evaluate((node) => ({
    handleAnimation: getComputedStyle(node.querySelector(".handle")).animationName,
    reachDisplay: getComputedStyle(node.querySelector(".reach")).display,
    warningOpacity: getComputedStyle(node.querySelector(".warning")).opacity,
    ringOpacity: getComputedStyle(node.querySelector(".progress")).opacity,
    background: getComputedStyle(node).backgroundImage,
  }));
  expect(signal.handleAnimation).toBe("none");
  expect(signal.reachDisplay).toBe("none");
  expect(signal.warningOpacity).toBe("1");
  expect(signal.ringOpacity).toBe("1");
  expect(signal.background).toContain("repeating-linear-gradient");

  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "latch-warning-reduced-mobile.png"),
      fullPage: true,
    });
  }
});

test("background recovery pauses the cue clock instead of bunching warnings", async ({
  page,
}) => {
  await page.goto("/prototypes/latch/");
  const before = await page.locator("#timer").textContent();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("body")).toHaveAttribute("data-paused", "true");
  await page.waitForTimeout(500);
  await expect(page.locator("#timer")).toHaveText(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("body")).toHaveAttribute("data-paused", "false");
  await expect(page.locator("#timer")).toHaveText(before);
});
