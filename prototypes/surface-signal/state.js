export const CUE_MS = 1_200;
export const CHOICE_END_MS = 3_500;
export const REVEAL_AT_MS = 5_200;
export const ROUND_MS = 7_000;
export const RUN_MS = 42_000;
export const SECTOR_COUNT = 5;

export const CUES = (
  [
    [1, 2, 3, [2, 3]],
    [4, -2, 2, [3, 2]],
    [0, 1, 1, [0, 1]],
    [3, -1, 2, [3, 2]],
    [1, -1, 0, [1, 0]],
    [2, 2, 4, [3, 4]],
  ].map(([plumeSector, wakeDirection, answerSector, revealFrames]) =>
    ({ plumeSector, wakeDirection, answerSector, revealFrames }),
  )
);

const BEST_KEY = "nownow-surface-signal-best-v1";
const EARLY_KEY = "nownow-surface-signal-early-v1";
const PLAYED_KEY = "nownow-surface-signal-played-v1";
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function safeGameStorage(target = globalThis) {
  try {
    return target?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createGame() {
  return {
    time: 0,
    cue: 0,
    guess: null,
    call: null,
    scored: false,
    score: 0,
    streak: 0,
    correct: 0,
    early: 0,
    trace: [],
    ended: false,
  };
}

export function phaseAt(g) {
  if (g.ended) return "result";
  const local = g.time - g.cue * ROUND_MS;
  if (local < CUE_MS) return "cue";
  if (local < CHOICE_END_MS) return "choose";
  if (local < REVEAL_AT_MS) return "quiet";
  return "reveal";
}

export function confidenceAt(t) {
  const progress =
    (clamp(t, CUE_MS, CHOICE_END_MS) - CUE_MS) /
    (CHOICE_END_MS - CUE_MS);
  return Math.round(25 * (1 - progress));
}

export function commitGuess(g, s) {
  if (
    phaseAt(g) !== "choose" ||
    g.guess !== null ||
    !Number.isInteger(s) ||
    s < 0 ||
    s >= SECTOR_COUNT
  ) {
    return false;
  }
  g.guess = s;
  g.call = g.time - g.cue * ROUND_MS;
  return true;
}

function resolveCue(g) {
  const cue = CUES[g.cue];
  const correct = g.guess === cue.answerSector;
  const confidence = correct ? confidenceAt(g.call) : 0;
  const streakBonus = correct ? g.streak * 10 : 0;
  const points = correct ? 50 + confidence + streakBonus : 0;
  if (correct) {
    g.correct += 1;
    g.streak += 1;
    if (confidence >= 15) g.early += 1;
  } else g.streak = 0;
  g.score += points;
  g.trace.push(
    ({
      cue: g.cue,
      guess: g.guess,
      answer: cue.answerSector,
      correct,
      confidence,
      streakBonus,
      points,
    }),
  );
  g.scored = true;
}

function nextCue(g) {
  if (g.cue === CUES.length - 1) {
    g.ended = true;
    g.time = RUN_MS;
    return;
  }
  g.cue += 1;
  g.guess = null;
  g.call = null;
  g.scored = false;
}

export function updateGame(g, d) {
  let target = Math.min(
    RUN_MS,
    g.time + Math.max(0, Number(d) || 0),
  );
  while (!g.ended && g.time < target) {
    const start = g.cue * ROUND_MS;
    const milestone = g.scored ? start + ROUND_MS : start + REVEAL_AT_MS;
    g.time = Math.min(target, milestone);
    if (!g.scored && g.time >= start + REVEAL_AT_MS) resolveCue(g);
    if (g.time >= start + ROUND_MS) nextCue(g);
  }
  return g;
}

export function summarize(g) {
  return ({
    score: g.score,
    correct: g.correct,
    early: g.early,
    durationMs: g.time,
    trace: [...g.trace],
  });
}

export function readBest(storage) {
  try {
    return ({
      correct: clamp(Number(storage?.getItem(BEST_KEY)) || 0, 0, CUES.length),
      early: clamp(Number(storage?.getItem(EARLY_KEY)) || 0, 0, CUES.length),
    });
  } catch {
    return ({ correct: 0, early: 0 });
  }
}

export function saveBest(storage, result) {
  const previous = readBest(storage);
  const best = {
    correct: Math.max(previous.correct, result.correct),
    early: Math.max(previous.early, result.early),
  };
  try {
    storage?.setItem(BEST_KEY, String(best.correct));
    storage?.setItem(EARLY_KEY, String(best.early));
  } catch {
    return previous;
  }
  return best;
}

export function clearBest(storage) {
  try {
    storage?.removeItem(BEST_KEY);
    storage?.removeItem(EARLY_KEY);
  } catch {}
  return readBest(storage);
}

export function markPlayed(storage) {
  try {
    storage?.setItem(PLAYED_KEY, '1');
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function createShareData(result, url) {
  return ({
    title: "Surface Signal",
    text: `I read ${result.correct}/6 Surface Signals · ${result.early} early calls.`,
    url,
  });
}
