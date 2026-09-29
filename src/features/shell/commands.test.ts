import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../components/ui/ContextMenu";
import type { Playlist, Track } from "../../ipc";
import { commands, flatten } from "./commands";
import type { Menu } from "./menus";

const noop = () => {};

function build(overrides: Partial<Parameters<typeof commands>[0]> = {}) {
  return commands({
    menus: [],
    tab: "songs",
    playlistId: null,
    playlists: [],
    back: null,
    forward: null,
    status: "stopped",
    track: null,
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
    onShowTab: noop,
    onShowPlaylist: noop,
    onBack: noop,
    onForward: noop,
    onShowTrackArtist: noop,
    onShowTrackGroup: noop,
    ...overrides,
  });
}

type Entry = Exclude<MenuItem, { kind: "separator" }>;

function track(over: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "D:/Music/Guitar/Tokyo/01 Maki.mp3",
    duration_ms: 208_000,
    title: "Maki",
    artist: "Guitar",
    album: "Tokyo",
    album_artist: null,
    genre: null,
    year: null,
    track_no: null,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    release_mbid: null,
    release_group_mbid: null,
    ...over,
  };
}

function playlist(id: number, name: string, over: Partial<Playlist> = {}): Playlist {
  return { id, name, kind: "static", trackCount: 0, createdAt: 0, builtIn: null, ...over };
}

const labels = (items: Entry[]) => items.map((one) => one.label);

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
      "Go to",
      "File",
      "Help",
      "Playback",
      "View",
      "Library",
    ]);
  });

  it("names Play or Pause for what the press does now", () => {
    expect(entry(group("Playback", { track: track(), status: "paused" }), "Play")).toBeDefined();
    expect(entry(group("Playback", { track: track(), status: "playing" }), "Pause")).toBeDefined();
    expect(entry(group("Playback", { muted: true }), "Unmute")).toBeDefined();
    expect(entry(group("Playback", { repeatOne: true }), "Stop Repeating")).toBeDefined();
  });

  it("keeps a toggle's id when its label turns over, so Recent still finds it", () => {
    const ids = (overrides: Partial<Parameters<typeof commands>[0]>) =>
      group("Playback", { track: track(), ...overrides }).map((one) => one.id);

    expect(ids({ status: "paused", muted: false, repeatOne: false })).toEqual(
      ids({ status: "playing", muted: true, repeatOne: true }),
    );
  });

  it("greys Play with nothing queued, and offers no transport while stopped", () => {
    const playback = group("Playback");

    expect(entry(playback, "Play")).toMatchObject({ disabled: true, hint: "Nothing queued" });
    expect(playback.map((one) => one.label)).toEqual(["Play", "Mute", "Repeat One"]);
    expect(group("Playback", { track: track(), status: "paused" }).map((one) => one.label)).toEqual(
      ["Play", "Next", "Previous", "Stop", "Mute", "Repeat One"],
    );
  });

  it("runs the playback command it names", () => {
    const onPlayback = vi.fn();
    entry(
      group("Playback", { onPlayback, track: track(), status: "playing" }),
      "Next",
    ).onSelect?.();

    expect(onPlayback).toHaveBeenCalledWith("next");
  });

  it("names a keystroke only where one is bound", () => {
    const shortcuts = Object.fromEntries(
      [...group("Playback", { track: track(), status: "playing" }), ...group("View")].map((one) => [
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

describe("Go to", () => {
  it("offers every view but the open one", () => {
    expect(labels(group("Go to", { tab: "albums" }))).toEqual([
      "Songs",
      "Artists",
      "Genres",
      "Statistics",
    ]);
  });

  it("offers the open view's tab too while a playlist is showing", () => {
    expect(labels(group("Go to", { tab: "albums", playlistId: 7 }))).toContain("Releases");
  });

  it("opens the view it names", () => {
    const onShowTab = vi.fn();
    entry(group("Go to", { onShowTab }), "Statistics").onSelect?.();

    expect(onShowTab).toHaveBeenCalledWith("stats");
  });

  it("files the built-ins with the views and the rest under their sidebar sections", () => {
    const playlists = [
      playlist(3, "Mix"),
      playlist(4, "Unplayed Jazz", { kind: "smart" }),
      playlist(1, "Recently Added", { kind: "smart", builtIn: "recentlyAdded" }),
      playlist(2, "Favorites", { kind: "smart", builtIn: "favorites" }),
    ];

    expect(labels(group("Go to", { playlists })).slice(-2)).toEqual([
      "Favorites",
      "Recently Added",
    ]);
    expect(labels(group("Smart Playlists", { playlists }))).toEqual(["Unplayed Jazz"]);
    expect(labels(group("Playlists", { playlists }))).toEqual(["Mix"]);
    expect(
      build({ playlists })
        .map((one) => one.group)
        .slice(-2),
    ).toEqual(["Smart Playlists", "Playlists"]);
  });

  it("leaves out the open playlist and opens the one it names", () => {
    const onShowPlaylist = vi.fn();
    const mix = playlist(3, "Mix");
    const playlists = [mix, playlist(4, "Road Trip")];

    expect(labels(group("Playlists", { playlists, playlistId: 4 }))).toEqual(["Mix"]);
    entry(group("Playlists", { playlists, onShowPlaylist }), "Mix").onSelect?.();
    expect(onShowPlaylist).toHaveBeenCalledWith(mix);
  });

  it("tells apart two playlists with one name", () => {
    const playlists = [playlist(3, "New Playlist"), playlist(4, "New Playlist")];

    expect(group("Playlists", { playlists }).map((one) => one.id)).toEqual([
      "playlist:3",
      "playlist:4",
    ]);
  });

  it("offers back and forward only where there is somewhere to go", () => {
    const onBack = vi.fn();
    const goTo = labels(group("Go to"));

    expect(goTo.some((label) => label.startsWith("Back"))).toBe(false);
    expect(goTo.some((label) => label.startsWith("Forward"))).toBe(false);

    const both = group("Go to", { back: "Tokyo", forward: "Mix", onBack });
    expect(entry(both, "Back to Tokyo").shortcut).toBe("Alt+←");
    expect(entry(both, "Forward to Mix").shortcut).toBe("Alt+→");
    entry(both, "Back to Tokyo").onSelect?.();
    expect(onBack).toHaveBeenCalled();
  });

  it("goes to what is playing only while something is", () => {
    const playing = track({ album_artist: "Various" });
    const onShowTrackArtist = vi.fn();
    const onShowTrackGroup = vi.fn();
    const goTo = group("Go to", {
      status: "paused",
      track: playing,
      onShowTrackArtist,
      onShowTrackGroup,
    });

    entry(goTo, "Artist: Various").onSelect?.();
    entry(goTo, "Release: Tokyo").onSelect?.();
    expect(onShowTrackArtist).toHaveBeenCalledWith(playing);
    expect(onShowTrackGroup).toHaveBeenCalledWith(playing);

    const stopped = labels(group("Go to", { track: playing }));
    expect(stopped.some((label) => label.startsWith("Artist:"))).toBe(false);
  });

  it("leaves out a now-playing entry whose tag is empty", () => {
    const goTo = labels(
      group("Go to", { status: "playing", track: track({ artist: " ", album: null }) }),
    );

    expect(goTo.some((label) => label.startsWith("Artist:"))).toBe(false);
    expect(goTo.some((label) => label.startsWith("Release:"))).toBe(false);
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
