import { readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

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
  `Checked ${prototypeDirectories.length} prototype budget bucket${prototypeDirectories.length === 1 ? "" : "s"}.`,
);

if (failures.length > 0) {
  console.error(
    `Static performance budget exceeded: ${failures.join(", ")}.`,
  );
  process.exitCode = 1;
}
