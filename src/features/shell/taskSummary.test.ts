import { describe, expect, it } from "vitest";
import { taskEstimate, taskPercent, taskSummary } from "./taskSummary";

describe("the fraction", () => {
  /**
   * The whole reason for the decimals: one percent of the unattended lookup
   * pass is eighty releases and the better part of half an hour, and a figure
   * that does not move for half an hour reads as hung.
   */
  it("moves when a single release out of eight thousand is decided", () => {
    expect(taskPercent(400, 8044)).not.toBe(taskPercent(401, 8044));
  });

  it("keeps two decimal places even where they are noughts", () => {
    expect(taskPercent(1, 4)).toBe("25.00%");
  });

  it("says nothing at all before there is a total to be a fraction of", () => {
    expect(taskPercent(0, 0)).toBeNull();
  });
});

describe("the estimate", () => {
  it("is absent until there is history to draw one from", () => {
    expect(taskEstimate(null)).toBeNull();
  });

  it("does not count out the last few seconds", () => {
    expect(taskEstimate(20_000)).toBe("under a minute left");
  });

  it("reads in minutes, hours and days as it grows", () => {
    expect(taskEstimate(9 * 60_000)).toBe("about 9 minutes left");
    expect(taskEstimate(90 * 60_000)).toBe("about 2 hours left");
    expect(taskEstimate(45 * 3_600_000)).toBe("about 45 hours left");
    expect(taskEstimate(80 * 3_600_000)).toBe("about 3 days left");
  });

  it("says one hour rather than one hours", () => {
    expect(taskEstimate(3_600_000)).toBe("about 1 hour left");
  });
});

describe("the line", () => {
  it("names the task, how far it has got and how much longer", () => {
    expect(
      taskSummary({ label: "Looking up releases", done: 402, total: 8044, etaMs: 45 * 3_600_000 }),
    ).toBe("Looking up releases · 5.00% · about 45 hours left");
  });

  /** A task that has only just started has nothing to say but its name. */
  it("is the label alone when there is neither a fraction nor an estimate", () => {
    expect(taskSummary({ label: "Looking up releases", done: 0, total: 0, etaMs: null })).toBe(
      "Looking up releases",
    );
  });
});
