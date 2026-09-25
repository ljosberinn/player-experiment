import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Play, statsRecentPlays } from "../../ipc";
import { DEFAULT_FILTERS, dayRange } from "./filters";
import { OnThisDay } from "./OnThisDay";
import { useStatsStore } from "./store";

vi.mock("../../ipc", () => ({
  statsRecentPlays: vi.fn(async () => []),
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
}));

const recentMock = vi.mocked(statsRecentPlays);

/** 25 September 2026, mid-afternoon. */
const TODAY = new Date(2026, 8, 25, 14, 0);

function play(id: number, year: number, hour: number, over: Partial<Play> = {}): Play {
  return {
    id,
    startedAt: Math.floor(new Date(year, 8, 25, hour, 5).getTime() / 1000),
    artist: "Blue Room",
    title: `Song ${id}`,
    album: null,
    trackId: id,
    ...over,
  };
}

/** Answers each year's day with what `byYear` holds for it. */
function played(byYear: Record<number, Play[]>) {
  recentMock.mockImplementation(async (query) => {
    const year = new Date((query.range?.from ?? 0) * 1000).getFullYear();
    return byYear[year] ?? [];
  });
}

/** Formatted the way the tab formats it, so the assertion holds in any locale. */
function heading(ago: string, year: number): string {
  const date = new Date(year, 8, 25).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${ago} · ${date}`;
}

function headings(): string[] {
  return screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  useStatsStore.setState({ filters: DEFAULT_FILTERS });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OnThisDay", () => {
  it("draws a section per year with plays, newest first, and leaves the rest out", async () => {
    played({ 2019: [play(1, 2019, 9)], 2025: [play(3, 2025, 21), play(2, 2025, 8)] });

    render(<OnThisDay />);

    await screen.findByText("Song 3");
    expect(headings()).toEqual([heading("1 year ago", 2025), heading("7 years ago", 2019)]);
    expect(screen.getByText("2 plays")).toBeInTheDocument();
    expect(screen.getByText("1 play")).toBeInTheDocument();
  });

  it("draws a day's plays newest first, by their time alone", async () => {
    const late = play(3, 2025, 21);
    played({ 2025: [late, play(2, 2025, 8)] });

    render(<OnThisDay />);

    const rows = (await screen.findByText("Song 3")).closest("ol")?.querySelectorAll("li");
    expect([...(rows ?? [])].map((row) => row.querySelector(".plays-title")?.textContent)).toEqual([
      "Song 3",
      "Song 2",
    ]);
    expect(rows?.[0]?.querySelector(".plays-when")).toHaveTextContent(
      new Date((late.startedAt ?? 0) * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  });

  it("says so when no earlier year has a play on the day", async () => {
    played({});

    render(<OnThisDay />);

    const day = TODAY.toLocaleDateString(undefined, { day: "numeric", month: "long" });
    expect(
      await screen.findByText(`Nothing played on ${day} in earlier years.`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("asks for each earlier year's day under the Owned and Loved filters alone", async () => {
    useStatsStore.setState({
      filters: { ...DEFAULT_FILTERS, range: "days7", owned: true, loved: false },
    });
    played({});

    render(<OnThisDay />);
    await screen.findByText(/^Nothing played on/);

    expect(recentMock).toHaveBeenCalledTimes(2025 - 2002 + 1);
    expect(recentMock).toHaveBeenCalledWith(
      {
        range: dayRange(2025, 8, 25),
        artist: null,
        genre: null,
        album: null,
        owned: true,
        loved: false,
      },
      0,
      1000,
    );
  });

  it("says a day of a thousand plays is cut", async () => {
    played({ 2024: Array.from({ length: 1000 }, (_, index) => play(index + 1, 2024, 12)) });

    render(<OnThisDay />);

    expect(await screen.findByText(`${(1000).toLocaleString()}+ plays`)).toBeInTheDocument();
    expect(screen.getByText(/^Cut at/)).toBeInTheDocument();
  });

  it("marks a play with no file behind it", async () => {
    played({ 2025: [play(1, 2025, 12, { trackId: null })] });

    render(<OnThisDay />);

    const row = (await screen.findByText("Song 1")).closest("li");
    expect(row?.querySelector(".plays-unowned")).toHaveTextContent("not owned");
  });
});
