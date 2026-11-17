export const RUN_MS = 42_000;
export const PENALTY_MS = 2_000;
export const FEEDBACK_MS = 320;
export const CANONICAL_URL = "https://nownowgames.co.za/games/one-more-mark/";

const authored = [
  [1, -1, 3, 0, -1],
  [1, -1, 2, -1, 0],
  [1, -1, -1, 3, 1],
  [1, -1, 0, -1, 2],
  [1, -1, 3, 2, -1],
  [1, -1, -1, 0, 3],
];

export const BOOKLETS = authored.map((opens, booklet) => ({
  id: `booklet-${booklet + 1}`,
  pages: opens.map((open, page) => ({
    booklet,
    page,
    incomplete: open >= 0,
    open,
    pattern: (booklet * 2 + page) % 5,
  })),
}));

export function bookletOrder(run = 0) {
  const start = ((run % BOOKLETS.length) + BOOKLETS.length) % BOOKLETS.length;
  return BOOKLETS.map((_, index) => (start + index) % BOOKLETS.length);
}

function deckFor(run) {
  return bookletOrder(run).flatMap((index) => BOOKLETS[index].pages);
}

export function createGame(run = 0) {
  const deck = deckFor(run);
  return {
    run, deck, pageIndex: 0, timeLeft: RUN_MS, timerArmed: false, marks: 0,
    available: 1, decisions: 0, correct: 0, streak: 0, bestStreak: 0,
    locked: false, ended: false,
  };
}

export const currentPage = (game) => game.deck[game.pageIndex % game.deck.length];

export function elapse(game, milliseconds) {
  if (game.ended || !game.timerArmed) return game;
  game.timeLeft = Math.max(0, game.timeLeft - Math.max(0, Number(milliseconds) || 0));
  if (game.timeLeft === 0) game.ended = true;
  return game;
}

export function decide(game, action) {
  const row = Number.isInteger(action) && action >= 0 && action < 4;
  if (game.ended || game.locked || (!row && action !== "complete")) return null;
  const page = currentPage(game);
  const expected = page.incomplete ? page.open : "complete";
  const correct = action === expected;
  const onboarding = game.pageIndex === 0 && !game.timerArmed;
  game.locked = true;
  game.decisions += 1;
  if (correct) {
    game.correct += 1;
    if (row) {
      game.marks += 1;
      game.timerArmed = true;
    } else {
      game.streak += 1;
      game.bestStreak = Math.max(game.bestStreak, game.streak);
    }
  } else if (!onboarding) {
    game.streak = 0;
    elapse(game, PENALTY_MS);
  }
  return {
    action, correct, expected, onboarding,
    penalty: correct || onboarding ? 0 : PENALTY_MS,
  };
}

export function settleDecision(game, advance) {
  if (game.ended || !game.locked) return false;
  if (advance) {
    game.pageIndex = (game.pageIndex + 1) % game.deck.length;
    if (currentPage(game).incomplete) game.available += 1;
  }
  game.locked = false;
  return true;
}

export function retryGame(game) {
  return createGame(game.run + 1);
}

export function summarize(game) {
  return {
    marks: game.marks,
    available: game.available,
    bestStreak: game.bestStreak,
    accuracy: game.decisions ? Math.round(game.correct / game.decisions * 100) : 0,
    decisions: game.decisions,
    order: bookletOrder(game.run),
  };
}

export function shareData(result) {
  return {
    title: "One More Mark",
    text: `I found ${result.marks}/${result.available} empty answers in 42 seconds on One More Mark. How clean is your final scan?`,
    url: CANONICAL_URL,
  };
}

export async function shareResult(result, navigatorTarget = globalThis.navigator) {
  const data = shareData(result);
  if (typeof navigatorTarget?.share === "function") {
    try {
      await navigatorTarget.share(data);
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  const clipboard = navigatorTarget?.clipboard;
  if (typeof clipboard?.writeText !== "function") return "failed";
  try {
    await clipboard.writeText(`${data.text}\n${data.url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
