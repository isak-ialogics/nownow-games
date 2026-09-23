import assert from "node:assert/strict";
import test from "node:test";

import {
  CHOICE_END_MS,
  CUES,
  CUE_MS,
  ROUND_MS,
  RUN_MS,
  clearBest,
  commitGuess,
  confidenceAt,
  createGame,
  createShareData,
  markPlayed,
  phaseAt,
  readBest,
  safeGameStorage,
  saveBest,
  summarize,
  updateGame,
} from "../../prototypes/surface-signal/state.js";

function playCue(game, guess, commitAt = CUE_MS) {
  const local = game.time - game.cue * ROUND_MS;
  updateGame(game, commitAt - local);
  assert.equal(commitGuess(game, guess), true);
  updateGame(game, ROUND_MS - commitAt);
}

test("all six authored wakes map visibly and safely to their answer sector", () => {
  assert.equal(CUES.length, 6);
  for (const cue of CUES) {
    assert.equal(cue.plumeSector + cue.wakeDirection, cue.answerSector);
    assert.ok(cue.answerSector >= 0 && cue.answerSector < 5);
    assert.deepEqual(cue.revealFrames.at(-1), cue.answerSector);
  }
});

test("phase boundaries make exactly six seven-second cues in 42 seconds", () => {
  const game = createGame();
  assert.equal(phaseAt(game), "cue");
  updateGame(game, CUE_MS);
  assert.equal(phaseAt(game), "choose");
  updateGame(game, CHOICE_END_MS - CUE_MS);
  assert.equal(phaseAt(game), "quiet");
  updateGame(game, RUN_MS - CHOICE_END_MS);
  assert.equal(game.ended, true);
  assert.equal(game.time, 42_000);
  assert.equal(game.trace.length, 6);
  assert.equal(phaseAt(game), "result");
});

test("correct calls earn base, confidence, and current-streak bonuses", () => {
  const game = createGame();
  playCue(game, CUES[0].answerSector);
  assert.deepEqual(game.trace[0], {
    cue: 0,
    guess: 3,
    answer: 3,
    correct: true,
    confidence: 25,
    streakBonus: 0,
    points: 75,
  });
  playCue(game, CUES[1].answerSector);
  assert.equal(game.trace[1].points, 85);
  playCue(game, 0);
  assert.equal(game.trace[2].points, 0);
  assert.equal(game.streak, 0);
  playCue(game, CUES[3].answerSector);
  assert.equal(game.trace[3].points, 75);
});

test("a perfect early run is deterministic and scores 600", () => {
  const game = createGame();
  for (const cue of CUES) playCue(game, cue.answerSector);
  assert.deepEqual(summarize(game), {
    score: 600,
    correct: 6,
    early: 6,
    durationMs: 42_000,
    trace: game.trace,
  });
  assert.equal(confidenceAt(CHOICE_END_MS - 1), 0);
  assert.deepEqual(createGame(), createGame());
});

test("calls lock once, ignore invalid timing, and a miss does not score", () => {
  const game = createGame();
  assert.equal(commitGuess(game, 3), false);
  updateGame(game, CUE_MS);
  assert.equal(commitGuess(game, -1), false);
  assert.equal(commitGuess(game, 4), true);
  assert.equal(commitGuess(game, 3), false);
  updateGame(game, ROUND_MS - CUE_MS);
  assert.equal(game.score, 0);
  assert.equal(game.trace[0].correct, false);
});

test("best reads persist defensively and sharing stays bounded", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.deepEqual(saveBest(storage, { correct: 4, early: 2 }), {
    correct: 4,
    early: 2,
  });
  assert.deepEqual(saveBest(storage, { correct: 3, early: 5 }), {
    correct: 4,
    early: 5,
  });
  assert.deepEqual(clearBest({
    getItem: storage.getItem,
    removeItem: (key) => values.delete(key),
  }), { correct: 0, early: 0 });
  assert.deepEqual(readBest({ getItem: () => { throw new Error("blocked"); } }), {
    correct: 0,
    early: 0,
  });
  const target = { localStorage: storage };
  assert.equal(safeGameStorage(target), storage);
  assert.equal(
    safeGameStorage({ get localStorage() { throw new Error("denied"); } }),
    null,
  );
  assert.equal(markPlayed(storage), true);
  assert.equal(values.get("nownow-surface-signal-played-v1"), "1");
  assert.equal(markPlayed({ setItem() { throw new Error("quota"); } }), false);
  assert.equal(markPlayed(null), false);
  assert.deepEqual(
    createShareData(
      { correct: 5, early: 3 },
      "https://nownowgames.co.za/prototypes/surface-signal/",
    ),
    {
      title: "Surface Signal",
      text: "I read 5/6 Surface Signals · 3 early calls.",
      url: "https://nownowgames.co.za/prototypes/surface-signal/",
    },
  );
});
