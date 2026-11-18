export const RUN_MS = 45_000;
export const BEAT_MS = 4_500;
export const DECISION_MS = 800;
export const EARLY_BUFFER_MS = 150;
export const MULTIPLIERS = Object.freeze([1, 1.4, 1.7, 2.2]);
export const CANONICAL_URL =
  "https://nownowgames.co.za/games/last-full-stop/";

const authored = [
  {
    calls: [2, 5, 9],
    phrases: [
      "The last idea waits beside the margin while the quiet clock watches",
      "one careful clause turns the thought toward a brighter ending",
      "a final detail gathers near the edge of the page",
      "the sentence leans forward and asks for one more breath",
      "a small image arrives with just enough room to stay",
      "another phrase slips in beneath the steady moving hand",
      "the ink keeps its balance as the silence grows",
      "one clear thought stretches past the safest stopping place",
      "the closing words gather softly beside the waiting line",
      "a brave last clause reaches the end of the page",
    ],
  },
  {
    calls: [2, 6, 9],
    phrases: [
      "A bright thought crosses the paper while the silent hand keeps moving",
      "the next few words make the picture warmer and wider",
      "one quiet turn gives the sentence a sharper shape",
      "the line gathers speed without losing its gentle rhythm",
      "a careful detail settles beside the unfinished thought",
      "another clause opens a path toward the far margin",
      "the page holds still while the sentence keeps growing",
      "one small surprise waits inside the next few words",
      "the ending comes closer but the hand comes closer too",
      "a final image lands just before the empty margin",
    ],
  },
  {
    calls: [3, 6, 9],
    phrases: [
      "The open sentence carries twelve calm words toward the waiting margin now",
      "a second idea joins the line and deepens its meaning",
      "the quiet page makes room for one more clear detail",
      "the moving hand reaches forward as the clause settles",
      "another image appears and asks the line to continue",
      "the sentence grows heavier without changing its steady pace",
      "a narrow pause arrives beside the edge of the paper",
      "one more thought could make the ending feel complete",
      "the final words hover between safety and a richer line",
      "the ink reaches out for one last measured phrase",
    ],
  },
  {
    calls: [2, 5, 9],
    phrases: [
      "One steady line holds a new idea while the pale clock watches",
      "the thought turns gently and reveals another small detail",
      "a fresh phrase makes the unfinished picture feel more complete",
      "the hand moves nearer while the words keep their balance",
      "another quiet image waits beyond the safest stopping point",
      "the sentence gathers courage and crosses the open space",
      "a final turn brings the far margin into view",
      "one last detail could give the line a stronger ending",
      "the remaining words wait beneath the advancing silent cue",
      "a careful closing phrase reaches for the edge",
    ],
  },
  {
    calls: [3, 6, 9],
    phrases: [
      "A quiet sentence finds its rhythm while the small time hand advances",
      "one measured phrase adds colour to the waiting thought",
      "the line moves onward with a little more confidence",
      "a clear detail arrives beside the slowly narrowing margin",
      "another clause offers more value and a little more risk",
      "the sentence holds together as the room stays still",
      "one bright image waits beyond the easy stopping place",
      "the moving cue draws close while the words continue",
      "a final thought gathers at the end of the line",
      "the closing phrase reaches softly across the page",
    ],
  },
];

const wordCount = (text) => text.trim().split(/\s+/u).length;

export const DECKS = Object.freeze(authored.map((deck, index) =>
  Object.freeze({
    id: `paper-${index + 1}`,
    timeCalls: Object.freeze([...deck.calls]),
    phrases: Object.freeze(deck.phrases.map((text) =>
      Object.freeze({ text, words: wordCount(text) }))),
  })));

export function deckOrder(run = 0) {
  const start = ((run % DECKS.length) + DECKS.length) % DECKS.length;
  return DECKS.map((_, index) => (start + index) % DECKS.length);
}

export function currentMultiplier(game) {
  return MULTIPLIERS[Math.max(0, Math.min(game.riskLevel, MULTIPLIERS.length - 1))];
}

export function currentPot(game) {
  return Math.round(game.unbankedWords * currentMultiplier(game));
}

export function sentenceText(game) {
  return game.sentenceParts.join(", ");
}

