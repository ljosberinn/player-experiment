import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadStatsFilters,
  saveStatsFilters,
  statsLibraryTotals,
  statsListenTotals,
} from "../../ipc";
import { historyAt } from "../library/history";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { forgetListenTotals } from "./listenTotals";
import { statsRoot } from "./path";
import { StatisticsView } from "./StatisticsView";
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
    firstAt: 1_400_000_000,
    lastAt: 1_700_000_000,
  })),
  statsTop: vi.fn(async () => []),
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

  it("re-asks for the tiles when the range changes, and stores the range", async () => {
    const user = userEvent.setup();
    render(<StatisticsView />);
    await screen.findByText(shown(7863));

    await user.selectOptions(screen.getByLabelText("Range"), "thisYear");

    await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(2));
    expect(listenMock.mock.calls[1]?.[0].range).not.toBeNull();
    expect(saveMock).toHaveBeenCalledWith(expect.stringContaining('"range":"thisYear"'));
  });

  it("opens on the range it was left on", async () => {
    loadMock.mockResolvedValue(JSON.stringify({ ...DEFAULT_FILTERS, range: "days7" }));

    render(<StatisticsView />);

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>("Range").value).toBe("days7"),
    );
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
      firstAt: null,
      lastAt: null,
    });

    render(<StatisticsView />);

    expect(await screen.findByText(/Nothing has been played yet/)).toBeInTheDocument();
  });
});
