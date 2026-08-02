import { describe, expect, it } from "vitest";
import {
  applyClick,
  emptySelection,
  isSelected,
  pruneSelection,
  type Selection,
  selectionCount,
} from "./selection";

/** Rows 0..n map to ids 100..100+n, so index and id are never confusable. */
const idsInRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => 100 + from + i);

const selected = (ids: number[], anchorIndex: number | null = null): Selection => ({
  ids: new Set(ids),
  anchorIndex,
});

describe("applyClick", () => {
  it("replaces the selection on a plain click and sets the anchor", () => {
    const next = applyClick(selected([100, 101], 0), 5, 105, {}, idsInRange);

    expect([...next.ids]).toEqual([105]);
    expect(next.anchorIndex).toBe(5);
  });

  it("adds an unselected row on ctrl-click", () => {
    const next = applyClick(selected([100], 0), 3, 103, { meta: true }, idsInRange);

    expect([...next.ids].sort()).toEqual([100, 103]);
    expect(next.anchorIndex).toBe(3);
  });

  it("removes an already selected row on ctrl-click", () => {
    const next = applyClick(selected([100, 103], 0), 3, 103, { meta: true }, idsInRange);

    expect([...next.ids]).toEqual([100]);
  });

  it("selects the inclusive range on shift-click", () => {
    const next = applyClick(selected([102], 2), 5, 105, { shift: true }, idsInRange);

    expect([...next.ids]).toEqual([102, 103, 104, 105]);
  });

  it("ranges backwards just as well", () => {
    const next = applyClick(selected([105], 5), 2, 102, { shift: true }, idsInRange);

    expect([...next.ids]).toEqual([102, 103, 104, 105]);
  });

  it("keeps the anchor across a shift-click so the range can be resized", () => {
    const first = applyClick(selected([102], 2), 5, 105, { shift: true }, idsInRange);
    const shrunk = applyClick(first, 3, 103, { shift: true }, idsInRange);

    expect(shrunk.anchorIndex).toBe(2);
    expect([...shrunk.ids]).toEqual([102, 103]);
  });

  it("replaces on plain shift-click but unions on ctrl+shift-click", () => {
    const base = selected([200, 201], 2);

    const replaced = applyClick(base, 4, 104, { shift: true }, idsInRange);
    expect([...replaced.ids]).toEqual([102, 103, 104]);

    const unioned = applyClick(base, 4, 104, { shift: true, meta: true }, idsInRange);
    expect([...unioned.ids].sort((a, b) => a - b)).toEqual([102, 103, 104, 200, 201]);
  });

  it("falls back to a plain click when shift is held with no anchor", () => {
    const next = applyClick(emptySelection, 4, 104, { shift: true }, idsInRange);

    expect([...next.ids]).toEqual([104]);
    expect(next.anchorIndex).toBe(4);
  });
});

describe("selection helpers", () => {
  it("reports membership and size", () => {
    const selection = selected([100, 101]);

    expect(isSelected(selection, 100)).toBe(true);
    expect(isSelected(selection, 999)).toBe(false);
    expect(selectionCount(selection)).toBe(2);
  });

  it("drops ids that no longer exist", () => {
    const pruned = pruneSelection(selected([100, 101, 102], 1), new Set([100, 102]));

    expect([...pruned.ids]).toEqual([100, 102]);
    expect(pruned.anchorIndex).toBe(1);
  });

  it("returns the same object when nothing was pruned", () => {
    const selection = selected([100, 101], 0);

    expect(pruneSelection(selection, new Set([100, 101, 102]))).toBe(selection);
  });
});
