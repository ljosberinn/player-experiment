import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  deletePlaylist,
  listPlaylists,
  type Playlist,
  renamePlaylist,
} from "../../ipc";
import { useLibraryStore } from "../library/store";
import { TRACK_IDS_MIME } from "./drag";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { usePlaylistsStore } from "./store";

vi.mock("../../ipc", () => ({
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  moveInPlaylist: vi.fn(),
  countTracks: vi.fn(async () => 0),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
}));

function playlist(id: number, name: string, trackCount = 0): Playlist {
  return { id, name, kind: "static", trackCount, createdAt: 0 };
}

/** A drag carrying track ids, as the songs table would produce. */
function trackDrag(ids: number[]) {
  return {
    types: [TRACK_IDS_MIME],
    getData: () => JSON.stringify(ids),
    dropEffect: "none",
  };
}

const initialLibrary = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initialLibrary, playlistId: null, total: 0, pages: new Map() });
  usePlaylistsStore.setState({
    ...initialPlaylists,
    playlists: [],
    notice: null,
    error: null,
    renaming: null,
  });
  vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 4), playlist(2, "Focus", 9)]);
});

describe("PlaylistSidebar", () => {
  it("lists the playlists with their track counts", async () => {
    render(<PlaylistSidebar />);

    expect(await screen.findByRole("button", { name: "Evening" })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "Focus" })).toHaveTextContent("9");
  });

  it("says how to start one when there are none", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([]);
    render(<PlaylistSidebar />);

    expect(await screen.findByText(/Drag songs here/)).toBeInTheDocument();
  });

  it("switches the view to the playlist that was clicked", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Focus" }));

    expect(useLibraryStore.getState().playlistId).toBe(2);
  });

  it("adds a dropped selection to the playlist it was dropped on", async () => {
    vi.mocked(addToPlaylist).mockResolvedValue(3);
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Evening" })).closest(
      "li",
    ) as HTMLElement;

    fireEvent.drop(row, { dataTransfer: trackDrag([10, 11, 12]) });

    await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith(1, [10, 11, 12]));
  });

  it("marks the row a drop would land on, and unmarks it on the way out", async () => {
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Evening" })).closest(
      "li",
    ) as HTMLElement;

    fireEvent.dragOver(row, { dataTransfer: trackDrag([10]) });
    expect(row).toHaveClass("drop-target");

    fireEvent.dragLeave(row);
    expect(row).not.toHaveClass("drop-target");
  });

  it("ignores a drag that is not tracks", async () => {
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Evening" })).closest(
      "li",
    ) as HTMLElement;

    // A file dragged in from Explorer, say - phase 15's problem, not this one.
    fireEvent.dragOver(row, { dataTransfer: { types: ["Files"], getData: () => "" } });

    expect(row).not.toHaveClass("drop-target");
  });

  it("renames on double click, committing with Enter", async () => {
    vi.mocked(renamePlaylist).mockResolvedValue(undefined);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.dblClick(await screen.findByRole("button", { name: "Evening" }));
    const field = screen.getByRole("textbox", { name: "Rename playlist Evening" });
    await user.clear(field);
    await user.type(field, "Late Night{Enter}");

    await waitFor(() => expect(renamePlaylist).toHaveBeenCalledWith(1, "Late Night"));
  });

  it("abandons a rename on Escape without writing anything", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.dblClick(await screen.findByRole("button", { name: "Evening" }));
    const field = screen.getByRole("textbox", { name: "Rename playlist Evening" });
    await user.clear(field);
    await user.type(field, "Late Night{Escape}");

    expect(renamePlaylist).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Evening" })).toBeInTheDocument();
  });

  it("does not write a rename that changed nothing", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.dblClick(await screen.findByRole("button", { name: "Evening" }));
    await user.type(screen.getByRole("textbox", { name: "Rename playlist Evening" }), "{Enter}");

    expect(renamePlaylist).not.toHaveBeenCalled();
  });

  it("keeps the old name when a rename is emptied", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.dblClick(await screen.findByRole("button", { name: "Evening" }));
    const field = screen.getByRole("textbox", { name: "Rename playlist Evening" });
    await user.clear(field);
    await user.type(field, "{Enter}");

    // The backend would refuse a blank name anyway; not asking is better than
    // showing the user an error for a keystroke they will fix themselves.
    expect(renamePlaylist).not.toHaveBeenCalled();
  });

  it("offers a visible rename control on the open playlist", async () => {
    vi.mocked(renamePlaylist).mockResolvedValue(undefined);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    // Double-click renames too, but an invisible gesture is not an affordance:
    // this is how the user finds out the action exists at all.
    expect(
      screen.queryByRole("button", { name: "Rename playlist Evening" }),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Evening" }));
    await user.click(await screen.findByRole("button", { name: "Rename playlist Evening" }));

    const field = screen.getByRole("textbox", { name: "Rename playlist Evening" });
    await user.clear(field);
    await user.type(field, "Late Night{Enter}");

    await waitFor(() => expect(renamePlaylist).toHaveBeenCalledWith(1, "Late Night"));
  });

  it("renames whichever playlist the store asks it to", async () => {
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    // Creating a playlist starts a rename from outside this component.
    act(() => usePlaylistsStore.getState().startRename(2));

    expect(
      await screen.findByRole("textbox", { name: "Rename playlist Focus" }),
    ).toBeInTheDocument();
  });

  it("offers deletion only on the playlist that is open", async () => {
    vi.mocked(deletePlaylist).mockResolvedValue(undefined);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    expect(
      screen.queryByRole("button", { name: "Delete playlist Evening" }),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Evening" }));
    await user.click(await screen.findByRole("button", { name: "Delete playlist Evening" }));

    expect(deletePlaylist).toHaveBeenCalledWith(1);
  });
});
