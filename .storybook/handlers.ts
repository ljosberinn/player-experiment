import { useLovedStore } from "../src/features/love/store";
import { usePlayerStore } from "../src/features/player/store";
import type {
  AppInfo,
  GenreBreakdown,
  LastfmConnection,
  LastfmImported,
  LastfmStatus,
  LibraryFolder,
  LibraryTotals,
  ListenTotals,
  PlayerSnapshot,
  ReviewCounts,
  Streaks,
  TagHealth,
  TagValueField,
  TagWriteSummary,
  Track,
} from "../src/ipc";
import {
  BUILT_INS,
  CANDIDATES,
  CRASH,
  GENRES,
  HARBOUR_LIGHTS_DETAIL,
  LIBRARY,
  PLAYLISTS,
  playlist,
} from "./fixtures";
import { allTrackIds, browseGroups, libraryStats, queryTracks, releaseGroups } from "./library";
import {
  albumGroup,
  firsts,
  listenTotals,
  newArtists,
  playsOverTime,
  recentPlays,
  streaks,
  top,
  weekClock,
} from "./listening";
import { genreBreakdown, histogram, libraryTotals, tagHealth, worstByBitrate } from "./stats";
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

/** Silence, as the backend reports it before anything has been played. */
export const SILENT: PlayerSnapshot = {
  status: "stopped",
  track: null,
  palette: null,
  queueIndex: null,
  queueLen: 0,
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  repeatOne: false,
};

/**
 * What `App` asks on mount beyond the area maps: the launch reads, the window
 * and the plugins. `mockWindows` only names the window, so every call on it
 * still arrives here.
 */
