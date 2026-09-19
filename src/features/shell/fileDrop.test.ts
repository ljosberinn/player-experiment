import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOver, registerDropTarget, routeFileDrop } from "./fileDrop";

/**
 * Routing an OS drop to what is under it.
 *
 * The arithmetic is the whole of this: no screenshot can show that a position
 * in physical pixels was converted before it was tested against a rect in CSS
 * pixels, and getting it wrong misses the target on exactly the machines the
 * developer's does not resemble.
 */

/** An element that claims `box`, which jsdom otherwise reports as all zeroes. */
function square(box: { left: number; top: number; width: number; height: number }): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      width: box.width,
      height: box.height,
      x: box.left,
      y: box.top,
    }) as DOMRect;
  return element;
}

function at(x: number, y: number): PhysicalPosition {
  return new PhysicalPosition({ x, y });
}

function enter(x: number, y: number, paths: string[] = ["C:/art/sleeve.png"]): DragDropEvent {
  return { type: "enter", paths, position: at(x, y) };
}

function over(x: number, y: number): DragDropEvent {
  return { type: "over", position: at(x, y) };
}

function drop(x: number, y: number, paths: string[] = ["C:/art/sleeve.png"]): DragDropEvent {
  return { type: "drop", paths, position: at(x, y) };
}

describe("isOver", () => {
  const element = square({ left: 200, top: 100, width: 100, height: 50 });

  it("divides the physical position by the pixel ratio", () => {
    // The element's CSS rect is the same at any scale; what moves is the
    // physical position that lands on it, which doubles at 200%.
    expect(isOver(element, { x: 250, y: 120 }, 1)).toBe(true);
    expect(isOver(element, { x: 500, y: 240 }, 2)).toBe(true);
    // Undivided, a drop at 200% lands half a window up and to the left of
    // where the pointer was - which is the whole of this arithmetic.
    expect(isOver(element, { x: 250, y: 120 }, 2)).toBe(false);
  });

  it("takes the top left corner and not the bottom right", () => {
    expect(isOver(element, { x: 200, y: 100 }, 1)).toBe(true);
    expect(isOver(element, { x: 300, y: 150 }, 1)).toBe(false);
  });
});

function dropTarget() {
  return {
    element: square({ left: 0, top: 0, width: 100, height: 100 }),
    onHover: vi.fn(),
    onDrop: vi.fn(),
  };
}

describe("routing a drag to the registered target", () => {
  let target = dropTarget();

  beforeEach(() => {
    target = dropTarget();
  });

  it("hovers once on the way in and once on the way out", () => {
    const off = registerDropTarget(target);

    routeFileDrop(enter(50, 50), 1);
    routeFileDrop(over(51, 50), 1);
    routeFileDrop(over(52, 50), 1);

    // `over` fires on every pointer move; a target that heard each one would
    // re-render the dialog for a pointer crossing it.
    expect(target.onHover.mock.calls).toEqual([[true]]);

    routeFileDrop(over(400, 50), 1);
    routeFileDrop(over(401, 50), 1);

    expect(target.onHover.mock.calls).toEqual([[true], [false]]);
    off();
  });

  it("drops the paths on the target it landed on, and not on one it missed", () => {
    const off = registerDropTarget(target);

    routeFileDrop(enter(50, 50), 1);
    routeFileDrop(drop(50, 50, ["C:/art/one.png"]), 1);

    expect(target.onDrop).toHaveBeenCalledWith(["C:/art/one.png"]);
    // And the outline goes with the drag, dropped on or not.
    expect(target.onHover).toHaveBeenLastCalledWith(false);

    routeFileDrop(drop(400, 50, ["C:/art/two.png"]), 1);

    expect(target.onDrop).toHaveBeenCalledTimes(1);
    off();
  });

  it("clears the hover when the drag leaves the window", () => {
    const off = registerDropTarget(target);

    routeFileDrop(enter(50, 50), 1);
    routeFileDrop({ type: "leave" }, 1);

    expect(target.onHover).toHaveBeenLastCalledWith(false);
    off();
  });

  it("does nothing once the target has unregistered", () => {
    registerDropTarget(target)();

    routeFileDrop(enter(50, 50), 1);
    routeFileDrop(drop(50, 50), 1);

    expect(target.onHover).not.toHaveBeenCalled();
    expect(target.onDrop).not.toHaveBeenCalled();
  });
});
