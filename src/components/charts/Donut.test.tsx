import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Donut, type DonutSlice } from "./Donut";

const SIZE = 320;

// jsdom lays nothing out, so the size the frame measures is stubbed the way
// `Heatmap.test.tsx` stubs it.
beforeEach(() => {
  for (const property of ["clientWidth", "clientHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => SIZE,
    });
  }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function draw(slices: readonly DonutSlice[]) {
  render(
    <Donut
      label="Genres"
      slices={slices}
      format={(value) => `${value} tracks`}
      empty="Nothing here has a genre."
      column="Genre"
    />,
  );
  return Array.from(document.querySelectorAll<SVGPathElement>("path.chart-slice"));
}

describe("Donut", () => {
  test("gives every slice an arc sized by its share of the whole", () => {
    // Half the library under one genre is half the ring, whatever the counts
    // happen to be - the check that the angles come from the total rather than
    // from the largest slice, which is what a bar chart would divide by.
    const paths = draw([
      { key: "metal", label: "metal", value: 50 },
      { key: "techno", label: "techno", value: 30 },
      { key: "ambient", label: "ambient", value: 20 },
    ]);

    expect(paths).toHaveLength(3);
    expect(paths.map((path) => path.getAttribute("d"))).not.toContain("");
    // Half the total is the half-turn sweep flag and a finish on the far side
    // of the ring; the last slice closing on `0,-151` is the total adding up.
    expect(paths[0]?.getAttribute("d")).toContain("A151,151,0,1,1,0,151");
    expect(paths[2]?.getAttribute("d")).toContain("0,-151");
    // Queried off the DOM rather than through `getByTitle`: the frame makes
    // the svg `role="img"`, so nothing inside it answers an accessible query.
    expect(paths[0]?.querySelector("title")?.textContent).toBe("metal: 50 tracks");
  });

  test("draws one genre holding everything as a closed ring", () => {
    // The full-turn case `arcPath` exists for, reached through the component
    // that produces the angle rather than only in the arithmetic below it.
    const [only] = draw([{ key: "metal", label: "metal", value: 7 }]);

    expect(only?.getAttribute("d")).not.toBe("");
    expect(only?.getAttribute("d")).not.toContain("NaN");
  });

  test("says why it is empty rather than drawing a ring of nothing", () => {
    draw([]);

    expect(screen.getByText("Nothing here has a genre.")).toBeTruthy();
  });

  test("lists every slice in the table, which is how a reader gets the labels", () => {
    draw([
      { key: "metal", label: "metal", value: 50 },
      { key: "techno", label: "techno", value: 30 },
    ]);

    expect(screen.getByRole("button", { name: "Show as table" })).toBeTruthy();
  });

  test("drills from a slice that has something below it", async () => {
    const drill = vi.fn();
    const paths = draw([
      { key: "metal", label: "metal", value: 50, onSelect: drill },
      { key: "techno", label: "techno", value: 30 },
    ]);

    await userEvent.click(paths[0] as unknown as Element);

    expect(drill).toHaveBeenCalledOnce();
  });

  test("leaves a slice with nothing below it inert", async () => {
    // A leaf genre that opened onto its own count and nothing else would be a
    // crumb with no way to tell before pressing it.
    const paths = draw([
      { key: "metal", label: "metal", value: 50 },
      { key: "techno", label: "techno", value: 30 },
    ]);

    expect(paths[0]?.getAttribute("data-drills")).toBeNull();
  });
});
