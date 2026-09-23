import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(root, "portal", "one-lucky-bloom", "release.json");
const releaseRoot = resolve(root, "releases", "one-lucky-bloom");
const distRoot = resolve(root, "dist", "itchio", "one-lucky-bloom");
const cleanroomRoot = resolve(root, "dist", "itchio-cleanroom", "one-lucky-bloom");
const listingPath = resolve(root, "portal", "one-lucky-bloom", "LISTING.md");
const qaPath = resolve(root, "portal", "one-lucky-bloom", "QA.md");

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

export function canonicalText(body) {
  return Buffer.from(body.toString("utf8").replace(/\r\n/gu, "\n"));
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Portal transform expected exactly one ${label}.`);
  }
  return source.replace(search, replacement);
}

function removeExactly(source, pattern, count, label) {
  let matches = 0;
  const output = source.replace(pattern, () => {
    matches += 1;
    return "";
  });
  if (matches !== count) {
    throw new Error(`Portal transform expected ${count} ${label}; found ${matches}.`);
  }
  return output;
}

function portalHtml(source, config) {
  source = removeExactly(
    source,
    /^\s*<meta (?:property="og:|name="twitter:)[^\n]*\r?\n/gmu,
    14,
    "Open Graph/Twitter metadata rows",
  );
  source = removeExactly(
    source,
    /^\s*<link rel="canonical"[^\n]*\r?\n/gmu,
    1,
    "canonical link",
  );
  source = removeExactly(
    source,
    /^\s*<script type="application\/ld\+json">[\s\S]*?^\s*<\/script>\r?\n/gmu,
    1,
    "JSON-LD block",
  );
  source = removeExactly(
    source,
    /^\s*<meta name="nownow-feedback-context"[^\n]*\r?\n/gmu,
    1,
    "feedback marker",
  );
  source = removeExactly(
    source,
    /^\s*<link rel="stylesheet" href="\.\.\/\.\.\/shared\/feedback\.css" \/>\r?\n/gmu,
    1,
    "feedback stylesheet",
  );
  source = removeExactly(
    source,
    /^\s*<script type="module" src="\.\.\/\.\.\/shared\/(?:analytics|feedback)\.js"><\/script>\r?\n/gmu,
    2,
    "owned-site service scripts",
  );
  source = removeExactly(
    source,
    /\s*<nav class="more-games"[\s\S]*?<\/nav>/u,
    1,
    "owned-site result navigation",
  );
  source = replaceOnce(
    source,
    '<meta name="theme-color" content="#21172b" />',
    `<meta name="theme-color" content="#21172b" />\n    <meta name="nownow-portal" content="${config.portal}" />\n    <meta name="nownow-version" content="${config.version}" />\n    <meta name="nownow-source" content="${config.ownedSourceCommit}" />\n    <meta name="nownow-telemetry" content="none" />`,
    "theme marker",
  );
  source = replaceOnce(
    source,
    '<a href="../../" aria-label="Back to NowNow Games">← All games</a>',
    "<span>Itch.io portal edition</span>",
    "owned-site header link",
  );
  source = replaceOnce(
    source,
    '<p id="best-note"></p>',
    '<p id="best-note"></p>\n        <p class="portal-note">Offline, local-only edition. No account or network connection is required after loading.</p>',
    "portal result note anchor",
  );
  return source;
}

function portalGame(source) {
  source = replaceOnce(
    source,
    'import { isEditableTarget } from "../../shared/input.js";',
    'import { isEditableTarget } from "./input.js";',
    "shared input import",
  );
  source = removeExactly(
    source,
    /^import \{ trackGameEvent \} from "\.\.\/\.\.\/shared\/analytics\.js";\r?\n/mu,
    1,
    "analytics import",
  );
  source = removeExactly(
    source,
    /^\s*trackGameEvent\("one-lucky-bloom", "(?:play-started|play-completed|share-triggered)"\);\r?\n/gmu,
    3,
    "analytics calls",
  );
  return source;
}

function portalState(source) {
  return replaceOnce(
    source,
    "\\nhttps://nownowgames.co.za/games/one-lucky-bloom/`;",
    "`;",
    "owned-site share URL",
  );
}

function portalStyle(source) {
  return Buffer.concat([
    source,
    Buffer.from(
      "\n/* Keep all five lane targets at least 48px wide in a 320px iframe. */\n" +
      "@media(max-width:359px){.lanes{inset-inline:2px;gap:2px}.lanes button{min-width:48px}}\n",
    ),
  ]);
}

