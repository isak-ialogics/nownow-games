export const RUN_MS = 36_000;
export const STEP_MS = 20;
export const PULSE_MS = 3_000;
export const MERGE_SYNC = 80;
export const EXPIRY_AT = Date.parse("2026-09-25T00:00:00+02:00");

const LOW = 0.28;
const RANGE = 1 - LOW;
const BEST_KEY = "nownow-same-flame-best-v1";
const clamp = (value, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

export function shouldHoldAt(elapsed) {
  return ((Math.max(0, elapsed) % PULSE_MS) / PULSE_MS) < 0.5;
}

export function targetLevelAt(elapsed) {
  const phase = (Math.max(0, elapsed) % PULSE_MS) / PULSE_MS;
  const wave = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return LOW + RANGE * wave;
}

export function createGame() {
  return {
    elapsed: 0,
    carry: 0,
    held: false,
    target: LOW,
    player: LOW,
    matchArea: 0,
    sync: 100,
    ended: false,
  };
}

export function setHeld(game, held) {
  if (!game.ended) game.held = Boolean(held);
  return game;
}

function step(game) {
  const delta = Math.min(STEP_MS, RUN_MS - game.elapsed);
  const direction = game.held ? 1 : -1;
  game.player = clamp(
    game.player + direction * RANGE * (delta / (PULSE_MS / 2)),
    LOW,
    1,
  );
  game.elapsed += delta;
  game.target = targetLevelAt(game.elapsed);
  game.matchArea += (1 - Math.abs(game.target - game.player)) * delta;
  game.sync = Math.round((game.matchArea / game.elapsed) * 100);
  if (game.elapsed >= RUN_MS) {
    game.ended = true;
    game.held = false;
    game.carry = 0;
  }
}

export function updateGame(game, deltaMs) {
  if (game.ended) return game;
  game.carry += Math.max(0, Number(deltaMs) || 0);
  while (game.carry >= STEP_MS && !game.ended) {
    game.carry -= STEP_MS;
    step(game);
  }
  return game;
}

export function summarize(game) {
  return Object.freeze({
    sync: game.sync,
    merged: game.ended && game.sync >= MERGE_SYNC,
    durationMs: game.elapsed,
  });
}

export function isExpired(now = Date.now()) {
  return Number(now) >= EXPIRY_AT;
}

export function readBest(storage) {
  try {
    const value = Number(storage?.getItem(BEST_KEY));
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveBest(storage, sync) {
  const previous = readBest(storage);
  const best = Math.max(
    previous,
    clamp(Math.round(Number(sync) || 0), 0, 100),
  );
  if (best > previous) {
    try {
      storage?.setItem(BEST_KEY, String(best));
    } catch {
      return previous;
    }
  }
  return best;
}

export function createShareData(sync, url) {
  return Object.freeze({
    title: "Same Flame",
    text: `I found ${clamp(Math.round(sync), 0, 100)}% sync in Same Flame. Bring your rhythm.`,
    url,
  });
}
