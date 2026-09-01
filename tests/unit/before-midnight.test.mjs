import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RUN_MS,
  PRESETS,
  TOTAL_ROUNDS,
  createRun,
  readBest,
  recordRound,
  saveBest,
  scoreSample,
  settleFill,
  summarizeRun,
} from "../../prototypes/before-midnight/state.js";

test("scoring distinguishes safe, near, precision, and overshoot stops", () => {
  assert.equal(scoreSample(70, 10, 100).category, "safe");
  assert.deepEqual(scoreSample(95, 10, 100), {
    category: "near",
    multiplier: 1.2,
    score: 12,
    accuracy: 95,
  });
  assert.equal(scoreSample(98, 10, 100).multiplier, 1.5);
  assert.deepEqual(scoreSample(100.01, 10, 100), {
    category: "overshoot",
    multiplier: 0,
    score: 0,
    accuracy: 0,
  });
});

test("every preset has deterministic, learnable release coast", () => {
  for (let index = 0; index < PRESETS.length; index += 1) {
    const first = settleFill(index, 1500);
    const repeat = settleFill(index, 1500);
    assert.deepEqual(repeat, first);
    assert.equal(first.coastMs, PRESETS[index][4]);
    assert.ok(first.final.spend > first.release.spend);
    assert.ok(first.final.units > first.release.units);
  }
});

test("a run accepts exactly seven fills, summarizes banking, and restarts clean", () => {
  let run = createRun();
  for (let index = 0; index < TOTAL_ROUNDS; index += 1) {
    run = recordRound(run, settleFill(index, index === 6 ? 5000 : 300));
  }
  assert.equal(run.length, 7);
  assert.throws(() => recordRound(run, settleFill(0, 100)), /seven fills/i);

  const summary = summarizeRun(run);
  assert.equal(summary.overshoots, 1);
  assert.ok(summary.totalUnits > 0);
  assert.ok(summary.totalScore > 0);
  assert.deepEqual(createRun(), []);
  assert.ok(MAX_RUN_MS < 60000, `maximum run is ${MAX_RUN_MS}ms`);
});

test("personal best persistence is local, monotonic, and failure-safe", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readBest(storage), 0);
  assert.equal(saveBest(storage, 42.5), 42.5);
  assert.equal(values.size, 1);
  assert.equal([...values.values()][0], "42.5");
  assert.equal(saveBest(storage, 12), 42.5);
  assert.equal(readBest({ getItem: () => "not-a-score" }), 0);
  assert.equal(readBest({ getItem: () => { throw new Error("blocked"); } }), 0);
});
