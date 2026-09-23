import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppServer } from "../../server/app.mjs";
import { selectContentEncoding } from "../../server/static.mjs";

const scratchRoot =
  process.env.PAPERCLIP_RUN_SCRATCH_DIR ??
  process.env.PAPERCLIP_SCRATCH_DIR ??
  tmpdir();

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startStaticServer(t) {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, "nownow-static-test-"));
  const html = `<!doctype html><title>NowNow</title><p>${"flame ".repeat(700)}</p>`;
  const javascript = `export const rhythm = "${"together-".repeat(600)}";`;
  await writeFile(join(root, "index.html"), html);
  await writeFile(join(root, "app.js"), javascript);
  await writeFile(join(root, "404.html"), "That page slipped away.");
  const server = createAppServer({ root, env: {} });
  const url = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(root, { recursive: true, force: true });
  });
  return { html, javascript, url };
}

test("negotiates Brotli, gzip, and identity according to client quality", () => {
  assert.equal(selectContentEncoding("gzip, deflate, br"), "br");
  assert.equal(selectContentEncoding("gzip;q=1, br;q=0.5"), "gzip");
  assert.equal(selectContentEncoding("br;q=0.5"), null);
  assert.equal(selectContentEncoding("identity"), null);
});

test("serves compressed, cacheable, revalidatable static responses with security headers", async (t) => {
  const { html, javascript, url } = await startStaticServer(t);
  const documentResponse = await fetch(url, {
    cache: "no-store",
    headers: { "Accept-Encoding": "br" },
  });

  assert.equal(documentResponse.status, 200);
  assert.equal(documentResponse.headers.get("content-encoding"), "br");
  assert.equal(documentResponse.headers.get("vary"), "Accept-Encoding");
  assert.ok(Number(documentResponse.headers.get("content-length")) < Buffer.byteLength(html));
  assert.equal(documentResponse.headers.get("cache-control"), "no-cache");
  assert.match(documentResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
  assert.equal(documentResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(documentResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(
    documentResponse.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(await documentResponse.text(), html);

  const etag = documentResponse.headers.get("etag");
  const revalidated = await fetch(url, {
    headers: { "Accept-Encoding": "br", "If-None-Match": etag },
  });
  assert.equal(revalidated.status, 304);
  assert.equal(await revalidated.text(), "");

  const assetResponse = await fetch(`${url}/app.js`, {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(assetResponse.headers.get("content-encoding"), "gzip");
  assert.equal(
    assetResponse.headers.get("cache-control"),
    "public, max-age=3600, must-revalidate",
  );
  assert.ok(
    Number(assetResponse.headers.get("content-length")) <
      Buffer.byteLength(javascript),
  );
  assert.equal(await assetResponse.text(), javascript);

  const identityResponse = await fetch(`${url}/app.js`, {
    method: "HEAD",
    headers: { "Accept-Encoding": "identity" },
  });
  assert.equal(identityResponse.headers.get("content-encoding"), null);
  assert.equal(
    Number(identityResponse.headers.get("content-length")),
    Buffer.byteLength(javascript),
  );
});
