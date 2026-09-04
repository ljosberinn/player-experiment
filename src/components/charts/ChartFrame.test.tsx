import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CHART_MARGIN, ChartFrame } from "./ChartFrame";

const WIDTH = 400;
const HEIGHT = 200;

/**
 * The observer callbacks the frame has registered, so a test can resize.
 *
 * The setup file's `ResizeObserver` never calls back - jsdom lays nothing out
 * for it to report - so a test with an opinion about a size stubs the size and
 * fires the callback itself, the way `BrowseView.test.tsx` does.
 */
let resizes: Array<() => void> = [];

/** What the stubbed layout currently reports, so a test can change it. */
let measured = { width: WIDTH, height: HEIGHT };

beforeEach(() => {
  resizes = [];
  measured = { width: WIDTH, height: HEIGHT };
  for (const [property, of] of [
    ["clientWidth", "width"],
    ["clientHeight", "height"],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => measured[of],
    });
  }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizes.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The plot rect the frame handed its children, as the child recorded it. */
function plot(): { width: number; height: number } {
  const rect = screen.getByTestId("plot");
  return {
    width: Number(rect.getAttribute("width")),
    height: Number(rect.getAttribute("height")),
  };
}

describe("ChartFrame", () => {
  test("hands its children the measured size less the margins", () => {
    // The margins are the frame's business and not the chart's: a primitive
    // that had to subtract them itself would be a second place holding the
    // axis widths, and the two would drift the first time a label grew.
    render(
      <ChartFrame label="Plays per month">
        {({ width, height }) => <rect data-testid="plot" width={width} height={height} />}
      </ChartFrame>,
    );

    expect(plot()).toStrictEqual({
      width: WIDTH - CHART_MARGIN.left - CHART_MARGIN.right,
      height: HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom,
    });
  });

  test("places every axis tick at the offset it arrived with", () => {
    // Ticks reach the frame already positioned, from `scales.ts`. Recomputing
    // a position here would mean the axis and the marks it labels each divide
    // the plot on their own, which is how a bar comes to sit between two
    // gridlines instead of on one.
    render(
      <ChartFrame
        label="Plays per month"
        xTicks={[
          { offset: 0, label: "Jan" },
          { offset: 100, label: "Feb" },
        ]}
      >
        {() => null}
      </ChartFrame>,
    );

    expect(screen.getByText("Jan").getAttribute("x")).toBe("0");
    expect(screen.getByText("Feb").getAttribute("x")).toBe("100");
  });

  test("draws its empty message instead of a plot of nothing", () => {
    // Every panel has an empty case - a filter that matched nothing, a library
    // with no plays yet - and a chart drawn from no data is blank axes, which
    // reads as broken rather than as empty.
    render(
      <ChartFrame label="Plays per month" empty="No plays in this range">
        {() => <rect data-testid="plot" />}
      </ChartFrame>,
    );

    expect(screen.getByText("No plays in this range")).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).not.toBeInTheDocument();
  });

  test("stands its skeleton in front of the empty message while loading", () => {
    // An aggregate that has not landed is not an aggregate of nothing, and the
    // table's skeleton rows make the same argument: telling the user there are
    // no plays and then correcting it a frame later is worse than saying
    // nothing yet.
    render(
      <ChartFrame label="Plays per month" loading empty="No plays in this range">
        {() => <rect data-testid="plot" />}
      </ChartFrame>,
    );

    expect(screen.queryByText("No plays in this range")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-skeleton")).toBeInTheDocument();
  });

  test("swaps the chart for the table a panel handed it", async () => {
    // The toggle lives here so no panel has to remember it, which is the same
    // argument the `role="img"` label makes: a chart nobody can read the
    // numbers out of is a chart with an accessibility gap per panel rather
    // than one solved once.
    render(
      <ChartFrame label="Plays per month" table={<caption>the numbers</caption>}>
        {() => <rect data-testid="plot" />}
      </ChartFrame>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));

    expect(screen.getByText("the numbers")).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).not.toBeInTheDocument();
  });

  test("follows the section when the window is resized", () => {
    // The sidebar collapsing, the window being dragged wider: a chart measured
    // once at mount keeps the plot it was born with and overflows or leaves a
    // gap for the rest of the session.
    render(
      <ChartFrame label="Plays per month">
        {({ width, height }) => <rect data-testid="plot" width={width} height={height} />}
      </ChartFrame>,
    );

    measured = { width: 800, height: 300 };
    act(() => {
      for (const resize of resizes) {
        resize();
      }
    });

    expect(plot()).toStrictEqual({
      width: 800 - CHART_MARGIN.left - CHART_MARGIN.right,
      height: 300 - CHART_MARGIN.top - CHART_MARGIN.bottom,
    });
  });
});