export const appHandlers: IpcHandlers = {
  get_app_info: (): AppInfo => ({ name: "Apex", version: "0.20.0" }),
  load_dynamic_background: () => true,
  lastfm_status: (): LastfmStatus => ({
    configured: true,
    username: null,
    queued: 0,
    lovesQueued: 0,
    import: null,
  }),
  player_snapshot: () => SILENT,
  load_window_geometry: () => null,
  load_zoom: () => null,
  // The ground the toolbar has already written, so the app's own restore
  // keeps it rather than resolving "system" against the reviewer's OS.
  load_theme: () => document.documentElement.getAttribute("data-theme"),
  "plugin:window|show": () => null,
  "plugin:window|set_title": () => null,
  "plugin:global-shortcut|register": () => null,
  "plugin:global-shortcut|unregister": () => null,
  "plugin:updater|check": () => null,
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

/** Up to eight of `values` containing `query`, as the backend's suggestion lists cap. */
function suggest(values: Iterable<string>, query: unknown): string[] {
  const needle = String(query ?? "").toLowerCase();
  return [...new Set(values)]
    .filter((value) => value.toLowerCase().includes(needle))
    .sort()
    .slice(0, 8);
}

const TAG_VALUES: Record<TagValueField, (entry: Track) => string | number | null> = {
  artist: (entry) => entry.artist,
  albumArtist: (entry) => entry.album_artist,
  album: (entry) => entry.album,
  genre: (entry) => entry.genre,
  year: (entry) => entry.year,
};

/**
 * The tag editor, the smart playlist editor and the release lookup. Their
 * fields suggest from `LIBRARY` and the genre tree, and every write answers
 * as though it landed, so clicking around a dialog does not throw.
 */
export const editingHandlers: IpcHandlers = {
  suggest_tag_values: ({ field, query }) =>
    suggest(
      LIBRARY.map(TAG_VALUES[field as TagValueField]).flatMap((value) =>
        value === null ? [] : [String(value)],
      ),
      query,
    ),
  genre_suggestions: ({ query }) => suggest(GENRES, query),
  write_tags: ({ trackIds }): TagWriteSummary => ({
    written: (trackIds as number[]).length,
    failed: 0,
    errors: [],
  }),
  tracks_by_ids: ({ trackIds }) =>
    LIBRARY.filter((entry) => (trackIds as number[]).includes(entry.id)),
  tagsource_search: () => CANDIDATES,
  tagsource_fetch: () => HARBOUR_LIGHTS_DETAIL,
  tagsource_apply: ({ edits }): TagWriteSummary => ({
    written: (edits as unknown[]).length,
    failed: 0,
    errors: [],
  }),
  tagsource_set_aside: () => null,
};

/**
 * The Statistics view's commands. The Library tab's aggregates count over
 * `LIBRARY` through the same rows the library views are answered from, and
 * browse the genres its filter bar lists through `browse_groups`. The
 * Listening tab's count over the play log in `listening.ts`.
 */
export const statsHandlers: IpcHandlers = {
  load_stats_filters: () => null,
  save_stats_filters: () => null,
  browse_groups: (args) => browseGroups(args as Parameters<typeof browseGroups>[0]),
  stats_library_totals: (args) => libraryTotals(args as Parameters<typeof libraryTotals>[0]),
  stats_histogram: (args) => histogram(args as Parameters<typeof histogram>[0]),
  stats_worst_by_bitrate: (args) => worstByBitrate(args as Parameters<typeof worstByBitrate>[0]),
  stats_genre_breakdown: (args) => genreBreakdown(args as Parameters<typeof genreBreakdown>[0]),
  stats_tag_health: (args) => tagHealth(args as Parameters<typeof tagHealth>[0]),
  genre_suggestions: ({ query }) => suggest(GENRES, query),
  set_genre_override: () => null,
  clear_genre_override: () => null,
  stats_listen_totals: (args) => listenTotals(args as Parameters<typeof listenTotals>[0]),
  stats_top: (args) => top(args as Parameters<typeof top>[0]),
  stats_recent_plays: (args) => recentPlays(args as Parameters<typeof recentPlays>[0]),
  stats_plays_over_time: (args) => playsOverTime(args as Parameters<typeof playsOverTime>[0]),
  stats_week_clock: (args) => weekClock(args as Parameters<typeof weekClock>[0]),
  stats_firsts: (args) => firsts(args as Parameters<typeof firsts>[0]),
  stats_new_artists: (args) => newArtists(args as Parameters<typeof newArtists>[0]),
  stats_streaks: (args) => streaks(args as Parameters<typeof streaks>[0]),
  stats_album_group: (args) => albumGroup(args as Parameters<typeof albumGroup>[0]),
  stats_pin_album: () => null,
  // Cancelled, which `saveCsv` takes as the user closing the box they opened.
  "plugin:dialog|save": () => null,
  save_text_file: () => null,
};

/** Both tabs over a library with nothing in it and nothing played. */
export const emptyStatsHandlers: IpcHandlers = {
  ...statsHandlers,
  browse_groups: () => [],
  stats_library_totals: (): LibraryTotals => ({
    tracks: 0,
    artists: 0,
    albums: 0,
    durationMs: 0,
    bytes: 0,
    missing: 0,
  }),
  stats_histogram: () => [],
  stats_worst_by_bitrate: () => [],
  stats_genre_breakdown: (): GenreBreakdown => ({ slices: [], own: 0, untagged: 0 }),
  stats_tag_health: (): TagHealth => ({
    tracks: 0,
    title: 0,
    artist: 0,
    album: 0,
    albumArtist: 0,
    genre: 0,
    year: 0,
    trackNo: 0,
    cover: 0,
  }),
  stats_listen_totals: (): ListenTotals => ({
    plays: 0,
    artists: 0,
    albums: 0,
    tracks: 0,
    days: 0,
    durationMs: 0,
    owned: 0,
    withGenre: 0,
    timed: 0,
    dated: 0,
    firstAt: null,
    lastAt: null,
  }),
  stats_top: () => [],
  stats_recent_plays: () => [],
  stats_plays_over_time: () => [],
  stats_firsts: () => [],
  stats_new_artists: () => [],
  stats_week_clock: () => Array.from({ length: 7 * 24 }, () => 0),
  stats_streaks: (): Streaks => ({
    current: 0,
    longest: 0,
    longestFrom: null,
    longestTo: null,
    lastSeven: [false, false, false, false, false, false, false],
  }),
};
