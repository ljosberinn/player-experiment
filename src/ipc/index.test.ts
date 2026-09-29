import type { InvokeArgs } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  addWatchFolder,
  allTrackIds,
  countTracks,
  coverUrl,
  createPlaylist,
  createSmartPlaylist,
  defaultTrackQuery,
  deletePlaylist,
  exportLibrary,
  type FilterGroup,
  getAppInfo,
  libraryStats,
  listPlaylists,
  listWatchFolders,
  loadDiscordPresence,
  loadDynamicBackground,
  loadUnattendedLookup,
  loadWindowGeometry,
  moveInPlaylist,
  onExportProgress,
  onFileDrop,
  onLastfmDisconnected,
  onLastfmImport,
  onLastfmLovesQueued,
  onLastfmQueued,
  onLibraryChanged,
  onLovedChanged,
  onPlayerError,
  onPlayerPosition,
  onPlayerState,
  onScanProgress,
  onTagWriteProgress,
  onTaskProgress,
  playerNext,
  playerPause,
  playerPlay,
  playerPrevious,
  playerResume,
  playerSeek,
  playerSetVolume,
  playerSnapshot,
  playerStop,
  playerToggle,
  playlistFilter,
  playlistOrder,
  queryTracks,
  removeFromPlaylist,
  renamePlaylist,
  type SmartOrder,
  saveDiscordPresence,
  saveDynamicBackground,
  saveUnattendedLookup,
  saveWindowGeometry,
  scanLibrary,
  setPlaylistFilter,
  stagedCoverUrl,
  stagePickedCover,
  type TagEdit,
  tracksByIds,
  writeTags,
} from "./index";

/** Every command, as `invoke` hands it to the runtime: `{}` when it has no arguments. */
const ipc = vi.fn<(cmd: string, payload?: InvokeArgs) => unknown>();

beforeEach(() => {
  // Events go through the real `listen` and `emit`, so a subscription is
  // asserted by what reaches its handler rather than by how it was set up.
  mockIPC(ipc, { shouldMockEvents: true });
  mockWindows("main");
  mockConvertFileSrc("windows");
});

