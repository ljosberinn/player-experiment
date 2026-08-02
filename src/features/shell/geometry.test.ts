import { describe, expect, it } from "vitest";
import { type Geometry, isOnScreen, MIN_HEIGHT, MIN_WIDTH, parse, serialize } from "./geometry";

const geometry: Geometry = { x: 100, y: 80, width: 1200, height: 800, maximized: false };
const screen = { x: 0, y: 0, width: 1920, height: 1080 };

describe("geometry", () => {
  it("round-trips", () => {
    expect(parse(serialize(geometry))).toEqual(geometry);
  });

  it("reads nothing stored as nothing to restore", () => {
    // Null rather than a default: leave the window where the OS put it.
    expect(parse(null)).toBeNull();
  });

  it("refuses anything it cannot trust", () => {
    expect(parse("not json")).toBeNull();
    expect(parse("42")).toBeNull();
    expect(parse("null")).toBeNull();
    expect(parse('{"x":1}')).toBeNull();
    expect(parse('{"x":1,"y":2,"width":null,"height":600}')).toBeNull();
    expect(parse('{"x":"left","y":2,"width":800,"height":600}')).toBeNull();
  });

  it("clamps a stored size below what the chrome needs", () => {
    // A size stored before a layout change is exactly how a window ends up
    // too small to use.
    const tiny = parse('{"x":0,"y":0,"width":10,"height":10}');

    expect(tiny).toEqual({ x: 0, y: 0, width: MIN_WIDTH, height: MIN_HEIGHT, maximized: false });
  });

  it("treats a missing maximized flag as not maximized", () => {
    expect(parse('{"x":0,"y":0,"width":800,"height":600}')?.maximized).toBe(false);
    expect(parse('{"x":0,"y":0,"width":800,"height":600,"maximized":"yes"}')?.maximized).toBe(
      false,
    );
  });

  it("accepts a negative position, which a second monitor to the left has", () => {
    const left = parse('{"x":-1800,"y":40,"width":800,"height":600}');

    expect(left?.x).toBe(-1800);
  });
});

describe("isOnScreen", () => {
  it("accepts a window on the monitor", () => {
    expect(isOnScreen(geometry, [screen])).toBe(true);
  });

  it("rejects a window on a monitor that is no longer attached", () => {
    // The ordinary way a remembered position becomes unreachable.
    expect(isOnScreen({ ...geometry, x: -2000 }, [screen])).toBe(false);
    expect(isOnScreen({ ...geometry, x: 4000 }, [screen])).toBe(false);
  });

  it("finds the window on whichever monitor it is on", () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1080 };

    expect(isOnScreen({ ...geometry, x: 2000 }, [screen, second])).toBe(true);
  });

  it("keeps a window deliberately parked at an edge", () => {
    // Mostly off-screen is still draggable back, so this must not be moved.
    expect(isOnScreen({ ...geometry, x: 1800 }, [screen])).toBe(true);
  });

  it("rejects a window whose title bar is below the screen", () => {
    // Off the bottom there is nothing left to grab.
    expect(isOnScreen({ ...geometry, y: 1060 }, [screen])).toBe(false);
  });

  it("has nowhere to check against with no monitors", () => {
    expect(isOnScreen(geometry, [])).toBe(false);
  });
});
