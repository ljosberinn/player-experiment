import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseGroup, Track, TrackQuery } from "../../ipc";
import {
  allTrackIds,
  browseGroups,
  libraryStats,
  loadColumnConfig,
  queryTracks,
  saveColumnConfig,
} from "../../ipc";
import { DEFAULT_COLUMN_CONFIG } from "./columns";
import { backEntry, forwardEntry, historyAt } from "./history";
import { PAGE_SIZE } from "./pageCache";
import { SEARCH_DEBOUNCE_MS, useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
}));

const statsMock = vi.mocked(libraryStats);
/** A `LibraryStats` with the count set; the footer's other totals are not what
    these tests are about. */
function stats(tracks: number) {
  return { tracks, durationMs: tracks * 200_000, bytes: tracks * 5_000_000, missing: 0 };
}

const queryTracksMock = vi.mocked(queryTracks);
const allTrackIdsMock = vi.mocked(allTrackIds);
const browseGroupsMock = vi.mocked(browseGroups);
const loadColumnConfigMock = vi.mocked(loadColumnConfig);
const saveColumnConfigMock = vi.mocked(saveColumnConfig);

function browseGroup(over: Partial<BrowseGroup> = {}): BrowseGroup {
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

function track(id: number): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 1000,
    title: `Track ${id}`,
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
  };
}

/** Rows numbered by absolute index, so a page's contents identify its offset. */
function rowsFor(query: TrackQuery): Track[] {
  return Array.from({ length: query.limit }, (_, i) => track(query.offset + i));
}

const initial = useLibraryStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({
    ...initial,
    total: 0,
    pages: new Map(),
    inFlight: new Set(),
    searchInput: "",
    search: "",
    sortBy: "artist",
    direction: "asc",
    sortBeforeSearch: null,
    playlistId: null,
    tab: "songs",
    browse: null,
    groups: [],
    groupsLoading: false,
    columns: DEFAULT_COLUMN_CONFIG,
    selection: { ids: new Set(), anchorIndex: null },
    error: null,
    queryToken: 0,
    history: historyAt({ tab: "songs", browse: null, playlistId: null }),
  });
  statsMock.mockResolvedValue(stats(1000));
  browseGroupsMock.mockResolvedValue([]);
  loadColumnConfigMock.mockResolvedValue(null);
  saveColumnConfigMock.mockResolvedValue(undefined);
  queryTracksMock.mockImplementation(async (query) => rowsFor(query));
});

describe("refresh", () => {
  it("keeps the totals the footer needs, not just the count", async () => {
    statsMock.mockResolvedValue({
      tracks: 5,
      durationMs: 3_000_000,
      bytes: 214_000_000,
      missing: 0,
    });

    await useLibraryStore.getState().refresh();

    // One call, not two: the count and the totals always change together, and
    // a second round trip per query change would be waste.
    expect(statsMock).toHaveBeenCalledTimes(1);
    expect(useLibraryStore.getState().stats).toEqual({
      tracks: 5,
      durationMs: 3_000_000,
      bytes: 214_000_000,
      missing: 0,
    });
  });

  it("keeps total and stats.tracks saying the same thing", async () => {
    statsMock.mockResolvedValue(stats(42));

    await useLibraryStore.getState().refresh();

    // `total` is what the virtualizer reads on every render; if the two ever
    // drift, the scrollbar and the footer describe different views.
    const state = useLibraryStore.getState();
    expect(state.total).toBe(state.stats.tracks);
  });

  it("loads the total and clears pages from the previous query", async () => {
    useLibraryStore.setState({ pages: new Map([[0, [track(0)]]]) });

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().total).toBe(1000);
    expect(useLibraryStore.getState().pages.size).toBe(0);
  });

  it("surfaces a backend failure instead of throwing", async () => {
    statsMock.mockRejectedValue("db is locked");

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().error).toContain("db is locked");
  });
});

