import { isEditableTarget } from "../../shared/input.js";
import {
  FEEDBACK_MS, RUN_MS, createGame, currentPage, decide, elapse, retryGame,
  settleDecision, shareResult, summarize,
} from "./state.js";

const $ = (id) => document.getElementById(id);
const main = $("page-main"), panel = $("game-panel"), result = $("result-card");
const paper = $("paper"), feedback = $("feedback"), pauseNote = $("pause-note");
const complete = $("complete"), retry = $("retry");
const share = $("share-result"), copy = $("copy-link"), shareStatus = $("share-status");
const sound = $("sound");
let game = createGame(), finalResult, frame, lastAt, advanceTimer, audio;
let soundOn = false;
const pauses = new Set();

function rowsFor(page, late) {
  const first = game.pageIndex === 0 && !game.timerArmed;
  return Array.from({ length: 4 }, (_, index) => {
    const open = page.incomplete && index === page.open;
    const crossed = late && index === (page.pattern + 2) % 4;
    const mark = open ? (first ? "<b>EMPTY</b>" : "□") : "✓";
    return `<li class="${crossed ? "crossed" : ""}"><button type="button" class="answer-row ${open ? "open" : "filled"}" data-row="${index}" aria-keyshortcuts="${index + 1}" aria-label="Row ${index + 1}, ${open ? "empty answer" : "filled answer"}"><span class="row-number">${index + 1}</span><span class="row-line" aria-hidden="true"></span><span class="answer-mark" aria-hidden="true">${mark}</span></button></li>`;
  }).join("");
}

function renderPage() {
  const page = currentPage(game);
  const late = RUN_MS - game.timeLeft >= 8_000;
  $("page-number").textContent = `Page ${page.page + 1} of 5`;
  paper.className = `paper pattern-${page.pattern} ${late ? "late" : "early"}`;
  paper.setAttribute("aria-label", `Answer sheet, page ${page.page + 1}. ${page.incomplete ? "One empty answer." : "All answers filled."}`);
  paper.innerHTML = `<div class="paper-head" aria-hidden="true"><b></b><b></b><b></b></div><ol>${rowsFor(page, late)}</ol><div class="scribble" aria-hidden="true"></div>`;
  feedback.textContent = game.pageIndex === 0 && !game.timerArmed
    ? "Tap row 2 · Key 2."
    : game.pageIndex === 1
      ? "No empty row? Page complete · Key C."
      : late ? "Cross-outs are decoys. Find the empty answer." : "Choose an empty row, or Page complete.";
  setControls(false);
}

function renderHud() {
  $("time").textContent = (game.timeLeft / 1_000).toFixed(1);
  $("timer-state").textContent = game.timerArmed ? "Running" : "Held";
  $("marks").textContent = String(game.marks);
  $("streak").textContent = String(game.streak);
}

function setControls(locked = game.locked || pauses.size > 0) {
  complete.disabled = locked;
  for (const button of paper.querySelectorAll("button")) button.disabled = locked;
}

function focusForPage() {
  const row = game.pageIndex === 0 ? 1 : 0;
  const target = game.pageIndex === 1
    ? complete
    : paper.querySelector(`[data-row="${row}"]`);
  target?.focus({ preventScroll: true });
}

function markFilled(row) {
  const button = paper.querySelector(`[data-row="${row}"]`);
  if (!button) return;
  button.classList.remove("open");
  button.classList.add("filled");
  button.setAttribute("aria-label", `Row ${row + 1}, filled answer`);
  button.querySelector(".answer-mark").textContent = "✓";
}

function tone(correct) {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = correct ? 520 : 150;
    oscillator.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + .05);
  } catch {}
}

function finish() {
  if (!panel.hidden) {
    cancelAnimationFrame(frame);
    clearTimeout(advanceTimer);
    finalResult = summarize(game);
    $("final-marks").textContent = `${finalResult.marks} / ${finalResult.available}`;
    $("final-streak").textContent = String(finalResult.bestStreak);
    $("final-accuracy").textContent = `${finalResult.accuracy}%`;
    panel.hidden = true;
    result.hidden = false;
    shareStatus.textContent = "";
    retry.focus({ preventScroll: true });
  }
}

