export const ROUND_MS = 7_000;
export const COMMIT_MS = 2_000;
export const DEADLINE_MS = 3_800;
export const VERDICT_MS = 6_200;
export const RUN_MS = 42_000;
export const STORAGE_KEY = "nownow-one-lucky-bloom-best-v1";

export const CUES = [
  [3, -1, 0, 0, [3, 2, 2, 2]],
  [2, 1, 1, -1, [2, 3, 4, 3]],
  [4, -1, -1, -1, [4, 3, 2, 1]],
  [2, 1, 1, 1, [2, 3, 4, 5]],
  [5, -1, -1, 1, [5, 4, 3, 4]],
  [1, 1, 0, 1, [1, 2, 2, 3]],
].map(([start, upper, wind, lower, nodes]) => ({
  start, upper, wind, lower, nodes,
  landing: start + upper + wind + lower,
}));

export const DEFAULT_RECORD = {
  version: 1,
  bestScore: 0,
  bestCatches: 0,
  playsCompleted: 0,
  tutorialSeen: false,
  soundEnabled: false,
  reduceMotionOverride: null,
};

const copyDefault = () => ({ ...DEFAULT_RECORD });
const integer = (value, low, high = Infinity) =>
  Number.isInteger(value) && value >= low && value <= high;

export function validCues(rows = CUES) {
  return Array.isArray(rows) && rows.length === 6 && rows.every((cue) =>
    integer(cue.start, 1, 5) &&
    [cue.upper, cue.wind, cue.lower].every((move) => [-1, 0, 1].includes(move)) &&
    Array.isArray(cue.nodes) && cue.nodes.length === 4 && cue.nodes.every((lane) => integer(lane, 1, 5)) &&
    cue.nodes[0] === cue.start && cue.nodes.at(-1) === cue.landing &&
    cue.landing >= 1 && cue.landing <= 5
  );
}

export function timingBonus(localMs) {
  if (localMs < COMMIT_MS) return 0;
  if (localMs >= COMMIT_MS && localMs < 2_600) return 40;
  if (localMs < 3_200) return 25;
  if (localMs < DEADLINE_MS) return 10;
  return 0;
}

export function timingTier(localMs) {
  return localMs < 2_600 ? "A" : localMs < 3_200 ? "B" : localMs < DEADLINE_MS ? "C" : "auto";
}

export function resultBand(score) {
  if (score === 600) return "Full page of luck";
  if (score >= 540) return "Purple instinct";
  if (score >= 400) return "Branch reader";
  if (score >= 200) return "Wind watcher";
  return "Still reading the branches";
}

export function createGame() {
  return {
    time: 0, round: 0, choice: 3, locked: null, lockAt: null,
    resolved: false, score: 0, catches: 0, trace: [], ended: false,
  };
}

export function phaseAt(game) {
  if (game.ended) return "result";
  const local = game.time - game.round * ROUND_MS;
  if (local < 800) return "start";
  if (local < 1_600) return "branch";
  if (local < COMMIT_MS) return "wind";
  if (local < DEADLINE_MS) return "commit";
  if (local < VERDICT_MS) return "fall";
  return "verdict";
}

export function selectLane(game, lane) {
  if (game.ended || game.locked !== null || !integer(lane, 1, 5)) return false;
  game.choice = lane;
  return true;
}

export function commitLane(game) {
  const local = game.time - game.round * ROUND_MS;
  if (local < COMMIT_MS || local >= DEADLINE_MS || game.locked !== null) return false;
  game.locked = game.choice;
  game.lockAt = local;
  return true;
}

function autoLock(game) {
  if (game.locked === null) {
    game.locked = game.choice;
    game.lockAt = DEADLINE_MS;
  }
}

function resolveRound(game) {
  if (game.resolved) return;
  const cue = CUES[game.round];
  const caught = game.locked === cue.landing;
  const points = caught ? 60 + timingBonus(game.lockAt) : 0;
  game.score += points;
  if (caught) game.catches += 1;
  game.trace.push({
    round: game.round + 1, chosen: game.locked, landing: cue.landing,
    caught, tier: timingTier(game.lockAt), points,
  });
  game.resolved = true;
}

function nextRound(game) {
  if (game.round === CUES.length - 1) {
    game.ended = true;
    game.time = RUN_MS;
    return;
  }
  game.round += 1;
  game.choice = 3;
  game.locked = null;
  game.lockAt = null;
  game.resolved = false;
}

export function updateGame(game, deltaMs) {
  const target = Math.min(RUN_MS, game.time + Math.max(0, Number(deltaMs) || 0));
  while (!game.ended && game.time < target) {
    const start = game.round * ROUND_MS;
    const milestone = game.locked === null
      ? start + DEADLINE_MS
      : !game.resolved ? start + VERDICT_MS : start + ROUND_MS;
    game.time = Math.min(target, milestone);
    if (game.time >= start + DEADLINE_MS) autoLock(game);
    if (game.time >= start + VERDICT_MS) resolveRound(game);
    if (game.time >= start + ROUND_MS) nextRound(game);
  }
  return game;
}

export function summarize(game) {
  return {
    score: game.score,
    catches: game.catches,
    fullPage: game.catches === 6,
    durationMs: game.time,
    trace: [...game.trace],
  };
}

function validRecord(value) {
  return value?.version === 1 && integer(value.bestScore, 0, 600) &&
    integer(value.bestCatches, 0, 6) && integer(value.playsCompleted, 0) &&
    typeof value.tutorialSeen === "boolean" && typeof value.soundEnabled === "boolean" &&
    (value.reduceMotionOverride === null || typeof value.reduceMotionOverride === "boolean");
}

export function readRecord(storage) {
  if (!storage) return { record: copyDefault(), available: false };
  let raw;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return { record: copyDefault(), available: false }; }
  if (raw === null) return { record: copyDefault(), available: true };
  try {
    const value = JSON.parse(raw);
    return { record: validRecord(value) ? { ...value } : copyDefault(), available: true };
  } catch { return { record: copyDefault(), available: true }; }
}

export function writeRecord(storage, record) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(record)); return Boolean(storage); }
  catch { return false; }
}

export function completeRecord(storage, previous, result) {
  const record = { ...previous, playsCompleted: previous.playsCompleted + 1, tutorialSeen: true };
  const newBest = result.score > previous.bestScore;
  const matchedBest = previous.playsCompleted > 0 && result.score === previous.bestScore;
  if (newBest) {
    record.bestScore = result.score;
    record.bestCatches = result.catches;
  }
  return { record, newBest, matchedBest, available: writeRecord(storage, record) };
}

export function clearRecord(storage) {
  try { storage?.removeItem(STORAGE_KEY); return Boolean(storage); }
  catch { return false; }
}

export function createShareText(result) {
  const ledger = result.trace.map((mark) => mark.caught ? "✓" : "·").join("");
  return `One Lucky Bloom — ${result.score}/600\nLuck ledger: ${ledger} (${result.catches}/6)\nCan you read the branches and lock in earlier?\nhttps://nownowgames.co.za/games/one-lucky-bloom/`;
}
