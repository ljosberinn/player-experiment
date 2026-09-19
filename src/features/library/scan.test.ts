import { beforeEach, describe, expect, it, vi } from "vitest";
import { addWatchFolder, ingestDroppedPaths, scanLibrary } from "../../ipc";
import { useStatusStore } from "../shell/statusStore";
import { useScanStore } from "./scan";

vi.mock("../../ipc", () => ({
  addWatchFolder: vi.fn(),
  ingestDroppedPaths: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const summary = { added: 0, updated: 0, missing: 0, returned: 0, unchanged: 0 };
const drop = { folders: 0, moved: 0, adopted: 0, refused: 0, ignored: 0 };

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(scanLibrary).mockResolvedValue(summary);
  vi.mocked(ingestDroppedPaths).mockResolvedValue(drop);
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
  useScanStore.setState({ progress: null, busy: false });
  useStatusStore.setState({ message: null, notice: null });
});

/**
 * Scanning, without a component.
 *
 * These were `ScanBar` tests until phase 34, when Add Folder and Rescan became
 * File-menu entries and the behaviour moved into a store. None of it was ever
 * about a button: what matters is that a second scan cannot start on top of the
 * first, that a cancelled folder picker does nothing at all, and that a failure
 * is reported rather than swallowed.
 */
describe("the scan store", () => {
  it("adds the chosen folder and scans it", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue(["D:/Music"]);

    await useScanStore.getState().addFolder();

    expect(addWatchFolder).toHaveBeenCalledWith("D:/Music");
    // And nothing else: `scan_library` announces itself, and the view reloads
    // off that rather than off a call from here.
    expect(scanLibrary).toHaveBeenCalled();
  });

  it("adds every folder chosen and scans once for the lot", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue(["D:/Music", "E:/Archive", "F:/Live"]);

    await useScanStore.getState().addFolder();

    expect(addWatchFolder).toHaveBeenCalledTimes(3);
    expect(addWatchFolder).toHaveBeenLastCalledWith("F:/Live");
    // A scan walks every watched folder, so one per addition would walk the
    // first of them three times over.
    expect(scanLibrary).toHaveBeenCalledOnce();
  });

  it("does nothing at all when the folder picker is dismissed", async () => {
    await useScanStore.getState().addFolder();

    expect(addWatchFolder).not.toHaveBeenCalled();
    expect(scanLibrary).not.toHaveBeenCalled();
  });

  it("refuses a second scan while one is running", async () => {
    // The reason this exists: F5 is a key, and a key repeats when held. Without
    // the guard, leaning on it queues a scan per repeat.
    let finish: (() => void) | undefined;
    vi.mocked(scanLibrary).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve(summary))),
    );

    const first = useScanStore.getState().rescan();
    await vi.waitFor(() => expect(useScanStore.getState().busy).toBe(true));
    await useScanStore.getState().rescan();
    await useScanStore.getState().rescan();

    expect(scanLibrary).toHaveBeenCalledTimes(1);

    finish?.();
    await first;
    expect(useScanStore.getState().busy).toBe(false);
  });

  it("refuses to add a folder while a scan is running", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue(["D:/Music"]);
    useScanStore.setState({ busy: true });

    await useScanStore.getState().addFolder();

    // Not even the picker: a dialog that appears and then does nothing is
    // worse than one that never opened.
    expect(open).not.toHaveBeenCalled();
  });

  it("reports a scan that failed rather than failing silently", async () => {
    vi.mocked(scanLibrary).mockRejectedValue("permission denied");

    await useScanStore.getState().rescan();

    expect(useStatusStore.getState().message).toBe("permission denied");
    // And releases the lock, or one failure would refuse every scan after it.
    expect(useScanStore.getState().busy).toBe(false);
  });

  it("reports a failure from the folder picker", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockRejectedValue("dialog unavailable");

    await useScanStore.getState().addFolder();

    expect(useStatusStore.getState().message).toBe("dialog unavailable");
    expect(addWatchFolder).not.toHaveBeenCalled();
  });

  it("clears the popover as it starts, so a retry is not read as the old failure", async () => {
    useStatusStore.setState({ message: "permission denied" });

    await useScanStore.getState().rescan();

    expect(useStatusStore.getState().message).toBeNull();
  });
});

/**
 * What a drop from the OS does, on this side of it.
 *
 * The ingest command makes no rows: it leaves the filesystem and the
 * tombstones in a state where the scan sees what was dropped, and the scan here
 * is the one Add Folders… already runs.
 */
describe("dropping paths on the library", () => {
  it("ingests the paths and scans behind them", async () => {
    vi.mocked(ingestDroppedPaths).mockResolvedValue({ ...drop, folders: 2 });

    await useScanStore.getState().drop(["D:/Music", "D:/Live"]);

    expect(ingestDroppedPaths).toHaveBeenCalledWith(["D:/Music", "D:/Live"]);
    expect(scanLibrary).toHaveBeenCalledOnce();
  });

  it("does not scan when nothing landed", async () => {
    vi.mocked(ingestDroppedPaths).mockResolvedValue({ ...drop, refused: 1 });

    await useScanStore.getState().drop(["C:/Downloads/one.mp3"]);

    // A refused drop changed nothing on disk, and walking the library to be
    // told so is the one cost this can avoid entirely.
    expect(scanLibrary).not.toHaveBeenCalled();
  });

  it("says once why the files were refused, whatever their number", async () => {
    vi.mocked(ingestDroppedPaths).mockResolvedValue({ ...drop, refused: 3 });

    await useScanStore.getState().drop(["a.mp3", "b.mp3", "c.mp3"]);

    expect(useStatusStore.getState().message).toContain("Those 3 files");
    expect(useStatusStore.getState().message).toContain("Organise My Library");
  });

  it("keeps the refusal on screen through the scan a mixed drop runs", async () => {
    vi.mocked(ingestDroppedPaths).mockResolvedValue({ ...drop, folders: 1, refused: 1 });

    await useScanStore.getState().drop(["D:/Music", "C:/Downloads/one.mp3"]);

    // `rescan` clears the popover as it starts, so the sentence has to be said
    // after it rather than before.
    expect(scanLibrary).toHaveBeenCalledOnce();
    expect(useStatusStore.getState().message).toContain("That file is not in a watched folder");
  });

  it("refuses a drop while a scan is running", async () => {
    useScanStore.setState({ busy: true });

    await useScanStore.getState().drop(["D:/Music"]);

    expect(ingestDroppedPaths).not.toHaveBeenCalled();
  });

  it("reports an ingest that failed", async () => {
    vi.mocked(ingestDroppedPaths).mockRejectedValue("access denied");

    await useScanStore.getState().drop(["D:/Music"]);

    expect(useStatusStore.getState().message).toBe("access denied");
  });
});
