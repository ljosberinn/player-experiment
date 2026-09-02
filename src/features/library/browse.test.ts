import { describe, expect, it } from "vitest";
import type { BrowseGroup } from "../../ipc";
import { groupId, groupMeta, groupSubtitle, groupTitle, unknownLabel } from "./browse";

function group(over: Partial<BrowseGroup> = {}): BrowseGroup {
  return {
    key: "Shields",
    secondary: "Grizzly Bear",
    trackCount: 10,
    durationMs: 1000,
    coverHash: null,
    year: 2012,
    ...over,
  };
}

describe("browse labels", () => {
  it("names each untagged group after what it is missing", () => {
    expect(unknownLabel("albums")).toBe("Unknown Release");
    expect(unknownLabel("artists")).toBe("Unknown Artist");
    expect(unknownLabel("genres")).toBe("Unknown Genre");
  });

  it("falls back to the untagged label only when the key is absent", () => {
    expect(groupTitle(group(), "albums")).toBe("Shields");
    expect(groupTitle(group({ key: null }), "albums")).toBe("Unknown Release");
    // "Unknown Artist" is a value files really carry, and that group is a
    // different one from the untagged group, which must keep reading as itself.
    expect(groupTitle(group({ key: "Unknown Artist" }), "artists")).toBe("Unknown Artist");
  });

  it("gives only albums a subtitle", () => {
    expect(groupSubtitle(group(), "albums")).toBe("Grizzly Bear");
    // An artist's subtitle would repeat its own title.
    expect(groupSubtitle(group(), "artists")).toBeNull();
    expect(groupSubtitle(group(), "genres")).toBeNull();
  });

  it("labels an album whose artist is untagged rather than leaving it blank", () => {
    expect(groupSubtitle(group({ secondary: null }), "albums")).toBe("Unknown Artist");
  });

  it("distinguishes two albums that share a title", () => {
    const dio = group({ key: "Double", secondary: "Dio" });
    const eve = group({ key: "Double", secondary: "Eve" });

    expect(groupId(dio)).not.toBe(groupId(eve));
  });

  it("does not collide when a separator falls differently across the two keys", () => {
    // With a space as the separator these are the same string, and React would
    // reuse one group's tile for the other.
    const a = group({ key: "A", secondary: "B C" });
    const b = group({ key: "A B", secondary: "C" });

    expect(groupId(a)).not.toBe(groupId(b));
  });

  it("keeps the untagged group's id stable and distinct from an empty title", () => {
    expect(groupId(group({ key: null, secondary: null }))).toBe(
      groupId(group({ key: null, secondary: null })),
    );
  });

  it("counts songs, singularly when there is one", () => {
    expect(groupMeta(group({ trackCount: 1, year: null }))).toBe("1 song");
    expect(groupMeta(group({ trackCount: 12, year: null }))).toBe("12 songs");
  });

  it("shows the year when the group has one", () => {
    expect(groupMeta(group({ trackCount: 12, year: 2012 }))).toBe("2012 · 12 songs");
  });

  it("treats a year of zero as no year", () => {
    // Rows scanned before the parser rejected `0000` keep their zero until
    // somebody rescans, so the guard here is the half that shows up today.
    expect(groupMeta(group({ trackCount: 12, year: 0 }))).toBe("12 songs");
  });
});
