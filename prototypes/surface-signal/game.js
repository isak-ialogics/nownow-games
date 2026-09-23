import { createInputController, isEditableTarget } from "../../shared/input.js";
import { trackGameEvent, visitorType } from "../../shared/analytics.js";
import {
  CUES,
  RUN_MS,
  SECTOR_COUNT,
  clearBest,
  commitGuess,
  createGame,
  createShareData,
  markPlayed,
  phaseAt,
  safeGameStorage,
  saveBest,
  summarize,
  updateGame,
} from "./state.js";

const GAME_ID = "surface-signal";
const PRACTICE_ANSWER = 2;
const PROGRESS_EVENTS = new Map([
  [2, "round-2-reached"],
  [4, "round-4-reached"],
  [6, "round-6-reached"],
]);
const $ = (id) => document.getElementById(id);
const [
  launch, launchCopy, practice, practiceSurface, practiceReveal, practiceStatus,
  startButton, panel, card, surface, signal, wake, reveal, time, count, score,
  status, paused, outCorrect, outEarly, outScore, bestRead, trace, shareNote,
  retry, share, reset,
] = [
  "launch-card", "launch-copy", "practice-panel", "practice-control",
  "practice-reveal", "practice-status", "start-run", "game-panel",
  "result-card", "sector-control", "signal", "wake", "reveal", "time-left",
  "cue-count", "score", "game-status", "pause-note", "final-correct",
  "final-early", "final-score", "best-read", "trace", "share-status", "retry",
  "share-result", "reset-best",
].map($);
const buttons = [...surface.querySelectorAll("button")];
const practiceButtons = [...practiceSurface.querySelectorAll("button")];
const storage = safeGameStorage(window);

document.body.dataset.motion = matchMedia("(prefers-reduced-motion: reduce)").matches
  ? "reduced"
  : "full";

let run;
let pick = 2;
let frame;
let lastAt;
let input;
let lastKey = "";
let practicePick = 2;
let practiceChoice = null;
let practiceInput;
const pauses = new Set();

function selectPractice(index, focus = false) {
  practicePick = (index + SECTOR_COUNT) % SECTOR_COUNT;
  practiceSurface.setAttribute(
    "aria-activedescendant",
    `practice-sector-${practicePick + 1}`,
  );
  practiceButtons.forEach((button, sector) => {
    button.classList.toggle("selected", sector === practicePick);
    button.ariaPressed = String(sector === (practiceChoice ?? practicePick));
  });
  if (focus) practiceSurface.focus({ preventScroll: true });
}

function choosePractice(index = practicePick) {
  if (practiceChoice !== null) return;
  practiceChoice = (index + SECTOR_COUNT) % SECTOR_COUNT;
  selectPractice(practiceChoice, true);
  practiceSurface.dataset.locked = "true";
  practiceReveal.hidden = false;
  practiceButtons.forEach((button, sector) => {
    button.classList.toggle("committed", sector === practiceChoice);
    button.classList.toggle("answer", sector === PRACTICE_ANSWER);
    button.classList.toggle(
      "wrong",
      sector === practiceChoice && sector !== PRACTICE_ANSWER,
    );
  });
  const result = practiceChoice === PRACTICE_ANSWER
    ? "Clear read."
    : `The wake leads to sector ${PRACTICE_ANSWER + 1}.`;
  practiceStatus.textContent =
    `${result} Practice has no score or timer. Start the six-signal run when ready.`;
  startButton.disabled = false;
  startButton.focus({ preventScroll: true });
}

function onPracticeInput(event) {
  if (practiceChoice !== null || event.phase === "repeat") return;
  if (event.source === "pointer" && event.action === "activate") {
    choosePractice(Math.min(4, Math.floor(event.x * 5)));
  } else if (event.source === "keyboard" && event.phase === "start") {
    if (event.action === "left") selectPractice(practicePick - 1);
    if (event.action === "right") selectPractice(practicePick + 1);
    if (event.action === "activate") choosePractice();
  }
}

function prepareLaunch() {
  const returning = visitorType(storage, GAME_ID) === "returning";
  document.body.dataset.paused = "true";
  panel.hidden = true;
  card.hidden = true;
  launch.hidden = false;
  startButton.disabled = !returning;
  if (returning) {
    launchCopy.textContent =
      "Your earlier visit is remembered. Start immediately, or use the untimed practice signal again.";
    practiceStatus.textContent =
      "No clock is running. Practice again if you like, or skip it and start.";
  }
  selectPractice(practicePick);
  practiceInput = createInputController(practiceSurface, {
    onInput: onPracticeInput,
    keyboardTarget: practiceSurface,
  });
}

function select(index, focus = false) {
  pick = (index + SECTOR_COUNT) % SECTOR_COUNT;
  surface.setAttribute("aria-activedescendant", `sector-${pick + 1}`);
  buttons.forEach((button, sector) => {
    button.classList.toggle("selected", sector === pick);
    button.ariaPressed = String(sector === (run?.guess ?? pick));
  });
  if (focus) surface.focus({ preventScroll: true });
}

function commit(index = pick) {
  select(index, true);
  if (commitGuess(run, pick)) {
    trackGameEvent(GAME_ID, "first-input");
    render(true);
  }
}

function message(phase, cue) {
  const direction = cue.wakeDirection > 0 ? "right" : "left";
  const distance = Math.abs(cue.wakeDirection);
  if (phase === "cue") {
    return `Blow in sector ${cue.plumeSector + 1}. Wake runs ${distance} sector${distance > 1 ? "s" : ""} ${direction}.`;
  }
  if (phase === "choose") return "Signal gone. Make your call.";
  if (phase === "quiet") {
    return run.guess === null
      ? "No call locked. Watch."
      : `Call locked: sector ${run.guess + 1}. Watch the horizon.`;
  }
  const hit = run.trace.at(-1)?.correct;
  return `Surface in sector ${cue.answerSector + 1}. ${hit ? "Clear read." : "Signal missed."}`;
}

