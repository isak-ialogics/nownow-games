const KEY_ACTIONS = Object.freeze({
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  W: "up",
  s: "down",
  S: "down",
  a: "left",
  A: "left",
  d: "right",
  D: "right",
  " ": "activate",
  Enter: "activate",
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function actionForKey(key) {
  return KEY_ACTIONS[key] ?? null;
}

export function relativePoint(surface, event) {
  const bounds = surface.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);

  return Object.freeze({
    x: clamp((event.clientX - bounds.left) / width),
    y: clamp((event.clientY - bounds.top) / height),
  });
}

export function createInputController(
  surface,
  {
    onInput,
    keyboardTarget = globalThis.window,
    visibilityTarget = globalThis.document,
  } = {},
) {
  if (!surface?.addEventListener || !keyboardTarget?.addEventListener) {
    throw new TypeError(
      "Input controller requires event targets for the surface and keyboard.",
    );
  }

  if (typeof onInput !== "function") {
    throw new TypeError("Input controller requires an onInput callback.");
  }

  const activePointers = new Map();
  const pressedKeys = new Set();

  const emit = (input) => onInput(Object.freeze(input));

  const onKeyDown = (event) => {
    const action = actionForKey(event.key);
    if (!action) return;

    event.preventDefault();
    pressedKeys.add(event.key);
    emit({
      source: "keyboard",
      action,
      phase: event.repeat ? "repeat" : "start",
    });
  };

  const onKeyUp = (event) => {
    const action = actionForKey(event.key);
    if (!action) return;

    event.preventDefault();
    pressedKeys.delete(event.key);
    emit({ source: "keyboard", action, phase: "end" });
  };

  const onPointerDown = (event) => {
    const point = relativePoint(surface, event);
    activePointers.set(event.pointerId, { start: point, last: point });
    event.preventDefault();

    try {
      surface.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic browser tests may not register a native active pointer.
    }

    surface.focus?.({ preventScroll: true });
    emit({
      source: "pointer",
      pointerType: event.pointerType || "unknown",
      action: "position",
      phase: "start",
      ...point,
      dx: 0,
      dy: 0,
    });
  };

  const onPointerMove = (event) => {
    const active = activePointers.get(event.pointerId);
    if (!active) return;

    const point = relativePoint(surface, event);
    event.preventDefault();
    emit({
      source: "pointer",
      pointerType: event.pointerType || "unknown",
      action: "position",
      phase: "move",
      ...point,
      dx: point.x - active.last.x,
      dy: point.y - active.last.y,
    });
    active.last = point;
  };

  const finishPointer = (event, phase) => {
    const active = activePointers.get(event.pointerId);
    if (!active) return;

    const point = relativePoint(surface, event);
    event.preventDefault();
    activePointers.delete(event.pointerId);

    emit({
      source: "pointer",
      pointerType: event.pointerType || "unknown",
      action: "position",
      phase,
      ...point,
      dx: point.x - active.last.x,
      dy: point.y - active.last.y,
    });

    const distance = Math.hypot(
      point.x - active.start.x,
      point.y - active.start.y,
    );
    if (phase === "end" && distance <= 0.035) {
      emit({
        source: "pointer",
        pointerType: event.pointerType || "unknown",
        action: "activate",
        phase: "start",
        ...point,
      });
    }
  };

  const resetActiveInput = (reason) => {
    if (activePointers.size === 0 && pressedKeys.size === 0) return;
    activePointers.clear();
    pressedKeys.clear();
    emit({ source: "system", action: "reset-input", phase: "cancel", reason });
  };

  const onVisibilityChange = () => {
    if (visibilityTarget.hidden) resetActiveInput("background");
  };

  const onPointerUp = (event) => finishPointer(event, "end");
  const onPointerCancel = (event) => finishPointer(event, "cancel");
  const onBlur = () => resetActiveInput("blur");

  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerCancel);
  keyboardTarget.addEventListener("keydown", onKeyDown);
  keyboardTarget.addEventListener("keyup", onKeyUp);
  keyboardTarget.addEventListener("blur", onBlur);
  visibilityTarget?.addEventListener?.("visibilitychange", onVisibilityChange);

  return Object.freeze({
    destroy() {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerCancel);
      keyboardTarget.removeEventListener("keydown", onKeyDown);
      keyboardTarget.removeEventListener("keyup", onKeyUp);
      keyboardTarget.removeEventListener("blur", onBlur);
      visibilityTarget?.removeEventListener?.(
        "visibilitychange",
        onVisibilityChange,
      );
      activePointers.clear();
      pressedKeys.clear();
    },
  });
}
