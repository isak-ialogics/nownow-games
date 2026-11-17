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

  await page.getByRole("button", { name: "Share to WhatsApp or another app" }).focus();
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
  await page.getByRole("button", { name: "Share to WhatsApp or another app" }).click();
  await expect(page.locator("#share-status")).toHaveText("Result and game link copied.");
  expect(await page.evaluate(() => globalThis.__fallback)).toBe(
    "I found 0/1 unfinished marks in 42 seconds on One More Mark. How clean is your final scan?\nhttps://nownowgames.co.za/games/one-more-mark/",
  );
});
