import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "index.html",
  "shared/input.js",
  "shared/site.css",
  "prototypes/input-lab/index.html",
  "prototypes/input-lab/game.js",
  "prototypes/input-lab/state.js",
];

for (const path of required) await access(resolve(root, path));

const prototypeDirectories = (
  await readdir(resolve(root, "prototypes"), { withFileTypes: true })
).filter((entry) => entry.isDirectory());
if (prototypeDirectories.length === 0)
  throw new Error("At least one prototype folder is required.");

for (const directory of prototypeDirectories) {
  await access(resolve(root, "prototypes", directory.name, "index.html"));
}

const hub = await readFile(resolve(root, "index.html"), "utf8");
const prototype = await readFile(
  resolve(root, "prototypes/input-lab/index.html"),
  "utf8",
);
const game = await readFile(
  resolve(root, "prototypes/input-lab/game.js"),
  "utf8",
);

for (const [name, document] of [
  ["hub", hub],
  ["input lab", prototype],
]) {
  if (!document.includes('name="viewport"'))
    throw new Error(`${name} is missing the mobile viewport meta tag.`);
  if (/\b(?:href|src)="\//.test(document))
    throw new Error(`${name} uses a root-absolute asset path.`);
}

if (!hub.includes("./prototypes/input-lab/"))
  throw new Error("Hub does not link to the placeholder prototype.");
if (!game.includes("../../shared/input.js"))
  throw new Error("Placeholder does not use the shared input module.");

console.log(
  `Static checks passed for ${prototypeDirectories.length} prototype folder.`,
);
