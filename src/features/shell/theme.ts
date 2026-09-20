/**
 * Which ground the app draws on.
 *
 * Three stored values against two grounds, and the third is the point: the app
 * follows the OS unless it has been told not to. A preference that could only
 * say "light" or "dark" would have no way back to the OS once it had been
 * touched once, and "whatever this machine is set to" is the honest default
 * for a desktop app.
 *
 * The resolution lives here rather than in Rust because only the webview can
 * read `prefers-color-scheme`; `settings::THEME` stores the string opaquely.
 * See docs/knowledge/design.md.
 */
export type ThemePreference = "system" | "light" | "dark";

/** The two grounds `tokens.css` actually defines. */
export type Ground = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export const DEFAULT_THEME: ThemePreference = "system";

/** How each choice is labelled in Settings -> Appearance. */
export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Reads a stored value, falling back to the default for anything unusable.
 *
 * Anything this app did not write - null, a typo, a hand-edited row - reads as
 * "system". Being wrong in that direction means following the OS, which is
 * where an app that has never been configured should be anyway.
 */
export function parseTheme(stored: string | null): ThemePreference {
  return THEME_PREFERENCES.includes(stored as ThemePreference)
    ? (stored as ThemePreference)
    : DEFAULT_THEME;
}

/** The ground a preference means, given what the OS currently says. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Ground {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

/** The media query the "system" choice follows. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";
