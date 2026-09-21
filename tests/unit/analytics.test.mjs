import assert from "node:assert/strict";
import test from "node:test";

import {
  countUrl,
  initAnalytics,
  trackGameEvent,
  visitorType,
} from "../../shared/analytics.js";

function pathOf(url) {
  return new URL(url, "https://nownowgames.co.za").searchParams.get("p");
}

function fixture(path, { readyState = "complete", storage = { getItem: () => "0" }, title = "Latch! | NowNow Games", href = "https://dev.invalid/ignored" } = {}) {
  const listeners = new Map();
  const view = { hidden: false };
  const result = { hidden: true };
  const button = (selector) => ({
    addEventListener(type, callback) {
      listeners.set(`${selector}:${type}`, callback);
    },
  });
  const nodes = new Map([
    ['[rel="canonical"]', { href: `https://nownowgames.co.za${path}` }],
    ["#game-panel,#game", view],
    ["#result-card,#result", result],
    ["#retry", button("#retry")],
    ["#share-best,#share-result", button("#share")],
  ]);
  const document = {
    readyState,
    title,
    addEventListener(type, callback) {
      listeners.set(`document:${type}`, callback);
    },
    querySelector: (selector) => nodes.get(selector),
  };
  return {
    document,
    fire: (key) => listeners.get(key)?.(),
    result,
    view,
    window: { localStorage: storage, location: { href } },
  };
}

function stubTransport(t) {
  const originalFetch = globalThis.fetch;
  const originalMutationObserver = globalThis.MutationObserver;
  const requests = [];
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
      assert.ok(target);
      assert.deepEqual(options, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.MutationObserver = originalMutationObserver;
  });
  return { mutate: () => mutationCallback(), requests };
}

test("analytics URLs contain only aggregate, non-identifying fields", () => {
  const pageview = new URL(
    countUrl("/", "NowNow Games", { nonce: "fixed" }),
    "https://nownowgames.co.za",
  );
  assert.equal(pageview.pathname, "/analytics/count");
  assert.deepEqual([...pageview.searchParams.keys()].sort(), ["p", "rnd", "t"]);

  const event = new URL(
    countUrl("/event/latch/play-started/returning", "Latch!: play-started", {
      event: true,
      noSession: true,
      nonce: "fixed",
    }),
    "https://nownowgames.co.za",
  );
  assert.deepEqual([...event.searchParams.keys()].sort(), ["e", "ns", "p", "rnd", "t"]);
  assert.equal(event.searchParams.get("e"), "1");
  assert.equal(event.searchParams.get("ns"), "1");
  for (const excluded of ["q", "r", "s", "score", "user", "visitorId"]) {
    assert.equal(event.searchParams.has(excluded), false);
  }
});

test("returning status is scoped to the current game's own best-score key (NOW-221)", () => {
  let writes = 0;
  const stored = new Map([
    ["nownow-before-midnight-best-v1", "0"],
    ["nownow-same-flame-best-v1", "88"],
    ["nownow-surface-signal-best-v1", "5"],
    ["nownow-one-lucky-bloom-best-v1", JSON.stringify({ version: 1, playsCompleted: 2 })],
  ]);
  const storage = {
    getItem: (key) => stored.get(key),
    setItem() {
      writes += 1;
    },
  };
  // Same Flame has its own positive best → returning for Same Flame.
  assert.equal(visitorType(storage, "same-flame"), "returning");
  assert.equal(visitorType(storage, "surface-signal"), "returning");
  assert.equal(visitorType(storage, "one-lucky-bloom"), "returning");
  // A positive Same Flame best must NOT leak into a first-ever Before Midnight
  // visit (its own key is 0/absent) — this was the cross-game misclassification.
  assert.equal(visitorType(storage, "before-midnight"), "new");
  assert.equal(writes, 0);
  // Games without a persistent best-score key are intentionally always "new".
  assert.equal(visitorType(storage, "latch"), "new");
  assert.equal(visitorType(storage, "safe-passage"), "new");
  assert.equal(visitorType(storage, undefined), "new");
  // Same-game returning still works when only that game's own best is set.
  const bmStored = { getItem: (key) => (key === "nownow-before-midnight-best-v1" ? "12.5" : "0") };
  assert.equal(visitorType(bmStored, "before-midnight"), "returning");
  // Non-positive / non-numeric / throwing storage all fall back to "new".
  assert.equal(visitorType({ getItem: () => "0" }, "same-flame"), "new");
  assert.equal(visitorType({ getItem: () => "not-a-score" }, "same-flame"), "new");
  assert.equal(visitorType({ getItem: () => JSON.stringify({ version: 1, playsCompleted: 0 }) }, "one-lucky-bloom"), "new");
  assert.equal(visitorType({ getItem: () => JSON.stringify({ version: 2, playsCompleted: 2 }) }, "one-lucky-bloom"), "new");
  assert.equal(visitorType({ getItem: () => JSON.stringify({ version: 1, playsCompleted: "2" }) }, "one-lucky-bloom"), "new");
  assert.equal(visitorType({ getItem: () => "not-json" }, "one-lucky-bloom"), "new");
  assert.equal(visitorType({ getItem: () => { throw new Error("blocked storage"); } }, "same-flame"), "new");
});

test("real lifecycle hooks keep historical paths and deduplicate each run", (t) => {
  const { mutate, requests } = stubTransport(t);
  const page = fixture("/games/before-midnight/", {
    storage: { getItem: (key) => key === "nownow-before-midnight-best-v1" ? "12.5" : "0" },
    title: "Before Midnight | NowNow Games",
  });
  initAnalytics(page.document, page.window);
  assert.equal(trackGameEvent("before-midnight", "play-started", page.document), false);
  assert.equal(trackGameEvent("latch", "share-triggered", page.document), false);
  assert.equal(trackGameEvent("before-midnight", "unknown", page.document), false);

  page.view.hidden = true;
  page.result.hidden = false;
  mutate();
  mutate();
  page.fire("#share:click");
  page.fire("#retry:click");
  assert.equal(trackGameEvent("before-midnight", "play-started", page.document), false);

  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/games/before-midnight/",
    "/event/before-midnight/play-started/returning",
    "/event/before-midnight/play-completed/returning",
    "/event/before-midnight/share-triggered/returning",
    "/event/before-midnight/play-started/returning",
  ]);
  for (const { options } of requests) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
  }
});

test("synthetic QA uses a fixed separate audience and waits for an initialized game", (t) => {
  const { requests } = stubTransport(t);
  const page = fixture("/prototypes/safe-passage/", {
    href: "https://dev.invalid/prototypes/safe-passage/?nng_audience=synthetic-qa&name=private",
    readyState: "interactive",
    title: "Safe Passage | NowNow Games",
  });
  initAnalytics(page.document, page.window);
  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/synthetic-qa/prototypes/safe-passage/",
  ]);
  page.fire("document:DOMContentLoaded");
  page.fire("document:DOMContentLoaded");
  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/synthetic-qa/prototypes/safe-passage/",
    "/synthetic-qa/event/safe-passage/play-started/new",
  ]);
  assert.equal(requests.some(({ url }) => url.includes("private")), false);
});