export function cueFor(game) {
  const callBeat = game.deck.timeCalls.find((beat) => beat >= game.beatIndex);
  const distance = callBeat === undefined ? Infinity : callBeat - game.beatIndex;
  if (distance === 0) {
    return { distance, notch: 3, label: "TIME at this break", state: "time" };
  }
  if (distance === 1) {
    return { distance, notch: 2, label: "TIME next break", state: "one" };
  }
  if (distance === 2) {
    return { distance, notch: 1, label: "TIME in 2 breaks", state: "two" };
  }
  return { distance, notch: 0, label: "TIME clear", state: "clear" };
}

export function createGame(run = 0) {
  const deckIndex = deckOrder(run)[0];
  const deck = DECKS[deckIndex];
  const first = deck.phrases[0];
  return {
    run,
    deckIndex,
    deck,
    beatIndex: 0,
    timeLeft: RUN_MS,
    timerArmed: false,
    ended: false,
    paused: false,
    pauseReason: null,
    restartBreakOnResume: false,
    breakOpen: true,
    breakResolved: false,
    windowLeft: DECISION_MS,
    nextBeatIn: null,
    buffered: false,
    riskLevel: 1,
    sentenceParts: [first.text],
    unbankedWords: first.words,
    bankedWords: 0,
    rawWordsSafe: 0,
    biggestSafeSentence: 0,
    lostWords: 0,
    banks: 0,
    lastSentence: "",
    lastSentenceType: "",
    lastFeedback: "Bank 17 now, or wait for more before TIME.",
    lastOutcome: null,
    handledTimeCalls: [],
  };
}

function resetSentence(game) {
  game.sentenceParts = [];
  game.unbankedWords = 0;
  game.riskLevel = 0;
}

function bankSentence(game, source) {
  const words = game.unbankedWords;
  const multiplier = currentMultiplier(game);
  const awarded = currentPot(game);
  game.bankedWords += awarded;
  game.rawWordsSafe += words;
  game.biggestSafeSentence = Math.max(game.biggestSafeSentence, words);
  game.banks += 1;
  game.lastSentence = `${sentenceText(game)}.`;
  game.lastSentenceType = "banked";
  game.lastFeedback = `BANKED +${awarded} · ${words} words safe`;
  game.lastOutcome = { type: "banked", source, awarded, words, multiplier };
  game.breakResolved = true;
  resetSentence(game);
  return game.lastOutcome;
}

export function fullStop(game, source = "control") {
  if (game.ended) return { type: "ended" };
  if (game.paused) return { type: "paused" };
  if (game.breakOpen) {
    if (game.breakResolved) {
      game.lastFeedback = "Full stop already placed at this break.";
      return { type: "duplicate" };
    }
    const firstBank = !game.timerArmed;
    const outcome = bankSentence(game, source);
    if (firstBank) {
      game.timerArmed = true;
      game.nextBeatIn = BEAT_MS;
    }
    return outcome;
  }
  if (
    game.timerArmed &&
    Number.isFinite(game.nextBeatIn) &&
    game.nextBeatIn > 0 &&
    game.nextBeatIn <= EARLY_BUFFER_MS
  ) {
    if (game.buffered) {
      game.lastFeedback = "Full stop already ready for the next break.";
      return { type: "duplicate" };
    }
    game.buffered = true;
    game.lastFeedback = "Full stop ready for the next break.";
    game.lastOutcome = { type: "buffered", source };
    return game.lastOutcome;
  }
  game.lastFeedback = "Wait for the break.";
  game.lastOutcome = { type: "late", source };
  return game.lastOutcome;
}

function resolveBreak(game) {
  const isTime = game.deck.timeCalls.includes(game.beatIndex);
  if (isTime) {
    game.handledTimeCalls.push(game.beatIndex);
    if (!game.breakResolved && game.unbankedWords > 0) {
      const words = game.unbankedWords;
      game.lastSentence = sentenceText(game);
      game.lastSentenceType = "lost";
      game.lostWords += words;
      game.lastFeedback = `TIME · ${words} unbanked words lost`;
      game.lastOutcome = { type: "time", words, beat: game.beatIndex };
      resetSentence(game);
    }
  } else if (!game.breakResolved) {
    const next = MULTIPLIERS[Math.min(game.riskLevel + 1, MULTIPLIERS.length - 1)];
    game.lastFeedback = `Risk taken · next phrase can reach ×${next.toFixed(1)}`;
    game.lastOutcome = { type: "waited", beat: game.beatIndex };
  }
  game.breakOpen = false;
  game.breakResolved = true;
  game.windowLeft = 0;
}

