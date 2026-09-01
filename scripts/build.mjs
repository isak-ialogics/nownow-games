import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { populateHub, readPrototypeCards } from "./hub-registry.mjs";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "dist");
const sources = ["index.html", "shared", "prototypes"];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const source of sources) {
  await cp(resolve(root, source), resolve(destination, source), {
    recursive: true,
  });
}

const cards = await readPrototypeCards(resolve(root, "prototypes"));
const hub = await readFile(resolve(root, "index.html"), "utf8");
await writeFile(resolve(destination, "index.html"), populateHub(hub, cards));

console.log(
  `Built ${sources.length} static source paths and ${cards.length} prototype card${cards.length === 1 ? "" : "s"} into ${destination}`,
);
