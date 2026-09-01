import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { browser } from "@wdio/globals";
import { enterReviewViewport, leaveReviewViewport } from "./viewport";

/**
 * Photographs of features, for the human who has to review them.
 *
 * The appearance suite deliberately does *not* use screenshots, and that
 * decision stands: pixel baselines flake on antialiasing, differ between a
 * developer machine and Windows Server, need storage for baselines and diffs,
 * and report "17,000 pixels differ" rather than what is wrong. Every
 * *assertion* about appearance is a computed value.
 *
 * These are not assertions. Nothing here is compared to anything, so nothing
 * here can flake. They exist because a pull request that changes what the app
 * looks like currently describes the change in prose and asks the reviewer to
 * imagine it. A picture in the artifact is the difference between reviewing a
 * description and reviewing the thing.
 *
 * Taken at 1920x1080 with the interface at 90% since phase 41, rather than at
 * whatever the harness window happens to be. The harness window is a laptop;
 * this app is for libraries of tens of thousands of songs, and a photograph
 * showing twenty rows of that table is not a photograph of it.
 *
 * They are uploaded as a build artifact with a short retention, never
 * committed: a binary in git that changes whenever the UI does is exactly the
 * cost that was rejected the first time.
 */

const directory = resolve(import.meta.dirname, "screenshots");

export interface CaptureOptions {
  /**
   * Photograph the window the spec is holding, rather than the review viewport.
   *
   * For the spec whose subject *is* the window size. Growing to 1920×1080 first
   * photographs a different window than the one the assertions ran against, and
   * for a spec that just narrowed the window to prove the grid reflows, that is
   * a picture of the opposite of what it proved: `browse-albums-narrow` shipped
   * twice wider than `browse-albums-wide`.
   *
   * The zoom is left alone too. Applying 90% would fit more columns across, and
   * a narrow window is the whole subject.
   */
  ownWindow?: boolean;
}

/**
 * Saves a PNG named `name`, and says whether it worked.
 *
 * Screenshots go through the WebDriver `/screenshot` endpoint, and the driver
 * here is a Tauri plugin embedded in the app rather than a full browser
 * driver - so support is a question rather than a given. A failure returns
 * `false` instead of throwing: a spec whose subject is "what this looks like"
 * should report that it could not photograph it, not fail as though the
 * feature were broken.
 */
export async function capture(name: string, options: CaptureOptions = {}): Promise<boolean> {
  mkdirSync(directory, { recursive: true });
  // Sized and scaled for the shot, then put back. See `viewport.ts` for why
  // this is per-capture rather than once for the whole run.
  const previous = options.ownWindow ? null : await enterReviewViewport();
  try {
    await browser.saveScreenshot(join(directory, `${name}.png`));
    return true;
  } catch (cause) {
    console.log(`  could not capture ${name}: ${String(cause)}`);
    return false;
  } finally {
    // `null` here means nothing was changed, whether because `ownWindow` asked
    // for that or because the resize failed. Either way there is nothing to put
    // back.
    await leaveReviewViewport(previous);
  }
}

/**
 * The pixel width of a screenshot already taken, from the PNG header.
 *
 * The one thing about a picture that is worth asserting on. Pixels are not -
 * see above - but a shot taken at the wrong window size is not a photograph of
 * its spec at all, and that is arithmetic rather than appearance. `IHDR` is the
 * first chunk by definition, so its width is a fixed offset in.
 */
export function shotWidth(name: string): number {
  return readFileSync(join(directory, `${name}.png`)).readUInt32BE(16);
}

export const SCREENSHOT_DIR = directory;
