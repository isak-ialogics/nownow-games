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

function fixture(
  path,
  {
    readyState = "complete",
    storage = { getItem: () => null },
    title = "Latch! | NowNow Games",
    href = "https://dev.invalid/ignored",
    explicitStart = false,
  } = {},
) {
  const listeners = new Map();
  const view = {
    hidden: false,
    hasAttribute: (name) => explicitStart && name === "data-explicit-start",
  };
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

test("returning status uses only durable state for the current game", () => {
  let writes = 0;
  const stored = new Map([
    ["nownow-before-midnight-best-v1", "0"],
    ["nownow-same-flame-best-v1", "88"],
    ["nownow-surface-signal-played-v1", "1"],
  ]);
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem() { writes += 1; },
  };

  assert.equal(visitorType(storage, "before-midnight"), "returning");
  assert.equal(visitorType(storage, "same-flame"), "returning");
  assert.equal(visitorType(storage, "surface-signal"), "returning");
  assert.equal(visitorType(storage, "latch"), "new");
  assert.equal(visitorType(storage, "safe-passage"), "new");
  assert.equal(visitorType(storage, undefined), "new");
  assert.equal(writes, 0);

  assert.equal(visitorType({ getItem: () => null }, "same-flame"), "new");
  assert.equal(visitorType({ getItem: () => "not-a-score" }, "same-flame"), "new");
  assert.equal(
    visitorType({ getItem: () => { throw new Error("blocked storage"); } }, "same-flame"),
    "new",
  );
});

test("legacy game lifecycle hooks keep historical paths and deduplicate each run", (t) => {
  const { mutate, requests } = stubTransport(t);
  const page = fixture("/games/before-midnight/", {
    storage: {
      getItem: (key) => key === "nownow-before-midnight-best-v1" ? "12.5" : null,
    },
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

test("legacy games retain their page-load visitor class across retry", (t) => {
  const { mutate, requests } = stubTransport(t);
  const page = fixture("/prototypes/latch/");
  initAnalytics(page.document, page.window);
  page.result.hidden = false;
  mutate();
  page.fire("#retry:click");
  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/prototypes/latch/",
    "/event/latch/play-started/new",
    "/event/latch/play-completed/new",
    "/event/latch/play-started/new",
  ]);
});

test("explicit lifecycle stays paused and bounds every funnel event per run", (t) => {
  const { requests } = stubTransport(t);
  const page = fixture("/prototypes/surface-signal/", {
    explicitStart: true,
    readyState: "interactive",
    title: "Surface Signal | NowNow Games",
  });
  initAnalytics(page.document, page.window);
  page.fire("document:DOMContentLoaded");

  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/prototypes/surface-signal/",
  ]);
  assert.equal(trackGameEvent("surface-signal", "first-input", page.document), false);
  assert.equal(trackGameEvent("surface-signal", "play-completed", page.document), false);
  assert.equal(trackGameEvent("surface-signal", "play-started", page.document), true);
  assert.equal(trackGameEvent("surface-signal", "play-started", page.document), false);

  for (const action of [
    "first-input",
    "round-2-reached",
    "round-4-reached",
    "round-6-reached",
  ]) {
    assert.equal(trackGameEvent("surface-signal", action, page.document), true);
    assert.equal(trackGameEvent("surface-signal", action, page.document), false);
  }
  assert.equal(trackGameEvent("surface-signal", "play-completed", page.document), true);
  assert.equal(trackGameEvent("surface-signal", "play-completed", page.document), false);
  assert.equal(trackGameEvent("surface-signal", "play-started", page.document), true);

  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/prototypes/surface-signal/",
    "/event/surface-signal/play-started/new",
    "/event/surface-signal/first-input/new",
    "/event/surface-signal/round-2-reached/new",
    "/event/surface-signal/round-4-reached/new",
    "/event/surface-signal/round-6-reached/new",
    "/event/surface-signal/play-completed/new",
    "/event/surface-signal/play-started/returning",
  ]);
});

test("throwing localStorage cannot stop lifecycle telemetry", (t) => {
  const { requests } = stubTransport(t);
  const page = fixture("/prototypes/surface-signal/", {
    explicitStart: true,
    title: "Surface Signal | NowNow Games",
  });
  Object.defineProperty(page.window, "localStorage", {
    configurable: true,
    get() { throw new Error("storage denied"); },
  });
  assert.doesNotThrow(() => initAnalytics(page.document, page.window));
  assert.equal(trackGameEvent("surface-signal", "play-started", page.document), true);
  assert.equal(trackGameEvent("surface-signal", "play-completed", page.document), true);
  assert.deepEqual(requests.map(({ url }) => pathOf(url)), [
    "/prototypes/surface-signal/",
    "/event/surface-signal/play-started/new",
    "/event/surface-signal/play-completed/new",
  ]);
});

test("synthetic QA uses a fixed separate audience and waits for an initialized legacy game", (t) => {
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
