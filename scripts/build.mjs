import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

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

console.log(`Built ${sources.length} static source paths into ${destination}`);
