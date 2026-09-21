import { isEditableTarget } from "../../shared/input.js";
import { trackGameEvent } from "../../shared/analytics.js";
import {
  CUES, COMMIT_MS, DEADLINE_MS, DEFAULT_RECORD, ROUND_MS, VERDICT_MS,
  clearRecord, commitLane, completeRecord, createGame, createShareText,
  phaseAt, readRecord, resultBand, selectLane, summarize, updateGame,
  writeRecord,
} from "./state.js";

const $ = (id) => document.getElementById(id);
const main = $("page-main"), intro = $("intro"), tutorial = $("tutorial");
const panel = $("game-panel"), resultCard = $("result-card");
const startButton = $("start"), skip = $("skip-tutorial"), lock = $("lock");
const progress = $("progress"), score = $("score"), live = $("game-status");
const resumeNote = $("resume-note"), storageNote = $("storage-note");
const bloom = $("bloom"), upperArrow = $("upper-arrow"), upperLabel = $("upper-label");
const windArrow = $("wind-arrow"), windLabel = $("wind-label"), lowerLabel = $("lower-label");
const lanes = [...$("lanes").querySelectorAll("button")];
const retry = $("retry"), share = $("share-result"), copy = $("copy-challenge");
const shareStatus = $("share-status"), sound = $("sound"), motion = $("motion");
const reducedSystem = matchMedia("(prefers-reduced-motion: reduce)").matches;
const direction = (move, kind = "branch") => move < 0 ? `LEFT ${kind}` : move > 0 ? `RIGHT ${kind}` : kind === "GUST" ? "STILL AIR" : `STRAIGHT ${kind}`;

let storage;
try { storage = localStorage; } catch {}
let loaded = readRecord(storage), record = loaded.record;
let game, finalResult, shareText, frame, lastAt, tutorialTimer, resultTimer;
let lastMessage = "", lastPhase = "", audio;
const pauses = new Set();
let resumeTimer;

function reduced() {
  return record.reduceMotionOverride ?? reducedSystem;
}

function showStorageFailure() {
  storageNote.hidden = false;
}

function saveSettings(patch) {
  record = { ...record, ...patch };
  if (!writeRecord(storage, record)) showStorageFailure();
}

function renderSettings() {
  const reduce = reduced();
  document.body.dataset.motion = reduce ? "reduced" : "full";
  sound.textContent = record.soundEnabled ? "Sound on" : "Sound off";
  sound.ariaPressed = String(record.soundEnabled);
  motion.textContent = `Reduced motion ${reduce ? "on" : "off"}`;
  motion.ariaPressed = String(reduce);
}

function tone(frequency = 220) {
  if (!record.soundEnabled) return;
  try {
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + .05);
  } catch {}
}

function select(lane, focus = false) {
  if (!game || pauses.size || !selectLane(game, lane)) return;
  lanes.forEach((button, index) => {
    const chosen = index + 1 === game.choice;
    button.ariaChecked = String(chosen);
    button.tabIndex = chosen ? 0 : -1;
  });
  lock.textContent = `Lock lane ${game.choice}`;
  if (focus) lanes[lane - 1].focus({ preventScroll: true });
}

function cueWords(cue) {
  const upper = direction(cue.upper).toLowerCase();
  const wind = direction(cue.wind, "GUST").toLowerCase();
  const lower = direction(cue.lower, "twig").toLowerCase();
  return `${cue.start}, ${upper}, ${wind}, ${lower} = lane ${cue.landing}.`;
}

function blossomPosition(cue, local, phase) {
  let node = 0, fraction = 0;
  if (phase === "commit" && local >= 3_200) node = 1;
  else if (phase === "fall" || phase === "verdict") {
    const progress = Math.max(0, Math.min(2, (local - DEADLINE_MS) / (VERDICT_MS - DEADLINE_MS) * 2));
    if (reduced()) node = Math.min(3, 1 + Math.floor((local - DEADLINE_MS) / 800));
    else { node = Math.min(2, 1 + Math.floor(progress)); fraction = progress - node + 1; }
  }
  const next = Math.min(3, node + 1), heights = [12, 34, 56, 79];
  const lane = cue.nodes[node] + (cue.nodes[next] - cue.nodes[node]) * fraction;
  const height = heights[node] + (heights[next] - heights[node]) * fraction;
  bloom.style.setProperty("--x", `${(lane - .5) * 20}%`);
  bloom.style.setProperty("--y", `${height}%`);
}