function assertPortalFiles(files) {
  const names = [...files.keys()].sort();
  if (!names.includes("index.html") || names.some((name) => name.includes("/"))) {
    throw new Error("Portal ZIP must keep index.html and every runtime file at ZIP root.");
  }
  if (names.length > 10) throw new Error(`Portal file budget exceeded: ${names.length} files.`);
  let total = 0;
  for (const [name, body] of files) {
    const bytes = Buffer.byteLength(body);
    total += bytes;
    if (Buffer.byteLength(name) > 240) throw new Error(`Portal path exceeds 240 bytes: ${name}`);
    if (bytes > 32 * 1024) throw new Error(`Portal file exceeds 32 KiB: ${name}`);
  }
  if (total > 64 * 1024) throw new Error(`Portal extracted budget exceeded: ${total} bytes.`);

  const runtime = [...files.entries()]
    .filter(([name]) => /\.(?:html|js|css)$/u.test(name))
    .map(([, body]) => body.toString("utf8"))
    .join("\n");
  for (const [pattern, label] of [
    [/https?:\/\//iu, "remote URL"],
    [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u, "network API"],
    [/serviceWorker/iu, "service worker"],
    [/analytics|feedback\/submit/iu, "owned-site analytics/feedback"],
    [/(?:src|href)="\//iu, "root-absolute asset"],
  ]) {
    if (pattern.test(runtime)) throw new Error(`Portal runtime contains forbidden ${label}.`);
  }
  if (!files.get("index.html").toString("utf8").includes('name="nownow-portal" content="itchio"')) {
    throw new Error("Portal source marker is missing.");
  }
}

export async function buildItchioPortalFiles() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const sources = new Map();
  for (const path of config.sourceFiles) {
    const body = canonicalText(await readFile(resolve(root, path)));
    const actual = sha256(body);
    if (config.sourceHashes?.[path] !== actual) {
      throw new Error(
        `Owned source ${path} no longer matches ${config.ownedSourceCommit}; ` +
        "review the source change and cut a new portal version.",
      );
    }
    sources.set(path, body);
  }
  const files = new Map([
    ["index.html", Buffer.from(portalHtml(sources.get(config.sourceFiles[0]).toString("utf8"), config))],
    ["game.js", Buffer.from(portalGame(sources.get(config.sourceFiles[1]).toString("utf8")))],
    ["state.js", Buffer.from(portalState(sources.get(config.sourceFiles[2]).toString("utf8")))],
    ["style.css", portalStyle(sources.get(config.sourceFiles[3]))],
    ["input.js", sources.get(config.sourceFiles[4])],
  ]);
  const marker = {
    title: config.title,
    version: config.version,
    portal: config.portal,
    telemetry: "none",
    ownedSourceCommit: config.ownedSourceCommit,
    ownedSourceFiles: Object.fromEntries(
      config.sourceFiles.map((path) => [path, `sha256:${config.sourceHashes[path]}`]),
    ),
  };
  files.set("source.json", Buffer.from(`${JSON.stringify(marker, null, 2)}\n`));
  assertPortalFiles(files);
  return { config, files };
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function crc32(body) {
  let crc = 0xffffffff;
  for (const byte of body) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export function createDeterministicZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const entries = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [name, value] of entries) {
    const filename = Buffer.from(name, "utf8");
    const body = Buffer.from(value);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + body.length;
  }
  const centralBody = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBody.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const zip = Buffer.concat([...localParts, centralBody, end]);
  if (zip.length > 100 * 1024) throw new Error(`Portal ZIP budget exceeded: ${zip.length} bytes.`);
  return zip;
}

export function readDeterministicZip(value) {
  const zip = Buffer.from(value);
  if (zip.length < 22) throw new Error("Portal ZIP is missing its end record.");
  const endOffset = zip.length - 22;
  if (zip.readUInt32LE(endOffset) !== 0x06054b50) {
    throw new Error("Portal ZIP must have one fixed, comment-free end record.");
  }
  const disk = zip.readUInt16LE(endOffset + 4);
  const centralDisk = zip.readUInt16LE(endOffset + 6);
  const diskEntries = zip.readUInt16LE(endOffset + 8);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  const centralSize = zip.readUInt32LE(endOffset + 12);
  const centralOffset = zip.readUInt32LE(endOffset + 16);
  const commentLength = zip.readUInt16LE(endOffset + 20);
  if (
    disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || commentLength !== 0 ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new Error("Portal ZIP uses an unsupported multi-disk, trailing, or commented layout.");
  }

  const files = new Map();
  const localEntries = [];
  let offset = 0;
  while (offset < centralOffset) {
    if (offset + 30 > centralOffset || zip.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error("Portal ZIP has an invalid local entry header.");
    }
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const modifiedTime = zip.readUInt16LE(offset + 10);
    const modifiedDate = zip.readUInt16LE(offset + 12);
    const crc = zip.readUInt32LE(offset + 14);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    if (
      flags !== 0x0800 || method !== 0 || modifiedTime !== 0 || modifiedDate !== 33 ||
      compressedSize !== uncompressedSize || extraLength !== 0
    ) {
      throw new Error("Portal ZIP entry is not deterministic UTF-8 stored data.");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    const dataEnd = dataStart + compressedSize;
    if (!nameLength || dataEnd > centralOffset) {
      throw new Error("Portal ZIP entry exceeds its local file area.");
    }
    const name = zip.subarray(nameStart, dataStart).toString("utf8");
    const body = Buffer.from(zip.subarray(dataStart, dataEnd));
    if (files.has(name) || crc32(body) !== crc) {
      throw new Error("Portal ZIP has a duplicate or corrupt entry: " + name + ".");
    }
    files.set(name, body);
    localEntries.push({ name, crc, size: body.length, offset });
    offset = dataEnd;
  }
  if (offset !== centralOffset || localEntries.length !== entryCount) {
    throw new Error("Portal ZIP local entry count does not match its end record.");
  }

  offset = centralOffset;
  for (const local of localEntries) {
    if (offset + 46 > endOffset || zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Portal ZIP has an invalid central entry header.");
    }
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const entryDisk = zip.readUInt16LE(offset + 34);
    const localOffset = zip.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const entryEnd = nameStart + nameLength + extraLength + commentLength;
    if (entryEnd > endOffset) throw new Error("Portal ZIP central entry exceeds its directory.");
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (
      flags !== 0x0800 || method !== 0 || compressedSize !== uncompressedSize ||
      extraLength !== 0 || commentLength !== 0 || entryDisk !== 0 ||
      name !== local.name || crc !== local.crc || uncompressedSize !== local.size ||
      localOffset !== local.offset
    ) {
      throw new Error("Portal ZIP central entry disagrees with local data: " + name + ".");
    }
    offset = entryEnd;
  }
  if (offset !== endOffset) throw new Error("Portal ZIP central directory has trailing data.");
  return files;
}

async function writeDirectory(directory, files) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await Promise.all([...files].map(([name, body]) => writeFile(resolve(directory, name), body)));
}

export async function extractCommittedItchioPortal(directory = cleanroomRoot) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const zipPath = resolve(releaseRoot, config.packageFile);
  const files = readDeterministicZip(await readFile(zipPath));
  assertPortalFiles(files);
  await writeDirectory(directory, files);
  return { config, files, directory };
}