function render(force = false) {
  const phase = phaseAt(run);
  const cue = CUES[run.cue];
  const key = `${run.cue}:${phase}:${run.guess}`;
  document.body.dataset.phase = phase;
  time.textContent = Math.max(0, (RUN_MS - run.time) / 1000).toFixed(1);
  count.textContent = `${run.cue + 1}/6`;
  score.textContent = String(run.score);
  signal.style.left = `${(cue.plumeSector + 0.5) * 20}%`;
  signal.hidden = phase !== "cue";
  wake.textContent = cue.wakeDirection > 0
    ? "› ".repeat(Math.abs(cue.wakeDirection)).trim()
    : "‹ ".repeat(Math.abs(cue.wakeDirection)).trim();
  wake.dataset.direction = cue.wakeDirection > 0 ? "right" : "left";
  reveal.style.left = `${(cue.answerSector + 0.5) * 20}%`;
  reveal.hidden = phase !== "reveal";
  surface.dataset.locked = String(run.guess !== null || phase !== "choose");
  buttons.forEach((button, index) => {
    button.classList.toggle("committed", index === run.guess);
    button.classList.toggle("answer", phase === "reveal" && index === cue.answerSector);
    button.classList.toggle(
      "wrong",
      phase === "reveal" && index === run.guess && index !== cue.answerSector,
    );
  });
  if (force || key !== lastKey) {
    status.textContent = message(phase, cue);
    lastKey = key;
  }
}

function reportProgress() {
  for (const [rounds, event] of PROGRESS_EVENTS) {
    if (run.trace.length >= rounds) trackGameEvent(GAME_ID, event);
  }
}

function tick(now) {
  if (pauses.size || run.ended) return;
  updateGame(run, now - lastAt);
  lastAt = now;
  reportProgress();
  render();
  if (run.ended) finish();
  else frame = requestAnimationFrame(tick);
}

function onInput(event) {
  if (pauses.size || event.phase === "repeat") return;
  if (event.source === "pointer" && event.action === "activate") {
    commit(Math.min(4, Math.floor(event.x * 5)));
  } else if (event.source === "keyboard" && event.phase === "start") {
    if (event.action === "left") select(pick - 1);
    if (event.action === "right") select(pick + 1);
    if (event.action === "activate") commit();
  }
}

function pause(reason) {
  if (!run || run.ended) return;
  pauses.add(reason);
  cancelAnimationFrame(frame);
  document.body.dataset.paused = "true";
  paused.hidden = false;
}

function resume(reason) {
  pauses.delete(reason);
  if (pauses.size || !run || run.ended) return;
  document.body.dataset.paused = "false";
  paused.hidden = true;
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
}

function finish() {
  input?.destroy();
  input = null;
  const result = summarize(run);
  const best = saveBest(storage, result);
  outCorrect.textContent = `${result.correct}/6`;
  outEarly.textContent = String(result.early);
  outScore.textContent = String(result.score);
  bestRead.textContent = `${best.correct}/6 read · ${best.early} early`;
  trace.innerHTML = result.trace
    .map(
      (mark) =>
        `<li class="${mark.correct ? "hit" : "miss"}"><span>${mark.guess === null ? "–" : mark.guess + 1}</span><small>was ${mark.answer + 1}</small></li>`,
    )
    .join("");
  panel.hidden = true;
  card.hidden = false;
  card.focus();
  trackGameEvent(GAME_ID, "play-completed");
  markPlayed(storage);
}

function start() {
  cancelAnimationFrame(frame);
  input?.destroy();
  practiceInput?.destroy();
  practiceInput = null;
  pauses.clear();
  run = createGame();
  pick = 2;
  lastKey = "";
  shareNote.textContent = "";
  document.body.dataset.paused = "false";
  paused.hidden = true;
  launch.hidden = true;
  card.hidden = true;
  panel.hidden = false;
  trackGameEvent(GAME_ID, "play-started");
  input = createInputController(surface, { onInput });
  select(pick);
  render(true);
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
  surface.focus({ preventScroll: true });
}

async function shareRun() {
  const data = createShareData(
    summarize(run),
    document.querySelector('[rel="canonical"]').href,
  );
  try {
    if (navigator.share) {
      await navigator.share(data);
      shareNote.textContent = "Shared.";
      return;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    shareNote.textContent = "Result copied.";
  } catch {
    shareNote.textContent = "Sharing is unavailable.";
  }
}

function resetBest() {
  const best = clearBest(storage);
  bestRead.textContent = `${best.correct}/6 read · ${best.early} early`;
  shareNote.textContent = "Saved best reset.";
}

practiceButtons.forEach((button, index) =>
  button.addEventListener("click", () => choosePractice(index)),
);
buttons.forEach((button, index) =>
  button.addEventListener("click", () => commit(index)),
);
window.addEventListener("keydown", (event) => {
  if (isEditableTarget(event.target) || event.repeat || !/^[1-5]$/.test(event.key)) {
    return;
  }
  event.preventDefault();
  const sector = Number(event.key) - 1;
  if (!launch.hidden) choosePractice(sector);
  else if (!panel.hidden) commit(sector);
});
document.addEventListener("visibilitychange", () =>
  document.hidden ? pause("background") : resume("background"),
);
document.addEventListener("nownow-feedback", (event) =>
  event.detail ? pause("feedback") : resume("feedback"),
);
startButton.addEventListener("click", start);
retry.addEventListener("click", start);
share.addEventListener("click", shareRun);
reset.addEventListener("click", resetBest);
prepareLaunch();
