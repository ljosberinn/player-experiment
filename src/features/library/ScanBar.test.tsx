import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanProgress } from "../../ipc";
import { addWatchFolder, onScanProgress, scanLibrary } from "../../ipc";
import { ScanBar } from "./ScanBar";

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
const addWatchFolderMock = vi.mocked(addWatchFolder);

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
  scanLibraryMock.mockResolvedValue({ added: 0, updated: 0, removed: 0, unchanged: 0 });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
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
        removed: 0,
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
      emitProgress?.({ scanned: 10, total: 10, added: 10, updated: 0, removed: 0, done: true });
    });

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("unsubscribes on unmount so a later scan does not update a dead component", async () => {
    const { unmount } = render(<ScanBar />);
    await waitFor(() => expect(emitProgress).toBeDefined());

    unmount();

    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });

  it("disables both buttons while a scan is running", async () => {
    let finish: (() => void) | undefined;
    scanLibraryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ added: 0, updated: 0, removed: 0, unchanged: 0 });
        }),
    );
    render(<ScanBar />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Rescan" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add Folder…" })).toBeDisabled();
    });

    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rescan" })).toBeEnabled());
  });

  it("surfaces a failure from the folder picker", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockRejectedValue("dialog unavailable");
    render(<ScanBar />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add Folder…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("dialog unavailable");
    expect(addWatchFolderMock).not.toHaveBeenCalled();
  });
});
