import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const origin = "https://nownowgames.co.za";
const evidenceDir = process.env.EVIDENCE_DIR;
const pages = [
  {
    path: "/",
    canonical: `${origin}/`,
    title: "Original Mobile Browser Games | NowNow Games",
    description:
      "Play three original, mobile-first browser games from NowNow Games: Before Midnight, Latch!, and Safe Passage.",
    schemaTypes: ["Organization", "WebSite"],
  },
  {
    path: "/prototypes/before-midnight/",
    canonical: `${origin}/prototypes/before-midnight/`,
    title: "Before Midnight | NowNow Games",
    description:
      "Hold, release, and stop under the fictional cap across seven fast rounds in Before Midnight, an original browser game.",
    schemaTypes: ["VideoGame"],
  },
  {
    path: "/prototypes/latch/",
    canonical: `${origin}/prototypes/latch/`,
    title: "Latch! | NowNow Games",
    description:
      "Spot the real handle tug and secure the correct door in Latch!, an original one-minute browser reaction game.",
    schemaTypes: ["VideoGame"],
  },
  {
    path: "/prototypes/safe-passage/",
    canonical: `${origin}/prototypes/safe-passage/`,
    title: "Safe Passage | NowNow Games",
    description:
      "Hold and release to guide two delayed craft through a safety corridor in Safe Passage, an original browser game.",
    schemaTypes: ["VideoGame"],
  },
];

function schemaTypes(value) {
  const nodes = Array.isArray(value?.["@graph"]) ? value["@graph"] : [value];
  return nodes.flatMap((node) =>
    Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]],
  );
}

test("every public page has unique truthful metadata and structured data", async ({
  page,
}) => {
  const titles = new Set();
  const descriptions = new Set();

  for (const expected of pages) {
    const response = await page.goto(expected.path);
    expect(response?.status(), expected.path).toBe(200);
    expect(await page.title()).toBe(expected.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      expected.description,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      expected.canonical,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      expected.title,
    );
    await expect(
      page.locator('meta[property="og:description"]'),
    ).toHaveAttribute("content", expected.description);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      expected.canonical,
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "website",
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      /summary/,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(
      1,
    );

    const structuredData = await page
      .locator('script[type="application/ld+json"]')
      .evaluate((script) => JSON.parse(script.textContent));
    const types = schemaTypes(structuredData);
    for (const type of expected.schemaTypes) expect(types).toContain(type);
    for (const disallowed of [
      "LocalBusiness",
      "Product",
      "BlogPosting",
      "FAQPage",
      "AggregateRating",
    ]) {
      expect(types).not.toContain(disallowed);
    }

    if (expected.path !== "/") {
      expect(structuredData.name).toBe(expected.title.split(" | ")[0]);
      expect(structuredData.url).toBe(expected.canonical);
      expect(structuredData.description).toBe(expected.description);
      expect(structuredData.gamePlatform).toBe("Web browser");
      expect(structuredData.playMode).toBe("SinglePlayer");
      expect(structuredData.isAccessibleForFree).toBe(true);
      await expect(
        page.getByRole("navigation", { name: "More NowNow Games" }),
      ).toBeVisible();
    }

    for (const image of await page.locator("img").all()) {
      await expect(image).toHaveAttribute("alt", /.+/);
      await expect(image).toHaveAttribute("width", /^\d+$/);
      await expect(image).toHaveAttribute("height", /^\d+$/);
    }

    titles.add(expected.title);
    descriptions.add(expected.description);
  }

  expect(titles.size).toBe(pages.length);
  expect(descriptions.size).toBe(pages.length);
});

test("crawl files enumerate public pages without blocking bots", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  expect(await robots.text()).toBe(
    `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
  );

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  const source = await sitemap.text();
  for (const expected of pages) {
    expect(source).toContain(`<loc>${expected.canonical}</loc>`);
  }
  expect(source).not.toContain("404.html");
});

test("unknown routes return the friendly page with HTTP 404", async ({ page }) => {
  const response = await page.goto("/missing-now-88");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page Not Found | NowNow Games");
  await expect(
    page.getByRole("heading", { level: 1, name: "That page slipped away." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse all games" })).toHaveAttribute(
    "href",
    "/",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: join(evidenceDir, "friendly-404-mobile.png"),
      fullPage: true,
    });
  }
});

for (const width of [360, 430]) {
  test(`public copy and internal links remain crawlable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const expected of pages) {
      await page.goto(expected.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        text: document.querySelector("main")?.innerText.trim(),
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.text?.length).toBeGreaterThan(80);
      expect(await page.locator("main a[href]").count()).toBeGreaterThan(0);
    }
  });
}
