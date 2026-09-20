import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseTheme, resolveTheme, THEME_PREFERENCES } from "./theme";

describe("reading the stored preference", () => {
  it("takes the three values it writes", () => {
    for (const preference of THEME_PREFERENCES) {
      expect(parseTheme(preference)).toBe(preference);
    }
  });

  it("falls back to following the OS for anything else", () => {
    // Unset, a hand-edited row, a value from a future version. Being wrong in
    // this direction means following the OS, which is where an app that has
    // never been configured should be anyway.
    for (const stored of [null, "", "Dark", "sepia", "true"]) {
      expect(parseTheme(stored)).toBe(DEFAULT_THEME);
    }
  });
});

describe("resolving a preference to a ground", () => {
  it("follows the OS when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the OS when the user has chosen", () => {
    // The whole point of storing a third value: once chosen, the ground stops
    // moving when the machine changes at sunset.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
