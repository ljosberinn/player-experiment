import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SortField, Track, TrackQuery } from "../../ipc";
import { libraryStats, queryTracks } from "../../ipc";
import { ALL_COLUMNS } from "./columns";
import { SongTable } from "./SongTable";
import { useLibraryStore } from "./store";

/**
 * How much of the table wakes up for a click or a scroll.
 *
 * A count, not a clock: the numbers below are exact where a wall-clock budget
 * on a CI runner would be noise, and they are floors rather than budgets - the
 * point is that they only ever go down, and never silently.
 *
 * Counted as `ColumnDef.render` calls, because that is one call per cell and
 * so measures the leaves rather than the wrapper. Before rows were their own
 * component the table built them as inline JSX, and with `"use no memo"`
 * forced on it by the virtualizer none of that was cached: a click cost 235
 * cell renders and a six-row scroll cost 3265.
 */

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
  queryTracks: vi.fn(),
  allTrackIds: vi.fn(async () => []),
  revealTrack: vi.fn(async () => undefined),
  listPlaylists: vi.fn(async () => []),
  addToPlaylist: vi.fn(async () => 1),
  tracksByIds: vi.fn(async () => []),
  canUndoTagEdit: vi.fn(async () => false),
}));

/** The five columns the table opens with, so the arithmetic below is the real one. */
const COLUMN_IDS: SortField[] = ["title", "durationMs", "artist", "album", "genre"];
const ROWS = 500;
/** Tall enough that the window plus overscan is the ~47 rows the issue measured. */
const BODY_HEIGHT = 900;
const ROW_HEIGHT = 26;
/** The window plus overscan at `BODY_HEIGHT`, which is what the counts are per. */
const WINDOW_ROWS = 47;

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

const initial = useLibraryStore.getState();
let cellRenders = 0;

// jsdom gives every element zero height, so the virtualizer would render no
// rows. Pin a real viewport size for the scroll container.
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: BODY_HEIGHT,
    width: 800,
    top: 0,
    left: 0,
    bottom: BODY_HEIGHT,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: BODY_HEIGHT,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLayout();
  cellRenders = 0;
  // The count has to come from the columns the table actually renders, which
  // it resolves out of `ALL_COLUMNS` by id rather than taking as a prop.
  for (const column of ALL_COLUMNS) {
    const original = column.render;
    vi.spyOn(column, "render").mockImplementation((one: Track) => {
      cellRenders += 1;
      return original(one);
    });
  }
  useLibraryStore.setState({
    ...initial,
    columns: { ids: COLUMN_IDS, widths: {} },
    fittedWidths: {},
    fitPending: false,
    total: 0,
    pages: new Map(),
    inFlight: new Set(),
    selection: { ids: new Set(), anchorIndex: null },
  });
  vi.mocked(libraryStats).mockResolvedValue({
    tracks: ROWS,
    durationMs: 0,
    bytes: 0,
    missing: 0,
  });
  vi.mocked(queryTracks).mockImplementation(async (query: TrackQuery) =>
    Array.from({ length: query.limit }, (_, i) => track(query.offset + i)),
  );
});

/** Renders the table with every page landed, and hands back the scroll container. */
async function settled(): Promise<HTMLElement> {
  render(<SongTable />);
  await act(async () => {
    await useLibraryStore.getState().refresh();
  });
  const scroll = screen.getByTestId("song-scroll");
  await waitFor(() => expect(document.querySelectorAll("tr.song-row").length).toBe(WINDOW_ROWS));
  return scroll;
}

describe("what a click costs", () => {
  it("touches no cell at all", async () => {
    await settled();
    const rows = document.querySelectorAll<HTMLTableRowElement>("tr.song-row");
    // The window the numbers below are against: the same 47 rows the issue
    // measured, so a change in either is a change in the comparison.
    expect(rows.length).toBe(WINDOW_ROWS);

    // Two rows change - the one gaining the selection and the one losing it -
    // and both re-render. Their cells do not: `track` and `columns` are
    // unchanged, so the compiler hands back the cached cell array.
    fireEvent.click(rows[2] as HTMLElement);
    cellRenders = 0;
    fireEvent.click(rows[5] as HTMLElement);

    expect(cellRenders).toBe(0);
  });

  it("touches no cell for a shift-range either", async () => {
    await settled();
    const rows = document.querySelectorAll<HTMLTableRowElement>("tr.song-row");

    fireEvent.click(rows[2] as HTMLElement);
    fireEvent.click(rows[4] as HTMLElement, { shiftKey: true });
    cellRenders = 0;
    fireEvent.click(rows[5] as HTMLElement, { shiftKey: true });

    expect(cellRenders).toBe(0);
  });
});

describe("what a scroll costs", () => {
  it("touches nothing while the window has not moved", async () => {
    const scroll = await settled();
    cellRenders = 0;

    // A pixel, so no row enters or leaves: the body re-renders and every row's
    // props are still equal.
    scroll.scrollTop = 1;
    fireEvent.scroll(scroll);

    expect(cellRenders).toBe(0);
  });

  it("renders the rows that came into the window and nothing else", async () => {
    const scroll = await settled();
    cellRenders = 0;

    const crossed = 6;
    scroll.scrollTop = crossed * ROW_HEIGHT;
    fireEvent.scroll(scroll);

    // Exactly the six that arrived. The forty-one that stayed keep their
    // cached cells; before the split this was 3265, which is the whole body
    // roughly twice per row crossed.
    expect(cellRenders).toBe(crossed * COLUMN_IDS.length);
  });
});