describe("showPlaylist", () => {
  it("scopes the query to the playlist and opens it in its own order", async () => {
    await useLibraryStore.getState().showPlaylist(5);

    expect(statsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ playlistId: 5, sortBy: "position", direction: "asc" }),
    );
  });

  it("goes back to the library's own default on the way out", async () => {
    await useLibraryStore.getState().showPlaylist(5);

    await useLibraryStore.getState().showPlaylist(null);

    expect(statsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ playlistId: null, sortBy: "artist" }),
    );
  });

  it("drops the search and the selection when the source changes", async () => {
    useLibraryStore.setState({
      searchInput: "maki",
      search: "maki",
      selection: { ids: new Set([1, 2]), anchorIndex: 0 },
    });

    await useLibraryStore.getState().showPlaylist(5);

    // A search typed against the library is rarely the one you want against a
    // playlist, and the selected ids may not even be in it.
    expect(useLibraryStore.getState().searchInput).toBe("");
    expect(statsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: null }));
    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });

  it("does not requery when the source did not change", async () => {
    await useLibraryStore.getState().showPlaylist(5);
    statsMock.mockClear();

    await useLibraryStore.getState().showPlaylist(5);

    expect(statsMock).not.toHaveBeenCalled();
  });

  it("carries the playlist into every query the view makes", async () => {
    await useLibraryStore.getState().showPlaylist(5);
    allTrackIdsMock.mockResolvedValue([1, 2]);

    await useLibraryStore.getState().ensureRange(0, 10);
    await useLibraryStore.getState().queueIds();

    expect(queryTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ playlistId: 5 }));
    expect(allTrackIdsMock).toHaveBeenLastCalledWith(expect.objectContaining({ playlistId: 5 }));
  });
});

describe("ensureRange", () => {
  it("fetches only the pages a viewport spans", async () => {
    await useLibraryStore.getState().refresh();

    await useLibraryStore.getState().ensureRange(0, 10);

    expect(queryTracksMock).toHaveBeenCalledTimes(1);
    expect(queryTracksMock.mock.calls[0]?.[0]).toMatchObject({ offset: 0, limit: PAGE_SIZE });
  });

  it("does not refetch a page it already holds", async () => {
    await useLibraryStore.getState().refresh();
    await useLibraryStore.getState().ensureRange(0, 10);
    queryTracksMock.mockClear();

    await useLibraryStore.getState().ensureRange(5, 20);

    expect(queryTracksMock).not.toHaveBeenCalled();
  });

  it("does nothing when the library is empty", async () => {
    statsMock.mockResolvedValue(stats(0));
    await useLibraryStore.getState().refresh();

    await useLibraryStore.getState().ensureRange(0, 50);

    expect(queryTracksMock).not.toHaveBeenCalled();
  });

  it("never requests rows past the end of the library", async () => {
    statsMock.mockResolvedValue(stats(10));
    await useLibraryStore.getState().refresh();

    await useLibraryStore.getState().ensureRange(0, 500);

    expect(queryTracksMock).toHaveBeenCalledTimes(1);
    expect(queryTracksMock.mock.calls[0]?.[0]).toMatchObject({ offset: 0 });
  });

  it("makes rows readable once their page lands", async () => {
    await useLibraryStore.getState().refresh();
    expect(useLibraryStore.getState().rowAt(3)).toBeNull();

    await useLibraryStore.getState().ensureRange(0, 10);

    expect(useLibraryStore.getState().rowAt(3)?.id).toBe(3);
  });

  it("clears the in-flight marker when a page fails, so a retry is possible", async () => {
    await useLibraryStore.getState().refresh();
    queryTracksMock.mockRejectedValueOnce("boom");

    await useLibraryStore.getState().ensureRange(0, 10);

    expect(useLibraryStore.getState().error).toContain("boom");
    expect(useLibraryStore.getState().inFlight.size).toBe(0);
  });
});

/** Types a term and runs it immediately, skipping the debounce. */
async function search(term: string): Promise<void> {
  useLibraryStore.getState().setSearch(term);
  await useLibraryStore.getState().commitSearch();
}

