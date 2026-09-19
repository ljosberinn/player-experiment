import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveTextFile, statsHistogram, statsTagHealth } from "../../ipc";
import { historyAt } from "../library/history";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { LibraryPanels } from "./LibraryPanels";
import { statsRoot } from "./path";
import { useStatsStore } from "./store";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => "C:/out/worst.csv") }));

vi.mock("../../ipc", () => ({
  INVALIDATE_DEBOUNCE_MS: 250,
  onLibraryChanged: vi.fn(async () => () => {}),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0, removed: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  loadColumnConfig: vi.fn(async () => null),
  saveColumnConfig: vi.fn(async () => undefined),
  listPlaylists: vi.fn(async () => []),
  saveTextFile: vi.fn(async () => undefined),
  statsLibraryTotals: vi.fn(async () => ({
    tracks: 1200,
    artists: 80,
    albums: 140,
    durationMs: 900_000_000,
    bytes: 7_500_000_000,
    missing: 3,
  })),
  statsHistogram: vi.fn(async (_query, field: string) => {
    if (field === "sampleRate") {
      return [
        { value: 44_100, count: 900 },
        { value: 96_000, count: 20 },
        { value: 48_000, count: 280 },
      ];
    }
    if (field === "year") {
      return [
        { value: 1994, count: 3 },
        { value: 1997, count: 9 },
      ];
    }
    return [
      { value: 128, count: 40 },
      { value: 320, count: 160 },
    ];
  }),
  statsWorstByBitrate: vi.fn(async () => [
    { album: "Harbour", artist: "Blue Room", tracks: 9, meanBitrate: 128, coverHash: null },
    { album: "Terrace", artist: null, tracks: 4, meanBitrate: 192, coverHash: null },
  ]),
  statsTagHealth: vi.fn(async () => ({
    tracks: 1200,
    title: 0,
    artist: 12,
    album: 0,
    albumArtist: 300,
    genre: 600,
    year: 0,
    trackNo: 0,
    cover: 0,
  })),
}));

const histogramMock = vi.mocked(statsHistogram);
const healthMock = vi.mocked(statsTagHealth);
const writeMock = vi.mocked(saveTextFile);

/** The panel with this heading, so an assertion names which one it means. */
function panel(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const section = heading.closest("section");
  if (section === null) {
    throw new Error(`${title} is not in a panel`);
  }
  return section;
}

/** What a chart drew, read off its table rather than off its geometry. */
async function tableOf(title: string): Promise<string[][]> {
  const user = userEvent.setup();
  await user.click(await within(panel(title)).findByRole("button", { name: "Show as table" }));
  return within(panel(title))
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent ?? ""));
}

beforeEach(() => {
  vi.clearAllMocks();
  useStatsStore.setState({ filters: DEFAULT_FILTERS });
  useLibraryStore.setState({
    tab: "stats",
    search: "",
    playlistId: null,
    browse: null,
    statsPath: statsRoot("library"),
    history: historyAt({
      tab: "stats",
      browse: null,
      playlistId: null,
      stats: statsRoot("library"),
    }),
  });
});

describe("LibraryPanels", () => {
  it("asks for each histogram field once", async () => {
    render(<LibraryPanels />);

    await waitFor(() => expect(histogramMock).toHaveBeenCalledTimes(4));
    expect(histogramMock.mock.calls.map((call) => call[1]).sort()).toEqual([
      "bitrate",
      "duration",
      "sampleRate",
      "year",
    ]);
  });

  it("puts the bins the aggregate had nothing to return back in the chart", async () => {
    // A `GROUP BY` returns no row for an empty bin, and 128 drawn against 320
    // as its neighbour would say the library is two rates rather than one
    // with a hole in the middle.
    render(<LibraryPanels />);

    expect(await tableOf("Bitrates")).toStrictEqual([
      ["128", "40"],
      ["160", "0"],
      ["192", "0"],
      ["224", "0"],
      ["256", "0"],
      ["288", "0"],
      ["320", "160"],
    ]);
  });

  it("reads the release years as decades off the same query", async () => {
    // The point of the toggle: a decade is ten year bins summed, so a panel
    // of its own would be a second full scan of `tracks` to draw arithmetic.
    const user = userEvent.setup();
    render(<LibraryPanels />);
    await waitFor(() => expect(histogramMock).toHaveBeenCalledTimes(4));
    histogramMock.mockClear();

    await user.click(within(panel("Release years")).getByRole("button", { name: "By decade" }));

    expect(histogramMock).not.toHaveBeenCalled();
    expect(await tableOf("Release years")).toStrictEqual([["1990s", "12"]]);
  });

  it("orders the sample rates by how much of the library they are", async () => {
    render(<LibraryPanels />);
    const rows = await within(panel("Sample rates")).findAllByRole("listitem");

    // Formatted the way the panel formats it, so the assertion holds in any
    // locale: a comma is the decimal separator in most of them.
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      `${(44.1).toLocaleString()} kHz900`,
      "48 kHz280",
      "96 kHz20",
    ]);
  });

  it("exports the re-download list as the rows it is showing", async () => {
    const user = userEvent.setup();
    render(<LibraryPanels />);
    const button = await within(panel("Albums by mean bitrate")).findByRole("button", {
      name: "Export…",
    });

    await user.click(button);

    await waitFor(() => expect(writeMock).toHaveBeenCalled());
    expect(writeMock.mock.calls[0]?.[1]).toBe(
      "Album,Artist,Songs,Mean kbps\r\nHarbour,Blue Room,9,128\r\nTerrace,,4,192\r\n",
    );
  });

  it("leaves out a tag nothing is missing, and says the share of the rest", async () => {
    render(<LibraryPanels />);
    const rows = await within(panel("Tag health")).findAllByRole("listitem");

    expect(rows.map((row) => row.textContent)).toStrictEqual([
      "Artist12 (1%)",
      "Album artist300 (25%)",
      "Genre600 (50%)",
    ]);
  });

  it("puts the scope selector into every panel's query", async () => {
    // The whole reason the panels share `useLibraryQuery`: a scope that
    // reached five aggregates and not the sixth would report the library
    // under a heading that said otherwise.
    useLibraryStore.setState({ search: "ambient", playlistId: 4 });
    useStatsStore.setState({ filters: { ...DEFAULT_FILTERS, scope: { kind: "view" } } });
    render(<LibraryPanels />);

    await waitFor(() => expect(healthMock).toHaveBeenCalled());
    for (const [query] of histogramMock.mock.calls) {
      expect(query.search).toBe("ambient");
      expect(query.playlistId).toBe(4);
    }
    expect(healthMock.mock.calls[0]?.[0].search).toBe("ambient");
  });
});
