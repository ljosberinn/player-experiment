import { describe, expect, it } from "vitest";
import { libraryShortcutFor } from "./useLibraryShortcuts";

describe("the library shortcuts", () => {
  it("rescans on F5", () => {
    expect(libraryShortcutFor({ key: "F5" })).toBe("rescan");
  });

  it("ignores every other key", () => {
    for (const key of ["F4", "F6", "r", "R", "Enter", " ", "ArrowDown"]) {
      expect(libraryShortcutFor({ key }), key).toBeNull();
    }
  });

  it("ignores F5 with a modifier", () => {
    // Ctrl+F5 and Shift+F5 mean "harder refresh" in a browser and nothing
    // here. Treating them as the same thing would be guessing at an intent
    // that was never expressed.
    expect(libraryShortcutFor({ key: "F5", ctrlKey: true })).toBeNull();
    expect(libraryShortcutFor({ key: "F5", shiftKey: true })).toBeNull();
    expect(libraryShortcutFor({ key: "F5", altKey: true })).toBeNull();
    expect(libraryShortcutFor({ key: "F5", metaKey: true })).toBeNull();
  });
});