describe("query changes", () => {
  it("passes a blank search as null rather than an empty string", async () => {
    await search("   ");

    expect(statsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: null }));
  });

  it("sends the search term and drops the selection", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1, 2]), anchorIndex: 0 } });

    await search("grizzly");

    expect(statsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "grizzly" }));
    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });

  it("flips direction when the same column is toggled twice", async () => {
    await useLibraryStore.getState().toggleSort("title");
    expect(useLibraryStore.getState()).toMatchObject({ sortBy: "title", direction: "asc" });

    await useLibraryStore.getState().toggleSort("title");
    expect(useLibraryStore.getState()).toMatchObject({ sortBy: "title", direction: "desc" });
  });

  it("starts ascending again when a different column is chosen", async () => {
    await useLibraryStore.getState().toggleSort("title");
    await useLibraryStore.getState().toggleSort("title");

    await useLibraryStore.getState().toggleSort("album");

    expect(useLibraryStore.getState()).toMatchObject({ sortBy: "album", direction: "asc" });
  });
});

describe("selection", () => {
  it("selects a clicked row", async () => {
    await useLibraryStore.getState().refresh();
    await useLibraryStore.getState().ensureRange(0, 10);

    useLibraryStore.getState().clickRow(2, 2, {});

    expect([...useLibraryStore.getState().selection.ids]).toEqual([2]);
  });

  it("extends over cached rows on shift-click", async () => {
    await useLibraryStore.getState().refresh();
    await useLibraryStore.getState().ensureRange(0, 10);
    useLibraryStore.getState().clickRow(1, 1, {});

    useLibraryStore.getState().clickRow(4, 4, { shift: true });

    expect([...useLibraryStore.getState().selection.ids]).toEqual([1, 2, 3, 4]);
  });

  it("asks the backend for ids on select-all, so it is not capped by the page size", async () => {
    statsMock.mockResolvedValue(stats(50_000));
    allTrackIdsMock.mockResolvedValue(Array.from({ length: 50_000 }, (_, i) => i));
    await useLibraryStore.getState().refresh();

    await useLibraryStore.getState().selectAll();

    expect(useLibraryStore.getState().selection.ids.size).toBe(50_000);
    // Crucially not queryTracks, which the backend caps at 1000 rows.
    expect(allTrackIdsMock).toHaveBeenCalled();
  });

  it("limits select-all to the current search", async () => {
    allTrackIdsMock.mockResolvedValue([1, 2]);
    await search("guitar");

    await useLibraryStore.getState().selectAll();

    expect(allTrackIdsMock).toHaveBeenCalledWith(expect.objectContaining({ search: "guitar" }));
  });

  it("clears the selection", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1]), anchorIndex: 0 } });

    useLibraryStore.getState().clearSelection();

    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });
});

describe("search debouncing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates the box immediately but not the query", () => {
    useLibraryStore.getState().setSearch("gri");

    expect(useLibraryStore.getState().searchInput).toBe("gri");
    expect(useLibraryStore.getState().search).toBe("");
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("issues one query for a burst of keystrokes", async () => {
    for (const term of ["g", "gr", "gri", "griz"]) {
      useLibraryStore.getState().setSearch(term);
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS / 2);
    }
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

    expect(statsMock).toHaveBeenCalledOnce();
    expect(statsMock).toHaveBeenCalledWith(expect.objectContaining({ search: "griz" }));
  });

  it("runs the pending search at once on commit", async () => {
    useLibraryStore.getState().setSearch("griz");
    await useLibraryStore.getState().commitSearch();

    expect(statsMock).toHaveBeenCalledOnce();

    // The cancelled timer must not fire a second query afterwards.
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);
    expect(statsMock).toHaveBeenCalledOnce();
  });

  it("clears the box and the query together", async () => {
    useLibraryStore.getState().setSearch("griz");
    await useLibraryStore.getState().commitSearch();
    statsMock.mockClear();

    await useLibraryStore.getState().clearSearch();

    expect(useLibraryStore.getState().searchInput).toBe("");
    expect(useLibraryStore.getState().search).toBe("");
    expect(statsMock).toHaveBeenCalledWith(expect.objectContaining({ search: null }));
  });

  it("does not re-query when the committed term has not changed", async () => {
    useLibraryStore.getState().setSearch("griz");
    await useLibraryStore.getState().commitSearch();
    statsMock.mockClear();

    await useLibraryStore.getState().commitSearch();

    expect(statsMock).not.toHaveBeenCalled();
  });
});

