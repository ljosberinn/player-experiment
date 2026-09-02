import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  loadSidebarSections,
  type Playlist,
  renamePlaylist,
} from "../../ipc";
import { useLibraryStore } from "../library/store";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { usePlaylistsStore } from "./store";
import { pressTrackRow } from "./trackDrag";

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  moveInPlaylist: vi.fn(),
  loadSidebarSections: vi.fn(async () => null),
  saveSidebarSections: vi.fn(async () => undefined),
  onLibraryChanged: vi.fn(async () => () => {}),
  countTracks: vi.fn(async () => 0),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
}));

function playlist(id: number, name: string, trackCount = 0): Playlist {
  return { id, name, kind: "static", trackCount, createdAt: 0 };
}

function smart(id: number, name: string, trackCount = 0): Playlist {
  return { id, name, kind: "smart", trackCount, createdAt: 0 };
}

/**
 * Starts a real drag, the way a song row does.
 *
 * There is no payload left to fabricate: the session is module state that only
 * a press can fill. The source is a stand-in rather than a rendered
 * `SongTable` - the table-to-sidebar path is covered end to end in
 * `App.test.tsx`, and mounting one here would be a virtualizer, a library and
 * an opener plugin in a spec about a sidebar.
 */
function startDrag(ids: number[]) {
  pressTrackRow({ clientX: 0, clientY: 0 }, () => ids);
  fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });
}

// The drag session outlives a render, so a spec that leaves the pointer down
// leaves it down for the next one.
afterEach(() => fireEvent.pointerUp(window));

const initialLibrary = useLibraryStore.getState();
const initialPlaylists = usePlaylistsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ ...initialLibrary, playlistId: null, total: 0, pages: new Map() });
  usePlaylistsStore.setState({
    ...initialPlaylists,
    playlists: [],
    renaming: null,
    collapsed: {},
  });
  vi.mocked(listPlaylists).mockResolvedValue([playlist(1, "Evening", 4), playlist(2, "Focus", 9)]);
  // Restated rather than left to the factory: `clearAllMocks` clears calls but
  // keeps implementations, so the one test that stores a folded section was
  // leaking a folded sidebar into every test declared after it.
  vi.mocked(loadSidebarSections).mockResolvedValue(null);
});

describe("PlaylistSidebar", () => {
  it("lists the playlists with their track counts", async () => {
    render(<PlaylistSidebar />);

    expect(await screen.findByRole("button", { name: "Evening" })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "Focus" })).toHaveTextContent("9");
  });

  it("says nothing at all when there are none", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([]);
    render(<PlaylistSidebar />);

    // The section keeps its heading and its +; the instruction under it is
    // what went, so an empty Playlists section renders no list and no prose.
    expect(await screen.findByRole("button", { name: "New playlist" })).toBeInTheDocument();
    expect(screen.queryByText(/Drag songs here/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Playlists" })).not.toBeInTheDocument();
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

    startDrag([10, 11, 12]);
    fireEvent.pointerUp(row);

    await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith(1, [10, 11, 12]));
  });

  it("marks the row a drop would land on, and unmarks it on the way out", async () => {
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Evening" })).closest(
      "li",
    ) as HTMLElement;

    startDrag([10]);
    fireEvent.pointerMove(row);
    expect(row).toHaveClass("drop-target");

    fireEvent.pointerLeave(row);
    expect(row).not.toHaveClass("drop-target");
  });

  it("unmarks the row when the drag is abandoned under it", async () => {
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Evening" })).closest(
      "li",
    ) as HTMLElement;

    startDrag([10]);
    fireEvent.pointerMove(row);
    fireEvent.keyDown(window, { key: "Escape" });

    // Escape leaves the pointer where it is, so no `pointerleave` follows to
    // take the highlight off.
    await waitFor(() => expect(row).not.toHaveClass("drop-target"));
  });

  it("ignores a pointer that is not dragging anything", async () => {
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Evening" })).closest(
      "li",
    ) as HTMLElement;

    // Moving the mouse over a playlist is not a drag, and a click on one is a
    // navigation - neither may light the row up as a drop target.
    fireEvent.pointerMove(row);
    fireEvent.pointerUp(row);

    expect(row).not.toHaveClass("drop-target");
    expect(addToPlaylist).not.toHaveBeenCalled();
  });

  it("refuses a drop on a smart playlist, whose contents are its filter", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([smart(3, "Recent", 7)]);
    render(<PlaylistSidebar />);
    const row = (await screen.findByRole("button", { name: "Recent" })).closest(
      "li",
    ) as HTMLElement;

    startDrag([10]);
    fireEvent.pointerMove(row);
    expect(row).not.toHaveClass("drop-target");

    fireEvent.pointerUp(row);
    expect(addToPlaylist).not.toHaveBeenCalled();
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
    //
    // Awaited rather than asserted outright: the menu returns focus to its
    // trigger as it unmounts, which lands after the dialog has taken focus, so
    // the dialog claims it again on the next frame. Without that the sidebar
    // row would be focused behind an open dialog and Enter would reopen the
    // very menu that asked the question.
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
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

    startDrag([10, 11]);
    fireEvent.pointerUp(screen.getByTestId("playlist-dropzone"));

    await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith(9, [10, 11]));
    // The songs land first, so the rename that follows is over a playlist that
    // already holds something.
    expect(createPlaylist).toHaveBeenCalledWith("New Playlist");
    await waitFor(() => expect(usePlaylistsStore.getState().renaming).toBe(9));
  });

  it("starts no playlist from a release that was never a drag", async () => {
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    fireEvent.pointerUp(screen.getByTestId("playlist-dropzone"));

    // Clicking the empty space below the list is not a gesture that means
    // anything, and it must not leave an empty playlist behind.
    expect(createPlaylist).not.toHaveBeenCalled();
  });
});

