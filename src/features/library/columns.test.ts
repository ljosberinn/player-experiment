import { describe, expect, it } from "vitest";
import type { SortField, Track } from "../../ipc";
import {
  ALL_COLUMNS,
  type ColumnConfig,
  columnsFor,
  DEFAULT_COLUMN_CONFIG,
  DEFAULT_COLUMN_IDS,
  displayedColumns,
  MIN_COLUMN_WIDTH,
  moveColumn,
  parseColumnConfig,
  resizeColumn,
  resolveColumns,
  serializeColumnConfig,
  storedDropIndex,
  toggleColumn,
  visibleSort,
} from "./columns";

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
    missing_since: null,
    release_mbid: null,
    release_group_mbid: null,
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

  it("prints a bit rate the way the release gutter does", () => {
    expect(render("bitrate", track({ bitrate: 320 }))).toBe("320 kbps");
    expect(render("bitrate", track({ bitrate: null }))).toBe("");
  });

  it("marks a song with a MusicBrainz release and leaves the rest blank", () => {
    expect(render("releaseMbid", track({ release_mbid: "bb5a" }))).toBe("✓");
    expect(render("releaseMbid", track({ release_mbid: null }))).toBe("");
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

describe("column configuration", () => {
  const config = (ids: SortField[], widths: ColumnConfig["widths"] = {}): ColumnConfig => ({
    ids,
    widths,
  });

  it("applies a stored width and leaves the rest on their defaults", () => {
    const resolved = resolveColumns(config(["title", "artist"], { title: 400 }));

    // The default is read from ALL_COLUMNS rather than written out: this
    // asserts that an untouched column *follows* the default, and hardcoding
    // the number makes it fail whenever the density is rebased, which says
    // nothing about the behaviour.
    const artistDefault = ALL_COLUMNS.find((c) => c.id === "artist")?.width;

    expect(resolved.map((c) => [c.id, c.width])).toEqual([
      ["title", 400],
      ["artist", artistDefault],
    ]);
  });

  it("fills a column the config says nothing about with its fitted width", () => {
    const resolved = resolveColumns(config(["title", "artist"]), { artist: 90 });

    const titleDefault = ALL_COLUMNS.find((c) => c.id === "title")?.width;

    expect(resolved.map((c) => [c.id, c.width])).toEqual([
      ["title", titleDefault],
      ["artist", 90],
    ]);
  });

  it("lets a stored width beat a fitted one", () => {
    const resolved = resolveColumns(config(["artist"], { artist: 400 }), { artist: 90 });

    // A width the user dragged is persisted; a fit painting over it would
    // leave the stored number with no way to ever be seen again.
    expect(resolved[0]?.width).toBe(400);
  });

  it("hides and shows a column, appending what it cannot place", () => {
    const hidden = toggleColumn(config(["title", "artist", "album"]), "artist");
    expect(hidden.ids).toEqual(["title", "album"]);

    const shown = toggleColumn(hidden, "artist");
    expect(shown.ids).toEqual(["title", "album", "artist"]);
  });

  it("refuses to hide the last column", () => {
    const only = config(["title"]);

    // An empty table has no headers, so no header menu, so no way back.
    expect(toggleColumn(only, "title")).toEqual(only);
  });

  it("moves a column, counting the target after removal", () => {
    const start = config(["title", "artist", "album", "genre"]);

    expect(moveColumn(start, "title", 2).ids).toEqual(["artist", "album", "title", "genre"]);
    expect(moveColumn(start, "genre", 0).ids).toEqual(["genre", "title", "artist", "album"]);
  });

  it("clamps a move past either end rather than dropping the column", () => {
    const start = config(["title", "artist"]);

    expect(moveColumn(start, "title", 99).ids).toEqual(["artist", "title"]);
    expect(moveColumn(start, "artist", -5).ids).toEqual(["artist", "title"]);
  });

  it("ignores a move of a column that is not shown", () => {
    const start = config(["title", "artist"]);

    expect(moveColumn(start, "path", 0)).toEqual(start);
  });

  it("keeps a resized column grabbable", () => {
    const resized = resizeColumn(config(["title"]), "title", 4);

    // Zero-width is indistinguishable from hidden, except there is no way to
    // get hold of it again.
    expect(resized.widths.title).toBe(MIN_COLUMN_WIDTH);
  });

  it("rounds a dragged width rather than storing a fraction", () => {
    expect(resizeColumn(config(["title"]), "title", 220.6).widths.title).toBe(221);
  });

  it("falls back when the sorted column is hidden", () => {
    // Otherwise the view is sorted by something invisible, and there is no
    // header left to click to change it.
    expect(visibleSort(config(["artist", "album"]), "genre")).toBe("artist");
    expect(visibleSort(config(["artist", "album"]), "album")).toBe("album");
  });

  it("leaves query-level sorts alone, since they have no column either way", () => {
    expect(visibleSort(config(["artist"]), "relevance")).toBe("relevance");
    expect(visibleSort(config(["artist"]), "position")).toBe("position");
  });

  it("pins # first inside a release, whatever the layout says", () => {
    const release = { kind: "albums" as const, id: "Shields" };

    expect(displayedColumns(config(["title", "artist"]), release).ids).toEqual([
      "trackNo",
      "title",
      "artist",
    ]);
    expect(displayedColumns(config(["title", "trackNo", "artist"]), release).ids).toEqual([
      "trackNo",
      "title",
      "artist",
    ]);
  });

  it("shows the layout as stored everywhere else", () => {
    const layout = config(["title", "trackNo"], { trackNo: 90 });

    expect(displayedColumns(layout, null)).toBe(layout);
    expect(displayedColumns(layout, { kind: "artists", id: "Grizzly Bear" })).toBe(layout);
  });

  it("keeps widths for a pinned # the layout hides", () => {
    const layout = config(["title"], { trackNo: 90 });

    expect(displayedColumns(layout, { kind: "albums", id: "Shields" }).widths).toEqual({
      trackNo: 90,
    });
  });

  it("drops a column before the neighbour it lands in front of on screen", () => {
    // `#` shown first but stored between Title and Artist: counting the drop
    // into the stored order directly would leave Title where it was.
    const stored: SortField[] = ["title", "trackNo", "artist", "album"];
    const draggable: SortField[] = ["title", "artist", "album"];

    expect(storedDropIndex(stored, draggable, "title", 1)).toBe(2);
    expect(moveColumn(config(stored), "title", 2).ids).toEqual([
      "trackNo",
      "artist",
      "title",
      "album",
    ]);
    expect(storedDropIndex(stored, draggable, "album", 0)).toBe(0);
  });

  it("drops a column dragged to the end after the last one on screen", () => {
    const stored: SortField[] = ["title", "artist", "trackNo"];

    expect(storedDropIndex(stored, ["title", "artist"], "title", 1)).toBe(1);
  });

  it("counts a drop into the stored order unchanged when nothing is pinned", () => {
    const ids: SortField[] = ["title", "artist", "album", "genre"];

    for (const [id, drop] of [
      ["title", 2],
      ["genre", 0],
      ["artist", 3],
    ] as const) {
      expect(storedDropIndex(ids, ids, id, drop)).toBe(drop);
    }
  });

  it("round-trips through storage", () => {
    const original = config(["album", "title"], { album: 200 });

    expect(parseColumnConfig(serializeColumnConfig(original))).toEqual(original);
  });

  it("treats an absent config as the defaults", () => {
    expect(parseColumnConfig(null)).toEqual(DEFAULT_COLUMN_CONFIG);
  });

  it("survives anything a previous version might have written", () => {
    // Each of these has to produce a usable table rather than an empty one.
    for (const stored of ["", "null", "[]", "{}", '{"ids":"title"}', '{"ids":[]}', "not json"]) {
      expect(parseColumnConfig(stored)).toEqual(DEFAULT_COLUMN_CONFIG);
    }
  });

  it("drops column ids it no longer knows about", () => {
    // A column removed in a later version must not render as a blank.
    const parsed = parseColumnConfig('{"ids":["title","fictional","artist"],"version":1}');

    expect(parsed.ids).toEqual(["title", "artist"]);
  });

  it("drops duplicate ids, which would render one column twice", () => {
    expect(parseColumnConfig('{"ids":["title","title","artist"],"version":1}').ids).toEqual([
      "title",
      "artist",
    ]);
  });

  it("gives a layout saved before #, Year and Bit Rate were defaults the ones it lacks", () => {
    const parsed = parseColumnConfig('{"ids":["artist","year","title"]}');

    expect(parsed.ids).toEqual(["trackNo", "artist", "year", "title", "bitrate"]);
  });

  it("gives them only once, so a column hidden afterwards stays hidden", () => {
    const migrated = parseColumnConfig('{"ids":["title","artist"]}');
    const hidden = toggleColumn(migrated, "year");

    expect(parseColumnConfig(serializeColumnConfig(hidden)).ids).toEqual([
      "trackNo",
      "title",
      "artist",
      "bitrate",
    ]);
  });

  it("ignores widths that are not usable numbers", () => {
    const parsed = parseColumnConfig(
      '{"ids":["title","artist"],"widths":{"title":"wide","artist":null,"album":9e999}}',
    );

    expect(parsed.widths).toEqual({});
  });
});
