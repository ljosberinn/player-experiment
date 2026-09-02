import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allTrackIds, type Playlist, removeFromPlaylist, tracksByIds } from "../../ipc";
import { usePlaylistsStore } from "../playlists/store";
import { useLibraryStore } from "./store";
import { useSelectionShortcuts } from "./useSelectionShortcuts";

vi.mock("../../ipc", () => ({
  allTrackIds: vi.fn(),
  countTracks: vi.fn(async () => 0),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0, removed: 0 })),
  queryTracks: vi.fn(async () => []),
  listPlaylists: vi.fn(async () => []),
  removeFromPlaylist: vi.fn(async () => 2),
  tracksByIds: vi.fn(async () => []),
  canUndoTagEdit: vi.fn(async () => false),
}));

function playlist(id: number, kind: Playlist["kind"]): Playlist {
  return { id, name: `List ${id}`, kind, trackCount: 3, createdAt: 0 };
}

function Harness() {
  useSelectionShortcuts();
  return <input aria-label="Search" />;
}

const initial = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  usePlaylistsStore.setState({ ...initialPlaylists, playlists: [] });
  useLibraryStore.setState({
    ...initial,
    selection: { ids: new Set(), anchorIndex: null },
    playlistId: null,
    pendingRemoval: null,
    search: "",
  });
  vi.mocked(allTrackIds).mockResolvedValue([1, 2, 3]);
});

describe("useSelectionShortcuts", () => {
  it("selects everything the query matches on Ctrl+A", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Control>}a{/Control}");

    // Every matching id, not just the loaded pages - a selection truncated at
    // what happened to be scrolled into view would be a trap.
    expect(allTrackIds).toHaveBeenCalled();
    expect([...useLibraryStore.getState().selection.ids]).toEqual([1, 2, 3]);
  });

  it("also answers to Cmd+A", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Meta>}a{/Meta}");

    expect(allTrackIds).toHaveBeenCalled();
  });

  it("respects the current filter rather than selecting the whole library", async () => {
    useLibraryStore.setState({ search: "grizzly", playlistId: 4 });
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Control>}a{/Control}");

    expect(allTrackIds).toHaveBeenCalledWith(
      expect.objectContaining({ search: "grizzly", playlistId: 4 }),
    );
  });

  it("leaves Ctrl+A alone while the user is typing", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("textbox", { name: "Search" }));
    await user.keyboard("{Control>}a{/Control}");

    // In a text field Ctrl+A means "select this text", which is far more
    // useful than selecting the library behind it.
    expect(allTrackIds).not.toHaveBeenCalled();
  });

  it("clears the selection on Escape", async () => {
    useLibraryStore.setState({ selection: { ids: new Set([1, 2]), anchorIndex: 0 } });
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Escape}");

    expect(useLibraryStore.getState().selection.ids.size).toBe(0);
  });

  it("leaves a bare Escape alone when nothing is selected", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    // Escape belongs to whatever else wants it - a dialog, the search box -
    // when there is no selection for it to clear.
    const onWindowKeyDown = vi.fn((event: KeyboardEvent) => {
      expect(event.defaultPrevented).toBe(false);
    });
    window.addEventListener("keydown", onWindowKeyDown);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", onWindowKeyDown);

    expect(onWindowKeyDown).toHaveBeenCalled();
  });

  describe("Ctrl+I", () => {
    it("opens the tag editor on the selection", async () => {
      useLibraryStore.setState({ selection: { ids: new Set([1, 2]), anchorIndex: 0 } });
      render(<Harness />);
      const user = userEvent.setup();

      await user.keyboard("{Control>}i{/Control}");

      // Edit lost its toolbar button when it moved to the row menu; a
      // menu is not a substitute for a shortcut, so this had to exist first.
      expect(tracksByIds).toHaveBeenCalledWith([1, 2]);
    });

    it("does nothing with an empty selection", async () => {
      render(<Harness />);
      const user = userEvent.setup();

      await user.keyboard("{Control>}i{/Control}");

      expect(tracksByIds).not.toHaveBeenCalled();
    });

    it("stays out of the way while typing", async () => {
      useLibraryStore.setState({ selection: { ids: new Set([1]), anchorIndex: 0 } });
      render(<Harness />);
      const user = userEvent.setup();

      await user.click(screen.getByRole("textbox", { name: "Search" }));
      await user.keyboard("{Control>}i{/Control}");

      expect(tracksByIds).not.toHaveBeenCalled();
    });
  });

  describe("Delete", () => {
    beforeEach(() => {
      usePlaylistsStore.setState({ playlists: [playlist(4, "static")] });
      useLibraryStore.setState({
        playlistId: 4,
        selection: { ids: new Set([1, 2]), anchorIndex: 0 },
      });
    });

    it("removes the selection from the open playlist", async () => {
      render(<Harness />);
      const user = userEvent.setup();

      // A focused row handles Delete itself; this is the path for when focus
      // is anywhere else, which is where Ctrl+A leaves it.
      await user.keyboard("{Delete}");

      expect(removeFromPlaylist).toHaveBeenCalledWith(4, [1, 2]);
    });

    it("asks to remove from the library inside a smart playlist", async () => {
      usePlaylistsStore.setState({ playlists: [playlist(4, "smart")] });
      render(<Harness />);
      const user = userEvent.setup();

      await user.keyboard("{Delete}");

      // A smart playlist is a query - there is no membership row to take out,
      // so the only thing left to remove from is the library. It asks first,
      // which is what `pendingRemoval` being set rather than a call means.
      expect(removeFromPlaylist).not.toHaveBeenCalled();
      expect(useLibraryStore.getState().pendingRemoval).toEqual([1, 2]);
    });

    it("asks to remove from the library in the library view", async () => {
      useLibraryStore.setState({ playlistId: null });
      render(<Harness />);
      const user = userEvent.setup();

      await user.keyboard("{Delete}");

      expect(removeFromPlaylist).not.toHaveBeenCalled();
      expect(useLibraryStore.getState().pendingRemoval).toEqual([1, 2]);
    });

    it("removes nothing at all with an empty selection", async () => {
      useLibraryStore.setState({
        playlistId: null,
        selection: { ids: new Set(), anchorIndex: null },
      });
      render(<Harness />);
      const user = userEvent.setup();

      await user.keyboard("{Delete}");

      expect(useLibraryStore.getState().pendingRemoval).toBeNull();
    });

    it("does not act twice when a row already handled it", async () => {
      render(<Harness />);

      const event = new KeyboardEvent("keydown", {
        key: "Delete",
        cancelable: true,
        bubbles: true,
      });
      event.preventDefault();
      window.dispatchEvent(event);

      expect(removeFromPlaylist).not.toHaveBeenCalled();
      expect(useLibraryStore.getState().pendingRemoval).toBeNull();
    });
  });
});
