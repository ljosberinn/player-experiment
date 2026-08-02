import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useEditorStore } from "./features/editor/store";
import { useLibraryStore } from "./features/library/store";
import { TRACK_IDS_MIME } from "./features/playlists/drag";
import { usePlaylistsStore } from "./features/playlists/store";
import {
  addToPlaylist,
  addWatchFolder,
  allTrackIds,
  canUndoTagEdit,
  countTracks,
  createPlaylist,
  createSmartPlaylist,
  listPlaylists,
  moveInPlaylist,
  type Playlist,
  playerPlay,
  playerSnapshot,
  playerToggle,
  queryTracks,
  removeFromPlaylist,
  scanLibrary,
  tracksByIds,
  undoTagEdit,
  writeTags,
} from "./ipc";

vi.mock("./ipc", () => ({
  countTracks: vi.fn(),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(),
  addWatchFolder: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(async () => () => {}),
  coverUrl: vi.fn((hash: string) => `cover-url:${hash}`),
  onPlayerState: vi.fn(async () => () => {}),
  onPlayerPosition: vi.fn(async () => () => {}),
  onPlayerError: vi.fn(async () => () => {}),
  playerSnapshot: vi.fn(),
  playerPlay: vi.fn(),
  playerToggle: vi.fn(),
  playerStop: vi.fn(),
  playerNext: vi.fn(),
  playerPrevious: vi.fn(),
  playerSeek: vi.fn(),
  playerSetVolume: vi.fn(),
  tracksByIds: vi.fn(),
  writeTags: vi.fn(),
  undoTagEdit: vi.fn(),
  canUndoTagEdit: vi.fn(),
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
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const countTracksMock = vi.mocked(countTracks);
const queryTracksMock = vi.mocked(queryTracks);
const addWatchFolderMock = vi.mocked(addWatchFolder);
const scanLibraryMock = vi.mocked(scanLibrary);

const initial = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();
const initialEditor = useEditorStore.getState();

function playlist(id: number, name: string, trackCount = 0): Playlist {
  return { id, name, kind: "static", trackCount, createdAt: 0 };
}

beforeEach(async () => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initial, total: 0, pages: new Map(), error: null });
  usePlaylistsStore.setState({
    ...initialPlaylists,
    playlists: [],
    notice: null,
    error: null,
    editing: null,
  });
  useEditorStore.setState({ ...initialEditor, tracks: null, notice: null, error: null });
  vi.mocked(listPlaylists).mockResolvedValue([]);
  vi.mocked(canUndoTagEdit).mockResolvedValue(false);
  countTracksMock.mockResolvedValue(0);
  queryTracksMock.mockResolvedValue([]);
  scanLibraryMock.mockResolvedValue({ added: 0, updated: 0, removed: 0, unchanged: 0 });
  vi.mocked(playerSnapshot).mockResolvedValue({
    status: "stopped",
    track: null,
    queueIndex: null,
    queueLen: 0,
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
  });
  vi.mocked(playerPlay).mockResolvedValue(undefined);
  vi.mocked(playerToggle).mockResolvedValue(undefined);
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
});

describe("App", () => {
  it("invites the user to add a folder when the library is empty", async () => {
    render(<App />);

    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Folder…" })).toBeInTheDocument();
  });

  it("shows the chrome: sidebar, tabs, search and status bar", async () => {
    render(<App />);

    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());
    expect(screen.getByRole("navigation", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Songs" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Library" })).toBeInTheDocument();
    expect(screen.getAllByText("No songs").length).toBeGreaterThan(0);
  });

  it("swaps the empty state for the table once the library has rows", async () => {
    countTracksMock.mockResolvedValue(3);
    queryTracksMock.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText(/No songs yet/)).not.toBeInTheDocument());
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
  });

  it("searches through the backend once the user stops typing", async () => {
    render(<App />);
    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());
    countTracksMock.mockClear();
    const user = userEvent.setup();

    const box = screen.getByRole("searchbox", { name: "Search Library" });
    await user.type(box, "maki");

    // The box tracks every keystroke; the query does not.
    expect(box).toHaveValue("maki");
    await waitFor(() => {
      expect(countTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "maki" }));
    });
    expect(countTracksMock.mock.calls.length).toBeLessThan(4);
  });

  it("searches immediately on Enter", async () => {
    render(<App />);
    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());
    countTracksMock.mockClear();
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "Search Library" }), "maki{Enter}");

    expect(countTracksMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ search: "maki" }),
    );
  });

  it("clears the search with Escape and with the clear button", async () => {
    render(<App />);
    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());
    const user = userEvent.setup();
    const box = screen.getByRole("searchbox", { name: "Search Library" });

    await user.type(box, "maki{Enter}");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box).toHaveValue("");

    await user.type(box, "maki{Enter}");
    await user.type(box, "{Escape}");
    expect(box).toHaveValue("");
  });

  it("offers no clear button until there is something to clear", async () => {
    render(<App />);
    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("distinguishes an empty library from a search that found nothing", async () => {
    render(<App />);
    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
    const user = userEvent.setup();

    countTracksMock.mockResolvedValue(0);
    await user.type(screen.getByRole("searchbox", { name: "Search Library" }), "nothing{Enter}");

    expect(await screen.findByText(/No results for/)).toBeInTheDocument();
    expect(screen.queryByText(/No songs yet/)).not.toBeInTheDocument();

    // And the empty state offers the way back out.
    await user.click(screen.getByRole("button", { name: "Show all songs" }));
    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
  });

  it("adds the chosen folder and scans it", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("D:/Music");
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add Folder…" }));

    await waitFor(() => expect(addWatchFolderMock).toHaveBeenCalledWith("D:/Music"));
    expect(scanLibraryMock).toHaveBeenCalled();
  });

  it("does nothing when the folder picker is dismissed", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add Folder…" }));

    await waitFor(() => expect(addWatchFolderMock).not.toHaveBeenCalled());
    expect(scanLibraryMock).not.toHaveBeenCalled();
  });

  it("reports a scan failure instead of failing silently", async () => {
    scanLibraryMock.mockRejectedValue("permission denied");
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Rescan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });

  it("surfaces a query failure from the store", async () => {
    countTracksMock.mockRejectedValue("database is locked");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
  });
});

