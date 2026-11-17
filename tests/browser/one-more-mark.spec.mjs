import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { expectResultDiscovery } from "./result-discovery.mjs";

const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.NNG_EVIDENCE_DIR;
const eventPaths = (requests) => requests.map((value) => new URL(value))
  .filter((url) => url.pathname === "/analytics/count")
  .map((url) => url.searchParams.get("p"));

test("320px touch and keyboard play keeps timing, focus, motion, and muted feedback equivalent", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    class TestAudioContext {
      constructor() { globalThis.__audioConstructed = true; }
      currentTime = 0;
      destination = {};
      createOscillator() {
        return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
      }
    }
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: TestAudioContext });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/games/one-more-mark/");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href", "https://nownowgames.co.za/games/one-more-mark/",
  );
  await expect(page.getByRole("button", { name: "Sound off" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /FILL/ })).toBeFocused();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.locator("#paper").evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const fill = page.getByRole("button", { name: /FILL/ });
  const flip = page.getByRole("button", { name: /FLIP/ });
  const fillBox = await fill.boundingBox();
  const flipBox = await flip.boundingBox();
  expect(fillBox.width).toBeGreaterThanOrEqual(44);
  expect(fillBox.height).toBeGreaterThanOrEqual(44);
  expect(flipBox.width).toBeGreaterThanOrEqual(44);
  expect(flipBox.height).toBeGreaterThanOrEqual(44);
  expect(fillBox.x + fillBox.width).toBeLessThanOrEqual(flipBox.x);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await fill.tap();
  await expect(page.locator("#marks")).toHaveText("1");
  await expect(page.locator("#feedback")).toHaveText("Filled. Mark banked.");
  await page.keyboard.press("F");
  await expect(page.locator("#marks")).toHaveText("1");
  await expect(page.locator("#page-number")).toHaveText("Page 1 of 5");
  await page.clock.runFor(320);
  await expect(page.locator("#page-number")).toHaveText("Page 2 of 5");

  await flip.focus();
  expect(await flip.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator("#streak")).toHaveText("1");
  await page.clock.runFor(320);
  const beforePenalty = Number(await page.locator("#time").textContent());
  await page.keyboard.press("Space");
  await expect(page.locator("#feedback")).toHaveText("Already complete. −2 seconds.");
  const afterPenalty = Number(await page.locator("#time").textContent());
  expect(beforePenalty - afterPenalty).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#streak")).toHaveText("0");

  await page.clock.runFor(43_000);
  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan another booklet" })).toBeFocused();
  await expect(page.getByText(/never a grade or real exam result/i)).toBeVisible();
  await expectResultDiscovery(page, page.locator("#result-card"), {
    crossGameName: "One Lucky Bloom",
    crossGamePath: "/games/one-lucky-bloom/",
    retryName: "Scan another booklet",
  });
  expect(await page.evaluate(() => globalThis.__audioConstructed ?? false)).toBe(false);
  expect(requests.every((url) => url.startsWith(`${origin}/`))).toBe(true);
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/one-more-mark/play-completed/new").length).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/one-more-mark-result-mobile.png`, fullPage: true });
  }

  await page.keyboard.press("Enter");
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#booklet")).toHaveText("Graphite grid");
  await expect(page).toHaveURL(`${origin}/games/one-more-mark/`);
});

test("result controls use Web Share, explicit copy, and a keyboard path without a trap", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => { globalThis.__shared = data; },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { globalThis.__copied = text; } },
    });
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/games/one-more-mark/");
  await page.clock.runFor(43_000);
  await expect(page.locator("#result-card")).toBeVisible();

  await page.getByRole("button", { name: "Share result" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#share-status")).toHaveText("Share sheet opened.");
  expect(await page.evaluate(() => globalThis.__shared)).toEqual({
    title: "One More Mark",
    text: "I found 0/1 unfinished marks in 42 seconds on One More Mark. How clean is your final scan?",
    url: "https://nownowgames.co.za/games/one-more-mark/",
  });
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/one-more-mark/share-triggered/new").length).toBe(1);

  await page.getByRole("button", { name: "Copy result + game link" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#share-status")).toHaveText("Result and game link copied.");
  expect(await page.evaluate(() => globalThis.__copied)).toContain(
    "https://nownowgames.co.za/games/one-more-mark/",
  );
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Play One Lucky Bloom" })).toBeFocused();
});

test("Share falls back to copying the result and canonical link", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { globalThis.__fallback = text; } },
    });
  });
  await page.goto("/games/one-more-mark/");
  await page.clock.runFor(43_000);
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(page.locator("#share-status")).toHaveText("Result and game link copied.");
  expect(await page.evaluate(() => globalThis.__fallback)).toBe(
    "I found 0/1 unfinished marks in 42 seconds on One More Mark. How clean is your final scan?\nhttps://nownowgames.co.za/games/one-more-mark/",
  );
});

