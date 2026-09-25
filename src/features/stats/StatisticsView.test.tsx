import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadStatsFilters,
  saveStatsFilters,
  statsLibraryTotals,
  statsListenTotals,
} from "../../ipc";
import { choose, showing } from "../../test/select";
import { historyAt } from "../library/history";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { forgetListenTotals } from "./listenTotals";
import { statsRoot } from "./path";
import { StatisticsView } from "./StatisticsView";
import { periodLabel } from "./series";
import { useStatsStore } from "./store";

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  onLibraryChanged: vi.fn(async () => () => {}),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0, removed: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
  removeMissingTracks: vi.fn(async () => 0),
  removeTracks: vi.fn(async () => 0),
  forgetRemovedTracks: vi.fn(async () => 0),
  listPlaylists: vi.fn(async () => []),
  loadSidebarSections: vi.fn(async () => null),
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
  statsListenTotals: vi.fn(async () => ({
    plays: 7863,
    artists: 412,
    albums: 900,
    tracks: 3100,
    days: 640,
    durationMs: 1_800_000_000,
    owned: 4000,
    withGenre: 3500,
    timed: 4000,
    dated: 7863,
    firstAt: 1_400_000_000,
    lastAt: 1_700_000_000,
  })),
  statsTop: vi.fn(async () => []),
  statsPlaysOverTime: vi.fn(async () => []),
  statsFirsts: vi.fn(async () => []),
  statsNewArtists: vi.fn(async () => []),
  statsWeekClock: vi.fn(async () => Array.from({ length: 168 }, () => 0)),
  statsRecentPlays: vi.fn(async () => []),
  statsStreaks: vi.fn(async () => ({
    current: 0,
    longest: 0,
    longestFrom: null,
    longestTo: null,
  })),
  statsLibraryTotals: vi.fn(async () => ({
    tracks: 150_000,
    artists: 8_000,
    albums: 12_000,
    durationMs: 900_000_000,
    bytes: 750_000_000_000,
    missing: 3,
  })),
  statsHistogram: vi.fn(async () => []),
  statsWorstByBitrate: vi.fn(async () => []),
  statsTagHealth: vi.fn(async () => ({
    tracks: 0,
    title: 0,
    artist: 0,
    album: 0,
    albumArtist: 0,
    genre: 0,
    year: 0,
    trackNo: 0,
    cover: 0,
  })),
  statsGenreBreakdown: vi.fn(async () => ({ slices: [], own: 0, untagged: 0 })),
}));

/** Formatted the way the tiles format it, so the assertion holds in any locale. */
const shown = (value: number) => value.toLocaleString();

const listenMock = vi.mocked(statsListenTotals);
const libraryMock = vi.mocked(statsLibraryTotals);
const loadMock = vi.mocked(loadStatsFilters);
const saveMock = vi.mocked(saveStatsFilters);

beforeEach(() => {
  vi.clearAllMocks();
  forgetListenTotals();
  loadMock.mockResolvedValue(null);
  useStatsStore.setState({ filters: DEFAULT_FILTERS });
  useLibraryStore.setState({
    tab: "stats",
    statsPath: statsRoot("listening"),
    // Seeded as if the sidebar had opened the view, so back has the tab it
    // came from behind it rather than the songs table the store opens on.
    history: historyAt({
      tab: "stats",
      browse: null,
      browseLabel: null,
      playlistId: null,
      stats: statsRoot("listening"),
    }),
  });
});