describe("relevance ranking", () => {
  it("ranks by relevance while searching and restores the sort afterwards", async () => {
    await useLibraryStore.getState().toggleSort("album");
    expect(useLibraryStore.getState()).toMatchObject({ sortBy: "album", direction: "asc" });

    await search("grizzly");
    expect(useLibraryStore.getState().sortBy).toBe("relevance");

    await useLibraryStore.getState().clearSearch();
    expect(useLibraryStore.getState()).toMatchObject({ sortBy: "album", direction: "asc" });
  });

  it("remembers the direction, not just the column", async () => {
    await useLibraryStore.getState().toggleSort("year");
    await useLibraryStore.getState().toggleSort("year");
    expect(useLibraryStore.getState().direction).toBe("desc");

    await search("grizzly");
    await useLibraryStore.getState().clearSearch();

    expect(useLibraryStore.getState()).toMatchObject({ sortBy: "year", direction: "desc" });
  });

  it("keeps a column the user chose during the search", async () => {
    await search("grizzly");
    await useLibraryStore.getState().toggleSort("title");

    await useLibraryStore.getState().clearSearch();

    expect(useLibraryStore.getState().sortBy).toBe("title");
  });

  it("does not switch to relevance while narrowing an existing search", async () => {
    await search("grizzly");
    await useLibraryStore.getState().toggleSort("title");

    await search("grizzly bear");

    expect(useLibraryStore.getState().sortBy).toBe("title");
  });
});

describe("stale responses", () => {
  it("drops a count that belongs to a superseded query", async () => {
    // The first search resolves only after the second has already been issued.
    let releaseFirst: (value: ReturnType<typeof stats>) => void = () => {};
    statsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    statsMock.mockResolvedValueOnce(stats(7));

    const first = search("a");
    const second = search("ab");
    releaseFirst(stats(9999));
    await Promise.all([first, second]);

    expect(useLibraryStore.getState().total).toBe(7);
  });

  it("drops rows that belong to a superseded query", async () => {
    useLibraryStore.setState({ total: 1000 });
    let releasePage: (rows: Track[]) => void = () => {};
    queryTracksMock.mockImplementationOnce(
      () =>
        new Promise<Track[]>((resolve) => {
          releasePage = resolve;
        }),
    );

    const pending = useLibraryStore.getState().ensureRange(0, 10);
    // A new query lands while that page is still in flight.
    await useLibraryStore.getState().refresh();
    releasePage([track(999)]);
    await pending;

    expect(useLibraryStore.getState().pages.size).toBe(0);
  });
});

