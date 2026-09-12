import { randomBytes } from "node:crypto";

export const DEFAULT_QUEUE_ISSUE_ID =
  "7212ea0b-d8a1-4070-a46f-593258404c61";
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_MESSAGE_LENGTH = 1000;
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 60_000;

const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const GAME_PATH = /^\/(?:games|prototypes)\/[a-z0-9][a-z0-9-]*\/$/u;
const GAME_CONTEXT = /^[a-z0-9][a-z0-9-]{0,47}@[1-9][0-9]{0,9}$/u;
const VIEWPORT = /^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$/u;
const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function stripControlCharacters(value) {
  return value.replace(/\r\n?/gu, "\n").replace(CONTROL_CHARACTERS, "");
}

function cleanBoundedText(value, maximum, { trim = true } = {}) {
  if (typeof value !== "string") return null;
  const bounded = trim ? value.trim() : value;
  if (!bounded || bounded.length > maximum) return null;
  const clean = stripControlCharacters(bounded);
  if (!clean || clean.length > maximum) return null;
  return clean;
}

export function validateFeedback(value) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["message", "path", "context", "tech"]))
  ) {
    return { ok: false };
  }

  const message = cleanBoundedText(value.message, MAX_MESSAGE_LENGTH);
  const path = cleanBoundedText(value.path, 200);
  const context = cleanBoundedText(value.context, 64);
  if (!message || !path || !context) return { ok: false };
  if (!GAME_PATH.test(path) || !GAME_CONTEXT.test(context)) {
    return { ok: false };
  }

  const report = { message, path, context };
  if (value.tech !== undefined) {
    if (
      !isRecord(value.tech) ||
      !hasOnlyKeys(value.tech, new Set(["ua", "viewport", "lang"]))
    ) {
      return { ok: false };
    }
    const ua = cleanBoundedText(value.tech.ua, 512);
    const viewport = cleanBoundedText(value.tech.viewport, 32);
    const lang = cleanBoundedText(value.tech.lang, 35);
    if (
      !ua ||
      !viewport ||
      !lang ||
      !VIEWPORT.test(viewport) ||
      !LANGUAGE.test(lang)
    ) {
      return { ok: false };
    }
    report.tech = { ua, viewport, lang };
  }

  return { ok: true, report };
}

function escapeQueueText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("@", "&#64;");
}

export function buildQueueComment(report, id, receivedAt) {
  const tech = report.tech
    ? [
        "",
        "### Opt-in technical details",
        "",
        `<pre>${escapeQueueText(JSON.stringify(report.tech, null, 2))}</pre>`,
      ]
    : [];

  return [
    `## Player feedback ${id}`,
    "",
    `- Received: <code>${escapeQueueText(receivedAt)}</code>`,
    `- Path: <code>${escapeQueueText(report.path)}</code>`,
    `- Context: <code>${escapeQueueText(report.context)}</code>`,
    `- Reference: <code>${escapeQueueText(id)}</code>`,
    "",
    "### Message",
    "",
    `<pre>${escapeQueueText(report.message)}</pre>`,
    ...tech,
  ].join("\n");
}

export class RateLimiter {
  constructor({
    limit = RATE_LIMIT,
    windowMs = RATE_WINDOW_MS,
    maxKeys = 10_000,
  } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  check(key, now = Date.now()) {
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.entries.size >= this.maxKeys) return false;
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

function clientKey(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const key = forwarded.split(",").at(-1)?.trim();
      if (key) return key.slice(0, 64);
    }
    const real = request.headers["x-real-ip"];
    if (typeof real === "string" && real.trim()) {
      return real.trim().slice(0, 64);
    }
  }
  return (request.socket.remoteAddress ?? "unknown").slice(0, 64);
}

async function readJson(request, maximumBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error("body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, value, headers = {}) {
  response
    .writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    })
    .end(JSON.stringify(value));
}

function normalizeApiBase(value) {
  const withoutSlash = value.replace(/\/+$/u, "");
  return withoutSlash.endsWith("/api")
    ? withoutSlash.slice(0, -4)
    : withoutSlash;
}

async function postToQueue({
  apiUrl,
  apiKey,
  queueIssueId,
  body,
  fetchImpl,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(
      `${normalizeApiBase(apiUrl)}/api/issues/${queueIssueId}/comments`,
      {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body, resume: true }),
      },
    );
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

export function createFeedbackReceiver({
  apiUrl,
  apiKey,
  queueIssueId = DEFAULT_QUEUE_ISSUE_ID,
  trustProxy = true,
  fetchImpl = fetch,
  idFactory = () => `fb-${randomBytes(8).toString("base64url")}`,
  now = () => Date.now(),
  timeoutMs = 5_000,
  rateLimit = RATE_LIMIT,
  rateWindowMs = RATE_WINDOW_MS,
} = {}) {
  const limiter = new RateLimiter({ limit: rateLimit, windowMs: rateWindowMs });
  const pruneTimer = setInterval(() => limiter.prune(now()), rateWindowMs);
  pruneTimer.unref?.();

  return Object.freeze({
    close() {
      clearInterval(pruneTimer);
    },

    async handle(request, response) {
      if (request.method !== "POST") {
        request.resume();
        sendJson(
          response,
          405,
          { error: "method_not_allowed" },
          { Allow: "POST" },
        );
        return;
      }

      if (!limiter.check(clientKey(request, trustProxy), now())) {
        request.resume();
        sendJson(
          response,
          429,
          { error: "rate_limited" },
          { "Retry-After": String(Math.ceil(rateWindowMs / 1000)) },
        );
        return;
      }

      const contentType = request.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        request.resume();
        sendJson(response, 415, { error: "json_required" });
        return;
      }

      const declaredLength = Number(request.headers["content-length"] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        request.resume();
        sendJson(response, 413, { error: "body_too_large" });
        return;
      }

      let value;
      try {
        value = await readJson(request, MAX_BODY_BYTES);
      } catch (error) {
        sendJson(response, error.code === "BODY_TOO_LARGE" ? 413 : 400, {
          error:
            error.code === "BODY_TOO_LARGE"
              ? "body_too_large"
              : "invalid_json",
        });
        return;
      }

      const validation = validateFeedback(value);
      if (!validation.ok) {
        sendJson(response, 400, { error: "invalid_feedback" });
        return;
      }

      if (!apiUrl || !apiKey || !queueIssueId) {
        sendJson(response, 503, { error: "receiver_unavailable" });
        return;
      }

      const id = idFactory();
      const receivedAt = new Date(now()).toISOString();
      const body = buildQueueComment(validation.report, id, receivedAt);
      let stored = false;
      try {
        stored = await postToQueue({
          apiUrl,
          apiKey,
          queueIssueId,
          body,
          fetchImpl,
          timeoutMs,
        });
      } catch {
        stored = false;
      }

      if (!stored) {
        sendJson(response, 502, { error: "queue_unavailable" });
        return;
      }

      sendJson(response, 200, { id });
    },
  });
}
