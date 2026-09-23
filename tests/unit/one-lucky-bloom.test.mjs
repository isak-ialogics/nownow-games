import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CUES, COMMIT_MS, DEADLINE_MS, DEFAULT_RECORD, ROUND_MS, STORAGE_KEY,
  clearRecord, commitLane, completeRecord, createGame, createShareText,
  phaseAt, readRecord, resultBand, selectLane, summarize, timingBonus,
  updateGame, validCues,
} from "../../prototypes/one-lucky-bloom/state.js";

function memory(seed = new Map()) {
  return {
    values: seed,
    getItem: (key) => seed.get(key) ?? null,
    setItem: (key, value) => seed.set(key, value),
    removeItem: (key) => seed.delete(key),
  };
}

function playRound(game, lane, commitAt = COMMIT_MS) {
  assert.equal(selectLane(game, lane), true);
  const local = game.time - game.round * ROUND_MS;
  updateGame(game, commitAt - local);
  assert.equal(commitLane(game), true);
  updateGame(game, ROUND_MS - commitAt);
}

test("six authored cue rows calculate the fixed landing lanes", () => {
  assert.equal(validCues(), true);
  assert.equal(validCues(null), false);
  assert.equal(validCues([{ start: 3, upper: -1, wind: 0, lower: 0 }]), false);
  assert.deepEqual(CUES.map((cue) => cue.landing), [2, 3, 1, 5, 4, 3]);
  for (const cue of CUES) {
    assert.equal(cue.start + cue.upper + cue.wind + cue.lower, cue.landing);
    assert.equal(cue.nodes.at(-1), cue.landing);
    assert.ok(cue.landing >= 1 && cue.landing <= 5);
  }
});

test("commit boundaries award exact bonuses and all misses score zero", () => {
  assert.equal(timingBonus(1_999), 0);
  assert.equal(timingBonus(2_000), 40);
  assert.equal(timingBonus(2_599), 40);
  assert.equal(timingBonus(2_600), 25);
  assert.equal(timingBonus(3_199), 25);
  assert.equal(timingBonus(3_200), 10);
  assert.equal(timingBonus(3_799), 10);
  assert.equal(timingBonus(DEADLINE_MS), 0);

  for (const [at, points] of [[2_000, 100], [2_600, 85], [3_200, 70]]) {
    const game = createGame();
    playRound(game, CUES[0].landing, at);
    assert.equal(game.trace[0].points, points);
  }
  const miss = createGame();
  playRound(miss, 1);
  assert.equal(miss.trace[0].points, 0);
});

test("auto-lock, phase timing, and a perfect 42-second run are deterministic", () => {
  const auto = createGame();
  updateGame(auto, DEADLINE_MS);
  assert.equal(auto.locked, 3);
  assert.equal(auto.lockAt, DEADLINE_MS);
  assert.equal(commitLane(auto), false);
  assert.equal(phaseAt(auto), "fall");

  const game = createGame();
  for (const cue of CUES) playRound(game, cue.landing);
  assert.deepEqual(summarize(game), {
    score: 600,
    catches: 6,
    fullPage: true,
    durationMs: 42_000,
    trace: game.trace,
  });
  assert.equal(game.ended, true);
  assert.deepEqual(createGame(), createGame());
});

test("result bands use exact boundaries and five catches is not a full page", () => {
  assert.equal(resultBand(0), "Still reading the branches");
  assert.equal(resultBand(199), "Still reading the branches");
  assert.equal(resultBand(200), "Wind watcher");
  assert.equal(resultBand(400), "Branch reader");
  assert.equal(resultBand(540), "Purple instinct");
  assert.equal(resultBand(600), "Full page of luck");
  const game = createGame();
  CUES.forEach((cue, index) => playRound(game, index === 5 ? 1 : cue.landing));
  assert.equal(summarize(game).catches, 5);
  assert.equal(summarize(game).fullPage, false);
});

test("storage validates schema, persists strict bests, and clears only its own key", () => {
  const store = memory(new Map([["sibling", "keep"]]));
  assert.deepEqual(readRecord(store), { record: { ...DEFAULT_RECORD }, available: true });
  store.values.set(STORAGE_KEY, "not-json");
  assert.deepEqual(readRecord(store).record, { ...DEFAULT_RECORD });
  store.values.set(STORAGE_KEY, JSON.stringify({ ...DEFAULT_RECORD, version: 2 }));
  assert.deepEqual(readRecord(store).record, { ...DEFAULT_RECORD });

  const first = completeRecord(store, { ...DEFAULT_RECORD }, { score: 500, catches: 5 });
  assert.equal(first.newBest, true);
  assert.equal(first.record.playsCompleted, 1);
  const lower = completeRecord(store, first.record, { score: 400, catches: 6 });
  assert.equal(lower.record.bestScore, 500);
  assert.equal(lower.record.bestCatches, 5);
  const equal = completeRecord(store, lower.record, { score: 500, catches: 5 });
  assert.equal(equal.newBest, false);
  assert.equal(equal.matchedBest, true);
  assert.equal(clearRecord(store), true);
  assert.equal(store.values.get("sibling"), "keep");
  assert.equal(store.values.has(STORAGE_KEY), false);
  assert.equal(readRecord({ getItem() { throw new Error("blocked"); } }).available, false);
});

test("share copy is exact and fixed paths use no randomness or network", async () => {
  const game = createGame();
  for (const cue of CUES) playRound(game, cue.landing);
  assert.equal(createShareText(summarize(game)),
    "One Lucky Bloom — 600/600\nLuck ledger: ✓✓✓✓✓✓ (6/6)\nCan you read the branches and lock in earlier?\nhttps://nownowgames.co.za/games/one-lucky-bloom/");
  const source = await readFile(new URL("../../prototypes/one-lucky-bloom/state.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|fetch\(|XMLHttpRequest|WebSocket/);
});