describe("browse tabs", () => {
  it("loads the open tab's groups and leaves songs alone", async () => {
    browseGroupsMock.mockResolvedValue([browseGroup()]);

    await useLibraryStore.getState().showTab("albums");

    expect(browseGroupsMock).toHaveBeenCalledTimes(1);
    expect(browseGroupsMock.mock.calls[0]?.[1]).toBe("albums");
    expect(useLibraryStore.getState().groups).toHaveLength(1);
  });

  it("asks for no groups at all on the songs tab", async () => {
    await useLibraryStore.getState().refresh();

    expect(browseGroupsMock).not.toHaveBeenCalled();
  });

  it("clears the previous tab's groups rather than showing them under the new one", async () => {
    browseGroupsMock.mockResolvedValue([browseGroup()]);
    await useLibraryStore.getState().showTab("albums");

    // Slow enough that the stale groups would be visible if they were kept.
    browseGroupsMock.mockImplementation(() => new Promise(() => []));
    const pending = useLibraryStore.getState().showTab("artists");

    expect(useLibraryStore.getState().groups).toEqual([]);
    void pending;
  });

  it("narrows the group list by the search, the way it narrows rows", async () => {
    await useLibraryStore.getState().showTab("albums");
    browseGroupsMock.mockClear();

    useLibraryStore.setState({ search: "bear" });
    await useLibraryStore.getState().refresh();

    expect(browseGroupsMock.mock.calls[0]?.[0].search).toBe("bear");
  });

  it("keeps the search across a tab change", async () => {
    useLibraryStore.setState({ search: "bear", searchInput: "bear" });

    await useLibraryStore.getState().showTab("albums");

    // Asking the same question of a different view is the point of the tabs;
    // re-typing it to switch would be the annoying part.
    expect(useLibraryStore.getState().search).toBe("bear");
  });

  it("does not let an open drill-in filter the list it came from", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    browseGroupsMock.mockClear();

    await useLibraryStore.getState().refresh();

    // Otherwise opening an album collapses the album list to that one album,
    // and there is no way back.
    expect(browseGroupsMock.mock.calls[0]?.[0].browse).toBeNull();
  });

  it("scopes the songs query to the group that was opened", async () => {
    await useLibraryStore.getState().showTab("albums");

    await useLibraryStore.getState().openGroup(browseGroup());

    expect(useLibraryStore.getState().browse).toEqual({
      kind: "albums",
      key: "Shields",
      secondary: "Grizzly Bear",
    });
    expect(statsMock.mock.calls.at(-1)?.[0].browse).toEqual({
      kind: "albums",
      key: "Shields",
      secondary: "Grizzly Bear",
    });
  });

  it("carries a null key through rather than dropping the filter", async () => {
    await useLibraryStore.getState().showTab("albums");

    await useLibraryStore.getState().openGroup(browseGroup({ key: null, secondary: null }));

    // A dropped filter would show the whole library as though it were the
    // untagged group, which is the failure that looks like success.
    expect(useLibraryStore.getState().browse).toEqual({
      kind: "albums",
      key: null,
      secondary: null,
    });
  });

  it("opens an album in track order, not the library's artist order", async () => {
    await useLibraryStore.getState().showTab("albums");

    await useLibraryStore.getState().openGroup(browseGroup());

    expect(useLibraryStore.getState().sortBy).toBe("trackNo");
  });

  it("returns to the group list without changing tab", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());

    await useLibraryStore.getState().closeGroup();

    expect(useLibraryStore.getState().browse).toBeNull();
    expect(useLibraryStore.getState().tab).toBe("albums");
  });

  it("drops the drill-in when the playlist changes", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());

    await useLibraryStore.getState().showPlaylist(7);

    // That album is unlikely to be in the playlist, and a stale filter would
    // show an empty view for no visible reason.
    expect(useLibraryStore.getState().browse).toBeNull();
  });

  it("drops a group list that a newer query has already superseded", async () => {
    useLibraryStore.setState({ tab: "albums" });
    // Resolvers are captured per call rather than relying on which refresh
    // reaches the mock first - that ordering is a microtask detail, and a test
    // that depends on it deadlocks instead of failing.
    const resolvers: ((groups: BrowseGroup[]) => void)[] = [];
    browseGroupsMock.mockImplementation(
      () =>
        new Promise<BrowseGroup[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const stale = useLibraryStore.getState().refresh();
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    const fresh = useLibraryStore.getState().refresh();
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    // The newer query answers first, then the one it superseded.
    resolvers[1]?.([browseGroup({ key: "Newer" })]);
    await fresh;
    resolvers[0]?.([browseGroup({ key: "Stale" })]);
    await stale;

    expect(useLibraryStore.getState().groups.map((g) => g.key)).toEqual(["Newer"]);
  });
});