function inventory(files) {
  const rows = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, body]) => `${String(body.length).padStart(6)}  ${sha256(body)}  ${name}`);
  const total = [...files.values()].reduce((sum, body) => sum + body.length, 0);
  return [`files=${files.size}`, `extracted_bytes=${total}`, ...rows, ""].join("\n");
}

export async function writeItchioPortalDirectory(directory = distRoot) {
  const built = await buildItchioPortalFiles();
  await writeDirectory(directory, built.files);
  return built;
}

export async function packageItchioPortal({ check = false } = {}) {
  const { config, files } = await writeItchioPortalDirectory();
  const zip = createDeterministicZip(files);
  const digest = sha256(zip);
  const extractedBytes = [...files.values()].reduce((sum, body) => sum + body.length, 0);
  const zipPath = resolve(releaseRoot, config.packageFile);
  const checksumPath = `${zipPath}.sha256`;
  const inventoryPath = resolve(
    releaseRoot,
    config.packageFile.replace(/\.zip$/u, ".inventory.txt"),
  );
  const checksum = `${digest}  ${config.packageFile}\n`;
  if (check) {
    const [committedZip, committedChecksum, committedInventory, listing, qa] =
      await Promise.all([
        readFile(zipPath),
        readFile(checksumPath, "utf8"),
        readFile(inventoryPath, "utf8"),
        readFile(listingPath, "utf8"),
        readFile(qaPath, "utf8"),
      ]);
    if (!zip.equals(committedZip)) throw new Error("Committed itch.io ZIP is stale; run npm run portal:package.");
    if (checksum !== committedChecksum) throw new Error("Committed itch.io checksum is stale.");
    if (inventory(files) !== committedInventory) throw new Error("Committed itch.io inventory is stale.");
    if (!listing.includes(config.ownedSourceCommit) || !listing.includes(digest)) {
      throw new Error("itch.io listing source or checksum evidence is stale.");
    }
    const budgetClaim =
      `${zip.length.toLocaleString("en-US")} ZIP bytes; ` +
      `${extractedBytes.toLocaleString("en-US")} extracted bytes; six files.`;
    if (!qa.includes(config.ownedSourceCommit) || !qa.includes(budgetClaim)) {
      throw new Error("itch.io QA source or package budget evidence is stale.");
    }
    const unpacked = readDeterministicZip(committedZip);
    for (const [name, body] of files) {
      if (!unpacked.get(name)?.equals(body)) {
        throw new Error("Committed itch.io ZIP content is stale: " + name + ".");
      }
    }
    if (unpacked.size !== files.size) throw new Error("Committed itch.io ZIP has unexpected entries.");
  } else {
    await mkdir(dirname(zipPath), { recursive: true });
    await Promise.all([
      writeFile(zipPath, zip),
      writeFile(checksumPath, checksum),
      writeFile(inventoryPath, inventory(files)),
    ]);
  }
  console.log(
    `${check ? "Verified" : "Packaged"} ${config.packageFile}: ${zip.length} ZIP bytes, ` +
    `${extractedBytes} extracted bytes, ${files.size} files, sha256:${digest}`,
  );
  return { config, files, zip, digest };
}

const launchedFromCli = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedFromCli) await packageItchioPortal({ check: process.argv.includes("--check") });
