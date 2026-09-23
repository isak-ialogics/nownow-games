import { access, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { publicPathForCard, readPrototypeCards } from "./hub-registry.mjs";

const root = resolve(import.meta.dirname, "..");
const productionOrigin = "https://nownowgames.co.za";
const pages = new Map([
  [
    "index.html",
    {
      title: "Original Mobile Browser Games | NowNow Games",
      description:
        "Play six original, mobile-first browser games from NowNow Games, including One Lucky Bloom, Surface Signal, Same Flame, Before Midnight, Latch!, and Safe Passage.",
      canonical: `${productionOrigin}/`,
      image: "hub-share.png",
      imageAlt: "NowNow Games home page showing six original browser games",
      schema: ["Organization", "WebSite"],
    },
  ],
  [
    "prototypes/before-midnight/index.html",
    {
      title: "Before Midnight | NowNow Games",
      description:
        "Hold, release, and stop under the fictional cap across seven fast rounds in Before Midnight, an original browser game.",
      canonical: `${productionOrigin}/games/before-midnight/`,
      image: "before-midnight-share.png",
      imageAlt: "Before Midnight timing game artwork with a fictional rand cap",
      schema: ["VideoGame"],
    },
  ],
  [
    "prototypes/latch/index.html",
    {
      title: "Latch! | NowNow Games",
      description:
        "Spot the real handle tug and secure the correct door in Latch!, an original one-minute browser reaction game.",
      canonical: `${productionOrigin}/prototypes/latch/`,
      image: "latch-share.png",
      imageAlt: "Latch! door-defence game with four illustrated doors",
      schema: ["VideoGame"],
    },
  ],
  [
    "prototypes/same-flame/index.html",
    {
      title: "Same Flame | NowNow Games",
      description:
        "Hold and release to bring two fires into rhythm in Same Flame, an original Heritage Day browser game.",
      canonical: `${productionOrigin}/prototypes/same-flame/`,
      image: "same-flame-share.png",
      imageAlt: "Same Flame rhythm game with two stylised fires",
      schema: ["VideoGame"],
    },
  ],
  [
    "prototypes/safe-passage/index.html",
    {
      title: "Safe Passage | NowNow Games",
      description:
        "Hold and release to guide two delayed craft through a safety corridor in Safe Passage, an original browser game.",
      canonical: `${productionOrigin}/prototypes/safe-passage/`,
      image: "safe-passage-share.png",
      imageAlt: "Safe Passage game with two abstract craft inside a green safety corridor",
      schema: ["VideoGame"],
    },
  ],
  [
    "prototypes/surface-signal/index.html",
    {
      title: "Surface Signal | NowNow Games",
      description:
        "Read a blow and wake, then predict the next surfacing sector in Surface Signal, an original shore-based browser game.",
      canonical: `${productionOrigin}/prototypes/surface-signal/`,
      image: "surface-signal-share.png",
      imageAlt: "Surface Signal shore-view game with five abstract observation sectors",
      schema: ["VideoGame"],
    },
  ],
  [
    "prototypes/one-lucky-bloom/index.html",
    {
      title: "One Lucky Bloom | NowNow Games",
      description:
        "Read branch and wind cues, then lock one blossom landing lane in One Lucky Bloom, an original spring prediction game.",
      canonical: `${productionOrigin}/games/one-lucky-bloom/`,
      image: "one-lucky-bloom-share.png",
      imageAlt: "One Lucky Bloom canopy game with five blossom landing lanes",
      schema: ["VideoGame"],
    },
  ],
]);
const prototypeRoot = resolve(root, "prototypes");
const cards = await readPrototypeCards(prototypeRoot);
const publicRoutes = new Set([
  "/",
  ...cards.map((card) => `/${publicPathForCard(card)}/`),
]);

if (pages.size !== cards.length + 1) {
  throw new Error("Static metadata inventory must cover the hub and every registry game.");
}
for (const card of cards) {
  const expected = pages.get(`prototypes/${card.slug}/index.html`);
  if (!expected) {
    throw new Error(`Metadata inventory is missing registry game: ${card.slug}.`);
  }
  const cardContract = {
    title: card.pageTitle,
    description: card.pageDescription,
    canonical: `${productionOrigin}/${publicPathForCard(card)}/`,
    image: card.socialImage,
    imageAlt: card.socialImageAlt,
  };
  for (const [field, value] of Object.entries(cardContract)) {
    if (expected[field] !== value) {
      throw new Error(
        `Metadata inventory disagrees with ${card.slug}/card.json: ${field}.`,
      );
    }
  }
}
const required = [
  "404.html",
  ...new Set([...pages.values()].map(({ image }) => `assets/${image}`)),
  "server/app.mjs",
  "server/feedback.mjs",
  "scripts/seo.mjs",
  "shared/analytics.js",
  "shared/input.js",
  "shared/site.css",
  "prototypes/README.md",
];

function tagWithAttribute(source, element, attribute, value) {
  return [...source.matchAll(new RegExp(`<${element}\\b[^>]*>`, "g"))]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`${attribute}="${value}"`));
}

