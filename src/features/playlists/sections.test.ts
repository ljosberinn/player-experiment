import { describe, expect, it } from "vitest";
import { COLLAPSIBLE, parseSections, serialiseSections, toggleSection } from "./sections";

describe("which sidebar sections are folded away", () => {
  it("starts with everything open", () => {
    expect(parseSections(null)).toEqual({});
  });

  it("round-trips what it wrote", () => {
    const folded = { smart: true } as const;

    expect(parseSections(serialiseSections(folded))).toEqual(folded);
  });

  it("stores only the folded ones", () => {
    // The shorter of the two states, so an untouched sidebar writes `{}`
    // rather than a list of falses that all mean "default".
    expect(serialiseSections({})).toBe("{}");
    expect(serialiseSections({ smart: false, playlists: true })).toBe('{"playlists":true}');
  });

  it("opens everything rather than throwing on a value it cannot read", () => {
    // This runs before the sidebar can render, and what comes back from
    // `settings` is whatever was written there - which after a downgrade, a
    // hand-edit or a half-finished write may be anything at all.
    for (const stored of ["", "not json", "null", "[]", '"smart"', "17", '{"smart":"yes"}']) {
      expect(parseSections(stored), `parsing ${stored}`).toEqual({});
    }
  });

  it("drops a section it does not know about", () => {
    // A section that existed in a later version and was rolled back would
    // otherwise sit in the settings row forever, and carrying it would mean a
    // toggle writes back a shape this version never validated.
    expect(parseSections('{"smart":true,"invented-later":true}')).toEqual({ smart: true });
  });

  it("folds and unfolds", () => {
    const once = toggleSection({}, "playlists");
    expect(once).toEqual({ playlists: true });

    // Removed rather than set to false, so the stored value stays minimal.
    expect(toggleSection(once, "playlists")).toEqual({});
  });

  it("leaves the other section alone", () => {
    expect(toggleSection({ smart: true }, "playlists")).toEqual({ smart: true, playlists: true });
  });

  it("does not offer to fold the library away", () => {
    // Four items that are the app's primary navigation. A user who collapsed
    // them would have hidden the way back to their songs.
    expect(COLLAPSIBLE).not.toContain("library");
  });
});
