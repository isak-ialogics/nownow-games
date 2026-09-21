import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const localOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.EVIDENCE_DIR;
const answers = [4, 3, 2, 3, 1, 5];

function eventPaths(requests) {
  return requests
    .map((request) => new URL(request))
    .filter((url) => url.pathname === "/analytics/count")
    .map((url) => url.searchParams.get("p"));
}

test("mobile touch, arrow controls, reduced motion, accessibility, and budget hold", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const response = await page.goto("/prototypes/surface-signal/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SurfaceSignal");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator("audio")).toHaveCount(0);
  expect(
    await page.locator(".plume").evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  const surface = page.locator("#sector-control");
  const box = await surface.boundingBox();
  expect(box.width / 5).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(1200);
  await surface.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: box.x + box.width * 0.72,
    clientY: box.y + box.height / 2,
  });
  await surface.dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    clientX: box.x + box.width * 0.72,
    clientY: box.y + box.height / 2,
  });
  await expect(page.getByRole("button", { name: "Sector 4" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(requests.every((url) => url.startsWith(`${localOrigin}/`))).toBe(true);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "surface-signal-reduced-motion-mobile.png"),
      fullPage: true,
    });
  }

  await page.reload();
  await page.waitForTimeout(1200);
  await surface.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Sector 1" })).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sector 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const interactive = await page.evaluate(
    () => performance.getEntriesByType("navigation")[0].domInteractive,
  );
  expect(interactive).toBeLessThan(2000);
  test.info().annotations.push({
    type: "warm-cache-interactive",
    description: `${Math.round(interactive)} ms at 320x740`,
  });
});

test("a perfect 42-second keyboard run persists, shares, emits telemetry, and retries", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => { globalThis.__sharedResult = data; },
    });
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/prototypes/surface-signal/");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/surface-signal/play-started/new").length).toBe(1);

  for (const answer of answers) {
    await page.clock.runFor(1200);
    await page.keyboard.press(String(answer));
    await page.clock.runFor(5800);
  }

  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.locator("#final-correct")).toHaveText("6/6");
  await expect(page.locator("#final-early")).toHaveText("6");
  const browserScore = Number(await page.locator("#final-score").textContent());
  expect(browserScore).toBeGreaterThanOrEqual(588);
  expect(browserScore).toBeLessThanOrEqual(600);
  await expect(page.locator("#trace li.hit")).toHaveCount(6);
  expect(
    await page.evaluate(() => localStorage.getItem("nownow-surface-signal-best-v1")),
  ).toBe("6");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/surface-signal/play-completed/new").length).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Share your horizon trace" }).click();
  await expect(page.locator("#share-status")).toHaveText("Shared.");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/surface-signal/share-triggered/new").length).toBe(1);
  expect(await page.evaluate(() => globalThis.__sharedResult)).toEqual({
    title: "Surface Signal",
    text: "I read 6/6 Surface Signals · 6 early calls.",
    url: "https://nownowgames.co.za/prototypes/surface-signal/",
  });
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "surface-signal-result-mobile.png"),
      fullPage: true,
    });
  }
  const starts = eventPaths(requests).filter((path) =>
    path === "/event/surface-signal/play-started/new").length;
  await page.getByRole("button", { name: "Watch another six" }).click();
  await expect(page.locator("#game-panel")).toBeVisible();
  expect(Number(await page.locator("#time-left").textContent())).toBeGreaterThan(41.8);
  await expect(page.locator("#cue-count")).toHaveText("1/6");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/surface-signal/play-started/new").length).toBe(starts + 1);

  await page.reload();
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/surface-signal/play-started/returning").length).toBe(1);
  await page.clock.runFor(42_000);
  await expect(page.locator("#result-card")).toBeVisible();
  await page.getByRole("button", { name: "Reset saved best" }).click();
  await expect(page.locator("#best-read")).toHaveText("0/6 read \u00b7 0 early");
  await expect(page.locator("#share-status")).toHaveText("Saved best reset.");
  expect(await page.evaluate(() => ({
    correct: localStorage.getItem("nownow-surface-signal-best-v1"),
    early: localStorage.getItem("nownow-surface-signal-early-v1"),
  }))).toEqual({ correct: null, early: null });
});

test("background and feedback suspension freeze the cue clock", async ({ page }) => {
  await page.clock.install();
  await page.goto("/prototypes/surface-signal/");
  await page.clock.runFor(500);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const pausedAt = await page.locator("#time-left").textContent();
  await page.clock.runFor(1400);
  await expect(page.locator("#time-left")).toHaveText(pausedAt);
  await expect(page.locator("body")).toHaveAttribute("data-paused", "true");
});

test("feedback isolates number and arrow keys while pausing and resuming the run", async ({ page }) => {
  await page.clock.install();
  await page.goto("/prototypes/surface-signal/");
  await page.clock.runFor(1_200);
  const activeBefore = await page.locator("#sector-control").getAttribute("aria-activedescendant");
  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(page.locator(".feedback-dialog")).toBeVisible();
  const before = await page.locator("#time-left").textContent();
  await page.keyboard.type("12345");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await page.clock.runFor(1_400);
  await expect(page.locator("#time-left")).toHaveText(before);
  await expect(page.locator("#sector-control")).toHaveAttribute("aria-activedescendant", activeBefore);
  await expect(page.locator("#sector-control")).toHaveAttribute("data-locked", "false");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-paused", "false");
  await page.clock.runFor(100);
  expect(await page.locator("#time-left").textContent()).not.toBe(before);
});
