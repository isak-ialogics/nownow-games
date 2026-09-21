import { createInputController, isEditableTarget } from "../../shared/input.js";
import {
  CUES,
  RUN_MS,
  SECTOR_COUNT,
  clearBest,
  commitGuess,
  createGame,
  createShareData,
  phaseAt,
  saveBest,
  summarize,
  updateGame,
} from "./state.js";

const $ = (id) => document.getElementById(id);
const [
  panel, card, surface, signal, wake, reveal, time, count, score, status,
  paused, outCorrect, outEarly, outScore, bestRead, trace, shareNote, retry, share,
  reset,
] = [
  "game-panel", "result-card", "sector-control", "signal", "wake", "reveal",
  "time-left", "cue-count", "score", "game-status", "pause-note", "final-correct",
  "final-early", "final-score", "best-read", "trace", "share-status", "retry",
  "share-result",
  'reset-best',
].map($);
const buttons = [...surface.querySelectorAll("button")];

document.body.dataset.motion = matchMedia("(prefers-reduced-motion: reduce)").matches
  ? "reduced"
  : "full";

let run;
let pick = 2;
let frame;
let lastAt;
let input;
let lastKey = "";
const pauses = new Set();

function select(index, focus = false) {
  pick = (index + SECTOR_COUNT) % SECTOR_COUNT;
  surface.setAttribute("aria-activedescendant", `sector-${pick + 1}`);
  buttons.forEach((button, sector) => {
    button.classList.toggle('selected', sector === pick);
    button.ariaPressed = String(sector === (run?.guess ?? pick));
  });
  if (focus) surface.focus({ preventScroll: true });
}

function commit(index = pick) {
  select(index, true);
  if (commitGuess(run, pick)) render(true);
}

function message(phase, cue) {
  const direction = cue.wakeDirection > 0 ? "right" : "left";
  const distance = Math.abs(cue.wakeDirection);
  if (phase === "cue")
    return `Blow in sector ${cue.plumeSector + 1}. Wake runs ${distance} sector${distance > 1 ? "s" : ""} ${direction}.`;
  if (phase === "choose") return "Signal gone. Make your call.";
  if (phase === "quiet")
    return run.guess === null
      ? "No call locked. Watch."
      : `Call locked: sector ${run.guess + 1}. Watch the horizon.`;
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

function tick(now) {
  if (pauses.size || run.ended) return;
  updateGame(run, now - lastAt);
  lastAt = now;
  render();
  if (run.ended) finish();
  else frame = requestAnimationFrame(tick);
}

function onInput(input) {
  if (pauses.size || input.phase === "repeat") return;
  if (input.source === "pointer" && input.action === "activate") {
    commit(Math.min(4, Math.floor(input.x * 5)));
  } else if (input.source === "keyboard" && input.phase === "start") {
    if (input.action === "left") select(pick - 1);
    if (input.action === "right") select(pick + 1);
    if (input.action === "activate") commit();
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
  const best = saveBest(localStorage, result);
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
}

function start() {
  cancelAnimationFrame(frame);
  input?.destroy();
  pauses.clear();
  run = createGame();
  pick = 2;
  lastKey = "";
  shareNote.textContent = "";
  document.body.dataset.paused = "false";
  paused.hidden = true;
  card.hidden = true;
  panel.hidden = false;
  input = createInputController(surface, { onInput });
  select(pick);
  render(true);
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
  surface.focus({ preventScroll: true });
}

async function shareRun() {
  const data = createShareData(summarize(run), document.querySelector('[rel="canonical"]').href);
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
  const best = clearBest(localStorage);
  bestRead.textContent = `${best.correct}/6 read \u00b7 ${best.early} early`;
  shareNote.textContent = 'Saved best reset.';
}

buttons.forEach((button, index) => button.addEventListener("click", () => commit(index)));
window.addEventListener("keydown", (event) => {
  if (isEditableTarget(event.target) || event.repeat || !/^[1-5]$/.test(event.key)) return;
  event.preventDefault();
  commit(Number(event.key) - 1);
});
document.addEventListener("visibilitychange", () =>
  document.hidden ? pause("background") : resume("background"),
);
document.addEventListener("nownow-feedback", (event) =>
  event.detail ? pause("feedback") : resume("feedback"),
);
retry.addEventListener("click", start);
share.addEventListener("click", shareRun);
reset.addEventListener('click', resetBest);
start();
