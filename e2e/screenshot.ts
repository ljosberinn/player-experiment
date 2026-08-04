import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { browser } from "@wdio/globals";

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
  try {
    await browser.saveScreenshot(join(directory, `${name}.png`));
    return true;
  } catch (cause) {
    console.log(`  could not capture ${name}: ${String(cause)}`);
    return false;
  }
}

export const SCREENSHOT_DIR = directory;
