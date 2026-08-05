import { mkdirSync } from "node:fs";
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
export async function capture(name: string): Promise<boolean> {
  mkdirSync(directory, { recursive: true });
  // Sized and scaled for the shot, then put back. See `viewport.ts` for why
  // this is per-capture rather than once for the whole run.
  const previous = await enterReviewViewport();
  try {
    await browser.saveScreenshot(join(directory, `${name}.png`));
    return true;
  } catch (cause) {
    console.log(`  could not capture ${name}: ${String(cause)}`);
    return false;
  } finally {
    await leaveReviewViewport(previous);
  }
}

export const SCREENSHOT_DIR = directory;
