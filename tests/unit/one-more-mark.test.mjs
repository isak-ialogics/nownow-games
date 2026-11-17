import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKLETS, CANONICAL_URL, PENALTY_MS, RUN_MS, bookletOrder, createGame,
  currentPage, decide, elapse, retryGame, settleDecision, shareData, shareResult,
  summarize,
} from "../../prototypes/one-more-mark/state.js";

test("six deterministic five-page layouts share the two-beat first play", () => {
  assert.equal(BOOKLETS.length, 6);
  for (const booklet of BOOKLETS) {
    assert.equal(booklet.pages.length, 5);
    assert.equal(booklet.pages[0].open, 1, "page 1 always has row 2 empty");
    assert.equal(booklet.pages[1].open, -1, "page 2 is always complete");
    for (const page of booklet.pages) {
      assert.equal(page.incomplete, page.open >= 0);
      assert.equal(page.open >= -1 && page.open <= 3, true);
    }
  }
});

test("booklet order rotates once per retry and repeats deterministically", () => {
  assert.deepEqual(bookletOrder(0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(bookletOrder(1), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual(bookletOrder(5), [5, 0, 1, 2, 3, 4]);
  assert.deepEqual(bookletOrder(6), bookletOrder(0));
  assert.deepEqual(createGame(2).deck, createGame(2).deck);
});

test("timer stays held through both wrong onboarding branches", () => {
  const game = createGame();
  elapse(game, 5_000);
  assert.equal(game.timeLeft, RUN_MS);

  assert.deepEqual(decide(game, 0), {
    action: 0, correct: false, expected: 1, onboarding: true, penalty: 0,
  });
  assert.equal(game.timeLeft, RUN_MS);
  assert.equal(decide(game, 1), null, "input lock rejects a second decision");
  assert.equal(settleDecision(game, false), true);

  assert.deepEqual(decide(game, "complete"), {
    action: "complete", correct: false, expected: 1, onboarding: true, penalty: 0,
  });
  assert.equal(game.timeLeft, RUN_MS);
  settleDecision(game, false);
  elapse(game, 9_000);
  assert.equal(game.timeLeft, RUN_MS);
});

test("row 2 arms the timer, adds one mark, and advances to complete page 2", () => {
  const game = createGame();
  assert.equal(decide(game, 1).correct, true);
  assert.equal(game.timerArmed, true);
  assert.equal(game.marks, 1);
  elapse(game, 250);
  assert.equal(game.timeLeft, RUN_MS - 250);
  assert.equal(settleDecision(game, true), true);
  assert.equal(currentPage(game).page, 1);
  assert.equal(currentPage(game).incomplete, false);
  assert.equal(decide(game, "complete").correct, true);
  assert.equal(game.streak, 1);
});

test("later row and complete decisions apply correctness and a two-second penalty", () => {
  const game = createGame();
  decide(game, 1);
  settleDecision(game, true);
  decide(game, "complete");
  settleDecision(game, true);
  assert.equal(currentPage(game).open, 3);

  const beforeRow = game.timeLeft;
  assert.deepEqual(decide(game, 0), {
    action: 0, correct: false, expected: 3, onboarding: false, penalty: PENALTY_MS,
  });
  assert.equal(game.timeLeft, beforeRow - PENALTY_MS);
  settleDecision(game, false);

  const beforeComplete = game.timeLeft;
  assert.equal(decide(game, "complete").correct, false);
  assert.equal(game.timeLeft, beforeComplete - PENALTY_MS);
  settleDecision(game, false);
  assert.equal(decide(game, 3).correct, true);
  assert.equal(game.marks, 2);
});

test("the post-onboarding penalty floors time at zero and ends the run", () => {
  const game = createGame();
  decide(game, 1);
  settleDecision(game, true);
  decide(game, "complete");
  settleDecision(game, true);
  game.timeLeft = 1_500;
  decide(game, 0);
  assert.equal(game.ended, true);
  assert.equal(game.timeLeft, 0);
  assert.equal(decide(game, 3), null);
});

test("an armed timer reaches a deterministic zero-time result", () => {
  const game = createGame();
  decide(game, 1);
  settleDecision(game, true);
  elapse(game, RUN_MS - 1);
  assert.equal(game.ended, false);
  assert.equal(game.timeLeft, 1);
  elapse(game, 1);
  assert.equal(game.ended, true);
  assert.equal(game.timeLeft, 0);
});

test("one-action retry resets state, holds time, and rotates the booklet", () => {
  const game = createGame();
  decide(game, 1);
  const retry = retryGame(game);
  assert.equal(retry.run, 1);
  assert.equal(retry.marks, 0);
  assert.equal(retry.timerArmed, false);
  assert.equal(retry.timeLeft, RUN_MS);
  assert.equal(currentPage(retry).booklet, 1);
  assert.deepEqual(summarize(retry).order, [1, 2, 3, 4, 5, 0]);
});

test("summary reports neutral marks, streak, and decision accuracy", () => {
  const game = createGame();
  decide(game, 1);
  settleDecision(game, true);
  decide(game, 0);
  assert.deepEqual(summarize(game), {
    marks: 1, available: 1, bestStreak: 0, accuracy: 50,
    decisions: 2, order: [0, 1, 2, 3, 4, 5],
  });
});

test("Web Share is preferred and clipboard remains the user-triggered fallback", async () => {
  const result = { marks: 9, available: 11 };
  const data = shareData(result);
  assert.deepEqual(data, {
    title: "One More Mark",
    text: "I found 9/11 empty answers in 42 seconds on One More Mark. How clean is your final scan?",
    url: CANONICAL_URL,
  });

  let shared;
  assert.equal(await shareResult(result, {
    share: async (value) => { shared = value; },
  }), "shared");
  assert.deepEqual(shared, data);

  let copied;
  assert.equal(await shareResult(result, {
    clipboard: { writeText: async (value) => { copied = value; } },
  }), "copied");
  assert.equal(copied, `${data.text}\n${CANONICAL_URL}`);

  assert.equal(await shareResult(result, {
    share: async () => { throw new Error("unavailable"); },
    clipboard: { writeText: async () => {} },
  }), "copied");
  assert.equal(await shareResult(result, {
    share: async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); },
  }), "cancelled");
});

test("copy fallback reports failure without a callable successful clipboard", async () => {
  const result = { marks: 4, available: 6 };
  assert.equal(await shareResult(result, {}), "failed");
  assert.equal(await shareResult(result, { clipboard: {} }), "failed");
  assert.equal(await shareResult(result, {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  }), "failed");
});
