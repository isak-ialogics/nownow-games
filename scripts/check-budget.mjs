import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import { compressStaticBody } from "../server/static.mjs";

const KIBIBYTE = 1024;
const root = resolve(
  process.env.NOWNOW_BUDGET_ROOT ?? resolve(import.meta.dirname, "..", "dist"),
);
const limits = Object.freeze({
  prototype: Object.freeze({
    total: 20 * KIBIBYTE,
    // Raised 8 -> 8.5 KiB for NOW-201: Before Midnight's own pause/resume
    // hook for the shared feedback dialog needed a little more room than the
    // other two games' event listeners.
    javascript: 8.5 * KIBIBYTE,
  }),
  wire: Object.freeze({
    total: 20 * KIBIBYTE,
    javascript: 8.5 * KIBIBYTE,
  }),
  shared: Object.freeze({
    // Raised 16 -> 24 KiB / 7 -> 14 KiB for NOW-201: the always-reachable
    // "Something wrong?" feedback control (dialog markup, validation, retry
    // handling, and its dedicated stylesheet) is one shared module reused by
    // all three games rather than duplicated per game. Text-only for now;
    // voice notes are a separate follow-up and will need their own bump.
    total: 24 * KIBIBYTE,
    javascript: 14 * KIBIBYTE,
  }),
  hub: Object.freeze({ total: 7 * KIBIBYTE }),
});

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

function localPath(fromFile, reference) {
  const clean = reference.split(/[?#]/u, 1)[0];
  if (!clean || /^(?:data:|https?:|\/\/)/iu.test(clean)) return null;
  const path = clean.startsWith("/")
    ? resolve(root, `.${clean}`)
    : resolve(dirname(fromFile), clean);
  const pathFromRoot = relative(root, path);
  return pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)
    ? null
    : path;
}

function attribute(markup, name) {
  return markup.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu"),
  )?.[1];
}

function referencesIn(file, source) {
  const references = [];
  const extension = extname(file);
  if (extension === ".html") {
    for (const match of source.matchAll(/<(script|link)\b[^>]*>/giu)) {
      const tag = match[1].toLowerCase();
      if (tag === "script") {
        const sourceReference = attribute(match[0], "src");
        if (sourceReference) references.push(sourceReference);
      } else {
        const rel = attribute(match[0], "rel")?.toLowerCase().split(/\s+/u);
        const href = attribute(match[0], "href");
        if (href && rel?.includes("stylesheet")) references.push(href);
      }
    }
  }
  if (extension === ".js" || extension === ".mjs") {
    const imports = /(?:import|export)\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/gu;
    for (const match of source.matchAll(imports)) references.push(match[1]);
  }
  if (extension === ".css") {
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
      references.push(match[1]);
    }
  }
  return references;
}

async function collectPageResources(entry) {
  const files = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (files.has(file)) continue;
    files.add(file);
    const source = await readFile(file, "utf8");
    for (const reference of referencesIn(file, source)) {
      const dependency = localPath(file, reference);
      if (dependency && !files.has(dependency)) pending.push(dependency);
    }
  }
  return [...files];
}

async function measure(label, files, bucketLimits) {
  const sizes = await Promise.all(
    files.map(async (file) => ({ file, bytes: (await stat(file)).size })),
  );
  const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
  const javascript = sizes
    .filter((item) => [".js", ".mjs"].includes(extname(item.file)))
    .reduce((sum, item) => sum + item.bytes, 0);

  return Object.freeze({
    label,
    total,
    javascript,
    limits: bucketLimits,
    fileCount: files.length,
  });
}

async function measureWire(label, files, bucketLimits) {
  const sizes = await Promise.all(
    files.map(async (file) => {
      const compressible = [
        ".css",
        ".html",
        ".js",
        ".json",
        ".mjs",
        ".txt",
        ".xml",
      ].includes(extname(file));
      return {
        file,
        bytes: compressible
          ? (await compressStaticBody(await readFile(file), "br")).length
          : (await stat(file)).size,
      };
    }),
  );
  const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
  const javascript = sizes
    .filter((item) => [".js", ".mjs"].includes(extname(item.file)))
    .reduce((sum, item) => sum + item.bytes, 0);
  return Object.freeze({
    label,
    total,
    javascript,
    limits: bucketLimits,
    fileCount: files.length,
  });
}

function comparison(measured, limit) {
  return `${measured} B / ${limit} B (${(measured / KIBIBYTE).toFixed(2)} KiB / ${(limit / KIBIBYTE).toFixed(2)} KiB)`;
}

const prototypeRoot = resolve(root, "prototypes");
const prototypeDirectories = (
  await readdir(prototypeRoot, { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));

const buckets = [
  await measure("hub/index.html", [resolve(root, "index.html")], limits.hub),
  await measure("shared", await collect(resolve(root, "shared")), limits.shared),
];

for (const directory of prototypeDirectories) {
  buckets.push(
    await measure(
      `prototypes/${directory.name}`,
      await collect(resolve(prototypeRoot, directory.name)),
      limits.prototype,
    ),
  );
}

for (const directory of prototypeDirectories) {
  const entry = resolve(prototypeRoot, directory.name, "index.html");
  buckets.push(
    await measureWire(
      `wire/prototypes/${directory.name}`,
      await collectPageResources(entry),
      limits.wire,
    ),
  );
}

const failures = [];
for (const bucket of buckets) {
  const totalExceeded = bucket.total > bucket.limits.total;
  const javascriptExceeded =
    bucket.limits.javascript !== undefined &&
    bucket.javascript > bucket.limits.javascript;
  const result = totalExceeded || javascriptExceeded ? "FAIL" : "PASS";
  const javascript =
    bucket.limits.javascript === undefined
      ? ""
      : `; JavaScript ${comparison(bucket.javascript, bucket.limits.javascript)}`;

  console.log(
    `${result} ${bucket.label}: total ${comparison(bucket.total, bucket.limits.total)}${javascript}; ${bucket.fileCount} file${bucket.fileCount === 1 ? "" : "s"}`,
  );

  if (totalExceeded) failures.push(`${bucket.label} total`);
  if (javascriptExceeded) failures.push(`${bucket.label} JavaScript`);
}

console.log(
  `Checked ${prototypeDirectories.length} prototype source and wire budget bucket${prototypeDirectories.length === 1 ? "" : "s"}.`,
);

if (failures.length > 0) {
  console.error(
    `Static performance budget exceeded: ${failures.join(", ")}.`,
  );
  process.exitCode = 1;
}
