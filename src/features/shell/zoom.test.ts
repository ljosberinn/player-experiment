import { describe, expect, it } from "vitest";
import {
  clampZoom,
  DEFAULT_ZOOM,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  parseZoom,
  steppedZoom,
  zoomKey,
} from "./zoom";

describe("clamping and stepping", () => {
  it("holds the supported range", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.3)).toBe(1.3);
  });

  it("rounds to one decimal, which is what keeps 1.0 exactly 1.0", () => {
    // 0.1 is not representable in binary, so repeated addition lands on
    // 0.9999999999999999: the label would read "100%" while the stored value
    // was not 1, and a comparison against DEFAULT_ZOOM would miss.
    let factor = 0.8;
    for (let i = 0; i < 2; i++) {
      factor = steppedZoom(factor, 1);
    }
    expect(factor).toBe(1);
  });

  it("steps up and down without leaving the range", () => {
    expect(steppedZoom(1, 1)).toBe(1.1);
    expect(steppedZoom(1, -1)).toBe(0.9);
    expect(steppedZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(steppedZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
  });

  it("treats nonsense as the default rather than propagating NaN", () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ZOOM);
  });
});

describe("reading the stored value", () => {
  it("defaults when nothing is stored", () => {
    expect(parseZoom(null)).toBe(DEFAULT_ZOOM);
  });

  it("survives whatever is in the row", () => {
    for (const stored of ["", "abc", "{}", "NaN"]) {
      expect(parseZoom(stored)).toBe(DEFAULT_ZOOM);
    }
  });

  it("clamps a value written by a version with a wider range", () => {
    expect(parseZoom("5")).toBe(MAX_ZOOM);
    expect(parseZoom("0.2")).toBe(MIN_ZOOM);
  });
});

describe("the label", () => {
  it("reads as a percentage", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(1.2)).toBe("120%");
    expect(formatZoom(0.8)).toBe("80%");
  });
});

describe("the keyboard shortcuts", () => {
  it("recognises what users actually press", () => {
    // Ctrl+plus arrives as the unshifted key on most layouts, so `=` counts.
    expect(zoomKey({ key: "+", ctrlKey: true })).toBe("in");
    expect(zoomKey({ key: "=", ctrlKey: true })).toBe("in");
    expect(zoomKey({ key: "-", ctrlKey: true })).toBe("out");
    expect(zoomKey({ key: "0", ctrlKey: true })).toBe("reset");
  });

  it("ignores the same keys without a modifier", () => {
    // Otherwise typing a hyphen into the search box would shrink the app.
    expect(zoomKey({ key: "-" })).toBeNull();
    expect(zoomKey({ key: "0" })).toBeNull();
  });

  it("ignores keys it does not own", () => {
    expect(zoomKey({ key: "a", ctrlKey: true })).toBeNull();
    expect(zoomKey({ key: "1", ctrlKey: true })).toBeNull();
  });
});
