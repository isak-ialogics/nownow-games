import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { extractCommittedItchioPortal } from "../../scripts/package-itchio.mjs";

const portalPath = process.env.ITCHIO_PORTAL_PATH ?? "/itchio-cleanroom/one-lucky-bloom/";

test.setTimeout(120_000);

test.beforeAll(async () => {
  await extractCommittedItchioPortal();
});

function portalUrl(testInfo) {
  return new URL(portalPath, testInfo.project.use.baseURL).href;
}

async function activate(page, locator, touch) {
  if (!touch) {
    await locator.click();
    return;
  }
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test("responsive iframe supports touch and keyboard without off-origin requests", async ({ page }, testInfo) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const touch = testInfo.project.name === "mobile-chromium";
  const size = touch ? { width: 320, height: 740 } : { width: 1280, height: 800 };
  await page.setViewportSize(size);
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const source = portalUrl(testInfo);
  const response = await page.request.get(source);
  expect(response.status()).toBe(200);
  const markup = (await response.text()).replace("<head>", `<head><base href="${source}">`);
  await page.goto(source, { waitUntil: "networkidle" });
  await page.setContent(
    '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>' +
    '<iframe title="One Lucky Bloom"></iframe>',
  );
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  expect(frame).toBeTruthy();
  await frame.setContent(markup, { waitUntil: "networkidle" });
  await expect(frame.getByRole("heading", { name: "One Lucky Bloom" })).toBeVisible();
  await expect(frame.locator("body")).toHaveAttribute("data-motion", "reduced");
  const motion = frame.getByRole("button", { name: "Reduced motion on" });
  await expect(motion).toHaveAttribute("aria-pressed", "true");
  await activate(page, motion, touch);
  await expect(frame.getByRole("button", { name: "Reduced motion off" })).toHaveAttribute("aria-pressed", "false");
  await expect(frame.locator("body")).toHaveAttribute("data-motion", "full");
  await activate(page, frame.getByRole("button", { name: "Try your luck" }), touch);
  await activate(page, frame.getByRole("button", { name: "Skip and play" }), touch);
  await page.clock.fastForward(2_050);

  if (touch) {
    await activate(page, frame.getByRole("radio", { name: "Lane 2" }), true);
    await activate(page, frame.getByRole("button", { name: "Lock lane 2" }), true);
  } else {
    await page.keyboard.press("ArrowLeft");
    await expect(frame.getByRole("radio", { name: "Lane 2" })).toHaveAttribute("aria-checked", "true");
    await frame.getByRole("button", { name: "Lock lane 2" }).focus();
    await page.keyboard.press("Enter");
  }
  await expect(frame.getByRole("button", { name: "Lane 2 locked" })).toBeDisabled();
  const targets = await frame.getByRole("radio").evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(targets).toHaveLength(5);
  expect(targets.every(({ width, height }) => width >= 48 && height >= 48)).toBe(true);
  const layout = await frame.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => new URL(url).origin === new URL(source).origin)).toBe(true);
  expect(requests.every((url) => new URL(url).search === "")).toBe(true);
});

test("clean-room package completes and retries offline with storage denied", async ({ context, page }, testInfo) => {
  await page.clock.install();
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() { throw new Error("storage denied"); },
      });
    }
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => { globalThis.__portalShare = data; },
    });
  });
  const touch = testInfo.project.name === "mobile-chromium";
  await page.setViewportSize(touch ? { width: 320, height: 740 } : { width: 1280, height: 800 });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(portalPath, { waitUntil: "networkidle" });
  await expect(page.locator('meta[name="nownow-portal"]')).toHaveAttribute("content", "itchio");
  await expect(page.locator('meta[name="nownow-telemetry"]')).toHaveAttribute("content", "none");
  await expect(page.locator("#storage-note")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const initialRequests = requests.length;
  await context.setOffline(true);
  await activate(page, page.getByRole("button", { name: "Try your luck" }), touch);
  await activate(page, page.getByRole("button", { name: "Skip and play" }), touch);
  await page.clock.fastForward(42_100);
  await expect(page.locator("#result-card")).toBeVisible();
  await expect(page.locator("#final-score")).toHaveText(/\d+ \/ 600/u);
  await activate(page, page.getByRole("button", { name: "Share ledger" }), touch);
  const shared = await page.evaluate(() => globalThis.__portalShare);
  expect(shared.text).toContain("One Lucky Bloom");
  expect(shared.text).not.toMatch(/https?:\/\//u);
  await activate(page, page.getByRole("button", { name: "Play again" }), touch);
  await expect(page.locator("#game-panel")).toBeVisible();
  expect(requests).toHaveLength(initialRequests);
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await context.setOffline(false);
});
