import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFeedback(page) {
  await page.getByRole("button", { name: "Feedback" }).click();
  return page.locator(".feedback-dialog");
}

test.describe("Before Midnight feedback control", () => {
  test("is reachable outside the play surface and pauses the round clock while open", async ({
    page,
  }) => {
    await page.goto("/games/before-midnight/");
    const trigger = page.getByRole("button", { name: "Feedback" });
    await expect(trigger).toBeVisible();

    const triggerBox = await trigger.boundingBox();
    const panelBox = await page.locator("#game-panel").boundingBox();
    expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(panelBox.y);
    expect(triggerBox.width).toBeGreaterThanOrEqual(1);
    expect(triggerBox.height).toBeGreaterThanOrEqual(44);

    const dialog = await openFeedback(page);
    await expect(dialog).toBeVisible();
    await expect(page.locator("#feedback-message")).toBeFocused();

    // Sample the clock only after the dialog (and the pause it triggers) has
    // actually taken effect, not before — the click itself takes real time.
    const clockJustPaused = await page.locator("#round-clock").textContent();
    await page.waitForTimeout(1200);
    const clockDuringPause = await page.locator("#round-clock").textContent();
    expect(clockDuringPause).toBe(clockJustPaused);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(200);
    const clockAfterResume = await page.locator("#round-clock").textContent();
    expect(clockAfterResume).not.toBe(clockJustPaused);
  });

  test("rejects an empty message without calling the network", async ({
    page,
  }) => {
    let requested = false;
    await page.route("**/feedback/submit", (route) => {
      requested = true;
      route.fulfill({ status: 200, body: "{}" });
    });
    await page.goto("/games/before-midnight/");
    await openFeedback(page);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("#feedback-status")).toHaveText(
      "Type a message before sending.",
    );
    expect(requested).toBe(false);
  });

  test("submits text-only feedback with minimal context and shows a receipt", async ({
    page,
  }) => {
    let body;
    await page.route("**/feedback/submit", (route) => {
      body = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "recv-42" }),
      });
    });
    await page.goto("/games/before-midnight/");
    await openFeedback(page);
    await expect(page.locator("#feedback-tech")).not.toBeChecked();
    await page
      .locator("#feedback-message")
      .fill("The pump control felt unresponsive on iPhone.");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.locator("#feedback-status")).toHaveText(
      "Thanks — received (ref recv-42).",
    );
    await expect(page.getByRole("button", { name: "Send" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

    expect(body).toEqual({
      message: "The pump control felt unresponsive on iPhone.",
      path: "/games/before-midnight/",
      context: "before-midnight@1",
    });
  });

  test("keeps the draft after a network error and lets the player retry", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/feedback/submit", (route) => {
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 500 });
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "recv-7" }),
      });
    });
    await page.goto("/games/before-midnight/");
    await openFeedback(page);
    const message = "Controls stopped responding after the third round.";
    await page.locator("#feedback-message").fill(message);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.locator("#feedback-status")).toHaveText(
      "Could not send. Check your connection, then try again.",
    );
    await expect(page.locator("#feedback-message")).toHaveValue(message);

    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("#feedback-status")).toHaveText(
      "Thanks — received (ref recv-7).",
    );
    expect(attempts).toBe(2);
  });

  test("has no automated accessibility violations while open", async ({
    page,
  }) => {
    await page.goto("/games/before-midnight/");
    await openFeedback(page);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
});

test.describe("Feedback pause reaches every game", () => {
  test("Latch pauses the run clock while feedback is open", async ({
    page,
  }) => {
    await page.goto("/prototypes/latch/");
    const timerBefore = await page.locator("#timer").textContent();
    await openFeedback(page);
    await page.waitForTimeout(1200);
    await expect(page.locator("#timer")).toHaveText(timerBefore);
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Safe Passage pauses the corridor clock while feedback is open", async ({
    page,
  }) => {
    await page.goto("/prototypes/safe-passage/");
    const timeBefore = await page.locator("#time").textContent();
    await openFeedback(page);
    await page.waitForTimeout(1200);
    await expect(page.locator("#time")).toHaveText(timeBefore);
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
