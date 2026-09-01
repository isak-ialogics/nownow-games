import { createInputController } from "../../shared/input.js";
import { createRelayState, reduceRelayState } from "./state.js";

const surface = document.querySelector("#play-surface");
const signal = document.querySelector("#signal");
const eventCount = document.querySelector("#event-count");
const pointerBadge = document.querySelector("#pointer-badge");
const keyboardBadge = document.querySelector("#keyboard-badge");
const lastInput = document.querySelector("#last-input");
const positionX = document.querySelector("#position-x");
const positionY = document.querySelector("#position-y");
const history = document.querySelector("#input-history");
const restartButton = document.querySelector("#restart-button");

let state = createRelayState();

function render() {
  signal.style.left = `${state.position.x * 100}%`;
  signal.style.top = `${state.position.y * 100}%`;
  signal.dataset.pulse = state.pulseCount % 2 === 0 ? "even" : "odd";

  eventCount.textContent = String(state.eventCount).padStart(2, "0");
  eventCount.setAttribute("aria-label", `${state.eventCount} input events`);
  pointerBadge.dataset.seen = String(state.pointerSeen);
  keyboardBadge.dataset.seen = String(state.keyboardSeen);
  pointerBadge.querySelector("small").textContent = state.pointerSeen
    ? "Ready · path fired"
    : "Waiting";
  keyboardBadge.querySelector("small").textContent = state.keyboardSeen
    ? "Ready · path fired"
    : "Waiting";

  const sourceLabel =
    state.lastSource === "pointer"
      ? "Touch / pointer"
      : state.lastSource === "keyboard"
        ? "Keyboard"
        : state.lastSource === "system"
          ? "System"
          : "Waiting";
  lastInput.textContent =
    state.lastSource === "none"
      ? state.lastAction
      : `${sourceLabel}: ${state.lastAction}`;
  positionX.textContent = String(Math.round(state.position.x * 100)).padStart(
    2,
    "0",
  );
  positionY.textContent = String(Math.round(state.position.y * 100)).padStart(
    2,
    "0",
  );

  history.replaceChildren();
  const entries = state.history.length > 0 ? state.history : ["No events yet"];
  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = entry;
    history.append(item);
  }
}

const controller = createInputController(surface, {
  onInput(input) {
    state = reduceRelayState(state, input);
    render();
  },
});

restartButton.addEventListener("click", () => {
  state = reduceRelayState(state, { action: "restart" });
  render();
  surface.focus({ preventScroll: true });
});

window.addEventListener("pagehide", () => controller.destroy(), { once: true });
render();
