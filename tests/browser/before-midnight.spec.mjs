import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;

async function pointerHold(page, pointerType, milliseconds) {
  const pump = page.locator("#pump");
  const pointerId = pointerType === "touch" ? 41 : 42;
  await pump.dispatchEvent("pointerdown", {
    pointerId,
    pointerType,
    clientX: 40,
    clientY: 40,
  });
  await expect(pump).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(milliseconds);
  await pump.dispatchEvent("pointerup", {
    pointerId,
    pointerType,
    clientX: 40,
    clientY: 40,
  });
  await expect(pump).toHaveAttribute("aria-pressed", "false");
}

async function keyboardHold(page, key, milliseconds) {
  const pump = page.locator("#pump");
  await pump.focus();
  await page.keyboard.down(key);
  await expect(pump).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
  await expect(pump).toHaveAttribute("aria-pressed", "false");
}

async function expectResultThenRound(page, category, nextRound) {
  const feedback = page.locator("#feedback");
  await expect(feedback).toBeVisible();
  await expect(feedback).toHaveAttribute("data-result", category);
  if (nextRound) {
    await expect(page.locator("#round-count")).toHaveText(`${nextRound} / 7`);
  }
}

function eventPaths(requests) {
  return requests
    .map((request) => new URL(request.url()))
    .filter((url) => url.pathname === "/analytics/count")
    .map((url) => url.searchParams.get("p"));
}

test("seven fills support touch, mouse, Space, Enter, results, and retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedShare = value;
        },
      },
    });
  });
  const requests = [];
  page.on("request", (request) => requests.push(request));
  const response = await page.goto("/prototypes/before-midnight/");
  expect(response?.ok()).toBe(true);
  await expect
    .poll(() => eventPaths(requests))
    .toContain("/event/before-midnight/play-started/new");
  const canonicalUrl =
    "https://nownowgames.co.za/prototypes/before-midnight/";
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    canonicalUrl,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    canonicalUrl,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://nownowgames.co.za/assets/before-midnight-share.png",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Before Midnight",
  );
  await expect(page.getByText("Seven fills. One exacting cap.")).toBeVisible();
  await expect(page.getByText(/not a price calculator/i)).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);

  await page.reload();
  const warmCacheInteractive = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation");
    return navigation.domInteractive;
  });
  expect(warmCacheInteractive).toBeLessThan(2000);
  test.info().annotations.push({
    type: "warm-cache-interactive",
    description: `${Math.round(warmCacheInteractive)} ms on Pixel 7 emulation`,
  });

  const pump = page.locator("#pump");
  const box = await pump.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await pump.focus();
  expect(await pump.evaluate((node) => getComputedStyle(node).outlineStyle))
    .not.toBe("none");

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.reload();
  await expect(
    page.getByLabel("Result symbols").getByRole("listitem"),
  ).toHaveText(["[+] Safe", "[~] Near cap", "[X] Over cap"]);
  await expect(page.locator("#round-count")).toHaveText("1 / 7");

  await pointerHold(page, "touch", 120);
  await expectResultThenRound(page, "safe", 2);

  await pointerHold(page, "mouse", 1690);
  await expectResultThenRound(page, /near|precision/, 3);

  await keyboardHold(page, "Space", 800);
  await expectResultThenRound(page, "safe", 4);

  await keyboardHold(page, "Enter", 3000);
  await expectResultThenRound(page, "overshoot");
  await expect(page.locator("#feedback")).toContainText("OVER CAP");
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "before-midnight-overshoot-mobile.png"),
      fullPage: true,
    });
  }
  await expect(page.locator("#round-count")).toHaveText("5 / 7");

  await keyboardHold(page, "Space", 120);
  await expectResultThenRound(page, "safe", 6);
  await pointerHold(page, "mouse", 120);
  await expectResultThenRound(page, "safe", 7);
  await keyboardHold(page, "Enter", 120);

  const result = page.locator("#result-card");
  await expect(result).toBeVisible();
  await expect
    .poll(() => eventPaths(requests))
    .toContain("/event/before-midnight/play-completed/new");
  await expect(page.locator("#total-units")).toContainText("units");
  await expect(page.locator("#overshoots")).toHaveText("1 / 7");
  await expect(page.locator("#best-accuracy")).toContainText("%");
  await expect(page.locator("#personal-best")).toContainText("pts");
  await expect(page.locator("#retry")).toHaveCount(1);
  await expect(page.locator("#result-card button")).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.length)).toBe(1);

  const personalBest = Number(
    (await page.locator("#personal-best").textContent()).replace(" pts", ""),
  ).toFixed(1);
  const bragLine = `I scored ${personalBest} pts on Before Midnight — beat me:`;
  const shareButton = page.getByRole("button", {
    name: "Share your best time",
  });
  await shareButton.click();
  await expect
    .poll(
      () =>
        eventPaths(requests).filter(
          (path) => path === "/event/before-midnight/share-triggered/new",
        ).length,
    )
    .toBe(1);
  await expect.poll(() => page.evaluate(() => window.__copiedShare)).toBe(
    `${bragLine} ${canonicalUrl}`,
  );
  await expect(page.locator("#share-status")).toHaveText(
    "Copied.",
  );

  await page.evaluate(() => {
    navigator.share = async (payload) => {
      window.__sharedPayload = payload;
    };
  });
  await shareButton.click();
  await expect
    .poll(
      () =>
        eventPaths(requests).filter(
          (path) => path === "/event/before-midnight/share-triggered/new",
        ).length,
    )
    .toBe(2);
  await expect.poll(() => page.evaluate(() => window.__sharedPayload)).toEqual({
    text: bragLine,
    url: canonicalUrl,
  });

  const resultAccessibility = await new AxeBuilder({ page }).analyze();
  expect(resultAccessibility.violations).toEqual([]);
  if (evidenceDir) {
    await page.screenshot({
      path: join(evidenceDir, "before-midnight-result-mobile.png"),
      fullPage: true,
    });
  }

  const startsBeforeRetry = eventPaths(requests).filter(
    (path) => path === "/event/before-midnight/play-started/new",
  ).length;
  await page.getByRole("button", { name: "Retry seven fills" }).click();
  await expect
    .poll(
      () =>
        eventPaths(requests).filter(
          (path) => path === "/event/before-midnight/play-started/new",
        ).length,
    )
    .toBe(startsBeforeRetry + 1);
  await expect(page.locator("#round-count")).toHaveText("1 / 7");
  await expect(result).toBeHidden();
  expect(
    requests.every((request) =>
      request.url().startsWith("http://127.0.0.1:4173/"),
    ),
  ).toBe(true);
});

test("analytics labels an existing personal-best player as returning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("nownow-before-midnight-best-v1", "12.5");
  });
  const requests = [];
  page.on("request", (request) => requests.push(request));
  await page.goto("/prototypes/before-midnight/");
  await expect
    .poll(() => eventPaths(requests))
    .toContain("/event/before-midnight/play-started/returning");
  expect(await page.evaluate(() => localStorage.length)).toBe(1);
});

test("reduced motion removes bounce and steps the live counter", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prototypes/before-midnight/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "reduced");
  await page.keyboard.down("Space");
  await page.waitForTimeout(380);
  const motion = await page.locator(".needle").evaluate((node) => ({
    animationName: getComputedStyle(node).animationName,
    sampleMs: Number(document.getElementById("pump").dataset.sampleMs),
  }));
  expect(motion.animationName).toBe("none");
  expect(motion.sampleMs % 250).toBe(0);
  await page.keyboard.up("Space");
});
