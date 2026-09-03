import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
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
  loadDynamicBackground,
  loadWindowGeometry,
  moveInPlaylist,
  onExportProgress,
  onPlayerError,
  onPlayerPosition,
  onPlayerState,
  onScanProgress,
  onTagWriteProgress,
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
  saveDynamicBackground,
  saveWindowGeometry,
  scanLibrary,
  setPlaylistFilter,
  stageDroppedCover,
  stagedCoverUrl,
  stagePickedCover,
  type TagEdit,
  tracksByIds,
  writeTags,
} from "./index";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const convertFileSrcMock = vi.mocked(convertFileSrc);

describe("ipc", () => {
  it("invokes get_app_info and returns its payload", async () => {
    invokeMock.mockResolvedValue({ name: "apex", version: "0.1.0" });

    await expect(getAppInfo()).resolves.toEqual({ name: "apex", version: "0.1.0" });
    expect(invokeMock).toHaveBeenCalledWith("get_app_info");
  });

  it("passes the folder path through to add_watch_folder", async () => {
    invokeMock.mockResolvedValue(undefined);

    await addWatchFolder("D:/Music");

    expect(invokeMock).toHaveBeenCalledWith("add_watch_folder", { path: "D:/Music" });
  });

  it("returns the configured watch folders", async () => {
    invokeMock.mockResolvedValue(["D:/Music"]);

    await expect(listWatchFolders()).resolves.toEqual(["D:/Music"]);
    expect(invokeMock).toHaveBeenCalledWith("list_watch_folders");
  });

  it("returns the summary from a scan", async () => {
    const summary = { added: 5, updated: 0, removed: 0, unchanged: 0 };
    invokeMock.mockResolvedValue(summary);

    await expect(scanLibrary()).resolves.toEqual(summary);
    expect(invokeMock).toHaveBeenCalledWith("scan_library");
  });

  it("sends the query object under the argument name the command expects", async () => {
    invokeMock.mockResolvedValue([]);

    await queryTracks(defaultTrackQuery);

    expect(invokeMock).toHaveBeenCalledWith("query_tracks", { query: defaultTrackQuery });
  });

  it("counts tracks for the same query shape", async () => {
    invokeMock.mockResolvedValue(42);

    await expect(countTracks(defaultTrackQuery)).resolves.toBe(42);
    expect(invokeMock).toHaveBeenCalledWith("count_tracks", { query: defaultTrackQuery });
  });

  it("asks for the view's totals in one call", async () => {
    const stats = { tracks: 5, durationMs: 3_000_000, bytes: 214_000_000 };
    invokeMock.mockResolvedValue(stats);

    await expect(libraryStats(defaultTrackQuery)).resolves.toEqual(stats);
    expect(invokeMock).toHaveBeenCalledWith("library_stats", { query: defaultTrackQuery });
  });

  it("unwraps the event payload for scan progress subscribers", async () => {
    const handler = vi.fn();
    const progress = {
      scanned: 10,
      total: 20,
      added: 10,
      updated: 0,
      removed: 0,
      done: false,
    };
    listenMock.mockImplementation(async (_event, callback) => {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the listener the way Tauri calls it
      (callback as any)({ payload: progress });
      return () => {};
    });

    await onScanProgress(handler);

    expect(listenMock).toHaveBeenCalledWith("scan://progress", expect.any(Function));
    expect(handler).toHaveBeenCalledWith(progress);
  });

  it("subscribes the two long writes to their own channels", async () => {
    const handler = vi.fn();
    const progress = { done: 25, total: 500 };
    listenMock.mockImplementation(async (_event, callback) => {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the listener the way Tauri calls it
      (callback as any)({ payload: progress });
      return () => {};
    });

    await onTagWriteProgress(handler);
    await onExportProgress(handler);

    // Separate channels because they are separate operations: a tag write and
    // an export can be watched by different parts of the UI.
    expect(listenMock).toHaveBeenCalledWith("tags://progress", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("export://progress", expect.any(Function));
    expect(handler).toHaveBeenNthCalledWith(1, progress);
    expect(handler).toHaveBeenNthCalledWith(2, progress);
  });

  it("asks for every matching id when selecting or queueing the whole view", async () => {
    invokeMock.mockResolvedValue([1, 2, 3]);

    await expect(allTrackIds(defaultTrackQuery)).resolves.toEqual([1, 2, 3]);
    expect(invokeMock).toHaveBeenCalledWith("all_track_ids", { query: defaultTrackQuery });
  });

  describe("export and settings", () => {
    it("sends the path and the scope, and reports the count back", async () => {
      invokeMock.mockResolvedValue(42);

      await expect(
        exportLibrary("D:/out.json", { kind: "selection", trackIds: [1, 2] }),
      ).resolves.toBe(42);
      expect(invokeMock).toHaveBeenCalledWith("export_library", {
        path: "D:/out.json",
        scope: { kind: "selection", trackIds: [1, 2] },
      });
    });

    it("round-trips window geometry as an opaque string", async () => {
      invokeMock.mockResolvedValue(undefined);
      await saveWindowGeometry('{"x":1}');
      expect(invokeMock).toHaveBeenCalledWith("save_window_geometry", { geometry: '{"x":1}' });

      invokeMock.mockResolvedValue(null);
      await expect(loadWindowGeometry()).resolves.toBeNull();
      expect(invokeMock).toHaveBeenCalledWith("load_window_geometry");
    });

    it("round-trips the dynamic background as a bool, not a string", async () => {
      // Unlike the geometry above, Rust reads this one: it is on the export
      // allowlist. A "false" that arrived as the string would be truthy on
      // the way back and the checkbox would refuse to stay off.
      invokeMock.mockResolvedValue(undefined);
      await saveDynamicBackground(false);
      expect(invokeMock).toHaveBeenCalledWith("save_dynamic_background", { enabled: false });

      invokeMock.mockResolvedValue(false);
      await expect(loadDynamicBackground()).resolves.toBe(false);
      expect(invokeMock).toHaveBeenCalledWith("load_dynamic_background");
    });
  });

  describe("tags", () => {
    it("loads the rows behind a selection by id", async () => {
      invokeMock.mockResolvedValue([]);

      await tracksByIds([1, 2]);

      expect(invokeMock).toHaveBeenCalledWith("tracks_by_ids", { trackIds: [1, 2] });
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
        cover: { kind: "remove" },
      };
      invokeMock.mockResolvedValue({ written: 2, failed: 0, errors: [] });

      await expect(writeTags([1, 2], edit)).resolves.toEqual({
        written: 2,
        failed: 0,
        errors: [],
      });
      expect(invokeMock).toHaveBeenCalledWith("write_tags", { trackIds: [1, 2], edit });
    });

    it("stages a dropped image as the whole payload, not a field of one", async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
      invokeMock.mockResolvedValue("C:/cache/dropped-cover.jpg");

      await expect(stageDroppedCover(bytes)).resolves.toBe("C:/cache/dropped-cover.jpg");

      // Wrapped in an object it would go as JSON - one number per byte, for a
      // payload that can be 12 MB - so the shape of this call is the feature.
      expect(invokeMock).toHaveBeenCalledWith("stage_dropped_cover", bytes);
    });

    it("stages a picked image by path, since the backend can read that itself", async () => {
      invokeMock.mockResolvedValue("C:/cache/chosen-cover.jpg");

      await expect(stagePickedCover("C:/art/sleeve.jpg")).resolves.toBe(
        "C:/cache/chosen-cover.jpg",
      );

      expect(invokeMock).toHaveBeenCalledWith("stage_picked_cover", {
        path: "C:/art/sleeve.jpg",
      });
    });
  });

  describe("playlists", () => {
    it("lists and creates", async () => {
      const playlist = { id: 1, name: "Evening", kind: "static", trackCount: 0, createdAt: 0 };
      invokeMock.mockResolvedValue([playlist]);
      await expect(listPlaylists()).resolves.toEqual([playlist]);
      expect(invokeMock).toHaveBeenCalledWith("list_playlists");

      invokeMock.mockResolvedValue(playlist);
      await expect(createPlaylist("Evening")).resolves.toEqual(playlist);
      expect(invokeMock).toHaveBeenCalledWith("create_playlist", { name: "Evening" });
    });

    it("renames and deletes by id", async () => {
      invokeMock.mockResolvedValue(undefined);

      await renamePlaylist(1, "Late Night");
      expect(invokeMock).toHaveBeenCalledWith("rename_playlist", {
        playlistId: 1,
        name: "Late Night",
      });

      await deletePlaylist(1);
      expect(invokeMock).toHaveBeenCalledWith("delete_playlist", { playlistId: 1 });
    });

    it("reports how many of an add actually landed", async () => {
      invokeMock.mockResolvedValue(2);

      await expect(addToPlaylist(1, [10, 11, 12])).resolves.toBe(2);
      expect(invokeMock).toHaveBeenCalledWith("add_to_playlist", {
        playlistId: 1,
        trackIds: [10, 11, 12],
      });
    });

    it("reports how many of a removal actually went", async () => {
      invokeMock.mockResolvedValue(1);

      await expect(removeFromPlaylist(1, [10, 99])).resolves.toBe(1);
      expect(invokeMock).toHaveBeenCalledWith("remove_from_playlist", {
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

      invokeMock.mockResolvedValue(playlist);
      await expect(createSmartPlaylist("Recent", filter, order)).resolves.toEqual(playlist);
      expect(invokeMock).toHaveBeenCalledWith("create_smart_playlist", {
        name: "Recent",
        filter,
        order,
      });

      invokeMock.mockResolvedValue(undefined);
      await setPlaylistFilter(4, filter, order);
      expect(invokeMock).toHaveBeenCalledWith("set_playlist_filter", {
        playlistId: 4,
        filter,
        order,
      });

      invokeMock.mockResolvedValue(filter);
      await expect(playlistFilter(4)).resolves.toEqual(filter);
      expect(invokeMock).toHaveBeenCalledWith("playlist_filter", { playlistId: 4 });

      invokeMock.mockResolvedValue(order);
      await expect(playlistOrder(4)).resolves.toEqual(order);
      expect(invokeMock).toHaveBeenCalledWith("playlist_order", { playlistId: 4 });
    });

    it("names the reorder arguments the way the command expects", async () => {
      invokeMock.mockResolvedValue(undefined);

      await moveInPlaylist(1, [10, 11], 4);

      expect(invokeMock).toHaveBeenCalledWith("move_in_playlist", {
        playlistId: 1,
        trackIds: [10, 11],
        targetIndex: 4,
      });
    });
  });

  it("resolves a cover url through Tauri so the shape stays platform-correct", () => {
    // Windows serves this as http://cover.localhost/..., other platforms as
    // cover://localhost/... - asserting a literal here would bake in one.
    convertFileSrcMock.mockReturnValue("http://cover.localhost/abc123");

    expect(coverUrl("abc123")).toBe("http://cover.localhost/abc123");
    expect(convertFileSrcMock).toHaveBeenCalledWith("abc123", "cover");
  });

  it("points the staged url at the one path that is not a hash, and versions it", () => {
    convertFileSrcMock.mockReturnValue("http://cover.localhost/staged");

    // The staging file's name never changes, so the query string is the only
    // thing that can tell the webview this is a different image.
    expect(stagedCoverUrl(2)).toBe("http://cover.localhost/staged?v=2");
    expect(convertFileSrcMock).toHaveBeenCalledWith("staged", "cover");
  });

  describe("player", () => {
    it("sends the queue and the starting index", async () => {
      invokeMock.mockResolvedValue(undefined);

      await playerPlay([1, 2, 3], 2);

      expect(invokeMock).toHaveBeenCalledWith("player_play", { trackIds: [1, 2, 3], index: 2 });
    });

    it.each([
      ["player_toggle", playerToggle],
      ["player_pause", playerPause],
      ["player_resume", playerResume],
      ["player_stop", playerStop],
      ["player_next", playerNext],
      ["player_previous", playerPrevious],
    ])("invokes %s with no arguments", async (command, wrapper) => {
      invokeMock.mockResolvedValue(undefined);

      await wrapper();

      expect(invokeMock).toHaveBeenCalledWith(command);
    });

    it("names the seek and volume arguments the way the commands expect", async () => {
      invokeMock.mockResolvedValue(undefined);

      await playerSeek(90_000);
      expect(invokeMock).toHaveBeenCalledWith("player_seek", { positionMs: 90_000 });

      await playerSetVolume(0.25);
      expect(invokeMock).toHaveBeenCalledWith("player_set_volume", { volume: 0.25 });
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
      invokeMock.mockResolvedValue(snapshot);

      await expect(playerSnapshot()).resolves.toEqual(snapshot);
      expect(invokeMock).toHaveBeenCalledWith("player_snapshot");
    });

    it.each([
      ["player://state", onPlayerState, { status: "stopped" }],
      ["player://position", onPlayerPosition, { positionMs: 1, durationMs: 2 }],
      ["player://error", onPlayerError, "no audio output device"],
    ])("unwraps the payload of %s", async (event, subscribe, payload) => {
      const handler = vi.fn();
      listenMock.mockImplementation(async (_event, callback) => {
        // biome-ignore lint/suspicious/noExplicitAny: exercising the listener the way Tauri calls it
        (callback as any)({ payload });
        return () => {};
      });

      // biome-ignore lint/suspicious/noExplicitAny: one table covers three payload shapes
      await (subscribe as any)(handler);

      expect(listenMock).toHaveBeenCalledWith(event, expect.any(Function));
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });
});
