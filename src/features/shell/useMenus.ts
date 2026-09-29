import { openUrl } from "@tauri-apps/plugin-opener";
import { revealTrack } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { type ExportChoice, exportChoice } from "../export/scope";
import { useLastfmStore } from "../lastfm/store";
import { rowMenuItems } from "../library/rowMenu";
import { useScanStore } from "../library/scan";
import { useLibraryStore } from "../library/store";
import { useLoveEntry } from "../love/loveEntry";
import { usePlayerStore } from "../player/store";
import { usePlaylistsStore } from "../playlists/store";
import { showLastPlay } from "../stats/lastPlay";
import { useTagsourceStore } from "../tagsource/store";
import { exportSelectionLabel, type Menu, menus, REPOSITORY } from "./menus";
import type { SettingsCategory } from "./SettingsDialog";

/** What `App` owns that a menu entry can ask for. */
export interface MenuWiring {
  /** Opens the confirm dialog; the flag it sets lives in `App`. */
  onRemoveMissing: () => void;
  onSettings: (category?: SettingsCategory) => void;
  /** Runs a save dialog and writes the file; the notice it sets is `App`'s. */
  onExport: (choice: ExportChoice) => void;
}

/**
 * `menus()`, wired to the stores.
 *
 * One hook for the menu bar and the command palette, so the two cannot offer
 * different entries for the same state. Subscribes to the selection, so the
 * component calling it re-renders on every click in the table.
 */
export function useMenus({ onRemoveMissing, onSettings, onExport }: MenuWiring): Menu[] {
  const selection = useLibraryStore((s) => s.selection);
  // Reads the page cache when the menu is built rather than subscribing to it:
  // the Edit menu is rebuilt when the selection changes, and the row a
  // selection of one names is the row that was just clicked.
  const trackById = useLibraryStore((s) => s.trackById);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const missingCount = useLibraryStore((s) => s.stats.missing);
  const removedCount = useLibraryStore((s) => s.stats.removed);
  const askRemoval = useLibraryStore((s) => s.askRemoval);
  const forgetRemoved = useLibraryStore((s) => s.forgetRemoved);

  const playlists = usePlaylistsStore((s) => s.playlists);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);

  const openEditor = useEditorStore((s) => s.open);
  const openLookup = useTagsourceStore((s) => s.open);

  // Three scalars, all of which change only when the user connects or
  // disconnects - so the Account menu can say who is signed in without anything
  // else re-rendering for it.
  const lastfmConfigured = useLastfmStore((s) => s.configured);
  const lastfmUsername = useLastfmStore((s) => s.username);
  const lastfmDisconnect = useLastfmStore((s) => s.disconnect);

  const play = usePlayerStore((s) => s.play);

  // Actions only: File's two entries start a scan, and what a running scan
  // reports is `ScanBar`'s business, not the menu bar's.
  const addFolder = useScanStore((s) => s.addFolder);
  const rescan = useScanStore((s) => s.rescan);

  const currentPlaylist = playlists.find((playlist) => playlist.id === playlistId) ?? null;
  const selectedIds = [...selection.ids];
  const loving = useLoveEntry(selectedIds, trackById);

  return menus({
    selectionCount: selectedIds.length,
    missingCount,
    removedCount,
    hasExportTarget: selectedIds.length > 0 || currentPlaylist !== null,
    exportSelectionLabel: exportSelectionLabel(selectedIds.length, currentPlaylist?.name ?? null),
    lastfmConfigured,
    lastfmUsername,
    // Edit serves the *same* items the right-click menu does, built by the
    // same `rowMenuItems` - which is the whole point of the menu existing.
    // A menu bar that offered a different set of song actions from the row
    // menu would be two things to keep in step, and the one that got
    // forgotten would be this one.
    rowItems:
      selectedIds.length === 0
        ? []
        : rowMenuItems({
            count: selectedIds.length,
            playlists,
            openPlaylist: currentPlaylist,
            // Only with exactly one row selected is there a row to look up,
            // and only then is it cached to be found by id.
            track: selectedIds.length === 1 ? trackById(selectedIds[0] as number) : null,
            // By id rather than by row index: the menu bar has no row under
            // a pointer to start from, and the selection is what it acts on.
            onPlay: () => void play(selectedIds, 0),
            onEdit: () => void openEditor(selectedIds),
            onLookup: () => void openLookup(selectedIds),
            onAddTo: (id) => void addTracks(id, selectedIds),
            onRemove: () => {
              if (playlistId !== null) {
                void removeTracks(playlistId, selectedIds);
              }
            },
            loving,
            onExport: () => onExport(exportChoice(selectedIds, null)),
            onReveal: () => void revealTrack(selectedIds[0] as number),
            onShowLastPlay: (at) => void showLastPlay(at),
            onOpenUrl: (url) => void openUrl(url).catch(() => {}),
          }),
    onAddFolder: () => void addFolder(),
    onRescan: () => void rescan(),
    onRemoveFromLibrary: () => askRemoval(selectedIds),
    onRemoveMissing,
    onForgetRemoved: () => void forgetRemoved(),
    onSettings,
    onExportAll: () => onExport(exportChoice([], null)),
    onExportSelection: () => onExport(exportChoice(selectedIds, currentPlaylist)),
    // Local only - last.fm has no method to revoke a session key, so this
    // forgets it and the Settings pane says where to revoke it properly.
    onLastfmDisconnect: () => void lastfmDisconnect(),
    // The only outbound link in the app, and the only URL its capability
    // allows. A failure here is not worth an error dialog: the browser
    // either opened or it did not, and the user can see which.
    onOpenRepository: () => void openUrl(REPOSITORY).catch(() => {}),
  });
}