describe("ipc", () => {
  it("invokes get_app_info and returns its payload", async () => {
    ipc.mockResolvedValue({ name: "apex", version: "0.1.0" });

    await expect(getAppInfo()).resolves.toEqual({ name: "apex", version: "0.1.0" });
    expect(ipc).toHaveBeenCalledWith("get_app_info", {});
  });

  it("passes the folder path through to add_watch_folder", async () => {
    ipc.mockResolvedValue(undefined);

    await addWatchFolder("D:/Music");

    expect(ipc).toHaveBeenCalledWith("add_watch_folder", { path: "D:/Music" });
  });

  it("returns the configured watch folders", async () => {
    ipc.mockResolvedValue(["D:/Music"]);

    await expect(listWatchFolders()).resolves.toEqual(["D:/Music"]);
    expect(ipc).toHaveBeenCalledWith("list_watch_folders", {});
  });

  it("returns the summary from a scan", async () => {
    const summary = { added: 5, updated: 0, removed: 0, unchanged: 0 };
    ipc.mockResolvedValue(summary);

    await expect(scanLibrary()).resolves.toEqual(summary);
    expect(ipc).toHaveBeenCalledWith("scan_library", {});
  });

  it("sends the query object under the argument name the command expects", async () => {
    ipc.mockResolvedValue([]);

    await queryTracks(defaultTrackQuery);

    expect(ipc).toHaveBeenCalledWith("query_tracks", { query: defaultTrackQuery });
  });

  it("counts tracks for the same query shape", async () => {
    ipc.mockResolvedValue(42);

    await expect(countTracks(defaultTrackQuery)).resolves.toBe(42);
    expect(ipc).toHaveBeenCalledWith("count_tracks", { query: defaultTrackQuery });
  });

  it("asks for the view's totals in one call", async () => {
    const stats = { tracks: 5, durationMs: 3_000_000, bytes: 214_000_000 };
    ipc.mockResolvedValue(stats);

    await expect(libraryStats(defaultTrackQuery)).resolves.toEqual(stats);
    expect(ipc).toHaveBeenCalledWith("library_stats", { query: defaultTrackQuery });
  });

  it("asks for every matching id when selecting or queueing the whole view", async () => {
    ipc.mockResolvedValue([1, 2, 3]);

    await expect(allTrackIds(defaultTrackQuery)).resolves.toEqual([1, 2, 3]);
    expect(ipc).toHaveBeenCalledWith("all_track_ids", { query: defaultTrackQuery });
  });

  describe("export and settings", () => {
    it("sends the path and the scope, and reports the count back", async () => {
      ipc.mockResolvedValue(42);

      await expect(
        exportLibrary("D:/out.json", { kind: "selection", trackIds: [1, 2] }),
      ).resolves.toBe(42);
      expect(ipc).toHaveBeenCalledWith("export_library", {
        path: "D:/out.json",
        scope: { kind: "selection", trackIds: [1, 2] },
      });
    });

    it("round-trips window geometry as an opaque string", async () => {
      ipc.mockResolvedValue(undefined);
      await saveWindowGeometry('{"x":1}');
      expect(ipc).toHaveBeenCalledWith("save_window_geometry", { geometry: '{"x":1}' });

      ipc.mockResolvedValue(null);
      await expect(loadWindowGeometry()).resolves.toBeNull();
      expect(ipc).toHaveBeenCalledWith("load_window_geometry", {});
    });

    it("round-trips the dynamic background as a bool, not a string", async () => {
      // Unlike the geometry above, Rust reads this one: it is on the export
      // allowlist. A "false" that arrived as the string would be truthy on
      // the way back and the checkbox would refuse to stay off.
      ipc.mockResolvedValue(undefined);
      await saveDynamicBackground(false);
      expect(ipc).toHaveBeenCalledWith("save_dynamic_background", { enabled: false });

      ipc.mockResolvedValue(false);
      await expect(loadDynamicBackground()).resolves.toBe(false);
      expect(ipc).toHaveBeenCalledWith("load_dynamic_background", {});
    });

    it("round-trips the unattended lookup switch", async () => {
      ipc.mockResolvedValue(undefined);
      await saveUnattendedLookup(true);
      expect(ipc).toHaveBeenCalledWith("save_unattended_lookup", { enabled: true });

      ipc.mockResolvedValue(true);
      await expect(loadUnattendedLookup()).resolves.toBe(true);
      expect(ipc).toHaveBeenCalledWith("load_unattended_lookup", {});
    });

    it("round-trips the Discord presence switch", async () => {
      ipc.mockResolvedValue(undefined);
      await saveDiscordPresence(true);
      expect(ipc).toHaveBeenCalledWith("save_discord_presence", { enabled: true });

      ipc.mockResolvedValue(true);
      await expect(loadDiscordPresence()).resolves.toBe(true);
      expect(ipc).toHaveBeenCalledWith("load_discord_presence", {});
    });
  });

  describe("tags", () => {
    it("loads the rows behind a selection by id", async () => {
      ipc.mockResolvedValue([]);

      await tracksByIds([1, 2]);

      expect(ipc).toHaveBeenCalledWith("tracks_by_ids", { trackIds: [1, 2] });
    });

    it("sends the edit alongside the tracks it applies to", async () => {
      const edit: TagEdit = {
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        genre: "Dream Pop",
        comment: null,
        year: null,
        trackNo: null,
        discNo: null,
        releaseMbid: null,
        releaseGroupMbid: null,
        releaseType: null,
        cover: { kind: "remove" },
      };
      ipc.mockResolvedValue({ written: 2, failed: 0, errors: [] });

      await expect(writeTags([1, 2], edit)).resolves.toEqual({
        written: 2,
        failed: 0,
        errors: [],
      });
      expect(ipc).toHaveBeenCalledWith("write_tags", { trackIds: [1, 2], edit });
    });

    it("stages a chosen image by path, since the backend can read that itself", async () => {
      ipc.mockResolvedValue("C:/cache/chosen-cover.jpg");

      await expect(stagePickedCover("C:/art/sleeve.jpg")).resolves.toBe(
        "C:/cache/chosen-cover.jpg",
      );

      expect(ipc).toHaveBeenCalledWith("stage_picked_cover", {
        path: "C:/art/sleeve.jpg",
      });
    });
  });

  describe("playlists", () => {
    it("lists and creates", async () => {
      const playlist = { id: 1, name: "Evening", kind: "static", trackCount: 0, createdAt: 0 };
      ipc.mockResolvedValue([playlist]);
      await expect(listPlaylists()).resolves.toEqual([playlist]);
      expect(ipc).toHaveBeenCalledWith("list_playlists", {});

      ipc.mockResolvedValue(playlist);
      await expect(createPlaylist("Evening")).resolves.toEqual(playlist);
      expect(ipc).toHaveBeenCalledWith("create_playlist", { name: "Evening" });
    });

    it("renames and deletes by id", async () => {
      ipc.mockResolvedValue(undefined);

      await renamePlaylist(1, "Late Night");
      expect(ipc).toHaveBeenCalledWith("rename_playlist", {
        playlistId: 1,
        name: "Late Night",
      });

      await deletePlaylist(1);
      expect(ipc).toHaveBeenCalledWith("delete_playlist", { playlistId: 1 });
    });

    it("reports how many of an add actually landed", async () => {
      ipc.mockResolvedValue(2);

      await expect(addToPlaylist(1, [10, 11, 12])).resolves.toBe(2);
      expect(ipc).toHaveBeenCalledWith("add_to_playlist", {
        playlistId: 1,
        trackIds: [10, 11, 12],
      });
    });

    it("reports how many of a removal actually went", async () => {
      ipc.mockResolvedValue(1);

      await expect(removeFromPlaylist(1, [10, 99])).resolves.toBe(1);
      expect(ipc).toHaveBeenCalledWith("remove_from_playlist", {
        playlistId: 1,
        trackIds: [10, 99],
      });
    });

    it("carries a filter tree to and from the smart-playlist commands", async () => {
      const filter: FilterGroup = {
        combinator: "all",
        children: [
          { type: "rule", field: "year", op: "is", value: { kind: "number", number: 2012 } },
        ],
      };
      const playlist = { id: 4, name: "Recent", kind: "smart", trackCount: 9, createdAt: 0 };
      const order: SmartOrder = { sort: { field: "playCount", direction: "desc" }, limit: 100 };

      ipc.mockResolvedValue(playlist);
      await expect(createSmartPlaylist("Recent", filter, order)).resolves.toEqual(playlist);
      expect(ipc).toHaveBeenCalledWith("create_smart_playlist", {
        name: "Recent",
        filter,
        order,
      });

      ipc.mockResolvedValue(undefined);
      await setPlaylistFilter(4, filter, order);
      expect(ipc).toHaveBeenCalledWith("set_playlist_filter", {
        playlistId: 4,
        filter,
        order,
      });

      ipc.mockResolvedValue(filter);
      await expect(playlistFilter(4)).resolves.toEqual(filter);
      expect(ipc).toHaveBeenCalledWith("playlist_filter", { playlistId: 4 });

      ipc.mockResolvedValue(order);
      await expect(playlistOrder(4)).resolves.toEqual(order);
      expect(ipc).toHaveBeenCalledWith("playlist_order", { playlistId: 4 });
    });

    it("names the reorder arguments the way the command expects", async () => {
      ipc.mockResolvedValue(undefined);

      await moveInPlaylist(1, [10, 11], 4);

      expect(ipc).toHaveBeenCalledWith("move_in_playlist", {
        playlistId: 1,
        trackIds: [10, 11],
        targetIndex: 4,
      });
    });
  });

  it("resolves a cover url through Tauri so the shape stays platform-correct", () => {
    // The Windows shape, from `mockConvertFileSrc`; other platforms serve
    // cover://localhost/..., which is why the app never builds this itself.
    expect(coverUrl("abc123")).toBe("http://cover.localhost/abc123");
  });

  it("points the staged url at the one path that is not a hash, and versions it", () => {
    // The staging file's name never changes, so the query string is the only
    // thing that can tell the webview this is a different image.
    expect(stagedCoverUrl(2)).toBe("http://cover.localhost/staged?v=2");
  });

  describe("player", () => {
    it("sends the queue and the starting index", async () => {
      ipc.mockResolvedValue(undefined);

      await playerPlay([1, 2, 3], 2);

      expect(ipc).toHaveBeenCalledWith("player_play", { trackIds: [1, 2, 3], index: 2 });
    });

    it.each([
      ["player_toggle", playerToggle],
      ["player_pause", playerPause],
      ["player_resume", playerResume],
      ["player_stop", playerStop],
      ["player_next", playerNext],
      ["player_previous", playerPrevious],
    ])("invokes %s with no arguments", async (command, wrapper) => {
      ipc.mockResolvedValue(undefined);

      await wrapper();

      expect(ipc).toHaveBeenCalledWith(command, {});
    });

    it("names the seek and volume arguments the way the commands expect", async () => {
      ipc.mockResolvedValue(undefined);

      await playerSeek(90_000);
      expect(ipc).toHaveBeenCalledWith("player_seek", { positionMs: 90_000 });

      await playerSetVolume(0.25);
      expect(ipc).toHaveBeenCalledWith("player_set_volume", { volume: 0.25 });
    });

    it("returns the current snapshot", async () => {
      const snapshot = {
        status: "playing",
        track: null,
        queueIndex: 0,
        queueLen: 1,
        positionMs: 0,
        durationMs: 1000,
        volume: 0.8,
      };
      ipc.mockResolvedValue(snapshot);

      await expect(playerSnapshot()).resolves.toEqual(snapshot);
      expect(ipc).toHaveBeenCalledWith("player_snapshot", {});
    });
  });

  describe("events", () => {
    it.each([
      [
        "scan://progress",
        onScanProgress,
        { scanned: 10, total: 20, added: 10, updated: 0, removed: 0, done: false },
      ],
      // Separate channels because they are separate operations: a tag write and
      // an export can be watched by different parts of the UI.
      ["tags://progress", onTagWriteProgress, { done: 25, total: 500 }],
      ["export://progress", onExportProgress, { done: 25, total: 500 }],
      ["lastfm://import", onLastfmImport, { done: 25, total: 500 }],
      ["lastfm://queued", onLastfmQueued, 3],
      ["lastfm://loves-queued", onLastfmLovesQueued, 0],
      ["task://progress", onTaskProgress, null],
      ["player://state", onPlayerState, { status: "stopped" }],
      ["player://position", onPlayerPosition, { positionMs: 1, durationMs: 2 }],
      ["player://error", onPlayerError, "no audio output device"],
    ])("hands %s subscribers the payload", async (event, subscribe, payload) => {
      const handler = vi.fn();

      // biome-ignore lint/suspicious/noExplicitAny: one table covers every payload shape
      await (subscribe as any)(handler);
      await emit(event, payload);

      expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
    });

    it.each([
      ["lastfm://disconnected", onLastfmDisconnected],
      ["loved://changed", onLovedChanged],
      ["library://changed", onLibraryChanged],
    ])("tells %s subscribers, with nothing attached", async (event, subscribe) => {
      const handler = vi.fn();

      await subscribe(handler);
      await emit(event);

      expect(handler).toHaveBeenCalledExactlyOnceWith();
    });

    it("hands file-drop subscribers the drop rather than the event around it", async () => {
      const handler = vi.fn();

      await onFileDrop(handler);
      await emit("tauri://drag-drop", { paths: ["D:/a.mp3"], position: { x: 1, y: 2 } });

      expect(handler).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ type: "drop", paths: ["D:/a.mp3"] }),
      );
    });
  });
});
