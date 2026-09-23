import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expectResultDiscovery } from "./result-discovery.mjs";

const localOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.EVIDENCE_DIR;
const answers = [4, 3, 2, 3, 1, 5];

function eventPaths(requests) {
  return requests
    .map((request) => new URL(request))
    .filter((url) => url.pathname === "/analytics/count")
    .map((url) => url.searchParams.get("p"));
}

function eventCount(requests, path) {
  return eventPaths(requests).filter((eventPath) => eventPath === path).length;
}

async function practice(page, sector = 3) {
  await page.getByRole("button", { name: `Practice sector ${sector}` }).click();
  await expect(page.locator("#practice-reveal")).toBeVisible();
  await expect(page.locator("#practice-status")).toContainText("no score or timer");
  await expect(page.getByRole("button", { name: "Start six-signal run" })).toBeEnabled();
}

async function seedReturning(page) {
  await page.addInitScript(() => {
    localStorage.setItem("nownow-surface-signal-played-v1", "1");
  });
}

test("paused practice, touch, keyboard focus, reduced motion, and explicit key start", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));

  const response = await page.goto("/prototypes/surface-signal/");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SurfaceSignal");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator("body")).toHaveAttribute("data-paused", "true");
  await expect(page.locator("#launch-card")).toBeVisible();
  await expect(page.locator("#game-panel")).toBeHidden();
  await expect(page.getByRole("button", { name: "Start six-signal run" })).toBeDisabled();
  await expect(page.locator("audio")).toHaveCount(0);
  expect(
    await page.locator(".plume").first().evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");

  await page.clock.runFor(3_000);
  expect(eventCount(requests, "/event/surface-signal/play-started/new")).toBe(0);
  await expect(page.locator("#practice-reveal")).toBeHidden();

  const practiceSurface = page.locator("#practice-control");
  const practiceBox = await practiceSurface.boundingBox();
  expect(practiceBox.width / 5).toBeGreaterThanOrEqual(44);
  expect(practiceBox.height).toBeGreaterThanOrEqual(44);
  await practiceSurface.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: practiceBox.x + practiceBox.width * 0.5,
    clientY: practiceBox.y + practiceBox.height / 2,
  });
  await practiceSurface.dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    clientX: practiceBox.x + practiceBox.width * 0.5,
    clientY: practiceBox.y + practiceBox.height / 2,
  });
  await expect(page.locator("#practice-reveal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start six-signal run" })).toBeFocused();
  expect(eventCount(requests, "/event/surface-signal/play-started/new")).toBe(0);

  await page.keyboard.press("Enter");
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#sector-control")).toBeFocused();
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/play-started/new"),
  ).toBe(1);
  await page.clock.runFor(1_200);

  const surface = page.locator("#sector-control");
  const box = await surface.boundingBox();
  await surface.dispatchEvent("pointerdown", {
    pointerId: 42,
    pointerType: "touch",
    clientX: box.x + box.width * 0.72,
    clientY: box.y + box.height / 2,
  });
  await surface.dispatchEvent("pointerup", {
    pointerId: 42,
    pointerType: "touch",
    clientX: box.x + box.width * 0.72,
    clientY: box.y + box.height / 2,
  });
  await expect(page.getByRole("button", { name: "Sector 4" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(eventCount(requests, "/event/surface-signal/first-input/new")).toBe(1);
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
  await page.locator("#practice-control").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Practice sector 1" })).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start six-signal run" }).click();
  await page.clock.runFor(1_200);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Sector 1" })).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sector 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("six scored rounds emit the bounded funnel once, complete, persist, and share", async ({ page }) => {
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
  await practice(page);
  await page.getByRole("button", { name: "Start six-signal run" }).click();

  for (const answer of answers) {
    await page.clock.runFor(1_200);
    await page.keyboard.press(String(answer));
    await page.clock.runFor(5_800);
  }

  await expect(page.locator("#result-card")).toBeVisible();
  await expectResultDiscovery(page, page.locator("#result-card"), {
    crossGameName: "One Lucky Bloom",
    crossGamePath: "/games/one-lucky-bloom/",
    retryName: "Watch another six",
  });
  await expect(page.locator("#final-correct")).toHaveText("6/6");
  await expect(page.locator("#final-early")).toHaveText("6");
  const browserScore = Number(await page.locator("#final-score").textContent());
  expect(browserScore).toBeGreaterThanOrEqual(588);
  expect(browserScore).toBeLessThanOrEqual(600);
  await expect(page.locator("#trace li.hit")).toHaveCount(6);
  expect(
    await page.evaluate(() => ({
      best: localStorage.getItem("nownow-surface-signal-best-v1"),
      played: localStorage.getItem("nownow-surface-signal-played-v1"),
    })),
  ).toEqual({ best: "6", played: "1" });

  for (const action of [
    "play-started",
    "first-input",
    "round-2-reached",
    "round-4-reached",
    "round-6-reached",
    "play-completed",
  ]) {
    await expect.poll(() =>
      eventCount(requests, `/event/surface-signal/${action}/new`),
    ).toBe(1);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Share your horizon trace" }).click();
  await expect(page.locator("#share-status")).toHaveText("Shared.");
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/share-triggered/new"),
  ).toBe(1);
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
});

