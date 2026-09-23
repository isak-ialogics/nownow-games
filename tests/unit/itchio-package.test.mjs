import assert from "node:assert/strict";
import test from "node:test";

import {
  buildItchioPortalFiles,
  canonicalText,
  createDeterministicZip,
  readDeterministicZip,
} from "../../scripts/package-itchio.mjs";

test("itch.io source text is canonical across platform line endings", () => {
  const canonical = Buffer.from("first\nsecond\n");
  assert.deepEqual(canonicalText(Buffer.from("first\r\nsecond\r\n")), canonical);
  assert.deepEqual(canonicalText(canonical), canonical);
});

test("itch.io package is deterministic, root-flat, local-only, and source-marked", async () => {
  const first = await buildItchioPortalFiles();
  const second = await buildItchioPortalFiles();
  assert.deepEqual([...first.files.keys()].sort(), [
    "game.js", "index.html", "input.js", "source.json", "state.js", "style.css",
  ]);
  const zip = createDeterministicZip(first.files);
  assert.deepEqual(zip, createDeterministicZip(second.files));
  assert.deepEqual(
    [...readDeterministicZip(zip)],
    [...first.files].sort(([left], [right]) => left.localeCompare(right)),
  );

  const index = first.files.get("index.html").toString("utf8");
  const game = first.files.get("game.js").toString("utf8");
  const state = first.files.get("state.js").toString("utf8");
  const style = first.files.get("style.css").toString("utf8");
  const marker = JSON.parse(first.files.get("source.json"));
  assert.match(index, /name="nownow-portal" content="itchio"/u);
  assert.match(index, /name="nownow-telemetry" content="none"/u);
  assert.doesNotMatch(index, /https?:\/\/|canonical|analytics|feedback/u);
  assert.match(game, /from "\.\/input\.js"/u);
  assert.doesNotMatch(game, /trackGameEvent|analytics/u);
  assert.doesNotMatch(state, /https?:\/\//u);
  assert.match(style, /min-width:48px/u);
  assert.equal(marker.portal, "itchio");
  assert.equal(marker.telemetry, "none");
  assert.equal(marker.ownedSourceCommit, "48e24d237a1adc56fb29bdfd37bc82acf78680f3");
  assert.equal(Object.keys(marker.ownedSourceFiles).length, 5);
  assert.ok(Object.values(marker.ownedSourceFiles).every((hash) => /^sha256:[a-f0-9]{64}$/u.test(hash)));
});

test("itch.io ZIP reader rejects altered package bytes", async () => {
  const { files } = await buildItchioPortalFiles();
  const zip = createDeterministicZip(files);
  zip[40] ^= 0xff;
  assert.throws(() => readDeterministicZip(zip), /corrupt entry/u);
});
