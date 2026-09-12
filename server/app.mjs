import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createFeedbackReceiver } from "./feedback.mjs";
import {
  compressStaticBody,
  isCompressible,
  selectContentEncoding,
  STATIC_SECURITY_HEADERS,
} from "./static.mjs";

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
});

function commonHeaders(contentType, cacheControl = "no-store") {
  return {
    ...STATIC_SECURITY_HEADERS,
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
  };
}

function sendJson(response, status, value) {
  response
    .writeHead(status, commonHeaders("application/json; charset=utf-8"))
    .end(JSON.stringify(value));
}

function cacheControlFor(file) {
  return extname(file) === ".html"
    ? "no-cache"
    : "public, max-age=3600, must-revalidate";
}

function entityTag(metadata, encoding) {
  const version = Math.trunc(metadata.mtimeMs).toString(16);
  return `W/"${metadata.size.toString(16)}-${version}-${encoding ?? "identity"}"`;
}

function notModified(request, metadata, etag) {
  const requestTag = request.headers["if-none-match"];
  if (requestTag) {
    return requestTag === "*" || requestTag.split(",").some(
      (candidate) => candidate.trim() === etag,
    );
  }
  const modifiedSince = Date.parse(request.headers["if-modified-since"] ?? "");
  return (
    Number.isFinite(modifiedSince) &&
    Math.trunc(metadata.mtimeMs / 1000) * 1000 <= modifiedSince
  );
}

async function compressedFile(file, metadata, encoding, cache) {
  const key = `${file}:${metadata.size}:${metadata.mtimeMs}:${encoding}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      readFile(file).then((body) => compressStaticBody(body, encoding)),
    );
  }
  try {
    return await cache.get(key);
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function sendFile(request, response, file, cache, status = 200) {
  const metadata = await stat(file);
  const contentType = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
  const compressible = isCompressible(contentType);
  const encoding = compressible
    ? selectContentEncoding(request.headers["accept-encoding"])
    : null;
  const etag = entityTag(metadata, encoding);
  const headers = {
    ...commonHeaders(contentType, cacheControlFor(file)),
    ETag: etag,
    "Last-Modified": metadata.mtime.toUTCString(),
    ...(compressible ? { Vary: "Accept-Encoding" } : {}),
    ...(encoding ? { "Content-Encoding": encoding } : {}),
  };

  if (notModified(request, metadata, etag)) {
    response.writeHead(304, headers).end();
    return;
  }

  const body = encoding
    ? await compressedFile(file, metadata, encoding, cache)
    : null;
  headers["Content-Length"] = body?.length ?? metadata.size;
  response.writeHead(status, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  if (body) {
    response.end(body);
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

async function sendNotFound(root, request, response, cache) {
  const notFound = resolve(root, "404.html");
  try {
    await sendFile(request, response, notFound, cache, 404);
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
  const staticCache = new Map();
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
            ...STATIC_SECURITY_HEADERS,
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
            ...STATIC_SECURITY_HEADERS,
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
      await sendFile(request, response, file, staticCache);
    } catch {
      if (!response.headersSent) {
        await sendNotFound(root, request, response, staticCache);
      } else response.destroy();
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
