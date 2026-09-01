import assert from "node:assert/strict";
import test from "node:test";

import {
  CRAFT_RADIUS,
  FOLLOW_DELAY_MS,
  GATES,
  MAX_MULTIPLIER,
  ROOF_Y,
  ROUTE_MS,
  ROUTE_SEED,
  TUTORIAL_MS,
  awardGate,
  corridorAt,
  createGame,
  createRoute,
  setHeld,
  summarize,
  updateGame,
} from "../../prototypes/safe-passage/state.js";

test("seeded gates are repeatable, phased, and wholly above the exclusion zone", () => {
  assert.deepEqual(createRoute(), createRoute(ROUTE_SEED));
  assert.notDeepEqual(createRoute(), createRoute(ROUTE_SEED + 1));
  assert.equal(corridorAt(0).half, 0.2);
  assert.equal(corridorAt(20000).half, 0.17);
  assert.equal(corridorAt(40000).half, 0.13);
  for (const gate of GATES) {
    const band = corridorAt(gate.at);
    assert.ok(gate.center + gate.half < ROOF_Y);
    assert.ok(Math.abs(gate.center - band.center) + gate.half <= band.half);
  }
  assert.equal(ROUTE_MS + TUTORIAL_MS, 53000);
});

test("the follower applies the same control after exactly 350 ms", () => {
  const game = createGame();
  setHeld(game, true);
  updateGame(game, FOLLOW_DELAY_MS - 10);
  assert.ok(game.leadY < 0.44);
  assert.ok(game.followerY > 0.44);
  const before = game.followerY;
  updateGame(game, 30);
  assert.ok(game.followerY < before);
});

function advance(game, duration, frame) {
  let remaining = duration;
  while (remaining > 0 && !game.ended) {
    const delta = Math.min(frame, remaining);
    updateGame(game, delta);
    remaining -= delta;
  }
}

function play(frame) {
  const game = createGame();
  for (const [held, duration] of [[true, 900], [false, 700], [true, 600], [false, 500], [true, 800]]) {
    setHeld(game, held);
    advance(game, duration, frame);
  }
  return game;
}

test("fixed-step motion and scoring are frame-rate independent", () => {
  const fast = play(10);
  const slow = play(137);
  for (const field of ["elapsed", "leadY", "followerY", "score", "safeTime", "gateIndex"]) {
    assert.equal(slow[field], fast[field], field);
  }
});

test("only both-green time scores and roofline contact ends immediately", () => {
  const safe = createGame();
  updateGame(safe, 100);
  assert.equal(safe.score, 1);

  const low = createGame();
  low.leadY = low.followerY = 0.74;
  updateGame(low, 100);
  assert.equal(low.score, 0);
  low.leadY = ROOF_Y - CRAFT_RADIUS;
  updateGame(low, 10);
  assert.equal(low.ended, true);
  assert.equal(low.reason, "roofline");
  assert.equal(summarize(low).breaches, 1);
});

test("clean gates raise a capped multiplier and a miss removes it", () => {
  const game = createGame();
  for (let index = 0; index < 10; index += 1) awardGate(game, true);
  assert.equal(game.multiplier, MAX_MULTIPLIER);
  assert.equal(game.gatesCleared, 10);
  assert.ok(game.score > 200);
  awardGate(game, false);
  assert.equal(game.chain, 0);
  assert.equal(game.multiplier, 1);
});

test("a disciplined route lasts 50 seconds and a retry is clean", () => {
  const game = createGame();
  while (!game.ended) {
    const target = corridorAt(game.elapsed + FOLLOW_DELAY_MS / 2).center;
    setHeld(game, game.leadY > target);
    updateGame(game, 20);
  }
  assert.equal(game.reason, "complete");
  assert.equal(game.elapsed, ROUTE_MS);
  assert.ok(summarize(game).formation > 70);
  assert.deepEqual(createGame(), createGame());
});
