import { describe, expect, it } from "vitest";
import {
  GROUP_ROW_HEIGHT,
  groupHeight,
  groupOffsets,
  groupOfRow,
  groupRowRange,
} from "./releaseLayout";

/** Only the field the layout reads; the gutter's labels are not its business. */
function group(trackCount: number) {
  return { trackCount };
}

describe("release group layout", () => {
  it("gives a group a height that can be computed rather than measured", () => {
    // 15 + 15 padding, (n + 1) * 31 for the rows and the closing row, and the
    // 2px rule. Closed-form is the point: the virtualizer places every group
    // before any row of it has arrived.
    expect(groupHeight(1)).toBe(94);
    expect(groupHeight(10)).toBe(373);
    expect(groupHeight(10) - groupHeight(9)).toBe(GROUP_ROW_HEIGHT);
  });

  it("places each group's rows at the prefix sum of the ones before it", () => {
    expect(groupOffsets([group(2), group(1), group(3)])).toEqual([0, 2, 3]);
  });

  it("covers exactly the rows the visible groups own", () => {
    const releases = [group(2), group(1), group(3)];

    // Groups 1 and 2 own rows 2 and 3..5, so the table must fetch 2..5 - no
    // row of group 0, and nothing past the end.
    expect(groupRowRange(releases, 1, 2)).toEqual({ start: 2, end: 5 });
    expect(groupRowRange(releases, 0, 0)).toEqual({ start: 0, end: 1 });
  });

  it("asks for nothing when there is no group on screen", () => {
    expect(groupRowRange([], 0, 0)).toBeNull();
    // A group index past the end is what a shrinking list leaves behind for
    // the render between the new list and the virtualizer catching up.
    expect(groupRowRange([group(2)], 3, 4)).toBeNull();
  });

  it("skips a release that holds no rows rather than claiming one", () => {
    // A search can narrow a release to nothing between the two queries; an
    // empty group must not swallow the next group's first row.
    expect(groupRowRange([group(0), group(2)], 0, 0)).toBeNull();
    expect(groupOffsets([group(0), group(2)])).toEqual([0, 0]);
  });
});

describe("finding the group a row is in", () => {
  it("names the group that owns the row", () => {
    const releases = [group(2), group(1), group(3)];

    expect(groupOfRow(releases, 0)).toBe(0);
    expect(groupOfRow(releases, 1)).toBe(0);
    expect(groupOfRow(releases, 2)).toBe(1);
    expect(groupOfRow(releases, 5)).toBe(2);
  });

  it("skips over a group that owns no rows", () => {
    // Its offset equals the next group's, so "the last group starting at or
    // before this row" would answer with the empty one and scroll nowhere.
    expect(groupOfRow([group(0), group(2)], 0)).toBe(1);
  });

  it("falls back to the last group for a row past the end", () => {
    // A row index outliving its list is what a narrowing search leaves for the
    // render before the virtualizer catches up; scrolling to the end beats
    // throwing.
    expect(groupOfRow([group(2), group(1)], 99)).toBe(1);
    expect(groupOfRow([], 0)).toBe(0);
  });
});
