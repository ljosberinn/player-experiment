import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NewArtist, statsNewArtists } from "../../../ipc";
import { historyAt } from "../../library/history";
import { useLibraryStore } from "../../library/store";
import { DEFAULT_FILTERS } from "../filters";
import { statsRoot } from "../path";
import { useStatsStore } from "../store";
import { NewArtistList } from "./NewArtistList";

vi.mock("../../../ipc", () => ({
  statsNewArtists: vi.fn(async () => []),
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
}));

const newMock = vi.mocked(statsNewArtists);

// jsdom lays nothing out, and a virtualizer over a 0px viewport renders no
// rows.
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
  // A drill changes the query, which scrolls the list back to its top.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
}

function artists(count: number, from = 0): NewArtist[] {
  return Array.from({ length: count }, (_, n) => ({
    artist: `Artist ${from + n}`,
    firstAt: 1_700_000_000 - (from + n) * 86_400,
    plays: 3,
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  newMock.mockReset();
  newMock.mockResolvedValue([]);
  stubLayout();
  useStatsStore.setState({ filters: DEFAULT_FILTERS });
  useLibraryStore.setState({
    tab: "stats",
    statsPath: statsRoot("listening"),
    history: historyAt({
      tab: "stats",
      browse: null,
      browseLabel: null,
      playlistId: null,
      stats: statsRoot("listening"),
    }),
  });
});

describe("NewArtistList", () => {
  it("names each artist, when they were first heard and how often since", async () => {
    newMock.mockResolvedValueOnce([{ artist: "Blue Room", firstAt: 1_700_000_000, plays: 42 }]);
    render(<NewArtistList />);

    const row = await screen.findByRole("button", { name: /Blue Room/ });
    expect(row).toHaveTextContent(new Date(1_700_000_000_000).toLocaleDateString());
    expect(row).toHaveTextContent("42");
    expect(screen.getByText("Plays since")).toBeInTheDocument();
  });

  it("drills into the artist a row names", async () => {
    const user = userEvent.setup();
    newMock.mockResolvedValueOnce([{ artist: "Blue Room", firstAt: 1_700_000_000, plays: 42 }]);
    render(<NewArtistList />);

    await user.click(await screen.findByRole("button", { name: /Blue Room/ }));

    expect(useLibraryStore.getState().statsPath).toEqual({
      tab: "listening",
      crumbs: [{ kind: "artist", key: "Blue Room" }],
    });
  });

  it("asks for the next page once the end of the first is drawn", async () => {
    // Tall enough to draw every row of the first page, so its end is in view.
    stubLayout(4000);
    newMock.mockResolvedValueOnce(artists(100)).mockResolvedValueOnce(artists(7, 100));
    render(<NewArtistList />);

    expect(await screen.findByRole("button", { name: /Artist 106/ })).toBeInTheDocument();
    expect(newMock.mock.calls.map(([, offset, limit]) => [offset, limit])).toEqual([
      [0, 100],
      [100, 100],
    ]);
  });

  it("draws nothing where nobody was new, leaving the chart to say so", async () => {
    const { container } = render(<NewArtistList />);

    await waitFor(() => expect(newMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
