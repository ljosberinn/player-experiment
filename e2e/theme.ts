import { browser } from "@wdio/globals";

/**
 * Driving the ground, for the specs that measure or photograph both.
 *
 * Shared rather than repeated: the appearance suite loops its colour block over
 * both grounds and `theme` photographs them, and two copies of "write the
 * attribute, then put it back" would be two things to fix when the mechanism
 * moves.
 *
 * These write `data-theme` directly rather than driving Settings → Appearance.
 * That is deliberate where it is used: a block about whether the *stylesheet*
 * composites to something legible should not also be able to fail because a
 * dialog would not open. The preference path has its own spec, in
 * `appearance.test.ts`, which is where a broken store shows up.
 */

/** The two grounds `src/styles/tokens.css` defines. */
export const GROUNDS = ["light", "dark"] as const;

export type Ground = (typeof GROUNDS)[number];

/** Draws the app on one ground. */
export function setGround(ground: Ground): Promise<void> {
  return browser.execute((value: string) => {
    document.documentElement.setAttribute("data-theme", value);
  }, ground);
}

/**
 * Hands the ground back to whatever the app decided for itself.
 *
 * Re-resolved from the OS rather than remembered: nothing is stored in the e2e
 * library, so `themeStore` resolved "system" at startup and this lands on the
 * same answer it did.
 */
export function clearGround(): Promise<void> {
  return browser.execute(() => {
    document.documentElement.setAttribute(
      "data-theme",
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
  });
}
