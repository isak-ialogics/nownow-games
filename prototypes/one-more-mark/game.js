import { isEditableTarget } from "../../shared/input.js";
import {
  BOOKLETS, FEEDBACK_MS, RUN_MS, advancePage, createGame, currentPage,
  decide, elapse, retryGame, shareResult, summarize,
} from "./state.js";

const $ = (id) => document.getElementById(id);
const main = $("page-main"), panel = $("game-panel"), result = $("result-card");
const paper = $("paper"), feedback = $("feedback"), pauseNote = $("pause-note");
const fill = $("fill"), flip = $("flip"), retry = $("retry");
const share = $("share-result"), copy = $("copy-link"), shareStatus = $("share-status");
const sound = $("sound");
let game = createGame(), finalResult, frame, lastAt, advanceTimer, audio;
let soundOn = false;
const pauses = new Set();

function rowsFor(page, late) {
  return Array.from({ length: 4 }, (_, index) => {
    const open = page.incomplete && index === page.open;
    const crossed = late && index === (page.pattern + 2) % 4;
    return `<li class="${crossed ? "crossed" : ""}"><span></span><i role="img" class="${open ? "open" : "filled"}" aria-label="${open ? "unfinished response" : "completed response"}">${open ? "" : "✓"}</i></li>`;
  }).join("");
}

function renderPage() {
  const page = currentPage(game), booklet = BOOKLETS[page.booklet];
  const late = RUN_MS - game.timeLeft >= 8_000;
  $("booklet").textContent = booklet.name;
  $("page-number").textContent = `Page ${page.page + 1} of 5`;
  paper.className = `paper pattern-${page.pattern} ${late ? "late" : "early"}`;
  paper.setAttribute("aria-label", `${booklet.name}, page ${page.page + 1}. ${page.incomplete ? "One unfinished response." : "All responses complete."}`);
  paper.innerHTML = `<div class="paper-head"><b></b><b></b><b></b></div><ul>${rowsFor(page, late)}</ul><div class="scribble" aria-hidden="true"></div>`;
  feedback.textContent = late ? "Scan the boxes. Cross-outs are decoys." : "Find the open box — or flip a clean page.";
  setControls(false);
}

function renderHud() {
  $("time").textContent = (game.timeLeft / 1_000).toFixed(1);
  $("marks").textContent = String(game.marks);
  $("streak").textContent = String(game.streak);
}

function setControls(locked = game.locked || pauses.size > 0) {
  fill.disabled = locked;
  flip.disabled = locked;
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

function act(action) {
  if (pauses.size) return;
  const outcome = decide(game, action);
  if (!outcome) return;
  setControls(true);
  renderHud();
  paper.classList.add(outcome.correct ? "correct" : "error");
  if (outcome.correct && action === "fill") {
    paper.classList.add("ticked");
    navigator.vibrate?.(16);
    feedback.textContent = "Filled. Mark banked.";
  } else if (outcome.correct) feedback.textContent = "Clean page. Flipped.";
  else feedback.textContent = action === "fill" ? "Already complete. −2 seconds." : "Unfinished missed. −2 seconds.";
  tone(outcome.correct);
  if (game.ended) return finish();
  advanceTimer = setTimeout(() => {
    if (advancePage(game)) renderPage();
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
  fill.focus({ preventScroll: true });
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

fill.addEventListener("click", () => act("fill"));
flip.addEventListener("click", () => act("flip"));
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
      start(retryGame(game));
    }
    return;
  }
  const action = event.key === "f" || event.key === "F" || event.key === " " ? "fill" : event.key === "ArrowRight" || event.key === "Enter" ? "flip" : null;
  if (action) { event.preventDefault(); act(action); }
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
fill.focus({ preventScroll: true });
