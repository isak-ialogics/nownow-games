import assert from "node:assert/strict";
import test from "node:test";

import { countUrl, visitorType } from "../../shared/analytics.js";

test("analytics URLs contain only aggregate, non-identifying fields", () => {
  const pageview = new URL(
    countUrl("/", "NowNow Games", { nonce: "fixed" }),
    "https://nownowgames.co.za",
  );
  assert.equal(pageview.pathname, "/analytics/count");
  assert.deepEqual([...pageview.searchParams.keys()].sort(), ["p", "rnd", "t"]);
  assert.equal(pageview.searchParams.get("p"), "/");

  const event = new URL(
    countUrl(
      "/event/before-midnight/play-started/returning",
      "Before Midnight: play-started",
      { event: true, noSession: true, nonce: "fixed" },
    ),
    "https://nownowgames.co.za",
  );
  assert.deepEqual([...event.searchParams.keys()].sort(), [
    "e",
    "ns",
    "p",
    "rnd",
    "t",
  ]);
  assert.equal(event.searchParams.get("e"), "1");
  assert.equal(event.searchParams.get("ns"), "1");
  for (const excluded of ["q", "r", "s", "score", "user", "visitorId"]) {
    assert.equal(event.searchParams.has(excluded), false);
  }
});

test("returning status reuses the gameplay best without writing storage", () => {
  let writes = 0;
  const storage = {
    getItem(key) {
      assert.equal(key, "nownow-before-midnight-best-v1");
      return "12.5";
    },
    setItem() {
      writes += 1;
    },
  };
  assert.equal(visitorType(storage), "returning");
  assert.equal(writes, 0);
  assert.equal(visitorType({ getItem: () => "0" }), "new");
  assert.equal(visitorType({ getItem: () => "not-a-score" }), "new");
  assert.equal(
    visitorType({
      getItem() {
        throw new Error("blocked storage");
      },
    }),
    "new",
  );
});
