import assert from "node:assert/strict";
import test from "node:test";

import {
  actionForKey,
  createInputController,
  relativePoint,
} from "../../shared/input.js";

class Surface extends EventTarget {
  focused = false;

  focus() {
    this.focused = true;
  }

  getBoundingClientRect() {
    return { left: 10, top: 20, width: 200, height: 100 };
  }

  setPointerCapture() {}
}

function event(type, properties = {}) {
  const instance = new Event(type, { cancelable: true });
  for (const [property, value] of Object.entries(properties)) {
    Object.defineProperty(instance, property, { configurable: true, value });
  }
  return instance;
}

test("maps both Arrow and WASD keys to deterministic actions", () => {
  assert.equal(actionForKey("ArrowLeft"), "left");
  assert.equal(actionForKey("d"), "right");
  assert.equal(actionForKey("W"), "up");
  assert.equal(actionForKey(" "), "activate");
  assert.equal(actionForKey("Escape"), null);
});

test("normalizes and clamps pointer coordinates", () => {
  const surface = new Surface();
  assert.deepEqual(relativePoint(surface, { clientX: 110, clientY: 70 }), {
    x: 0.5,
    y: 0.5,
  });
  assert.deepEqual(relativePoint(surface, { clientX: -50, clientY: 500 }), {
    x: 0,
    y: 1,
  });
});

test("emits pointer drag, keyboard, and blur recovery through one controller", () => {
  const surface = new Surface();
  const keyboard = new EventTarget();
  const visibility = new EventTarget();
  const inputs = [];
  const controller = createInputController(surface, {
    keyboardTarget: keyboard,
    visibilityTarget: visibility,
    onInput: (input) => inputs.push(input),
  });

  surface.dispatchEvent(
    event("pointerdown", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 30,
      clientY: 40,
    }),
  );
  surface.dispatchEvent(
    event("pointermove", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 170,
      clientY: 90,
    }),
  );
  surface.dispatchEvent(
    event("pointerup", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 170,
      clientY: 90,
    }),
  );

  const keyDown = event("keydown", { key: "ArrowRight", repeat: false });
  keyboard.dispatchEvent(keyDown);
  keyboard.dispatchEvent(event("blur"));

  assert.equal(surface.focused, true);
  assert.equal(keyDown.defaultPrevented, true);
  assert.deepEqual(
    inputs.map(({ source, action, phase }) => [source, action, phase]),
    [
      ["pointer", "position", "start"],
      ["pointer", "position", "move"],
      ["pointer", "position", "end"],
      ["keyboard", "right", "start"],
      ["system", "reset-input", "cancel"],
    ],
  );

  controller.destroy();
});
