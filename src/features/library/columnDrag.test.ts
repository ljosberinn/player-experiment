import { describe, expect, it } from "vitest";
import {
  CELL_PADDING_PX,
  columnDropIndex,
  DRAG_THRESHOLD_PX,
  draggedWidth,
  fittedWidth,
  isDrag,
} from "./columnDrag";

describe("telling a header click from a header drag", () => {
  it("treats a small movement as a click, not a drag", () => {
    // A press that shifts by a pixel or two is someone clicking to sort, not
    // someone starting to reorder.
    expect(isDrag(100, 100)).toBe(false);
    expect(isDrag(100, 103)).toBe(false);
  });

  it("becomes a drag at the threshold, in either direction", () => {
    expect(isDrag(100, 100 + DRAG_THRESHOLD_PX)).toBe(true);
    expect(isDrag(100, 100 - DRAG_THRESHOLD_PX)).toBe(true);
  });
});

describe("where a dragged column lands", () => {
  // Three 100px columns, side by side.
  const bounds = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
    { left: 200, right: 300 },
  ];

  it("counts by midpoint, so a column swaps halfway across its neighbour", () => {
    // Dragging the first column: past the midpoint of the second (150) it
    // goes after it, not once it has cleared the whole column.
    expect(columnDropIndex(bounds, 0, 140)).toBe(0);
    expect(columnDropIndex(bounds, 0, 160)).toBe(1);
  });

  it("ignores the dragged column's own width", () => {
    // Otherwise a wide column being dragged shifts the answer by its own size
    // and never lands where the pointer is.
    expect(columnDropIndex(bounds, 1, 10)).toBe(0);
    expect(columnDropIndex(bounds, 1, 260)).toBe(2);
  });

  it("clamps to the ends rather than running past them", () => {
    expect(columnDropIndex(bounds, 0, -500)).toBe(0);
    expect(columnDropIndex(bounds, 0, 5000)).toBe(2);
  });

  it("is a no-op index when nothing has moved far enough", () => {
    expect(columnDropIndex(bounds, 1, 150)).toBe(1);
  });
});

describe("dragging a divider", () => {
  it("follows the pointer", () => {
    expect(draggedWidth(200, 500, 560, 40)).toBe(260);
    expect(draggedWidth(200, 500, 440, 40)).toBe(140);
  });

  it("stops at the minimum rather than going negative", () => {
    // A zero-width column is indistinguishable from a hidden one, except that
    // there is no divider left to drag it back out with.
    expect(draggedWidth(200, 500, 100, 40)).toBe(40);
  });
});

describe("fitting a column to its contents", () => {
  it("takes the widest of them, plus the padding a cell carries", () => {
    expect(fittedWidth([40, 180, 96], 40)).toBe(180 + CELL_PADDING_PX);
  });

  it("rounds up, because a width rounded down clips what it measured", () => {
    expect(fittedWidth([180.2], 40)).toBe(Math.ceil(180.2 + CELL_PADDING_PX));
  });

  it("never goes below the minimum a column can be dragged to", () => {
    // An empty column - every visible row's value is blank - still has to keep
    // a divider wide enough to grab.
    expect(fittedWidth([], 40)).toBe(40);
    expect(fittedWidth([0], 40)).toBe(40);
  });
});
