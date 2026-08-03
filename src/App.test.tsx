import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useEditorStore } from "./features/editor/store";
import { useLibraryStore } from "./features/library/store";
import { TRACK_IDS_MIME } from "./features/playlists/drag";
import { usePlaylistsStore } from "./features/playlists/store";
import { useUpdaterStore } from "./features/updater/store";
import {
  addToPlaylist,
  addWatchFolder,
  allTrackIds,
  canUndoTagEdit,
  createPlaylist,
  createSmartPlaylist,
  exportLibrary,
  getAppInfo,
  libraryStats,
  listPlaylists,
  loadWindowGeometry,
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
  getAppInfo: vi.fn(async () => ({ name: "player", version: "0.4.2" })),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0 })),
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
  exportLibrary: vi.fn(),
  saveWindowGeometry: vi.fn(),
  loadWindowGeometry: vi.fn(),
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
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
  loadZoom: vi.fn(async () => null),
  saveZoom: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    isMaximized: vi.fn(async () => false),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    outerSize: vi.fn(async () => ({ width: 1200, height: 800 })),
    setPosition: vi.fn(),
    setSize: vi.fn(),
    maximize: vi.fn(),
    onMoved: vi.fn(async () => () => {}),
    onResized: vi.fn(async () => () => {}),
  }),
  availableMonitors: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
// Without this the launch check reaches the real plugin, fails against a Tauri
// that is not there, and lands the store in `failed` at an unpredictable
// moment - which would overwrite whatever state a test had just set.
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));

const statsMock = vi.mocked(libraryStats);
/** A `LibraryStats` with the count set; the footer's other totals are not what
    these tests are about. */
function stats(tracks: number) {
  return { tracks, durationMs: tracks * 200_000, bytes: tracks * 5_000_000 };
}

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
    renaming: null,
  });
  useEditorStore.setState({ ...initialEditor, tracks: null, notice: null, error: null });
  useUpdaterStore.setState({ status: "idle", version: null, error: null, update: null });
  vi.mocked(listPlaylists).mockResolvedValue([]);
  // Restated rather than left to the factory: `clearAllMocks` clears calls but
  // keeps implementations, so the one test that makes this reject was leaking
  // a versionless footer into every test declared after it.
  vi.mocked(getAppInfo).mockResolvedValue({ name: "player", version: "0.4.2" });
  vi.mocked(canUndoTagEdit).mockResolvedValue(false);
  statsMock.mockResolvedValue(stats(0));
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
  vi.mocked(loadWindowGeometry).mockResolvedValue(null);
  const { open, save } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
  vi.mocked(save).mockResolvedValue(null);
});

