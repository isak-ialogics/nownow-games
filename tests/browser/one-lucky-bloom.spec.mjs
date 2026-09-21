import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const answers = [2, 3, 1, 5, 4, 3];
const key = "nownow-one-lucky-bloom-best-v1";
const evidenceDir = process.env.NNG_EVIDENCE_DIR;

const paths = (requests) => requests.map((value) => new URL(value))
  .filter((url) => url.pathname === "/analytics/count")
  .map((url) => url.searchParams.get("p"));

test("first play teaches, stays mobile/reduced-motion accessible, and separates selection from lock", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    class TestAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect() {},
          start() { globalThis.__audioStarted = true; },
          stop() {},
        };
      }
    }
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: TestAudioContext });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/games/one-lucky-bloom/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://nownowgames.co.za/games/one-lucky-bloom/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("button", { name: "Sound off" }).click();
  expect(paths(requests)).not.toContain("/event/one-lucky-bloom/play-started/new");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Try your luck" }).click();
  await expect(page.getByRole("heading", { name: "Each cue moves the bloom one lane." })).toBeVisible();
  await expect.poll(() => paths(requests).filter((path) => path === "/event/one-lucky-bloom/play-started/new").length).toBe(1);
  await page.clock.runFor(4_000);
  await expect(page.locator("#gp")).toBeVisible();
  await expect(page.locator("#k")).toBeDisabled();
  await page.getByRole("radio", { name: "Lane 2" }).click();
  await expect(page.getByRole("radio", { name: "Lane 2" })).toHaveAttribute("aria-checked", "true");
  await page.clock.runFor(2_000);
  await expect(page.locator("#k")).toBeEnabled();
  await expect(page.locator("#b")).toHaveAttribute("style", /--x: 50%; --y: 12%/u);
  await page.clock.runFor(1_200);
  await expect(page.locator("#b")).toHaveAttribute("style", /--x: 30%; --y: 34%/u);
  await page.locator("#k").click();
  expect(await page.evaluate(() => globalThis.__audioStarted)).toBe(true);
  await expect(page.locator("#k")).toHaveText("Lane 2 locked");
  for (const button of await page.getByRole("radio").all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(requests.every((url) => url.startsWith(`${origin}/`))).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("perfect keyboard play persists, emits bounded telemetry, shares exact copy, and retries", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { globalThis.__share = data; } });
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/games/one-lucky-bloom/");
  await page.getByRole("button", { name: "Try your luck" }).click();
  await page.getByRole("button", { name: "Skip and play" }).click();

  for (const answer of answers) {
    await page.clock.runFor(2_000);
    await page.keyboard.press(String(answer));
    await page.locator("#k").focus();
    await page.keyboard.press("Enter");
    await page.clock.runFor(5_000);
  }

  await expect(page.locator("#rc")).toBeVisible();
  await expect(page.locator("#rt")).toHaveText("Full page of luck");
  await expect(page.locator("#fs")).toHaveText("600 / 600");
  await expect(page.locator("#e li.hit")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Play again" })).toBeFocused();
  const stored = JSON.parse(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key));
  expect(stored).toMatchObject({ version: 1, bestScore: 600, bestCatches: 6, playsCompleted: 1, tutorialSeen: true });
  await expect.poll(() => paths(requests).filter((path) => path === "/event/one-lucky-bloom/play-completed/new").length).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: `${evidenceDir}/one-lucky-bloom-result-mobile.png`,
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Share ledger" }).click();
  await expect.poll(() => paths(requests).filter((path) => path === "/event/one-lucky-bloom/share-triggered/new").length).toBe(1);
  expect(await page.evaluate(() => globalThis.__share)).toEqual({
    text: "One Lucky Bloom — 600/600\nLuck ledger: ✓✓✓✓✓✓ (6/6)\nCan you read the branches and lock in earlier?\nhttps://nownowgames.co.za/games/one-lucky-bloom/",
  });
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.locator("#gp")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Play again" }).click();
  await expect.poll(() => paths(requests).filter((path) => path === "/event/one-lucky-bloom/play-started/returning").length).toBe(1);
});

test("feedback isolates gameplay keys, freezes active time, and resumes through the accessible cue", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(({ storageKey }) => localStorage.setItem(storageKey, JSON.stringify({
    version: 1, bestScore: 100, bestCatches: 1, playsCompleted: 1,
    tutorialSeen: true, soundEnabled: false, reduceMotionOverride: false,
  })), { storageKey: key });
  await page.goto("/games/one-lucky-bloom/");
  await page.getByRole("button", { name: "Play again" }).click();
  await page.clock.runFor(1_800);
  const before = await page.locator("#p").textContent();
  const bloomBefore = await page.locator("#b").getAttribute("style");
  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(page.locator(".feedback-dialog")).toBeVisible();
  await expect(page.locator("#pm")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.type("12345");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await page.clock.runFor(1_400);
  await expect(page.locator("#p")).toHaveText(before);
  await expect(page.locator("#b")).toHaveAttribute("style", bloomBefore);
  await expect(page.locator("#feedback-message")).toHaveValue("1234\n5");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#pm")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#rn")).toHaveText("3");
  await page.keyboard.press("1");
  await expect(page.getByRole("radio", { name: "Lane 3" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#k")).toBeDisabled();
  await page.clock.runFor(3_300);
  await expect(page.locator("#rn")).toBeHidden();
  await page.keyboard.press("1");
  await expect(page.getByRole("radio", { name: "Lane 1" })).toHaveAttribute("aria-checked", "true");
});

test("storage-disabled play, copy fallback, reset scope, and responsive widths remain truthful", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Object.defineProperty(Storage.prototype, method, { configurable: true, value() { throw new Error("blocked"); } });
    }
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { globalThis.__copied = text; } } });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [320, 360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/games/one-lucky-bloom/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await expect(page.locator("#sn")).toBeVisible();
  await page.getByRole("button", { name: "Try your luck" }).click();
  await page.getByRole("button", { name: "Skip and play" }).click();
  await page.clock.runFor(42_000);
  await expect(page.locator("#rc")).toBeVisible();
  await page.getByRole("button", { name: "Share ledger" }).click();
  await expect(page.locator("#ss")).toHaveText("Challenge copied.");
  expect(await page.evaluate(() => globalThis.__copied)).toContain("https://nownowgames.co.za/games/one-lucky-bloom/");
  expect(errors).toEqual([]);
});
