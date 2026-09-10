import assert from "node:assert/strict";
import test from "node:test";

import {
  countUrl,
  initAnalytics,
  visitorType,
} from "../../shared/analytics.js";

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

test("canonical game route initializes the unchanged event counters", (t) => {
  const originalFetch = globalThis.fetch;
  const originalMutationObserver = globalThis.MutationObserver;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.MutationObserver = originalMutationObserver;
  });

  const requests = [];
  const listeners = new Map();
  const result = { hidden: true };
  let observeOptions;
  let mutationCallback;
  globalThis.fetch = (url, options) => {
    requests.push({ options, url });
    return Promise.resolve();
  };
  globalThis.MutationObserver = class {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe(target, options) {
      assert.equal(target, result);
      observeOptions = options;
    }
  };

  const button = (selector) => ({
    addEventListener(type, callback) {
      listeners.set(`${selector}:${type}`, callback);
    },
  });
  const nodes = new Map([
    [
      '[rel="canonical"]',
      { href: "https://nownowgames.co.za/games/before-midnight/" },
    ],
    ["#result-card", result],
    ["#retry", button("#retry")],
    ["#share-best", button("#share-best")],
  ]);
  const document = {
    title: "Before Midnight | NowNow Games",
    querySelector: (selector) => nodes.get(selector),
  };
  const window = {
    localStorage: { getItem: () => "0" },
    location: { href: "https://dev.invalid/ignored" },
  };

  initAnalytics(document, window);
  listeners.get("#retry:click")();
  listeners.get("#share-best:click")();
  result.hidden = false;
  mutationCallback();

  assert.deepEqual(observeOptions, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  assert.deepEqual(
    requests.map(({ url }) =>
      new URL(url, "https://nownowgames.co.za").searchParams.get("p"),
    ),
    [
      "/games/before-midnight/",
      "/event/before-midnight/play-started/new",
      "/event/before-midnight/play-started/new",
      "/event/before-midnight/share-triggered/new",
      "/event/before-midnight/play-completed/new",
    ],
  );
  for (const { options } of requests) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
  }
});
