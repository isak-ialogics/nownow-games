import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAT_MS, CANONICAL_URL, DECISION_MS, DECKS, EARLY_BUFFER_MS,
  MULTIPLIERS, RUN_MS, createGame, cueFor, currentMultiplier, currentPot,
  deckOrder, elapse, fullStop, pauseGame, resumeGame, retryGame, shareData,
  shareResult, summarize,
} from "../../prototypes/last-full-stop/state.js";

test("five deterministic ten-beat papers contain three fair two-beat TIME calls", () => {
  assert.equal(DECKS.length, 5);
  for (const deck of DECKS) {
    assert.equal(deck.phrases.length, 10);
    assert.equal(deck.timeCalls.length, 3);
    assert.equal(new Set(deck.timeCalls).size, 3);
    assert.deepEqual([...deck.timeCalls].sort((a, b) => a - b), deck.timeCalls);
    for (const call of deck.timeCalls) {
      assert.equal(call >= 2 && call < deck.phrases.length, true);
      const game = createGame();
      game.deck = deck;
      game.beatIndex = call - 2;
      assert.deepEqual(cueFor(game), {
        distance: 2, notch: 1, label: "TIME in 2 breaks", state: "two",
      });
      game.beatIndex += 1;
      assert.equal(cueFor(game).label, "TIME next break");
      game.beatIndex += 1;
      assert.equal(cueFor(game).label, "TIME at this break");
    }
  }
  assert.deepEqual(createGame(3), createGame(3));
});

test("paper order rotates on retry and repeats without hidden randomness", () => {
  assert.deepEqual(deckOrder(0), [0, 1, 2, 3, 4]);
  assert.deepEqual(deckOrder(1), [1, 2, 3, 4, 0]);
  assert.deepEqual(deckOrder(4), [4, 0, 1, 2, 3]);
  assert.deepEqual(deckOrder(5), deckOrder(0));
});

test("the held first break visibly offers 12 words at x1.4 for 17", () => {
  const game = createGame();
  assert.equal(game.timerArmed, false);
  assert.equal(game.timeLeft, RUN_MS);
  assert.equal(game.unbankedWords, 12);
  assert.equal(currentMultiplier(game), 1.4);
  assert.equal(currentPot(game), 17);
  assert.equal(cueFor(game).label, "TIME in 2 breaks");
  elapse(game, 9_000);
  assert.equal(game.timeLeft, RUN_MS);
});

test("all four displayed multipliers award the rounded displayed pot", () => {
  const game = createGame();
  game.unbankedWords = 10;
  assert.deepEqual(MULTIPLIERS, [1, 1.4, 1.7, 2.2]);
  const expected = [10, 14, 17, 22];
  for (const [riskLevel, score] of expected.entries()) {
    game.riskLevel = riskLevel;
    assert.equal(currentPot(game), score);
  }
});

test("bank starts the timer, locks one score, and resets only the current pot", () => {
  const game = createGame();
  assert.deepEqual(fullStop(game, "touch"), {
    type: "banked", source: "touch", awarded: 17, words: 12, multiplier: 1.4,
  });
  assert.equal(game.timerArmed, true);
  assert.equal(game.bankedWords, 17);
  assert.equal(game.rawWordsSafe, 12);
  assert.equal(game.biggestSafeSentence, 12);
  assert.equal(game.unbankedWords, 0);
  assert.equal(fullStop(game, "keyboard").type, "duplicate");
  assert.equal(game.bankedWords, 17, "rapid duplicate input cannot score twice");
});

