import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  allTrackIds,
  createPlaylist,
  createSmartPlaylist,
  deletePlaylist,
  type FilterGroup,
  listPlaylists,
  loadSidebarSections,
  moveInPlaylist,
  onLibraryChanged,
  type Playlist,
  playlistFilter,
  playlistOrder,
  removeFromPlaylist,
  renamePlaylist,
  type SmartOrder,
  saveSidebarSections,
  setPlaylistFilter,
} from "../../ipc";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "../player/store";
import { useStatusStore } from "../shell/statusStore";
import { emptyFilter, noOrder } from "../smart/filterTree";
import { RECOUNT_DEBOUNCE_MS, usePlaylistsStore } from "./store";

vi.mock("../../ipc", () => ({
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  createSmartPlaylist: vi.fn(),
  setPlaylistFilter: vi.fn(),
  playlistFilter: vi.fn(),
  playlistOrder: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  moveInPlaylist: vi.fn(),
  loadSidebarSections: vi.fn(async () => null),
  saveSidebarSections: vi.fn(async () => undefined),
  onLibraryChanged: vi.fn(async () => () => {}),
  countTracks: vi.fn(async () => 0),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  playerPlay: vi.fn(async () => undefined),
}));

function playlist(id: number, name: string, trackCount = 0): Playlist {
  return { id, name, kind: "static", trackCount, createdAt: 0 };
}

function smartPlaylist(id: number, name: string, trackCount = 0): Playlist {
  return { id, name, kind: "smart", trackCount, createdAt: 0 };
}

const yearIs2012: FilterGroup = {
  combinator: "all",
  children: [{ type: "rule", field: "year", op: "is", value: { kind: "number", number: 2012 } }],
};

const topPlayed: SmartOrder = { sort: { field: "playCount", direction: "desc" }, limit: 100 };

const initialLibrary = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initialLibrary, playlistId: null, total: 0, pages: new Map() });
  usePlaylistsStore.setState({
    ...initialPlaylists,
    playlists: [],
    editing: null,
    renaming: null,
    collapsed: {},
  });
  useStatusStore.setState({ message: null, notice: null });
  vi.mocked(listPlaylists).mockResolvedValue([]);
  // Restated rather than left to `clearAllMocks`, which clears the calls and
  // keeps the implementation: without this, one test's stored order leaks into
  // every later test that opens the editor.
  vi.mocked(playlistOrder).mockResolvedValue(topPlayed);
});