function tick(now) {
  if (pauses.size || game.ended) return;
  elapse(game, now - lastAt);
  lastAt = now;
  renderHud();
  if (game.ended) finish();
  else frame = requestAnimationFrame(tick);
}

function act(action, target) {
  if (pauses.size) return;
  const unarmed = !game.timerArmed;
  const outcome = decide(game, action);
  if (!outcome) return;
  setControls(true);
  if (unarmed && game.timerArmed) lastAt = performance.now();
  renderHud();
  paper.classList.add(outcome.correct ? "correct" : "error");
  if (outcome.correct && Number.isInteger(action)) {
    markFilled(action);
    navigator.vibrate?.(16);
    feedback.textContent = "Filled · +1 mark · Next page";
  } else if (outcome.correct) {
    feedback.textContent = "Page complete · Clean streak +1 · Next page";
  } else if (outcome.onboarding) {
    feedback.textContent = action === "complete"
      ? "Row 2 is empty. Try that row."
      : "That row is already filled";
  } else {
    feedback.textContent = action === "complete"
      ? "An answer is empty · −2 seconds"
      : "Already filled · −2 seconds";
  }
  tone(outcome.correct);
  if (game.ended) return finish();
  advanceTimer = setTimeout(() => {
    if (!settleDecision(game, outcome.correct)) return;
    if (outcome.correct) {
      renderPage();
      focusForPage();
    } else {
      paper.classList.remove("error");
      setControls(false);
      target?.focus({ preventScroll: true });
    }
  }, FEEDBACK_MS);
}

function clearPauseState() {
  pauses.clear();
  pauseNote.hidden = true;
}

function start(next) {
  cancelAnimationFrame(frame);
  clearTimeout(advanceTimer);
  clearPauseState();
  game = next;
  result.hidden = true;
  panel.hidden = false;
  renderHud();
  renderPage();
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
  focusForPage();
}

function pause(reason) {
  pauses.add(reason);
  cancelAnimationFrame(frame);
  pauseNote.hidden = false;
  setControls(true);
}

function resume(reason) {
  pauses.delete(reason);
  if (pauses.size) return;
  pauseNote.hidden = true;
  if (game.ended) return;
  setControls();
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
}

async function useShare(forceCopy = false) {
  const target = forceCopy ? { clipboard: navigator.clipboard } : navigator;
  const mode = await shareResult(finalResult, target);
  shareStatus.textContent = mode === "shared" ? "Share sheet opened." : mode === "copied" ? "Result and game link copied." : mode === "cancelled" ? "Sharing cancelled." : "Copy failed. Use the address in your browser.";
}

paper.addEventListener("click", (event) => {
  const button = event.target.closest("[data-row]");
  if (button) act(Number(button.dataset.row), button);
});
complete.addEventListener("click", () => act("complete", complete));
retry.addEventListener("click", () => start(retryGame(game)));
share.addEventListener("click", () => useShare());
copy.addEventListener("click", () => useShare(true));
sound.addEventListener("click", () => {
  soundOn = !soundOn;
  sound.textContent = soundOn ? "Sound on" : "Sound off";
  sound.ariaPressed = String(soundOn);
});
window.addEventListener("keydown", (event) => {
  if (event.repeat || isEditableTarget(event.target)) return;
  if (!result.hidden) {
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      retry.click();
    }
    return;
  }
  const row = /^[1-4]$/.test(event.key) ? Number(event.key) - 1 : null;
  const action = row ?? (/^c$/i.test(event.key) ? "complete" : null);
  if (action !== null) {
    event.preventDefault();
    const target = action === "complete"
      ? complete
      : paper.querySelector(`[data-row="${action}"]`);
    act(action, target);
  }
});
document.addEventListener("visibilitychange", () => document.hidden ? pause("background") : resume("background"));
window.addEventListener("blur", () => pause("blur"));
window.addEventListener("focus", () => resume("blur"));
document.addEventListener("nownow-feedback", (event) => {
  main.inert = Boolean(event.detail);
  if (event.detail) { main.setAttribute("aria-hidden", "true"); pause("feedback"); }
  else { main.removeAttribute("aria-hidden"); resume("feedback"); }
});

renderHud();
renderPage();
lastAt = performance.now();
frame = requestAnimationFrame(tick);
focusForPage();
