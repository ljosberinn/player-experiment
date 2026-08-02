import { describe, expect, it } from "vitest";
import type { Track } from "../../ipc";
import { ALL_COLUMNS, columnsFor, DEFAULT_COLUMN_IDS } from "./columns";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "D:/Music/Guitar/Tokyo/01 Maki.mp3",
    duration_ms: 208_000,
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
    play_count: 7,
    last_played_at: null,
    ...overrides,
  };
}

describe("columnsFor", () => {
  it("returns columns in the requested order, not the declaration order", () => {
    const columns = columnsFor(["artist", "title"]);

    expect(columns.map((c) => c.id)).toEqual(["artist", "title"]);
  });

  it("ignores ids that do not name a column", () => {
    // Column config is persisted, so a stale id from an older build must not
    // crash the table.
    const columns = columnsFor(["title", "nonsense" as never, "album"]);

    expect(columns.map((c) => c.id)).toEqual(["title", "album"]);
  });

  it("offers a sensible default set", () => {
    expect(columnsFor(DEFAULT_COLUMN_IDS)).toHaveLength(DEFAULT_COLUMN_IDS.length);
  });
});

describe("column rendering", () => {
  const render = (id: string, t: Track) => {
    const column = ALL_COLUMNS.find((c) => c.id === id);
    if (!column) {
      throw new Error(`no column ${id}`);
    }
    return column.render(t);
  };

  it("formats duration rather than showing milliseconds", () => {
    expect(render("durationMs", track())).toBe("3:28");
  });

  it("falls back to the file name when a track has no title", () => {
    expect(render("title", track({ title: null }))).toBe("01 Maki.mp3");
  });

  it("renders missing values as empty rather than 'null'", () => {
    const empty = track({ artist: null, album: null, genre: null, year: null, track_no: null });

    for (const id of ["artist", "album", "genre", "year", "trackNo"]) {
      expect(render(id, empty)).toBe("");
    }
  });

  it("renders numeric columns as text", () => {
    expect(render("year", track())).toBe("2012");
    expect(render("playCount", track())).toBe("7");
    expect(render("trackNo", track())).toBe("1");
  });

  it("every column is sortable by construction", () => {
    // Column ids are SortFields, so this is a type-level guarantee; assert the
    // set is non-empty so the constraint cannot be quietly dropped.
    expect(ALL_COLUMNS.length).toBeGreaterThan(0);
    expect(new Set(ALL_COLUMNS.map((c) => c.id)).size).toBe(ALL_COLUMNS.length);
  });
});
