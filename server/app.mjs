import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createFeedbackReceiver } from "./feedback.mjs";

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
});

function commonHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };
}

function sendJson(response, status, value) {
  response
    .writeHead(status, commonHeaders("application/json; charset=utf-8"))
    .end(JSON.stringify(value));
}

async function sendFile(request, response, file, status = 200) {
  await stat(file);
  response.writeHead(
    status,
    commonHeaders(CONTENT_TYPES[extname(file)] ?? "application/octet-stream"),
  );
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

async function sendNotFound(root, request, response) {
  const notFound = resolve(root, "404.html");
  try {
    await sendFile(request, response, notFound, 404);
  } catch {
    response
      .writeHead(404, commonHeaders("text/plain; charset=utf-8"))
      .end("Not found");
  }
}

function configuredPort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  return port;
}

export function createAppServer({
  root = resolve("dist"),
  env = process.env,
  fetchImpl = fetch,
  idFactory,
  now,
  rateLimit,
  rateWindowMs,
} = {}) {
  const feedback = createFeedbackReceiver({
    apiUrl: env.FEEDBACK_PAPERCLIP_API_URL ?? env.PAPERCLIP_API_URL,
    apiKey: env.FEEDBACK_PAPERCLIP_API_KEY ?? env.PAPERCLIP_API_KEY,
    queueIssueId: env.FEEDBACK_QUEUE_ISSUE_ID,
    trustProxy: env.FEEDBACK_TRUST_PROXY !== "0",
    fetchImpl,
    idFactory,
    now,
    rateLimit,
    rateWindowMs,
  });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const host = (request.headers.host ?? "")
        .toLowerCase()
        .replace(/:\d+$/u, "");

      if (host === "www.nownowgames.co.za") {
        response
          .writeHead(308, {
            "Cache-Control": "no-store",
            Location: `https://nownowgames.co.za${url.pathname}${url.search}`,
          })
          .end();
        return;
      }

      if (url.pathname === "/feedback/submit") {
        await feedback.handle(request, response);
        return;
      }

      if (url.pathname === "/healthz") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (
        env.NODE_ENV !== "production" &&
        url.pathname === "/analytics/count"
      ) {
        response.writeHead(204, { "Cache-Control": "no-store" }).end();
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response
          .writeHead(405, {
            ...commonHeaders("text/plain; charset=utf-8"),
            Allow: "GET, HEAD",
          })
          .end("Method not allowed");
        return;
      }

      const pathname = decodeURIComponent(url.pathname);
      if (
        pathname === "/prototypes/before-midnight" ||
        pathname === "/prototypes/before-midnight/"
      ) {
        response
          .writeHead(308, {
            "Cache-Control": "no-store",
            Location: `/games/before-midnight/${url.search}`,
          })
          .end();
        return;
      }

      let file = resolve(root, `.${pathname}`);
      const pathFromRoot = relative(root, file);
      if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
        response
          .writeHead(403, commonHeaders("text/plain; charset=utf-8"))
          .end("Forbidden");
        return;
      }

      const metadata = await stat(file);
      if (metadata.isDirectory()) file = resolve(file, "index.html");
      await sendFile(request, response, file);
    } catch {
      if (!response.headersSent) await sendNotFound(root, request, response);
      else response.destroy();
    }
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("close", () => feedback.close());
  return server;
}

const launchedFromCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (launchedFromCli) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = configuredPort(process.env.PORT, 4173);
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`NowNow Games listening on http://${host}:${port}`);
  });
}
