import type { Playlist } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { usePlaylistsStore } from "./store";

/**
 * The playlist the content pane is showing, or null in a library view.
 *
 * The library store holds which playlist is open and the playlists store holds
 * what it is, so everything that needs the object rather than the id has to
 * join the two - the menus, the empty state and the table all do.
 */
export function useCurrentPlaylist(): Playlist | null {
  const playlistId = useLibraryStore((s) => s.playlistId);
  const playlists = usePlaylistsStore((s) => s.playlists);
  return playlists.find((playlist) => playlist.id === playlistId) ?? null;
}