test("cancelled result feedback leaves every retry path in a clean active round", async ({ browser }) => {
  test.setTimeout(150_000);
  const viewports = [
    { name: "mobile320", width: 320, height: 740, isMobile: true, hasTouch: true },
    { name: "desktop", width: 1280, height: 800, isMobile: false, hasTouch: false },
  ];
  const retryPaths = [
    { name: "lowercase r", activate: (page) => page.keyboard.press("r") },
    { name: "uppercase R", activate: (page) => page.keyboard.press("R") },
    {
      name: "click",
      activate: (page) => page.getByRole("button", { name: "Scan another booklet" }).click(),
    },
    {
      name: "Enter",
      activate: async (page) => {
        await page.getByRole("button", { name: "Scan another booklet" }).focus();
        await page.keyboard.press("Enter");
      },
    },
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    });
    const page = await context.newPage();
    try {
      await page.clock.install();
      await page.goto(`${origin}/games/one-more-mark/`);

      for (const retryPath of retryPaths) {
        await page.clock.runFor(43_000);
        await expect(page.locator("#result-card"), `${viewport.name}: ${retryPath.name}`).toBeVisible();
        await page.getByRole("button", { name: "Feedback" }).click();
        await expect(page.getByLabel("What happened?")).toBeFocused();
        await page.getByRole("button", { name: "Cancel" }).click();

        await retryPath.activate(page);

        await expect(page.locator("#game-panel"), `${viewport.name}: ${retryPath.name}`).toBeVisible();
        await expect(page.locator("#pause-note"), `${viewport.name}: ${retryPath.name}`).toBeHidden();
        await expect(page.getByRole("button", { name: /FILL/ })).toBeEnabled();
        const before = Number(await page.locator("#time").textContent());
        await page.clock.runFor(1_000);
        const after = Number(await page.locator("#time").textContent());
        expect(before - after, `${viewport.name}: ${retryPath.name} timer`).toBeGreaterThanOrEqual(0.8);
      }
    } finally {
      await context.close();
    }
  }
});

test("live feedback still pauses and resumes an active round", async ({ page }) => {
  await page.clock.install();
  await page.goto("/games/one-more-mark/");
  await page.clock.runFor(1_000);

  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(page.locator("#pause-note")).toBeVisible();
  await expect(page.locator("#fill")).toBeDisabled();
  const pausedAt = Number(await page.locator("#time").textContent());
  await page.clock.runFor(5_000);
  expect(Number(await page.locator("#time").textContent())).toBe(pausedAt);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#pause-note")).toBeHidden();
  await expect(page.locator("#fill")).toBeEnabled();
  await page.clock.runFor(1_000);
  const afterResume = Number(await page.locator("#time").textContent());
  expect(pausedAt - afterResume).toBeGreaterThanOrEqual(0.8);
  await expect(page.locator("#result-card")).toBeHidden();
});

test("result R retry is reload-free, focused, 320px-safe, and ignored while editing feedback", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 740 });
  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await page.goto("/games/one-more-mark/");
  await page.clock.runFor(43_000);
  await expect(page.locator("#result-card")).toBeVisible();

  await page.getByRole("button", { name: "Feedback" }).click();
  const message = page.getByLabel("What happened?");
  await expect(message).toBeFocused();
  await page.keyboard.press("r");
  await expect(message).toHaveValue("r");
  await expect(page.locator("#result-card")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.keyboard.press("R");
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#booklet")).toHaveText("Graphite grid");
  await expect(page.getByRole("button", { name: /FILL/ })).toBeFocused();
  await page.clock.runFor(1_000);
  await expect(page.locator("#result-card")).toBeHidden();
  expect(Number(await page.locator("#time").textContent())).toBeGreaterThanOrEqual(40.9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.clock.runFor(42_000);
  await page.keyboard.press("r");
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#booklet")).toHaveText("Teal corners");

  await page.clock.runFor(43_000);
  await page.getByRole("button", { name: "Scan another booklet" }).click();
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#booklet")).toHaveText("Coral rules");
  expect(mainFrameNavigations).toBe(1);
});
