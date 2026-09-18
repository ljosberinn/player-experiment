import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveTextFile, statsTop } from "../../ipc";
import { historyAt } from "../library/history";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { ListeningPanels } from "./ListeningPanels";
import { forgetListenTotals } from "./listenTotals";
import { statsRoot } from "./path";
import { useStatsStore } from "./store";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => "C:/out/heard.csv") }));

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
  statsListenTotals: vi.fn(async () => ({
    plays: 1000,
    artists: 40,
    albums: 90,
    tracks: 310,
    days: 64,
    durationMs: 180_000_000,
    owned: 600,
    withGenre: 840,
    timed: 600,
    firstAt: 1_400_000_000,
    lastAt: 1_700_000_000,
  })),
  statsRecentPlays: vi.fn(async () => []),
  statsStreaks: vi.fn(async () => ({
    current: 3,
    longest: 12,
    longestFrom: "2024-03-01",
    longestTo: "2024-03-12",
  })),
  statsTop: vi.fn(async (_query, dimension: string) =>
    dimension === "track"
      ? [{ key: "Roygbiv", secondary: "Boards of Canada", plays: 31 }]
      : [
          { key: "Boards of Canada", secondary: null, plays: 412 },
          { key: "Aphex Twin", secondary: null, plays: 206 },
        ],
  ),
}));

const topMock = vi.mocked(statsTop);
const writeMock = vi.mocked(saveTextFile);

/** The panel with this heading, so an assertion names which list it means. */
function panel(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const section = heading.closest("section");
  if (section === null) {
    throw new Error(`${title} is not in a panel`);
  }
  return section;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetListenTotals();
  useStatsStore.setState({ filters: DEFAULT_FILTERS });
  useLibraryStore.setState({
    tab: "stats",
    statsPath: statsRoot("listening"),
    history: historyAt({
      tab: "stats",
      browse: null,
      playlistId: null,
      stats: statsRoot("listening"),
    }),
  });
});

describe("ListeningPanels", () => {
  it("asks for each dimension once", async () => {
    render(<ListeningPanels />);

    await waitFor(() => expect(topMock).toHaveBeenCalledTimes(5));
    expect(topMock.mock.calls.map((call) => call[1]).sort()).toEqual([
      "album",
      "artist",
      "genre",
      "track",
      "track",
    ]);
  });

  it("says what share of the plays a genre is known for", async () => {
    render(<ListeningPanels />);

    // 840 of 1000: a genre is knowable for a matched play alone, and
    // reporting the matched subset as the whole is the failure mode.
    expect(await within(panel("Top genres")).findByText(/84% of plays/)).toBeInTheDocument();
  });

  it("drills into the artist a bar names", async () => {
    const user = userEvent.setup();
    render(<ListeningPanels />);
    const bar = await within(panel("Top artists")).findByRole("button", {
      name: /Boards of Canada/,
    });

    await user.click(bar);

    expect(useLibraryStore.getState().statsPath).toEqual({
      tab: "listening",
      crumbs: [{ kind: "artist", key: "Boards of Canada" }],
    });
  });

  it("leaves a track row alone, because a play query has no track field", async () => {
    render(<ListeningPanels />);
    const rows = await within(panel("Top tracks")).findAllByRole("listitem");

    expect(within(rows[0] as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("narrows the rest of the tab rather than opening an artist page", async () => {
    render(<ListeningPanels />);
    await waitFor(() => expect(topMock).toHaveBeenCalled());
    topMock.mockClear();

    await userEvent
      .setup()
      .click(within(panel("Top artists")).getByRole("button", { name: /Aphex Twin/ }));

    // The panel that would list this artist among others goes; everything
    // else re-asks with the artist set.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Top artists" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(topMock).toHaveBeenCalled());
    for (const [query] of topMock.mock.calls) {
      expect(query.artist).toBe("Aphex Twin");
    }
  });

  it("asks the residue for unowned plays whatever the Owned filter says", async () => {
    useStatsStore.setState({ filters: { ...DEFAULT_FILTERS, owned: true } });
    render(<ListeningPanels />);

    await waitFor(() => expect(topMock).toHaveBeenCalledTimes(5));
    const residue = topMock.mock.calls.filter(([query]) => query.owned === false);
    expect(residue).toHaveLength(1);
    expect(residue[0]?.[1]).toBe("track");
  });

  it("exports the residue as the rows it is showing", async () => {
    const user = userEvent.setup();
    render(<ListeningPanels />);
    const exportButton = await within(panel("Heard, never owned")).findByRole("button", {
      name: "Export…",
    });

    await user.click(exportButton);

    await waitFor(() => expect(writeMock).toHaveBeenCalled());
    expect(writeMock.mock.calls[0]?.[1]).toBe(
      "Artist,Title,Plays\r\nBoards of Canada,Roygbiv,31\r\n",
    );
  });

  it("names the longest streak's run", async () => {
    render(<ListeningPanels />);

    expect(await within(panel("Streaks")).findByText("12 days")).toBeInTheDocument();
    expect(within(panel("Streaks")).getByText("3 days")).toBeInTheDocument();
  });
});
