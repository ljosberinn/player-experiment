import { openUrl } from "@tauri-apps/plugin-opener";
import { revealTrack } from "../../ipc";
import { useEditorStore } from "../editor/store";
import { type ExportChoice, exportChoice } from "../export/scope";
import { rowMenuItems } from "../library/rowMenu";
import { useScanStore } from "../library/scan";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "../player/store";
import { usePlaylistsStore } from "../playlists/store";
import { useCurrentPlaylist } from "../playlists/useCurrentPlaylist";
import { exportSelectionLabel, type Menu, menus, REPOSITORY } from "./menus";

/**
 * The menu bar's contents, rebuilt whenever anything they depend on changes.
 *
 * Edit serves the *same* items the right-click menu does, built by the same
 * `rowMenuItems` - which is the whole point of the menu existing. A menu bar
 * that offered a different set of song actions from the row menu would be two
 * things to keep in step, and the one that got forgotten would be this one.
 */
export function useAppMenus({
  onExport,
  onRemoveMissing,
  onSettings,
}: {
  onExport: (choice: ExportChoice) => void;
  onRemoveMissing: () => void;
  onSettings: () => void;
}): Menu[] {
  const stats = useLibraryStore((s) => s.stats);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const selection = useLibraryStore((s) => s.selection);
  // Reads the page cache when the menu is built rather than subscribing to it:
  // the Edit menu is rebuilt when the selection changes, and the row a
  // selection of one names is the row that was just clicked.
  const trackById = useLibraryStore((s) => s.trackById);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);
  const play = usePlayerStore((s) => s.play);
  const canUndoTags = useEditorStore((s) => s.canUndo);
  const openEditor = useEditorStore((s) => s.open);
  const undoTags = useEditorStore((s) => s.undo);
  const addFolder = useScanStore((s) => s.addFolder);
  const rescan = useScanStore((s) => s.rescan);
  const currentPlaylist = useCurrentPlaylist();

  const selectedIds = [...selection.ids];

  return menus({
    missingCount: stats.missing,
    canUndoTags,
    hasExportTarget: selectedIds.length > 0 || currentPlaylist !== null,
    exportSelectionLabel: exportSelectionLabel(selectedIds.length, currentPlaylist?.name ?? null),
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
            // By id rather than by row index: the menu bar has no row under a
            // pointer to start from, and the selection is what it acts on.
            onPlay: () => void play(selectedIds, 0),
            onGetInfo: () => void openEditor(selectedIds),
            onAddTo: (id) => void addTracks(id, selectedIds),
            onRemove: () => {
              if (playlistId !== null) {
                void removeTracks(playlistId, selectedIds);
              }
            },
            onExport: () => onExport(exportChoice(selectedIds, null)),
            onReveal: () => void revealTrack(selectedIds[0] as number),
            onOpenUrl: (url) => void openUrl(url).catch(() => {}),
          }),
    onAddFolder: () => void addFolder(),
    onRescan: () => void rescan(),
    onRemoveMissing,
    onUndoTags: () => void undoTags(),
    onSettings,
    onExportAll: () => onExport(exportChoice([], null)),
    onExportSelection: () => onExport(exportChoice(selectedIds, currentPlaylist)),
    // The only outbound link in the app, and the only URL its capability
    // allows. A failure here is not worth an error dialog: the browser either
    // opened or it did not, and the user can see which.
    onOpenRepository: () => void openUrl(REPOSITORY).catch(() => {}),
  });
}
