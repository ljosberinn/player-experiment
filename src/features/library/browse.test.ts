import { describe, expect, it } from "vitest";
import type { BrowseGroup } from "../../ipc";
import {
  albumIdentity,
  groupId,
  groupMeta,
  groupSubtitle,
  groupTitle,
  MANY_ARTISTS_LABEL,
  unknownLabel,
} from "./browse";

function group(over: Partial<BrowseGroup> = {}): BrowseGroup {
  return {
    id: albumIdentity("Shields", "Grizzly Bear"),
    key: "Shields",
    secondary: "Grizzly Bear",
    artistCount: 1,
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

  it("tells no artist apart from many artists", () => {
    // A release grouped by its MBID can hold twelve artists, and `secondary` is
    // then one arbitrary member of the group rather than what it is called.
    expect(groupSubtitle(group({ artistCount: 0, secondary: null }), "albums")).toBe(
      "Unknown Artist",
    );
    expect(groupSubtitle(group({ artistCount: 1, secondary: "Dio" }), "albums")).toBe("Dio");
    expect(groupSubtitle(group({ artistCount: 12, secondary: "Alice" }), "albums")).toBe(
      MANY_ARTISTS_LABEL,
    );
  });

  it("does not collide when a separator falls differently across the two tags", () => {
    // With a space as the separator these are the same string, and React would
    // reuse one release's tile for the other.
    expect(albumIdentity("A", "B C")).not.toBe(albumIdentity("A B", "C"));
  });

  it("folds an absent tag the way the query does, rather than to null", () => {
    // `release_identity`'s inner `coalesce`s: an untagged release is a string,
    // so two of them by different artists stay two ids.
    expect(albumIdentity(null, null)).toBe(albumIdentity("", ""));
    expect(albumIdentity(null, "Dio")).not.toBe(albumIdentity(null, "Eve"));
  });

  it("keys a tile on the identity the row carries rather than on its label", () => {
    // Two pressings merged by their release group are one tile, and the labels
    // `min()` picked may differ - a remaster is titled differently.
    const mbid = "2c7d1b1a-1a1a-4c4c-8f8f-9a9a9a9a9a9a";
    expect(groupId(group({ id: mbid, key: "Double" }))).toBe(
      groupId(group({ id: mbid, key: "Double (Remastered)" })),
    );
    // The untagged artist and genre groups carry no id, and a React key may
    // not be null.
    expect(groupId(group({ id: null }))).toBe("");
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
