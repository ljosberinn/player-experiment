import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanProgress } from "../../ipc";
import { onScanProgress, scanLibrary } from "../../ipc";
import { ScanBar } from "./ScanBar";
import { useScanStore } from "./scan";

/**
 * Only the readout since phase 34. Add Folder and Rescan moved to the File
 * menu, and their behaviour is tested against the store that now owns it in
 * `scan.test.ts` - which needs no DOM at all, because none of it was ever
 * about one.
 */

vi.mock("../../ipc", () => ({
  addWatchFolder: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./store", () => ({
  useLibraryStore: (selector: (s: { refresh: () => Promise<void> }) => unknown) =>
    selector({ refresh: vi.fn(async () => {}) }),
}));

const onScanProgressMock = vi.mocked(onScanProgress);
const scanLibraryMock = vi.mocked(scanLibrary);

/** Captures the handler the component registers, so tests can drive events. */
let emitProgress: ((progress: ScanProgress) => void) | undefined;
const unlisten = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  emitProgress = undefined;
  onScanProgressMock.mockImplementation(async (handler) => {
    emitProgress = handler;
    return unlisten;
  });
  scanLibraryMock.mockResolvedValue({
    added: 0,
    updated: 0,
    missing: 0,
    returned: 0,
    unchanged: 0,
  });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
  // The store is a module singleton; progress left behind by one test would
  // otherwise be on screen at the start of the next.
  useScanStore.setState({ progress: null, busy: false });
});

describe("ScanBar", () => {
  it("reports progress from scan events", async () => {
    render(<ScanBar />);
    await waitFor(() => expect(emitProgress).toBeDefined());

    act(() => {
      emitProgress?.({
        scanned: 1200,
        total: 5000,
        added: 1200,
        updated: 0,
        missing: 0,
        done: false,
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      `Scanning ${(1200).toLocaleString()} of ${(5000).toLocaleString()}`,
    );
  });

  it("stops reporting progress once the scan is done", async () => {
    render(<ScanBar />);
    await waitFor(() => expect(emitProgress).toBeDefined());

    act(() => {
      emitProgress?.({ scanned: 10, total: 10, added: 10, updated: 0, missing: 0, done: true });
    });

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("unsubscribes on unmount so a later scan does not update a dead component", async () => {
    const { unmount } = render(<ScanBar />);
    await waitFor(() => expect(emitProgress).toBeDefined());

    unmount();

    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
