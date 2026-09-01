import { describe, expect, it } from "vitest";
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
  record,
  sameView,
} from "./history";

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { tab: "songs", browse: null, playlistId: null, ...over };
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
      browse: { kind: "albums", key: "Shields", secondary: null },
    });

    expect(sameView(list, album)).toBe(false);
  });

  it("tells two albums apart by artist as well as by title", () => {
    // Eponymous albums exist, and going back to the wrong one is worse than
    // not going back at all.
    const one = entry({ tab: "albums", browse: { kind: "albums", key: "A", secondary: "B" } });
    const other = entry({ tab: "albums", browse: { kind: "albums", key: "A", secondary: "C" } });

    expect(sameView(one, other)).toBe(false);
  });

  it("matches the untagged group against itself rather than against everything", () => {
    const untagged = entry({
      tab: "albums",
      browse: { kind: "albums", key: null, secondary: null },
    });

    expect(sameView(untagged, { ...untagged })).toBe(true);
    expect(sameView(untagged, entry({ tab: "albums" }))).toBe(false);
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
    browse: { kind: "albums", key: "Shields", secondary: "Grizzly Bear" },
  });

  it("drops only the entry that matches the dead group", () => {
    const veckatimest = entry({
      tab: "albums",
      browse: { kind: "albums", key: "Veckatimest", secondary: "Grizzly Bear" },
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
