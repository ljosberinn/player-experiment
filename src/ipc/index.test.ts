import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import {
  addWatchFolder,
  allTrackIds,
  countTracks,
  coverUrl,
  defaultTrackQuery,
  getAppInfo,
  listWatchFolders,
  onPlayerError,
  onPlayerPosition,
  onPlayerState,
  onScanProgress,
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
  queryTracks,
  scanLibrary,
} from "./index";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const convertFileSrcMock = vi.mocked(convertFileSrc);

describe("ipc", () => {
  it("invokes get_app_info and returns its payload", async () => {
    invokeMock.mockResolvedValue({ name: "player", version: "0.1.0" });

    await expect(getAppInfo()).resolves.toEqual({ name: "player", version: "0.1.0" });
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

  it("asks for every matching id when selecting or queueing the whole view", async () => {
    invokeMock.mockResolvedValue([1, 2, 3]);

    await expect(allTrackIds(defaultTrackQuery)).resolves.toEqual([1, 2, 3]);
    expect(invokeMock).toHaveBeenCalledWith("all_track_ids", { query: defaultTrackQuery });
  });

  it("resolves a cover url through Tauri so the shape stays platform-correct", () => {
    // Windows serves this as http://cover.localhost/..., other platforms as
    // cover://localhost/... - asserting a literal here would bake in one.
    convertFileSrcMock.mockReturnValue("http://cover.localhost/abc123");

    expect(coverUrl("abc123")).toBe("http://cover.localhost/abc123");
    expect(convertFileSrcMock).toHaveBeenCalledWith("abc123", "cover");
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
