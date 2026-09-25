import { describe, expect, it } from "vitest";
import type { ReleaseDetail, RemoteTrack, Track } from "../../ipc";
import {
  agrees,
  allFields,
  buildEdits,
  defaultAssignment,
  differences,
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
    release_group_mbid: null,
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

describe("agrees", () => {
  const only = remote(1, "Only Shallow");
  const tagged = track(1, { title: "Only Shallow", artist: "My Bloody Valentine", track_no: 1 });

  it("holds for a file already tagged as its track", () => {
    // No disc tag reads as disc 1, the way the pairing reads it.
    expect(agrees(tagged, only, allFields())).toBe(true);
  });

  it("fails on any ticked per-track field", () => {
    expect(agrees({ ...tagged, title: "only shallow" }, only, allFields())).toBe(false);
    expect(agrees({ ...tagged, track_no: 2 }, only, allFields())).toBe(false);
  });

  it("ignores what an apply would not write", () => {
    const fields = { ...allFields(), title: false };

    expect(agrees({ ...tagged, title: "only shallow" }, only, fields)).toBe(true);
  });

  /** The release's fields are the same on every row, so they tell none apart. */
  it("ignores the release-wide fields", () => {
    expect(agrees({ ...tagged, album: "loveless", year: 2021 }, only, allFields())).toBe(true);
  });
});

describe("differences", () => {
  it("names each ticked field the track would change", () => {
    const file = track(1, { title: "Only Shallow", track_no: 2, disc_no: 2 });

    expect(differences(file, remote(1, "Only Shallow"), allFields())).toEqual({
      title: false,
      artist: true,
      trackNo: true,
      discNo: true,
    });
  });
});

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
    const tracks = [remote(1, "One"), { ...remote(2, "Two"), durationMs: 400_000 }];

    expect(defaultAssignment(files, tracks)).toEqual([0, null]);
  });

  it("pairs a release whose numbers agree exactly as its numbers say", () => {
    const titles = ["Only Shallow", "Loomer", "Touched", "To Here Knows When"];
    const files = titles.map((title, index) =>
      track(index + 1, {
        track_no: index + 1,
        title: title.toUpperCase(),
        duration_ms: 200_000 + index * 40_000 + 1_000,
      }),
    );
    const tracks = titles.map((title, index) => ({
      ...remote(index + 1, title),
      durationMs: 200_000 + index * 40_000,
    }));

    expect(defaultAssignment(files, tracks)).toEqual([0, 1, 2, 3]);
  });

  /** An intro MusicBrainz counts and the files do not: every number is one short. */
  it("follows the titles and lengths when the numbers disagree with them", () => {
    const files = [
      track(1, { track_no: 1, title: "Only Shallow", duration_ms: 257_000 }),
      track(2, { track_no: 2, title: "Loomer", duration_ms: 158_000 }),
    ];
    const tracks = [
      { ...remote(1, "Intro"), durationMs: 60_000 },
      { ...remote(2, "Only Shallow"), durationMs: 257_000 },
      { ...remote(3, "Loomer"), durationMs: 158_000 },
    ];

    expect(defaultAssignment(files, tracks)).toEqual([1, 2]);
  });

  /** Two discs in one folder with no disc number: every number appears twice. */
  it("pairs a flattened two-disc set on what its files are", () => {
    const discOne = ["Autre temps", "Là où naissent", "Les iris"];
    const discTwo = ["Le secret", "Élévation", "Souvenirs"];
    const tracks = [
      ...discOne.map((title, index) => ({
        ...remote(index + 1, title, 1),
        durationMs: 300_000 + index * 60_000,
      })),
      ...discTwo.map((title, index) => ({
        ...remote(index + 1, title, 2),
        durationMs: 420_000 + index * 50_000 + 20_000,
      })),
    ];
    // Read in `RELEASE_ORDER`: by number, the two discs interleaved.
    const files = [1, 2, 3].flatMap((number) => [
      track(number, {
        track_no: number,
        title: discTwo[number - 1] ?? null,
        duration_ms: 420_000 + (number - 1) * 50_000 + 20_000,
      }),
      track(number + 10, {
        track_no: number,
        title: discOne[number - 1] ?? null,
        duration_ms: 300_000 + (number - 1) * 60_000,
      }),
    ]);

    expect(defaultAssignment(files, tracks)).toEqual([3, 0, 4, 1, 5, 2]);
  });

  it("does not drop a numbered release to position over one unnumbered file", () => {
    const tracks = Array.from({ length: 12 }, (_, index) => ({
      ...remote(index + 1, `Song ${String.fromCharCode(65 + index)}`),
      durationMs: 150_000 + index * 35_000,
    }));
    // `RELEASE_ORDER` sorts the unnumbered file first.
    const files = [
      track(7, { title: "Song G", duration_ms: 150_000 + 6 * 35_000 }),
      ...Array.from({ length: 12 }, (_, index) => index)
        .filter((index) => index !== 6)
        .map((index) => track(index + 1, { track_no: index + 1, title: null, duration_ms: 1 })),
    ];

    expect(defaultAssignment(files, tracks)).toEqual([6, 0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
  });

  it("tells two tracks of one length apart by their titles", () => {
    const files = [track(1, { title: "Loomer" }), track(2, { title: "Only Shallow" })];

    expect(defaultAssignment(files, [remote(1, "Only Shallow"), remote(2, "Loomer")])).toEqual([
      1, 0,
    ]);
  });

  it("reads a title off the filename when the file has no title tag", () => {
    const files = [
      track(1, { title: null, path: "C:\\Music\\MBV\\02 - Loomer.flac" }),
      track(2, { title: null, path: "C:\\Music\\MBV\\01. Only Shallow.flac" }),
    ];

    expect(defaultAssignment(files, [remote(1, "Only Shallow"), remote(2, "Loomer")])).toEqual([
      1, 0,
    ]);
  });

  /** A wrong pairing is the one somebody applies without reading it. */
  it("leaves a file nothing on the release resembles unmapped", () => {
    const files = [
      track(1, { title: "Only Shallow" }),
      track(2, { title: "Hidden Bonus Jam", duration_ms: 900_000 }),
    ];
    const tracks = [remote(1, "Only Shallow"), { ...remote(2, "Loomer"), durationMs: 158_000 }];

    expect(defaultAssignment(files, tracks)).toEqual([0, null]);
  });

  it("falls back to position when nothing tells the files apart", () => {
    const files = Array.from({ length: 12 }, (_, index) => track(index + 1, { title: null }));
    const tracks = Array.from({ length: 12 }, (_, index) =>
      remote(index + 1, `Song ${String.fromCharCode(65 + index)}`),
    );

    expect(defaultAssignment(files, tracks)).toEqual(Array.from({ length: 12 }, (_, i) => i));
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
