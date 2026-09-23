import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { minify } from "terser";

import {
  populateHub,
  publicPathForCard,
  readPrototypeCards,
} from "./hub-registry.mjs";
import { buildRobots, buildSitemap } from "./seo.mjs";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "dist");
const sources = ["index.html", "404.html", "assets", "shared", "prototypes"];
const bloomIds = new Map(Object.entries({
  "page-main": "pm", "title-block": "tb", "storage-note": "sn",
  "reset-data": "rd", "skip-tutorial": "sk", "game-panel": "gp",
  "score-line": "sl", "upper-arrow": "ua", "upper-label": "ul",
  "wind-arrow": "wa", "wind-label": "wl", "lower-label": "ll",
  "game-status": "gs", "resume-note": "rn", "result-card": "rc",
  "result-title": "rt", "final-score": "fs", "final-catches": "fc",
  "best-note": "bn", "share-result": "sr", "copy-challenge": "cc",
  "share-status": "ss", "more-games": "mg",
}));
const bloomClasses = new Map(Object.entries({
  settings: "se", notice: "nt", card: "cd", primary: "py", deck: "dk",
  care: "cr", game: "gm", canopy: "cy", cue: "cu", upper: "up",
  wind: "wi", lower: "lw", bloom: "bm", lanes: "ls", status: "st",
  resume: "rs", instructions: "is", result: "re", total: "to",
  ledger: "lg", action: "ac", link: "li",
}));
const bloomSimpleIds = new Map(Object.entries({
  intro: "i", tutorial: "t", progress: "p", score: "s", bloom: "b",
  lanes: "l", lock: "k", ledger: "e", sound: "o", motion: "m", retry: "y",
}));

function bloomIdText(source) {
  for (const [name, compact] of bloomIds) source = source.replaceAll(name, compact);
  return source;
}

function bloomHtml(source) {
  source = bloomIdText(source);
  for (const [name, compact] of bloomSimpleIds) {
    source = source.replaceAll(`id="${name}"`, `id="${compact}"`);
  }
  return source.replace(/class="([^"]*)"/g, (attribute, names) =>
    `class="${names.split(/\s+/).map((name) => bloomClasses.get(name) ?? name).join(" ")}"`,
  );
}

function bloomGameText(source) {
  source = bloomIdText(source);
  for (const [name, compact] of bloomSimpleIds) {
    source = source.replaceAll(`"${name}"`, `"${compact}"`);
  }
  return source.replace('class="primary"', "class=py");
}

function bloomCss(source) {
  source = bloomIdText(source);
  for (const [name, compact] of bloomClasses) {
    source = source.replace(new RegExp(`\\.${name}(?![A-Za-z0-9_-])`, "g"), `.${compact}`);
  }
  return source
    .replace("radial-gradient(circle at 75% 5%,#52325f 0,transparent 30rem),", "")
    .replaceAll("letter-spacing:.07em;", "")
    .replaceAll("letter-spacing:.14em;", "")
    .replaceAll("letter-spacing:-.045em", "")
    .replace("max-width:42ch;", "")
    .replace("padding:clamp(16px,4vw,26px)", "padding:clamp(5px,2vw,26px)")
    .replace("inset:auto 8px 8px", "inset:auto 1px 4px")
    .replace(";box-shadow:0 24px 60px #0005", "")
    .replace(";isolation:isolate", "")
    .replace(/body\[data-motion="full"\] \.cy svg\{[^}]*\}@keyframes sway\{[^}]*\}/, "")
    .replace(/@media\(min-width:760px\)\{[\s\S]*\}$/, "");
}

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

