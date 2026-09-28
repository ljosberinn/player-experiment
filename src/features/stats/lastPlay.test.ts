import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStatsFilters, saveStatsFilters } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { lastPlayedWords, lastPlayPath, showLastPlay } from "./lastPlay";
import { periodLabel } from "./series";
import { useStatsStore } from "./store";

vi.mock("../../ipc", () => ({
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
}));

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Mid-afternoon, so neither midnight is a rounding away. */
const NOW = new Date(2024, 3, 15, 15, 0);

describe("lastPlayedWords", () => {
  it("counts calendar days, not elapsed ones", () => {
    expect(lastPlayedWords(seconds(new Date(2024, 3, 15, 0, 5)), NOW)).toBe("today");
    expect(lastPlayedWords(seconds(new Date(2024, 3, 14, 23, 55)), NOW)).toBe("yesterday");
  });

  it("names a play by its date past thirty days", () => {
    expect(lastPlayedWords(seconds(new Date(2024, 2, 16, 12, 0)), NOW)).toBe("30 days ago");
    expect(lastPlayedWords(seconds(new Date(2024, 2, 15, 12, 0)), NOW)).toBe(
      periodLabel("2024-03-15/day"),
    );
  });

  it("calls a play stamped ahead of the clock today", () => {
    expect(lastPlayedWords(seconds(new Date(2024, 3, 16, 9, 0)), NOW)).toBe("today");
  });
});

describe("lastPlayPath", () => {
  it("drills Listening into the play's local day", () => {
    expect(lastPlayPath(seconds(new Date(2024, 2, 1, 0, 1)))).toEqual({
      tab: "listening",
      crumbs: [{ kind: "period", key: "2024-03-01/day" }],
    });
  });
});

describe("showLastPlay", () => {
  const showStatsPath = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    useStatsStore.setState({ filters: DEFAULT_FILTERS, loaded: false });
    useLibraryStore.setState({ showStatsPath });
  });

  it("clears the Listening filters and keeps the Library ones", async () => {
    vi.mocked(loadStatsFilters).mockResolvedValueOnce(
      JSON.stringify({
        ...DEFAULT_FILTERS,
        range: "days7",
        owned: true,
        loved: false,
        genre: "Jazz",
      }),
    );
    const at = seconds(new Date(2023, 5, 2, 20, 0));

    await showLastPlay(at);

    expect(useStatsStore.getState().filters).toEqual({ ...DEFAULT_FILTERS, genre: "Jazz" });
    expect(saveStatsFilters).toHaveBeenCalledWith(expect.stringContaining('"genre":"Jazz"'));
    expect(showStatsPath).toHaveBeenCalledWith(lastPlayPath(at));
  });

  it("leaves the reset standing when the view reads the filters on opening", async () => {
    vi.mocked(loadStatsFilters).mockResolvedValue(
      JSON.stringify({ ...DEFAULT_FILTERS, range: "days7" }),
    );

    await showLastPlay(seconds(new Date(2023, 5, 2, 20, 0)));
    await useStatsStore.getState().load();

    expect(useStatsStore.getState().filters.range).toBe("all");
    expect(loadStatsFilters).toHaveBeenCalledOnce();
  });
});
