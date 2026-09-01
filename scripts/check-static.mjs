import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "index.html",
  "shared/input.js",
  "shared/site.css",
  "prototypes/README.md",
];

for (const path of required) await access(resolve(root, path));

const prototypeDirectories = (
  await readdir(resolve(root, "prototypes"), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));

const hub = await readFile(resolve(root, "index.html"), "utf8");
if (!hub.includes('name="viewport"')) {
  throw new Error("Hub is missing the mobile viewport meta tag.");
}
if (/\b(?:href|src)="\//.test(hub)) {
  throw new Error("Hub uses a root-absolute asset path.");
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
  if (!game.includes("../../shared/input.js")) {
    throw new Error(`${directory.name} does not use the shared input module.`);
  }
}

console.log(
  `Static checks passed for ${prototypeDirectories.length} prototype folder${prototypeDirectories.length === 1 ? "" : "s"}.`,
);
