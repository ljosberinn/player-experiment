import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Bar, type BarDatum } from "./Bar";
import { CHART_MARGIN } from "./ChartFrame";

const WIDTH = 400;
const HEIGHT = 200;
const PLOT = {
  width: WIDTH - CHART_MARGIN.left - CHART_MARGIN.right,
  height: HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom,
};

// jsdom lays nothing out, so the size the frame measures is stubbed the way
// `ChartFrame.test.tsx` and `BrowseView.test.tsx` stub theirs.
beforeEach(() => {
  for (const [property, of] of [
    ["clientWidth", "width"],
    ["clientHeight", "height"],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => ({ width: WIDTH, height: HEIGHT })[of],
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

function draw(data: readonly BarDatum[], onSelect?: (index: number) => void) {
  render(
    <Bar
      label="Tracks per bitrate"
      data={data}
      format={(value) => `${value}`}
      columns={["Bitrate", "Tracks"]}
      empty="Nothing reports a bitrate."
      {...(onSelect === undefined ? {} : { onSelect })}
    />,
  );
  return Array.from(document.querySelectorAll<SVGRectElement>("rect.chart-bar"));
}

/** A bar's extent, as the four numbers a geometry assertion is about. */
function extent(rect: SVGRectElement) {
  return {
    x: Number(rect.getAttribute("x")),
    y: Number(rect.getAttribute("y")),
    width: Number(rect.getAttribute("width")),
    height: Number(rect.getAttribute("height")),
  };
}

describe("Bar", () => {
  test("gives every bar an equal band and heights in proportion", () => {
    // The x domain is the array's order, not a numeric scale: a histogram
    // with an empty bin wants the gap the caller left, and a scale over the
    // labels would close it.
    const bars = draw([
      { label: "128", value: 10 },
      { label: "192", value: 5 },
      { label: "320", value: 20 },
    ]);

    const band = PLOT.width / 3;
    expect(bars.map((bar) => extent(bar).x)).toStrictEqual([0, band, band * 2]);
    expect(extent(bars[2] as SVGRectElement).height).toBe(PLOT.height);
    expect(extent(bars[1] as SVGRectElement).height).toBeCloseTo(PLOT.height / 4);
    // Drawn from the top of the bar down to the axis, so the two add up.
    const middle = extent(bars[1] as SVGRectElement);
    expect(middle.y + middle.height).toBeCloseTo(PLOT.height);
  });

  test("draws a single datum full height rather than collapsing its domain", () => {
    // One bin is the ordinary state of a library ripped at one bitrate, and a
    // scale whose domain is [n, n] maps it to NaN.
    const bars = draw([{ label: "128", value: 7 }]);

    expect(bars).toHaveLength(1);
    expect(extent(bars[0] as SVGRectElement)).toStrictEqual({
      x: 0,
      y: 0,
      width: PLOT.width - 1,
      height: PLOT.height,
    });
  });

  test("keeps a bar visible once the bands are narrower than the gap", () => {
    // 55 years across a panel is a band under four pixels wide; a bar that
    // still gave a pixel away to the gap would be most of a bar missing.
    const bars = draw(
      Array.from({ length: 200 }, (_, index) => ({ label: `${index}`, value: index + 1 })),
    );

    // The whole band, gap and all, rather than the band less a pixel.
    expect(extent(bars[0] as SVGRectElement).width).toBeCloseTo(PLOT.width / 200);
  });

  test("says why there is nothing rather than drawing empty axes", () => {
    expect(draw([])).toHaveLength(0);
    expect(screen.getByText("Nothing reports a bitrate.")).toBeInTheDocument();
  });

  test("thins the x labels to the ones that fit", () => {
    // Every label drawn is a smudge, and a chart with no labels at all is not
    // a scale. One every few bands is what reads.
    draw(Array.from({ length: 40 }, (_, index) => ({ label: `${1980 + index}`, value: 1 })));

    const labels = Array.from(document.querySelectorAll(".chart-axis-x text")).map(
      (text) => text.textContent,
    );
    expect(labels[0]).toBe("1980");
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.length).toBeLessThan(40);
  });

  test("carries every row into the table reading, including a bin it cannot label", () => {
    // The frame owns the toggle so no chart ships without one; what this
    // asserts is that the table behind it is the whole series and not the
    // thinned axis.
    draw(Array.from({ length: 40 }, (_, index) => ({ label: `${1980 + index}`, value: index })));

    return userEvent.click(screen.getByRole("button", { name: "Show as table" })).then(() => {
      expect(screen.getAllByRole("row")).toHaveLength(41);
      expect(screen.getByRole("rowheader", { name: "1999" })).toBeInTheDocument();
    });
  });

  test("drills from a bar that counts something", async () => {
    const drill = vi.fn();
    draw(
      [
        { label: "Jul", value: 4 },
        { label: "Aug", value: 0 },
        { label: "Sep", value: 9 },
      ],
      drill,
    );
    const hits = Array.from(document.querySelectorAll<SVGRectElement>("rect[data-drills]"));

    // The whole band's height, so a short bar is as easy to hit as a tall one;
    // an empty bar has no stretch of time worth opening.
    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => Number(hit.getAttribute("height")))).toStrictEqual([
      PLOT.height,
      PLOT.height,
    ]);

    await userEvent.click(hits[1] as unknown as Element);

    expect(drill).toHaveBeenCalledExactlyOnceWith(2);
  });

  test("leaves every bar inert without a drill", () => {
    draw([{ label: "Jul", value: 4 }]);

    expect(document.querySelector("[data-drills]")).toBeNull();
  });

  test("puts the drill in the table, on the rows that have one", async () => {
    const user = userEvent.setup();
    draw(
      [
        { label: "Jul", value: 4 },
        { label: "Aug", value: 0 },
      ],
      vi.fn(),
    );

    await user.click(screen.getByRole("button", { name: "Show as table" }));

    expect(screen.getByRole("button", { name: "Jul" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aug" })).not.toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Aug" })).toBeInTheDocument();
  });

  test("draws no table buttons without a drill", async () => {
    const user = userEvent.setup();
    draw([{ label: "Jul", value: 4 }]);

    await user.click(screen.getByRole("button", { name: "Show as table" }));

    expect(screen.queryByRole("button", { name: "Jul" })).not.toBeInTheDocument();
  });

  test("reports the same bar from the chart and from the table", async () => {
    const user = userEvent.setup();
    const drill = vi.fn();
    draw(
      [
        { label: "Jul", value: 4 },
        { label: "Aug", value: 7 },
      ],
      drill,
    );

    await user.click(document.querySelectorAll("rect[data-drills]")[1] as Element);
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    await user.click(screen.getByRole("button", { name: "Aug" }));

    expect(drill.mock.calls).toStrictEqual([[1], [1]]);
  });
});
