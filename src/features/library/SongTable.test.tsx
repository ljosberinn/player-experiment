import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackQuery } from "../../ipc";
import { countTracks, queryTracks } from "../../ipc";
import { columnsFor } from "./columns";
import { SongTable } from "./SongTable";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(),
}));

const countTracksMock = vi.mocked(countTracks);
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
  countTracksMock.mockResolvedValue(500);
  queryTracksMock.mockImplementation(async (query: TrackQuery) =>
    Array.from({ length: query.limit }, (_, i) => track(query.offset + i)),
  );
});

async function renderTable() {
  await useLibraryStore.getState().refresh();
  render(<SongTable columns={columns} />);
  await waitFor(() => expect(screen.getByText("Track 0")).toBeInTheDocument());
}

describe("SongTable", () => {
  it("renders a header cell per column with the sort state exposed", async () => {
    await renderTable();

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent?.replace(/[▲▼]/g, ""))).toEqual([
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
    expect(countTracksMock).toHaveBeenLastCalledWith(
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
});