describe("App playback", () => {
  // jsdom gives every element zero height, so the virtualizer would render no
  // rows. Pin a real viewport size for the scroll container.
  function stubLayout(height = 400) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height,
      width: 800,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: height,
    });
  }

  /** A library of three tracks the table can render and play. */
  async function renderWithLibrary({ waitForRows = true } = {}) {
    stubLayout();
    countTracksMock.mockResolvedValue(3);
    queryTracksMock.mockResolvedValue([0, 1, 2].map(track));
    vi.mocked(allTrackIds).mockResolvedValue([10, 11, 12]);

    render(<App />);
    if (waitForRows) {
      await screen.findByText("Track 1");
    }
  }

  function track(index: number) {
    return {
      id: 10 + index,
      path: `/m/${index}.mp3`,
      duration_ms: 200_000,
      title: `Track ${index}`,
      artist: "Artist",
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

  it("plays the whole view from the row that was activated", async () => {
    await renderWithLibrary();
    const user = userEvent.setup();

    await user.dblClick(screen.getByText("Track 1").closest(".song-row") as HTMLElement);

    // The queue is the view's full id list, not just the loaded page, and the
    // index is the row's position in it.
    await waitFor(() => expect(playerPlay).toHaveBeenCalledWith([10, 11, 12], 1));
  });

  it("does not start playback when the view is empty", async () => {
    countTracksMock.mockResolvedValue(0);
    vi.mocked(allTrackIds).mockResolvedValue([]);
    render(<App />);
    await screen.findByText(/No songs yet/);

    expect(playerPlay).not.toHaveBeenCalled();
  });

  it("drives the transport from the toolbar", async () => {
    await renderWithLibrary();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(playerToggle).toHaveBeenCalledOnce();
  });

  it("scopes the search box to the playlist being shown", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 2)]);
    await renderWithLibrary({ waitForRows: false });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Evening" }));

    expect(await screen.findByRole("searchbox", { name: "Search Evening" })).toBeInTheDocument();
    await waitFor(() =>
      expect(countTracksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ playlistId: 1, sortBy: "position" }),
      ),
    );
  });

  it("says an open playlist is empty rather than blaming the library", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening")]);
    countTracksMock.mockResolvedValue(0);
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Evening" }));

    expect(await screen.findByText(/is empty/)).toBeInTheDocument();
    expect(screen.queryByText(/No songs yet/)).not.toBeInTheDocument();
  });

  it("removes the selected rows from the open playlist on Delete", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 3)]);
    vi.mocked(removeFromPlaylist).mockResolvedValue(1);
    await renderWithLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Evening" }));
    const row = (await screen.findByText("Track 1")).closest(".song-row") as HTMLElement;
    await user.click(row);
    await user.type(row, "{Delete}");

    await waitFor(() => expect(removeFromPlaylist).toHaveBeenCalledWith(1, [11]));
  });

  it("leaves the library alone when Delete is pressed outside a playlist", async () => {
    await renderWithLibrary();
    const user = userEvent.setup();

    const row = screen.getByText("Track 1").closest(".song-row") as HTMLElement;
    await user.click(row);
    await user.type(row, "{Delete}");

    expect(removeFromPlaylist).not.toHaveBeenCalled();
  });

  it("only accepts a reorder drop while the playlist is in its own order", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 3)]);
    vi.mocked(moveInPlaylist).mockResolvedValue(undefined);
    await renderWithLibrary();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Evening" }));
    await screen.findByText("Track 1");

    const drop = () =>
      fireEvent.drop(screen.getByText("Track 2").closest(".song-row") as HTMLElement, {
        dataTransfer: {
          types: [TRACK_IDS_MIME],
          getData: () => JSON.stringify([10]),
        },
      });

    drop();
    await waitFor(() => expect(moveInPlaylist).toHaveBeenCalledWith(1, [10], 2));

    // Sorting by a column makes the order derived, so a drop has nowhere to go.
    vi.mocked(moveInPlaylist).mockClear();
    await user.click(screen.getByRole("button", { name: /Name/ }));
    await screen.findByText("Track 1");
    drop();
    expect(moveInPlaylist).not.toHaveBeenCalled();
  });

  it("reports how much of a drop landed when a playlist already had some of it", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 1)]);
    vi.mocked(addToPlaylist).mockResolvedValue(2);
    await renderWithLibrary();

    await usePlaylistsStore.getState().addTracks(1, [10, 11, 12]);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Added 2 songs to Evening; 1 already there.",
    );
  });

  it("creates a playlist and opens it", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(7, "New Playlist"));
    vi.mocked(listPlaylists)
      .mockResolvedValueOnce([])
      .mockResolvedValue([playlist(7, "New Playlist")]);
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New playlist" }));

    expect(createPlaylist).toHaveBeenCalledWith("New Playlist");
    await waitFor(() =>
      expect(countTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ playlistId: 7 })),
    );
  });

  it("builds a smart playlist through the editor and opens it", async () => {
    vi.mocked(createSmartPlaylist).mockResolvedValue({
      id: 9,
      name: "Grizzly",
      kind: "smart",
      trackCount: 2,
      createdAt: 0,
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New smart playlist" }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Grizzly");
    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByRole("textbox", { name: "Value for condition 1" }), "Grizzly Bear");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createSmartPlaylist).toHaveBeenCalledWith("Grizzly", {
        combinator: "all",
        children: [
          {
            type: "rule",
            field: "artist",
            op: "is",
            value: { kind: "text", text: "Grizzly Bear" },
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(countTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ playlistId: 9 })),
    );
  });

  it("offers no reordering or removal inside a smart playlist", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([
      { id: 9, name: "Grizzly", kind: "smart", trackCount: 3, createdAt: 0 },
    ]);
    await renderWithLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Grizzly" }));
    const row = (await screen.findByText("Track 1")).closest(".song-row") as HTMLElement;
    await user.click(row);
    await user.type(row, "{Delete}");

    // Its membership is its filter - editing it means editing that.
    expect(removeFromPlaylist).not.toHaveBeenCalled();
    fireEvent.drop(row, {
      dataTransfer: { types: [TRACK_IDS_MIME], getData: () => JSON.stringify([10]) },
    });
    expect(moveInPlaylist).not.toHaveBeenCalled();
  });

  it("edits the tags of the selected rows through Get Info", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1)]);
    vi.mocked(writeTags).mockResolvedValue({ written: 1, failed: 0, errors: [] });
    await renderWithLibrary();
    const user = userEvent.setup();

    // Nothing selected yet, so there is nothing to get info about.
    expect(screen.getByRole("button", { name: "Get Info" })).toBeDisabled();

    await user.click(screen.getByText("Track 1"));
    await user.click(screen.getByRole("button", { name: "Get Info" }));
    const genre = await screen.findByRole("textbox", { name: "Genre" });
    await user.type(genre, "Dream Pop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writeTags).toHaveBeenCalledWith([11], expect.objectContaining({ genre: "Dream Pop" })),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Updated 1 song.");
  });

  it("offers Undo Tag Edit only once there is one to undo", async () => {
    vi.mocked(canUndoTagEdit).mockResolvedValue(true);
    vi.mocked(undoTagEdit).mockResolvedValue({ written: 2, failed: 0, errors: [] });
    render(<App />);
    const user = userEvent.setup();

    const undo = await screen.findByRole("button", { name: "Undo Tag Edit" });
    await waitFor(() => expect(undo).toBeEnabled());
    await user.click(undo);

    expect(undoTagEdit).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Reverted 2 songs.");
  });

  it("shows the current track in the status display once the backend reports one", async () => {
    vi.mocked(playerSnapshot).mockResolvedValue({
      status: "playing",
      track: track(1),
      queueIndex: 1,
      queueLen: 3,
      positionMs: 30_000,
      durationMs: 200_000,
      volume: 0.8,
    });
    // The table renders the same title, so wait on the status display itself.
    await renderWithLibrary({ waitForRows: false });

    const display = await screen.findByTestId("status-display");
    await waitFor(() => expect(display).toHaveTextContent("Track 1"));
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveValue("30000");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});
