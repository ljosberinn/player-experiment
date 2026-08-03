import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  createPlaylist,
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
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0 })),
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

  it("renames from the right-click menu", async () => {
    vi.mocked(renamePlaylist).mockResolvedValue(undefined);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    // Double-click renames too, but an invisible gesture is not an affordance.
    // The stopgap ✎ button that used to say so is gone: right-click is where a
    // desktop user looks for this, and it works on any playlist rather than
    // only the one that happens to be open.
    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

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

  it("deletes from the right-click menu, once confirmed", async () => {
    vi.mocked(deletePlaylist).mockResolvedValue(undefined);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // Nothing is gone yet: deleting a playlist cannot be undone.
    expect(deletePlaylist).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(deletePlaylist).toHaveBeenCalledWith(1);
  });

  it("keeps the playlist when the confirmation is cancelled", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deletePlaylist).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Evening" })).toBeInTheDocument();
  });

  it("abandons the confirmation on Escape", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deletePlaylist).not.toHaveBeenCalled();
  });

  it("says the songs are safe, because that is the actual worry", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "The 4 songs in it stay in your library",
    );
  });

  it("puts focus on Cancel rather than on Delete", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // A reflex Enter on an unexpected dialog must not destroy anything.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("acts on the playlist that was right-clicked without opening it", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Focus" }),
    });

    // This used to select the playlist first, so the highlight said which one
    // Delete was about to remove. With each row its own menu trigger there is
    // no question to answer - and no reason to change what the table is
    // showing because somebody right-clicked something in the sidebar.
    expect(useLibraryStore.getState().playlistId).toBeNull();
    expect(await screen.findByRole("menu", { name: "Focus actions" })).toBeInTheDocument();
  });

  it("offers neither Play nor Export on an empty playlist", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 0)]);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });

    // Disabled rather than absent: the actions exist, this playlist just has
    // nothing for them to act on yet. `aria-disabled` because a menu item is a
    // div with a role rather than a <button disabled>.
    expect(await screen.findByRole("menuitem", { name: "Play" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Export…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("names the menu after the playlist it will act on", async () => {
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    // Right-clicking does not select, so the menu is the only thing saying
    // which playlist Delete is about to remove.
    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Focus" }),
    });

    expect(await screen.findByRole("menu", { name: "Focus actions" })).toBeInTheDocument();
  });

  it("offers Edit Filter on a smart playlist only", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([
      playlist(1, "Evening", 4),
      { id: 3, name: "Recent", kind: "smart", trackCount: 7, createdAt: 0 },
    ]);
    render(<PlaylistSidebar />);
    const user = userEvent.setup();

    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: "Evening" }),
    });
    expect(screen.queryByRole("menuitem", { name: "Edit Filter…" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Recent" }),
    });

    // A static playlist has no filter to edit, so the entry is absent rather
    // than present and greyed - there is nothing there to enable.
    expect(await screen.findByRole("menuitem", { name: "Edit Filter…" })).toBeInTheDocument();
  });

  it("starts a playlist from songs dropped on the empty space below the list", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(playlist(9, "New Playlist"));
    vi.mocked(addToPlaylist).mockResolvedValue(2);
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    fireEvent.drop(screen.getByTestId("playlist-dropzone"), {
      dataTransfer: trackDrag([10, 11]),
    });

    await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith(9, [10, 11]));
    // The songs land first, so the rename that follows is over a playlist that
    // already holds something.
    expect(createPlaylist).toHaveBeenCalledWith("New Playlist");
    await waitFor(() => expect(usePlaylistsStore.getState().renaming).toBe(9));
  });

  it("ignores an empty drop on the new-playlist zone", async () => {
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    fireEvent.drop(screen.getByTestId("playlist-dropzone"), {
      dataTransfer: { types: [], getData: () => "" },
    });

    // A drag that carried nothing should not leave an empty playlist behind.
    expect(createPlaylist).not.toHaveBeenCalled();
  });
});
