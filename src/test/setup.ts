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

  // Capture is a no-op here - there is no pointer to capture - but every
  // pointer-driven component calls them, so they are defined once rather than
  // stubbed in each test file.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
