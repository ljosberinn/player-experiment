import { browser } from "@wdio/globals";
// For the `window.__TAURI__` declaration, which lives with the other use of it.
import "./invoke";

/**
 * The size a screenshot is worth taking at.
 *
 * The harness window is 1416×864 at zoom 1.0, which is a laptop. This app was
 * built for libraries of tens of thousands of songs, and a reviewer looking at
 * a photograph of that table currently sees about twenty rows of it.
 *
 * 1920×1080 with the interface at 90% is a desktop monitor with the UI scaled
 * down slightly - how a dense library actually gets used - and it puts roughly a
 * third more rows in frame.
 */
export const SHOT_WIDTH = 1920;
export const SHOT_HEIGHT = 1080;
export const SHOT_ZOOM = 0.9;

/** How close to the target counts as arrived. */
export const TOLERANCE = 2;
/** Attempts at converging on the target before settling for what we have. */
const ATTEMPTS = 4;

/** How long to give the webview to notice a window it has just been given. */
const SETTLE_TIMEOUT = 2_000;
/** How often to ask it, while waiting. */
const SETTLE_INTERVAL = 50;

/** Whether a measured viewport is close enough to `target` to stop. */
export function arrived(
  viewport: { width: number; height: number },
  target: { width: number; height: number },
): boolean {
  return (
    Math.abs(target.width - viewport.width) <= TOLERANCE &&
    Math.abs(target.height - viewport.height) <= TOLERANCE
  );
}

/**
 * The window size to try next, given what the last one produced.
 *
 * Pure, and split out so the arithmetic can be checked without a browser - it is
 * the only part of this file that can be wrong in a way that is not obvious from
 * looking at the picture afterwards.
 *
 * The correction is a difference rather than a ratio: the gap between a window
 * and its viewport is a constant number of pixels (the frame), not a proportion
 * of it, so adding the shortfall converges in one step where scaling would
 * oscillate.
 *
 * Returns `null` once the viewport is within `TOLERANCE` of the target, which is
 * the caller's signal to stop.
 */
export function nextOuterSize(
  outer: { width: number; height: number },
  viewport: { width: number; height: number },
  target: { width: number; height: number } = { width: SHOT_WIDTH, height: SHOT_HEIGHT },
): { width: number; height: number } | null {
  if (arrived(viewport, target)) {
    return null;
  }
  return {
    width: outer.width + (target.width - viewport.width),
    height: outer.height + (target.height - viewport.height),
  };
}

/** The window size to put back, and the zoom to put back with it. */
export interface Viewport {
  width: number;
  height: number;
  zoom: number;
}

/**
 * The viewport in *physical* pixels, which is what a screenshot is measured in.
 *
 * Not `innerWidth`, which is CSS pixels: at zoom 0.9 a 1920-pixel-wide window
 * reports an `innerWidth` of about 2133, and a loop chasing `innerWidth === 1920`
 * would resize the window forever without ever arriving.
 */
function physicalSize(): Promise<{ width: number; height: number }> {
  return browser.execute(() => ({
    width: Math.round(window.innerWidth * window.devicePixelRatio),
    height: Math.round(window.innerHeight * window.devicePixelRatio),
  }));
}

/**
 * The viewport once the webview has noticed the window it was just given.
 *
 * `setWindowSize` resolves as soon as the driver has asked for the resize, and
 * for some milliseconds after that `innerWidth` still describes the *previous*
 * window. Measuring there costs a whole correction: the loop below adds a
 * shortfall it has already applied, and the size it reports at the end belongs
 * to the window before last. That is how a 700-pixel window came out of CI
 * photographed 3157 pixels wide - wider than the shot it exists to contrast
 * with - while the log said it had arrived at exactly 1920×1080.
 *
 * Waits for the reading to *change* rather than for it to reach the target: the
 * target is what the loop is still deciding, and a display that cannot grow that
 * far still moves when it is resized.
 *
 * Times out into the last reading rather than throwing, for the same reason
 * nothing else here throws - a window that will not move is a smaller picture.
 */
async function settledSize(before: {
  width: number;
  height: number;
}): Promise<{ width: number; height: number }> {
  let latest = before;
  try {
    await browser.waitUntil(
      async () => {
        latest = await physicalSize();
        return latest.width !== before.width || latest.height !== before.height;
      },
      { timeout: SETTLE_TIMEOUT, interval: SETTLE_INTERVAL },
    );
  } catch {
    // The window did not move at all. `latest` is what it actually is, and the
    // next correction is computed from that rather than from what was asked for.
  }
  return latest;
}

/** Applies a zoom to the webview without touching the stored preference. */
async function setZoom(factor: number): Promise<void> {
  // The webview's own API rather than the app's zoom store: that store persists
  // to `settings`, and a screenshot has no business changing a preference that
  // outlives it.
  await browser.execute((value: number) => {
    void window.__TAURI__?.webview?.getCurrentWebview().setZoom(value);
  }, factor);
}

/**
 * Sizes the window so the viewport is `SHOT_WIDTH × SHOT_HEIGHT`, at `SHOT_ZOOM`.
 *
 * Returns what to hand back to `leaveReviewViewport`, and logs what it actually
 * achieved. **Nothing here throws and nothing here asserts.** These are review
 * aids: a runner whose display refuses to grow produces a smaller picture, which
 * is a smaller picture rather than a failed test - the same principle that makes
 * `capture()` return `false` instead of raising.
 */
export async function enterReviewViewport(): Promise<Viewport | null> {
  try {
    const previous = await browser.getWindowSize();

    await setZoom(SHOT_ZOOM);

    // The window is larger than its viewport by whatever the frame costs, and
    // that is not knowable up front - it depends on decorations and on the DPI
    // the runner happens to be at. So: measure, correct by the difference, and
    // measure again once the webview has caught up with the resize. It converges
    // in one step when nothing else interferes and stops after four when the
    // display simply cannot go that big.
    let outer = { width: previous.width, height: previous.height };
    let reached = await physicalSize();
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const next = nextOuterSize(outer, reached);
      if (next === null) {
        break;
      }
      outer = next;
      await browser.setWindowSize(outer.width, outer.height);
      reached = await settledSize(reached);
    }

    if (!arrived(reached, { width: SHOT_WIDTH, height: SHOT_HEIGHT })) {
      // Said out loud rather than swallowed: a reviewer wondering why the
      // pictures are small should find the answer in the log, not guess. Judged
      // by the same tolerance the loop stops on, or every fractional-zoom
      // rounding lands a pixel out and cries that the display is too small.
      console.log(
        `  viewport is ${reached.width}x${reached.height}, not ${SHOT_WIDTH}x${SHOT_HEIGHT} - the display is probably smaller`,
      );
    }

    return { width: previous.width, height: previous.height, zoom: 1 };
  } catch (cause) {
    console.log(`  could not resize for the screenshot: ${String(cause)}`);
    return null;
  }
}

/**
 * Puts the window and the zoom back.
 *
 * Entered and left around each capture rather than set once for the run: the
 * appearance and virtualization suites assert against the window they were
 * written for - "only a windowful of rows" means something different at 1080
 * pixels - and a spec that resized permanently would make every later spec's
 * result depend on which specs ran before it.
 */
export async function leaveReviewViewport(previous: Viewport | null): Promise<void> {
  if (previous === null) {
    return;
  }
  try {
    await setZoom(previous.zoom);
    await browser.setWindowSize(previous.width, previous.height);
  } catch (cause) {
    console.log(`  could not restore the window: ${String(cause)}`);
  }
}
