import { describe, expect, it } from "vitest";
import type { Track } from "../../ipc";
import { commonValue, FIELDS, hasChanges, numericProblem, toEdit } from "./fields";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "/m/1.mp3",
    duration_ms: 1000,
    title: "Maki",
    artist: "Guitar",
    album: "Tokyo",
    album_artist: "Guitar",
    genre: "Shoegaze",
    year: 2012,
    track_no: 1,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    ...overrides,
  };
}

const field = (id: string) =>
  FIELDS.find((definition) => definition.id === id) as (typeof FIELDS)[0];

describe("commonValue", () => {
  it("reports the shared value when the selection agrees", () => {
    const tracks = [track(), track({ id: 2, title: "Other" })];

    expect(commonValue(tracks, field("artist"))).toEqual({ kind: "same", value: "Guitar" });
  });

  it("reports mixed when it does not", () => {
    const tracks = [track(), track({ id: 2, artist: "Grizzly Bear" })];

    expect(commonValue(tracks, field("artist"))).toEqual({ kind: "mixed" });
  });

  it("treats an absent value as the empty string, not as agreement", () => {
    // "everyone has no genre" is a shared value; "some do, some do not" is not.
    expect(commonValue([track({ genre: null }), track({ genre: null })], field("genre"))).toEqual({
      kind: "same",
      value: "",
    });
    expect(commonValue([track({ genre: null }), track()], field("genre"))).toEqual({
      kind: "mixed",
    });
  });

  it("compares numbers as the strings the inputs hold", () => {
    expect(commonValue([track(), track({ id: 2 })], field("year"))).toEqual({
      kind: "same",
      value: "2012",
    });
    expect(commonValue([track(), track({ id: 2, year: 2017 })], field("year"))).toEqual({
      kind: "mixed",
    });
  });

  it("handles a selection of one", () => {
    expect(commonValue([track()], field("title"))).toEqual({ kind: "same", value: "Maki" });
  });
});

describe("toEdit", () => {
  it("sends only the fields that were touched", () => {
    const edit = toEdit({ genre: "Dream Pop" });

    // Everything else being null is the mixed-value contract: the backend
    // leaves an absent field exactly as it is on every selected track.
    expect(edit.genre).toBe("Dream Pop");
    expect(edit.title).toBeNull();
    expect(edit.artist).toBeNull();
    expect(edit.year).toBeNull();
  });

  it("distinguishes a field that was cleared from one that was never touched", () => {
    const edit = toEdit({ genre: "" });

    // Empty means "clear this"; null means "leave it alone".
    expect(edit.genre).toBe("");
    expect(edit.comment).toBeNull();
  });

  it("sends nothing at all for an untouched draft", () => {
    expect(Object.values(toEdit({})).every((value) => value === null)).toBe(true);
  });
});

describe("hasChanges", () => {
  it("is false until something is edited", () => {
    expect(hasChanges({}, null)).toBe(false);
    expect(hasChanges({ genre: "x" }, null)).toBe(true);
    expect(hasChanges({ genre: "" }, null)).toBe(true);
  });

  it("counts an artwork change on its own", () => {
    expect(hasChanges({}, { kind: "remove" })).toBe(true);
    expect(hasChanges({}, { kind: "replace", path: "c:/cover.png" })).toBe(true);
  });
});

describe("numericProblem", () => {
  it("passes numbers, blanks and untouched fields", () => {
    expect(numericProblem({ year: "2012" })).toBeNull();
    expect(numericProblem({ year: "" })).toBeNull();
    expect(numericProblem({ genre: "not a number" })).toBeNull();
    expect(numericProblem({})).toBeNull();
  });

  it("names the field that is wrong", () => {
    expect(numericProblem({ year: "twenty" })).toContain("Year");
    expect(numericProblem({ trackNo: "1.5" })).toContain("Track Number");
  });
});