describe("folding the sidebar sections", () => {
  it("keeps smart and static playlists in sections of their own", async () => {
    // One heading with two buttons on it - a + that made a playlist and a gear
    // that made a smart one - is what this replaced. Nothing but the icon said
    // which was which.
    vi.mocked(listPlaylists).mockResolvedValue([
      playlist(1, "Evening", 4),
      smart(2, "Recently Added", 100),
    ]);
    render(<PlaylistSidebar />);

    const smartList = await screen.findByRole("list", { name: "Smart Playlists" });
    const staticList = screen.getByRole("list", { name: "Playlists" });

    expect(within(smartList).getByRole("button", { name: "Recently Added" })).toBeInTheDocument();
    expect(within(smartList).queryByRole("button", { name: "Evening" })).not.toBeInTheDocument();
    expect(within(staticList).getByRole("button", { name: "Evening" })).toBeInTheDocument();
  });

  it("hides a section's contents when its heading is pressed", async () => {
    const user = userEvent.setup();
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    const fold = screen.getByRole("button", { name: /^Playlists/ });
    expect(fold).toHaveAttribute("aria-expanded", "true");

    await user.click(fold);

    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Evening" })).not.toBeInTheDocument();
  });

  it("takes the drop target with it when it folds", async () => {
    // A hidden drop target is a thing a drag can still find and a keyboard
    // cannot, which is why the section unmounts rather than hides.
    const user = userEvent.setup();
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    await user.click(screen.getByRole("button", { name: /^Playlists/ }));

    expect(screen.queryByTestId("playlist-dropzone")).not.toBeInTheDocument();
  });

  it("opens a section that was stored folded", async () => {
    // Through the stored value rather than by setting the store directly: the
    // sidebar reads its arrangement on mount, so a hand-set state would be
    // overwritten a tick later - which is the whole path being tested.
    vi.mocked(loadSidebarSections).mockResolvedValue('{"playlists":true}');
    const user = userEvent.setup();
    render(<PlaylistSidebar />);

    const fold = await screen.findByRole("button", { name: /^Playlists/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Evening" })).not.toBeInTheDocument();

    await user.click(fold);

    expect(await screen.findByRole("button", { name: "Evening" })).toBeInTheDocument();
  });

  it("folds one section without touching the other", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([
      playlist(1, "Evening", 4),
      smart(2, "Recently Added", 100),
    ]);
    const user = userEvent.setup();
    render(<PlaylistSidebar />);
    await screen.findByRole("button", { name: "Evening" });

    await user.click(screen.getByRole("button", { name: /^Smart Playlists/ }));

    expect(screen.queryByRole("button", { name: "Recently Added" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Evening" })).toBeInTheDocument();
  });

  it("shows how many songs each playlist holds", async () => {
    vi.mocked(listPlaylists).mockResolvedValue([
      playlist(1, "Evening", 4),
      smart(2, "Recently Added", 100),
    ]);
    render(<PlaylistSidebar />);

    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});
