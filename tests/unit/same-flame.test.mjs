import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPIRY_AT,
  MERGE_SYNC,
  PULSE_MS,
  RUN_MS,
  createGame,
  createShareData,
  isExpired,
  readBest,
  saveBest,
  setHeld,
  shouldHoldAt,
  summarize,
  targetLevelAt,
  updateGame,
} from "../../prototypes/same-flame/state.js";

function play(frameMs, strategy) {
  const game = createGame();
  while (!game.ended) {
    setHeld(game, strategy(game.elapsed));
    updateGame(game, Math.min(frameMs, RUN_MS - game.elapsed));
  }
  return game;
}

function advance(game, duration, frameMs) {
  let remaining = duration;
  while (remaining > 0 && !game.ended) {
    const delta = Math.min(frameMs, remaining);
    updateGame(game, delta);
    remaining -= delta;
  }
}

function playMatched(frameMs) {
  const game = createGame();
  for (let pulse = 0; pulse < RUN_MS / PULSE_MS; pulse += 1) {
    setHeld(game, true);
    advance(game, PULSE_MS / 2, frameMs);
    setHeld(game, false);
    advance(game, PULSE_MS / 2, frameMs);
  }
  return game;
}

test("the guide uses a repeatable three-second rise and settle pulse", () => {
  assert.equal(targetLevelAt(0), targetLevelAt(PULSE_MS));
  assert.equal(targetLevelAt(0), 0.28);
  assert.equal(targetLevelAt(PULSE_MS / 2), 1);
  assert.equal(shouldHoldAt(0), true);
  assert.equal(shouldHoldAt(PULSE_MS / 2), false);
});

test("a matched hold/release rhythm lasts 36 seconds and merges above 80%", () => {
  const game = playMatched(20);
  const result = summarize(game);
  assert.equal(result.durationMs, 36_000);
  assert.equal(result.sync, 100);
  assert.equal(result.merged, true);
  assert.equal(MERGE_SYNC, 80);
});

test("fixed-step scoring is independent of uneven render frames", () => {
  const fast = playMatched(20);
  const uneven = playMatched(137);
  assert.deepEqual(summarize(uneven), summarize(fast));
});

test("ignoring the rhythm finishes below the merge threshold and retry is clean", () => {
  const game = play(100, () => false);
  assert.equal(game.ended, true);
  assert.ok(game.sync < MERGE_SYNC);
  assert.deepEqual(createGame(), createGame());
});

test("the expiry begins immediately after Heritage Day in South African time", () => {
  assert.equal(isExpired(EXPIRY_AT - 1), false);
  assert.equal(isExpired(EXPIRY_AT), true);
});

test("best sync uses local storage defensively", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(saveBest(storage, 82), 82);
  assert.equal(saveBest(storage, 60), 82);
  assert.equal(readBest(storage), 82);
  assert.equal(
    readBest({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    0,
  );
});

test("share data is bounded, original, and canonical", () => {
  assert.deepEqual(
    createShareData(
      105,
      "https://nownowgames.co.za/prototypes/same-flame/",
    ),
    {
      title: "Same Flame",
      text: "I found 100% sync in Same Flame. Bring your rhythm.",
      url: "https://nownowgames.co.za/prototypes/same-flame/",
    },
  );
});
