import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useLastfmStore } from "./features/lastfm/store";
import { useLibraryStore } from "./features/library/store";
import { usePlayerStore } from "./features/player/store";
import type { Track } from "./ipc";

/**
 * What wakes up when one value changes.
 *
 * These are not timing tests - they count renders, which is the thing that
 * actually differs between a tidy component tree and a wasteful one, and which
 * a machine can measure without a profiler or a stable clock. A wall-clock
 * budget on a CI runner would be noise; a render count is exact.
 *
 * The subjects are the updates that arrive often:
 *
 * - the playhead, which the audio thread emits every 250ms (`audio/mod.rs`),
 *   so four times a second for as long as anything is playing;
 * - the volume rail, which writes at the pointer's sampling rate;
 * - the search field, which updates on every keystroke;
 * - the selection, which changes on every click, shift-range and Ctrl+A.
 *
 * Each used to be subscribed at the top of `App`, so each re-rendered the
 * entire tree - including the song table and its forty virtualized rows.
 *
 * React Compiler runs over these components too (`vite.config.ts`), so a child
 * whose props did not change is now held still even when its parent re-renders.
 * That is a second reason a count here can be zero, and the reason the numbers
 * in this file are floors rather than budgets: the point is that they only ever
 * go down, and never silently.
 */

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
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
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
  lastfmStatus: vi.fn(async () => ({ configured: false, username: null, queued: 0 })),
  onLastfmDisconnected: vi.fn(async () => () => {}),
  onLastfmQueued: vi.fn(async () => () => {}),
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
const renders = { songTable: 0, playlistSidebar: 0, browseView: 0, menuBar: 0 };

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

// Not an expensive subtree - the counter that proves an update landed where it
// was supposed to. Every other assertion here is an absence, and an absence is
// also what a store write that reached nothing at all looks like.
vi.mock("./components/ui/MenuBar", () => ({
  MenuBar: () => {
    renders.menuBar += 1;
    return <nav />;
  },
}));

const initialLibrary = useLibraryStore.getState();
const initialPlayer = usePlayerStore.getState();

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
  // for there to be a table whose renders are worth counting. The first page
  // comes with it so that a click resolves to a real row and a shift-range to
  // real ids - `clickRow` reads them out of the page cache.
  act(() => {
    useLibraryStore.setState({
      total: 500,
      pages: new Map([[0, Array.from({ length: 20 }, (_, index) => track(index))]]),
    });
  });
  await waitFor(() => expect(renders.songTable).toBeGreaterThan(0));
  await act(async () => {
    await Promise.resolve();
  });

  renders.songTable = 0;
  renders.playlistSidebar = 0;
  renders.browseView = 0;
  renders.menuBar = 0;
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
  renders.menuBar = 0;
  useLibraryStore.setState({ ...initialLibrary, total: 0, pages: new Map() });
  usePlayerStore.setState({ ...initialPlayer, positionMs: 0 });
});

describe("what the last.fm status re-renders", () => {
  it("nothing, when there is nothing to report", async () => {
    // The Account menu needs two scalars from the store, and the startup read
    // is the one thing last.fm does unbidden. In a build with no key both come
    // back as what they already were, and zustand compares selector output by
    // `Object.is`, so no subscriber wakes at all.
    await mounted();

    await act(async () => {
      await useLastfmStore.getState().load();
    });

    expectTableMounted();
    expect(renders.menuBar).toBe(0);
    expect(renders.songTable).toBe(0);
    expect(renders.playlistSidebar).toBe(0);
  });

  it("nothing outside the menu bar, when an account connects", async () => {
    // This used to be one render of the whole tree: the menu bar has to name
    // the connected account and `menus()` was built in `App`. The two scalars
    // live in `AppMenus` now, so connecting reaches the bar and nothing else.
    await mounted();

    act(() => {
      useLastfmStore.setState({ configured: true, username: "listener" });
    });
    expect(renders.menuBar).toBe(1);

    // Writing the same status again is not a change, and zustand compares
    // selector output by `Object.is`.
    act(() => {
      useLastfmStore.setState({ configured: true, username: "listener" });
    });
    act(() => {
      useLastfmStore.setState({ connecting: false, error: null });
    });

    expectTableMounted();
    expect(renders.menuBar).toBe(1);
    expect(renders.songTable).toBe(0);
    expect(renders.playlistSidebar).toBe(0);
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

describe("what clicking a row re-renders", () => {
  /**
   * `renders.playlistSidebar`, not `renders.songTable`, and deliberately.
   *
   * The `SongTable` stub above has no store subscription, so its count says
   * whether `App` re-rendered, not whether the real table did. The real table
   * subscribes to `selection` itself, so it renders once per click whatever
   * `App` does - React batches its store notification with `App`'s into the
   * same pass - and no arrangement of this file can change that. An assertion
   * that a click leaves the table alone would pass against a fiction.
   *
   * The sidebar is the honest subject: it wants nothing from the selection, so
   * every render it does for a click is one the click had no business causing.
   */
  it("nothing else, for one click", async () => {
    await mounted();

    act(() => {
      useLibraryStore.getState().clickRow(0, 0, {});
    });

    expectTableMounted();
    expect(useLibraryStore.getState().selection.ids.size).toBe(1);
    expect(renders.playlistSidebar).toBe(0);
  });

  it("stays flat across ten clicks", async () => {
    await mounted();

    // One `act` per click, for the same reason as the playhead ticks: batching
    // them into one would collapse ten renders into one and flatter the result.
    for (let row = 0; row < 10; row += 1) {
      act(() => {
        useLibraryStore.getState().clickRow(row, row, {});
      });
    }

    expectTableMounted();
    expect(renders.playlistSidebar).toBe(0);
  });

  it("nothing else, for a shift-range", async () => {
    await mounted();

    act(() => {
      useLibraryStore.getState().clickRow(0, 0, {});
    });
    act(() => {
      useLibraryStore.getState().clickRow(9, 9, { shift: true });
    });

    expectTableMounted();
    expect(useLibraryStore.getState().selection.ids.size).toBe(10);
    expect(renders.playlistSidebar).toBe(0);
  });

  it("nothing else, for Ctrl+A", async () => {
    await mounted();

    // Every id the query matches rather than the loaded rows, so this is the
    // one selection change that arrives from the backend.
    await act(async () => {
      await useLibraryStore.getState().selectAll();
    });

    expectTableMounted();
    expect(renders.playlistSidebar).toBe(0);
  });
});
