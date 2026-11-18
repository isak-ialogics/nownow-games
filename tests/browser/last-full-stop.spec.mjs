import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.NNG_EVIDENCE_DIR;
const eventPaths = (requests) => requests.map((value) => new URL(value))
  .filter((url) => url.pathname === "/analytics/count")
  .map((url) => url.searchParams.get("p"));

test("fresh 390px encounter exposes bank, wait upside, and two-beat TIME without sound", async ({
  page,
}) => {
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
  const errors = [];
  const non2xx = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname !== "/analytics/count") {
      errors.push(request.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (
      (response.status() < 200 || response.status() >= 300) &&
      new URL(response.url()).pathname !== "/analytics/count"
    ) non2xx.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto("/games/last-full-stop/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Last Full Stop | NowNow Games");
  await expect(page.getByRole("heading", {
    name: "Stop safely, or risk one more phrase.",
  })).toBeVisible();
  await expect(page.locator("#time")).toHaveText("45.0");
  await expect(page.locator("#timer-state")).toHaveText("Held");
  await expect(page.locator("#words")).toHaveText("12");
  await expect(page.locator("#multiplier")).toHaveText("1.4");
  await expect(page.locator("#pot")).toHaveText("17");
  await expect(page.locator("#cue-label")).toHaveText("TIME in 2 breaks");
  await expect(page.locator("#choice")).toContainText("Wait for ×1.7");
  const control = page.getByRole("button", { name: "FULL STOP, bank 17 words" });
  await expect(control).toBeFocused();
  const box = await control.boundingBox();
  expect(box.width).toBeLessThanOrEqual(336);
  expect(box.width).toBeGreaterThanOrEqual(280);
  expect(box.height).toBe(96);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
  expect(await page.locator("#sentence").evaluate((node) =>
    node.getAnimations().length
  )).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.clock.runFor(5_000);
  await expect(page.locator("#time")).toHaveText("45.0");
  expect(eventPaths(requests)).not.toContain(
    "/event/last-full-stop/play-started/new",
  );
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: `${evidenceDir}/last-full-stop-first-encounter-390x844.png`,
      scale: "css",
    });
  }

  await control.click();
  await expect(page.locator("#banked")).toHaveText("17");
  await expect(page.locator("#timer-state")).toHaveText("Running");
  await expect(page.locator("#feedback")).toHaveText(
    "BANKED +17 · 12 words safe",
  );
  await expect(page.locator("#locked-sentence")).toHaveClass(/banked/);
  await expect(page.locator("#locked-sentence")).toContainText(
    "quiet clock watches.",
  );
  await page.locator("#full-stop").click({ force: true });
  await expect(page.locator("#banked")).toHaveText("17");
  await expect(page.locator("#feedback")).toHaveText(
    "Full stop already placed at this break.",
  );
  await expect.poll(() => eventPaths(requests).filter((path) =>
    path === "/event/last-full-stop/play-started/new").length).toBe(1);
  if (evidenceDir) {
    await page.screenshot({
      path: `${evidenceDir}/last-full-stop-post-action-390x844.png`,
      scale: "css",
    });
  }
  expect(await page.evaluate(() => globalThis.__audioConstructed ?? false)).toBe(
    false,
  );
  expect(requests.every((url) => url.startsWith(`${origin}/`))).toBe(true);
  expect(errors).toEqual([]);
  expect(non2xx).toEqual([]);
});

test("late feedback, early keyboard buffer, duplicate protection, and TIME loss stay exact", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/games/last-full-stop/");
  await page.keyboard.press("Space");
  await page.clock.runFor(1_000);
  await page.keyboard.press("Space");
  await expect(page.locator("#feedback")).toHaveText("Wait for the break.");
  await expect(page.locator("#banked")).toHaveText("17");

  await page.clock.runFor(3_350);
  await page.keyboard.press("Enter");
  await expect(page.locator("#feedback")).toHaveText(
    "Full stop ready for the next break.",
  );
  await page.keyboard.press("Space");
  await expect(page.locator("#banked")).toHaveText("17");
  await expect(page.locator("#feedback")).toHaveText(
    "Full stop already ready for the next break.",
  );
  await page.clock.runFor(200);
  await expect(page.locator("#beat")).toHaveText("2 / 10");
  await expect(page.locator("#banked")).toHaveText("27");
  await expect(page.locator("#feedback")).toHaveText(
    "BANKED +10 · 10 words safe",
  );

  await page.clock.runFor(4_450);
  await expect(page.locator("#beat")).toHaveText("3 / 10");
  await expect(page.locator("#cue-label")).toHaveText("TIME at this break");
  await page.clock.runFor(850);
  await expect(page.locator("#banked")).toHaveText("27");
  await expect(page.locator("#feedback")).toHaveText(
    "TIME · 10 unbanked words lost",
  );
  await expect(page.locator("#locked-sentence")).toHaveClass(/lost/);
});

