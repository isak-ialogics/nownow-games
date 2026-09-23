import { expect } from "@playwright/test";

export async function expectResultDiscovery(
  page,
  result,
  { crossGameName, crossGamePath, retryName },
) {
  await expect(result.getByRole("button", { name: retryName })).toBeVisible();
  const navigation = result.getByRole("navigation", {
    name: "More NowNow Games",
  });
  await expect(navigation).toBeVisible();

  const crossGame = navigation.getByRole("link", {
    name: `Play ${crossGameName}`,
  });
  const hub = navigation.getByRole("link", { name: "All games" });
  await expect(crossGame).toBeVisible();
  await expect(hub).toBeVisible();

  const crossUrl = new URL(await crossGame.getAttribute("href"), page.url());
  const hubUrl = new URL(await hub.getAttribute("href"), page.url());
  expect(crossUrl.pathname).toBe(crossGamePath);
  expect(hubUrl.pathname).toBe("/");

  const crossResponse = await page.context().request.get(crossUrl.href);
  const hubResponse = await page.context().request.get(hubUrl.href);
  expect(crossResponse.status()).toBe(200);
  expect(hubResponse.status()).toBe(200);

  const layout = await result.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
}
