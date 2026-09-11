import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  populateHub,
  publicPathForCard,
  readPrototypeCards,
} from "./hub-registry.mjs";
import { buildRobots, buildSitemap } from "./seo.mjs";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "dist");
const sources = ["index.html", "404.html", "assets", "shared", "prototypes"];

function compactHtml(source) {
  return `${source.replace(/\s+/g, " ").replace(/> </g, "><").trim()}\n`;
}

function compactCss(source) {
  return `${source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .trim()}\n`;
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const source of sources) {
  await cp(resolve(root, source), resolve(destination, source), {
    recursive: true,
  });
}

const cards = await readPrototypeCards(resolve(root, "prototypes"));
for (const card of cards) {
  const sourcePath = `prototypes/${card.slug}`;
  const publicPath = publicPathForCard(card);
  if (publicPath === sourcePath) continue;
  const outputPath = resolve(destination, publicPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await cp(resolve(root, sourcePath), outputPath, { recursive: true });
}
const hub = await readFile(resolve(root, "index.html"), "utf8");
await writeFile(
  resolve(destination, "index.html"),
  compactHtml(populateHub(hub, cards)),
);
for (const path of new Set([
  "404.html",
  ...cards.flatMap((card) => [
    `prototypes/${card.slug}/index.html`,
    `${publicPathForCard(card)}/index.html`,
  ]),
])) {
  const outputPath = resolve(destination, path);
  await writeFile(outputPath, compactHtml(await readFile(outputPath, "utf8")));
}
for (const card of cards) {
  for (const path of new Set([
    `prototypes/${card.slug}/style.css`,
    `${publicPathForCard(card)}/style.css`,
  ])) {
    const outputPath = resolve(destination, path);
    await writeFile(outputPath, compactCss(await readFile(outputPath, "utf8")));
  }
}
// Shared CSS ships to every game; compact it the same way per-game stylesheets
// already are (NOW-201 needed the reclaimed headroom for the feedback control).
const sharedDir = resolve(destination, "shared");
for (const entry of await readdir(sharedDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
  const cssPath = resolve(sharedDir, entry.name);
  await writeFile(cssPath, compactCss(await readFile(cssPath, "utf8")));
}

await writeFile(resolve(destination, "robots.txt"), buildRobots());
await writeFile(resolve(destination, "sitemap.xml"), buildSitemap(cards));

console.log(
  `Built ${sources.length} static source paths, crawl files, and ${cards.length} prototype card${cards.length === 1 ? "" : "s"} into ${destination}`,
);
