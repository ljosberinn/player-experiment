import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useLastfmStore } from "./features/lastfm/store";
import { useLibraryStore } from "./features/library/store";
import { usePlayerStore } from "./features/player/store";

/**
 * What wakes up when one value changes.
 *
 * These are not timing tests - they count renders, which is the thing that
 * actually differs between a tidy component tree and a wasteful one, and which
 * a machine can measure without a profiler or a stable clock. A wall-clock
 * budget on a CI runner would be noise; a render count is exact.
 *
 * The two subjects are the two updates that arrive on their own schedule
 * rather than in response to a click:
 *
 * - the playhead, which the audio thread emits every 250ms (`audio/mod.rs`),
 *   so four times a second for as long as anything is playing;
 * - the search field, which updates on every keystroke.
 *
 * Both used to be subscribed at the top of `App`, so both re-rendered the
 * entire tree - including the song table and its forty virtualized rows.
 */

vi.mock("./ipc", () => ({
  countTracks: vi.fn(),
  // Answered rather than merely stubbed: the crash notice asks on mount, and
  // an unresolved promise there leaves an act() warning in every App test.
  lastCrash: vi.fn(async () => null),
  acknowledgeCrash: vi.fn(),
  revealCrashLog: vi.fn(),
  getAppInfo: vi.fn(async () => ({ name: "apex", version: "0.4.2" })),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  addWatchFolder: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(async () => () => {}),
  onTagWriteProgress: vi.fn(async () => () => {}),
  onExportProgress: vi.fn(async () => () => {}),
  onLibraryChanged: vi.fn(async () => () => {}),
  coverUrl: vi.fn((hash: string) => `cover-url:${hash}`),
  onPlayerState: vi.fn(async () => () => {}),
  onPlayerPosition: vi.fn(async () => () => {}),
  onPlayerError: vi.fn(async () => () => {}),
  playerSnapshot: vi.fn(async () => ({
    status: "stopped",
    track: null,
    palette: null,
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    queueIndex: null,
    queueLen: 0,
  })),
  playerPlay: vi.fn(),
  playerToggle: vi.fn(),
  playerStop: vi.fn(),
  playerNext: vi.fn(),
  playerPrevious: vi.fn(),
  playerSeek: vi.fn(),
  playerSetVolume: vi.fn(),
  exportLibrary: vi.fn(),
  saveWindowGeometry: vi.fn(),
  loadWindowGeometry: vi.fn(async () => null),
  tracksByIds: vi.fn(),
  writeTags: vi.fn(),
  undoTagEdit: vi.fn(),
  canUndoTagEdit: vi.fn(async () => false),
  listPlaylists: vi.fn(async () => []),
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
  lastfmStatus: vi.fn(async () => ({ configured: false, username: null })),
  lastfmBeginConnect: vi.fn(),
  lastfmCompleteConnect: vi.fn(),
  lastfmDisconnect: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    setTitle: vi.fn(),
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
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));

/**
 * The expensive subtrees, replaced by counters.
 *
 * Stubs rather than a `Profiler` wrapper: what matters is whether the table is
 * asked to render at all, and a stub answers that without depending on how
 * React attributes time. The real components are exercised by their own tests.
 */
const renders = { songTable: 0, playlistSidebar: 0, browseView: 0 };

vi.mock("./features/library/SongTable", () => ({
  SongTable: () => {
    renders.songTable += 1;
    return <table />;
  },
}));

vi.mock("./features/playlists/PlaylistSidebar", () => ({
  PlaylistSidebar: () => {
    renders.playlistSidebar += 1;
    return <ul />;
  },
}));

vi.mock("./features/library/BrowseView", () => ({
  BrowseView: () => {
    renders.browseView += 1;
    return <div />;
  },
}));

const initialLibrary = useLibraryStore.getState();
const initialPlayer = usePlayerStore.getState();

/**
 * Renders the app with a non-empty library, lets the launch effects settle,
 * then zeroes the counters so only what follows is measured.
 */
async function mounted() {
  render(<App />);

  // Settle the launch effects *first*. `refresh()` runs on mount and writes its
  // own `total`, so a library set before it lands gets overwritten - which is
  // how the first draft of this file ended up asserting against an empty state
  // with no table in it at all, and passing for the wrong reason.
  await act(async () => {
    await Promise.resolve();
  });

  // `total` decides between the empty state and the table, so it has to be set
  // for there to be a table whose renders are worth counting.
  act(() => {
    useLibraryStore.setState({ total: 500 });
  });
  await waitFor(() => expect(renders.songTable).toBeGreaterThan(0));
  await act(async () => {
    await Promise.resolve();
  });

  renders.songTable = 0;
  renders.playlistSidebar = 0;
  renders.browseView = 0;
}

/**
 * The table is on screen and the counters mean something.
 *
 * Every test here asserts an absence, and an absence is also what you get when
 * the component was never mounted. This is the guard against that.
 */
function expectTableMounted() {
  expect(document.querySelector("table")).not.toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  renders.songTable = 0;
  renders.playlistSidebar = 0;
  renders.browseView = 0;
  useLibraryStore.setState({ ...initialLibrary, total: 0, pages: new Map(), error: null });
  usePlayerStore.setState({ ...initialPlayer, positionMs: 0, error: null });
});