function metaContent(source, attribute, value) {
  const tag = tagWithAttribute(source, "meta", attribute, value);
  return tag?.match(/\bcontent="([^"]*)"/)?.[1];
}

function structuredData(source, label) {
  const scripts = [
    ...source.matchAll(
      /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g,
    ),
  ];
  if (scripts.length !== 1) {
    throw new Error(`${label} must contain exactly one JSON-LD block.`);
  }
  return JSON.parse(scripts[0][1]);
}

function typesInSchema(value) {
  if (Array.isArray(value)) return value.flatMap(typesInSchema);
  if (!value || typeof value !== "object") return [];
  return [
    ...(Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]),
    ...Object.values(value).flatMap(typesInSchema),
  ].filter(Boolean);
}

function assertMetadata(source, label, expected) {
  if (!source.includes(`<title>${expected.title}</title>`)) {
    throw new Error(`${label} does not use its unique approved title.`);
  }
  if (metaContent(source, "name", "description") !== expected.description) {
    throw new Error(`${label} does not use its unique truthful description.`);
  }
  if (metaContent(source, "property", "og:title") !== expected.title) {
    throw new Error(`${label} Open Graph title does not match its page title.`);
  }
  if (
    metaContent(source, "property", "og:description") !== expected.description
  ) {
    throw new Error(`${label} Open Graph description does not match.`);
  }
  if (metaContent(source, "property", "og:type") !== "website") {
    throw new Error(`${label} is missing the website Open Graph type.`);
  }
  if (metaContent(source, "property", "og:url") !== expected.canonical) {
    throw new Error(`${label} Open Graph URL is not canonical.`);
  }
  const imageUrl = `${productionOrigin}/assets/${expected.image}`;
  if (metaContent(source, "property", "og:image") !== imageUrl) {
    throw new Error(`${label} Open Graph image is missing or inaccurate.`);
  }
  if (
    metaContent(source, "property", "og:image:width") !== "1200" ||
    metaContent(source, "property", "og:image:height") !== "630"
  ) {
    throw new Error(`${label} Open Graph image dimensions are inaccurate.`);
  }
  if (
    metaContent(source, "property", "og:image:alt") !== expected.imageAlt
  ) {
    throw new Error(`${label} Open Graph image alt text is inaccurate.`);
  }
  if (metaContent(source, "name", "twitter:card") !== "summary_large_image") {
    throw new Error(`${label} is missing valid Twitter card metadata.`);
  }
  if (metaContent(source, "name", "twitter:title") !== expected.title) {
    throw new Error(`${label} Twitter title does not match.`);
  }
  if (
    metaContent(source, "name", "twitter:description") !== expected.description
  ) {
    throw new Error(`${label} Twitter description does not match.`);
  }
  if (metaContent(source, "name", "twitter:url") !== expected.canonical) {
    throw new Error(`${label} Twitter URL is not canonical.`);
  }
  if (metaContent(source, "name", "twitter:image") !== imageUrl) {
    throw new Error(`${label} Twitter image is missing or inaccurate.`);
  }
  if (
    metaContent(source, "name", "twitter:image:alt") !== expected.imageAlt
  ) {
    throw new Error(`${label} Twitter image alt text is inaccurate.`);
  }
  const canonical = tagWithAttribute(source, "link", "rel", "canonical");
  if (!canonical?.includes(`href="${expected.canonical}"`)) {
    throw new Error(`${label} canonical link is missing or inaccurate.`);
  }
  if (/\bnoindex\b/i.test(source)) {
    throw new Error(`${label} accidentally disables indexing.`);
  }

  const data = structuredData(source, label);
  const types = typesInSchema(data);
  for (const type of expected.schema) {
    if (!types.includes(type)) throw new Error(`${label} schema lacks ${type}.`);
  }
  for (const forbidden of [
    "LocalBusiness",
    "Product",
    "BlogPosting",
    "FAQPage",
    "AggregateRating",
  ]) {
    if (types.includes(forbidden)) {
      throw new Error(`${label} includes unjustified ${forbidden} schema.`);
    }
  }

  for (const [tag] of source.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="[^"]*"/.test(tag)) throw new Error(`${label} image lacks alt behavior.`);
    if (!/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag)) {
      throw new Error(`${label} image lacks explicit dimensions.`);
    }
  }
}