describe("StatisticsView", () => {
  it("opens on Listening and draws its tiles", async () => {
    render(<StatisticsView />);

    expect(await screen.findByText(shown(7863))).toBeInTheDocument();
    expect(screen.getByText("Plays")).toBeInTheDocument();
    // The tab nobody is looking at does not query.
    expect(libraryMock).not.toHaveBeenCalled();
  });

  it("switches tabs through the history, so back walks out of one", async () => {
    const user = userEvent.setup();
    render(<StatisticsView />);

    await user.click(screen.getByRole("tab", { name: "Library" }));

    expect(await screen.findByText(shown(150_000))).toBeInTheDocument();
    expect(useLibraryStore.getState().statsPath).toEqual({ tab: "library", crumbs: [] });

    await act(() => useLibraryStore.getState().back());
    expect(useLibraryStore.getState().statsPath).toEqual({ tab: "listening", crumbs: [] });
  });

  it("filters On this day by Owned and Loved alone, since the day is its range", async () => {
    const user = userEvent.setup();
    useStatsStore.setState({ filters: { ...DEFAULT_FILTERS, range: "days7" } });
    render(<StatisticsView />);

    await user.click(screen.getByRole("tab", { name: "On this day" }));

    expect(await screen.findByRole("combobox", { name: "Owned" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Loved" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Range" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Clear / })).not.toBeInTheDocument();
  });

  it("re-asks for the tiles when the range changes, and stores the range", async () => {
    render(<StatisticsView />);
    await screen.findByText(shown(7863));

    await choose("Range", "This year");

    await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(2));
    expect(listenMock.mock.calls[1]?.[0].range).not.toBeNull();
    expect(saveMock).toHaveBeenCalledWith(expect.stringContaining('"range":"thisYear"'));
  });

  it("opens on the range it was left on", async () => {
    loadMock.mockResolvedValue(JSON.stringify({ ...DEFAULT_FILTERS, range: "days7" }));

    render(<StatisticsView />);

    // The title rather than the stored id: the select is drawn since phase
    // 111, so what it holds is the text the list showed.
    await waitFor(() => expect(showing("Range")).toBe("Last 7 days"));
  });

  it("says so rather than showing a row of zeros before anything has been played", async () => {
    listenMock.mockResolvedValue({
      plays: 0,
      artists: 0,
      albums: 0,
      tracks: 0,
      days: 0,
      durationMs: 0,
      owned: 0,
      withGenre: 0,
      timed: 0,
      dated: 0,
      firstAt: null,
      lastAt: null,
    });

    render(<StatisticsView />);

    expect(await screen.findByText(/Nothing has been played yet/)).toBeInTheDocument();
  });

  it("blames the drill path rather than the import when a period holds no plays", async () => {
    listenMock.mockResolvedValue({
      plays: 0,
      artists: 0,
      albums: 0,
      tracks: 0,
      days: 0,
      durationMs: 0,
      owned: 0,
      withGenre: 0,
      timed: 0,
      dated: 0,
      firstAt: null,
      lastAt: null,
    });
    useLibraryStore.setState({
      statsPath: { tab: "listening", crumbs: [{ kind: "period", key: "2023-01-01/year" }] },
    });

    render(<StatisticsView />);

    expect(await screen.findByText("No plays in this range.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been played yet/)).not.toBeInTheDocument();
  });

  it("names a period crumb by its stretch of time, not its key", async () => {
    useLibraryStore.setState({
      statsPath: { tab: "listening", crumbs: [{ kind: "period", key: "2023-03-01/month" }] },
    });

    render(<StatisticsView />);

    const breadcrumb = await screen.findByRole("navigation", { name: "Drill-down" });
    expect(breadcrumb).toHaveTextContent(periodLabel("2023-03-01/month"));
    expect(breadcrumb).not.toHaveTextContent("2023-03-01/month");
  });

  // Asserted through the tokens themselves rather than the "Showing" that
  // leads them: the word is a bare text node beside them, so no element's text
  // is ever just that, and a query for it would pass whether or not the line
  // is drawn.
  it("draws no token line while nothing is filtered", async () => {
    render(<StatisticsView />);
    await screen.findByRole("combobox", { name: "Range" });

    expect(screen.queryByRole("button", { name: /^Clear / })).not.toBeInTheDocument();
  });

  it("says what is filtered, and puts it back when the token is cleared", async () => {
    const user = userEvent.setup();
    render(<StatisticsView />);
    await screen.findByRole("combobox", { name: "Range" });

    await choose("Range", "Last 12 months");

    expect(await screen.findByText("last 12 months")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear last 12 months" }));

    await waitFor(() => expect(showing("Range")).toBe("All time"));
    expect(screen.queryByRole("button", { name: /^Clear / })).not.toBeInTheDocument();
  });
});
