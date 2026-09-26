import { describe, expect, it } from "vitest";
import { albumIdentity } from "./browse";
import {
  backEntry,
  currentEntry,
  emptyHistory,
  forgetGroup,
  forgetPlaylist,
  forwardEntry,
  goBack,
  goForward,
  type History,
  type HistoryEntry,
  historyAt,
  parseEntry,
  record,
  sameView,
  serializeEntry,
} from "./history";

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { tab: "songs", browse: null, browseLabel: null, playlistId: null, stats: null, ...over };
}

/** A history that has visited each of `entries` in turn. */
function visited(entries: HistoryEntry[]): History {
  return entries.reduce(record, emptyHistory);
}

describe("sameView", () => {
  it("treats a drill-in as a different view from the tab it came from", () => {
    const list = entry({ tab: "albums" });
    const album = entry({
      tab: "albums",
      browse: { kind: "albums", id: albumIdentity("Shields", null) },
    });

    expect(sameView(list, album)).toBe(false);
  });

  it("tells two albums apart by artist as well as by title", () => {
    // Eponymous albums exist, and going back to the wrong one is worse than
    // not going back at all.
    const one = entry({ tab: "albums", browse: { kind: "albums", id: albumIdentity("A", "B") } });
    const other = entry({ tab: "albums", browse: { kind: "albums", id: albumIdentity("A", "C") } });

    expect(sameView(one, other)).toBe(false);
  });

  it("ignores the label, which is a name for an identity rather than part of it", () => {
    // The same release reached from a tile and from "reveal in library", which
    // labels it from the playing track's own casing of the tag.
    const fromTile = entry({
      tab: "albums",
      browse: { kind: "albums", id: albumIdentity("Shields", "Grizzly Bear") },
      browseLabel: "Shields",
    });
    const revealed = entry({
      tab: "albums",
      browse: { kind: "albums", id: albumIdentity("Shields", "Grizzly Bear") },
      browseLabel: "SHIELDS",
    });

    expect(sameView(fromTile, revealed)).toBe(true);
  });

  it("matches the untagged group against itself rather than against everything", () => {
    // An untagged release is two empty strings rather than a null - the album
    // identity never is one - while an untagged artist still keys on null.
    const untagged = entry({
      tab: "albums",
      browse: { kind: "albums", id: albumIdentity(null, null) },
    });
    const noArtist = entry({ tab: "artists", browse: { kind: "artists", id: null } });

    expect(sameView(untagged, { ...untagged })).toBe(true);
    expect(sameView(untagged, entry({ tab: "albums" }))).toBe(false);
    expect(sameView(noArtist, { ...noArtist })).toBe(true);
    expect(sameView(noArtist, entry({ tab: "artists" }))).toBe(false);
  });

  it("separates the same tab inside a playlist from the same tab outside one", () => {
    expect(sameView(entry(), entry({ playlistId: 5 }))).toBe(false);
  });
});

describe("record", () => {
  it("makes the recorded entry the current one", () => {
    const history = visited([entry(), entry({ tab: "albums" })]);

    expect(currentEntry(history)).toEqual(entry({ tab: "albums" }));
    expect(backEntry(history)).toEqual(entry());
  });

  it("ignores a repeat of the view already on screen", () => {
    const history = visited([entry(), entry({ tab: "albums" })]);

    const again = record(history, entry({ tab: "albums" }));

    // Otherwise pressing back once would appear to do nothing.
    expect(again).toBe(history);
  });

  it("abandons the forward branch when a new view is opened after going back", () => {
    const history = visited([entry(), entry({ tab: "albums" }), entry({ tab: "artists" })]);
    const back = goBack(history) as History;

    const branched = record(back, entry({ tab: "genres" }));

    expect(branched.entries.map((one) => one.tab)).toEqual(["songs", "albums", "genres"]);
    expect(forwardEntry(branched)).toBeNull();
  });
});

describe("back and forward", () => {
  it("refuses to move past either end", () => {
    const history = historyAt(entry());

    expect(goBack(history)).toBeNull();
    expect(goForward(history)).toBeNull();
  });

  it("returns to where forward came from", () => {
    const history = visited([entry(), entry({ tab: "albums" })]);

    const back = goBack(history) as History;
    const again = goForward(back) as History;

    expect(currentEntry(back)).toEqual(entry());
    expect(currentEntry(again)).toEqual(entry({ tab: "albums" }));
    // The entries themselves are untouched - only the index moved.
    expect(again.entries).toEqual(history.entries);
  });

  it("says where each direction would land, for the tooltips", () => {
    const history = goBack(
      visited([entry(), entry({ tab: "albums" }), entry({ tab: "genres" })]),
    ) as History;

    expect(backEntry(history)).toEqual(entry());
    expect(forwardEntry(history)).toEqual(entry({ tab: "genres" }));
  });
});