describe("playlists store", () => {
  it("loads the sidebar's list", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 4)]);

    await usePlaylistsStore.getState().load();

    expect(usePlaylistsStore.getState().playlists).toEqual([playlist(1, "Evening", 4)]);
  });

  it("puts a new playlist straight into rename without stealing the view", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(7, "New Playlist"));

    await usePlaylistsStore.getState().create("New Playlist");

    // Switching to it would hide the songs you were about to drag into it,
    // and there is nothing in it to look at yet.
    expect(useLibraryStore.getState().playlistId).toBeNull();
    expect(usePlaylistsStore.getState().renaming).toBe(7);
  });

  it("starts and ends a rename on demand", () => {
    usePlaylistsStore.getState().startRename(3);
    expect(usePlaylistsStore.getState().renaming).toBe(3);

    usePlaylistsStore.getState().endRename();
    expect(usePlaylistsStore.getState().renaming).toBeNull();
  });

  it("leaves a deleted playlist's view before the sidebar drops it", async () => {
    vi.mocked(deletePlaylist).mockResolvedValue(undefined);
    await useLibraryStore.getState().showPlaylist(3);

    await usePlaylistsStore.getState().remove(3);

    // Otherwise the next query runs against an id that no longer exists.
    expect(useLibraryStore.getState().playlistId).toBeNull();
    expect(useLibraryStore.getState().sortBy).toBe("artist");
  });

  it("takes a deleted playlist out of the navigation history", async () => {
    vi.mocked(deletePlaylist).mockResolvedValue(undefined);
    await useLibraryStore.getState().showPlaylist(3);
    await useLibraryStore.getState().showTab("albums");

    await usePlaylistsStore.getState().remove(3);
    await useLibraryStore.getState().back();

    // Back must not land on a playlist that no longer exists - the query would
    // run against a dead id and the view would be empty for no visible reason.
    expect(useLibraryStore.getState().playlistId).toBeNull();
  });

  it("stays where it is when some other playlist is deleted", async () => {
    vi.mocked(deletePlaylist).mockResolvedValue(undefined);
    await useLibraryStore.getState().showPlaylist(3);

    await usePlaylistsStore.getState().remove(9);

    expect(useLibraryStore.getState().playlistId).toBe(3);
  });

  it("reports how many of a drop actually landed", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(addToPlaylist).mockResolvedValue(2);

    await usePlaylistsStore.getState().addTracks(1, [10, 11, 12]);

    expect(useStatusStore.getState().notice).toBe("Added 2 songs to Evening; 1 already there.");
  });

  it("does not mention skipped tracks when nothing was skipped", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(addToPlaylist).mockResolvedValue(1);

    await usePlaylistsStore.getState().addTracks(1, [10]);

    expect(useStatusStore.getState().notice).toBe("Added 1 song to Evening.");
  });

  it("does not call the backend for an empty drop", async () => {
    await usePlaylistsStore.getState().addTracks(1, []);
    await usePlaylistsStore.getState().removeTracks(1, []);
    await usePlaylistsStore.getState().moveTracks(1, [], 0);

    expect(addToPlaylist).not.toHaveBeenCalled();
    expect(removeFromPlaylist).not.toHaveBeenCalled();
    expect(moveInPlaylist).not.toHaveBeenCalled();
  });

  it("clears the selection after removing what was selected", async () => {
    vi.mocked(removeFromPlaylist).mockResolvedValue(2);
    useLibraryStore.setState({ selection: { ids: new Set([10, 11]), anchorIndex: 0 } });

    await usePlaylistsStore.getState().removeTracks(1, [10, 11]);

    // The ids are gone from the view, so a selection holding them would be a
    // selection of nothing that the next Delete would act on again.
    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });

  it("surfaces a rename failure instead of leaving the sidebar stale", async () => {
    vi.mocked(renamePlaylist).mockRejectedValue("A playlist needs a name.");

    await usePlaylistsStore.getState().rename(1, "   ");

    expect(useStatusStore.getState().message).toContain("A playlist needs a name.");
  });

  it("opens the editor on a blank filter for a new smart playlist", async () => {
    await usePlaylistsStore.getState().editSmart(null);

    expect(usePlaylistsStore.getState().editing).toEqual({
      playlistId: null,
      name: "New Smart Playlist",
      filter: emptyFilter,
      order: noOrder,
    });
    expect(playlistFilter).not.toHaveBeenCalled();
  });

  it("reads the stored filter when editing an existing one", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([smartPlaylist(4, "Recent")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(playlistFilter).mockResolvedValue(yearIs2012);

    await usePlaylistsStore.getState().editSmart(4);

    expect(usePlaylistsStore.getState().editing).toEqual({
      playlistId: 4,
      name: "Recent",
      filter: yearIs2012,
      order: topPlayed,
    });
  });

  it("reads the filter and the order together when opening the editor", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([smartPlaylist(4, "Most Played")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(playlistFilter).mockResolvedValue(yearIs2012);

    await usePlaylistsStore.getState().editSmart(4);

    // Both, and from the backend rather than from the sidebar's rows: neither
    // is carried on a `Playlist`, and opening on one playlist's rules beside
    // another's cutoff would be a silent way to rewrite a playlist.
    expect(playlistFilter).toHaveBeenCalledWith(4);
    expect(playlistOrder).toHaveBeenCalledWith(4);
    expect(usePlaylistsStore.getState().editing?.order).toEqual(topPlayed);
  });

  it("treats a playlist with no stored filter as an empty one", async () => {
    vi.mocked(playlistFilter).mockResolvedValue(null);

    await usePlaylistsStore.getState().editSmart(4);

    expect(usePlaylistsStore.getState().editing?.filter).toEqual(emptyFilter);
  });

  it("creates and opens a new smart playlist on save", async () => {
    vi.mocked(createSmartPlaylist).mockResolvedValue(smartPlaylist(7, "Recent"));
    await usePlaylistsStore.getState().editSmart(null);

    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012, topPlayed);

    expect(createSmartPlaylist).toHaveBeenCalledWith("Recent", yearIs2012, topPlayed);
    expect(usePlaylistsStore.getState().editing).toBeNull();
    expect(useLibraryStore.getState().playlistId).toBe(7);
  });

  it("re-asks the view when the filter behind it changes", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([smartPlaylist(4, "Recent")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(setPlaylistFilter).mockResolvedValue(undefined);
    vi.mocked(playlistFilter).mockResolvedValue(emptyFilter);
    await useLibraryStore.getState().showPlaylist(4);
    await usePlaylistsStore.getState().editSmart(4);
    const before = useLibraryStore.getState().queryToken;

    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012, topPlayed);

    // Membership is the filter, so there is nothing to recompute - only to
    // ask again.
    expect(setPlaylistFilter).toHaveBeenCalledWith(4, yearIs2012, topPlayed);
    expect(useLibraryStore.getState().queryToken).toBeGreaterThan(before);
  });

  it("renames only when the name in the editor actually changed", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([smartPlaylist(4, "Recent")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(setPlaylistFilter).mockResolvedValue(undefined);
    vi.mocked(playlistFilter).mockResolvedValue(emptyFilter);

    await usePlaylistsStore.getState().editSmart(4);
    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012, topPlayed);
    expect(renamePlaylist).not.toHaveBeenCalled();

    await usePlaylistsStore.getState().editSmart(4);
    await usePlaylistsStore.getState().saveSmart("Older", yearIs2012, topPlayed);
    expect(renamePlaylist).toHaveBeenCalledWith(4, "Older");
  });

  it("keeps the editor open when the backend refuses the filter", async () => {
    vi.mocked(createSmartPlaylist).mockRejectedValue("Year does not accept Contains.");
    await usePlaylistsStore.getState().editSmart(null);

    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012, topPlayed);

    // Closing it would throw away everything the user built.
    expect(usePlaylistsStore.getState().editing).not.toBeNull();
    expect(useStatusStore.getState().message).toContain("does not accept");
  });

  it("saves nothing when the editor is not open", async () => {
    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012, topPlayed);

    expect(createSmartPlaylist).not.toHaveBeenCalled();
    expect(setPlaylistFilter).not.toHaveBeenCalled();
  });

  it("refreshes the view only when the drop landed in the playlist on screen", async () => {
    vi.mocked(addToPlaylist).mockResolvedValue(1);
    await useLibraryStore.getState().showPlaylist(3);
    const before = useLibraryStore.getState().queryToken;

    await usePlaylistsStore.getState().addTracks(9, [10]);
    expect(useLibraryStore.getState().queryToken).toBe(before);

    await usePlaylistsStore.getState().addTracks(3, [11]);
    expect(useLibraryStore.getState().queryToken).toBeGreaterThan(before);
  });
});

