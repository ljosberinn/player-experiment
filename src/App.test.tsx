import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useEditorStore } from "./features/editor/store";
import { useLibraryStore } from "./features/library/store";
import { usePlayerStore } from "./features/player/store";
import { TRACK_IDS_MIME } from "./features/playlists/drag";
import { usePlaylistsStore } from "./features/playlists/store";
import { useStatusStore } from "./features/shell/statusStore";
import { useUpdaterStore } from "./features/updater/store";
import {
  addToPlaylist,
  addWatchFolder,
  allTrackIds,
  browseGroups,
  canUndoTagEdit,
  createPlaylist,
  createSmartPlaylist,
  exportLibrary,
  getAppInfo,
  libraryStats,
  listPlaylists,
  loadWindowGeometry,
  moveInPlaylist,
  onLibraryChanged,
  type Playlist,
  playerPlay,
  playerSnapshot,
  playerToggle,
  queryTracks,
  removeFromPlaylist,
  removeMissingTracks,
  scanLibrary,
  tracksByIds,
  undoTagEdit,
  writeTags,
} from "./ipc";

vi.mock("./ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  countTracks: vi.fn(),
  // Answered rather than merely stubbed: the crash notice asks on mount, and
  // an unresolved promise there leaves an act() warning in every App test.
  lastCrash: vi.fn(async () => null),
  acknowledgeCrash: vi.fn(),
  revealCrashLog: vi.fn(),
  getAppInfo: vi.fn(async () => ({ name: "apex", version: "0.4.2" })),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(),
  addWatchFolder: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(async () => () => {}),
  onTagWriteProgress: vi.fn(async () => () => {}),
  onExportProgress: vi.fn(async () => () => {}),
  onLibraryChanged: vi.fn(async () => () => {}),
  coverUrl: vi.fn((hash: string) => `cover-url:${hash}`),
  stagedCoverUrl: vi.fn((version: number) => `staged-cover-url:${version}`),
  stageDroppedCover: vi.fn(async () => "C:/cache/chosen-cover.png"),
  stagePickedCover: vi.fn(async () => "C:/cache/chosen-cover.png"),
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
  suggestTagValues: vi.fn(async () => []),
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  createSmartPlaylist: vi.fn(),
  setPlaylistFilter: vi.fn(),
  playlistFilter: vi.fn(),
  playlistOrder: vi.fn(async () => ({ sort: null, limit: null })),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  removeMissingTracks: vi.fn(async () => 0),
  moveInPlaylist: vi.fn(),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
  loadZoom: vi.fn(async () => null),
  saveZoom: vi.fn(async () => undefined),
  lastfmStatus: vi.fn(async () => ({ configured: false, username: null, queued: 0 })),
  lastfmBeginConnect: vi.fn(),
  lastfmCompleteConnect: vi.fn(),
  lastfmDisconnect: vi.fn(async () => undefined),
  onLastfmDisconnected: vi.fn(async () => () => {}),
  onLastfmQueued: vi.fn(async () => () => {}),
}));
// Hoisted so a test can assert on it: the factory below builds a fresh window
// object per call, and a `vi.fn()` created in there is unreachable from here.
const { setTitle } = vi.hoisted(() => ({ setTitle: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    setTitle,
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
  return { tracks, durationMs: tracks * 200_000, bytes: tracks * 5_000_000, missing: 0 };
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
  useLibraryStore.setState({ ...initial, total: 0, pages: new Map() });
  useStatusStore.setState({ message: null, notice: null });
  usePlaylistsStore.setState({
    ...initialPlaylists,
    playlists: [],
    editing: null,
    renaming: null,
  });
  useEditorStore.setState({ ...initialEditor, tracks: null });
  useUpdaterStore.setState({ status: "idle", version: null, error: null, update: null });
  vi.mocked(listPlaylists).mockResolvedValue([]);
  // Restated rather than left to the factory: `clearAllMocks` clears calls but
  // keeps implementations, so the one test that makes this reject was leaking
  // a versionless footer into every test declared after it.
  vi.mocked(getAppInfo).mockResolvedValue({ name: "apex", version: "0.4.2" });
  vi.mocked(canUndoTagEdit).mockResolvedValue(false);
  statsMock.mockResolvedValue(stats(0));
  queryTracksMock.mockResolvedValue([]);
  scanLibraryMock.mockResolvedValue({
    added: 0,
    updated: 0,
    missing: 0,
    returned: 0,
    unchanged: 0,
  });
  vi.mocked(playerSnapshot).mockResolvedValue({
    status: "stopped",
    track: null,
    palette: null,
    queueIndex: null,
    queueLen: 0,
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    muted: false,
    repeatOne: false,
  });
  vi.mocked(playerPlay).mockResolvedValue(undefined);
  vi.mocked(playerToggle).mockResolvedValue(undefined);
  vi.mocked(loadWindowGeometry).mockResolvedValue(null);
  const { open, save } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
  vi.mocked(save).mockResolvedValue(null);
});

/**
 * Opens a top-level menu and chooses one of its entries.
 *
 * The actions these tests drive were toolbar buttons until phase 34. They are
 * menu items now, and the trigger has to be scoped to the menubar: Base UI
 * gives a menubar trigger and the items inside its popup the same role, so an
 * unscoped query for "Edit" would match both.
 */
async function chooseFromMenu(user: UserEvent, menu: string, item: string | RegExp) {
  await user.click(within(screen.getByRole("menubar")).getByRole("menuitem", { name: menu }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("App", () => {
  it("invites the user to add a folder when the library is empty", async () => {
    render(<App />);

    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
    // The empty state names File ▸ Add Folders…, so the menu has to carry it.
    expect(
      within(screen.getByRole("menubar")).getByRole("menuitem", { name: "File" }),
    ).toBeInTheDocument();
  });

  it("shows the chrome: sidebar, library views, search and status bar", async () => {
    render(<App />);

    await waitFor(() => expect(statsMock).toHaveBeenCalled());
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    expect(sidebar).toBeInTheDocument();
    // A sidebar entry since phase 35, not a tab above the table.
    expect(within(sidebar).getByRole("button", { name: "Songs" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Library" })).toBeInTheDocument();
    expect(screen.getAllByText("No songs").length).toBeGreaterThan(0);
  });

  it("puts real totals in the footer, not a zero", async () => {
    statsMock.mockResolvedValue({
      tracks: 5,
      durationMs: 3_000_000,
      bytes: 214_000_000,
      missing: 0,
    });

    render(<App />);

    // The footer promised "N songs, H hours" from phase 3 and always said zero
    // for the time, because no query produced the sum.
    expect(await screen.findByText("5 songs, 50 minutes, 214 MB")).toBeInTheDocument();
  });

  it("says what is playing where the totals used to be", async () => {
    // The transport strip used to show the library summary when nothing was
    // playing - two places saying the same thing, one of them where the song
    // title goes. Phase 35 left the totals to the footer alone.
    statsMock.mockResolvedValue({
      tracks: 5,
      durationMs: 3_000_000,
      bytes: 214_000_000,
      missing: 0,
    });

    render(<App />);
    await screen.findByText("5 songs, 50 minutes, 214 MB");

    expect(screen.queryByText("5 songs, 50 minutes")).not.toBeInTheDocument();
    // The box keeps its place on the strip; only its contents are hidden.
    expect(screen.getByText("Nothing playing")).not.toBeVisible();
  });

  it("totals what is on screen rather than the whole library", async () => {
    statsMock.mockResolvedValue({
      tracks: 200,
      durationMs: 36_000_000,
      bytes: 1_000_000_000,
      missing: 0,
    });
    render(<App />);
    await screen.findAllByText(/200 songs/);
    const user = userEvent.setup();

    statsMock.mockResolvedValue({ tracks: 2, durationMs: 600_000, bytes: 9_000_000, missing: 0 });
    await user.type(screen.getByRole("searchbox", { name: "Search Library" }), "maki");

    // A search showing two songs while the footer claims the library's total
    // would be worse than showing nothing.
    expect(await screen.findByText("2 songs, 10 minutes, 9 MB")).toBeInTheDocument();
  });

  it("names the tab properly in the drill-in breadcrumb", async () => {
    // A drill-in landing empty ejects back to the group list (see #53), so a
    // non-empty result keeps this test about the breadcrumb's wording.
    statsMock.mockResolvedValue(stats(3));
    // The id is lowercase, so interpolating it read "All genres".
    useLibraryStore.setState({
      tab: "genres",
      browse: { kind: "genres", key: "Shoegaze", secondary: null },
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "‹ All Genres" })).toBeInTheDocument();
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
    vi.mocked(open).mockResolvedValue(["D:/Music"]);
    render(<App />);
    const user = userEvent.setup();

    await chooseFromMenu(user, "File", "Add Folders…");

    await waitFor(() => expect(addWatchFolderMock).toHaveBeenCalledWith("D:/Music"));
    expect(scanLibraryMock).toHaveBeenCalled();
  });

  it("does nothing when the folder picker is dismissed", async () => {
    render(<App />);
    const user = userEvent.setup();

    await chooseFromMenu(user, "File", "Add Folders…");

    await waitFor(() => expect(addWatchFolderMock).not.toHaveBeenCalled());
    expect(scanLibraryMock).not.toHaveBeenCalled();
  });

  it("reports a scan failure instead of failing silently", async () => {
    scanLibraryMock.mockRejectedValue("permission denied");
    render(<App />);
    const user = userEvent.setup();

    await chooseFromMenu(user, "File", "Rescan");

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

  /**
   * Puts a track in the snapshot the player store connects with.
   *
   * Through the snapshot rather than `setState` after render: `connect` runs on
   * mount and writes the snapshot over whatever is there, so a track set before
   * it resolves is gone by the time anything can assert on it.
   */
  function playing(current: ReturnType<typeof track>) {
    vi.mocked(playerSnapshot).mockResolvedValue({
      status: "playing",
      track: current,
      palette: null,
      queueIndex: 0,
      queueLen: 3,
      positionMs: 0,
      durationMs: 200_000,
      volume: 0.8,
      muted: false,
      repeatOne: false,
    });
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
      missing_since: null,
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
    await user.type(screen.getByLabelText("Value for condition 1"), "Grizzly Bear");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createSmartPlaylist).toHaveBeenCalledWith(
        "Grizzly",
        {
          combinator: "all",
          children: [
            {
              type: "rule",
              field: "artist",
              op: "is",
              value: { kind: "text", text: "Grizzly Bear" },
            },
          ],
        },
        // Untouched in this flow, and it still has to arrive: a smart playlist
        // is its filter *and* its cutoff as of this phase.
        { sort: null, limit: null },
      ),
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

    // Edit used to be a toolbar button. It is a per-song action, so it
    // now lives where a per-song action belongs.
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Track 1") });
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const genre = await screen.findByLabelText("Genre");
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

    await waitFor(() => expect(useEditorStore.getState().canUndo).toBe(true));
    await chooseFromMenu(user, "Edit", "Undo Tag Edit");

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
    await chooseFromMenu(user, "Export", "Export All…");
    await waitFor(() =>
      expect(exportLibrary).toHaveBeenCalledWith("D:/out.json", { kind: "library" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Exported 3 songs.");

    // Open a playlist and it becomes the target.
    await user.click(screen.getByRole("button", { name: "Evening" }));
    await chooseFromMenu(user, "Export", "Export “Evening”…");
    await waitFor(() =>
      expect(exportLibrary).toHaveBeenLastCalledWith("D:/out.json", {
        kind: "playlist",
        playlistId: 4,
      }),
    );

    // A selection is narrower still, so it wins.
    await user.click(await screen.findByText("Track 1"));
    await chooseFromMenu(user, "Export", "Export 1 Song…");
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

    await chooseFromMenu(user, "Export", "Export All…");

    expect(exportLibrary).not.toHaveBeenCalled();
  });

  it("reports an export that failed rather than claiming success", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(save).mockResolvedValue("D:/out.json");
    vi.mocked(exportLibrary).mockRejectedValue("access denied");
    await renderWithLibrary();
    const user = userEvent.setup();

    await chooseFromMenu(user, "Export", "Export All…");

    expect(await screen.findByRole("status")).toHaveTextContent("Export failed: access denied");
  });

  it("shows the current track on the transport strip once the backend reports one", async () => {
    vi.mocked(playerSnapshot).mockResolvedValue({
      status: "playing",
      track: track(1),
      palette: null,
      queueIndex: 1,
      queueLen: 3,
      positionMs: 30_000,
      durationMs: 200_000,
      volume: 0.8,
      muted: false,
      repeatOne: false,
    });
    // The table renders the same title, so wait on the now-playing box itself.
    await renderWithLibrary({ waitForRows: false });

    const display = await screen.findByTestId("now-playing");
    await waitFor(() => expect(display).toHaveTextContent("Track 1"));
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveValue("30000");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("names what is playing in the window title, and stops when it stops", async () => {
    // The window has no decorations, so this shows only in Alt+Tab and the
    // taskbar - which is the point of it.
    playing(track(1));
    await renderWithLibrary({ waitForRows: false });

    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Apex — Track 1 — Artist"));

    act(() => {
      usePlayerStore.setState({ track: null, status: "stopped" });
    });
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Apex"));
  });

  it("opens what is playing in the library when its box is double-clicked", async () => {
    const user = userEvent.setup();
    playing(track(1));
    await renderWithLibrary({ waitForRows: false });

    const display = await screen.findByTestId("now-playing");
    await waitFor(() => expect(display).toHaveTextContent("Track 1"));

    await user.dblClick(display);

    // The fixture's tracks carry an artist and no album, so the artist is the
    // group they belong to.
    await waitFor(() => expect(useLibraryStore.getState().tab).toBe("artists"));
    expect(useLibraryStore.getState().browse).toEqual({
      kind: "artists",
      key: "Artist",
      secondary: null,
    });
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

describe("removing missing songs", () => {
  it("offers nothing while every file is where it should be", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    // Which is the state of a healthy library, so a permanent button would be
    // one more thing to read past on every launch.
    expect(screen.queryByRole("button", { name: /Missing/ })).not.toBeInTheDocument();
  });

  it("asks before destroying anything, and says what it costs", async () => {
    const user = userEvent.setup();
    statsMock.mockResolvedValue({ ...stats(5), missing: 2 });
    render(<App />);

    await chooseFromMenu(user, "File", "Remove 2 Missing Songs…");

    // The one action in the app that deletes library rows, and the one thing
    // someone needs to know before confirming is that an unplugged drive is
    // not a reason to.
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/2 songs cannot be found/);
    expect(dialog).toHaveTextContent(/out of every playlist/);
    expect(dialog).toHaveTextContent(/plug it back in and rescan/);
  });

  it("removes nothing when the question is declined", async () => {
    const user = userEvent.setup();
    statsMock.mockResolvedValue({ ...stats(5), missing: 2 });
    render(<App />);

    await chooseFromMenu(user, "File", "Remove 2 Missing Songs…");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(removeMissingTracks).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("stops offering the removal once the backend says a file came back", async () => {
    // Playing a track whose file has returned clears its mark in the backend,
    // which emits `library://changed`. The view has no other way to find out:
    // the row would keep its marker and the File menu would keep offering to
    // remove a song that is no longer missing.
    let announce: (() => void) | undefined;
    vi.mocked(onLibraryChanged).mockImplementation(async (handler) => {
      announce = handler;
      return () => {};
    });
    statsMock.mockResolvedValue({ ...stats(5), missing: 1 });
    render(<App />);
    const user = userEvent.setup();

    const file = () => within(screen.getByRole("menubar")).getByRole("menuitem", { name: "File" });
    await user.click(file());
    expect(
      await screen.findByRole("menuitem", { name: "Remove 1 Missing Song…" }),
    ).toBeInTheDocument();
    // Closed again, or the second opening below finds it already open.
    await user.keyboard("{Escape}");

    statsMock.mockResolvedValue({ ...stats(5), missing: 0 });
    act(() => announce?.());

    await waitFor(() => expect(useLibraryStore.getState().stats.missing).toBe(0));
    await user.click(file());
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: /Missing/ })).not.toBeInTheDocument(),
    );
  });

  it("removes them on confirmation and reports how many went", async () => {
    const user = userEvent.setup();
    statsMock.mockResolvedValue({ ...stats(5), missing: 2 });
    vi.mocked(removeMissingTracks).mockResolvedValue(2);
    render(<App />);

    await chooseFromMenu(user, "File", "Remove 2 Missing Songs…");
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(removeMissingTracks).toHaveBeenCalled();
    expect(await screen.findByText("Removed 2 missing songs.")).toBeInTheDocument();
  });
});

describe("the browse tabs", () => {
  it("gives each tab its own scroll container", async () => {
    // The whole point of the key: unkeyed, the three tabs are one component
    // instance in one slot, React reuses the div across the switch, and
    // `scrollTop` rides along - so Artists opened wherever the album grid had
    // been left.
    const user = userEvent.setup();
    vi.mocked(browseGroups).mockResolvedValue([
      {
        key: "Shields",
        secondary: "Grizzly Bear",
        trackCount: 10,
        durationMs: 0,
        coverHash: null,
        year: 2012,
      },
    ]);
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Albums" }));
    const albums = await screen.findByTestId("browse-scroll");

    await user.click(screen.getByRole("button", { name: "Artists" }));
    await waitFor(() => expect(screen.getByTestId("browse-scroll")).not.toBe(albums));
  });
});

describe("the error popover", () => {
  it("says nothing while nothing is wrong", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a playback error without moving the table", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    act(() => {
      useStatusStore.setState({ message: "C:/music/gone.mp3 could not be opened" });
    });

    // In the popover, which is portalled, rather than in the content area -
    // as a paragraph in the flow it pushed every row down as it appeared.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not be opened");
    expect(document.querySelector(".content .error-popup")).toBeNull();
  });

  it("does not take focus from whatever the user was doing", async () => {
    render(<App />);
    const search = await screen.findByRole("searchbox", { name: "Search Library" });
    search.focus();

    act(() => {
      useStatusStore.setState({ message: "that file will not open" });
    });
    await screen.findByRole("alert");

    // An error arrives unasked, usually mid-scroll or mid-typing. One that
    // grabs the caret to tell you something interrupts what you were doing.
    expect(search).toHaveFocus();
  });

  it("names itself, so the message is not the only thing said", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    act(() => {
      useStatusStore.setState({ message: "C:/music/gone.mp3 could not be opened" });
    });

    // The message alone is often a path and a reason with no subject, and does
    // not say on its own that the app is reporting a fault.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("could not be opened");
  });

  it("goes away when clicked away from, and clears the error behind it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());
    act(() => {
      useStatusStore.setState({ message: "that file will not open" });
    });
    await screen.findByRole("alert");

    // No close button: clicking anywhere else already dismisses it, and a
    // control nothing can tab to is one the mouse could do without.
    await user.click(document.body);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    // Cleared at the source, not merely hidden: a popover that hides a live
    // error would never show that error again.
    expect(useStatusStore.getState().message).toBeNull();
  });

  it("shows one message when several parts of the app are unhappy", async () => {
    render(<App />);
    await waitFor(() => expect(statsMock).toHaveBeenCalled());

    act(() => {
      useStatusStore.getState().report("the library is locked");
      useStatusStore.getState().report("that file will not open");
    });

    // One slot, last wins: two unhappy stores are still one popover, and the
    // newer message is the one on screen.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("that file will not open");
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
