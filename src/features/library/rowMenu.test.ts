import { describe, expect, it, vi } from "vitest";
import type { Playlist } from "../../ipc";
import { rowMenuItems } from "./rowMenu";

function playlist(id: number, name: string, kind: Playlist["kind"] = "static"): Playlist {
  return { id, name, kind, trackCount: 0, createdAt: 0 };
}

const handlers = {
  onPlay: vi.fn(),
  onGetInfo: vi.fn(),
  onAddTo: vi.fn(),
  onRemove: vi.fn(),
  onExport: vi.fn(),
  onReveal: vi.fn(),
};

function items(over: Partial<Parameters<typeof rowMenuItems>[0]> = {}) {
  return rowMenuItems({
    count: 1,
    playlists: [],
    openPlaylist: null,
    ...handlers,
    ...over,
  });
}

/** The labels of the actionable entries, separators dropped. */
function labels(menu: ReturnType<typeof rowMenuItems>): string[] {
  return menu.flatMap((item) => (item.kind === "separator" ? [] : [item.label]));
}

describe("rowMenuItems", () => {
  it("counts the songs it is about to act on", () => {
    expect(labels(items({ count: 3 }))).toContain("Get Info for 3 Songs");
    expect(labels(items({ count: 3 }))).toContain("Export 3 Songs…");
  });

  it("says it in the singular for one", () => {
    // "Get Info for 1 Songs" is the kind of thing that makes an app feel
    // unfinished, and it is the default if nobody looks.
    expect(labels(items({ count: 1 }))).toContain("Get Info");
    expect(labels(items({ count: 1 }))).toContain("Export 1 Song…");
  });

  it("offers only static playlists to add to", () => {
    const menu = items({
      playlists: [playlist(1, "Evening"), playlist(2, "Recent", "smart")],
    });
    const addTo = menu.find(
      (item) => item.kind !== "separator" && item.label === "Add to Playlist",
    );

    // A smart playlist's membership is its filter, so "add" is not something
    // that can be done to one. Offering it greyed invites the question.
    expect(addTo).toBeDefined();
    expect(
      addTo && addTo.kind !== "separator"
        ? addTo.submenu?.map((one) => "label" in one && one.label)
        : [],
    ).toEqual(["Evening"]);
  });

  it("offers removal inside a static playlist", () => {
    const menu = items({ openPlaylist: playlist(1, "Evening"), count: 2 });

    expect(labels(menu)).toContain("Remove 2 Songs from Playlist");
  });

  it("does not offer removal in the library", () => {
    // In the library this could only mean deleting the file, which is not a
    // thing to sit one entry below "Get Info".
    expect(labels(items())).not.toContain("Remove from Playlist");
  });

  it("does not offer removal from a smart playlist", () => {
    const menu = items({ openPlaylist: playlist(2, "Recent", "smart") });

    expect(labels(menu).some((label) => label.includes("Remove"))).toBe(false);
  });

  it("disables Show in Explorer unless exactly one song is selected", () => {
    const one = items({ count: 1 }).find(
      (item) => item.kind !== "separator" && item.label === "Show in Explorer",
    );
    const many = items({ count: 2 }).find(
      (item) => item.kind !== "separator" && item.label === "Show in Explorer",
    );

    // With several selected there is no single file to reveal, and picking one
    // would be a guess at which.
    expect(one && one.kind !== "separator" && one.disabled).toBeFalsy();
    expect(many && many.kind !== "separator" && many.disabled).toBe(true);
  });

  it("wires each entry to its handler", () => {
    const onPlay = vi.fn();
    const onAddTo = vi.fn();
    const menu = rowMenuItems({
      count: 1,
      playlists: [playlist(7, "Evening")],
      openPlaylist: null,
      ...handlers,
      onPlay,
      onAddTo,
    });

    const play = menu.find((item) => item.kind !== "separator" && item.label === "Play");
    if (play && play.kind !== "separator") {
      play.onSelect?.();
    }
    const addTo = menu.find(
      (item) => item.kind !== "separator" && item.label === "Add to Playlist",
    );
    if (addTo && addTo.kind !== "separator") {
      const first = addTo.submenu?.[0];
      if (first && first.kind !== "separator") {
        first.onSelect?.();
      }
    }

    expect(onPlay).toHaveBeenCalled();
    expect(onAddTo).toHaveBeenCalledWith(7);
  });
});
