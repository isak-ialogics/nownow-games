import { trackGameEvent } from "../../shared/analytics.js";
import { isEditableTarget } from "../../shared/input.js";
import {
  DECKS, MULTIPLIERS, RUN_MS, createGame, cueFor, currentMultiplier,
  currentPot, elapse, fullStop, pauseGame, resumeGame, retryGame,
  sentenceText, shareResult, summarize,
} from "./state.js";

const $ = (id) => document.getElementById(id);
const main = $("page-main"), panel = $("game-panel"), result = $("result-card");
const action = $("full-stop"), retry = $("retry"), resume = $("resume");
const pauseCard = $("pause-card"), feedback = $("feedback");
const share = $("share-result"), copy = $("copy-link");
const shareStatus = $("share-status"), sound = $("sound");
let game = createGame(), finalResult, frame, lastAt, audio;
let soundOn = false, explicitResume = false;
const pauseReasons = new Set();

function nextMultiplier() {
  return MULTIPLIERS[Math.min(game.riskLevel + 1, MULTIPLIERS.length - 1)];
}

function renderCue() {
  const cue = cueFor(game);
  const cueNode = $("time-cue");
  cueNode.dataset.notch = String(cue.notch);
  cueNode.style.setProperty("--cue-notch", String(cue.notch));
  cueNode.setAttribute("aria-label", cue.label);
  $("cue-label").textContent = cue.label;
}

function renderSentence() {
  const locked = $("locked-sentence");
  locked.hidden = !game.lastSentence;
  locked.textContent = game.lastSentence;
  locked.className = `locked ${game.lastSentenceType}`;
  $("sentence").textContent = game.unbankedWords
    ? sentenceText(game)
    : "Next phrase incoming…";
}

function renderChoice() {
  const pot = currentPot(game);
  const cue = cueFor(game);
  if (game.breakOpen && !game.breakResolved) {
    $("choice").textContent = cue.distance === 0
      ? `FULL STOP banks ${pot}. Waiting risks ${game.unbankedWords} words to TIME.`
      : `FULL STOP banks ${pot}. Wait for ×${nextMultiplier().toFixed(1)}; ${cue.label}.`;
  } else if (game.buffered) {
    $("choice").textContent = "FULL STOP is ready for the next phrase break.";
  } else {
    $("choice").textContent = `Next phrase break approaching · ${cue.label}.`;
  }
  action.setAttribute(
    "aria-label",
    game.breakOpen && !game.breakResolved
      ? `FULL STOP, bank ${pot} words`
      : "FULL STOP, wait for phrase break",
  );
  action.setAttribute(
    "aria-disabled",
    String(game.paused || game.ended || game.breakResolved),
  );
}

function render() {
  $("time").textContent = (game.timeLeft / 1_000).toFixed(1);
  $("timer-state").textContent = game.timerArmed ? "Running" : "Held";
  $("banked").textContent = String(game.bankedWords);
  $("beat").textContent = `${game.beatIndex + 1} / ${game.deck.phrases.length}`;
  $("words").textContent = String(game.unbankedWords);
  $("multiplier").textContent = currentMultiplier(game).toFixed(1);
  $("pot").textContent = String(currentPot(game));
  $("button-pot").textContent = String(currentPot(game));
  feedback.textContent = game.lastFeedback;
  renderCue();
  renderSentence();
  renderChoice();
}

function tone(frequency) {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + .05);
  } catch {}
}

function finish() {
  if (panel.hidden) return;
  cancelAnimationFrame(frame);
  finalResult = summarize(game);
  $("final-banked").textContent = String(finalResult.bankedWords);
  $("final-biggest").textContent = String(finalResult.biggestSafeSentence);
  $("final-lost").textContent = String(finalResult.lostWords);
  panel.hidden = true;
  result.hidden = false;
  shareStatus.textContent = "";
  retry.focus({ preventScroll: true });
}

