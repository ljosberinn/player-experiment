import { useLibraryStore, VIEW_TITLES, type ViewTab } from "../../features/library/store";
import { usePlaylistsStore } from "../../features/playlists/store";
import type { BuiltIn, Playlist } from "../../ipc";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { ContextMenu } from "./ContextMenu";

/**
 * The LIBRARY section of the source list: Songs, Releases, Artists, Genres and
 * Statistics, then the built-in playlists.
 *
 * These were a segmented tab bar above the table until phase 35. The design puts
 * them in the sidebar with the playlists, which is where they belong: switching
 * between Songs and Releases is the same kind of act as opening a playlist, and
 * having two controls that both choose what the content pane shows meant the
 * selected playlist and the selected tab were highlighted in different places.
 *
 * Buttons rather than tabs, for the same reason. A tablist owns arrow-key
 * movement between its tabs, which would have been wrong the moment these sat in
 * a list next to the playlists - the arrows have to walk the whole sidebar.
 */
/** The sidebar's icon box, which `.sidebar-icon` sizes to match. */
const ICON_SIZE = 17;

/** Order only; the words are `VIEW_TITLES`, which the history arrows share. */
const VIEWS: ViewTab[] = ["songs", "albums", "artists", "genres", "stats"];

/** Order and icon of the built-ins; the names are the rows'. */
const BUILT_INS: [BuiltIn, IconName][] = [
  ["favorites", "favorites"],
  ["mostPlayed", "most-played"],
  ["recentlyAdded", "recently-added"],
];

export function LibraryNav({
  active,
  onSelect,
  onExport,
}: {
  /** The open view, or null while a playlist is showing. */
  active: ViewTab | null;
  onSelect: (view: ViewTab) => void;
  /** Export a built-in, as `PlaylistSidebar`'s `onExport`. */
  onExport?: ((playlist: Playlist) => void) | undefined;
}) {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const playPlaylist = usePlaylistsStore((s) => s.playPlaylist);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const showPlaylist = useLibraryStore((s) => s.showPlaylist);

  return (
    <div className="sidebar-section">
      <h2 className="sidebar-title">Library</h2>
      <ul>
        {VIEWS.map((view) => (
          <li key={view}>
            <button
              type="button"
              className="sidebar-item"
              aria-current={view === active ? "page" : undefined}
              onClick={() => onSelect(view)}
            >
              <Icon name={view} size={ICON_SIZE} className="sidebar-icon" />
              <span className="sidebar-label">{VIEW_TITLES[view]}</span>
            </button>
          </li>
        ))}
        {BUILT_INS.map(([builtIn, icon]) => {
          const playlist = playlists.find((candidate) => candidate.builtIn === builtIn);
          if (playlist === undefined) {
            return null;
          }
          return (
            <ContextMenu
              key={builtIn}
              label={`${playlist.name} actions`}
              items={[
                {
                  label: "Play",
                  disabled: playlist.trackCount === 0,
                  onSelect: () => void playPlaylist(playlist),
                },
                { kind: "separator" },
                {
                  label: "Export…",
                  disabled: playlist.trackCount === 0,
                  onSelect: () => onExport?.(playlist),
                },
              ]}
              render={<li />}
            >
              <button
                type="button"
                className="sidebar-item"
                aria-current={playlist.id === playlistId ? "page" : undefined}
                onClick={() => void showPlaylist(playlist)}
              >
                <Icon name={icon} size={ICON_SIZE} className="sidebar-icon" />
                <span className="sidebar-label">{playlist.name}</span>
              </button>
            </ContextMenu>
          );
        })}
      </ul>
    </div>
  );
}
