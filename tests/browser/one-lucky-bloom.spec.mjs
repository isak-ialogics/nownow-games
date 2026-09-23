import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { expectResultDiscovery } from "./result-discovery.mjs";

const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const answers = [2, 3, 1, 5, 4, 3];
const key = "nownow-one-lucky-bloom-best-v1";
const evidenceDir = process.env.NNG_EVIDENCE_DIR;

const paths = (requests) => requests.map((value) => new URL(value))
  .filter((url) => url.pathname === "/analytics/count")
  .map((url) => url.searchParams.get("p"));

async function advanceUntil(page, predicate, { step = 100, limit = 8_000 } = {}) {
  for (let elapsed = 0; elapsed <= limit; elapsed += step) {
    if (await predicate()) return;
    await page.clock.runFor(step);
  }
  throw new Error(`Timed out advancing the game clock after ${limit}ms.`);
}

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

  for (const [index, answer] of answers.entries()) {
    const answerButton = page.getByRole("radio", { name: `Lane ${answer}` });
    await advanceUntil(page, async () => !(await answerButton.isDisabled()));
    await page.keyboard.press(String(answer));
    await advanceUntil(page, async () => await page.locator("#k").isEnabled());
    await page.locator("#k").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#k")).toBeDisabled();
    await page.clock.runFor(4_500);
    if (index < answers.length - 1) {
      await advanceUntil(page, async () => {
        const next = `Bloom ${index + 2} of 6`;
        return await page.locator("#p").textContent() === next &&
          !(await page.getByRole("radio", { name: "Lane 3" }).isDisabled());
      }, { step: 250, limit: 1_000 });
    }
  }

  await advanceUntil(page, async () => await page.locator("#rc").isVisible());
  await expect(page.locator("#rc")).toBeVisible();
  await expectResultDiscovery(page, page.locator("#rc"), {
    crossGameName: "Surface Signal",
    crossGamePath: "/prototypes/surface-signal/",
    retryName: "Play again",
  });
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

test("successful feedback isolates gameplay keys, freezes active time, and resumes through the accessible cue", async ({ page }) => {
  await page.clock.install();
  await page.route("**/feedback/submit", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "resume-1" }),
  }));
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
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#feedback-status")).toContainText("resume-1");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#pm")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#rn")).toHaveText("3");
  await page.keyboard.press("1");
  await expect(page.getByRole("radio", { name: "Lane 3" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#k")).toBeDisabled();
  await page.clock.runFor(3_300);
  await expect(page.locator("#rn")).toBeHidden();
  await expect(page.locator("#k")).toBeEnabled();
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
