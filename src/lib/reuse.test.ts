import { describe, expect, it } from "vitest";
import { reuse } from "./reuse";

describe("reuse", () => {
  it("keeps the previous object when nothing in it changed", () => {
    const previous = { id: 1, title: "A", palette: [{ r: 1, g: 2, b: 3 }] };

    expect(reuse(previous, { id: 1, title: "A", palette: [{ r: 1, g: 2, b: 3 }] })).toBe(previous);
  });

  it("keeps the previous array when every element is equal", () => {
    const previous = [{ id: 1 }, { id: 2 }];

    expect(reuse(previous, [{ id: 1 }, { id: 2 }])).toBe(previous);
  });

  it("returns a new array that keeps the elements which did not change", () => {
    const previous = [
      { id: 1, count: 3 },
      { id: 2, count: 10 },
    ];

    const next = reuse(previous, [
      { id: 1, count: 3 },
      { id: 2, count: 11 },
    ]);

    expect(next).not.toBe(previous);
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toEqual({ id: 2, count: 11 });
  });

  it("treats a changed length as a change", () => {
    const previous = [{ id: 1 }];

    const next = reuse(previous, [{ id: 1 }, { id: 2 }]);

    expect(next).not.toBe(previous);
    expect(next[0]).toBe(previous[0]);
  });

  it("treats a key that moved as a change, not an equal object", () => {
    const previous: Record<string, number | undefined> = { a: 1, b: undefined };

    expect(reuse(previous, { a: 1, c: undefined })).not.toBe(previous);
  });

  it("takes null and primitives as they come", () => {
    expect(reuse<{ id: number } | null>({ id: 1 }, null)).toBeNull();
    expect(reuse<number | null>(null, 3)).toBe(3);
    expect(reuse("a", "a")).toBe("a");
  });
});
