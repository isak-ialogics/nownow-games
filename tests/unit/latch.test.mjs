import assert from "node:assert/strict";
import test from "node:test";

import {
  COOLDOWN_MS,
  CUE_PLAN,
  END_WINDOW_MS,
  MAX_RUN_MS,
  START_WINDOW_MS,
  advanceRun,
  createRun,
  createSchedule,
  latchDoor,
  summarizeRun,
} from "../../prototypes/latch/state.js";

test("cue schedule is deterministic, bounded, and shrinks to 550ms", () => {
  assert.deepEqual(createSchedule(), CUE_PLAN);
  assert.equal(CUE_PLAN[0].window, START_WINDOW_MS);
  assert.equal(CUE_PLAN.at(-1).window, END_WINDOW_MS);
  assert.ok(CUE_PLAN.at(-1).endsAt < MAX_RUN_MS);
  assert.ok(MAX_RUN_MS <= 60000);

  for (const cue of CUE_PLAN) {
    const overlap = CUE_PLAN.filter(
      (item) => item.at <= cue.at && item.endsAt > cue.at,
    ).length;
    assert.ok(overlap <= 2, "more than two cues overlap at " + cue.at);
    assert.notEqual(cue.door, cue.shadow);
  }
});

test("timely latches are the only action that scores and cap at 3x", () => {
  const slots = CUE_PLAN.filter(
    (cue, index) => index === 0 || cue.slot !== CUE_PLAN[index - 1].slot,
  ).slice(0, 4);
  let run = createRun();
  const multipliers = [];
  for (const cue of slots) {
    const outcome = latchDoor(advanceRun(run, cue.at), cue.door, cue.at + 100);
    assert.equal(outcome.event, "latched");
    assert.ok(outcome.points > 0);
    multipliers.push(outcome.multiplier);
    run = outcome.run;
  }
  assert.deepEqual(multipliers, [1, 2, 3, 3]);
  assert.equal(run.hits, 4);
  assert.equal(run.streak, 4);
});

test("a false shadow scores zero and enforces the 400ms cooldown", () => {
  const cue = CUE_PLAN[0];
  let run = advanceRun(createRun(), cue.at);
  const wrong = latchDoor(run, cue.shadow, cue.at);
  assert.equal(wrong.event, "false-alarm");
  assert.equal(wrong.run.score, 0);
  assert.equal(wrong.run.falseAlarms, 1);
  assert.equal(wrong.run.cooldownUntil, cue.at + COOLDOWN_MS);
  assert.equal(wrong.run.active.length, 1);

  const blocked = latchDoor(wrong.run, cue.door, cue.at + 200);
  assert.equal(blocked.event, "cooldown");
  assert.equal(blocked.run.score, 0);
  const recovered = latchDoor(wrong.run, cue.door, cue.at + COOLDOWN_MS + 1);
  assert.equal(recovered.event, "latched");
  assert.ok(recovered.run.score > 0);
});

test("three missed early warnings consume the parcels and finish the run", () => {
  let run = createRun();
  for (const cue of CUE_PLAN.slice(0, 3)) {
    run = advanceRun(run, cue.endsAt);
  }
  assert.equal(run.parcels, 0);
  assert.equal(run.misses, 3);
  assert.equal(run.streak, 0);
  assert.equal(run.finished, true);
});

test("result summary is stable and retry state is clean", () => {
  const fresh = createRun();
  assert.deepEqual(summarizeRun(fresh), {
    score: 0,
    hits: 0,
    misses: 0,
    falseAlarms: 0,
    parcels: 3,
    secured: true,
  });
  assert.deepEqual(createRun(), fresh);
});
