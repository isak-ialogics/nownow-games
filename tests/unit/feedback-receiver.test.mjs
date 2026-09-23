import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as sendHttpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppServer } from "../../server/app.mjs";
import {
  buildQueueComment,
  MAX_BODY_BYTES,
  RateLimiter,
  validateFeedback,
} from "../../server/feedback.mjs";

const validFeedback = Object.freeze({
  message: "The pump control felt unresponsive on iPhone.",
  path: "/games/before-midnight/",
  context: "before-midnight@1",
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createStaticRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "nownow-feedback-test-"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>NowNow</title>");
  await writeFile(join(root, "404.html"), "That page slipped away.");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function startQueue(
  t,
  {
    status = 202,
    result = { status: "issue_created", linkedIssueId: "feedback-item" },
  } = {},
) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    requests.push({
      authorization: request.headers.authorization,
      idempotencyKey: request.headers["idempotency-key"],
      path: request.url,
      rawBody,
      signature: request.headers["x-paperclip-signature"],
      timestamp: request.headers["x-paperclip-timestamp"],
      value: JSON.parse(rawBody),
    });
    response
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify(result));
  });
  const url = await listen(server);
  t.after(() => close(server));
  return { requests, url };
}

async function startApp(t, options = {}) {
  const root = options.root ?? (await createStaticRoot(t));
  const server = createAppServer({ root, ...options });
  const url = await listen(server);
  t.after(() => close(server));
  return url;
}

