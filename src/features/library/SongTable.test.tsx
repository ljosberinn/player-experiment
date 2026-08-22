import { openUrl } from "@tauri-apps/plugin-opener";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackQuery } from "../../ipc";
import { addToPlaylist, libraryStats, queryTracks, revealTrack } from "../../ipc";
import { readTrackIds, TRACK_IDS_MIME } from "../playlists/drag";
import { usePlaylistsStore } from "../playlists/store";
import { columnsFor } from "./columns";
import { SongTable } from "./SongTable";
import { useLibraryStore } from "./store";

// The row menu's lookup entries hand a URL to the opener plugin, which without
// this reaches for a Tauri runtime that is not there.
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(async () => []),
  // Reached through the row menu, via the playlists and editor stores.
  revealTrack: vi.fn(async () => undefined),
  listPlaylists: vi.fn(async () => []),
  addToPlaylist: vi.fn(async () => 1),
  tracksByIds: vi.fn(async () => []),
  canUndoTagEdit: vi.fn(async () => false),
}));

const statsMock = vi.mocked(libraryStats);
/** A `LibraryStats` with the count set; the footer's other totals are not what
    these tests are about. */
function stats(tracks: number) {
  return { tracks, durationMs: tracks * 200_000, bytes: tracks * 5_000_000, missing: 0 };
}

const queryTracksMock = vi.mocked(queryTracks);

function track(id: number): Track {
  return {
    id,
    path: `/m/${id}.mp3`,
    duration_ms: 208_000,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    album: "Tokyo",
    album_artist: null,
    genre: "Shoegaze",
    year: 2012,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
  };
}

const columns = columnsFor(["title", "durationMs", "artist"]);
const initial = useLibraryStore.getState();

// jsdom gives every element zero height, so the virtualizer would render no
// rows. Pin a real viewport size for the scroll container.
function stubLayout(height = 400) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height,
    width: 800,
    top: 0,
    left: 0,
    bottom: height,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: height,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLayout();
  useLibraryStore.setState({
    ...initial,
    total: 0,
    pages: new Map(),
    inFlight: new Set(),
    search: "",
    sortBy: "artist",
    direction: "asc",
    selection: { ids: new Set(), anchorIndex: null },
    error: null,
  });
  statsMock.mockResolvedValue(stats(500));
  queryTracksMock.mockImplementation(async (query: TrackQuery) =>
    Array.from({ length: query.limit }, (_, i) => track(query.offset + i)),
  );
});

/** A writable stand-in for `DataTransfer`, which jsdom does not provide. */
function dragData() {
  const store = new Map<string, string>();
  return {
    setData: (format: string, data: string) => void store.set(format, data),
    getData: (format: string) => store.get(format) ?? "",
    get types() {
      return [...store.keys()];
    },
    effectAllowed: "none",
    dropEffect: "none",
  };
}

/** An incoming drag already carrying ids, as a drop handler would see it. */
function trackDrag(ids: number[]) {
  return {
    types: [TRACK_IDS_MIME],
    getData: () => JSON.stringify(ids),
    dropEffect: "none",
  };
}

/**
 * Fires a drag event with a pointer position on it.
 *
 * jsdom has no `DragEvent`, so Testing Library builds a plain `Event` and
 * `clientY` from the init is dropped on the floor; it has to be defined on the
 * event itself. Which half of the row was hit is the whole point here.
 */
function fireDrag(type: "dragOver" | "drop", row: HTMLElement, ids: number[], clientY: number) {
  const event = createEvent[type](row, { dataTransfer: trackDrag(ids) });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(row, event);
}

async function renderTable() {
  await useLibraryStore.getState().refresh();
  render(<SongTable columns={columns} />);
  await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());
}