describe("leaving a drill-in that has emptied", () => {
  it("backs out to the group list and drops the dead entry from history", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    statsMock.mockResolvedValue(stats(0));

    // Stands in for the editor's refresh after a tag change moved every song
    // in "Shields" out from under it.
    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().browse).toBeNull();
    expect(useLibraryStore.getState().tab).toBe("albums");
    // Back must land on what came before the drill-in, not on it, and forward
    // must have nothing left to offer.
    expect(backEntry(useLibraryStore.getState().history)).toMatchObject({ tab: "songs" });
    expect(forwardEntry(useLibraryStore.getState().history)).toBeNull();
  });

  it("leaves a search that matches nothing inside a group alone", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    useLibraryStore.setState({ search: "no such track" });
    statsMock.mockResolvedValue(stats(0));

    await useLibraryStore.getState().refresh();

    // Nothing matching a typed search is a legitimate result, not a sign the
    // group is gone.
    expect(useLibraryStore.getState().browse).not.toBeNull();
  });

  it("does not eject while the refresh is still in flight", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    statsMock.mockImplementation(() => new Promise(() => {}));

    const pending = useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().browse).not.toBeNull();
    void pending;
  });

  it("does nothing outside a drill-in", async () => {
    const historyBefore = useLibraryStore.getState().history;
    statsMock.mockResolvedValue(stats(0));

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().browse).toBeNull();
    expect(useLibraryStore.getState().history).toBe(historyBefore);
  });
});

