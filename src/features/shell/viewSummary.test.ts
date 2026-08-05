import { describe, expect, it } from "vitest";
import { viewSummary } from "./viewSummary";

/** The defaults every case starts from; each test changes what it is about. */
const base = {
  tab: "songs" as const,
  drilledIn: false,
  groupCount: 0,
  trackCount: 0,
  durationMs: 0,
  bytes: 0,
};

describe("what the footer says the view is showing", () => {
  it("counts songs and their time on the songs view", () => {
    expect(viewSummary({ ...base, trackCount: 5, durationMs: 3_000_000, bytes: 214_000_000 })).toBe(
      "5 songs, 50 minutes, 214 MB",
    );
  });

  it("counts groups on a browse view, not the songs behind them", () => {
    // The number that matters on the Albums view is how many albums are on
    // screen. Repeating the library's track count under a grid of covers
    // would be answering a question nobody asked.
    expect(viewSummary({ ...base, tab: "albums", groupCount: 12, trackCount: 240 })).toBe(
      "12 albums",
    );
    expect(viewSummary({ ...base, tab: "artists", groupCount: 3 })).toBe("3 artists");
    expect(viewSummary({ ...base, tab: "genres", groupCount: 7 })).toBe("7 genres");
  });

  it("counts songs again once a group is opened", () => {
    // Drilling into one album shows the songs table, so the line under it has
    // to describe songs - the tab is still "albums" at that point.
    expect(
      viewSummary({
        ...base,
        tab: "albums",
        drilledIn: true,
        groupCount: 12,
        trackCount: 11,
        durationMs: 2_700_000,
      }),
    ).toBe("11 songs, 45 minutes");
  });

  it("says none rather than a bare zero", () => {
    expect(viewSummary({ ...base })).toBe("No songs");
    expect(viewSummary({ ...base, tab: "albums" })).toBe("No albums");
  });

  it("uses the singular for one of anything", () => {
    expect(viewSummary({ ...base, tab: "genres", groupCount: 1 })).toBe("1 genre");
    expect(viewSummary({ ...base, trackCount: 1, durationMs: 180_000 })).toBe("1 song, 3 minutes");
  });

  it("groups the thousands, which is the only readable form at this size", () => {
    // A library of 150k songs is the case this app is built for, and
    // "12500 albums" is not a number anyone reads at a glance.
    //
    // Against the machine's own grouping rather than a literal comma: the
    // count goes through `toLocaleString`, as the track count beside it
    // already did, so a German machine says 12.500 and is right to.
    expect(viewSummary({ ...base, tab: "albums", groupCount: 12_500 })).toBe(
      `${(12_500).toLocaleString()} albums`,
    );
  });
});
