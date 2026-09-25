import { useLovedStore } from "../src/features/love/store";
import { usePlayerStore } from "../src/features/player/store";
import type { LastfmConnection, LastfmImported, LibraryFolder, ReviewCounts } from "../src/ipc";
import { BUILT_INS, CRASH, LIBRARY, PLAYLISTS, playlist } from "./fixtures";
import { allTrackIds, browseGroups, libraryStats, queryTracks, releaseGroups } from "./library";
import type { IpcHandlers } from "./tauri";

export const crashHandlers: IpcHandlers = {
  last_crash: () => CRASH,
  acknowledge_crash: () => null,
  reveal_crash_log: () => null,
};

/**
 * The player bar's commands. The backend answers a click with a
 * `player://state` event rather than a return value, so these write what that
 * event would have carried straight to the store.
 */
export const playerHandlers: IpcHandlers = {
  player_toggle: () =>
    usePlayerStore.setState((s) => ({ status: s.status === "playing" ? "paused" : "playing" })),
  player_next: () => null,
  player_previous: () => null,
  player_seek: () => null,
  player_set_volume: () => null,
  player_set_muted: ({ muted }) => usePlayerStore.setState({ muted: Boolean(muted) }),
  player_set_repeat_one: ({ repeat }) => usePlayerStore.setState({ repeatOne: Boolean(repeat) }),
  // The store has already moved optimistically; the backend answers with the whole set.
  set_loved: () => [...useLovedStore.getState().loved],
};

/** The Library folder is filing, so its row in the folder list is locked. */
export const LIBRARY_ROOT = "D:\\Music";

export const shellHandlers: IpcHandlers = {
  "plugin:dialog|open": () => null,
  "plugin:opener|open_url": () => null,
  "plugin:webview|set_webview_zoom": () => null,
  save_zoom: () => null,
  save_theme: () => null,
  save_dynamic_background: () => null,
  load_unattended_lookup: () => false,
  save_unattended_lookup: () => null,
  load_library_folder: (): LibraryFolder => ({ root: LIBRARY_ROOT, organize: true }),
  save_organize_library: () => null,
  set_library_root: () => null,
  count_tracks: () => LIBRARY.length,
  list_watch_folders: () => [LIBRARY_ROOT, "E:\\Downloads\\Bandcamp"],
  remove_watch_folder: () => null,
  load_watch_interval: () => 15,
  save_watch_interval: () => null,
  reveal_main_log: () => null,
  lastfm_disconnect: () => null,
  lastfm_begin_connect: (): LastfmConnection => ({
    token: "story",
    authorizeUrl: "https://www.last.fm/api/auth",
  }),
  // Never allowed, so Connect stays waiting on the browser until cancelled.
  lastfm_complete_connect: () => null,
  lastfm_import: ({ username }): LastfmImported => ({
    imported: 0,
    state: { username: String(username), through: 1_772_366_400, resumable: false },
  }),
  loved_tracks: () => [],
};

/**
 * The library's queries, over `LIBRARY`. A story reaches a view through the
 * store's own navigation, which asks these, rather than by seeding the counts
 * and groups a navigation would have fetched.
 */
export const libraryHandlers: IpcHandlers = {
  query_tracks: (args) => queryTracks(args as Parameters<typeof queryTracks>[0]),
  all_track_ids: (args) => allTrackIds(args as Parameters<typeof allTrackIds>[0]),
  library_stats: (args) => libraryStats(args as Parameters<typeof libraryStats>[0]),
  browse_groups: (args) => browseGroups(args as Parameters<typeof browseGroups>[0]),
  release_groups: (args) => releaseGroups(args as Parameters<typeof releaseGroups>[0]),
  load_column_config: () => null,
  save_column_config: () => null,
  reset_all_column_configs: () => null,
  reveal_track: () => null,
  set_loved: () => [...useLovedStore.getState().loved],
};

/** The sidebar's playlists: the fixtures' own and the built-ins `LibraryNav` draws. */
export const playlistHandlers: IpcHandlers = {
  list_playlists: () => [...BUILT_INS, ...PLAYLISTS],
  load_sidebar_sections: () => null,
  save_sidebar_sections: () => null,
  create_playlist: ({ name }) => playlist(100, String(name), 0),
  rename_playlist: () => null,
  delete_playlist: () => null,
  add_to_playlist: ({ trackIds }) => (trackIds as number[]).length,
  playlist_filter: () => null,
  playlist_order: () => ({ sort: null, limit: null }),
};

export const REVIEW_COUNTS: ReviewCounts = { review: 14, aside: 3 };

export const reviewHandlers: IpcHandlers = {
  tagsource_review_counts: () => REVIEW_COUNTS,
  // Nothing left by the time the row is clicked, so no dialog is asked for.
  tagsource_review_queue: () => [],
  tagsource_restore_review: () => REVIEW_COUNTS.aside,
};
