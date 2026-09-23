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

function compactJs(source) {
  let output = "";
  let index = 0;
  let space = false;
  const word = (value) => /[A-Za-z0-9_$]/.test(value ?? "");
  while (index < source.length) {
    let current = source[index];
    const next = source[index + 1];
    if (["'", '"', "`"].includes(current)) {
      const quote = current;
      output += current;
      index += 1;
      while (index < source.length) {
        current = source[index];
        output += current;
        index += 1;
        if (current.charCodeAt(0) === 92 && index < source.length) {
          output += source[index];
          index += 1;
        } else if (current === quote) break;
      }
      space = false;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      space = true;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (
        index < source.length - 1 &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) index += 1;
      index += 2;
      space = true;
      continue;
    }
    if (/\s/.test(current)) {
      space = true;
      index += 1;
      continue;
    }
    const previous = output.at(-1);
    if (
      space &&
      ((word(previous) && word(current)) ||
        (previous === "+" && current === "+") ||
        (previous === "-" && current === "-"))
    ) output += " ";
    space = false;
    output += current;
    index += 1;
  }
  return `${output.replace(/;}/g, "}")}\n`;
}

const surfaceSignalNames = Object.entries({
  CUE_MS: "A", CHOICE_END_MS: "B", REVEAL_AT_MS: "D", ROUND_MS: "E",
  RUN_MS: "F", SECTOR_COUNT: "G", CUES: "H", commitGuess: "I",
  createGame: "J", createShareData: "K", phaseAt: "L", readBest: "M",
  saveBest: "N", clearBest: "O", summarize: "P", updateGame: "Q",
  markPlayed: "R", safeGameStorage: "S",
});

function compactSurfaceSignalJs(source) {
  for (const [name, compact] of surfaceSignalNames) {
    source = source.replace(new RegExp(`\\b${name}\\b`, "g"), compact);
  }
  return compactJs(source);
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
for (const file of ["game.js", "state.js"]) {
  const outputPath = resolve(destination, "prototypes", "surface-signal", file);
  await writeFile(outputPath, compactSurfaceSignalJs(await readFile(outputPath, "utf8")));
}
// Shared assets ship to every game; compact text payloads after copying them.
const sharedDir = resolve(destination, "shared");
for (const entry of await readdir(sharedDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = resolve(sharedDir, entry.name);
  if (entry.name.endsWith(".css")) {
    await writeFile(path, compactCss(await readFile(path, "utf8")));
  }
  if (entry.name.endsWith(".js")) {
    await writeFile(path, compactJs(await readFile(path, "utf8")));
  }
}

await writeFile(resolve(destination, "robots.txt"), buildRobots());
await writeFile(resolve(destination, "sitemap.xml"), buildSitemap(cards));

console.log(
  `Built ${sources.length} static source paths, crawl files, and ${cards.length} prototype card${cards.length === 1 ? "" : "s"} into ${destination}`,
);
