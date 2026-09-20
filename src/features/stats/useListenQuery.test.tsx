import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "../library/store";
import { DEFAULT_FILTERS } from "./filters";
import { statsRoot } from "./path";
import { useStatsStore } from "./store";
import { useListenQuery } from "./useListenQuery";

vi.mock("../../ipc", () => ({
  loadStatsFilters: vi.fn(async () => null),
  saveStatsFilters: vi.fn(async () => undefined),
  setGenreOverride: vi.fn(async () => undefined),
  clearGenreOverride: vi.fn(async () => undefined),
  statsPinAlbum: vi.fn(async () => undefined),
}));

beforeEach(() => {
  useStatsStore.setState({ filters: DEFAULT_FILTERS, groupVersion: 0 });
  useLibraryStore.setState({ statsPath: statsRoot("listening") });
});

describe("useListenQuery", () => {
  it("carries the group version, so a correction refetches every panel", async () => {
    // A pin moves no track row and no filter, so the panels have nothing else
    // to hear. This is the one place that has to list it: seven panels listing
    // it by hand is where one of them forgets and keeps drawing the log as it
    // was grouped before the correction.
    const { result } = renderHook(() => useListenQuery());
    const before = result.current.deps;

    await act(async () => {
      await useStatsStore.getState().pinAlbum("Nachtmystium", ["a"], "b");
    });

    expect(result.current.deps).not.toStrictEqual(before);
  });

  it("puts the drill path's album in the query", () => {
    useLibraryStore.setState({
      statsPath: { tab: "listening", crumbs: [{ kind: "album", key: "Instinct: Decay" }] },
    });

    const { result } = renderHook(() => useListenQuery());

    expect(result.current.query.album).toBe("Instinct: Decay");
  });
});
