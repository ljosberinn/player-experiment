import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseGroup, PaletteResults, Track } from "../../ipc";
import { foundGroups, usePaletteSearch } from "./paletteSearch";

vi.mock("../../ipc", () => ({ paletteSearch: vi.fn() }));

const search = async () => vi.mocked((await import("../../ipc")).paletteSearch);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function group(over: Partial<BrowseGroup> = {}): BrowseGroup {
  return {
    id: "Grizzly Bear",
    key: "Grizzly Bear",
    secondary: null,
    artistCount: 0,
    trackCount: 12,
    durationMs: 0,
    coverHash: null,
    year: null,
    ...over,
  };
}

function results(artist: string): PaletteResults {
  return { artists: [group({ id: artist, key: artist })], releases: [], tracks: [] };
}

describe("usePaletteSearch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not search a single letter", async () => {
    const { result } = renderHook(() => usePaletteSearch(" g "));

    await new Promise((settle) => setTimeout(settle, 300));
    expect(await search()).not.toHaveBeenCalled();
    expect(result.current).toEqual({ found: null, searching: false });
  });

  it("does not let a late answer overwrite a newer one", async () => {
    const slow = deferred<PaletteResults>();
    const fast = deferred<PaletteResults>();
    (await search()).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const { result, rerender } = renderHook(({ query }) => usePaletteSearch(query), {
      initialProps: { query: "gr" },
    });

    await waitFor(async () => expect(await search()).toHaveBeenCalledWith("gr", 5));
    rerender({ query: "griz" });
    await waitFor(async () => expect(await search()).toHaveBeenCalledWith("griz", 5));

    fast.resolve(results("Grizzly Bear"));
    await waitFor(() => expect(result.current.found).toEqual(results("Grizzly Bear")));
    slow.resolve(results("Grimes"));
    await new Promise((settle) => setTimeout(settle, 0));

    expect(result.current).toEqual({ found: results("Grizzly Bear"), searching: false });
  });

  it("keeps the last answer up while the next is coming", async () => {
    const next = deferred<PaletteResults>();
    (await search())
      .mockResolvedValueOnce(results("Grizzly Bear"))
      .mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ query }) => usePaletteSearch(query), {
      initialProps: { query: "gr" },
    });
    await waitFor(() => expect(result.current.found).toEqual(results("Grizzly Bear")));

    rerender({ query: "gri" });

    expect(result.current).toEqual({ found: results("Grizzly Bear"), searching: true });
  });

  it("finds nothing, and says nothing, when the search fails", async () => {
    (await search()).mockRejectedValueOnce(new Error("database is locked"));
    const { result } = renderHook(() => usePaletteSearch("grizzly"));

    await waitFor(() => expect(result.current).toEqual({ found: null, searching: false }));
  });
});

describe("foundGroups", () => {
  it("names each hit as the grid and the table do, and acts on it", () => {
    const onShowGroup = vi.fn();
    const onPlay = vi.fn();
    const release = group({
      id: "ShieldsGrizzly Bear",
      key: "Shields",
      artistCount: 1,
      secondary: "Grizzly Bear",
    });
    const track = {
      id: 7,
      title: null,
      artist: "Grizzly Bear",
      path: "C:/m/Sleeping Ute.mp3",
    } as Track;

    const groups = foundGroups(
      { artists: [group()], releases: [release], tracks: [track] },
      { onShowGroup, onPlay },
    );
    const entries = groups.map((g) => ({
      group: g.group,
      found: g.found,
      items: g.items.filter((item) => item.kind !== "separator"),
    }));

    expect(
      entries.map((g) => [g.group, g.found, g.items.map((item) => [item.label, item.hint])]),
    ).toEqual([
      ["Artists", true, [["Grizzly Bear", undefined]]],
      ["Releases", true, [["Shields", "Grizzly Bear"]]],
      // Untitled, as the player bar names it.
      ["Songs", true, [["Sleeping Ute.mp3", "Grizzly Bear"]]],
    ]);

    for (const { items } of entries) {
      items[0]?.onSelect?.();
    }
    expect(onShowGroup.mock.calls).toEqual([
      ["artists", group()],
      ["albums", release],
    ]);
    expect(onPlay).toHaveBeenCalledWith(track);
  });
});
