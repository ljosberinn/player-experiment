import { describe, expect, it } from "vitest";
import type { ReleaseDetail, RemoteTrack, Track } from "../../ipc";
import {
  allFields,
  buildEdits,
  defaultAssignment,
  identityOf,
  mappedCount,
  swapAssignment,
} from "./mapping";

function track(id: number, over: Partial<Track> = {}): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 200_000,
    title: `File ${id}`,
    artist: null,
    album: null,
    album_artist: null,
    genre: null,
    year: null,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    ...over,
  };
}

function remote(trackNo: number, title: string, discNo = 1): RemoteTrack {
  return { title, artist: "My Bloody Valentine", trackNo, discNo, durationMs: 200_000 };
}

function detail(tracks: RemoteTrack[], over: Partial<ReleaseDetail> = {}): ReleaseDetail {
  return {
    candidate: {
      mbid: "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
      releaseGroupMbid: "2c7d1b1a-1a1a-4c4c-8f8f-9a9a9a9a9a9a",
      title: "Loveless",
      artist: "My Bloody Valentine",
      date: "1991-11-04",
      country: "GB",
      format: "CD",
      trackCount: tracks.length,
      discCount: 1,
      score: 1,
    },
    albumArtist: "My Bloody Valentine",
    year: 1991,
    genre: null,
    releaseType: null,
    tracks,
    coverPath: "/cache/chosen-cover.jpg",
    ...over,
  };
}

describe("defaultAssignment", () => {
  /** The case the whole rule exists for: three files out of twelve. */
  it("pairs a partial selection by its track numbers", () => {
    const files = [track(1, { track_no: 5 }), track(2, { track_no: 6 })];
    const tracks = [remote(1, "One"), remote(5, "Five"), remote(6, "Six")];

    expect(defaultAssignment(files, tracks)).toEqual([1, 2]);
  });

  it("pairs by position when the files carry no track numbers", () => {
    const files = [track(1), track(2)];
    const tracks = [remote(1, "One"), remote(2, "Two"), remote(3, "Three")];

    expect(defaultAssignment(files, tracks)).toEqual([0, 1]);
  });

  it("keeps the two discs of a release apart", () => {
    const files = [track(1, { track_no: 1, disc_no: 2 }), track(2, { track_no: 1, disc_no: 1 })];
    const tracks = [remote(1, "Disc one, one", 1), remote(1, "Disc two, one", 2)];

    expect(defaultAssignment(files, tracks)).toEqual([1, 0]);
  });

  it("leaves a file the release has nothing for unmapped", () => {
    const files = [track(1, { track_no: 1 }), track(2, { track_no: 99 })];

    expect(defaultAssignment(files, [remote(1, "One")])).toEqual([0, null]);
    expect(mappedCount(defaultAssignment(files, [remote(1, "One")]))).toBe(1);
  });

  /** Two files claiming track 1 must not both be written the same title. */
  it("never gives one remote track to two files", () => {
    const files = [track(1, { track_no: 1 }), track(2, { track_no: 1 })];

    expect(defaultAssignment(files, [remote(1, "One"), remote(2, "Two")])).toEqual([0, null]);
  });
});

describe("swapAssignment", () => {
  it("exchanges two files' tracks and leaves the rest alone", () => {
    expect(swapAssignment([0, 1, 2], 0, 1)).toEqual([1, 0, 2]);
  });

  it("carries an unmapped row through a swap", () => {
    expect(swapAssignment([null, 1], 0, 1)).toEqual([1, null]);
  });

  it("refuses to move off either end", () => {
    const assignment = [0, 1];
    expect(swapAssignment(assignment, 0, -1)).toBe(assignment);
    expect(swapAssignment(assignment, 1, 2)).toBe(assignment);
  });
});

describe("buildEdits", () => {
  it("writes one edit per mapped file, out of the ticked fields", () => {
    const files = [track(1, { track_no: 1 }), track(2, { track_no: 2 })];
    const release = detail([remote(1, "Only Shallow"), remote(2, "Loomer")]);

    const edits = buildEdits(files, release, [0, 1], allFields());

    expect(edits).toHaveLength(2);
    expect(edits[0]?.trackId).toBe(1);
    expect(edits[0]?.edit.title).toBe("Only Shallow");
    expect(edits[0]?.edit.album).toBe("Loveless");
    expect(edits[0]?.edit.albumArtist).toBe("My Bloody Valentine");
    expect(edits[0]?.edit.year).toBe("1991");
    expect(edits[0]?.edit.trackNo).toBe("1");
    expect(edits[0]?.edit.discNo).toBe("1");
    expect(edits[1]?.edit.title).toBe("Loomer");
  });

  /**
   * The difference between declining to write a field and clearing it. An
   * unticked box has to leave the tag exactly as the file has it.
   */
  it("leaves an unticked field absent rather than empty", () => {
    const release = detail([remote(1, "Only Shallow")]);

    const edits = buildEdits([track(1, { track_no: 1 })], release, [0], {
      ...allFields(),
      title: false,
      year: false,
    });

    expect(edits[0]?.edit.title).toBeNull();
    expect(edits[0]?.edit.year).toBeNull();
    expect(edits[0]?.edit.artist).toBe("My Bloody Valentine");
  });

  it("skips a file with no track rather than sending an empty edit", () => {
    const files = [track(1, { track_no: 1 }), track(2, { track_no: 9 })];
    const release = detail([remote(1, "Only Shallow")]);

    expect(buildEdits(files, release, [0, null], allFields())).toHaveLength(1);
  });

  it("carries the staged cover only while artwork is ticked", () => {
    const files = [track(1, { track_no: 1 })];
    const release = detail([remote(1, "Only Shallow")]);

    expect(buildEdits(files, release, [0], allFields())[0]?.edit.cover).toEqual({
      kind: "replace",
      path: "/cache/chosen-cover.jpg",
    });
    expect(
      buildEdits(files, release, [0], { ...allFields(), artwork: false })[0]?.edit.cover,
    ).toBeNull();
  });

  it("writes no artwork when the archive had none", () => {
    const release = detail([remote(1, "Only Shallow")], { coverPath: null });

    expect(
      buildEdits([track(1, { track_no: 1 })], release, [0], allFields())[0]?.edit.cover,
    ).toBeNull();
  });

  /**
   * The identifiers are not per file: they go to the whole release on the
   * other side of the boundary, so an edit built here must not name them.
   */
  it("leaves the identifiers to the apply", () => {
    const release = detail([remote(1, "Only Shallow")]);

    const edit = buildEdits([track(1, { track_no: 1 })], release, [0], allFields())[0]?.edit;

    expect(edit?.releaseMbid).toBeNull();
    expect(edit?.releaseGroupMbid).toBeNull();
  });

  it("writes no year for a release MusicBrainz has no date for", () => {
    const release = detail([remote(1, "Only Shallow")], { year: null });

    expect(
      buildEdits([track(1, { track_no: 1 })], release, [0], allFields())[0]?.edit.year,
    ).toBeNull();
  });
});

describe("identityOf", () => {
  /** Keyed by what the library calls the release, not by what MusicBrainz does. */
  it("keeps the local album and artist, which is what the expansion matches on", () => {
    const identity = identityOf(
      { album: "loveless", artist: "MBV" },
      detail([remote(1, "Only Shallow")]),
    );

    expect(identity).toEqual({
      album: "loveless",
      artist: "MBV",
      releaseMbid: "bb5a3a25-1a76-3e6f-9dbd-eaeb0e0a94a9",
      releaseGroupMbid: "2c7d1b1a-1a1a-4c4c-8f8f-9a9a9a9a9a9a",
    });
  });
});
