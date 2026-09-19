import { describe, expect, test } from "vitest";

import { arcPath, linearScale, niceDomain, ticks } from "./scales";

describe("niceDomain", () => {
  test("expands a domain whose values are all the same", () => {
    // A collapsed domain maps every value onto one pixel, which draws a chart
    // of nothing. One repeated value is the case a real panel hits first: a
    // library where every album shares a bitrate, a day with one play in it.
    const [min, max] = niceDomain([42, 42, 42]);

    expect(min).toBeLessThan(42);
    expect(max).toBeGreaterThan(42);
  });

  test("gives an empty series a domain rather than an infinite one", () => {
    // `Math.min()` of nothing is `Infinity`, which reaches a scale as a NaN
    // range and a chart of blank SVG. A panel whose filter matched nothing
    // renders through here on the way to its empty state.
    expect(niceDomain([])).toStrictEqual([0, 1]);
  });
});

describe("ticks", () => {
  test("carries the pixel offset of every value it names", () => {
    // An axis is laid out from these, so the offset has to arrive with the
    // label rather than being recomputed by whoever draws it - two places
    // dividing the range is two places to disagree about the margin.
    const scale = linearScale([0, 100], [0, 200]);

    expect(ticks(scale, 5)).toStrictEqual([
      { value: 0, offset: 0, label: "0" },
      { value: 20, offset: 40, label: "20" },
      { value: 40, offset: 80, label: "40" },
      { value: 60, offset: 120, label: "60" },
      { value: 80, offset: 160, label: "80" },
      { value: 100, offset: 200, label: "100" },
    ]);
  });
});

describe("arcPath", () => {
  const TAU = Math.PI * 2;

  test("draws a ring segment as two arcs joined by two lines", () => {
    // The shape a donut slice is: out along one radius, round the rim, back in
    // along the other, round the hole. Asserted as commands rather than
    // coordinates - the numbers are d3's business, the shape is this app's.
    const commands = arcPath(0, TAU / 4, 40, 70).match(/[A-Z]/g);

    expect(commands).toStrictEqual(["M", "A", "L", "A", "Z"]);
  });

  test("closes a full turn rather than collapsing it to a straight line", () => {
    // One genre holding every track is the first state a fresh library is in.
    // An SVG arc cannot express a full circle in one command - start and end
    // coincide, and the renderer draws nothing - so a whole-turn slice has to
    // come out as two half turns per edge.
    const path = arcPath(0, TAU, 40, 70);

    expect(path.match(/A/g)).toHaveLength(4);
    expect(path).not.toContain("NaN");
  });

  test("gives an empty slice no path to draw", () => {
    // A slice of zero is what a genre filtered down to nothing leaves behind,
    // and `<path d="">` is how SVG says "nothing" without a branch at the
    // call site.
    expect(arcPath(1, 1, 40, 70)).toBe("");
  });
});
