import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaylistsStore } from "../playlists/store";
import { HistoryNav } from "./HistoryNav";
import { emptyHistory, type HistoryEntry, historyAt, record } from "./history";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
  listPlaylists: vi.fn(async () => []),
  loadSidebarSections: vi.fn(async () => null),
}));

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { tab: "songs", browse: null, playlistId: null, ...over };
}

const initial = useLibraryStore.getState();

beforeEach(() => {
  vi.restoreAllMocks();
  useLibraryStore.setState({ ...initial, history: historyAt(entry()) });
  usePlaylistsStore.setState({ playlists: [] });
});

/** Puts the store into a history that has visited each of `entries` in turn. */
function visited(entries: HistoryEntry[]): void {
  useLibraryStore.setState({ history: entries.reduce(record, emptyHistory) });
}

describe("HistoryNav", () => {
  it("offers neither direction before anything has been visited", () => {
    render(<HistoryNav />);

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("names where back would land", () => {
    visited([entry(), entry({ tab: "albums" })]);

    render(<HistoryNav />);

    // A back button that says only "Back" is a button you have to press to
    // find out what it does.
    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute("title", "Back to Songs");
  });

  it("names an album by its title rather than by the tab it is in", () => {
    visited([
      entry({ tab: "albums" }),
      entry({ tab: "albums", browse: { kind: "albums", key: "Shields", secondary: null } }),
      entry({ tab: "songs" }),
    ]);

    render(<HistoryNav />);

    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute(
      "title",
      "Back to Shields",
    );
  });

  it("names the untagged group rather than leaving the tooltip blank", () => {
    visited([
      entry({ tab: "albums" }),
      entry({ tab: "albums", browse: { kind: "albums", key: null, secondary: null } }),
      entry({ tab: "songs" }),
    ]);

    render(<HistoryNav />);

    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute(
      "title",
      "Back to Unknown Album",
    );
  });

  it("names a playlist by its name", () => {
    usePlaylistsStore.setState({
      playlists: [{ id: 5, name: "Late Night", kind: "static", trackCount: 3, createdAt: 0 }],
    });
    visited([entry({ playlistId: 5 }), entry()]);

    render(<HistoryNav />);

    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute(
      "title",
      "Back to Late Night",
    );
  });

  it("goes back when pressed", async () => {
    const back = vi.fn(async () => {});
    useLibraryStore.setState({ back });
    visited([entry(), entry({ tab: "albums" })]);

    render(<HistoryNav />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(back).toHaveBeenCalled();
  });

  it("offers forward only while there is a branch to return to", () => {
    visited([entry(), entry({ tab: "albums" })]);
    const { rerender } = render(<HistoryNav />);
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    // What `back()` leaves behind: the same entries, the index one lower.
    useLibraryStore.setState({
      history: { entries: [entry(), entry({ tab: "albums" })], index: 0 },
    });
    rerender(<HistoryNav />);

    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toHaveAttribute(
      "title",
      "Forward to Albums",
    );
  });
});
