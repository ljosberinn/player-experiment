import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * jsdom implements no `PointerEvent`.
 *
 * Without it, `fireEvent.pointerMove(el, { clientX: 120 })` produces an event
 * whose `clientX` is `null`, so a component that reads pointer coordinates
 * looks broken in tests while being correct in a browser. A `MouseEvent`
 * subclass is enough: the coordinates come from `MouseEvent`, and `pointerId`
 * is the only field beyond them that this app reads.
 */
// Reached through `globalThis` rather than `window`: lib.dom declares
// `PointerEvent` on Window, so `!("PointerEvent" in window)` narrows the
// negative branch to `never` and nothing inside it typechecks.
const runtime = globalThis as { PointerEvent?: unknown };

if (typeof window !== "undefined" && runtime.PointerEvent === undefined) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
    }
  }
  runtime.PointerEvent = PointerEventPolyfill;
}

/**
 * Pointer capture, which jsdom implements in no version.
 *
 * Outside the block above on purpose. jsdom 30 added `PointerEvent` and did
 * not add these, so gating them on the polyfill made every component that
 * captures a pointer throw the moment the event was real - a header drag, a
 * column resize. There is no pointer to capture either way, so they are
 * no-ops; what matters is that they exist.
 */
if (typeof window !== "undefined") {
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
}

/**
 * `ResizeObserver`, which jsdom implements in no version.
 *
 * A stub that observes nothing rather than a working one: jsdom has no layout,
 * so every element it could report is 0x0 and no callback would ever have
 * anything to say. What the components need is for the constructor to exist -
 * the browse grid measures its container through one, and without this the
 * whole view throws on mount.
 */
if (typeof window !== "undefined") {
  const runtimeWithObserver = globalThis as { ResizeObserver?: unknown };
  runtimeWithObserver.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * `Range.getBoundingClientRect`, which jsdom declares nowhere.
 *
 * Zero, like every other rect jsdom reports - it lays nothing out. It exists so
 * that measuring code does not throw, and so that a test with an opinion about
 * a width has something to spy on.
 */
if (typeof window !== "undefined") {
  Range.prototype.getBoundingClientRect ??= () =>
    ({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
