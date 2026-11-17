import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.NNG_EVIDENCE_DIR;
const eventPaths = (requests) => requests.map((value) => new URL(value))
  .filter((url) => url.pathname === "/analytics/count")
  .map((url) => url.searchParams.get("p"));

test("390px first play holds time, corrects both wrong branches, and teaches direct actions", async ({ page }) => {
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
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true, value: TestAudioContext,
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/games/one-more-mark/");

  await expect(page.getByRole("heading", { name: "Find every empty answer." })).toBeVisible();
  await expect(page.locator("#time")).toHaveText("42.0");
  await expect(page.locator("#timer-state")).toHaveText("Held");
  await expect(page.locator("#marks")).toHaveText("0");
  await expect(page.locator("#feedback")).toHaveText("Tap row 2 · Key 2.");
  await expect(page.getByRole("button", { name: "Row 2, empty answer" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Sound off" })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.locator("#paper").evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const rows = page.locator(".answer-row");
  await expect(rows).toHaveCount(4);
  for (const row of await rows.all()) {
    const box = await row.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  const complete = page.getByRole("button", { name: /Page complete/ });
  const completeBox = await complete.boundingBox();
  expect(completeBox.height).toBeGreaterThanOrEqual(44);
  expect(completeBox.y + completeBox.height).toBeLessThanOrEqual(844);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.clock.runFor(5_000);
  await expect(page.locator("#time")).toHaveText("42.0");
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: `${evidenceDir}/one-more-mark-first-encounter-390x844.png`,
      scale: "css",
    });
  }

  await page.getByRole("button", { name: "Row 1, filled answer" }).click();
  await expect(page.locator("#feedback")).toHaveText("That row is already filled");
  await expect(page.locator("#time")).toHaveText("42.0");
  await page.keyboard.press("2");
  await expect(page.locator("#marks")).toHaveText("0");
  await page.clock.runFor(320);

  await complete.click();
  await expect(page.locator("#feedback")).toHaveText("Row 2 is empty. Try that row.");
  await expect(page.locator("#time")).toHaveText("42.0");
  await page.clock.runFor(320);

  await page.keyboard.press("2");
  await expect(page.locator("#marks")).toHaveText("1");
  await expect(page.locator("#timer-state")).toHaveText("Running");
  await expect(page.locator("#feedback")).toHaveText("Filled · +1 mark · Next page");
  await expect(page.getByRole("button", { name: "Row 2, filled answer" })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.locator("#marks")).toHaveText("1");
  if (evidenceDir) {
    await page.screenshot({
      path: `${evidenceDir}/one-more-mark-first-correct-390x844.png`,
      scale: "css",
    });
  }

  await page.clock.runFor(320);
  await expect(page.locator("#page-number")).toHaveText("Page 2 of 5");
  await expect(complete).toBeFocused();
  await expect(page.locator("#feedback")).toHaveText("No empty row? Page complete · Key C.");
  await expect(page.locator("#paper")).not.toContainText("EMPTY");
  await page.keyboard.press("c");
  await expect(page.locator("#streak")).toHaveText("1");
  await expect(page.locator("#feedback")).toHaveText("Page complete · Clean streak +1 · Next page");
  await page.clock.runFor(320);

  const beforePenalty = Number(await page.locator("#time").textContent());
  await page.keyboard.press("1");
  await expect(page.locator("#feedback")).toHaveText("Already filled · −2 seconds");
  const afterPenalty = Number(await page.locator("#time").textContent());
  expect(beforePenalty - afterPenalty).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => globalThis.__audioConstructed ?? false)).toBe(false);
  expect(requests.every((url) => url.startsWith(`${origin}/`))).toBe(true);

  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("zero time shows the neutral result and R retries one rotated booklet without reload", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = [];
  let mainFrameNavigations = 0;
  page.on("request", (request) => requests.push(request.url()));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });
  await page.goto("/games/one-more-mark/");
  await page.keyboard.press("2");
  await page.clock.runFor(43_000);

  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.getByRole("button", { name: /Scan another booklet/ })).toBeFocused();
  await expect(page.getByText("Scan another five-page booklet. Beat your best marks and clean-page streak.")).toBeVisible();
  await expect(page.getByText(/never a grade or real exam result/i)).toBeVisible();
  await expect(page.locator("#final-marks")).toHaveText("1 / 1");
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/one-more-mark/play-completed/new").length).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.keyboard.press("R");
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#paper")).toHaveClass(/pattern-2/);
  await expect(page.getByRole("button", { name: "Row 2, empty answer" })).toBeFocused();
  await expect(page.locator("#time")).toHaveText("42.0");
  await expect(page.locator("#timer-state")).toHaveText("Held");
  await page.clock.runFor(5_000);
  await expect(page.locator("#time")).toHaveText("42.0");
  expect(mainFrameNavigations).toBe(1);
  await expect(page).toHaveURL(`${origin}/games/one-more-mark/`);
});

test("result controls use Web Share and explicit copy from user actions", async ({ page }) => {
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
  await page.keyboard.press("2");
  await page.clock.runFor(43_000);

  await page.getByRole("button", { name: "Share result" }).click();
  await expect(page.locator("#share-status")).toHaveText("Share sheet opened.");
  expect(await page.evaluate(() => globalThis.__shared)).toEqual({
    title: "One More Mark",
    text: "I found 1/1 empty answers in 42 seconds on One More Mark. How clean is your final scan?",
    url: "https://nownowgames.co.za/games/one-more-mark/",
  });
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/one-more-mark/share-triggered/new").length).toBe(1);

  await page.getByRole("button", { name: "Copy result + game link" }).click();
  await expect(page.locator("#share-status")).toHaveText("Result and game link copied.");
  expect(await page.evaluate(() => globalThis.__copied)).toContain(
    "https://nownowgames.co.za/games/one-more-mark/",
  );
});

test("Share falls back to copying the neutral result and canonical link", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { globalThis.__fallback = text; } },
    });
  });
  await page.goto("/games/one-more-mark/");
  await page.keyboard.press("2");
  await page.clock.runFor(43_000);
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(page.locator("#share-status")).toHaveText("Result and game link copied.");
  expect(await page.evaluate(() => globalThis.__fallback)).toBe(
    "I found 1/1 empty answers in 42 seconds on One More Mark. How clean is your final scan?\nhttps://nownowgames.co.za/games/one-more-mark/",
  );
});

test("feedback pause locks row actions and resumes without stealing edit keys", async ({ page }) => {
  await page.clock.install();
  await page.goto("/games/one-more-mark/");
  await page.keyboard.press("2");
  await page.clock.runFor(1_000);

  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(page.locator("#pause-note")).toBeVisible();
  await expect(page.locator(".answer-row").first()).toBeDisabled();
  await expect(page.locator("#complete")).toBeDisabled();
  const pausedAt = Number(await page.locator("#time").textContent());
  await page.clock.runFor(5_000);
  expect(Number(await page.locator("#time").textContent())).toBe(pausedAt);

  const message = page.getByLabel("What happened?");
  await expect(message).toBeFocused();
  await page.keyboard.press("R");
  await expect(message).toHaveValue("R");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.locator("#pause-note")).toBeHidden();
  await expect(page.locator(".answer-row").first()).toBeEnabled();
  await page.clock.runFor(1_000);
  const afterResume = Number(await page.locator("#time").textContent());
  expect(pausedAt - afterResume).toBeGreaterThanOrEqual(.8);
  await expect(page.locator("#result-card")).toBeHidden();
});
