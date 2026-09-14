import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const localOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.EVIDENCE_DIR;

function eventPaths(requests) {
  return requests
    .map((request) => new URL(request))
    .filter((url) => url.pathname === "/analytics/count")
    .map((url) => url.searchParams.get("p"));
}

test("mobile play exposes equivalent touch and keyboard controls without external calls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const response = await page.goto("/prototypes/same-flame/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SameFlame");
  await expect(page.getByText(/Match the left fire for 36 seconds/)).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Hold to lift your flame/ }),
  ).toBeVisible();
  const control = page.locator("#pulse-control");
  const box = await control.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  await control.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: 150,
    clientY: 500,
  });
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await control.dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    clientX: 150,
    clientY: 500,
  });
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await control.focus();
  await page.keyboard.down("Space");
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("Space");
  await expect(control).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.reload();
  const interactive = await page.evaluate(
    () => performance.getEntriesByType("navigation")[0].domInteractive,
  );
  expect(interactive).toBeLessThan(2000);
  test.info().annotations.push({
    type: "warm-cache-interactive",
    description: `${Math.round(interactive)} ms at 320x740`,
  });
  expect(requests.every((url) => url.startsWith(`${localOrigin}/`))).toBe(true);
});

test("a 36-second matched rhythm merges, persists, shares, and retries", async ({ page }) => {
  await page.clock.install({
    time: new Date("2026-09-12T12:00:00+02:00"),
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        globalThis.__sharedResult = data;
      },
    });
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/prototypes/same-flame/");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/same-flame/play-started/new").length).toBe(1);
  const control = page.locator("#pulse-control");
  for (let pulse = 0; pulse < 12; pulse += 1) {
    await control.focus();
    await page.keyboard.down("Space");
    await page.clock.runFor(1500);
    await page.keyboard.up("Space");
    await page.clock.runFor(1500);
  }

  const result = page.locator("#result-card");
  await expect(result).toBeVisible();
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/same-flame/play-completed/new").length).toBe(1);
  const browserSync = Number(
    (await page.locator("#final-sync").textContent()).replace("%", ""),
  );
  expect(browserSync).toBeGreaterThanOrEqual(80);
  await expect(page.locator("#result-title")).toHaveText(
    "Two fires. One shared glow.",
  );
  await expect(page.locator("#result-message")).toContainText(
    "Different stories, same flame",
  );
  await expect(page.locator("#merged-flame")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Number(localStorage.getItem("nownow-same-flame-best-v1")),
    ),
  ).toBe(browserSync);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Share your rhythm" }).click();
  await expect(page.locator("#share-status")).toHaveText("Shared.");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/same-flame/share-triggered/new").length).toBe(1);
  expect(await page.evaluate(() => globalThis.__sharedResult)).toEqual({
    title: "Same Flame",
    text: `I found ${browserSync}% sync in Same Flame. Bring your rhythm.`,
    url: "https://nownowgames.co.za/prototypes/same-flame/",
  });
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "same-flame-merged-mobile.png"),
      fullPage: true,
    });
  }

  const startsBeforeRetry = eventPaths(requests).filter((path) =>
    path === "/event/same-flame/play-started/new").length;
  await page.getByRole("button", { name: "Try the flame again" }).click();
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#time-left")).toHaveText("36.0");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/same-flame/play-started/new").length).toBe(startsBeforeRetry + 1);
});

test("background recovery, reduced motion, and expiry retain clear states", async ({ page }) => {
  await page.clock.install({
    time: new Date("2026-09-12T12:00:00+02:00"),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prototypes/same-flame/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  expect(
    await page.locator("#guide-flame").evaluate(
      (node) => getComputedStyle(node, "::after").animationName,
    ),
  ).toBe("none");
  await page.clock.runFor(400);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const pausedAt = await page.locator("#time-left").textContent();
  await page.clock.runFor(1000);
  await expect(page.locator("#time-left")).toHaveText(pausedAt);
  await expect(page.locator("body")).toHaveAttribute("data-paused", "true");

  await page.clock.setFixedTime(new Date("2026-09-25T00:00:00+02:00"));
  await page.reload();
  await expect(page.locator("#expiry-card")).toBeVisible();
  await expect(page.locator("#game-panel")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: /rested after 24 September/ }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "same-flame-expiry-mobile.png"),
      fullPage: true,
    });
  }
});
