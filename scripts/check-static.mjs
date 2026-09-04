import { access, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const productionOrigin = "https://nownowgames.co.za";
const shareImageUrl = `${productionOrigin}/assets/before-midnight-share.png`;
const pages = new Map([
  [
    "index.html",
    {
      title: "Original Mobile Browser Games | NowNow Games",
      description:
        "Play three original, mobile-first browser games from NowNow Games: Before Midnight, Latch!, and Safe Passage.",
      canonical: `${productionOrigin}/`,
      schema: ["Organization", "WebSite"],
    },
  ],
  [
    "prototypes/before-midnight/index.html",
    {
      title: "Before Midnight | NowNow Games",
      description:
        "Hold, release, and stop under the fictional cap across seven fast rounds in Before Midnight, an original browser game.",
      canonical: `${productionOrigin}/prototypes/before-midnight/`,
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
      schema: ["VideoGame"],
    },
  ],
]);
const required = [
  "404.html",
  "assets/before-midnight-share.png",
  "nginx.conf",
  "scripts/seo.mjs",
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
  if (!/^summary(?:_large_image)?$/.test(metaContent(source, "name", "twitter:card") ?? "")) {
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

const shareImagePath = resolve(root, "assets", "before-midnight-share.png");
const shareImage = await readFile(shareImagePath);
const shareImageBytes = (await stat(shareImagePath)).size;
if (
  shareImage.length < 24 ||
  shareImage.toString("ascii", 1, 4) !== "PNG" ||
  shareImage.readUInt32BE(16) !== 1200 ||
  shareImage.readUInt32BE(20) !== 630
) {
  throw new Error("Open Graph image must be a 1200x630 PNG.");
}
if (shareImageBytes > 550_000) {
  throw new Error(
    `Open Graph image exceeds its 550000 B compression budget: ${shareImageBytes} B.`,
  );
}

const titles = new Set();
const descriptions = new Set();
for (const [path, expected] of pages) {
  const source = await readFile(resolve(root, path), "utf8");
  if (!source.includes('name="viewport"')) {
    throw new Error(`${path} is missing the mobile viewport meta tag.`);
  }
  if (/\b(?:href|src)="\//.test(source)) {
    throw new Error(`${path} uses a root-absolute asset path.`);
  }
  assertMetadata(source, path, expected);
  titles.add(expected.title);
  descriptions.add(expected.description);
}
if (titles.size !== pages.size || descriptions.size !== pages.size) {
  throw new Error("Public page titles and descriptions must be unique.");
}

for (const path of ["index.html", "prototypes/before-midnight/index.html"]) {
  const source = await readFile(resolve(root, path), "utf8");
  if (metaContent(source, "property", "og:image") !== shareImageUrl) {
    throw new Error(`${path} does not use the production share image URL.`);
  }
  if (
    metaContent(source, "property", "og:image:width") !== "1200" ||
    metaContent(source, "property", "og:image:height") !== "630" ||
    !metaContent(source, "property", "og:image:alt")
  ) {
    throw new Error(`${path} lacks explicit share-image dimensions or alt text.`);
  }
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
  if (!source.includes('aria-label="More NowNow Games"')) {
    throw new Error(`${directory.name} lacks useful links to other games.`);
  }
  if (!game.includes("../../shared/input.js")) {
    throw new Error(`${directory.name} does not use the shared input module.`);
  }
}

const hub = await readFile(resolve(root, "index.html"), "utf8");
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

const nginx = await readFile(resolve(root, "nginx.conf"), "utf8");
for (const rule of [
  "server_name www.nownowgames.co.za;",
  "return 308 https://nownowgames.co.za$request_uri;",
  "error_page 404 /404.html;",
  "try_files $uri $uri/ =404;",
]) {
  if (!nginx.includes(rule)) throw new Error(`nginx.conf lacks: ${rule}`);
}

console.log(
  `Static SEO and application checks passed for ${pages.size} public pages and ${prototypeDirectories.length} game folders.`,
);
