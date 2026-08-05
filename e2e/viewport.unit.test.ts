import { describe, expect, it } from "vitest";
import { nextOuterSize, SHOT_HEIGHT, SHOT_WIDTH, TOLERANCE } from "./viewport";

/**
 * The one part of the screenshot viewport that can be quietly wrong.
 *
 * Everything else in `viewport.ts` needs a window to mean anything, and is
 * checked by looking at the picture. This is arithmetic, and arithmetic that
 * fails to converge would show up as four resizes and a screenshot at the wrong
 * size, with nothing in the log to say why.
 *
 * Named `.unit.test.ts` rather than `.test.ts`: the WebdriverIO specs under
 * `e2e/specs` carry the plain suffix, and Vitest must not try to run those.
 */
describe("sizing the window for a screenshot", () => {
  const target = { width: SHOT_WIDTH, height: SHOT_HEIGHT };

  it("adds the shortfall rather than scaling by it", () => {
    // The gap between a window and its viewport is a frame - a constant number
    // of pixels, not a proportion. A 1416-wide window with a 1400-wide viewport
    // needs to grow by exactly the 520 the viewport is short.
    expect(nextOuterSize({ width: 1416, height: 864 }, { width: 1400, height: 840 })).toEqual({
      width: 1416 + (SHOT_WIDTH - 1400),
      height: 864 + (SHOT_HEIGHT - 840),
    });
  });

  it("converges in a single step", () => {
    // The property that makes the difference the right correction: the frame is
    // whatever the first measurement says it is, and adding the shortfall to the
    // *outer* size carries that frame along for free. One resize, then done.
    const frame = { width: 16, height: 24 };
    const outer = { width: 1416, height: 864 };
    const viewport = { width: outer.width - frame.width, height: outer.height - frame.height };

    const corrected = nextOuterSize(outer, viewport);
    expect(corrected).not.toBeNull();

    // What that new window would produce, still minus the same frame.
    const reached = {
      width: (corrected as { width: number }).width - frame.width,
      height: (corrected as { height: number }).height - frame.height,
    };
    expect(reached).toEqual(target);
    expect(nextOuterSize(corrected as { width: number; height: number }, reached)).toBeNull();
  });

  it("stops once the viewport is the size asked for", () => {
    expect(nextOuterSize({ width: 1936, height: 1104 }, target)).toBeNull();
  });

  it("stops within tolerance rather than chasing a pixel", () => {
    // A viewport measured through `innerWidth * devicePixelRatio` lands a pixel
    // either side of the truth at fractional zooms. Chasing that is an infinite
    // loop over a difference nobody can see.
    expect(
      nextOuterSize(
        { width: 1936, height: 1104 },
        { width: SHOT_WIDTH - TOLERANCE, height: SHOT_HEIGHT + TOLERANCE },
      ),
    ).toBeNull();
  });

  it("shrinks a window that is too large", () => {
    // The runner may already be bigger than the target, in which case the
    // correction is negative and the same arithmetic applies.
    expect(nextOuterSize({ width: 2560, height: 1440 }, { width: 2544, height: 1416 })).toEqual({
      width: 2560 + (SHOT_WIDTH - 2544),
      height: 1440 + (SHOT_HEIGHT - 1416),
    });
  });

  it("accepts a target of its own, for a caller that wants one", () => {
    expect(
      nextOuterSize(
        { width: 800, height: 600 },
        { width: 780, height: 580 },
        {
          width: 1280,
          height: 720,
        },
      ),
    ).toEqual({ width: 800 + 500, height: 600 + 140 });
  });
});