test("blur freezes one break until an explicit resume that cannot score or skip", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/games/last-full-stop/");
  await page.keyboard.press("Space");
  await page.clock.runFor(4_500);
  await expect(page.locator("#beat")).toHaveText("2 / 10");
  await expect(page.locator("#banked")).toHaveText("17");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#pause-card")).toBeVisible();
  const pausedAt = await page.locator("#time").textContent();
  const phrase = await page.locator("#sentence").textContent();
  await page.clock.runFor(5_000);
  await expect(page.locator("#time")).toHaveText(pausedAt);
  await expect(page.locator("#sentence")).toHaveText(phrase);
  await expect(page.locator("#beat")).toHaveText("2 / 10");
  await expect(page.locator("#banked")).toHaveText("17");

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Resume round" })).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(page.locator("#pause-card")).toBeHidden();
  await expect(page.locator("#beat")).toHaveText("2 / 10");
  await expect(page.locator("#banked")).toHaveText("17");
  await expect(page.getByRole("button", { name: /FULL STOP/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#banked")).toHaveText("27");
});

test("round result is accessible and R retries a rotated paper without reload", async ({
  page,
}) => {
  await page.clock.install();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.goto("/games/last-full-stop/");
  await page.keyboard.press("Space");
  await page.clock.runFor(46_000);
  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.locator("#final-banked")).toHaveText("17");
  await expect(page.locator("#final-biggest")).toHaveText("12");
  await expect(page.locator("#final-lost")).not.toHaveText("0");
  await expect(page.getByRole("button", {
    name: /Try another paper/,
  })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.keyboard.press("R");
  await expect(page.locator("#game-panel")).toBeVisible();
  await expect(page.locator("#time")).toHaveText("45.0");
  await expect(page.locator("#timer-state")).toHaveText("Held");
  await expect(page.locator("#banked")).toHaveText("0");
  await page.clock.runFor(5_000);
  await expect(page.locator("#time")).toHaveText("45.0");
  await page.keyboard.press("Enter");
  await expect(page.locator("#banked")).toHaveText("17");
  expect(navigations).toBe(1);
  await expect(page).toHaveURL(`${origin}/games/last-full-stop/`);
});

test("user actions prefer Web Share, support explicit copy, and truthfully fall back", async ({
  page,
}) => {
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
  await page.goto("/games/last-full-stop/");
  await page.keyboard.press("Space");
  await page.clock.runFor(46_000);
  await page.getByRole("button", { name: "Share challenge" }).click();
  await expect(page.locator("#share-status")).toHaveText("Share sheet opened.");
  expect(await page.evaluate(() => globalThis.__shared)).toEqual({
    title: "Last Full Stop",
    text: "I banked 17 words before TIME in Last Full Stop. Biggest safe sentence: 12. Can you risk one more phrase?",
    url: "https://nownowgames.co.za/games/last-full-stop/",
  });
  await page.getByRole("button", {
    name: "Copy result + game link",
  }).click();
  await expect(page.locator("#share-status")).toHaveText(
    "Result and game link copied.",
  );
  expect(await page.evaluate(() => globalThis.__copied)).toContain(
    "https://nownowgames.co.za/games/last-full-stop/",
  );
});

test("Share challenge copies the same result when Web Share is unavailable", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true, value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { globalThis.__fallback = text; } },
    });
  });
  await page.goto("/games/last-full-stop/");
  await page.keyboard.press("Space");
  await page.clock.runFor(46_000);
  await page.getByRole("button", { name: "Share challenge" }).click();
  await expect(page.locator("#share-status")).toHaveText(
    "Result and game link copied.",
  );
  expect(await page.evaluate(() => globalThis.__fallback)).toBe(
    "I banked 17 words before TIME in Last Full Stop. Biggest safe sentence: 12. Can you risk one more phrase?\nhttps://nownowgames.co.za/games/last-full-stop/",
  );
});

test("320 CSS pixels, 200% visual zoom, and keyboard focus keep the fixed target usable", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/games/last-full-stop/");
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  const control = page.getByRole("button", { name: /FULL STOP/ });
  const box = await control.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(control).toBeFocused();
  expect(await control.evaluate((node) =>
    getComputedStyle(node).outlineStyle
  )).toBe("solid");

  const session = await context.newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
  await page.keyboard.press("Space");
  await expect(page.locator("#banked")).toHaveText("17");
});
