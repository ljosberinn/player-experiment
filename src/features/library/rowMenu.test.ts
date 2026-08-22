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
  onOpenUrl: vi.fn(),
};

function items(over: Partial<Parameters<typeof rowMenuItems>[0]> = {}) {
  return rowMenuItems({
    count: 1,
    playlists: [],
    openPlaylist: null,
    track: { artist: "Blue Room", album: "Harbour", album_artist: null },
    ...handlers,
    ...over,
  });
}

/** One entry by label, narrowed past the separator case. */
function entry(menu: ReturnType<typeof rowMenuItems>, label: string) {
  const found = menu.find((item) => item.kind !== "separator" && item.label === label);
  return found && found.kind !== "separator" ? found : undefined;
}

/** The entries of a submenu, separators dropped. */
function submenuOf(menu: ReturnType<typeof rowMenuItems>, label: string) {
  return (entry(menu, label)?.submenu ?? []).flatMap((item) =>
    item.kind === "separator" ? [] : [item],
  );
}

/** The labels of the actionable entries, separators dropped. */
function labels(menu: ReturnType<typeof rowMenuItems>): string[] {
  return menu.flatMap((item) => (item.kind === "separator" ? [] : [item.label]));
}

describe("rowMenuItems", () => {
  it("counts the songs it is about to act on", () => {
    expect(labels(items({ count: 3 }))).toContain("Edit 3 Songs");
    expect(labels(items({ count: 3 }))).toContain("Export 3 Songs…");
  });

  it("says it in the singular for one", () => {
    // "Edit 1 Songs" is the kind of thing that makes an app feel unfinished,
    // and it is the default if nobody looks.
    expect(labels(items({ count: 1 }))).toContain("Edit");
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

  it("offers both lookups on a row that names an artist and an album", () => {
    expect(labels(items())).toContain("Open Artist on…");
    expect(labels(items())).toContain("Open Album on…");
    expect(submenuOf(items(), "Open Artist on…").map((one) => one.label)).toEqual([
      "Last.fm",
      "Discogs",
    ]);
  });

  it("opens the artist's page, taking the album artist over the artist", () => {
    const onOpenUrl = vi.fn();
    const menu = items({
      track: { artist: "Cascade", album: "Terrace", album_artist: "Various Artists" },
      onOpenUrl,
    });

    submenuOf(menu, "Open Artist on…")[0]?.onSelect?.();
    submenuOf(menu, "Open Album on…")[0]?.onSelect?.();

    expect(onOpenUrl).toHaveBeenNthCalledWith(1, "https://www.last.fm/music/Various%20Artists");
    expect(onOpenUrl).toHaveBeenNthCalledWith(
      2,
      "https://www.last.fm/music/Various%20Artists/Terrace",
    );
  });

  it("leaves out the lookup for a tag the row does not carry", () => {
    // Greyed out would be an entry offering to look up an artist that is not
    // there, and unlike the playlist case there is no question it answers.
    const noAlbum = labels(
      items({ track: { artist: "Blue Room", album: null, album_artist: null } }),
    );
    expect(noAlbum).toContain("Open Artist on…");
    expect(noAlbum).not.toContain("Open Album on…");

    const untagged = labels(items({ track: { artist: null, album: null, album_artist: null } }));
    expect(untagged).not.toContain("Open Artist on…");
    expect(untagged).not.toContain("Open Album on…");
  });

  it("has no lookups without a row to name", () => {
    // The menu bar's Edit menu with several rows selected: it acts on ids, and
    // there is no single row whose artist this would be.
    expect(labels(items({ track: null, count: 3 }))).not.toContain("Open Artist on…");
  });

  it("disables the lookups with more than one row selected", () => {
    // Two rows are two artists, and picking one would be a guess at which.
    expect(entry(items({ count: 2 }), "Open Artist on…")?.disabled).toBe(true);
    expect(entry(items({ count: 2 }), "Open Album on…")?.disabled).toBe(true);
    expect(entry(items({ count: 1 }), "Open Artist on…")?.disabled).toBe(false);
  });

  it("wires each entry to its handler", () => {
    const onPlay = vi.fn();
    const onAddTo = vi.fn();
    const menu = rowMenuItems({
      count: 1,
      playlists: [playlist(7, "Evening")],
      openPlaylist: null,
      track: null,
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