describe("what the last.fm status re-renders", () => {
  it("nothing, when there is nothing to report", async () => {
    // The Account menu needs two scalars from the store, so `App` subscribes
    // to them - and the startup read is the one thing last.fm does unbidden.
    // In a build with no key both scalars come back as what they already were,
    // and zustand compares selector output by `Object.is`, so no subscriber
    // wakes at all. This is the assertion behind that claim.
    await mounted();

    await act(async () => {
      await useLastfmStore.getState().load();
    });

    expectTableMounted();
    expect(renders.songTable).toBe(0);
    expect(renders.playlistSidebar).toBe(0);
  });

  it("the whole tree once, when an account connects - and never again", async () => {
    // The floor rather than an absence, and worth stating as one: the menu bar
    // has to name the connected account, `menus()` is built in `App`, so `App`
    // re-renders and takes its children with it. That is one render for an
    // action a user takes once. What must never happen is a second - a store
    // that wrote on every scrobble would put this on the playhead's schedule.
    await mounted();

    act(() => {
      useLastfmStore.setState({ configured: true, username: "listener" });
    });
    expect(renders.songTable).toBe(1);

    // Writing the same status again is not a change, and zustand compares
    // selector output by `Object.is`.
    act(() => {
      useLastfmStore.setState({ configured: true, username: "listener" });
    });
    act(() => {
      useLastfmStore.setState({ connecting: false, error: null });
    });

    expectTableMounted();
    expect(renders.songTable).toBe(1);
    expect(renders.playlistSidebar).toBe(1);
  });
});

describe("what a playhead tick re-renders", () => {
  it("leaves the song table alone", async () => {
    await mounted();

    // One tick of the audio thread. This happens four times a second, for the
    // whole length of every song.
    act(() => {
      usePlayerStore.setState({ positionMs: 1_000 });
    });

    expectTableMounted();
    expect(renders.songTable).toBe(0);
  });

  it("leaves the sidebar alone", async () => {
    await mounted();

    act(() => {
      usePlayerStore.setState({ positionMs: 1_000 });
    });

    expectTableMounted();
    expect(renders.playlistSidebar).toBe(0);
  });

  it("stays flat over a song's worth of ticks", async () => {
    await mounted();

    // Four minutes at four ticks a second. Each tick gets its own `act`,
    // because each one arrives from the backend in its own task - batching them
    // into one would collapse 960 renders into 1 and flatter the result.
    for (let tick = 1; tick <= 960; tick += 1) {
      act(() => {
        usePlayerStore.setState({ positionMs: tick * 250 });
      });
    }

    expectTableMounted();
    expect(renders.songTable).toBe(0);
    expect(renders.playlistSidebar).toBe(0);
  });
});

describe("what dragging the volume slider re-renders", () => {
  it("leaves the song table alone", async () => {
    await mounted();

    // The volume slider reports with `onValueChange`, not `onValueCommitted`,
    // because volume has to follow the drag to be usable at all. So this is
    // one store write per pointer move - a faster stream than the playhead's.
    for (let step = 1; step <= 50; step += 1) {
      act(() => {
        usePlayerStore.setState({ volume: step / 100 });
      });
    }

    expectTableMounted();
    expect(renders.songTable).toBe(0);
    expect(renders.playlistSidebar).toBe(0);
  });
});

describe("what typing in the search box re-renders", () => {
  it("leaves the song table alone until the search is actually run", async () => {
    await mounted();

    // `setSearch` holds the pending text and debounces the query; the table
    // has nothing to show differently until the debounce fires.
    act(() => {
      useLibraryStore.getState().setSearch("bea");
    });

    expectTableMounted();
    expect(renders.songTable).toBe(0);
  });

  it("stays flat across a typed word", async () => {
    await mounted();

    // One `act` per keystroke, for the same reason as the playhead ticks.
    for (const text of ["b", "be", "bea", "beac", "beach"]) {
      act(() => {
        useLibraryStore.getState().setSearch(text);
      });
    }

    expectTableMounted();
    expect(renders.songTable).toBe(0);
    expect(renders.playlistSidebar).toBe(0);
  });
});
