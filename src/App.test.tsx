import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useLibraryStore } from "./features/library/store";
import { addWatchFolder, countTracks, queryTracks, scanLibrary } from "./ipc";

vi.mock("./ipc", () => ({
  countTracks: vi.fn(),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(),
  addWatchFolder: vi.fn(),
  scanLibrary: vi.fn(),
  onScanProgress: vi.fn(async () => () => {}),
  coverUrl: vi.fn((hash: string) => `cover-url:${hash}`),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const countTracksMock = vi.mocked(countTracks);
const queryTracksMock = vi.mocked(queryTracks);
const addWatchFolderMock = vi.mocked(addWatchFolder);
const scanLibraryMock = vi.mocked(scanLibrary);

const initial = useLibraryStore.getState();

beforeEach(async () => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initial, total: 0, pages: new Map(), error: null });
  countTracksMock.mockResolvedValue(0);
  queryTracksMock.mockResolvedValue([]);
  scanLibraryMock.mockResolvedValue({ added: 0, updated: 0, removed: 0, unchanged: 0 });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);
});

describe("App", () => {
  it("invites the user to add a folder when the library is empty", async () => {
    render(<App />);

    expect(await screen.findByText(/No songs yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Folder…" })).toBeInTheDocument();
  });

  it("shows the chrome: sidebar, tabs, search and status bar", async () => {
    render(<App />);

    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());
    expect(screen.getByRole("navigation", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Songs" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Library" })).toBeInTheDocument();
    expect(screen.getAllByText("No songs").length).toBeGreaterThan(0);
  });

  it("swaps the empty state for the table once the library has rows", async () => {
    countTracksMock.mockResolvedValue(3);
    queryTracksMock.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText(/No songs yet/)).not.toBeInTheDocument());
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
  });

  it("searches through the backend as the user types", async () => {
    render(<App />);
    await waitFor(() => expect(countTracksMock).toHaveBeenCalled());
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "Search Library" }), "maki");

    await waitFor(() => {
      expect(countTracksMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "maki" }));
    });
  });

  it("adds the chosen folder and scans it", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("D:/Music");
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add Folder…" }));

    await waitFor(() => expect(addWatchFolderMock).toHaveBeenCalledWith("D:/Music"));
    expect(scanLibraryMock).toHaveBeenCalled();
  });

  it("does nothing when the folder picker is dismissed", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add Folder…" }));

    await waitFor(() => expect(addWatchFolderMock).not.toHaveBeenCalled());
    expect(scanLibraryMock).not.toHaveBeenCalled();
  });

  it("reports a scan failure instead of failing silently", async () => {
    scanLibraryMock.mockRejectedValue("permission denied");
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Rescan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });

  it("surfaces a query failure from the store", async () => {
    countTracksMock.mockRejectedValue("database is locked");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
  });
});