describe("createFrom", () => {
  it("creates a playlist holding the songs that were dropped", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(9, "New Playlist"));
    vi.mocked(addToPlaylist).mockResolvedValue(2);
    vi.mocked(listPlaylists).mockResolvedValue([playlist(9, "New Playlist", 2)]);

    await usePlaylistsStore.getState().createFrom([10, 11]);

    expect(createPlaylist).toHaveBeenCalledWith("New Playlist");
    expect(addToPlaylist).toHaveBeenCalledWith(9, [10, 11]);
  });

  it("starts a rename once the songs are in", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(9, "New Playlist"));
    vi.mocked(addToPlaylist).mockResolvedValue(2);

    await usePlaylistsStore.getState().createFrom([10, 11]);

    // Naming it is the only thing left to do, and abandoning the rename still
    // leaves a playlist with the songs in it.
    expect(usePlaylistsStore.getState().renaming).toBe(9);
    expect(useStatusStore.getState().notice).toBe("Added 2 songs to a new playlist.");
  });

  it("does nothing when the drag carried no songs", async () => {
    await usePlaylistsStore.getState().createFrom([]);

    expect(createPlaylist).not.toHaveBeenCalled();
  });

  it("reports a failure rather than leaving a half-made playlist silently", async () => {
    vi.mocked(createPlaylist).mockRejectedValue(new Error("disk full"));

    await usePlaylistsStore.getState().createFrom([10]);

    expect(useStatusStore.getState().message).toContain("disk full");
  });
});