function message(phase, cue) {
  if (phase === "start") return `Bloom ${game.round + 1} begins in lane ${cue.start}.`;
  if (phase === "branch") return `Upper branch ${cue.upper < 0 ? "bends left" : "bends right"}. Keep reading.`;
  if (phase === "wind") return cueWords(cue);
  if (phase === "commit") return "Where will it land?";
  if (phase === "fall") return `Lane ${game.locked} locked.`;
  const mark = game.trace.at(-1);
  return mark.caught ? `Lucky landing! +${mark.points}. ${cueWords(cue)}` : `It landed in lane ${cue.landing}. ${cueWords(cue)}`;
}

function render(force = false) {
  if (!game || game.ended) return;
  const cue = CUES[game.round], phase = phaseAt(game);
  const local = game.time - game.round * ROUND_MS;
  progress.textContent = `Bloom ${game.round + 1} of 6`;
  score.textContent = String(game.score);
  upperArrow.textContent = cue.upper < 0 ? "←" : "→";
  upperLabel.textContent = cue.upper < 0 ? "BENDS LEFT" : "BENDS RIGHT";
  windArrow.textContent = cue.wind < 0 ? "←" : cue.wind > 0 ? "→" : "—";
  windLabel.textContent = cue.wind < 0 ? "LEFT GUST" : cue.wind > 0 ? "RIGHT GUST" : "STILL AIR";
  lowerLabel.textContent = cue.lower < 0 ? "LEFT TWIG" : cue.lower > 0 ? "RIGHT TWIG" : "STRAIGHT TWIG";
  $("upper-label").parentElement.hidden = local < 800;
  $("wind-label").parentElement.hidden = local < 1_600;
  blossomPosition(cue, local, phase);
  const canCommit = !pauses.size && game.locked === null && local >= COMMIT_MS && local < DEADLINE_MS;
  lock.disabled = !canCommit;
  lock.textContent = game.locked === null ? `Lock lane ${game.choice}` : `Lane ${game.locked} locked`;
  lanes.forEach((button, index) => {
    const lane = index + 1;
    button.disabled = Boolean(pauses.size || game.locked !== null);
    button.ariaChecked = String(lane === game.choice);
    button.tabIndex = lane === game.choice ? 0 : -1;
    button.classList.toggle("locked", lane === game.locked);
    button.classList.toggle("landed", phase === "verdict" && lane === cue.landing);
    button.classList.toggle("missed", phase === "verdict" && lane === game.locked && lane !== cue.landing);
  });
  const key = `${game.round}:${phase}:${game.locked}`;
  if (force || key !== lastMessage) {
    live.textContent = message(phase, cue);
    lastMessage = key;
  }
  if (phase !== lastPhase && phase === "verdict") tone();
  lastPhase = phase;
}

function tick(now) {
  if (pauses.size || !game || game.ended) return;
  updateGame(game, now - lastAt);
  lastAt = now;
  if (game.ended) finish();
  else { render(); frame = requestAnimationFrame(tick); }
}

function startRun() {
  clearTimeout(tutorialTimer);
  tutorial.hidden = true;
  resultCard.hidden = true;
  panel.hidden = false;
  game = createGame();
  finalResult = null;
  lastMessage = lastPhase = "";
  shareStatus.textContent = "";
  copy.hidden = true;
  select(3);
  render(true);
  if (pauses.size) {
    resumeNote.hidden = false;
    resumeNote.textContent = "Paused.";
    return;
  }
  lastAt = performance.now();
  frame = requestAnimationFrame(tick);
  lanes[2].focus({ preventScroll: true });
}

function begin() {
  cancelAnimationFrame(frame);
  clearTimeout(resultTimer);
  pauses.clear();
  intro.hidden = true;
  resultCard.hidden = true;
  trackGameEvent("one-lucky-bloom", "play-started");
  if (!record.tutorialSeen) {
    tutorial.hidden = false;
    skip.focus({ preventScroll: true });
    tutorialTimer = setTimeout(startRun, 4_000);
  } else startRun();
}

function finish() {
  cancelAnimationFrame(frame);
  trackGameEvent("one-lucky-bloom", "play-completed");
  finalResult = summarize(game);
  shareText = createShareText(finalResult);
  const saved = completeRecord(storage, record, finalResult);
  record = saved.record;
  if (!saved.available) showStorageFailure();
  $("result-title").textContent = resultBand(finalResult.score);
  $("final-score").textContent = `${finalResult.score} / 600`;
  $("final-catches").textContent = `${finalResult.catches} of 6 blossoms found your lane.`;
  $("ledger").innerHTML = finalResult.trace.map((mark) =>
    `<li class="${mark.caught ? "hit" : "miss"}" aria-label="Round ${mark.round}: chose lane ${mark.chosen}, landed lane ${mark.landing}, ${mark.caught ? "catch" : "miss"}, timing ${mark.tier}"><strong>${mark.caught ? "✓" : "·"}</strong><small>${mark.chosen}→${mark.landing} · ${mark.tier}</small></li>`
  ).join("");
  $("best-note").textContent = saved.newBest ? "New personal best." : saved.matchedBest ? "Matched your best." : `Personal best: ${record.bestScore} / 600.`;
  panel.hidden = true;
  resultCard.hidden = false;
  resultTimer = setTimeout(() => retry.focus({ preventScroll: true }), reduced() ? 0 : 2_500);
}