describe("forgetPlaylist", () => {
  it("drops every entry belonging to the deleted playlist", () => {
    const history = visited([entry(), entry({ playlistId: 5 }), entry({ playlistId: 9 })]);

    const forgotten = forgetPlaylist(history, 5);

    expect(forgotten.entries.map((one) => one.playlistId)).toEqual([null, 9]);
  });

  it("keeps pointing at the view on screen", () => {
    const history = visited([entry({ playlistId: 5 }), entry(), entry({ tab: "albums" })]);

    const forgotten = forgetPlaylist(history, 5);

    expect(currentEntry(forgotten)).toEqual(entry({ tab: "albums" }));
  });

  it("falls back to the nearest surviving entry behind a forgotten current one", () => {
    const history = goBack(visited([entry(), entry({ playlistId: 5 }), entry({ tab: "albums" })]));

    const forgotten = forgetPlaylist(history as History, 5);

    // The view being left is the one that was deleted, so back must land on
    // what came before it rather than on the entry that is gone.
    expect(currentEntry(forgotten)).toEqual(entry());
    expect(forwardEntry(forgotten)).toEqual(entry({ tab: "albums" }));
  });

  it("empties cleanly when the playlist was the only thing ever visited", () => {
    const forgotten = forgetPlaylist(historyAt(entry({ playlistId: 5 })), 5);

    expect(forgotten).toEqual(emptyHistory);
    expect(backEntry(forgotten)).toBeNull();
    expect(forwardEntry(forgotten)).toBeNull();
    expect(currentEntry(forgotten)).toBeNull();
  });
});

describe("forgetGroup", () => {
  const shields = entry({
    tab: "albums",
    browse: { kind: "albums", id: albumIdentity("Shields", "Grizzly Bear") },
  });

  it("drops only the entry that matches the dead group", () => {
    const veckatimest = entry({
      tab: "albums",
      browse: { kind: "albums", id: albumIdentity("Veckatimest", "Grizzly Bear") },
    });
    const history = visited([entry({ tab: "albums" }), shields, veckatimest]);

    const forgotten = forgetGroup(history, shields);

    expect(forgotten.entries).toEqual([entry({ tab: "albums" }), veckatimest]);
  });

  it("falls back to the entry behind it when the dead group was on screen", () => {
    const history = visited([entry(), entry({ tab: "albums" }), shields]);

    const forgotten = forgetGroup(history, shields);

    // Back must land on the list the drill-in came from, not on the drill-in.
    expect(currentEntry(forgotten)).toEqual(entry({ tab: "albums" }));
    expect(forwardEntry(forgotten)).toBeNull();
  });
});

describe("a statistics drill-down", () => {
  const listening = entry({ tab: "stats", stats: { tab: "listening", crumbs: [] } });
  const genre = entry({
    tab: "stats",
    stats: { tab: "listening", crumbs: [{ kind: "genre", key: "black metal" }] },
  });

  it("is a different view from the tab it started in", () => {
    expect(sameView(listening, genre)).toBe(false);
  });

  it("compares the crumbs element-wise", () => {
    const same = entry({
      tab: "stats",
      stats: { tab: "listening", crumbs: [{ kind: "genre", key: "black metal" }] },
    });
    const deeper = entry({
      tab: "stats",
      stats: {
        tab: "listening",
        crumbs: [
          { kind: "genre", key: "black metal" },
          { kind: "genre", key: "raw black metal" },
        ],
      },
    });

    expect(sameView(genre, same)).toBe(true);
    expect(sameView(genre, deeper)).toBe(false);
  });

  it("tells the two tabs apart under the same crumbs", () => {
    const library = entry({
      tab: "stats",
      stats: { tab: "library", crumbs: [{ kind: "genre", key: "black metal" }] },
    });

    expect(sameView(genre, library)).toBe(false);
  });

  it("is not recorded twice when the same slice is clicked again", () => {
    const history = visited([listening, genre]);

    expect(record(history, genre)).toBe(history);
  });

  it("is walked by back", () => {
    const history = visited([listening, genre]);

    expect(backEntry(history)).toEqual(listening);
  });
});

describe("parseEntry", () => {
  it("reads back what was written", () => {
    const drilled = entry({
      tab: "artists",
      browse: { kind: "artists", id: null },
      playlistId: 4,
    });
    const stats = entry({
      tab: "stats",
      stats: { tab: "library", crumbs: [{ kind: "genre", key: "Rock" }] },
    });

    expect(parseEntry(serializeEntry(drilled))).toEqual(drilled);
    expect(parseEntry(serializeEntry(stats))).toEqual(stats);
  });

  it("refuses what no navigation could have written", () => {
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry("{not json")).toBeNull();
    expect(parseEntry(JSON.stringify(entry({ tab: "podcasts" as never })))).toBeNull();
    // A drill-in filed under another tab, and Statistics with nowhere to point.
    expect(
      parseEntry(JSON.stringify(entry({ tab: "albums", browse: { kind: "genres", id: "Rock" } }))),
    ).toBeNull();
    expect(parseEntry(JSON.stringify(entry({ tab: "stats" })))).toBeNull();
  });
});