describe("column layout", () => {
  it("persists a change against the view it was made in", async () => {
    useLibraryStore.setState({ playlistId: 7 });

    await useLibraryStore.getState().toggleColumn("year");

    expect(saveColumnConfigMock).toHaveBeenCalledWith(7, expect.stringContaining("year"));
  });

  it("reads a playlist's own layout when it has one", async () => {
    loadColumnConfigMock.mockResolvedValue('{"ids":["path"]}');
    useLibraryStore.setState({ playlistId: 7 });

    await useLibraryStore.getState().loadColumns();

    expect(useLibraryStore.getState().columns.ids).toEqual(["path"]);
  });

  it("inherits the library's layout for a playlist that has none", async () => {
    // Falling back to the defaults instead would ignore a layout the user has
    // already chosen once; starting bare would be worse still.
    loadColumnConfigMock.mockImplementation(async (playlistId) =>
      playlistId === null ? '{"ids":["album","year"]}' : null,
    );
    useLibraryStore.setState({ playlistId: 7 });

    await useLibraryStore.getState().loadColumns();

    expect(useLibraryStore.getState().columns.ids).toEqual(["album", "year"]);
  });

  it("reloads the layout when the view changes", async () => {
    loadColumnConfigMock.mockResolvedValue('{"ids":["genre"]}');

    await useLibraryStore.getState().showPlaylist(3);

    expect(loadColumnConfigMock).toHaveBeenCalledWith(3);
    expect(useLibraryStore.getState().columns.ids).toEqual(["genre"]);
  });

  it("falls back to a working table when the stored layout will not load", async () => {
    loadColumnConfigMock.mockRejectedValue(new Error("database is locked"));

    await useLibraryStore.getState().loadColumns();

    expect(useLibraryStore.getState().columns).toEqual(DEFAULT_COLUMN_CONFIG);
    // Not worth an error banner over the table: the defaults are usable.
    expect(useLibraryStore.getState().error).toBeNull();
  });

  it("reports a layout that could not be saved", async () => {
    saveColumnConfigMock.mockRejectedValue(new Error("disk full"));

    await useLibraryStore.getState().toggleColumn("year");

    // Silence would look like it saved, and it would be gone next launch.
    expect(useLibraryStore.getState().error).toContain("disk full");
  });

  it("moves the sort off a column it just hid, and re-queries", async () => {
    useLibraryStore.setState({
      columns: { ids: ["title", "artist"], widths: {} },
      sortBy: "artist",
    });
    statsMock.mockClear();

    await useLibraryStore.getState().toggleColumn("artist");

    // A view sorted by an invisible column looks unsorted, and there is no
    // header left to click to fix it.
    expect(useLibraryStore.getState().sortBy).toBe("title");
    expect(statsMock).toHaveBeenCalled();
  });

  it("does not re-query for a change that leaves the sort alone", async () => {
    useLibraryStore.setState({
      columns: { ids: ["title", "artist"], widths: {} },
      sortBy: "title",
    });
    statsMock.mockClear();

    await useLibraryStore.getState().resizeColumn("title", 300);

    // Dragging a divider is not a query change; refetching every page mid-drag
    // would be a lot of work to show the same rows.
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("keeps the sort when a hidden column is shown again", async () => {
    useLibraryStore.setState({ columns: { ids: ["title"], widths: {} }, sortBy: "title" });

    await useLibraryStore.getState().toggleColumn("year");

    expect(useLibraryStore.getState().sortBy).toBe("title");
    expect(useLibraryStore.getState().columns.ids).toEqual(["title", "year"]);
  });

  it("puts the defaults back", async () => {
    useLibraryStore.setState({ columns: { ids: ["path"], widths: { path: 900 } } });

    await useLibraryStore.getState().resetColumns();

    expect(useLibraryStore.getState().columns).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(saveColumnConfigMock).toHaveBeenCalled();
  });

  it("drops the fit along with the config when the columns are reset", async () => {
    useLibraryStore.setState({ fittedWidths: { title: 90 } });

    await useLibraryStore.getState().resetColumns();

    // Left in place, "Reset Columns" would appear to do nothing at all to the
    // columns that had been fitted.
    expect(useLibraryStore.getState().fittedWidths).toEqual({});
  });
});

describe("fitting the columns to a view", () => {
  it("does not persist a fit", async () => {
    saveColumnConfigMock.mockClear();

    useLibraryStore.getState().fitColumns({ title: 120, artist: 90 });

    expect(useLibraryStore.getState().fittedWidths).toEqual({ title: 120, artist: 90 });
    // Transient by design: recomputed on the next navigation, so storing it
    // would freeze the answer this view happened to give first.
    expect(saveColumnConfigMock).not.toHaveBeenCalled();
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("consumes the pending flag, so a later page landing does not refit", () => {
    useLibraryStore.setState({ fitPending: true });

    useLibraryStore.getState().fitColumns({ title: 120 });

    expect(useLibraryStore.getState().fitPending).toBe(false);
  });

  it("asks for a fit on every navigation that lands rows", async () => {
    useLibraryStore.setState({ fitPending: false });

    await useLibraryStore.getState().showTab("albums");

    expect(useLibraryStore.getState().fitPending).toBe(true);
  });

  it("drops the previous view's fit as it navigates", async () => {
    useLibraryStore.setState({ fittedWidths: { artist: 90 } });

    await useLibraryStore.getState().showTab("albums");

    // Not held until the new fit arrives: the outgoing widths describe rows
    // that are already gone.
    expect(useLibraryStore.getState().fittedWidths).toEqual({});
  });

  it("does not ask for a fit when the sort changes", async () => {
    useLibraryStore.setState({ fitPending: false });

    await useLibraryStore.getState().toggleSort("album");

    // Every navigation reaches `refresh`, but so does every sort toggle and
    // every debounced keystroke - and columns that resize while typing are
    // worse than columns that are too wide.
    expect(useLibraryStore.getState().fitPending).toBe(false);
  });
});

describe("navigation history", () => {
  it("goes back to the view that was open before", async () => {
    await useLibraryStore.getState().showTab("albums");

    await useLibraryStore.getState().back();

    expect(useLibraryStore.getState().tab).toBe("songs");
  });

  it("does one refresh per navigation, not one per field it changes", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    statsMock.mockClear();

    await useLibraryStore.getState().back();

    // Four fields describe the view and each has an action that refreshes on
    // its own; replaying a state through those actions would query four times.
    expect(statsMock).toHaveBeenCalledTimes(1);
  });

  it("goes forward again to where back came from", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().back();

    await useLibraryStore.getState().forward();

    expect(useLibraryStore.getState().tab).toBe("albums");
  });

  it("does nothing at either end", async () => {
    statsMock.mockClear();

    await useLibraryStore.getState().back();
    await useLibraryStore.getState().forward();

    expect(statsMock).not.toHaveBeenCalled();
  });

  it("restores the drill-in, not merely the tab it was in", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    await useLibraryStore.getState().closeGroup();

    await useLibraryStore.getState().back();

    expect(useLibraryStore.getState().browse).toEqual({
      kind: "albums",
      key: "Shields",
      secondary: "Grizzly Bear",
    });
  });

  it("opens an album in track order on the way back into it", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().openGroup(browseGroup());
    await useLibraryStore.getState().toggleSort("title");
    await useLibraryStore.getState().closeGroup();

    await useLibraryStore.getState().back();

    // The sort is derived rather than recorded: an album read by title once
    // is still an album, and the order it is for is its own.
    expect(useLibraryStore.getState().sortBy).toBe("trackNo");
  });

  it("reloads the columns on the way back into a playlist", async () => {
    await useLibraryStore.getState().showPlaylist(5);
    await useLibraryStore.getState().showTab("albums");
    loadColumnConfigMock.mockClear();

    await useLibraryStore.getState().back();

    // Columns are stored per playlist, so a view on the other side of that
    // boundary may have its own - and it may move the sort.
    expect(loadColumnConfigMock).toHaveBeenCalledWith(5);
  });

  it("does not reload the columns between two views of the same source", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().showTab("artists");
    loadColumnConfigMock.mockClear();

    await useLibraryStore.getState().back();

    // Both are the library's own layout - re-reading it would be a round trip
    // to be told what is already on screen.
    expect(loadColumnConfigMock).not.toHaveBeenCalled();
  });

  it("leaves the playlist and picks the view in one entry", async () => {
    await useLibraryStore.getState().showPlaylist(5);
    statsMock.mockClear();

    await useLibraryStore.getState().showTab("songs");

    expect(useLibraryStore.getState()).toMatchObject({ playlistId: null, tab: "songs" });
    // Leaving a playlist for Songs used to be two awaits and two queries.
    expect(statsMock).toHaveBeenCalledTimes(1);
    // And one entry, so back returns to the playlist rather than to a
    // half-applied state between the two.
    await useLibraryStore.getState().back();
    expect(useLibraryStore.getState().playlistId).toBe(5);
  });

  it("does not record clicking the tab that is already open", async () => {
    await useLibraryStore.getState().showTab("albums");

    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().back();

    // Otherwise back would appear to do nothing the first time it is pressed.
    expect(useLibraryStore.getState().tab).toBe("songs");
  });

  it("abandons the forward branch when a new view is opened after going back", async () => {
    await useLibraryStore.getState().showTab("albums");
    await useLibraryStore.getState().back();

    await useLibraryStore.getState().showTab("genres");

    expect(forwardEntry(useLibraryStore.getState().history)).toBeNull();
  });

  it("keeps the search and re-points what clearing it returns to", async () => {
    await search("bear");
    expect(useLibraryStore.getState().sortBy).toBe("relevance");

    await useLibraryStore.getState().showPlaylist(5);
    await useLibraryStore.getState().showTab("albums");

    // The playlist change cleared the search, so this is the library's own
    // default rather than the playlist's position order.
    expect(useLibraryStore.getState()).toMatchObject({ search: "", sortBy: "artist" });
  });

  it("lands in the new view's natural order when the search is cleared there", async () => {
    await useLibraryStore.getState().showTab("albums");
    await search("bear");

    await useLibraryStore.getState().openGroup(browseGroup());
    await useLibraryStore.getState().clearSearch();

    // Relevance ranking survives the move - the term is still on screen - but
    // clearing the box must not land in the album list's order.
    expect(useLibraryStore.getState().sortBy).toBe("trackNo");
  });

  it("forgets a deleted playlist rather than offering to go back to it", async () => {
    await useLibraryStore.getState().showPlaylist(5);
    await useLibraryStore.getState().showTab("albums");

    useLibraryStore.getState().forgetPlaylist(5);

    expect(backEntry(useLibraryStore.getState().history)).toMatchObject({
      tab: "songs",
      playlistId: null,
    });
  });
});
