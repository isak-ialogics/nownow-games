import { promisify } from "node:util";
import {
  brotliCompress,
  constants as zlibConstants,
  gzip,
} from "node:zlib";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

export const BROTLI_OPTIONS = Object.freeze({
  params: Object.freeze({
    [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
  }),
});

export const STATIC_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": [
    "base-uri 'self'",
    "connect-src 'self'",
    "default-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    // JSON-LD is inline on the static pages; no executable inline script exists.
    "script-src 'self' 'unsafe-inline'",
    // Game state updates custom properties through element.style.
    "style-src 'self' 'unsafe-inline'",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function parseAcceptEncoding(value = "") {
  const qualities = new Map();
  for (const part of value.toLowerCase().split(",")) {
    const [name, ...parameters] = part.trim().split(";");
    if (!name) continue;
    const qualityParameter = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("q="));
    const parsed = qualityParameter
      ? Number(qualityParameter.slice(2))
      : 1;
    qualities.set(
      name,
      Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0,
    );
  }
  return qualities;
}

export function selectContentEncoding(value) {
  if (!value) return null;
  const qualities = parseAcceptEncoding(value);
  const wildcard = qualities.get("*");
  const quality = (name) => qualities.get(name) ?? wildcard ?? 0;
  const identity = qualities.get("identity") ?? (wildcard === 0 ? 0 : 1);
  const brotli = quality("br");
  const gzipped = quality("gzip");

  if (brotli > 0 && brotli >= gzipped && brotli >= identity) return "br";
  if (gzipped > 0 && gzipped >= identity) return "gzip";
  return null;
}

export function isCompressible(contentType) {
  return /^(?:application\/(?:javascript|json|xml)|text\/)/u.test(contentType);
}

export async function compressStaticBody(body, encoding) {
  if (encoding === "br") return compressBrotli(body, BROTLI_OPTIONS);
  if (encoding === "gzip") return compressGzip(body, { level: 9 });
  return body;
}
