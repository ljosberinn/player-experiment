import type { PaletteGroup } from "../../components/ui/CommandPalette";
import type { MenuItem } from "../../components/ui/ContextMenu";
import type { PlaybackStatus } from "../../ipc";
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
  status,
  hasTrack,
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
}: {
  menus: Menu[];
  status: PlaybackStatus;
  /** Whether the engine holds a track to resume, which it keeps through a stop. */
  hasTrack: boolean;
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
}): PaletteGroup[] {
  const loaded = status !== "stopped";

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

  const library: MenuItem[] = [
    { label: "New Playlist", onSelect: onNewPlaylist },
    { label: "New Smart Playlist…", onSelect: onNewSmartPlaylist },
  ];

  return [
    // A disabled menu is one the bar cannot open, so it has nothing to offer.
    ...menus
      .filter((menu) => menu.disabled !== true)
      .map((menu) => ({ group: menu.label, items: flatten(menu.items) })),
    { group: "Playback", items: playback },
    { group: "View", items: flatten(view) },
    { group: "Library", items: library },
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
