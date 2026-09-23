const endpoint = "/analytics/count";
const games = new Set(
  "before-midnight latch safe-passage same-flame surface-signal".split(" "),
);
const actions = new Set([
  "play-started",
  "first-input",
  "round-2-reached",
  "round-4-reached",
  "round-6-reached",
  "play-completed",
  "share-triggered",
]);
const funnelActions = new Set([
  "first-input",
  "round-2-reached",
  "round-4-reached",
  "round-6-reached",
]);
const trackers = new WeakMap();

export function countUrl(
  path,
  title,
  { event = false, noSession = false, nonce = Math.random().toString(36).slice(2, 7) } = {},
) {
  const query = new URLSearchParams({ p: path, t: title, rnd: nonce });
  if (event) query.set("e", "1");
  if (noSession) query.set("ns", "1");
  return `${endpoint}?${query}`;
}

export function visitorType(storage, game) {
  if (!game) return "new";
  try {
    if (storage?.getItem(`nownow-${game}-played-v1`) === "1") {
      return "returning";
    }
    const best = storage?.getItem(`nownow-${game}-best-v1`);
    return best !== null && best !== undefined && Number.isFinite(Number(best))
      ? "returning"
      : "new";
  } catch {
    return "new";
  }
}

function storageFor(windowTarget) {
  try {
    return windowTarget?.localStorage ?? null;
  } catch {
    return null;
  }
}

function send(path, title, event = false) {
  void fetch(countUrl(path, title, { event, noSession: event }), {
    credentials: "omit",
    keepalive: true,
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}

function audience(windowTarget) {
  try {
    return new URL(windowTarget.location.href).searchParams.get("nng_audience") ===
      "synthetic-qa"
      ? "/synthetic-qa"
      : "";
  } catch {
    return "";
  }
}

export function trackGameEvent(game, action, documentTarget = document) {
  return trackers.get(documentTarget)?.(game, action) ?? false;
}

export function initAnalytics(documentTarget = document, windowTarget = window) {
  const query = (selector) => documentTarget.querySelector(selector);
  const pathname = new URL(
    query('[rel="canonical"]')?.href ?? windowTarget.location.href,
  ).pathname;
  const prefix = audience(windowTarget);
  send(prefix + pathname, documentTarget.title);

  const game = pathname.split("/").at(-2);
  if (!games.has(game)) return;

  const storage = storageFor(windowTarget);
  const title = documentTarget.title.split(" | ")[0];
  const pageType = visitorType(storage, game);
  const dynamicRunType = game === "surface-signal";
  let running = false;
  let completedInSession = false;
  let runType = null;
  const sentThisRun = new Set();

  trackers.set(documentTarget, (id, action) => {
    if (id !== game || !actions.has(action)) return false;

    if (action === "play-started") {
      if (running) return false;
      runType = dynamicRunType
        ? (completedInSession ? "returning" : visitorType(storage, game))
        : pageType;
      running = true;
      sentThisRun.clear();
    } else if (action === "play-completed") {
      if (!running || sentThisRun.has(action)) return false;
      sentThisRun.add(action);
    } else if (funnelActions.has(action)) {
      if (!running || sentThisRun.has(action)) return false;
      sentThisRun.add(action);
    }

    const type = runType ?? (dynamicRunType && completedInSession
      ? "returning"
      : pageType);
    send(`${prefix}/event/${game}/${action}/${type}`, `${title}: ${action}`, true);

    if (action === "play-completed") {
      running = false;
      completedInSession = true;
    }
    return true;
  });

  const event = (action) => trackGameEvent(game, action, documentTarget);
  const view = query("#game-panel,#game");
  const result = query("#result-card,#result");
  const explicitStart = view?.hasAttribute?.("data-explicit-start") ?? false;
  const begin = () => event("play-started");
  const startVisibleGame = () => {
    if (!view?.hidden) begin();
  };

  if (!explicitStart) {
    if (documentTarget.readyState === "complete") startVisibleGame();
    else documentTarget.addEventListener("DOMContentLoaded", startVisibleGame, {
      once: true,
    });
    query("#retry")?.addEventListener("click", begin);
  }

  query("#share-best,#share-result")?.addEventListener("click", () =>
    event("share-triggered"),
  );
  if (result) {
    new MutationObserver(() => {
      if (!result.hidden) event("play-completed");
    }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
  }
}

if (typeof document !== "undefined") initAnalytics();
