import { beforeEach, describe, expect, it, vi } from "vitest";
import { addWatchFolder, scanLibrary } from "../../ipc";
import { useStatusStore } from "../shell/statusStore";
import { useScanStore } from "./scan";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  addWatchFolder: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const summary = { added: 0, updated: 0, missing: 0, returned: 0, unchanged: 0 };
const refresh = vi.fn(async () => {});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(scanLibrary).mockResolvedValue(summary);
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
  useScanStore.setState({ progress: null, busy: false });
  useStatusStore.setState({ message: null, notice: null });
  // Only the one action this store reaches for; the rest of the library store
  // is not its business.
  useLibraryStore.setState({ refresh } as never);
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
    expect(scanLibrary).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
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