describe("playPlaylist", () => {
  beforeEach(() => {
    vi.spyOn(usePlayerStore.getState(), "play").mockResolvedValue(undefined);
  });

  it("opens the playlist and plays it from the top", async () => {
    vi.mocked(allTrackIds).mockResolvedValue([7, 8, 9]);

    await usePlaylistsStore.getState().playPlaylist(3);

    // In its own order, not the view's: the sort on screen belongs to
    // whatever was open a moment ago.
    expect(allTrackIds).toHaveBeenCalledWith(
      expect.objectContaining({ playlistId: 3, sortBy: "position" }),
    );
    expect(useLibraryStore.getState().playlistId).toBe(3);
    expect(usePlayerStore.getState().play).toHaveBeenCalledWith([7, 8, 9], 0);
  });

  it("says so rather than playing nothing when the playlist is empty", async () => {
    vi.mocked(allTrackIds).mockResolvedValue([]);
    usePlaylistsStore.setState({ playlists: [playlist(3, "Evening")] });

    await usePlaylistsStore.getState().playPlaylist(3);

    expect(usePlayerStore.getState().play).not.toHaveBeenCalled();
    expect(useStatusStore.getState().notice).toBe("Evening is empty.");
  });
});

describe("the sidebar arrangement", () => {
  it("opens every section on a first run", async () => {
    vi.mocked(loadSidebarSections).mockResolvedValue(null);

    await usePlaylistsStore.getState().loadSections();

    expect(usePlaylistsStore.getState().collapsed).toEqual({});
  });

  it("reads back what was folded", async () => {
    vi.mocked(loadSidebarSections).mockResolvedValue('{"smart":true}');

    await usePlaylistsStore.getState().loadSections();

    expect(usePlaylistsStore.getState().collapsed).toEqual({ smart: true });
  });

  it("opens every section rather than failing when the setting cannot be read", async () => {
    // A sidebar that cannot read its own arrangement is not an error the user
    // needs told about - nothing they did has failed - and this runs on mount,
    // so throwing here would take the sidebar down with it.
    vi.mocked(loadSidebarSections).mockRejectedValue(new Error("no database"));

    await usePlaylistsStore.getState().loadSections();

    expect(usePlaylistsStore.getState().collapsed).toEqual({});
    expect(useStatusStore.getState().message).toBeNull();
  });

  it("folds on screen before it has been stored", async () => {
    // Folding a section is a pointer gesture and must not wait for SQLite to
    // answer before it looks like it happened.
    let store: (() => void) | undefined;
    vi.mocked(saveSidebarSections).mockReturnValue(
      new Promise<void>((resolve) => {
        store = resolve;
      }),
    );

    const toggling = usePlaylistsStore.getState().toggleSection("playlists");

    expect(usePlaylistsStore.getState().collapsed).toEqual({ playlists: true });
    store?.();
    await toggling;
    expect(saveSidebarSections).toHaveBeenCalledWith('{"playlists":true}');
  });

  it("stays folded when storing the arrangement fails", async () => {
    vi.mocked(saveSidebarSections).mockRejectedValue(new Error("read-only"));

    await usePlaylistsStore.getState().toggleSection("smart");

    // The sidebar is folded either way; only the memory of it is lost.
    expect(usePlaylistsStore.getState().collapsed).toEqual({ smart: true });
    expect(useStatusStore.getState().message).toBeNull();
  });
});

describe("recounting after the library changes", () => {
  it("reloads once for a burst, not once per event", async () => {
    // A scan emits `library://changed` far more often than anyone can read a
    // number, and every emission would otherwise be one `list_playlists` -
    // which is a count per playlist, and for a smart one its whole compiled
    // filter re-run.
    vi.useFakeTimers();
    let fire: (() => void) | undefined;
    vi.mocked(onLibraryChanged).mockImplementation(async (handler: () => void) => {
      fire = handler;
      return () => {};
    });

    const stop = await usePlaylistsStore.getState().watch();
    vi.mocked(listPlaylists).mockClear();

    for (let i = 0; i < 20; i += 1) {
      fire?.();
    }
    expect(listPlaylists).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RECOUNT_DEBOUNCE_MS);
    expect(listPlaylists).toHaveBeenCalledTimes(1);

    stop();
    vi.useRealTimers();
  });

  it("drops a pending recount when it stops watching", async () => {
    // Otherwise the reload lands after the sidebar has gone, which in a test
    // is a stray promise and in the app is a write to an unmounted store.
    vi.useFakeTimers();
    let fire: (() => void) | undefined;
    vi.mocked(onLibraryChanged).mockImplementation(async (handler: () => void) => {
      fire = handler;
      return () => {};
    });

    const stop = await usePlaylistsStore.getState().watch();
    vi.mocked(listPlaylists).mockClear();

    fire?.();
    stop();
    await vi.advanceTimersByTimeAsync(RECOUNT_DEBOUNCE_MS * 4);

    expect(listPlaylists).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