for (const path of required) await access(resolve(root, path));

const socialImages = new Set([...pages.values()].map(({ image }) => image));
for (const image of socialImages) {
  const imagePath = resolve(root, "assets", image);
  const body = await readFile(imagePath);
  const bytes = (await stat(imagePath)).size;
  if (
    body.length < 24 ||
    body.toString("ascii", 1, 4) !== "PNG" ||
    body.readUInt32BE(16) !== 1200 ||
    body.readUInt32BE(20) !== 630
  ) {
    throw new Error(`${image} must be a 1200x630 PNG.`);
  }
  if (bytes > 550_000) {
    throw new Error(
      `${image} exceeds its 550000 B compression budget: ${bytes} B.`,
    );
  }
}

const titles = new Set();
const descriptions = new Set();
const visibleDescriptions = new Set();
for (const [path, expected] of pages) {
  const source = await readFile(resolve(root, path), "utf8");
  if (!source.includes('name="viewport"')) {
    throw new Error(`${path} is missing the mobile viewport meta tag.`);
  }
  if (/\b(?:href|src)="\//.test(source)) {
    throw new Error(`${path} uses a root-absolute asset path.`);
  }
  assertMetadata(source, path, expected);
  const visibleDescription = source
    .match(/<p\b[^>]*data-page-description[^>]*>([\s\S]*?)<\/p>/u)?.[1]
    ?.replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!visibleDescription?.startsWith(expected.description)) {
    throw new Error(`${path} visible description does not match its page contract.`);
  }
  visibleDescriptions.add(visibleDescription);
  titles.add(expected.title);
  descriptions.add(expected.description);
}
if (
  titles.size !== pages.size ||
  descriptions.size !== pages.size ||
  visibleDescriptions.size !== pages.size ||
  socialImages.size !== pages.size
) {
  throw new Error("Public page titles, descriptions, visible copy, and social images must be unique.");
}


const prototypeDirectories = (
  await readdir(resolve(root, "prototypes"), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
for (const directory of prototypeDirectories) {
  const prototypeRoot = resolve(root, "prototypes", directory.name);
  for (const path of ["index.html", "game.js", "card.json"]) {
    await access(resolve(prototypeRoot, path));
  }
  const source = await readFile(resolve(prototypeRoot, "index.html"), "utf8");
  const game = await readFile(resolve(prototypeRoot, "game.js"), "utf8");
  const expected = pages.get(`prototypes/${directory.name}/index.html`);
  const resultScreen = source.match(
    /<section\b[^>]*data-result-screen[^>]*>([\s\S]*?)<\/section>/u,
  )?.[0];
  if (!resultScreen) {
    throw new Error(`${directory.name} lacks a declared result screen.`);
  }
  if (!resultScreen.includes('id="retry"')) {
    throw new Error(`${directory.name} result screen lacks retry.`);
  }
  const discovery = resultScreen.match(
    /<nav\b[^>]*aria-label="More NowNow Games"[^>]*>([\s\S]*?)<\/nav>/u,
  )?.[0];
  if (!discovery) {
    throw new Error(`${directory.name} result screen lacks discovery links.`);
  }
  const crossHref = discovery
    .match(/<a\b[^>]*data-cross-game[^>]*href="([^"]+)"/u)?.[1];
  const hubHref = discovery
    .match(/<a\b[^>]*data-hub-link[^>]*href="([^"]+)"/u)?.[1];
  if (!crossHref || !hubHref) {
    throw new Error(`${directory.name} result discovery is incomplete.`);
  }
  const currentPath = new URL(expected.canonical).pathname;
  const crossPath = new URL(crossHref, expected.canonical).pathname;
  const hubPath = new URL(hubHref, expected.canonical).pathname;
  if (crossPath === currentPath || !publicRoutes.has(crossPath)) {
    throw new Error(`${directory.name} cross-game result link is invalid.`);
  }
  if (hubPath !== "/") {
    throw new Error(`${directory.name} result hub link is invalid.`);
  }
  if (!source.includes('aria-label="More NowNow Games"')) {
    throw new Error(`${directory.name} lacks useful links to other games.`);
  }
  if (!source.includes('src="../../shared/analytics.js"')) {
    throw new Error(`${directory.name} is missing the analytics module.`);
  }
  if (!game.includes("../../shared/input.js")) {
    throw new Error(`${directory.name} does not use the shared input module.`);
  }
}

