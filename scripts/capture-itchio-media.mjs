import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

import { createAppServer } from "../server/app.mjs";

const root = resolve(import.meta.dirname, "..");
const outputRoot = resolve(root, "portal", "one-lucky-bloom", "media");

await mkdir(outputRoot, { recursive: true });
const server = createAppServer({ root: resolve(root, "dist") });
await new Promise((resolveReady, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveReady);
});
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Portal media server did not expose a TCP port.");
}

const browser = await chromium.launch();
const errors = [];
const watch = (page) => {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
};

try {
  const coverContext = await browser.newContext({
    viewport: { width: 630, height: 500 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const cover = await coverContext.newPage();
  watch(cover);
  await cover.goto(pathToFileURL(resolve(root, "portal", "one-lucky-bloom", "cover.html")).href);
  await cover.screenshot({
    path: resolve(outputRoot, "cover-630x500.png"),
    type: "png",
    animations: "disabled",
  });
  await coverContext.close();

  const origin = `http://127.0.0.1:${address.port}`;
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const desktop = await desktopContext.newPage();
  watch(desktop);
  const desktopResponse = await desktop.goto(`${origin}/itchio/one-lucky-bloom/`, {
    waitUntil: "networkidle",
  });
  if (desktopResponse?.status() !== 200) {
    throw new Error(`Portal intro returned ${desktopResponse?.status()} during capture.`);
  }
  await desktop.screenshot({
    path: resolve(outputRoot, "intro-1280x800.png"),
    type: "png",
    animations: "disabled",
  });
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const mobile = await mobileContext.newPage();
  watch(mobile);
  await mobile.clock.install();
  const mobileResponse = await mobile.goto(`${origin}/itchio/one-lucky-bloom/`, {
    waitUntil: "networkidle",
  });
  if (mobileResponse?.status() !== 200) {
    throw new Error(`Portal game returned ${mobileResponse?.status()} during capture.`);
  }
  await mobile.getByRole("button", { name: "Try your luck" }).tap();
  await mobile.getByRole("button", { name: "Skip and play" }).tap();
  await mobile.clock.runFor(2_100);
  await mobile.getByRole("radio", { name: "Lane 2" }).tap();
  await mobile.screenshot({
    path: resolve(outputRoot, "play-390x844.png"),
    type: "png",
    animations: "disabled",
  });
  await mobile.clock.runFor(40_000);
  await mobile.locator("#result-card").scrollIntoViewIfNeeded();
  await mobile.screenshot({
    path: resolve(outputRoot, "result-390x844.png"),
    type: "png",
    animations: "disabled",
  });
  await mobileContext.close();

  if (errors.length > 0) {
    throw new Error(`Portal media pages logged errors: ${errors.join("; ")}`);
  }
} finally {
  await browser.close();
  await new Promise((resolveClosed, reject) => {
    server.close((error) => error ? reject(error) : resolveClosed());
  });
}

console.log("Captured original 630x500 cover and three truthful portal screenshots.");
