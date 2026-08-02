import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackQuery } from "../../ipc";
import { allTrackIds, countTracks, queryTracks } from "../../ipc";
import { PAGE_SIZE } from "./pageCache";
import { SEARCH_DEBOUNCE_MS, useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(),
}));

const countTracksMock = vi.mocked(countTracks);
const queryTracksMock = vi.mocked(queryTracks);
const allTrackIdsMock = vi.mocked(allTrackIds);

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
    selection: { ids: new Set(), anchorIndex: null },
    error: null,
    queryToken: 0,
  });
  countTracksMock.mockResolvedValue(1000);
  queryTracksMock.mockImplementation(async (query) => rowsFor(query));
});

describe("refresh", () => {
  it("loads the total and clears pages from the previous query", async () => {
    useLibraryStore.setState({ pages: new Map([[0, [track(0)]]]) });

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().total).toBe(1000);
    expect(useLibraryStore.getState().pages.size).toBe(0);
  });

  it("surfaces a backend failure instead of throwing", async () => {
    countTracksMock.mockRejectedValue("db is locked");

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().error).toContain("db is locked");
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
    countTracksMock.mockResolvedValue(0);
    await useLibraryStore.getState().refresh();

    await useLibraryStore.getState().ensureRange(0, 50);

    expect(queryTracksMock).not.toHaveBeenCalled();
  });

  it("never requests rows past the end of the library", async () => {
    countTracksMock.mockResolvedValue(10);
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

    expect(countTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: null }));
  });

  it("sends the search term and drops the selection", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1, 2]), anchorIndex: 0 } });

    await search("grizzly");

    expect(countTracksMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "grizzly" }),
    );
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
    countTracksMock.mockResolvedValue(50_000);
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
    expect(countTracksMock).not.toHaveBeenCalled();
  });

  it("issues one query for a burst of keystrokes", async () => {
    for (const term of ["g", "gr", "gri", "griz"]) {
      useLibraryStore.getState().setSearch(term);
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS / 2);
    }
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

    expect(countTracksMock).toHaveBeenCalledOnce();
    expect(countTracksMock).toHaveBeenCalledWith(expect.objectContaining({ search: "griz" }));
  });

  it("runs the pending search at once on commit", async () => {
    useLibraryStore.getState().setSearch("griz");
    await useLibraryStore.getState().commitSearch();

    expect(countTracksMock).toHaveBeenCalledOnce();

    // The cancelled timer must not fire a second query afterwards.
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);
    expect(countTracksMock).toHaveBeenCalledOnce();
  });

  it("clears the box and the query together", async () => {
    useLibraryStore.getState().setSearch("griz");
    await useLibraryStore.getState().commitSearch();
    countTracksMock.mockClear();

    await useLibraryStore.getState().clearSearch();

    expect(useLibraryStore.getState().searchInput).toBe("");
    expect(useLibraryStore.getState().search).toBe("");
    expect(countTracksMock).toHaveBeenCalledWith(expect.objectContaining({ search: null }));
  });

  it("does not re-query when the committed term has not changed", async () => {
    useLibraryStore.getState().setSearch("griz");
    await useLibraryStore.getState().commitSearch();
    countTracksMock.mockClear();

    await useLibraryStore.getState().commitSearch();

    expect(countTracksMock).not.toHaveBeenCalled();
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
    let releaseFirst: (value: number) => void = () => {};
    countTracksMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    countTracksMock.mockResolvedValueOnce(7);

    const first = search("a");
    const second = search("ab");
    releaseFirst(9999);
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