function tick(now) {
  if (game.paused || game.ended) return;
  const previousOutcome = game.lastOutcome;
  elapse(game, now - lastAt);
  lastAt = now;
  if (game.lastOutcome !== previousOutcome && game.lastOutcome?.type === "time") {
    tone(130);
  }
  render();
  if (game.ended) finish();
  else frame = requestAnimationFrame(tick);
}

function startClock() {
  cancelAnimationFrame(frame);
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
}

function act(source) {
  if (game.paused || panel.hidden) return;
  const wasHeld = !game.timerArmed;
  const outcome = fullStop(game, source);
  if (outcome.type === "banked") {
    tone(520);
    if (wasHeld) {
      trackGameEvent("last-full-stop", "play-started");
      startClock();
    }
  }
  render();
}

function start(next) {
  cancelAnimationFrame(frame);
  pauseReasons.clear();
  explicitResume = false;
  game = next;
  finalResult = null;
  main.inert = false;
  main.removeAttribute("aria-hidden");
  pauseCard.hidden = true;
  result.hidden = true;
  panel.hidden = false;
  render();
  action.focus({ preventScroll: true });
}

function pause(reason, needsExplicitResume) {
  pauseReasons.add(reason);
  explicitResume ||= needsExplicitResume;
  if (!panel.hidden) {
    pauseGame(game, reason);
    cancelAnimationFrame(frame);
    if (needsExplicitResume) {
      pauseCard.hidden = false;
      resume.disabled = true;
    }
    render();
  }
}

function resumeNow() {
  if (pauseReasons.size || !game.paused) return;
  resumeGame(game);
  explicitResume = false;
  pauseCard.hidden = true;
  render();
  if (game.timerArmed) startClock();
  action.focus({ preventScroll: true });
}

function releasePause(reason) {
  pauseReasons.delete(reason);
  if (pauseReasons.size || panel.hidden) return;
  if (explicitResume) {
    pauseCard.hidden = false;
    resume.disabled = false;
    resume.focus({ preventScroll: true });
  } else {
    resumeNow();
  }
}

async function useShare(forceCopy = false) {
  const target = forceCopy ? { clipboard: navigator.clipboard } : navigator;
  const mode = await shareResult(finalResult, target);
  shareStatus.textContent = mode === "shared"
    ? "Share sheet opened."
    : mode === "copied"
      ? "Result and game link copied."
      : mode === "cancelled"
        ? "Sharing cancelled."
        : "Copy failed. Use the address in your browser.";
}

action.addEventListener("click", () => act("touch"));
retry.addEventListener("click", () => start(retryGame(game)));
resume.addEventListener("click", resumeNow);
share.addEventListener("click", () => useShare());
copy.addEventListener("click", () => useShare(true));
sound.addEventListener("click", () => {
  soundOn = !soundOn;
  sound.textContent = soundOn ? "Sound on" : "Sound off";
  sound.ariaPressed = String(soundOn);
});

window.addEventListener("keydown", (event) => {
  if (event.repeat || isEditableTarget(event.target)) return;
  const fullStopKey = event.key === " " || event.key === "Enter";
  if (game.paused) {
    if (fullStopKey && pauseReasons.size === 0) {
      event.preventDefault();
      resumeNow();
    }
    return;
  }
  if (!result.hidden) {
    if (/^r$/i.test(event.key)) {
      event.preventDefault();
      retry.click();
    }
    return;
  }
  if (fullStopKey) {
    event.preventDefault();
    act("keyboard");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause("background", true);
  else releasePause("background");
});
window.addEventListener("blur", () => pause("blur", true));
window.addEventListener("focus", () => releasePause("blur"));
document.addEventListener("nownow-feedback", (event) => {
  if (event.detail) {
    main.inert = true;
    main.setAttribute("aria-hidden", "true");
    pause("feedback", false);
  } else {
    main.inert = false;
    main.removeAttribute("aria-hidden");
    releasePause("feedback");
  }
});

if (DECKS.length !== 5 || RUN_MS !== 45_000) {
  throw new Error("Last Full Stop authored contract is incomplete.");
}
render();
action.focus({ preventScroll: true });