function openNextBreak(game) {
  if (game.beatIndex >= game.deck.phrases.length - 1) return false;
  game.beatIndex += 1;
  const phrase = game.deck.phrases[game.beatIndex];
  if (game.sentenceParts.length === 0) game.riskLevel = 0;
  else game.riskLevel = Math.min(game.riskLevel + 1, MULTIPLIERS.length - 1);
  game.sentenceParts.push(phrase.text);
  game.unbankedWords += phrase.words;
  game.breakOpen = true;
  game.breakResolved = false;
  game.windowLeft = DECISION_MS;
  game.nextBeatIn = BEAT_MS;
  game.lastFeedback = cueFor(game).distance === 0
    ? "TIME is here · bank before the break closes."
    : "Phrase break open · bank or risk the next phrase.";
  game.lastOutcome = { type: "break", beat: game.beatIndex };
  if (game.buffered) {
    game.buffered = false;
    fullStop(game, "buffer");
  }
  return true;
}

export function elapse(game, milliseconds) {
  if (game.ended || game.paused || !game.timerArmed) return game;
  let remaining = Math.max(0, Number(milliseconds) || 0);
  while (remaining > 0 && !game.ended) {
    const candidates = [game.timeLeft];
    if (Number.isFinite(game.nextBeatIn)) candidates.push(game.nextBeatIn);
    if (game.breakOpen) candidates.push(game.windowLeft);
    const step = Math.min(remaining, ...candidates.filter((value) => value > 0));
    if (!Number.isFinite(step)) break;
    game.timeLeft = Math.max(0, game.timeLeft - step);
    if (Number.isFinite(game.nextBeatIn)) {
      game.nextBeatIn = Math.max(0, game.nextBeatIn - step);
    }
    if (game.breakOpen) game.windowLeft = Math.max(0, game.windowLeft - step);
    remaining -= step;

    if (game.breakOpen && game.windowLeft === 0) resolveBreak(game);
    if (game.timeLeft === 0) {
      game.ended = true;
      game.breakOpen = false;
      game.buffered = false;
      game.lastOutcome = { type: "ended" };
      break;
    }
    if (game.nextBeatIn === 0) {
      if (!openNextBreak(game)) game.nextBeatIn = Infinity;
    }
  }
  return game;
}

export function pauseGame(game, reason = "away") {
  if (game.ended || game.paused) return false;
  game.paused = true;
  game.pauseReason = reason;
  game.restartBreakOnResume = game.breakOpen && !game.breakResolved;
  if (game.restartBreakOnResume) {
    game.breakOpen = false;
    game.windowLeft = DECISION_MS;
    game.buffered = false;
  }
  return true;
}

export function resumeGame(game) {
  if (game.ended || !game.paused) return false;
  game.paused = false;
  game.pauseReason = null;
  if (game.restartBreakOnResume) {
    game.breakOpen = true;
    game.breakResolved = false;
    game.windowLeft = DECISION_MS;
  }
  game.restartBreakOnResume = false;
  return true;
}

export function retryGame(game) {
  return createGame(game.run + 1);
}

export function summarize(game) {
  return {
    bankedWords: game.bankedWords,
    biggestSafeSentence: game.biggestSafeSentence,
    lostWords: game.lostWords,
    banks: game.banks,
    deckIndex: game.deckIndex,
  };
}

export function shareData(result) {
  return {
    title: "Last Full Stop",
    text: `I banked ${result.bankedWords} words before TIME in Last Full Stop. Biggest safe sentence: ${result.biggestSafeSentence}. Can you risk one more phrase?`,
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
  if (typeof navigatorTarget?.clipboard?.writeText !== "function") {
    return "failed";
  }
  try {
    await navigatorTarget.clipboard.writeText(`${data.text}\n${data.url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
