import { useEffect, useState } from "react";
import { CommandPalette } from "../../components/ui/CommandPalette";
import { destinationOf } from "../library/HistoryNav";
import { backEntry, forwardEntry, type HistoryEntry } from "../library/history";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "../player/store";
import { NEW_PLAYLIST_NAME, usePlaylistsStore } from "../playlists/store";
import { commands } from "./commands";
import { foundGroups, usePaletteSearch } from "./paletteSearch";
import { useThemeStore } from "./themeStore";
import { type MenuWiring, useMenus } from "./useMenus";
import { useZoomStore } from "./zoomStore";

/** Whether a keydown is Ctrl+K, and nothing else held. */
export function isPaletteKey(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return (
    (event.ctrlKey === true || event.metaKey === true) &&
    event.altKey !== true &&
    event.shiftKey !== true &&
    event.key.toLowerCase() === "k"
  );
}

/**
 * Ctrl+K, and the palette while it is open.
 *
 * Holds the open flag itself rather than in `App`, so opening it re-renders
 * this and not the tree around it. Closed, it renders nothing and subscribes
 * to nothing: the menus' wiring follows the selection, and the palette is
 * built only when there is one to draw.
 */
export function AppPalette(wiring: MenuWiring) {
  const [open, setOpen] = useState(false);

  // Claimed from a text field too, as Ctrl+F is: WebView2 acts on whatever
  // the page leaves alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteKey(event)) {
        return;
      }
      event.preventDefault();
      // The palette is a `.dialog` itself, so its own flag is read first.
      setOpen((was) => (was ? false : document.querySelector(".dialog") === null));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return open ? <OpenPalette {...wiring} onClose={() => setOpen(false)} /> : null;
}

function OpenPalette({ onClose, ...wiring }: MenuWiring & { onClose: () => void }) {
  const menus = useMenus(wiring);
  const tab = useLibraryStore((s) => s.tab);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const history = useLibraryStore((s) => s.history);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const status = usePlayerStore((s) => s.status);
  const track = usePlayerStore((s) => s.track);
  const muted = usePlayerStore((s) => s.muted);
  const repeatOne = usePlayerStore((s) => s.repeatOne);
  const zoom = useZoomStore((s) => s.factor);
  const theme = useThemeStore((s) => s.preference);
  const [query, setQuery] = useState("");
  const { found, searching } = usePaletteSearch(query);

  const name = (entry: HistoryEntry | null) =>
    entry === null ? null : destinationOf(entry, playlists);

  return (
    <CommandPalette
      groups={[
        ...commands({
          menus,
          tab,
          playlistId,
          playlists,
          back: name(backEntry(history)),
          forward: name(forwardEntry(history)),
          status,
          track,
          muted,
          repeatOne,
          zoom,
          theme,
          onPlayback: (command) => {
            const player = usePlayerStore.getState();
            const run = {
              toggle: player.toggle,
              next: player.next,
              previous: player.previous,
              stop: player.stop,
              mute: player.toggleMute,
              repeat: player.toggleRepeatOne,
            }[command];
            void run();
          },
          onZoom: (action) => {
            const store = useZoomStore.getState();
            void (action === "reset" ? store.reset() : store.step(action === "in" ? 1 : -1));
          },
          onTheme: (preference) => void useThemeStore.getState().set(preference),
          onSettings: wiring.onSettings,
          onNewPlaylist: () => void usePlaylistsStore.getState().create(NEW_PLAYLIST_NAME),
          onNewSmartPlaylist: () => void usePlaylistsStore.getState().editSmart(null),
          onShowTab: (view) => void useLibraryStore.getState().showTab(view),
          onShowPlaylist: (playlist) => void useLibraryStore.getState().showPlaylist(playlist),
          onBack: () => void useLibraryStore.getState().back(),
          onForward: () => void useLibraryStore.getState().forward(),
          onShowTrackArtist: (playing) => void useLibraryStore.getState().showTrackArtist(playing),
          onShowTrackGroup: (playing) => void useLibraryStore.getState().showTrackGroup(playing),
        }),
        ...(found === null
          ? []
          : foundGroups(found, {
              onShowGroup: (kind, group) => void useLibraryStore.getState().showGroup(kind, group),
              onPlay: (hit) => void usePlayerStore.getState().play([hit.id], 0),
            })),
      ]}
      searching={searching}
      onQueryChange={setQuery}
      onClose={onClose}
    />
  );
}