const hub = await readFile(resolve(root, "index.html"), "utf8");
const analytics = await readFile(resolve(root, "shared", "analytics.js"), "utf8");
if (!hub.includes('src="./shared/analytics.js"')) {
  throw new Error("Hub is missing the privacy-safe analytics module.");
}
for (const [pattern, label] of [
  [/['"]\/analytics\/count['"]/, "/analytics/count"],
  [/credentials\s*:\s*['"]omit['"]/, "credentials: omit"],
  [/referrerPolicy\s*:\s*['"]no-referrer['"]/, "referrerPolicy: no-referrer"],
  [/['"]play-started['"]/, "play-started"],
  [/['"]play-completed['"]/, "play-completed"],
  [/['"]share-triggered['"]/, "share-triggered"],
]) {
  if (!pattern.test(analytics)) {
    throw new Error(
      `Analytics module is missing privacy/event contract: ${label}.`,
    );
  }
}
for (const forbidden of [
  "location.search",
  "document.referrer",
  "screen.width",
  "setItem(",
]) {
  if (analytics.includes(forbidden)) {
    throw new Error(`Analytics module includes forbidden data source: ${forbidden}.`);
  }
}
for (const launchNoteCopy of [
  "Now live",
  "Play Before Midnight",
  "Share your best time.",
]) {
  if (!hub.includes(launchNoteCopy)) {
    throw new Error(`Hub is missing launch note copy: ${launchNoteCopy}`);
  }
}
for (const [path, legacyLink] of [
  ["index.html", "./prototypes/before-midnight/"],
  ["prototypes/latch/index.html", "../before-midnight/"],
  ["prototypes/safe-passage/index.html", "../before-midnight/"],
]) {
  const source = await readFile(resolve(root, path), "utf8");
  if (source.includes(`href="${legacyLink}"`)) {
    throw new Error(`${path} still links to the legacy Before Midnight route.`);
  }
}
for (const marker of [
  "PROTOTYPE_COUNT_START",
  "PROTOTYPE_COUNT_END",
  "PROTOTYPE_CARDS_START",
  "PROTOTYPE_CARDS_END",
]) {
  if (!hub.includes(marker)) throw new Error(`Hub is missing ${marker}.`);
}

const notFound = await readFile(resolve(root, "404.html"), "utf8");
if (!notFound.includes("That page slipped away.") || /\bnoindex\b/i.test(notFound)) {
  throw new Error("Custom 404 must be helpful without an unnecessary noindex tag.");
}

const runtime = await readFile(resolve(root, "server/app.mjs"), "utf8");
for (const rule of [
  "www.nownowgames.co.za",
  "https://nownowgames.co.za",
  "/games/before-midnight/",
  "404.html",
  "relative(root, file)",
]) {
  if (!runtime.includes(rule)) throw new Error(`server/app.mjs lacks: ${rule}`);
}

console.log(
  `Static SEO and application checks passed for ${pages.size} public pages and ${prototypeDirectories.length} game folders.`,
);