function post(url, value, options = {}) {
  return fetch(`${url}/feedback/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

async function getWithHost(url, host) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = sendHttpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: { Host: host },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({ headers: response.headers, status: response.statusCode }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function postChunked(url, chunks) {
  const target = new URL(`${url}/feedback/submit`);
  return new Promise((resolve, reject) => {
    const request = sendHttpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

test("validates and sanitizes the exact anonymous feedback contract", () => {
  assert.deepEqual(
    validateFeedback({
      ...validFeedback,
      message: "  stuck\u0000 button\r\nsecond line  ",
      tech: {
        ua: "Browser/1.0",
        viewport: "390x844",
        lang: "en-ZA",
      },
    }),
    {
      ok: true,
      report: {
        ...validFeedback,
        message: "stuck button\nsecond line",
        tech: {
          ua: "Browser/1.0",
          viewport: "390x844",
          lang: "en-ZA",
        },
      },
    },
  );

  for (const invalid of [
    { ...validFeedback, accountId: "never-store-this" },
    { ...validFeedback, message: " " },
    { ...validFeedback, message: "x".repeat(1001) },
    { ...validFeedback, path: "https://example.com/" },
    { ...validFeedback, context: "not-versioned" },
    {
      ...validFeedback,
      tech: {
        ua: "Browser",
        viewport: "wide",
        lang: "en-ZA",
      },
    },
    {
      ...validFeedback,
      tech: {
        ua: "Browser",
        viewport: "390x844",
        lang: "en-ZA",
        cookie: "never",
      },
    },
  ]) {
    assert.deepEqual(validateFeedback(invalid), { ok: false });
  }
});

test("renders untrusted feedback as inert queue text", () => {
  const body = buildQueueComment(
    {
      ...validFeedback,
      message: "<script>alert(1)</script> @Studio Lead **urgent**",
      tech: {
        ua: "<img src=x> @GameEngineer",
        viewport: "390x844",
        lang: "en-ZA",
      },
    },
    "fb-test",
    "2026-09-12T12:00:00.000Z",
  );
  assert.doesNotMatch(body, /<script>|<img|@Studio|@GameEngineer/u);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(body, /&#64;Studio Lead/u);
});

test("rate limiter forgets source keys after its short window", () => {
  const limiter = new RateLimiter({ limit: 2, windowMs: 100 });
  assert.equal(limiter.check("198.51.100.1", 0), true);
  assert.equal(limiter.check("198.51.100.1", 1), true);
  assert.equal(limiter.check("198.51.100.1", 2), false);
  limiter.prune(100);
  assert.equal(limiter.entries.size, 0);
  assert.equal(limiter.check("198.51.100.1", 100), true);
});

test("accepts feedback only after the monitored queue stores it", async (t) => {
  const queue = await startQueue(t);
  const url = await startApp(t, {
    env: {
      FEEDBACK_QUEUE_WEBHOOK_URL:
        `${queue.url}/api/routine-triggers/public/test-trigger/fire`,
      FEEDBACK_QUEUE_WEBHOOK_SECRET: "queue-secret",
    },
    idFactory: () => "fb-receipt42",
    now: () => Date.parse("2026-09-12T12:00:00.000Z"),
  });

  const response = await post(url, {
    ...validFeedback,
    message: "@Studio <b>button stuck</b>",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "fb-receipt42" });
  assert.equal(queue.requests.length, 1);
  const queued = queue.requests[0];
  assert.equal(
    queued.path,
    "/api/routine-triggers/public/test-trigger/fire",
  );
  assert.equal(queued.authorization, undefined);
  assert.equal(queued.idempotencyKey, "fb-receipt42");
  assert.equal(
    queued.timestamp,
    String(Math.floor(Date.parse("2026-09-12T12:00:00.000Z") / 1000)),
  );
  assert.equal(queued.value.feedbackRef, "fb-receipt42");
  assert.match(queued.value.body, /fb-receipt42/u);
  assert.match(queued.value.body, /&#64;Studio/u);
  assert.doesNotMatch(queued.value.body, /<b>/u);
  const expectedSignature = createHmac("sha256", "queue-secret")
    .update(`${queued.timestamp}.`)
    .update(queued.rawBody)
    .digest("hex");
  assert.equal(queued.signature, `sha256=${expectedSignature}`);
});

test("fails closed when the queue rejects or is not configured", async (t) => {
  const rejectedQueue = await startQueue(t, {
    result: { status: "failed", linkedIssueId: null },
  });
  const rejectedUrl = await startApp(t, {
    env: {
      FEEDBACK_QUEUE_WEBHOOK_URL: rejectedQueue.url,
      FEEDBACK_QUEUE_WEBHOOK_SECRET: "queue-secret",
    },
  });
  assert.equal((await post(rejectedUrl, validFeedback)).status, 502);

  const unconfiguredUrl = await startApp(t, { env: {} });
  assert.equal((await post(unconfiguredUrl, validFeedback)).status, 503);
});

test("enforces media type, payload shape, body size, and per-source rate", async (t) => {
  const queue = await startQueue(t);
  const url = await startApp(t, {
    env: {
      FEEDBACK_QUEUE_WEBHOOK_URL: queue.url,
      FEEDBACK_QUEUE_WEBHOOK_SECRET: "queue-secret",
    },
    rateLimit: 10,
  });

  const textResponse = await fetch(`${url}/feedback/submit`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "not json",
  });
  assert.equal(textResponse.status, 415);
  assert.equal((await post(url, { ...validFeedback, email: "no@example.com" })).status, 400);
  assert.equal(
    (await post(url, "x".repeat(MAX_BODY_BYTES + 1))).status,
    413,
  );
  const oversized = JSON.stringify({ message: "x".repeat(MAX_BODY_BYTES) });
  assert.equal(
    await postChunked(url, [oversized.slice(0, 100), oversized.slice(100)]),
    413,
  );

  const rateUrl = await startApp(t, {
    env: {
      FEEDBACK_QUEUE_WEBHOOK_URL: queue.url,
      FEEDBACK_QUEUE_WEBHOOK_SECRET: "queue-secret",
    },
    rateLimit: 2,
  });
  assert.equal((await post(rateUrl, validFeedback)).status, 200);
  assert.equal((await post(rateUrl, validFeedback)).status, 200);
  const limited = await post(rateUrl, validFeedback);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("serves the built site, redirects canonical routes, and returns the custom 404", async (t) => {
  const url = await startApp(t, { env: {} });
  const home = await fetch(`${url}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /NowNow/u);

  const legacy = await fetch(`${url}/prototypes/before-midnight/?from=test`, {
    redirect: "manual",
  });
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get("location"), "/games/before-midnight/?from=test");

  const bloomLegacy = await fetch(`${url}/prototypes/one-lucky-bloom/`, {
    redirect: "manual",
  });
  assert.equal(bloomLegacy.status, 308);
  assert.equal(bloomLegacy.headers.get("location"), "/games/one-lucky-bloom/");

  const canonical = await getWithHost(
    `${url}/a?b=1`,
    "www.nownowgames.co.za",
  );
  assert.equal(canonical.status, 308);
  assert.equal(
    canonical.headers.location,
    "https://nownowgames.co.za/a?b=1",
  );

  const missing = await fetch(`${url}/missing`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /That page slipped away/u);
});