async function bundleOneLuckyBloom(stateSource, gameSource) {
  const imports = [...gameSource.matchAll(/^import[\s\S]*?;$/gm)]
    .map(([source]) => source)
    .filter((source) => !source.includes('"./state.js"'));
  const stateBody = stateSource.replace(/^export\s+/gm, "");
  const gameBody = gameSource.replace(/^import[\s\S]*?;\s*$/gm, "");
  const result = await minify(`${imports.join("\n")}\n${stateBody}\n${gameBody}`, {
    compress: {
      passes: 4,
      pure_getters: "strict",
      unsafe: true,
      unsafe_arrows: true,
      unsafe_methods: true,
    },
    mangle: {
      toplevel: true,
      properties: {
        builtins: true,
        regex: /^(time|round|choice|locked|lockAt|resolved|score|catches|trace|ended|upper|wind|lower|nodes|landing|chosen|caught|tier|points|fullPage|durationMs|record|available|newBest|matchedBest)$/,
      },
    },
    module: true,
    format: { comments: false },
  });
  if (!result.code) throw new Error("One Lucky Bloom JavaScript minification failed.");
  const header = result.code.match(/^(?:import[^;]+;)*/)?.[0] ?? "";
  let body = result.code.slice(header.length);
  const declarations = [
    '$t="textContent"', '$a="addEventListener"', '$h="hidden"',
    '$s="soundEnabled"', '$b="bestScore"', '$p="playsCompleted"',
    '$r="reduceMotionOverride"',
  ];
  for (const [property, alias] of [
    [".textContent", "[$t]"],
    [".addEventListener", "[$a]"],
    [".hidden", "[$h]"],
    [".soundEnabled", "[$s]"],
    [".bestScore", "[$b]"],
    [".playsCompleted", "[$p]"],
    [".reduceMotionOverride", "[$r]"],
  ]) body = body.replaceAll(property, alias);
  for (const [global, alias] of [
    ["requestAnimationFrame", "$F"], ["cancelAnimationFrame", "$C"],
    ["setTimeout", "$T"], ["clearTimeout", "$L"], ["document", "$D"],
    ["navigator", "$V"], ["performance", "$P"], ["Math", "$M"],
    ["Number", "$N"],
  ]) {
    body = body.replace(new RegExp(`\\b${global}\\b`, "g"), alias);
    declarations.push(`${alias}=${global}`);
  }
  body = body.replaceAll("{preventScroll:!0}", "$O");
  declarations.push("$O={preventScroll:!0}");
  const strings = new Map();
  for (const [literal] of body.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    strings.set(literal, (strings.get(literal) ?? 0) + 1);
  }
  let stringIndex = 0;
  for (const [literal, count] of strings) {
    const alias = `$${stringIndex}`;
    const gain = count * (literal.length - alias.length) -
      (alias.length + literal.length + 2);
    if (gain <= 0) continue;
    stringIndex += 1;
    body = body.replaceAll(literal, alias);
    declarations.push(`${alias}=${literal}`);
  }
  return `${header}const ${declarations.join(",")};${body}\n`;
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
  let source = await readFile(outputPath, "utf8");
  if (path.includes("one-lucky-bloom")) source = bloomHtml(source);
  await writeFile(outputPath, compactHtml(source));
}
for (const card of cards) {
  for (const path of new Set([
    `prototypes/${card.slug}/style.css`,
    `${publicPathForCard(card)}/style.css`,
  ])) {
    const outputPath = resolve(destination, path);
    let source = await readFile(outputPath, "utf8");
    if (path.includes("one-lucky-bloom")) source = bloomCss(source);
    await writeFile(outputPath, compactCss(source));
  }
}
for (const file of ["game.js", "state.js"]) {
  const outputPath = resolve(destination, "prototypes", "surface-signal", file);
  await writeFile(outputPath, compactSurfaceSignalJs(await readFile(outputPath, "utf8")));
}
for (const directory of ["prototypes/one-lucky-bloom", "games/one-lucky-bloom"]) {
  const gamePath = resolve(destination, directory, "game.js");
  const statePath = resolve(destination, directory, "state.js");
  await writeFile(gamePath, await bundleOneLuckyBloom(
    await readFile(statePath, "utf8"),
    bloomGameText(await readFile(gamePath, "utf8")),
  ));
  await writeFile(statePath, "");
}
// Shared CSS ships to every game; compact it the same way per-game stylesheets
// already are (NOW-201 needed the reclaimed headroom for the feedback control).
const sharedDir = resolve(destination, "shared");
for (const entry of await readdir(sharedDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
  const cssPath = resolve(sharedDir, entry.name);
  await writeFile(cssPath, compactCss(await readFile(cssPath, "utf8")));
}
for (const entry of await readdir(sharedDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const jsPath = resolve(sharedDir, entry.name);
  const output = await minify(await readFile(jsPath, "utf8"), {
    compress: { passes: 3 }, mangle: true, module: true,
  });
  if (!output.code) {
    throw new Error(`Shared JavaScript minification failed: ${entry.name}`);
  }
  await writeFile(jsPath, `${output.code}\n`);
}

await writeFile(resolve(destination, "robots.txt"), buildRobots());
await writeFile(resolve(destination, "sitemap.xml"), buildSitemap(cards));

console.log(
  `Built ${sources.length} static source paths, crawl files, and ${cards.length} prototype card${cards.length === 1 ? "" : "s"} into ${destination}`,
);