function stopResumeCue() {
  clearTimeout(resumeTimer);
  resumeNote.hidden = true;
}

function pause(reason) {
  pauses.delete("resume");
  pauses.add(reason);
  cancelAnimationFrame(frame);
  stopResumeCue();
  if (!game || game.ended) return;
  resumeNote.hidden = false;
  resumeNote.textContent = "Paused.";
  render();
}

function resume(reason) {
  pauses.delete(reason);
  if (pauses.size || !game || game.ended) return;
  pauses.add("resume");
  render();
  let count = reduced() ? 0 : 3;
  resumeNote.hidden = false;
  const go = () => {
    stopResumeCue();
    pauses.delete("resume");
    lastAt = performance.now();
    render();
    frame = requestAnimationFrame(tick);
  };
  const cue = () => {
    if (count > 0) {
      resumeNote.textContent = String(count--);
      resumeTimer = setTimeout(cue, 1_000);
    } else {
      resumeNote.textContent = "Ready";
      resumeTimer = setTimeout(go, reduced() ? 350 : 250);
    }
  };
  cue();
}

async function copyChallenge() {
  try {
    await navigator.clipboard.writeText(shareText);
    shareStatus.textContent = "Challenge copied.";
    copy.hidden = true;
  } catch {
    shareStatus.textContent = "Couldn’t open sharing. Copy the challenge instead.";
    copy.hidden = false;
  }
}

async function shareRun() {
  trackGameEvent("one-lucky-bloom", "share-triggered");
  shareStatus.textContent = "";
  copy.hidden = true;
  const text = shareText;
  if (!navigator.share) return copyChallenge();
  try { await navigator.share({ text }); }
  catch (error) {
    if (error?.name === "AbortError") return;
    shareStatus.textContent = "Couldn’t open sharing. Copy the challenge instead.";
    copy.hidden = false;
  }
}

lanes.forEach((button, index) => button.addEventListener("click", () => select(index + 1)));
lock.addEventListener("click", () => { if (!pauses.size && commitLane(game)) { tone(480); render(true); } });
window.addEventListener("keydown", (event) => {
  if (!game || game.ended || pauses.size || event.repeat || isEditableTarget(event.target)) return;
  let lane;
  if (/^[1-5]$/.test(event.key)) lane = Number(event.key);
  else if (event.key === "ArrowLeft") lane = Math.max(1, game.choice - 1);
  else if (event.key === "ArrowRight") lane = Math.min(5, game.choice + 1);
  else if (event.key === "Home") lane = 1;
  else if (event.key === "End") lane = 5;
  if (lane) { event.preventDefault(); select(lane, true); }
});
document.addEventListener("visibilitychange", () => document.hidden ? pause("background") : resume("background"));
document.addEventListener("nownow-feedback", (event) => {
  main.inert = Boolean(event.detail);
  if (event.detail) { main.setAttribute("aria-hidden", "true"); pause("feedback"); }
  else { main.removeAttribute("aria-hidden"); resume("feedback"); }
});
startButton.addEventListener("click", begin);
skip.addEventListener("click", startRun);
retry.addEventListener("click", begin);
share.addEventListener("click", shareRun);
copy.addEventListener("click", copyChallenge);
sound.addEventListener("click", () => { saveSettings({ soundEnabled: !record.soundEnabled }); renderSettings(); });
motion.addEventListener("click", () => { saveSettings({ reduceMotionOverride: !reduced() }); renderSettings(); });
$("reset-data").addEventListener("click", () => {
  if (!confirm("Clear One Lucky Bloom settings and personal best?")) return;
  if (!clearRecord(storage)) showStorageFailure();
  record = { ...DEFAULT_RECORD };
  renderSettings();
  startButton.textContent = "Try your luck";
  if (!resultCard.hidden) $("best-note").textContent = "Personal best: 0 / 600.";
});

if (CUES.length !== 6 || CUES.some((cue) => cue.nodes?.length !== 4 || cue.landing < 1 || cue.landing > 5)) {
  intro.innerHTML = '<h2>This bloom lost its way. Reload the game.</h2><button class="primary">Reload</button>';
  intro.lastChild.onclick = () => location.reload();
} else {
  if (!loaded.available) showStorageFailure();
  startButton.textContent = record.playsCompleted > 0 ? "Play again" : "Try your luck";
  renderSettings();
}
