import { describe, expect, it } from "vitest";
import { nudgeTarget } from "./reorder";

describe("nudgeTarget", () => {
  it("moves one row up past the row above it", () => {
    // [A B C D], moving C: the index names the row it lands in front of.
    expect(nudgeTarget([2], "up", 4)).toBe(1);
  });

  it("moves one row down past the row below it", () => {
    // Not 2. The backend takes the moved row out before resolving the index,
    // so `last + 1` is where the row already is and nothing would happen.
    expect(nudgeTarget([1], "down", 4)).toBe(3);
  });

  it("moves a contiguous block as one", () => {
    expect(nudgeTarget([2, 3], "up", 5)).toBe(1);
    expect(nudgeTarget([1, 2], "down", 5)).toBe(4);
  });

  it("reads the indices in any order", () => {
    expect(nudgeTarget([3, 2], "up", 5)).toBe(1);
  });

  it("refuses to move the top row up or the bottom row down", () => {
    expect(nudgeTarget([0], "up", 4)).toBeNull();
    expect(nudgeTarget([3], "down", 4)).toBeNull();
    expect(nudgeTarget([0, 1], "up", 4)).toBeNull();
    expect(nudgeTarget([2, 3], "down", 4)).toBeNull();
  });

  it("refuses a scattered selection rather than collapsing it into a block", () => {
    // A drop shows where the block is going before the mouse comes up; a nudge
    // shows nothing, and there is no undo for a reorder.
    expect(nudgeTarget([0, 2], "down", 4)).toBeNull();
    expect(nudgeTarget([0, 2], "up", 4)).toBeNull();
  });

  it("has nothing to move with nothing selected", () => {
    expect(nudgeTarget([], "up", 4)).toBeNull();
    expect(nudgeTarget([], "down", 4)).toBeNull();
  });
});
