import { describe, expect, it } from "vitest";
import { bucketFor, bucketLabel, fillSeries } from "./series";

const DAY = 86_400;

/** Unix seconds at a local midnight. */
function at(year: number, month: number, day: number): number {
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

describe("bucketFor", () => {
  it.each([
    [7, "day"],
    [31, "day"],
    [62, "day"],
    [63, "week"],
    [366, "week"],
    [400, "week"],
    [401, "month"],
    [15 * 365, "month"],
    [30 * 365, "year"],
  ] as const)("cuts %i days into %s buckets", (days, bucket) => {
    expect(bucketFor({ from: 0, to: days * DAY })).toBe(bucket);
  });
});

describe("fillSeries", () => {
  it("puts a zero in every empty day of the span", () => {
    const filled = fillSeries(
      [
        { start: "2024-03-01", count: 4 },
        { start: "2024-03-04", count: 2 },
      ],
      "day",
      { from: at(2024, 3, 1), to: at(2024, 3, 5) },
    );

    expect(filled).toStrictEqual([
      { start: "2024-03-01", count: 4 },
      { start: "2024-03-02", count: 0 },
      { start: "2024-03-03", count: 0 },
      { start: "2024-03-04", count: 2 },
    ]);
  });

  it("covers the whole span even where the plays do not reach its ends", () => {
    const filled = fillSeries([{ start: "2024-02-01", count: 9 }], "month", {
      from: at(2024, 1, 15),
      to: at(2024, 4, 2),
    });

    expect(filled.map((entry) => entry.start)).toStrictEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
    ]);
  });

  it("opens each week on its Monday, as the backend names it", () => {
    // 2024-03-06 is a Wednesday.
    const filled = fillSeries([], "week", { from: at(2024, 3, 6), to: at(2024, 3, 20) });

    expect(filled.map((entry) => entry.start)).toStrictEqual([
      "2024-03-04",
      "2024-03-11",
      "2024-03-18",
    ]);
  });

  it("steps by the calendar, so a daylight-saving change is still one day", () => {
    // Late March and late October hold the change in most zones that have
    // one; a 23- or 25-hour day stepped by 86,400 seconds would skip a date or
    // name one twice. It only bites in such a zone, which a UTC runner is not.
    for (const month of [3, 10]) {
      const filled = fillSeries([], "day", {
        from: at(2024, month, 20),
        to: at(2024, month + 1, 5),
      });
      const starts = filled.map((entry) => entry.start);

      expect(new Set(starts).size).toBe(starts.length);
      expect(starts).toHaveLength(16);
    }
  });

  it("leaves a span too long to fill as it came", () => {
    const series = [{ start: "0001-01-01", count: 1 }];

    expect(fillSeries(series, "day", { from: at(2000, 1, 1), to: at(2010, 1, 1) })).toStrictEqual(
      series,
    );
  });
});

describe("bucketLabel", () => {
  it("names a month with its year and a day without", () => {
    expect(bucketLabel("2024-03-01", "month")).toBe(
      new Date(2024, 2, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    );
    expect(bucketLabel("2024-03-04", "day")).not.toContain("2024");
    expect(bucketLabel("2024-01-01", "year")).toContain("2024");
  });
});
