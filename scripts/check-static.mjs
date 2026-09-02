import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const productionUrl = "https://nownowgames.co.za/";
const ogImageUrl = `${productionUrl}assets/before-midnight-share.png`;
const shareDescription =
  "Hold. Release. Stop under the cap. Master seven fictional fills in Before Midnight.";
const required = [
  "index.html",
  "assets/before-midnight-share.png",
  "shared/analytics.js",
  "shared/input.js",
  "shared/site.css",
  "prototypes/README.md",
];

function assertLaunchMetadata(source, label, canonicalPath) {
  const requiredPatterns = [
    [
      "Open Graph title",
      /<meta\s+property="og:title"\s+content="[^"]+"\s*\/>/,
    ],
    [
      "Open Graph description",
      /<meta\s+property="og:description"\s+content="[^"]+"\s*\/>/,
    ],
    [
      "Open Graph type",
      /<meta\s+property="og:type"\s+content="website"\s*\/>/,
    ],
    [
      "Open Graph image",
      new RegExp(
        `<meta\\s+property="og:image"\\s+content="${ogImageUrl}"\\s*\\/>`,
      ),
    ],
    [
      "Open Graph URL",
      new RegExp(
        `<meta\\s+property="og:url"\\s+content="${productionUrl}${canonicalPath}"\\s*\\/>`,
      ),
    ],
    [
      "Twitter card",
      /<meta\s+name="twitter:card"\s+content="summary_large_image"\s*\/>/,
    ],
    [
      "theme colour",
      /<meta\s+name="theme-color"\s+content="#[0-9a-fA-F]{6}"\s*\/>/,
    ],
    [
      "canonical link",
      new RegExp(
        `<link\\s+rel="canonical"\\s+href="${productionUrl}${canonicalPath}"\\s*\\/>`,
      ),
    ],
    [
      "inline SVG favicon",
      /<link\s+rel="icon"\s+href="data:image\/svg\+xml,[^"]+"\s*\/>/,
    ],
  ];

  for (const [name, pattern] of requiredPatterns) {
    if (!pattern.test(source)) {
      throw new Error(`${label} is missing valid ${name} metadata.`);
    }
  }

  const description = source.match(
    /<meta\s+property="og:description"\s+content="([^"]+)"\s*\/>/,
  )?.[1];
  if (description !== shareDescription) {
    throw new Error(`${label} does not use the approved share description.`);
  }
}

for (const path of required) await access(resolve(root, path));

const ogImage = await readFile(
  resolve(root, "assets", "before-midnight-share.png"),
);
if (
  ogImage.length < 24 ||
  ogImage.toString("ascii", 1, 4) !== "PNG" ||
  ogImage.readUInt32BE(16) !== 1200 ||
  ogImage.readUInt32BE(20) !== 630
) {
  throw new Error("Open Graph image must be a 1200x630 PNG.");
}

const prototypeDirectories = (
  await readdir(resolve(root, "prototypes"), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));

const hub = await readFile(resolve(root, "index.html"), "utf8");
const analytics = await readFile(resolve(root, "shared", "analytics.js"), "utf8");
if (!hub.includes('name="viewport"')) {
  throw new Error("Hub is missing the mobile viewport meta tag.");
}
if (/\b(?:href|src)="\//.test(hub)) {
  throw new Error("Hub uses a root-absolute asset path.");
}
assertLaunchMetadata(hub, "Hub", "");
if (!hub.includes('src="./shared/analytics.js"')) {
  throw new Error("Hub is missing the privacy-safe analytics module.");
}
for (const token of [
  '"/analytics/count"',
  'credentials:"omit"',
  'referrerPolicy:"no-referrer"',
  '"play-started"',
  '"play-completed"',
  '"share-triggered"',
]) {
  if (!analytics.includes(token)) {
    throw new Error(`Analytics module is missing privacy/event contract: ${token}.`);
  }
}
for (const forbidden of ["location.search", "document.referrer", "screen.width", "setItem("]) {
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
for (const marker of [
  "PROTOTYPE_COUNT_START",
  "PROTOTYPE_COUNT_END",
  "PROTOTYPE_CARDS_START",
  "PROTOTYPE_CARDS_END",
]) {
  if (!hub.includes(marker)) {
    throw new Error(`Hub is missing the ${marker} registry marker.`);
  }
}

for (const directory of prototypeDirectories) {
  const prototypeRoot = resolve(root, "prototypes", directory.name);
  for (const path of ["index.html", "game.js", "card.json"]) {
    await access(resolve(prototypeRoot, path));
  }

  const prototype = await readFile(resolve(prototypeRoot, "index.html"), "utf8");
  const game = await readFile(resolve(prototypeRoot, "game.js"), "utf8");

  if (!prototype.includes('name="viewport"')) {
    throw new Error(`${directory.name} is missing the mobile viewport meta tag.`);
  }
  if (/\b(?:href|src)="\//.test(prototype)) {
    throw new Error(`${directory.name} uses a root-absolute asset path.`);
  }
  if (!prototype.includes('src="../../shared/analytics.js"')) {
    throw new Error(`${directory.name} is missing the analytics module.`);
  }
  if (directory.name === "before-midnight") {
    assertLaunchMetadata(
      prototype,
      "Before Midnight",
      "prototypes/before-midnight/",
    );
  }
  if (!game.includes("../../shared/input.js")) {
    throw new Error(`${directory.name} does not use the shared input module.`);
  }
}

console.log(
  `Static checks passed for ${prototypeDirectories.length} prototype folder${prototypeDirectories.length === 1 ? "" : "s"}.`,
);
