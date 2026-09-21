const endpoint = "/analytics/count";
const games = new Set([
  "before-midnight",
  "latch",
  "safe-passage",
  "same-flame",
  "surface-signal",
  "one-lucky-bloom",
]);
const actions = new Set([
  "play-started",
  "play-completed",
  "share-triggered",
]);
const trackers = new WeakMap();

export function countUrl(
  path,
  title,
  {
    event = false,
    noSession = false,
    nonce = Math.random().toString(36).slice(2, 7),
  } = {},
) {
  const query = new URLSearchParams({ p: path, t: title, rnd: nonce });
  if (event) query.set("e", "1");
  if (noSession) query.set("ns", "1");
  return `${endpoint}?${query}`;
}

export function visitorType(storage, game) {
  try {
    const value = storage?.getItem(`nownow-${game}-best-v1`);
    if (game === "one-lucky-bloom") {
      const record = JSON.parse(value);
      return record?.version === 1 &&
        typeof record.playsCompleted === "number" &&
        Number.isInteger(record.playsCompleted) &&
        record.playsCompleted > 0
        ? "returning"
        : "new";
    }
    return Number(value) > 0 ? "returning" : "new";
  } catch {
    return "new";
  }
}

function send(path, title, event = false) {
  void fetch(countUrl(path, title, { event, noSession: event }), {
    credentials:"omit",
    keepalive: true,
    referrerPolicy:"no-referrer",
  }).catch(() => {});
}

function audience(windowObject) {
  try {
    return new URL(windowObject.location.href).searchParams.get("nng_audience") ===
      "synthetic-qa"
      ? "/synthetic-qa"
      : "";
  } catch {
    return "";
  }
}

export function trackGameEvent(game, action, documentObject = document) {
  return trackers.get(documentObject)?.(game, action) ?? false;
}

export function initAnalytics(documentObject = document, windowObject = window) {
  const query = (selector) => documentObject.querySelector(selector);
  const path = new URL(
    query('[rel="canonical"]')?.href ?? windowObject.location.href,
  ).pathname;
  const prefix = audience(windowObject);
  send(prefix + path, documentObject.title);

  const game = path.split("/").at(-2);
  if (!games.has(game)) return;

  let storage;
  try {
    storage = windowObject.localStorage;
  } catch {}
  const type = visitorType(storage, game);
  let running = false;

  trackers.set(documentObject, (id, action) => {
    if (id !== game || !actions.has(action)) return false;
    if (action === "play-started") {
      if (running) return false;
      running = true;
    } else if (action === "play-completed") {
      if (!running) return false;
      running = false;
    }
    send(
      `${prefix}/event/${game}/${action}/${type}`,
      `${documentObject.title.split(" | ")[0]}: ${action}`,
      true,
    );
    return true;
  });

  const event = (action) => trackGameEvent(game, action, documentObject);
  const view = query("#game-panel,#game");
  const result = query("#result-card,#result");
  const begin = () => event("play-started");
  const start = () => {
    if (view && !view.hidden) begin();
  };
  if (documentObject.readyState === "complete") start();
  else documentObject.addEventListener("DOMContentLoaded", start, { once: true });
  query("#retry")?.addEventListener("click", begin);
  query("#share-best,#share-result")?.addEventListener(
    "click",
    () => event("share-triggered"),
  );
  if (result) {
    new MutationObserver(() => {
      if (!result.hidden) event("play-completed");
    }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
  }
}

if (typeof document !== "undefined") initAnalytics();
