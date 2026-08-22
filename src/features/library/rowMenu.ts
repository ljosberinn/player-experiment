import type { MenuItem } from "../../components/ui/ContextMenu";
import type { Playlist, Track } from "../../ipc";
import { albumLinks, artistLinks, linkArtist } from "./externalLinks";

/** What the lookup entries need off a row; the rest of a `Track` is irrelevant. */
export type LinkableTrack = Pick<Track, "artist" | "album_artist" | "album">;

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
  track,
  onPlay,
  onGetInfo,
  onAddTo,
  onRemove,
  onExport,
  onReveal,
  onOpenUrl,
}: {
  /** How many rows the action applies to. */
  count: number;
  playlists: Playlist[];
  /** The playlist being viewed, if any. */
  openPlaylist: Playlist | null;
  /**
   * The row the lookup entries name, or null when there is none to name -
   * several rows selected from the menu bar, or a page that has not arrived.
   */
  track: LinkableTrack | null;
  onPlay: () => void;
  onGetInfo: () => void;
  onAddTo: (playlistId: number) => void;
  onRemove: () => void;
  onExport: () => void;
  onReveal: () => void;
  onOpenUrl: (url: string) => void;
}): MenuItem[] {
  const songs = `${count} Song${count === 1 ? "" : "s"}`;

  const items: MenuItem[] = [
    { label: "Play", onSelect: onPlay },
    { kind: "separator" },
    { label: count === 1 ? "Edit" : `Edit ${songs}`, onSelect: onGetInfo },
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

  const lookups = lookupItems(track, count, onOpenUrl);
  if (lookups.length > 0) {
    items.push({ kind: "separator" }, ...lookups);
  }

  return items;
}

/**
 * Where to look this row up, out on the web.
 *
 * Absent rather than greyed when the tag is empty: an entry offering to look
 * up an artist the row does not name has nothing behind it, and unlike the
 * playlist case there is no question it would answer. Disabled with several
 * rows selected, because two rows are two artists and picking one would be a
 * guess at which - the same rule "Show in Explorer" follows.
 */
function lookupItems(
  track: LinkableTrack | null,
  count: number,
  onOpenUrl: (url: string) => void,
): MenuItem[] {
  if (track === null) {
    return [];
  }

  const artist = linkArtist(track);
  const album = (track.album ?? "").trim();
  const items: MenuItem[] = [];
  const submenu = (links: { label: string; url: string }[]): MenuItem[] =>
    links.map((link) => ({ label: link.label, onSelect: () => onOpenUrl(link.url) }));

  if (artist !== "") {
    items.push({
      label: "Open Artist on…",
      disabled: count !== 1,
      submenu: submenu(artistLinks(artist)),
    });
  }
  if (album !== "") {
    items.push({
      label: "Open Album on…",
      disabled: count !== 1,
      submenu: submenu(albumLinks(artist, album)),
    });
  }

  return items;
}
