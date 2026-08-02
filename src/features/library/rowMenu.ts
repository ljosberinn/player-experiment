import type { MenuItem } from "../../components/ui/ContextMenu";
import type { Playlist } from "../../ipc";

/**
 * What the right-click menu on a song row offers.
 *
 * Pure, so the rules below are testable without a pointer: which entries
 * appear, when they are disabled, and what they say. `SongTable` supplies the
 * handlers and renders the result.
 */
export function rowMenuItems({
  count,
  playlists,
  openPlaylist,
  onPlay,
  onGetInfo,
  onAddTo,
  onRemove,
  onExport,
  onReveal,
}: {
  /** How many rows the action applies to. */
  count: number;
  playlists: Playlist[];
  /** The playlist being viewed, if any. */
  openPlaylist: Playlist | null;
  onPlay: () => void;
  onGetInfo: () => void;
  onAddTo: (playlistId: number) => void;
  onRemove: () => void;
  onExport: () => void;
  onReveal: () => void;
}): MenuItem[] {
  const songs = `${count} Song${count === 1 ? "" : "s"}`;

  const items: MenuItem[] = [
    { label: "Play", onSelect: onPlay },
    { kind: "separator" },
    { label: count === 1 ? "Get Info" : `Get Info for ${songs}`, onSelect: onGetInfo },
    {
      label: "Add to Playlist",
      // Smart playlists are excluded rather than shown disabled: their
      // membership is their filter, so "add" is not a thing you can do to
      // one, and offering it greyed out invites the question every time.
      submenu: playlists
        .filter((playlist) => playlist.kind === "static")
        .map((playlist) => ({
          label: playlist.name,
          onSelect: () => onAddTo(playlist.id),
        })),
    },
  ];

  // Only inside a static playlist, where there is a membership row to remove.
  // In the library this action would have to mean deleting the file, which is
  // not something a menu should offer next to "Get Info".
  if (openPlaylist?.kind === "static") {
    items.push({
      label: count === 1 ? "Remove from Playlist" : `Remove ${songs} from Playlist`,
      onSelect: onRemove,
    });
  }

  items.push(
    { kind: "separator" },
    { label: `Export ${songs}…`, onSelect: onExport },
    {
      label: "Show in Explorer",
      // Reveals one file. With several selected there is no single thing to
      // show, and picking one arbitrarily would be a guess at which.
      disabled: count !== 1,
      onSelect: onReveal,
    },
  );

  return items;
}