describe("SongTable", () => {
  it("renders a header cell per column with the sort state exposed", async () => {
    await renderTable();

    const headers = screen.getAllByRole("columnheader");
    // "Status" first: the fixed, unlabelled column still needs a stated name,
    // or screen readers announce an empty header for every row in the table.
    expect(headers.map((h) => h.textContent?.replace(/[▲▼]/g, ""))).toEqual([
      "Status",
      "Name",
      "Time",
      "Artist",
    ]);
    // aria-sort lives on the header cell; the button inside it is the control.
    expect(screen.getByRole("columnheader", { name: /Artist/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("marks the playing row and the rows whose files are gone", async () => {
    // Through the table rather than the cell alone: the status column is not
    // in `columns`, so nothing else would catch it being dropped from the row.
    queryTracksMock.mockImplementation(async (query: TrackQuery) =>
      Array.from({ length: query.limit }, (_, i) => {
        const id = query.offset + i;
        return id === 3 ? { ...track(id), missing_since: 1_700_000_000 } : track(id);
      }),
    );
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} nowPlayingId={1} />);
    await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());

    expect(screen.getByText("Playing")).toBeInTheDocument();
    expect(screen.getByText("File missing")).toBeInTheDocument();
    // One of each, in a window of rows that are otherwise unremarkable.
    expect(screen.getAllByText("Playing")).toHaveLength(1);
  });

  it("renders only a window of rows, not the whole library", async () => {
    await renderTable();

    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThan(100);
    expect(useLibraryStore.getState().total).toBe(500);
  });

  it("formats durations rather than showing raw milliseconds", async () => {
    await renderTable();

    expect(screen.getAllByText("3:28").length).toBeGreaterThan(0);
  });

  it("re-sorts through the backend when a header is clicked", async () => {
    await renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Name/ }));

    await waitFor(() => {
      expect(useLibraryStore.getState()).toMatchObject({ sortBy: "title", direction: "asc" });
    });
    expect(statsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "title", direction: "asc" }),
    );
  });

  it("flips to descending on a second click of the same header", async () => {
    await renderTable();
    const user = userEvent.setup();
    const header = screen.getByRole("button", { name: /Name/ });

    await user.click(header);
    await user.click(header);

    await waitFor(() => {
      expect(useLibraryStore.getState().direction).toBe("desc");
    });
  });

  it("selects a row on click", async () => {
    await renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByText("Track 1"));

    await waitFor(() => {
      expect([...useLibraryStore.getState().selection.ids]).toEqual([1]);
    });
  });

  it("extends the selection with shift-click", async () => {
    await renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByText("Track 1"));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByText("Track 4"));
    await user.keyboard("{/Shift}");

    await waitFor(() => {
      expect([...useLibraryStore.getState().selection.ids]).toEqual([1, 2, 3, 4]);
    });
  });

  it("toggles individual rows with ctrl-click", async () => {
    await renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByText("Track 1"));
    await user.keyboard("{Control>}");
    await user.click(screen.getByText("Track 3"));
    await user.keyboard("{/Control}");

    await waitFor(() => {
      expect([...useLibraryStore.getState().selection.ids].sort()).toEqual([1, 3]);
    });
  });

  it("marks selected rows so they can be styled", async () => {
    await renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByText("Track 2"));

    await waitFor(() => {
      const row = screen.getByText("Track 2").closest(".song-row");
      expect(row).toHaveClass("selected");
    });
  });

  it("carries the whole selection when one of its rows is dragged", async () => {
    await renderTable();
    const user = userEvent.setup();
    await user.click(screen.getByText("Track 1"));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByText("Track 3"));
    await user.keyboard("{/Shift}");

    const data = dragData();
    fireEvent.dragStart(screen.getByText("Track 2").closest(".song-row") as HTMLElement, {
      dataTransfer: data,
    });

    expect(readTrackIds(data)).toEqual([1, 2, 3]);
  });

  it("dragging a row outside the selection makes it the selection", async () => {
    await renderTable();
    const user = userEvent.setup();
    await user.click(screen.getByText("Track 1"));

    const data = dragData();
    fireEvent.dragStart(screen.getByText("Track 5").closest(".song-row") as HTMLElement, {
      dataTransfer: data,
    });

    // What moves has to be what the pointer grabbed, not what happened to be
    // selected somewhere else in the list.
    expect(readTrackIds(data)).toEqual([5]);
    await waitFor(() => expect([...useLibraryStore.getState().selection.ids]).toEqual([5]));
  });

  it("reorders on a drop, above or below depending on where it landed", async () => {
    const onReorder = vi.fn();
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} onReorder={onReorder} />);
    await waitFor(() => expect(screen.getByText("Track 4")).toBeInTheDocument());
    const row = screen.getByText("Track 4").closest(".song-row") as HTMLElement;

    fireDrag("drop", row, [9], 2);
    expect(onReorder).toHaveBeenLastCalledWith([9], 4);

    fireDrag("drop", row, [9], 20);
    expect(onReorder).toHaveBeenLastCalledWith([9], 5);
  });

  it("shows where a drop would land", async () => {
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} onReorder={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Track 4")).toBeInTheDocument());
    const row = screen.getByText("Track 4").closest(".song-row") as HTMLElement;

    fireDrag("dragOver", row, [9], 2);

    expect(row).toHaveClass("drop-before");
  });

  it("takes no drops at all in a view with no order of its own", async () => {
    await renderTable();
    const row = screen.getByText("Track 4").closest(".song-row") as HTMLElement;

    // No `onReorder`: the library's order is derived from a column sort, so
    // there is nothing a drop could persist.
    fireDrag("dragOver", row, [9], 2);

    expect(row).not.toHaveClass("drop-before");
  });

  it("removes the selection on Delete when the view supports it", async () => {
    const onRemove = vi.fn();
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} onRemove={onRemove} />);
    await waitFor(() => expect(screen.getByText("Track 2")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByText("Track 2"));
    (screen.getByText("Track 2").closest(".song-row") as HTMLElement).focus();
    await user.keyboard("{Delete}");

    expect(onRemove).toHaveBeenCalledWith([2]);
  });

  it("renders placeholder rows for pages that have not arrived", async () => {
    // Never resolve, so every page stays in flight.
    queryTracksMock.mockImplementation(() => new Promise<Track[]>(() => {}));
    await useLibraryStore.getState().refresh();

    const { container } = render(<SongTable columns={columns} />);

    await waitFor(() => {
      expect(container.querySelectorAll(".song-row.placeholder").length).toBeGreaterThan(0);
    });
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("selects with the keyboard as well as the mouse", async () => {
    await renderTable();
    const user = userEvent.setup();
    const row = screen.getByText("Track 1").closest(".song-row") as HTMLElement;

    row.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect([...useLibraryStore.getState().selection.ids]).toEqual([1]);
    });
  });

  it("activates a row on double click, reporting its index not its id", async () => {
    const onActivate = vi.fn();
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} onActivate={onActivate} />);
    await waitFor(() => expect(screen.getByText("Track 3")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.dblClick(screen.getByText("Track 3").closest(".song-row") as HTMLElement);

    expect(onActivate).toHaveBeenCalledWith(3);
  });

  it("activates a row with Enter, so the keyboard reaches playback too", async () => {
    const onActivate = vi.fn();
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} onActivate={onActivate} />);
    await waitFor(() => expect(screen.getByText("Track 2")).toBeInTheDocument());

    const user = userEvent.setup();
    (screen.getByText("Track 2").closest(".song-row") as HTMLElement).focus();
    await user.keyboard("{Enter}");

    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it("leaves space alone so it reaches the global play/pause shortcut", async () => {
    const onActivate = vi.fn();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    await useLibraryStore.getState().refresh();
    render(<SongTable columns={columns} onActivate={onActivate} />);
    await waitFor(() => expect(screen.getByText("Track 1")).toBeInTheDocument());

    const user = userEvent.setup();
    (screen.getByText("Track 1").closest(".song-row") as HTMLElement).focus();
    await user.keyboard(" ");

    expect(onActivate).not.toHaveBeenCalled();
    expect(onWindowKeyDown).toHaveBeenCalled();
    expect(onWindowKeyDown.mock.calls.at(-1)?.[0].defaultPrevented).toBe(false);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("marks the row that is playing", async () => {
    await useLibraryStore.getState().refresh();
    const { container } = render(<SongTable columns={columns} nowPlayingId={4} />);
    await waitFor(() => expect(screen.getByText("Track 4")).toBeInTheDocument());

    const playing = container.querySelectorAll(".song-row.playing");
    expect(playing).toHaveLength(1);
    expect(playing[0]).toHaveTextContent("Track 4");
  });

  it("refetches after a re-sort, even though the row count has not changed", async () => {
    // Regression: the fetch effect keyed only on the visible range and the
    // total, both unchanged by a sort. Every cached page had been dropped, so
    // the table sat on placeholder rows until something else moved.
    await renderTable();
    queryTracksMock.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Name/ }));

    await waitFor(() => {
      expect(queryTracksMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: "title" }));
    });
    await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());
  });

  it("refetches when a search resolves to the same row count", async () => {
    // The other half of the same regression: searching and clearing back to an
    // identical total left the view stuck on placeholders.
    const { container } = render(<SongTable columns={columns} />);
    await useLibraryStore.getState().refresh();
    await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());

    useLibraryStore.getState().setSearch("track");
    await useLibraryStore.getState().commitSearch();
    await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());

    await useLibraryStore.getState().clearSearch();

    await waitFor(() => {
      expect(container.querySelectorAll(".song-row.placeholder")).toHaveLength(0);
    });
  });

  describe("the row menu", () => {
    /** Renders a loaded table and right-clicks the first row. */
    async function openRowMenu(props: Partial<Parameters<typeof SongTable>[0]> = {}) {
      const user = userEvent.setup();
      render(<SongTable columns={columns} {...props} />);
      await useLibraryStore.getState().refresh();
      await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());
      await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Track 0") });
      return user;
    }

    it("opens on right-click and names itself", async () => {
      await openRowMenu();

      expect(await screen.findByRole("menu", { name: "Song actions" })).toBeInTheDocument();
    });

    it("selects the row it was opened on when that row was not selected", async () => {
      await openRowMenu();

      // Otherwise the menu would act on rows scrolled off elsewhere, which is
      // not what the pointer was aimed at.
      expect([...useLibraryStore.getState().selection.ids]).toEqual([0]);
    });

    it("keeps a multi-selection when right-clicking inside it", async () => {
      const user = userEvent.setup();
      render(<SongTable columns={columns} />);
      await useLibraryStore.getState().refresh();
      await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());

      await user.click(screen.getByText("Track 0"));
      await user.keyboard("{Shift>}");
      await user.click(screen.getByText("Track 2"));
      await user.keyboard("{/Shift}");
      const before = [...useLibraryStore.getState().selection.ids];
      await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Track 1") });

      expect([...useLibraryStore.getState().selection.ids]).toEqual(before);
      expect(await screen.findByRole("menuitem", { name: /Edit 3 Songs/ })).toBeInTheDocument();
    });

    it("plays the row it was opened on", async () => {
      const onActivate = vi.fn();
      const user = await openRowMenu({ onActivate });

      await user.click(await screen.findByRole("menuitem", { name: "Play" }));

      expect(onActivate).toHaveBeenCalledWith(0);
    });

    it("adds to the playlist picked from the submenu", async () => {
      usePlaylistsStore.setState({
        playlists: [{ id: 5, name: "Evening", kind: "static", trackCount: 0, createdAt: 0 }],
      });
      const user = await openRowMenu();

      // Keyboard, deliberately: Base UI keeps a closed submenu's positioner
      // inert, and jsdom reports every rect as zero, so the pointer route to a
      // submenu cannot be driven here at all. ArrowRight is the route that can
      // be, and the e2e suite is where the pointer one is real.
      // Play, Edit, Add to Playlist - separators are not stops.
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}");
      await user.click(await screen.findByRole("menuitem", { name: "Evening" }));

      // The first keyboard-and-menu route to a playlist; dragging is mouse-only.
      await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith(5, [0]));
    });

    it("reveals a single song on disk", async () => {
      const user = await openRowMenu();

      await user.click(await screen.findByRole("menuitem", { name: "Show in Explorer" }));

      await waitFor(() => expect(revealTrack).toHaveBeenCalledWith(0));
    });

    it("exports what the menu was opened on", async () => {
      const onExport = vi.fn();
      const user = await openRowMenu({ onExport });

      await user.click(await screen.findByRole("menuitem", { name: "Export 1 Song…" }));

      expect(onExport).toHaveBeenCalledWith([0]);
    });

    it("looks the row's artist up on the web", async () => {
      const user = await openRowMenu();

      // The keyboard route again, for the reason the playlist submenu takes
      // it. Play, Edit, Add to Playlist, Export, Show in Explorer, then the
      // lookups - separators are not stops.
      await user.keyboard(
        "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}",
      );
      await user.click(await screen.findByRole("menuitem", { name: "Last.fm" }));

      // The row's own artist, which is what proves the menu was handed the row
      // under the pointer rather than the selection it happens to share.
      await waitFor(() =>
        expect(openUrl).toHaveBeenCalledWith("https://www.last.fm/music/Artist%200"),
      );
    });

    it("does not open on a row whose page has not arrived", async () => {
      const user = userEvent.setup();
      // Held pending, so the rows stay placeholders instead of filling in
      // before the assertion - which is what made an earlier version of this
      // test pass by finding nothing to right-click.
      queryTracksMock.mockImplementation(() => new Promise(() => {}));
      const { container } = render(<SongTable columns={columns} />);
      await useLibraryStore.getState().refresh();

      const placeholder = await waitFor(() => {
        const row = container.querySelector(".song-row.placeholder");
        expect(row).not.toBeNull();
        return row as Element;
      });
      await user.pointer({ keys: "[MouseRight]", target: placeholder });

      // There is no song there yet, so there is nothing for a menu to act on.
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("the keyboard routes", () => {
    /** Renders a loaded table with `ids` selected and `anchorIndex` set. */
    async function withSelection(
      ids: number[],
      props: Partial<Parameters<typeof SongTable>[0]> = {},
    ) {
      render(<SongTable columns={columns} {...props} />);
      await useLibraryStore.getState().refresh();
      await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());
      useLibraryStore.setState({
        selection: { ids: new Set(ids), anchorIndex: ids[0] ?? null },
      });
    }

    it("opens the row menu on the selection without a pointer", async () => {
      await withSelection([1]);

      // The Menu key, from wherever focus happens to be - Ctrl+A and a click
      // in the sidebar both leave it off the table.
      fireEvent.keyDown(window, { key: "ContextMenu" });

      expect(await screen.findByRole("menu", { name: "Song actions" })).toBeInTheDocument();
    });

    it("opens it on Shift+F10 too, for keyboards with no Menu key", async () => {
      await withSelection([1]);

      fireEvent.keyDown(window, { key: "F10", shiftKey: true });

      expect(await screen.findByRole("menu", { name: "Song actions" })).toBeInTheDocument();
    });

    it("acts on the whole selection, not just the row it opened on", async () => {
      await withSelection([1, 2, 3]);

      fireEvent.keyDown(window, { key: "ContextMenu" });

      expect(await screen.findByRole("menuitem", { name: /Edit 3 Songs/ })).toBeInTheDocument();
    });

    it("has no menu to open with nothing selected", async () => {
      await withSelection([]);

      fireEvent.keyDown(window, { key: "ContextMenu" });

      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });

    it("nudges the selection up and down inside a playlist", async () => {
      const onReorder = vi.fn();
      await withSelection([1], { onReorder });

      fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
      expect(onReorder).toHaveBeenLastCalledWith([1], 0);

      // Not 2: the index is read against the list including the moved row, so
      // `last + 1` is where it already is.
      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
      expect(onReorder).toHaveBeenLastCalledWith([1], 3);
    });

    it("moves a contiguous block as one", async () => {
      const onReorder = vi.fn();
      await withSelection([2, 3], { onReorder });

      fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });

      expect(onReorder).toHaveBeenLastCalledWith([2, 3], 1);
    });

    /**
     * The page cache as it looks once a nudge down has come back: the row the
     * block passed is now in front of it. `moveTracks` refreshes rather than
     * patching, but the effect on the cache is this.
     */
    function asIfTheMoveLanded(ids: number[]) {
      const pages = new Map(useLibraryStore.getState().pages);
      const rows = [...(pages.get(0) as Track[])];
      const first = rows.findIndex((row) => row.id === ids[0]);
      const [passed] = rows.splice(first + ids.length, 1);
      rows.splice(first, 0, passed as Track);
      pages.set(0, rows);
      useLibraryStore.setState({ pages });
    }

    it("held down, keeps asking for the same place until the view catches up", async () => {
      const onReorder = vi.fn();
      await withSelection([2, 3], { onReorder });

      // Key repeat: several keydowns land before the first move's refresh
      // does, so the cache still shows the block where it started.
      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });

      // The same insertion index each time, which resolves to where the block
      // already is. A handler that counted its own presses instead would ask
      // for 5, 7 and 9 and fling the block three places for one that landed.
      expect(onReorder.mock.calls).toEqual([
        [[2, 3], 5],
        [[2, 3], 5],
        [[2, 3], 5],
      ]);
      // And the rows that moved are still the selected ones, so the next
      // repeat acts on them rather than on whatever took their old index.
      expect([...useLibraryStore.getState().selection.ids]).toEqual([2, 3]);
    });

    it("walks one place further for each repeat the view does catch up with", async () => {
      const onReorder = vi.fn();
      await withSelection([2, 3], { onReorder });

      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });
      expect(onReorder).toHaveBeenLastCalledWith([2, 3], 5);

      asIfTheMoveLanded([2, 3]);
      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });

      expect(onReorder).toHaveBeenLastCalledWith([2, 3], 6);
    });

    it("refuses to nudge a scattered selection", async () => {
      const onReorder = vi.fn();
      await withSelection([1, 3], { onReorder });

      // The backend would gather them into one block, which a drag shows you
      // beforehand and a nudge does not.
      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });

      expect(onReorder).not.toHaveBeenCalled();
    });

    it("does not nudge in a view with no order of its own", async () => {
      const onReorder = vi.fn();
      // No `onReorder`, the same condition a drop already checks.
      await withSelection([1]);

      fireEvent.keyDown(window, { key: "ArrowDown", altKey: true });

      expect(onReorder).not.toHaveBeenCalled();
    });

    it("leaves a bare arrow alone, because that is the player's volume", async () => {
      const onReorder = vi.fn();
      await withSelection([1], { onReorder });

      fireEvent.keyDown(window, { key: "ArrowDown" });

      expect(onReorder).not.toHaveBeenCalled();
    });
  });
});
