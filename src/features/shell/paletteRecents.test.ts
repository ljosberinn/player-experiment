import { describe, expect, it, vi } from "vitest";
import type { PaletteGroup } from "../../components/ui/CommandPalette";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { entryKey, parseRecents, RECENT_LIMIT, remember, withRecents } from "./paletteRecents";

type Entry = Exclude<MenuItem, { kind: "separator" }>;

const at = (groups: PaletteGroup[], group: number, item: number) =>
  groups[group]?.items[item] as Entry;

const labels = (group: PaletteGroup | undefined) =>
  group?.items.map((item) => (item as Entry).label);

describe("remember", () => {
  it("puts the newest first, once, and keeps the limit", () => {
    let recent: string[] = [];
    for (const key of ["a", "b", "c", "b"]) {
      recent = remember(recent, key);
    }
    expect(recent).toEqual(["b", "c", "a"]);

    for (let i = 0; i < RECENT_LIMIT + 2; i++) {
      recent = remember(recent, `k${i}`);
    }
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]).toBe(`k${RECENT_LIMIT + 1}`);
  });
});

describe("parseRecents", () => {
  it("reads a list of keys and nothing else", () => {
    expect(parseRecents('["a","b"]')).toEqual(["a", "b"]);
    expect(parseRecents('["a",3]')).toEqual(["a"]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
  });
});

describe("entryKey", () => {
  it("prefers the id, and otherwise tells groups apart", () => {
    expect(entryKey("Playback", { id: "playback:toggle", label: "Pause" })).toBe("playback:toggle");
    expect(entryKey("Edit", { label: "Play" })).not.toBe(entryKey("Playback", { label: "Play" }));
  });
});

describe("withRecents", () => {
  const groups = (): PaletteGroup[] => [
    {
      group: "Go to",
      items: [
        { label: "Songs", onSelect: vi.fn() },
        { id: "playlist:1", label: "Mix", onSelect: vi.fn() },
      ],
    },
    {
      group: "View",
      items: [
        { label: "Zoom In", onSelect: vi.fn() },
        { label: "Actual Size", disabled: true, onSelect: vi.fn() },
      ],
    },
  ];

  it("leads with Recent, newest first, and lists each entry once", () => {
    const result = withRecents(groups(), ["View/Zoom In", "playlist:1"], true, vi.fn());

    expect(result.map((group) => group.group)).toEqual(["Recent", "Go to", "View"]);
    expect(labels(result[0])).toEqual(["Zoom In", "Mix"]);
    expect(labels(result[1])).toEqual(["Songs"]);
    expect(labels(result[2])).toEqual(["Actual Size"]);
  });

  it("drops a key nothing answers to, and shows a greyed one greyed", () => {
    const result = withRecents(groups(), ["playlist:2", "View/Actual Size"], true, vi.fn());

    expect(result[0]?.items).toEqual([
      expect.objectContaining({ label: "Actual Size", disabled: true }),
    ]);
  });

  it("has no Recent while something is typed", () => {
    const result = withRecents(groups(), ["View/Zoom In"], false, vi.fn());

    expect(result.map((group) => group.group)).toEqual(["Go to", "View"]);
    expect(labels(result[1])).toEqual(["Zoom In", "Actual Size"]);
  });

  it("reports what runs, and still runs it", () => {
    const source = groups();
    const onRun = vi.fn();
    const result = withRecents(source, [], true, onRun);

    at(result, 0, 1).onSelect?.();

    expect(onRun).toHaveBeenCalledWith("playlist:1");
    expect(at(source, 0, 1).onSelect).toHaveBeenCalledOnce();
  });

  it("neither remembers nor lists found music", () => {
    const play = vi.fn();
    const onRun = vi.fn();
    const found: PaletteGroup = {
      group: "Songs",
      found: true,
      items: [{ id: "track:1", label: "Ute", onSelect: play }],
    };
    const result = withRecents([...groups(), found], ["track:1"], true, onRun);

    expect(result.map((group) => group.group)).toEqual(["Go to", "View", "Songs"]);
    at(result, 2, 0).onSelect?.();
    expect(play).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
  });
});
