import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const origin = "https://nownowgames.co.za";
const localOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const evidenceDir = process.env.EVIDENCE_DIR;
const pages = [
  {
    path: "/",
    canonical: `${origin}/`,
    title: "Original Mobile Browser Games | NowNow Games",
    description:
      "Play six original, mobile-first browser games from NowNow Games, including One Lucky Bloom, Surface Signal, Same Flame, Before Midnight, Latch!, and Safe Passage.",
    schemaTypes: ["Organization", "WebSite"],
  },
  {
    path: "/games/before-midnight/",
    canonical: `${origin}/games/before-midnight/`,
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
    path: "/prototypes/same-flame/",
    canonical: `${origin}/prototypes/same-flame/`,
    title: "Same Flame | NowNow Games",
    description:
      "Hold and release to bring two fires into rhythm in Same Flame, an original Heritage Day browser game.",
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
  {
    path: "/prototypes/surface-signal/",
    canonical: `${origin}/prototypes/surface-signal/`,
    title: "Surface Signal | NowNow Games",
    description:
      "Read a blow and wake, then predict the next surfacing sector in Surface Signal, an original shore-based browser game.",
    schemaTypes: ["VideoGame"],
  },
  {
    path: "/games/one-lucky-bloom/",
    canonical: `${origin}/games/one-lucky-bloom/`,
    title: "One Lucky Bloom | NowNow Games",
    description:
      "Read branch and wind cues, then lock one blossom landing lane in One Lucky Bloom, an original spring prediction game.",
    schemaTypes: ["VideoGame"],
  },
];
const social = new Map([
  ["/", {
    image: `${origin}/assets/hub-share.png`,
    alt: "NowNow Games home page showing six original browser games",
  }],
  ["/games/before-midnight/", {
    image: `${origin}/assets/before-midnight-share.png`,
    alt: "Before Midnight timing game artwork with a fictional rand cap",
  }],
  ["/prototypes/latch/", {
    image: `${origin}/assets/latch-share.png`,
    alt: "Latch! door-defence game with four illustrated doors",
  }],
  ["/prototypes/same-flame/", {
    image: `${origin}/assets/same-flame-share.png`,
    alt: "Same Flame rhythm game with two stylised fires",
  }],
  ["/prototypes/safe-passage/", {
    image: `${origin}/assets/safe-passage-share.png`,
    alt: "Safe Passage game with two abstract craft inside a green safety corridor",
  }],
  ["/prototypes/surface-signal/", {
    image: `${origin}/assets/surface-signal-share.png`,
    alt: "Surface Signal shore-view game with five abstract observation sectors",
  }],
  ["/games/one-lucky-bloom/", {
    image: `${origin}/assets/one-lucky-bloom-share.png`,
    alt: "One Lucky Bloom canopy game with five blossom landing lanes",
  }],
]);

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
  const visibleDescriptions = new Set();
  const socialImages = new Set();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  for (const expected of pages) {
    runtimeErrors.length = 0;
    const response = await page.goto(expected.path);
    const socialExpected = social.get(expected.path);
    expect(response?.status(), expected.path).toBe(200);
    expect(socialExpected, expected.path).toBeDefined();
    expect(await page.title()).toBe(expected.title);
    await expect(page.locator("[data-page-description]")).toContainText(
      expected.description,
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      expected.description,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      expected.canonical,
    );

    for (const [selector, content] of [
      ['meta[property="og:title"]', expected.title],
      ['meta[property="og:description"]', expected.description],
      ['meta[property="og:url"]', expected.canonical],
      ['meta[property="og:type"]', "website"],
      ['meta[property="og:image"]', socialExpected.image],
      ['meta[property="og:image:width"]', "1200"],
      ['meta[property="og:image:height"]', "630"],
      ['meta[property="og:image:alt"]', socialExpected.alt],
      ['meta[name="twitter:card"]', "summary_large_image"],
      ['meta[name="twitter:title"]', expected.title],
      ['meta[name="twitter:description"]', expected.description],
      ['meta[name="twitter:url"]', expected.canonical],
      ['meta[name="twitter:image"]', socialExpected.image],
      ['meta[name="twitter:image:alt"]', socialExpected.alt],
    ]) {
      await expect(page.locator(selector)).toHaveAttribute("content", content);
    }

    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(
      1,
    );
    const socialResponse = await page.context().request.get(
      new URL(socialExpected.image).pathname,
    );
    expect(socialResponse.status(), socialExpected.image).toBe(200);
    expect(socialResponse.headers()["content-type"]).toContain("image/png");

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
      expect(
        await page.locator('nav[aria-label="More NowNow Games"]').count(),
      ).toBeGreaterThanOrEqual(1);
    }

    for (const image of await page.locator("img").all()) {
      await expect(image).toHaveAttribute("alt", /.+/);
      await expect(image).toHaveAttribute("width", /^\d+$/);
      await expect(image).toHaveAttribute("height", /^\d+$/);
    }

    titles.add(expected.title);
    descriptions.add(expected.description);
    visibleDescriptions.add(expected.description);
    socialImages.add(socialExpected.image);
    expect(runtimeErrors, expected.path).toEqual([]);
  }

  expect(titles.size).toBe(pages.length);
  expect(descriptions.size).toBe(pages.length);
  expect(visibleDescriptions.size).toBe(pages.length);
  expect(socialImages.size).toBe(pages.length);
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

test("legacy canonical game routes redirect permanently", async ({
  page,
  request,
}) => {
  const legacy = await request.get("/prototypes/before-midnight/?from=legacy", {
    maxRedirects: 0,
  });
  expect(legacy.status()).toBe(308);
  expect(legacy.headers().location).toBe(
    "/games/before-midnight/?from=legacy",
  );

  const response = await page.goto("/prototypes/before-midnight/");
  expect(response?.status()).toBe(200);
  expect(page.url()).toBe(
    `${localOrigin}/games/before-midnight/`,
  );

  const bloomLegacy = await request.get("/prototypes/one-lucky-bloom/", {
    maxRedirects: 0,
  });
  expect(bloomLegacy.status()).toBe(308);
  expect(bloomLegacy.headers().location).toBe("/games/one-lucky-bloom/");

  const bloomResponse = await page.goto("/prototypes/one-lucky-bloom/");
  expect(bloomResponse?.status()).toBe(200);
  expect(page.url()).toBe(`${localOrigin}/games/one-lucky-bloom/`);
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