describe("App", () => {
  it("invites the user to add a folder when the library is empty", async () => {
    render(<App />);

    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Folder…" })).toBeInTheDocument();
  });

  it("shows the chrome: sidebar, tabs, search and status bar", async () => {
    render(<App />);

    await waitFor(() => expect(statsMock).toHaveBeenCalled());
    expect(screen.getByRole("navigation", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Songs" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Library" })).toBeInTheDocument();
    expect(screen.getAllByText("No songs").length).toBeGreaterThan(0);
  });

  it("puts real totals in the footer, not a zero", async () => {
    statsMock.mockResolvedValue({ tracks: 5, durationMs: 3_000_000, bytes: 214_000_000 });

    render(<App />);

    // The footer promised "N songs, H hours" from phase 3 and always said zero
    // for the time, because no query produced the sum.
    expect(await screen.findByText("5 songs, 50 minutes, 214 MB")).toBeInTheDocument();
  });

  it("leaves the size off the toolbar display, which has less room", async () => {
    statsMock.mockResolvedValue({ tracks: 5, durationMs: 3_000_000, bytes: 214_000_000 });

    render(<App />);
    await screen.findByText("5 songs, 50 minutes, 214 MB");

    expect(screen.getByText("5 songs, 50 minutes")).toBeInTheDocument();
  });

  it("totals what is on screen rather than the whole library", async () => {
    statsMock.mockResolvedValue({ tracks: 200, durationMs: 36_000_000, bytes: 1_000_000_000 });
    render(<App />);
    await screen.findAllByText(/200 songs/);
    const user = userEvent.setup();

    statsMock.mockResolvedValue({ tracks: 2, durationMs: 600_000, bytes: 9_000_000 });
    await user.type(screen.getByRole("searchbox", { name: "Search Library" }), "maki");

    // A search showing two songs while the footer claims the library's total
    // would be worse than showing nothing.
    expect(await screen.findByText("2 songs, 10 minutes, 9 MB")).toBeInTheDocument();
  });

  it("shows the app version in the footer", async () => {
    render(<App />);

    // Read from the backend rather than baked in at build time: the Rust
    // crate's version is the one the installer and every export report.
    expect(await screen.findByText("v0.4.2")).toBeInTheDocument();
  });

  it("says nothing about the version when it cannot be read", async () => {
    vi.mocked(getAppInfo).mockRejectedValue("no backend");
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    // A missing version is not worth an error state; the line just omits it.
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });

  it("swaps the empty state for the table once the library has rows", async () => {
    statsMock.mockResolvedValue(stats(3));
    queryTracksMock.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText(/No songs yet/)).not.toBeInTheDocument());
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
  });

  it("searches through the backend once the user stops typing", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());
    statsMock.mockClear();
    const user = userEvent.setup();

    const box = screen.getByRole("searchbox", { name: "Search Library" });
    await user.type(box, "maki");

    // The box tracks every keystroke; the query does not.
    expect(box).toHaveValue("maki");
    await waitFor(() => {
      expect(statsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "maki" }));
    });
    expect(statsMock.mock.calls.length).toBeLessThan(4);
  });

  it("searches immediately on Enter", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());
    statsMock.mockClear();
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "Search Library" }), "maki{Enter}");

    expect(statsMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ search: "maki" }));
  });

  it("clears the search with Escape and with the clear button", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());
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
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("distinguishes an empty library from a search that found nothing", async () => {
    render(<App />);
    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
    const user = userEvent.setup();

    statsMock.mockResolvedValue(stats(0));
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
    statsMock.mockRejectedValue("database is locked");

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
    statsMock.mockResolvedValue(stats(3));
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
    statsMock.mockResolvedValue(stats(0));
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
      expect(statsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ playlistId: 1, sortBy: "position" }),
      ),
    );
  });

  it("says an open playlist is empty rather than blaming the library", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening")]);
    statsMock.mockResolvedValue(stats(0));
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

  it("creates a playlist and offers to name it, without leaving the library", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(7, "New Playlist"));
    vi.mocked(listPlaylists)
      .mockResolvedValueOnce([])
      .mockResolvedValue([playlist(7, "New Playlist")]);
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New playlist" }));

    expect(createPlaylist).toHaveBeenCalledWith("New Playlist");
    // Switching to it would hide the songs you were about to drag into it,
    // and an empty view is nothing to look at.
    expect(
      await screen.findByRole("textbox", { name: "Rename playlist New Playlist" }),
    ).toBeInTheDocument();
    expect(useLibraryStore.getState().playlistId).toBeNull();
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
      expect(statsMock).toHaveBeenLastCalledWith(expect.objectContaining({ playlistId: 9 })),
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

  it("edits the tags of the selected rows through the row menu", async () => {
    vi.mocked(tracksByIds).mockResolvedValue([track(1)]);
    vi.mocked(writeTags).mockResolvedValue({ written: 1, failed: 0, errors: [] });
    await renderWithLibrary();
    const user = userEvent.setup();

    // Get Info used to be a toolbar button. It is a per-song action, so it
    // now lives where a per-song action belongs.
    expect(screen.queryByRole("button", { name: "Get Info" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Track 1") });
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
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

  it("exports the library, the open playlist, or the selection", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(save).mockResolvedValue("D:/out.json");
    vi.mocked(exportLibrary).mockResolvedValue(3);
    vi.mocked(listPlaylists).mockResolvedValue([playlist(4, "Evening", 3)]);
    await renderWithLibrary();
    const user = userEvent.setup();

    // Nothing narrowing it: the whole library.
    await user.click(await screen.findByRole("button", { name: "Export Library…" }));
    await waitFor(() =>
      expect(exportLibrary).toHaveBeenCalledWith("D:/out.json", { kind: "library" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Exported 3 songs.");

    // Open a playlist and it becomes the target.
    await user.click(screen.getByRole("button", { name: "Evening" }));
    await user.click(await screen.findByRole("button", { name: "Export Evening…" }));
    await waitFor(() =>
      expect(exportLibrary).toHaveBeenLastCalledWith("D:/out.json", {
        kind: "playlist",
        playlistId: 4,
      }),
    );

    // A selection is narrower still, so it wins.
    await user.click(await screen.findByText("Track 1"));
    await user.click(await screen.findByRole("button", { name: "Export 1 Song…" }));
    await waitFor(() =>
      expect(exportLibrary).toHaveBeenLastCalledWith("D:/out.json", {
        kind: "selection",
        trackIds: [11],
      }),
    );
  });

  it("writes nothing when the save dialog is dismissed", async () => {
    await renderWithLibrary();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export Library…" }));

    expect(exportLibrary).not.toHaveBeenCalled();
  });

  it("reports an export that failed rather than claiming success", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(save).mockResolvedValue("D:/out.json");
    vi.mocked(exportLibrary).mockRejectedValue("access denied");
    await renderWithLibrary();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export Library…" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Export failed: access denied");
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

describe("the zoom stepper", () => {
  it("steps out and in from the status bar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(await screen.findByText("90%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(await screen.findByText("100%")).toBeInTheDocument();
  });

  it("stops at the ends rather than letting the value run past them", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    const out = screen.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 3; i++) {
      await user.click(out);
    }

    // 1.0 down to the 0.8 floor is two steps; a third must not move it, and
    // the button says so rather than silently doing nothing.
    expect(await screen.findByText("80%")).toBeInTheDocument();
    expect(out).toBeDisabled();
  });
});

describe("the update notice", () => {
  it("shows the version rather than an update while there is none", async () => {
    render(<App />);

    // The state the app is in essentially always. Nothing about updates
    // belongs on screen until there is one.
    expect(await screen.findByText("v0.4.2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart to install/ })).not.toBeInTheDocument();
  });

  it("says nothing while checking or downloading", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    useUpdaterStore.setState({ status: "downloading", version: "0.5.0" });

    // A download the user did not ask for and cannot act on is not news; the
    // footer keeps showing the version it is running.
    expect(await screen.findByText("v0.4.2")).toBeInTheDocument();
    expect(screen.queryByText(/0\.5\.0/)).not.toBeInTheDocument();
  });

  it("offers the restart once a download is ready, and installs on the click", async () => {
    const user = userEvent.setup();
    const install = vi.fn(async () => {});
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    useUpdaterStore.setState({
      status: "ready",
      version: "0.5.0",
      update: { version: "0.5.0", download: vi.fn(async () => {}), install },
    });

    await user.click(await screen.findByRole("button", { name: /0\.5\.0 ready/ }));

    // The click is the consent: installing exits the process and hands off to
    // the installer, which is not something to do to a running player unasked.
    expect(install).toHaveBeenCalled();
  });
});
