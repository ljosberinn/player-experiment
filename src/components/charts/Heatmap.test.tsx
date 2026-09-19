import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CHART_MARGIN } from "./ChartFrame";
import { Heatmap } from "./Heatmap";

const WIDTH = 400;
const HEIGHT = 200;
const PLOT = {
  width: WIDTH - CHART_MARGIN.left - CHART_MARGIN.right,
  height: HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom,
};

// jsdom lays nothing out, so the size the frame measures is stubbed the way
// `Bar.test.tsx` stubs it.
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

function draw(rows: readonly string[], columns: readonly string[], values: readonly number[]) {
  render(
    <Heatmap
      label="Plays by weekday and hour"
      rows={rows}
      columns={columns}
      values={values}
      format={(value) => `${value}`}
      corner="Day"
      empty="Nothing in this range."
    />,
  );
  return Array.from(document.querySelectorAll<SVGRectElement>("rect.chart-cell"));
}

function extent(rect: SVGRectElement) {
  return {
    x: Number(rect.getAttribute("x")),
    y: Number(rect.getAttribute("y")),
    width: Number(rect.getAttribute("width")),
    height: Number(rect.getAttribute("height")),
  };
}

describe("Heatmap", () => {
  test("lays the values out row by row, a band per row and column", () => {
    const cells = draw(["Mon", "Tue"], ["0", "1", "2"], [1, 2, 3, 4, 5, 6]);

    expect(cells).toHaveLength(6);
    const across = PLOT.width / 3;
    const down = PLOT.height / 2;
    // Row-major: the fourth value opens the second row.
    expect(extent(cells[3] as SVGRectElement)).toStrictEqual({
      x: 0,
      y: down,
      width: across - 2,
      height: down - 2,
    });
    expect(extent(cells[5] as SVGRectElement).x).toBeCloseTo(across * 2);
  });

  test("steps each cell by its share of the largest, and keeps nothing apart from little", () => {
    const cells = draw(["Mon"], ["0", "1", "2", "3", "4"], [0, 1, 50, 75, 100]);

    // One play in a hundred still takes the first step rather than rounding
    // to the colour of none.
    expect(cells.map((cell) => cell.dataset.step)).toStrictEqual(["0", "1", "2", "3", "4"]);
  });

  test("fills a single cell rather than collapsing onto nothing", () => {
    const cells = draw(["Mon"], ["0"], [7]);

    expect(extent(cells[0] as SVGRectElement)).toStrictEqual({
      x: 0,
      y: 0,
      width: PLOT.width - 2,
      height: PLOT.height - 2,
    });
    expect(cells[0]?.dataset.step).toBe("4");
  });

  test("draws no gridlines, since a row label is not a value to read across", () => {
    draw(["Mon", "Tue"], ["0"], [1, 2]);

    expect(document.querySelectorAll(".chart-grid line")).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll(".chart-axis-y text")).map((text) => text.textContent),
    ).toStrictEqual(["Mon", "Tue"]);
  });

  test("thins the column labels to the ones that fit", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => `${hour}`);
    draw(["Mon"], hours, hours.map(Number));

    const labels = Array.from(document.querySelectorAll(".chart-axis-x text")).map(
      (text) => text.textContent,
    );
    expect(labels[0]).toBe("0");
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.length).toBeLessThan(24);
  });

  test("says why there is nothing rather than drawing an empty grid", () => {
    expect(draw(["Mon"], ["0"], [])).toHaveLength(0);
    expect(screen.getByText("Nothing in this range.")).toBeInTheDocument();
  });

  test("reads as a table of every cell, a row per row", async () => {
    draw(["Mon", "Tue"], ["0", "1"], [1, 2, 3, 4]);

    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));

    expect(screen.getAllByRole("row")).toHaveLength(3);
    const tuesday = screen.getByRole("rowheader", { name: "Tue" }).closest("tr");
    expect(tuesday?.textContent).toBe("Tue34");
  });
});
