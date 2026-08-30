import type { Playlist } from "../../ipc";
import { usePlaylistsStore } from "../playlists/store";
import { unknownLabel } from "./browse";
import { backEntry, forwardEntry, type HistoryEntry } from "./history";
import { useLibraryStore, VIEW_TITLES } from "./store";

/**
 * What a history entry is called, for the tooltip.
 *
 * The most specific thing the entry names: the album that was open, else the
 * playlist, else the view. A back button that says only "Back" is a button you
 * have to press to find out what it does.
 */
function destinationOf(entry: HistoryEntry, playlists: Playlist[]): string {
  if (entry.browse !== null) {
    return entry.browse.key ?? unknownLabel(entry.browse.kind);
  }
  if (entry.playlistId !== null) {
    return (
      playlists.find((playlist) => playlist.id === entry.playlistId)?.name ?? VIEW_TITLES[entry.tab]
    );
  }
  return VIEW_TITLES[entry.tab];
}

/**
 * Back and forward, at the top of the sidebar.
 *
 * The gestures that matter are the mouse's side buttons and Alt+arrows; this
 * is what says they exist, and the only route for a pointer with no side
 * buttons. Above the library views because it acts on all of them - and on the
 * playlists below them - rather than on any one.
 *
 * Chevrons drawn in CSS, like every other icon in the sidebar.
 */
export function HistoryNav() {
  const history = useLibraryStore((s) => s.history);
  const back = useLibraryStore((s) => s.back);
  const forward = useLibraryStore((s) => s.forward);
  const playlists = usePlaylistsStore((s) => s.playlists);

  const behind = backEntry(history);
  const ahead = forwardEntry(history);

  return (
    <div className="history-nav">
      <button
        type="button"
        className="history-button"
        aria-label="Back"
        title={behind === null ? "Back" : `Back to ${destinationOf(behind, playlists)}`}
        disabled={behind === null}
        onClick={() => void back()}
      >
        <span className="history-chevron" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="history-button history-forward"
        aria-label="Forward"
        title={ahead === null ? "Forward" : `Forward to ${destinationOf(ahead, playlists)}`}
        disabled={ahead === null}
        onClick={() => void forward()}
      >
        <span className="history-chevron" aria-hidden="true" />
      </button>
    </div>
  );
}
