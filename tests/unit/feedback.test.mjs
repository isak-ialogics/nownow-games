import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReport,
  MAX_MESSAGE_LENGTH,
  parseAck,
  validateMessage,
} from "../../shared/feedback.js";

test("validateMessage trims, requires content, and enforces the size limit", () => {
  assert.deepEqual(validateMessage("  Something broke  "), {
    ok: true,
    message: "Something broke",
  });
  assert.deepEqual(validateMessage(""), { ok: false, reason: "empty" });
  assert.deepEqual(validateMessage("   "), { ok: false, reason: "empty" });
  assert.deepEqual(validateMessage(undefined), { ok: false, reason: "empty" });
  assert.deepEqual(validateMessage("x".repeat(MAX_MESSAGE_LENGTH)).ok, true);
  assert.deepEqual(validateMessage("x".repeat(MAX_MESSAGE_LENGTH + 1)), {
    ok: false,
    reason: "long",
  });
});

test("buildReport carries only the disclosed, non-identifying fields", () => {
  const report = buildReport({
    message: "The pump stuck on iPhone",
    path: "/games/before-midnight/",
    context: "before-midnight@1",
  });
  assert.deepEqual(Object.keys(report).sort(), ["context", "message", "path"]);
  assert.equal(report.message, "The pump stuck on iPhone");
  assert.equal(report.context, "before-midnight@1");

  const withTech = buildReport({
    message: "Blurry gauge",
    path: "/games/before-midnight/",
    context: "before-midnight@1",
    tech: { ua: "test-agent", viewport: "390x844", lang: "en-ZA" },
  });
  assert.deepEqual(Object.keys(withTech).sort(), [
    "context",
    "message",
    "path",
    "tech",
  ]);
  assert.deepEqual(withTech.tech, {
    ua: "test-agent",
    viewport: "390x844",
    lang: "en-ZA",
  });

  for (const excluded of [
    "email",
    "name",
    "ip",
    "userId",
    "screenshot",
    "cookies",
  ]) {
    assert.equal(excluded in report, false);
    assert.equal(excluded in withTech, false);
  }
});

test("parseAck accepts a short string id and defaults anything else to null", () => {
  assert.deepEqual(parseAck({ id: "abc123" }), { id: "abc123" });
  assert.deepEqual(parseAck({ id: "x".repeat(200) }), { id: "x".repeat(64) });
  assert.deepEqual(parseAck({}), { id: null });
  assert.deepEqual(parseAck(undefined), { id: null });
  assert.deepEqual(parseAck({ id: 12345 }), { id: null });
});
