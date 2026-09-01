import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("hub lists and opens the placeholder prototype", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Small games",
  );
  await page.getByRole("link", { name: /Open prototype/ }).click();
  await expect(page).toHaveURL(/\/prototypes\/input-lab\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Input Relay",
  );
});

test("touch, drag, keyboard, restart, and recovery paths remain playable", async ({
  page,
}) => {
  await page.goto("/prototypes/input-lab/");
  const surface = page.locator("#play-surface");
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Play surface did not render a measurable box.");

  await page.touchscreen.tap(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.35,
  );
  await expect(page.locator("#pointer-badge")).toHaveAttribute(
    "data-seen",
    "true",
  );
  await expect(page.locator("#position-x")).toHaveText("30");

  await surface.dispatchEvent("pointerdown", {
    pointerId: 42,
    pointerType: "touch",
    clientX: bounds.x + bounds.width * 0.3,
    clientY: bounds.y + bounds.height * 0.35,
  });
  await surface.dispatchEvent("pointermove", {
    pointerId: 42,
    pointerType: "touch",
    clientX: bounds.x + bounds.width * 0.7,
    clientY: bounds.y + bounds.height * 0.65,
  });
  await surface.dispatchEvent("pointerup", {
    pointerId: 42,
    pointerType: "touch",
    clientX: bounds.x + bounds.width * 0.7,
    clientY: bounds.y + bounds.height * 0.65,
  });
  await expect(page.locator("#position-x")).toHaveText("70");

  await surface.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator("#keyboard-badge")).toHaveAttribute(
    "data-seen",
    "true",
  );
  await expect(page.locator("#last-input")).toContainText("Keyboard: pulse");

  await page.keyboard.down("ArrowUp");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#last-input")).toContainText(
    "System: Input safely reset",
  );
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("Enter");

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  if (process.env.EVIDENCE_SCREENSHOT) {
    await page.screenshot({
      path: process.env.EVIDENCE_SCREENSHOT,
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Restart input relay" }).click();
  await expect(page.locator("#event-count")).toHaveText("00");
  await expect(page.locator("#pointer-badge")).toHaveAttribute(
    "data-seen",
    "false",
  );
  await expect(page.locator("#keyboard-badge")).toHaveAttribute(
    "data-seen",
    "false",
  );
});
