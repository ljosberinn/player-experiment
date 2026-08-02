import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import {
  addWatchFolder,
  countTracks,
  coverUrl,
  defaultTrackQuery,
  getAppInfo,
  listWatchFolders,
  onScanProgress,
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

  it("resolves a cover url through Tauri so the shape stays platform-correct", () => {
    // Windows serves this as http://cover.localhost/..., other platforms as
    // cover://localhost/... - asserting a literal here would bake in one.
    convertFileSrcMock.mockReturnValue("http://cover.localhost/abc123");

    expect(coverUrl("abc123")).toBe("http://cover.localhost/abc123");
    expect(convertFileSrcMock).toHaveBeenCalledWith("abc123", "cover");
  });
});
