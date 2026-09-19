import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { statsRoot } from "./path";
import { useStatsStore } from "./store";
import { useLibraryQuery } from "./useLibraryQuery";

vi.mock("../../ipc", () => ({
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
  setGenreOverride: vi.fn(async () => undefined),
  clearGenreOverride: vi.fn(async () => undefined),
}));

beforeEach(() => {
  useStatsStore.setState({ filters: DEFAULT_FILTERS, genreVersion: 0 });
  useLibraryStore.setState({
    search: "",
    playlistId: null,
    browse: null,
    statsPath: statsRoot("library"),
  });
});

describe("useLibraryQuery", () => {
  it("carries the genre version, so an override refetches every panel", async () => {
    // An override moves no track row, so `library://changed` would be a lie
    // and the panels have nothing else to hear. This is the one place that
    // has to list it: fifteen panels listing it by hand is where one of them
    // forgets and keeps drawing the tree as it was before the correction.
    const { result } = renderHook(() => useLibraryQuery());
    const before = result.current.deps;

    await act(async () => {
      await useStatsStore.getState().setOverride("black metal", "doom metal");
    });

    expect(result.current.deps).not.toStrictEqual(before);
  });

  it("puts the drill path's genre in the query", () => {
    useLibraryStore.setState({
      statsPath: { tab: "library", crumbs: [{ kind: "genre", key: "black metal" }] },
    });

    const { result } = renderHook(() => useLibraryQuery());

    expect(result.current.query.genre).toBe("black metal");
  });
});
