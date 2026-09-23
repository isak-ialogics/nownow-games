import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

import { createAppServer } from "../server/app.mjs";

const root = resolve(import.meta.dirname, "..");
const outputRoot = resolve(root, "assets");
const captures = [
  ["/", "hub-share.png"],
  ["/prototypes/latch/", "latch-share.png"],
  ["/prototypes/safe-passage/", "safe-passage-share.png"],
  ["/prototypes/same-flame/", "same-flame-share.png"],
  ["/prototypes/surface-signal/", "surface-signal-share.png"],
  ["/games/one-lucky-bloom/", "one-lucky-bloom-share.png"],
];

await mkdir(outputRoot, { recursive: true });
const server = createAppServer({ root: resolve(root, "dist") });
await new Promise((resolveReady, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveReady);
});
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Social capture server did not expose a TCP port.");
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "dark",
});
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

try {
  const origin = `http://127.0.0.1:${address.port}`;
  for (const [path, filename] of captures) {
    errors.length = 0;
    const response = await page.goto(`${origin}${path}`, {
      waitUntil: "networkidle",
    });
    if (response?.status() !== 200) {
      throw new Error(`${path} returned ${response?.status()} during capture.`);
    }
    await page.waitForTimeout(250);
    await page.screenshot({
      path: resolve(outputRoot, filename),
      type: "png",
      animations: "disabled",
    });
    if (errors.length > 0) {
      throw new Error(`${path} logged errors during capture: ${errors.join("; ")}`);
    }
  }
} finally {
  await browser.close();
  await new Promise((resolveClosed, reject) => {
    server.close((error) => error ? reject(error) : resolveClosed());
  });
}

console.log(`Captured ${captures.length} truthful 1200x630 social images.`);
