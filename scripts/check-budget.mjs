import { readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist");
const limits = Object.freeze({ total: 60 * 1024, javascript: 20 * 1024 });

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = await collect(root);
const sizes = await Promise.all(
  files.map(async (file) => ({ file, bytes: (await stat(file)).size })),
);
const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
const javascript = sizes
  .filter((item) => [".js", ".mjs"].includes(extname(item.file)))
  .reduce((sum, item) => sum + item.bytes, 0);

console.log(
  `Static artifact: ${total} bytes across ${files.length} files (budget ${limits.total})`,
);
console.log(`JavaScript: ${javascript} bytes (budget ${limits.javascript})`);

if (total > limits.total || javascript > limits.javascript) {
  process.exitCode = 1;
  throw new Error("Static performance budget exceeded.");
}
