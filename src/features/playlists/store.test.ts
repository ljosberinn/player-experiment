import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  moveInPlaylist,
  type Playlist,
  removeFromPlaylist,
  renamePlaylist,
} from "../../ipc";
import { useLibraryStore } from "../library/store";
import { usePlaylistsStore } from "./store";

vi.mock("../../ipc", () => ({
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
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

const initialLibrary = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initialLibrary, playlistId: null, total: 0, pages: new Map() });
  usePlaylistsStore.setState({ ...initialPlaylists, playlists: [], notice: null, error: null });
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
