import type { PaletteGroup } from "../../components/ui/CommandPalette";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { BUILT_INS, VIEWS } from "../../components/ui/LibraryNav";
import type { PlaybackStatus, Playlist, Track } from "../../ipc";
import { VIEW_TITLES, type ViewTab } from "../library/store";
import type { Menu } from "./menus";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./SettingsDialog";
import { THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from "./theme";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./zoom";

export type PlaybackCommand = "toggle" | "next" | "previous" | "stop" | "mute" | "repeat";

/**
 * What the command palette offers, given the state of the app.
 *
 * Pure for the reason `menus()` is. The menu bar's entries come in as `menus`,
 * already built, so the palette cannot offer the bar's actions differently.
 */
export function commands({
  menus,
  tab,
  playlistId,
  playlists,
  back,
  forward,
  status,
  track,
  muted,
  repeatOne,
  zoom,
  theme,
  onPlayback,
  onZoom,
  onTheme,
  onSettings,
  onNewPlaylist,
  onNewSmartPlaylist,
  onShowTab,
  onShowPlaylist,
  onBack,
  onForward,
  onShowTrackArtist,
  onShowTrackGroup,
}: {
  menus: Menu[];
  tab: ViewTab;
  playlistId: number | null;
  playlists: Playlist[];
  /** What back would land on, named as the arrow's tooltip names it; null with nothing behind. */
  back: string | null;
  forward: string | null;
  status: PlaybackStatus;
  /** The engine's track, which it keeps through a stop to resume. */
  track: Track | null;
  muted: boolean;
  repeatOne: boolean;
  zoom: number;
  theme: ThemePreference;
  onPlayback: (command: PlaybackCommand) => void;
  onZoom: (action: "in" | "out" | "reset") => void;
  onTheme: (preference: ThemePreference) => void;
  onSettings: (category: SettingsCategory) => void;
  onNewPlaylist: () => void;
  onNewSmartPlaylist: () => void;
  onShowTab: (tab: ViewTab) => void;
  onShowPlaylist: (playlist: Playlist) => void;
  onBack: () => void;
  onForward: () => void;
  onShowTrackArtist: (track: Track) => void;
  onShowTrackGroup: (track: Track) => void;
}): PaletteGroup[] {
  const loaded = status !== "stopped";
  const hasTrack = track !== null;

  const playback: MenuItem[] = [
    {
      label: status === "playing" ? "Pause" : "Play",
      shortcut: "Space",
      disabled: !hasTrack,
      hint: hasTrack ? undefined : "Nothing queued",
      onSelect: () => onPlayback("toggle"),
    },
  ];
  // The transport is off screen while stopped, and so are these.
  if (loaded) {
    playback.push(
      { label: "Next", onSelect: () => onPlayback("next") },
      { label: "Previous", onSelect: () => onPlayback("previous") },
      { label: "Stop", onSelect: () => onPlayback("stop") },
    );
  }
  playback.push(
    { label: muted ? "Unmute" : "Mute", onSelect: () => onPlayback("mute") },
    {
      label: repeatOne ? "Stop Repeating" : "Repeat One",
      onSelect: () => onPlayback("repeat"),
    },
  );

  const view: MenuItem[] = [
    {
      label: "Zoom In",
      shortcut: "Ctrl+Plus",
      disabled: zoom >= MAX_ZOOM,
      onSelect: () => onZoom("in"),
    },
    {
      label: "Zoom Out",
      shortcut: "Ctrl+Minus",
      disabled: zoom <= MIN_ZOOM,
      onSelect: () => onZoom("out"),
    },
    {
      label: "Actual Size",
      shortcut: "Ctrl+0",
      disabled: zoom === DEFAULT_ZOOM,
      onSelect: () => onZoom("reset"),
    },
    ...THEME_PREFERENCES.map(
      (preference): MenuItem => ({
        label: `${THEME_LABELS[preference]} Theme`,
        disabled: preference === theme,
        hint: preference === theme ? "Current" : undefined,
        onSelect: () => onTheme(preference),
      }),
    ),
    {
      label: "Settings",
      submenu: SETTINGS_CATEGORIES.map(({ value, label }) => ({
        label,
        onSelect: () => onSettings(value),
      })),
    },
  ];

  // The sidebar's sections, the view already open left out as a click on it
  // would do nothing.
  const playlistEntry = (playlist: Playlist): MenuItem => ({
    id: `playlist:${playlist.id}`,
    label: playlist.name,
    onSelect: () => onShowPlaylist(playlist),
  });
  const elsewhere = playlists.filter((playlist) => playlist.id !== playlistId);
  const own = elsewhere.filter((playlist) => playlist.builtIn === null);

  const goTo: MenuItem[] = [
    ...VIEWS.filter((view) => view !== tab || playlistId !== null).map(
      (view): MenuItem => ({ label: VIEW_TITLES[view], onSelect: () => onShowTab(view) }),
    ),
    ...BUILT_INS.flatMap(([builtIn]) =>
      elsewhere.filter((playlist) => playlist.builtIn === builtIn).map(playlistEntry),
    ),
  ];
  if (back !== null) {
    goTo.push({ label: `Back to ${back}`, shortcut: "Alt+←", onSelect: onBack });
  }
  if (forward !== null) {
    goTo.push({ label: `Forward to ${forward}`, shortcut: "Alt+→", onSelect: onForward });
  }
  // Only while the player bar shows the track these name.
  if (loaded && track !== null) {
    const artist = tagged(track.album_artist) ?? tagged(track.artist);
    const album = tagged(track.album);
    if (artist !== null) {
      goTo.push({ label: `Artist: ${artist}`, onSelect: () => onShowTrackArtist(track) });
    }
    // Without an album `showTrackGroup` lands on the artist, which the entry
    // above already is.
    if (album !== null) {
      goTo.push({ label: `Release: ${album}`, onSelect: () => onShowTrackGroup(track) });
    }
  }

  const library: MenuItem[] = [
    { label: "New Playlist", onSelect: onNewPlaylist },
    { label: "New Smart Playlist…", onSelect: onNewSmartPlaylist },
  ];

  return [
    { group: "Go to", items: goTo },
    // A disabled menu is one the bar cannot open, so it has nothing to offer.
    ...menus
      .filter((menu) => menu.disabled !== true)
      .map((menu) => ({ group: menu.label, items: flatten(menu.items) })),
    { group: "Playback", items: playback },
    { group: "View", items: flatten(view) },
    { group: "Library", items: library },
    // Last, however many there are, so they cannot push the commands down.
    {
      group: "Smart Playlists",
      items: own.filter((playlist) => playlist.kind === "smart").map(playlistEntry),
    },
    {
      group: "Playlists",
      items: own.filter((playlist) => playlist.kind !== "smart").map(playlistEntry),
    },
  ].filter((group) => group.items.length > 0);
}

/**
 * One level of entries: separators dropped, submenus spelled `Parent › Child`.
 *
 * A child of a greyed parent is greyed, since the menu would not open to it.
 * The parent's ellipsis goes: `Open Artist on… › Last.fm` reads as two stops.
 */
export function flatten(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item): MenuItem[] => {
    if (item.kind === "separator") {
      return [];
    }
    if (item.submenu === undefined) {
      return [item];
    }
    const parent = item.label.replace(/…$/, "");
    return flatten(item.submenu).map((child) =>
      child.kind === "separator"
        ? child
        : {
            ...child,
            label: `${parent} › ${child.label}`,
            disabled: item.disabled === true || child.disabled,
          },
    );
  });
}

function tagged(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}
