import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKLETS, CANONICAL_URL, PENALTY_MS, RUN_MS, advancePage, bookletOrder,
  createGame, currentPage, decide, elapse, retryGame, shareData, shareResult,
  summarize,
} from "../../prototypes/one-more-mark/state.js";

test("six authored five-page booklets expose exactly one or zero open boxes", () => {
  assert.equal(BOOKLETS.length, 6);
  assert.equal(BOOKLETS.every((booklet) => booklet.pages.length === 5), true);
  const pages = BOOKLETS.flatMap((booklet) => booklet.pages);
  assert.equal(pages.length, 30);
  assert.equal(pages.filter((page) => page.incomplete).length, 11);
  for (const page of pages) {
    assert.equal(page.incomplete, page.open >= 0);
    assert.equal(page.open >= -1 && page.open <= 3, true);
  }
});

test("booklet order rotates once per retry and repeats deterministically", () => {
  assert.deepEqual(bookletOrder(0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(bookletOrder(1), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual(bookletOrder(5), [5, 0, 1, 2, 3, 4]);
  assert.deepEqual(bookletOrder(6), bookletOrder(0));
  assert.deepEqual(createGame(2).deck, createGame(2).deck);
});

test("Fill banks marks, Flip grows clean streaks, and inputs are atomic", () => {
  const game = createGame();
  assert.equal(currentPage(game).incomplete, true);
  assert.deepEqual(decide(game, "fill"), {
    action: "fill", correct: true, expected: "fill", penalty: 0,
  });
  assert.equal(game.marks, 1);
  assert.equal(decide(game, "fill"), null, "locked pages reject double input");
  assert.equal(advancePage(game), true);

  assert.equal(currentPage(game).incomplete, false);
  assert.equal(decide(game, "flip").correct, true);
  assert.equal(game.streak, 1);
  assert.equal(game.bestStreak, 1);
  advancePage(game);
  decide(game, "flip");
  assert.equal(game.streak, 2);
  assert.equal(game.bestStreak, 2);
  advancePage(game);
  decide(game, "fill");
  assert.equal(game.marks, 2);
  assert.equal(game.streak, 2, "a correct Fill preserves the clean Flip streak");
});

test("wrong decisions break streaks and remove exactly two seconds", () => {
  const game = createGame();
  decide(game, "fill");
  advancePage(game);
  decide(game, "flip");
  advancePage(game);
  const before = game.timeLeft;
  const outcome = decide(game, "fill");
  assert.equal(outcome.correct, false);
  assert.equal(outcome.penalty, PENALTY_MS);
  assert.equal(game.timeLeft, before - PENALTY_MS);
  assert.equal(game.streak, 0);
});

test("timer reaches a final state at zero and a penalty can end the run", () => {
  const game = createGame();
  elapse(game, RUN_MS - 1);
  assert.equal(game.ended, false);
  assert.equal(game.timeLeft, 1);
  elapse(game, 1);
  assert.equal(game.ended, true);
  assert.equal(game.timeLeft, 0);
  assert.equal(decide(game, "fill"), null);

  const penalized = createGame();
  decide(penalized, "fill");
  advancePage(penalized);
  penalized.timeLeft = 1_500;
  decide(penalized, "fill");
  assert.equal(penalized.ended, true);
  assert.equal(penalized.timeLeft, 0);
});

test("retry resets state without navigation and starts the next booklet", () => {
  const game = createGame();
  decide(game, "fill");
  const retry = retryGame(game);
  assert.equal(retry.run, 1);
  assert.equal(retry.marks, 0);
  assert.equal(retry.timeLeft, RUN_MS);
  assert.equal(currentPage(retry).booklet, 1);
  assert.deepEqual(summarize(retry).order, [1, 2, 3, 4, 5, 0]);
});

test("summary reports neutral marks, best streak, and decision accuracy", () => {
  const game = createGame();
  decide(game, "fill");
  advancePage(game);
  decide(game, "fill");
  assert.deepEqual(summarize(game), {
    marks: 1, available: 1, bestStreak: 0, accuracy: 50,
    decisions: 2, order: [0, 1, 2, 3, 4, 5],
  });
});

test("Web Share is preferred and clipboard is the copy-link fallback", async () => {
  const result = { marks: 9, available: 11 };
  const data = shareData(result);
  assert.deepEqual(data, {
    title: "One More Mark",
    text: "I found 9/11 unfinished marks in 42 seconds on One More Mark. How clean is your final scan?",
    url: CANONICAL_URL,
  });

  let shared;
  assert.equal(await shareResult(result, { share: async (value) => { shared = value; } }), "shared");
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

test("copy fallback reports success only after a callable write resolves", async () => {
  const result = { marks: 4, available: 6 };
  assert.equal(await shareResult(result, {}), "failed");
  assert.equal(await shareResult(result, { clipboard: {} }), "failed");
  assert.equal(await shareResult(result, {
    clipboard: { writeText: "not callable" },
  }), "failed");
  assert.equal(await shareResult(result, {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  }), "failed");

  let fallbackText;
  assert.equal(await shareResult(result, {
    share: async () => { throw new Error("share unavailable"); },
    clipboard: { writeText: async (value) => { fallbackText = value; } },
  }), "copied");
  assert.equal(fallbackText, `${shareData(result).text}\n${CANONICAL_URL}`);

  let wroteAfterCancel = false;
  assert.equal(await shareResult(result, {
    share: async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); },
    clipboard: { writeText: async () => { wroteAfterCancel = true; } },
  }), "cancelled");
  assert.equal(wroteAfterCancel, false);
});
