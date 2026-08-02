import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackQuery } from "../../ipc";
import { allTrackIds, countTracks, queryTracks } from "../../ipc";
import { PAGE_SIZE } from "./pageCache";
import { useLibraryStore } from "./store";

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
    search: "",
    sortBy: "artist",
    direction: "asc",
    selection: { ids: new Set(), anchorIndex: null },
    error: null,
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

describe("query changes", () => {
  it("passes a blank search as null rather than an empty string", async () => {
    await useLibraryStore.getState().setSearch("   ");

    expect(countTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: null }));
  });

  it("sends the search term and drops the selection", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1, 2]), anchorIndex: 0 } });

    await useLibraryStore.getState().setSearch("grizzly");

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
    await useLibraryStore.getState().setSearch("guitar");

    await useLibraryStore.getState().selectAll();

    expect(allTrackIdsMock).toHaveBeenCalledWith(expect.objectContaining({ search: "guitar" }));
  });

  it("clears the selection", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1]), anchorIndex: 0 } });

    useLibraryStore.getState().clearSelection();

    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });
});
