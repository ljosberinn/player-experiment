import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { statsRecentPlays } from "../../../ipc";
import { DEFAULT_FILTERS } from "../filters";
import { useStatsStore } from "../store";
import { RecentPlays } from "./RecentPlays";

vi.mock("../../../ipc", () => ({
  statsRecentPlays: vi.fn(async () => []),
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
}));

const recentMock = vi.mocked(statsRecentPlays);

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
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLayout();
  useStatsStore.setState({ filters: DEFAULT_FILTERS });
});

describe("RecentPlays", () => {
  it("gives a play last.fm holds without a date no date", async () => {
    recentMock.mockResolvedValueOnce([
      {
        id: 1,
        startedAt: null,
        artist: "Blue Room",
        title: "Harbour",
        album: null,
        trackId: null,
      },
    ]);
    render(<RecentPlays />);

    const row = (await screen.findByText("Harbour")).closest(".plays-row");
    expect(row?.querySelector(".plays-when")).toHaveTextContent(/^Undated$/);
  });
});
