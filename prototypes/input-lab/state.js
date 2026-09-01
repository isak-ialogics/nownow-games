const MOVE_STEP = 0.08;

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

export function createRelayState() {
  return Object.freeze({
    position: Object.freeze({ x: 0.5, y: 0.5 }),
    eventCount: 0,
    pulseCount: 0,
    pointerSeen: false,
    keyboardSeen: false,
    lastSource: "none",
    lastAction: "Waiting for a signal",
    history: Object.freeze([]),
  });
}

function describe(input) {
  if (input.source === "system") return "Input safely reset";
  if (input.action === "position") {
    return input.phase === "move"
      ? `${input.pointerType} drag`
      : `${input.pointerType} ${input.phase}`;
  }
  if (input.action === "activate") return "pulse";
  return `${input.action} ${input.phase}`;
}

export function reduceRelayState(state, input) {
  if (input.action === "restart") return createRelayState();

  if (input.source === "system" && input.action === "reset-input") {
    const entry = "System · input safely reset";
    return Object.freeze({
      ...state,
      lastSource: "system",
      lastAction: "Input safely reset",
      history: Object.freeze([entry, ...state.history].slice(0, 4)),
    });
  }

  if (input.phase === "end" || input.phase === "cancel") return state;

  let x = state.position.x;
  let y = state.position.y;

  if (input.source === "pointer" && input.action === "position") {
    x = clamp(input.x);
    y = clamp(input.y);
  }

  if (input.source === "keyboard") {
    if (input.action === "left") x = clamp(x - MOVE_STEP);
    if (input.action === "right") x = clamp(x + MOVE_STEP);
    if (input.action === "up") y = clamp(y - MOVE_STEP);
    if (input.action === "down") y = clamp(y + MOVE_STEP);
  }

  const pointerSeen = state.pointerSeen || input.source === "pointer";
  const keyboardSeen = state.keyboardSeen || input.source === "keyboard";
  const pulseCount = state.pulseCount + (input.action === "activate" ? 1 : 0);
  const sourceLabel =
    input.source === "pointer" ? "Touch / pointer" : "Keyboard";
  const actionLabel = describe(input);
  const entry = `${sourceLabel} · ${actionLabel}`;

  return Object.freeze({
    position: Object.freeze({ x, y }),
    eventCount: state.eventCount + 1,
    pulseCount,
    pointerSeen,
    keyboardSeen,
    lastSource: input.source,
    lastAction: actionLabel,
    history: Object.freeze([entry, ...state.history].slice(0, 4)),
  });
}
