import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { commands, flatten } from "./commands";
import type { Menu } from "./menus";

const noop = () => {};

function build(overrides: Partial<Parameters<typeof commands>[0]> = {}) {
  return commands({
    menus: [],
    status: "stopped",
    hasTrack: false,
    muted: false,
    repeatOne: false,
    zoom: 1,
    theme: "system",
    onPlayback: noop,
    onZoom: noop,
    onTheme: noop,
    onSettings: noop,
    onNewPlaylist: noop,
    onNewSmartPlaylist: noop,
    ...overrides,
  });
}

type Entry = Exclude<MenuItem, { kind: "separator" }>;

function group(name: string, overrides: Partial<Parameters<typeof commands>[0]> = {}): Entry[] {
  const found = build(overrides).find((one) => one.group === name);
  if (found === undefined) {
    throw new Error(`no ${name} group`);
  }
  return found.items as Entry[];
}

function entry(items: Entry[], label: string): Entry {
  const found = items.find((one) => one.label === label);
  if (found === undefined) {
    throw new Error(`no ${label} in ${items.map((one) => one.label).join(", ")}`);
  }
  return found;
}

describe("commands", () => {
  it("takes the menu bar's menus, leaving out one the bar cannot open", () => {
    const menus: Menu[] = [
      { label: "File", items: [{ label: "Rescan", onSelect: noop }] },
      { label: "Account", items: [], disabled: true },
      { label: "Help", items: [{ label: "Source Code on GitHub", onSelect: noop }] },
    ];

    expect(build({ menus }).map((one) => one.group)).toEqual([
      "File",
      "Help",
      "Playback",
      "View",
      "Library",
    ]);
  });

  it("names Play or Pause for what the press does now", () => {
    expect(entry(group("Playback", { hasTrack: true, status: "paused" }), "Play")).toBeDefined();
    expect(entry(group("Playback", { hasTrack: true, status: "playing" }), "Pause")).toBeDefined();
    expect(entry(group("Playback", { muted: true }), "Unmute")).toBeDefined();
    expect(entry(group("Playback", { repeatOne: true }), "Stop Repeating")).toBeDefined();
  });

  it("greys Play with nothing queued, and offers no transport while stopped", () => {
    const playback = group("Playback");

    expect(entry(playback, "Play")).toMatchObject({ disabled: true, hint: "Nothing queued" });
    expect(playback.map((one) => one.label)).toEqual(["Play", "Mute", "Repeat One"]);
    expect(group("Playback", { hasTrack: true, status: "paused" }).map((one) => one.label)).toEqual(
      ["Play", "Next", "Previous", "Stop", "Mute", "Repeat One"],
    );
  });

  it("runs the playback command it names", () => {
    const onPlayback = vi.fn();
    entry(
      group("Playback", { onPlayback, hasTrack: true, status: "playing" }),
      "Next",
    ).onSelect?.();

    expect(onPlayback).toHaveBeenCalledWith("next");
  });

  it("names a keystroke only where one is bound", () => {
    const shortcuts = Object.fromEntries(
      [...group("Playback", { hasTrack: true, status: "playing" }), ...group("View")].map((one) => [
        one.label,
        one.shortcut,
      ]),
    );

    expect(shortcuts).toMatchObject({
      Pause: "Space",
      Next: undefined,
      "Zoom In": "Ctrl+Plus",
      "Zoom Out": "Ctrl+Minus",
      "Actual Size": "Ctrl+0",
    });
  });

  it("greys a zoom step at its limit and the theme in use", () => {
    const view = group("View", { zoom: 2, theme: "dark" });

    expect(entry(view, "Zoom In").disabled).toBe(true);
    expect(entry(view, "Zoom Out").disabled).toBe(false);
    expect(entry(view, "Dark Theme")).toMatchObject({ disabled: true, hint: "Current" });
    expect(entry(view, "Light Theme").disabled).toBe(false);
    expect(entry(group("View"), "Actual Size").disabled).toBe(true);
  });

  it("opens Settings on the category it names", () => {
    const onSettings = vi.fn();
    const view = group("View", { onSettings });

    expect(view.filter((one) => one.label.startsWith("Settings")).map((one) => one.label)).toEqual([
      "Settings › Appearance",
      "Settings › Library",
      "Settings › Online",
      "Settings › About",
    ]);
    entry(view, "Settings › Online").onSelect?.();
    expect(onSettings).toHaveBeenCalledWith("online");
  });

  it("offers the two ways to start a playlist", () => {
    expect(group("Library").map((one) => one.label)).toEqual([
      "New Playlist",
      "New Smart Playlist…",
    ]);
  });
});

describe("flatten", () => {
  it("drops separators and spells a submenu as its path", () => {
    const onMix = vi.fn();
    const flat = flatten([
      { label: "Play", onSelect: noop },
      { kind: "separator" },
      { label: "Add to Playlist", submenu: [{ label: "Mix", onSelect: onMix }] },
    ]) as Entry[];

    expect(flat.map((one) => one.label)).toEqual(["Play", "Add to Playlist › Mix"]);
    flat[1]?.onSelect?.();
    expect(onMix).toHaveBeenCalled();
  });

  it("drops the parent's ellipsis and greys the children of a greyed parent", () => {
    const flat = flatten([
      {
        label: "Open Artist on…",
        disabled: true,
        submenu: [{ label: "Last.fm", onSelect: noop }],
      },
    ]) as Entry[];

    expect(flat).toMatchObject([{ label: "Open Artist on › Last.fm", disabled: true }]);
  });
});
