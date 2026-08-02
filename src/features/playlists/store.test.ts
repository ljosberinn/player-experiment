import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  createPlaylist,
  createSmartPlaylist,
  deletePlaylist,
  type FilterGroup,
  listPlaylists,
  moveInPlaylist,
  type Playlist,
  playlistFilter,
  removeFromPlaylist,
  renamePlaylist,
  setPlaylistFilter,
} from "../../ipc";
import { useLibraryStore } from "../library/store";
import { emptyFilter } from "../smart/filterTree";
import { usePlaylistsStore } from "./store";

vi.mock("../../ipc", () => ({
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  createSmartPlaylist: vi.fn(),
  setPlaylistFilter: vi.fn(),
  playlistFilter: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  moveInPlaylist: vi.fn(),
  countTracks: vi.fn(async () => 0),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
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

const initialLibrary = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initialLibrary, playlistId: null, total: 0, pages: new Map() });
  usePlaylistsStore.setState({
    ...initialPlaylists,
    playlists: [],
    notice: null,
    error: null,
    editing: null,
  });
  vi.mocked(listPlaylists).mockResolvedValue([]);
});

describe("playlists store", () => {
  it("loads the sidebar's list", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 4)]);

    await usePlaylistsStore.getState().load();

    expect(usePlaylistsStore.getState().playlists).toEqual([playlist(1, "Evening", 4)]);
  });

  it("opens a playlist as soon as it is created", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(7, "New Playlist"));

    await usePlaylistsStore.getState().create("New Playlist");

    expect(useLibraryStore.getState().playlistId).toBe(7);
    // A playlist opens in its own order; the library opens by artist.
    expect(useLibraryStore.getState().sortBy).toBe("position");
  });

  it("leaves a deleted playlist's view before the sidebar drops it", async () => {
    vi.mocked(deletePlaylist).mockResolvedValue(undefined);
    await useLibraryStore.getState().showPlaylist(3);

    await usePlaylistsStore.getState().remove(3);

    // Otherwise the next query runs against an id that no longer exists.
    expect(useLibraryStore.getState().playlistId).toBeNull();
    expect(useLibraryStore.getState().sortBy).toBe("artist");
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

    expect(usePlaylistsStore.getState().notice).toBe("Added 2 songs to Evening; 1 already there.");
  });

  it("does not mention skipped tracks when nothing was skipped", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(addToPlaylist).mockResolvedValue(1);

    await usePlaylistsStore.getState().addTracks(1, [10]);

    expect(usePlaylistsStore.getState().notice).toBe("Added 1 song to Evening.");
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

    expect(usePlaylistsStore.getState().error).toContain("A playlist needs a name.");
  });

  it("opens the editor on a blank filter for a new smart playlist", async () => {
    await usePlaylistsStore.getState().editSmart(null);

    expect(usePlaylistsStore.getState().editing).toEqual({
      playlistId: null,
      name: "New Smart Playlist",
      filter: emptyFilter,
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
    });
  });

  it("treats a playlist with no stored filter as an empty one", async () => {
    vi.mocked(playlistFilter).mockResolvedValue(null);

    await usePlaylistsStore.getState().editSmart(4);

    expect(usePlaylistsStore.getState().editing?.filter).toEqual(emptyFilter);
  });

  it("creates and opens a new smart playlist on save", async () => {
    vi.mocked(createSmartPlaylist).mockResolvedValue(smartPlaylist(7, "Recent"));
    await usePlaylistsStore.getState().editSmart(null);

    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012);

    expect(createSmartPlaylist).toHaveBeenCalledWith("Recent", yearIs2012);
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

    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012);

    // Membership is the filter, so there is nothing to recompute - only to
    // ask again.
    expect(setPlaylistFilter).toHaveBeenCalledWith(4, yearIs2012);
    expect(useLibraryStore.getState().queryToken).toBeGreaterThan(before);
  });

  it("renames only when the name in the editor actually changed", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([smartPlaylist(4, "Recent")]);
    await usePlaylistsStore.getState().load();
    vi.mocked(setPlaylistFilter).mockResolvedValue(undefined);
    vi.mocked(playlistFilter).mockResolvedValue(emptyFilter);

    await usePlaylistsStore.getState().editSmart(4);
    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012);
    expect(renamePlaylist).not.toHaveBeenCalled();

    await usePlaylistsStore.getState().editSmart(4);
    await usePlaylistsStore.getState().saveSmart("Older", yearIs2012);
    expect(renamePlaylist).toHaveBeenCalledWith(4, "Older");
  });

  it("keeps the editor open when the backend refuses the filter", async () => {
    vi.mocked(createSmartPlaylist).mockRejectedValue("Year does not accept Contains.");
    await usePlaylistsStore.getState().editSmart(null);

    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012);

    // Closing it would throw away everything the user built.
    expect(usePlaylistsStore.getState().editing).not.toBeNull();
    expect(usePlaylistsStore.getState().error).toContain("does not accept");
  });

  it("saves nothing when the editor is not open", async () => {
    await usePlaylistsStore.getState().saveSmart("Recent", yearIs2012);

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
