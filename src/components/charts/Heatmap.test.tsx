import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { Heatmap } from "./Heatmap";

/**
 * No measurement stub, unlike every other chart's test.
 *
 * Section 4d is a grid of stated sizes, so `Heatmap` draws through
 * `ChartShell` rather than `ChartFrame` and never asks how big it is. A test
 * that had to teach jsdom a layout would be testing a dependency this
 * component no longer has.
 */
function draw(
  rows: readonly string[],
  columns: readonly string[],
  values: readonly number[],
  loading = false,
) {
  render(
    <Heatmap
      label="Plays by weekday and hour"
      rows={rows}
      columns={columns}
      values={values}
      format={(value) => `${value}`}
      corner="Day"
      empty="Nothing in this range."
      loading={loading}
    />,
  );
  return Array.from(document.querySelectorAll<HTMLElement>(".heatmap-cell"));
}

describe("Heatmap", () => {
  test("lays the values out row by row, a cell per column", () => {
    const cells = draw(["Mon", "Tue"], ["0", "1", "2"], [1, 2, 3, 4, 5, 6]);

    expect(cells).toHaveLength(6);
    // Row-major: the fourth value opens the second row, and the row is the
    // grid's own row rather than a y offset anybody computed.
    const tuesday = document.querySelectorAll(".heatmap-row")[1];
    expect(tuesday?.querySelector(".heatmap-day")?.textContent).toBe("Tue");
    expect(
      Array.from(tuesday?.querySelectorAll(".heatmap-cell") ?? []).map(
        (cell) => (cell as HTMLElement).title,
      ),
    ).toStrictEqual(["Tue 0: 4", "Tue 1: 5", "Tue 2: 6"]);
  });

  test("repeats the track once per column, and says so as a count", () => {
    draw(["Mon"], ["0", "1", "2"], [1, 2, 3]);

    const cells = document.querySelector<HTMLElement>(".heatmap-cells");
    expect(cells?.style.getPropertyValue("--heatmap-columns")).toBe("3");
  });

  test("steps each cell by its share of the largest, and keeps nothing apart from little", () => {
    const cells = draw(["Mon"], ["0", "1", "2", "3", "4"], [0, 1, 50, 75, 100]);

    // One play in a hundred still takes the first step rather than rounding
    // to the colour of none, and the ramp now runs to seven.
    expect(cells.map((cell) => cell.dataset.step)).toStrictEqual(["0", "1", "4", "6", "7"]);
  });

  test("names the hours the sheet names, the first and the last among them", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => `${hour}`);
    draw(["Mon"], hours, hours.map(Number));

    // 4d's own `00 06 12 18 23`, spread under the grid rather than placed
    // under the bands they name.
    expect(
      Array.from(document.querySelectorAll(".heatmap-ticks span")).map((tick) => tick.textContent),
    ).toStrictEqual(["0", "6", "12", "18", "23"]);
  });

  test("names every column when there are few enough of them to fit", () => {
    draw(["Mon"], ["0", "1", "2"], [1, 2, 3]);

    expect(
      Array.from(document.querySelectorAll(".heatmap-ticks span")).map((tick) => tick.textContent),
    ).toStrictEqual(["0", "1", "2"]);
  });

  test("says why there is nothing rather than drawing an empty grid", () => {
    expect(draw(["Mon"], ["0"], [])).toHaveLength(0);
    expect(screen.getByText("Nothing in this range.")).toBeInTheDocument();
  });

  test("holds the panel's height with the grid it is waiting for", () => {
    // The block `ChartShell` draws by default fills a fixed height this chart
    // does not have, so the thing standing in for the grid has to be the grid.
    const cells = draw(["Mon", "Tue"], ["0", "1"], [], true);

    expect(cells).toHaveLength(4);
    expect(cells.every((cell) => cell.dataset.step === undefined)).toBe(true);
    expect(screen.getByTestId("chart-skeleton")).toBeInTheDocument();
    // Loading outranks empty, even though there is nothing to draw yet.
    expect(screen.queryByText("Nothing in this range.")).not.toBeInTheDocument();
  });

  test("is named as a picture, and stops being one when the table is up", async () => {
    draw(["Mon", "Tue"], ["0", "1"], [1, 2, 3, 4]);

    expect(screen.getByRole("img")).toHaveAccessibleName("Plays by weekday and hour");

    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("reads as a table of every cell, a row per row", async () => {
    draw(["Mon", "Tue"], ["0", "1"], [1, 2, 3, 4]);

    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));

    expect(screen.getAllByRole("row")).toHaveLength(3);
    const tuesday = screen.getByRole("rowheader", { name: "Tue" }).closest("tr");
    expect(tuesday?.textContent).toBe("Tue34");
  });
});
