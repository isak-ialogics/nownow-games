import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_ORIGIN,
  buildRobots,
  buildSitemap,
} from "../../scripts/seo.mjs";

const cards = [
  { slug: "before-midnight", publicPath: "games/before-midnight" },
  { slug: "latch" },
  { slug: "safe-passage" },
  { slug: "same-flame" },
  { slug: "surface-signal" },
];

test("sitemap follows the discovered game registry", () => {
  const sitemap = buildSitemap(cards);

  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.deepEqual(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    [
      `${PRODUCTION_ORIGIN}/`,
      `${PRODUCTION_ORIGIN}/games/before-midnight/`,
      `${PRODUCTION_ORIGIN}/prototypes/latch/`,
      `${PRODUCTION_ORIGIN}/prototypes/safe-passage/`,
      `${PRODUCTION_ORIGIN}/prototypes/same-flame/`,
      `${PRODUCTION_ORIGIN}/prototypes/surface-signal/`,
    ],
  );
  assert.doesNotMatch(sitemap, /404\.html/);
});

test("robots allows crawling and advertises the production sitemap", () => {
  assert.equal(
    buildRobots(),
    `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_ORIGIN}/sitemap.xml\n`,
  );
});
