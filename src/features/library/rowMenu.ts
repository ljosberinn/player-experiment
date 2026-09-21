import type { MenuItem } from "../../components/ui/ContextMenu";
import type { Playlist, Track } from "../../ipc";
import { albumLinks, artistLinks, linkArtist } from "./externalLinks";

/** What the lookup entries need off a row; the rest of a `Track` is irrelevant. */
export type LinkableTrack = Pick<Track, "artist" | "album_artist" | "album">;

/**
 * What the Love entry needs to know about the selection.
 *
 * Absent on a build with no last.fm key: the entry is then not greyed but
 * gone, the way the lookup entries are absent rather than greyed when the tag
 * they would open is empty. There is no account to connect and no question the
 * entry would answer.
 */
export interface Loving {
  /** Whether an account is connected. */
  connected: boolean;
  /**
   * Whether every selected row is already loved, so the entry is the way back
   * out. A mixed selection reads as not loved: Love is the act that makes the
   * whole selection agree, and Unlove on it would undo loves the user never
   * made here.
   */
  loved: boolean;
  /**
   * Whether every selected row carries both an artist and a title.
   *
   * `plays::match_key` has no key for a song missing either, so a love could
   * be sent but never remembered, and the backend refuses the selection whole.
   */
  keyed: boolean;
  onToggle: (loved: boolean) => void;
}

/** What the Love entry needs off a row. */
type LoveableTrack = Pick<Track, "artist" | "title">;

/**
 * The Love entry's state, or nothing on a build with no last.fm key.
 *
 * Pure so both menus that offer the entry - the right-click menu and the Edit
 * menu - decide it the same way, and so the rules are testable without a
 * store.
 *
 * **A row the table no longer caches counts as keyed.** A selection outlives
 * the pages behind it, and greying the entry because a page was evicted would
 * make the menu's answer depend on how far the user has scrolled. The backend
 * refuses an unkeyable selection whole, and says so.
 */
export function lovingFor({
  ids,
  trackById,
  configured,
  connected,
  loved,
  onToggle,
}: {
  ids: number[];
  /** A cached row, or null where the table no longer holds its page. */
  trackById: (id: number) => LoveableTrack | null;
  /** Whether this build carries a last.fm API key at all. */
  configured: boolean;
  connected: boolean;
  loved: ReadonlySet<number>;
  onToggle: (loved: boolean) => void;
}): Loving | undefined {
  if (!configured || ids.length === 0) {
    return undefined;
  }
  return {
    connected,
    loved: ids.every((id) => loved.has(id)),
    keyed: ids.every((id) => {
      const track = trackById(id);
      return track === null || (tagged(track.artist) && tagged(track.title));
    }),
    onToggle,
  };
}

/** Whether a tag holds something `plays::match_key` can use. */
function tagged(value: string | null): boolean {
  return (value ?? "").trim() !== "";
}

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
  onEdit,
  onLookup,
  onAddTo,
  onRemove,
  onRemoveFromLibrary,
  loving,
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
  onEdit: () => void;
  /** Opens the MusicBrainz lookup on the selection. */
  onLookup: () => void;
  onAddTo: (playlistId: number) => void;
  onRemove: () => void;
  /**
   * Removes the rows from the library itself, or absent where that is not on
   * offer here.
   *
   * The one entry the Edit menu does not serve: the user wants it in File,
   * beside the other row-destroying entry, so `AppMenus` leaves this undefined
   * and `menus()` builds its own. Present on right-click, present in File, not
   * twice.
   */
  onRemoveFromLibrary?: (() => void) | undefined;
  /** Absent on a build with no last.fm key, which offers no Love entry. */
  loving?: Loving | undefined;
  onExport: () => void;
  onReveal: () => void;
  onOpenUrl: (url: string) => void;
}): MenuItem[] {
  const songs = `${count} Song${count === 1 ? "" : "s"}`;

  const items: MenuItem[] = [
    { label: "Play", onSelect: onPlay },
    { kind: "separator" },
    // `useSelectionShortcuts` binds this, so the menu can name it. The two
    // entries below that carry a keystroke are the only two in the app that
    // have one; the sheet's `Ctrl+E` on Show in Explorer names nothing.
    { label: count === 1 ? "Edit" : `Edit ${songs}`, shortcut: "Ctrl+I", onSelect: onEdit },
    // Beside Edit because it is the same act by another route: the tags of
    // these songs, typed by hand or fetched. Ellipsized - it opens a dialog
    // and writes nothing until that dialog is confirmed.
    { label: "Get Tags from MusicBrainz…", onSelect: onLookup },
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

  if (loving !== undefined) {
    items.push(loveItem(loving, count, songs));
  }

  // Only inside a static playlist, where there is a membership row to remove.
  // Elsewhere the only thing removal could mean is the entry below it.
  if (openPlaylist?.kind === "static") {
    items.push({
      label: count === 1 ? "Remove from Playlist" : `Remove ${songs} from Playlist`,
      // Where Delete lands inside a static playlist - the less destructive
      // reading, which is the rule `useSelectionShortcuts` follows.
      shortcut: "Del",
      onSelect: onRemove,
    });
  }

  // Under the playlist entry rather than instead of it: inside a static
  // playlist both readings are available, and the pair reads as the choice it
  // is. Ellipsized because it asks first, which the playlist one does not.
  if (onRemoveFromLibrary !== undefined) {
    items.push({
      label: count === 1 ? "Remove from Library…" : `Remove ${songs} from Library…`,
      // Delete's other landing place: everywhere but a static playlist, there
      // is nothing to take a song out of but the library. Named only where
      // that is what Delete would do, which is why the entry above claims the
      // same key and the File menu's copy of this one claims neither - `menus`
      // does not know whether a playlist is open.
      ...(openPlaylist?.kind === "static" ? {} : { shortcut: "Del" }),
      onSelect: onRemoveFromLibrary,
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
 * The one entry that is a toggle: Love, or the way back out of one.
 *
 * Greyed rather than absent for both refusals, unlike the lookup entries
 * below: each names a thing the user can go and change - connect an account,
 * tag the file - and a question worth answering is worth showing.
 */
function loveItem(loving: Loving, count: number, songs: string): MenuItem {
  const verb = loving.loved ? "Unlove" : "Love";
  const label = count === 1 ? verb : `${verb} ${songs}`;

  if (!loving.connected) {
    return { label, disabled: true, hint: "Needs a last.fm account" };
  }
  if (!loving.keyed) {
    // Never remembered locally, so the set would disagree with last.fm from
    // the moment the love landed. The backend refuses it for the same reason.
    return {
      label,
      disabled: true,
      hint: count === 1 ? "No artist and title" : "One has no artist and title",
    };
  }
  return { label, onSelect: () => loving.onToggle(!loving.loved) };
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
