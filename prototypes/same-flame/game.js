import { createInputController } from "../../shared/input.js";
import {
  RUN_MS,
  createGame,
  createShareData,
  isExpired,
  readBest,
  saveBest,
  setHeld,
  shouldHoldAt,
  summarize,
  updateGame,
} from "./state.js";

const $ = (id) => document.getElementById(id);
const gamePanel = $("game-panel");
const resultCard = $("result-card");
const expiryCard = $("expiry-card");
const guideFlame = $("guide-flame");
const playerFlame = $("player-flame");
const control = $("pulse-control");
const controlLabel = $("control-label");
const cue = $("pulse-cue");
const time = $("time-left");
const syncText = $("sync-text");
const syncMeter = $("sync-meter");
const pauseNote = $("pause-note");
const resultTitle = $("result-title");
const resultMessage = $("result-message");
const finalSync = $("final-sync");
const personalBest = $("personal-best");
const mergedFlame = $("merged-flame");
const share = $("share-result");
const retry = $("retry");
const shareStatus = $("share-status");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

document.body.dataset.motion = reduced ? "reduced" : "full";
let run;
let frame;
let lastAt;
let controller;
let currentSync = 0;
const pauses = new Set();

function showFlame(node, level) {
  node.style.setProperty("--level", level.toFixed(3));
  node.dataset.level = level.toFixed(3);
}

function render() {
  showFlame(guideFlame, run.target);
  showFlame(playerFlame, run.player);
  const sync = `${run.sync}%`;
  time.textContent = ((RUN_MS - run.elapsed) / 1000).toFixed(1);
  syncText.textContent = sync;
  syncMeter.setAttribute("aria-valuenow", String(run.sync));
  syncMeter.style.setProperty("--sync", sync);
  cue.textContent = shouldHoldAt(run.elapsed)
    ? "HOLD · RISING"
    : "RELEASE · SETTLING";
}

function tick(now) {
  if (pauses.size || run.ended) return;
  updateGame(run, now - lastAt);
  lastAt = now;
  render();
  if (run.ended) showResults();
  else frame = requestAnimationFrame(tick);
}

function releaseControl() {
  if (!run || run.ended) return;
  setHeld(run, false);
  control.ariaPressed = "false";
  controlLabel.textContent = "Hold to lift your flame";
}

function pressControl() {
  if (!run || run.ended || pauses.size) return;
  setHeld(run, true);
  control.ariaPressed = "true";
  controlLabel.textContent = "Release as the guide settles";
}

function onInput(input) {
  if (input.action === "reset-input") return releaseControl();
  const playable =
    (input.source === "pointer" && input.action === "position") ||
    (input.source === "keyboard" && input.action === "activate");
  if (!playable || input.phase === "repeat") return;
  if (input.phase === "start") pressControl();
  if (input.phase === "end" || input.phase === "cancel") releaseControl();
}

function pause(reason) {
  if (!run || run.ended) return;
  pauses.add(reason);
  cancelAnimationFrame(frame);
  releaseControl();
  document.body.dataset.paused = "true";
  pauseNote.hidden = false;
}

function resume(reason) {
  pauses.delete(reason);
  if (pauses.size || !run || run.ended) return;
  document.body.dataset.paused = "false";
  pauseNote.hidden = true;
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
}

function showExpired() {
  cancelAnimationFrame(frame);
  controller?.destroy();
  controller = null;
  gamePanel.hidden = true;
  resultCard.hidden = true;
  expiryCard.hidden = false;
  expiryCard.focus();
}

function showResults() {
  controller?.destroy();
  controller = null;
  const result = summarize(run);
  currentSync = result.sync;
  const best = saveBest(localStorage, result.sync);
  resultCard.dataset.outcome = result.merged ? "merged" : "apart";
  resultTitle.textContent = result.merged
    ? "Two fires. One shared glow."
    : "The fires are still finding rhythm.";
  resultMessage.textContent = result.merged
    ? "Different stories, same flame. Bring your own spark and make room for another."
    : "Follow the rise, release into the settle, and try the rhythm again.";
  finalSync.textContent = `${result.sync}%`;
  personalBest.textContent = `${best}%`;
  mergedFlame.hidden = !result.merged;
  gamePanel.hidden = true;
  resultCard.hidden = false;
  resultCard.focus();
}

function startRun() {
  if (isExpired()) return showExpired();
  cancelAnimationFrame(frame);
  controller?.destroy();
  pauses.clear();
  run = createGame();
  shareStatus.textContent = "";
  document.body.dataset.paused = "false";
  pauseNote.hidden = true;
  expiryCard.hidden = true;
  resultCard.hidden = true;
  gamePanel.hidden = false;
  control.ariaPressed = "false";
  controlLabel.textContent = "Hold to lift your flame";
  controller = createInputController(control, { onInput });
  render();
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
  control.focus({ preventScroll: true });
}

async function shareResult() {
  const url = document.querySelector('[rel="canonical"]').href;
  const data = createShareData(currentSync || readBest(localStorage), url);
  try {
    if (navigator.share) {
      await navigator.share(data);
      shareStatus.textContent = "Shared.";
      return;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    shareStatus.textContent = "Result copied.";
  } catch {
    shareStatus.textContent = "Sharing is unavailable on this device.";
  }
}

document.addEventListener("visibilitychange", () =>
  document.hidden ? pause("background") : resume("background"),
);
document.addEventListener("nownow-feedback", (event) =>
  event.detail ? pause("feedback") : resume("feedback"),
);
retry.addEventListener("click", startRun);
share.addEventListener("click", shareResult);
startRun();
