import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatLibrarySummary } from "./format";

describe("formatDuration", () => {
  it("formats as m:ss with a padded seconds field", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(208_000)).toBe("3:28");
  });

  it("grows to h:mm:ss past an hour", () => {
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });

  it("does not produce nonsense for negative or non-finite input", () => {
    expect(formatDuration(-1)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("formatLibrarySummary", () => {
  it("says so when the library is empty", () => {
    expect(formatLibrarySummary(0, 0)).toBe("No songs");
  });

  it("uses the singular for one song", () => {
    expect(formatLibrarySummary(1, 208_000)).toContain("1 song,");
  });

  it("groups thousands using the viewer's locale", () => {
    // Deliberately not a literal: the separator is locale-dependent (50,000 on
    // en-US, 50.000 on de-DE) and following the OS locale is the wanted
    // behaviour for a desktop app, so asserting one would just be wrong
    // somewhere else.
    expect(formatLibrarySummary(50_000, 3_600_000)).toContain(
      `${(50_000).toLocaleString()} songs, `,
    );
  });

  it("reports hours to one decimal", () => {
    expect(formatLibrarySummary(237, 69_120_000)).toBe("237 songs, 19.2 hours");
  });

  it("falls back to minutes below an hour", () => {
    expect(formatLibrarySummary(3, 600_000)).toBe("3 songs, 10 minutes");
  });
});

describe("formatBytes", () => {
  it("switches unit at a gigabyte", () => {
    expect(formatBytes(2_270_000_000)).toBe("2.27 GB");
    expect(formatBytes(500_000_000)).toBe("500 MB");
  });

  it("handles nothing at all", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(-5)).toBe("0 MB");
  });
});