test("a first 0/6 completion makes retry and reload returning without auto-start", async ({ page }) => {
  await page.clock.install();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/prototypes/surface-signal/");
  await practice(page, 1);
  await page.getByRole("button", { name: "Start six-signal run" }).click();
  await page.clock.runFor(42_000);

  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.locator("#final-correct")).toHaveText("0/6");
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/play-completed/new"),
  ).toBe(1);
  expect(
    await page.evaluate(() => ({
      best: localStorage.getItem("nownow-surface-signal-best-v1"),
      played: localStorage.getItem("nownow-surface-signal-played-v1"),
    })),
  ).toEqual({ best: "0", played: "1" });

  await page.getByRole("button", { name: "Watch another six" }).click();
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/play-started/returning"),
  ).toBe(1);

  await page.reload();
  await expect(page.locator("#launch-card")).toBeVisible();
  await expect(page.locator("#game-panel")).toBeHidden();
  await expect(page.getByRole("button", { name: "Start six-signal run" })).toBeEnabled();
  expect(eventCount(requests, "/event/surface-signal/play-started/returning")).toBe(1);
  await page.getByRole("button", { name: "Start six-signal run" }).click();
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/play-started/returning"),
  ).toBe(2);
});

test("throwing storage still reaches six-round result and completion telemetry", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() { throw new DOMException("Storage denied", "SecurityError"); },
      });
    }
  });
  const requests = [];
  const pageErrors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/prototypes/surface-signal/");
  await practice(page);
  await page.getByRole("button", { name: "Start six-signal run" }).click();
  await page.clock.runFor(42_000);

  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.locator("#trace li")).toHaveCount(6);
  await expect(page.locator("#final-correct")).toHaveText("0/6");
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/play-completed/new"),
  ).toBe(1);
  expect(pageErrors).toEqual([]);

  await page.getByRole("button", { name: "Watch another six" }).click();
  await expect.poll(() =>
    eventCount(requests, "/event/surface-signal/play-started/returning"),
  ).toBe(1);
});

test("background suspension freezes the cue clock", async ({ page }) => {
  await seedReturning(page);
  await page.clock.install();
  await page.goto("/prototypes/surface-signal/");
  await page.getByRole("button", { name: "Start six-signal run" }).click();
  await page.clock.runFor(500);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const pausedAt = await page.locator("#time-left").textContent();
  await page.clock.runFor(1_400);
  await expect(page.locator("#time-left")).toHaveText(pausedAt);
  await expect(page.locator("body")).toHaveAttribute("data-paused", "true");
});

test("feedback isolates number and arrow keys while pausing and resuming the run", async ({ page }) => {
  await seedReturning(page);
  await page.clock.install();
  await page.goto("/prototypes/surface-signal/");
  await page.getByRole("button", { name: "Start six-signal run" }).click();
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
  await expect(page.locator("#sector-control")).toHaveAttribute(
    "aria-activedescendant",
    activeBefore,
  );
  await expect(page.locator("#sector-control")).toHaveAttribute("data-locked", "false");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-paused", "false");
  await page.clock.runFor(100);
  expect(await page.locator("#time-left").textContent()).not.toBe(before);
});
