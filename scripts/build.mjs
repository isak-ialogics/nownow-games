import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { populateHub, readPrototypeCards } from "./hub-registry.mjs";
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
const hub = await readFile(resolve(root, "index.html"), "utf8");
await writeFile(
  resolve(destination, "index.html"),
  compactHtml(populateHub(hub, cards)),
);
for (const path of [
  "404.html",
  ...cards.map(({ slug }) => `prototypes/${slug}/index.html`),
]) {
  const outputPath = resolve(destination, path);
  await writeFile(outputPath, compactHtml(await readFile(outputPath, "utf8")));
}
for (const { slug } of cards) {
  const outputPath = resolve(destination, "prototypes", slug, "style.css");
  await writeFile(outputPath, compactCss(await readFile(outputPath, "utf8")));
}
await writeFile(resolve(destination, "robots.txt"), buildRobots());
await writeFile(resolve(destination, "sitemap.xml"), buildSitemap(cards));

console.log(
  `Built ${sources.length} static source paths, crawl files, and ${cards.length} prototype card${cards.length === 1 ? "" : "s"} into ${destination}`,
);