test("late input is neutral and the final 150ms buffer banks the next break", () => {
  const game = createGame();
  fullStop(game);
  elapse(game, DECISION_MS);
  assert.equal(fullStop(game).type, "late");
  assert.equal(game.lastFeedback, "Wait for the break.");
  assert.equal(game.bankedWords, 17);

  elapse(game, BEAT_MS - DECISION_MS - EARLY_BUFFER_MS);
  assert.equal(game.nextBeatIn, EARLY_BUFFER_MS);
  assert.equal(fullStop(game, "keyboard").type, "buffered");
  assert.equal(fullStop(game, "touch").type, "duplicate");
  const phraseWords = game.deck.phrases[1].words;
  elapse(game, EARLY_BUFFER_MS);
  assert.equal(game.beatIndex, 1);
  assert.equal(game.lastOutcome.type, "banked");
  assert.equal(game.lastOutcome.source, "buffer");
  assert.equal(game.bankedWords, 17 + phraseWords);
});

test("TIME strikes only the current unbanked sentence and preserves banked words", () => {
  const game = createGame();
  fullStop(game);
  elapse(game, BEAT_MS);
  elapse(game, DECISION_MS);
  elapse(game, BEAT_MS - DECISION_MS);
  assert.equal(game.beatIndex, 2);
  const exposed = game.deck.phrases[1].words + game.deck.phrases[2].words;
  assert.equal(game.unbankedWords, exposed);
  elapse(game, DECISION_MS);
  assert.equal(game.lastOutcome.type, "time");
  assert.equal(game.bankedWords, 17);
  assert.equal(game.lostWords, exposed);
  assert.equal(game.unbankedWords, 0);
  assert.deepEqual(game.handledTimeCalls, [2]);
});

test("every authored paper completes all three TIME calls and ends at 45 seconds", () => {
  for (let run = 0; run < DECKS.length; run += 1) {
    const game = createGame(run);
    fullStop(game);
    elapse(game, RUN_MS);
    assert.equal(game.ended, true);
    assert.equal(game.timeLeft, 0);
    assert.equal(game.beatIndex, 9);
    assert.deepEqual(game.handledTimeCalls, game.deck.timeCalls);
    assert.equal(fullStop(game).type, "ended");
  }
});

test("blur pause closes and explicit resume reopens the same break without progress", () => {
  const game = createGame();
  fullStop(game);
  elapse(game, BEAT_MS);
  const before = {
    beat: game.beatIndex, score: game.bankedWords, time: game.timeLeft,
    words: game.unbankedWords,
  };
  assert.equal(pauseGame(game, "blur"), true);
  assert.equal(game.breakOpen, false);
  elapse(game, 10_000);
  assert.deepEqual({
    beat: game.beatIndex, score: game.bankedWords, time: game.timeLeft,
    words: game.unbankedWords,
  }, before);
  assert.equal(fullStop(game).type, "paused");
  assert.equal(resumeGame(game), true);
  assert.equal(game.breakOpen, true);
  assert.equal(game.windowLeft, DECISION_MS);
  assert.equal(game.bankedWords, before.score);
  assert.equal(fullStop(game).type, "banked");
});

test("one-action retry resets the round, holds time, and rotates the paper", () => {
  const game = createGame();
  fullStop(game);
  elapse(game, 8_000);
  const next = retryGame(game);
  assert.equal(next.run, 1);
  assert.equal(next.deckIndex, 1);
  assert.equal(next.bankedWords, 0);
  assert.equal(next.lostWords, 0);
  assert.equal(next.timerArmed, false);
  assert.equal(next.timeLeft, RUN_MS);
  assert.deepEqual(summarize(next), {
    bankedWords: 0, biggestSafeSentence: 0, lostWords: 0, banks: 0,
    deckIndex: 1,
  });
});

test("truthful Web Share is preferred and copy remains an explicit fallback", async () => {
  const result = { bankedWords: 116, biggestSafeSentence: 31, lostWords: 18 };
  const data = shareData(result);
  assert.deepEqual(data, {
    title: "Last Full Stop",
    text: "I banked 116 words before TIME in Last Full Stop. Biggest safe sentence: 31. Can you risk one more phrase?",
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
  assert.equal(await shareResult(result, {}), "failed");
});
