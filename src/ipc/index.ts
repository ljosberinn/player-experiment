import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppInfo } from "./bindings/AppInfo";
import type { BrowseFilter } from "./bindings/BrowseFilter";
import type { BrowseGroup } from "./bindings/BrowseGroup";
import type { BrowseKind } from "./bindings/BrowseKind";
import type { Colour } from "./bindings/Colour";
import type { Combinator } from "./bindings/Combinator";
import type { CoverEdit } from "./bindings/CoverEdit";
import type { CrashReport } from "./bindings/CrashReport";
import type { ExportScope } from "./bindings/ExportScope";
import type { FilterField } from "./bindings/FilterField";
import type { FilterGroup } from "./bindings/FilterGroup";
import type { FilterNode } from "./bindings/FilterNode";
import type { FilterOp } from "./bindings/FilterOp";
import type { FilterRule } from "./bindings/FilterRule";
import type { FilterValue } from "./bindings/FilterValue";
import type { LibraryStats } from "./bindings/LibraryStats";
import type { PlaybackStatus } from "./bindings/PlaybackStatus";
import type { PlayerPosition } from "./bindings/PlayerPosition";
import type { PlayerSnapshot } from "./bindings/PlayerSnapshot";
import type { Playlist } from "./bindings/Playlist";
import type { PlaylistKind } from "./bindings/PlaylistKind";
import type { ScanProgress } from "./bindings/ScanProgress";
import type { ScanSummary } from "./bindings/ScanSummary";
import type { SmartOrder } from "./bindings/SmartOrder";
import type { SmartSort } from "./bindings/SmartSort";
import type { SortDirection } from "./bindings/SortDirection";
import type { SortField } from "./bindings/SortField";
import type { TagEdit } from "./bindings/TagEdit";
import type { TagValueField } from "./bindings/TagValueField";
import type { TagWriteSummary } from "./bindings/TagWriteSummary";
import type { Track } from "./bindings/Track";
import type { TrackQuery } from "./bindings/TrackQuery";

export type {
  AppInfo,
  BrowseFilter,
  BrowseGroup,
  BrowseKind,
  Colour,
  Combinator,
  CoverEdit,
  CrashReport,
  ExportScope,
  FilterField,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterRule,
  FilterValue,
  LibraryStats,
  PlaybackStatus,
  PlayerPosition,
  PlayerSnapshot,
  Playlist,
  PlaylistKind,
  ScanProgress,
  ScanSummary,
  SmartOrder,
  SmartSort,
  SortDirection,
  SortField,
  TagEdit,
  TagValueField,
  TagWriteSummary,
  Track,
  TrackQuery,
};

/**
 * Typed wrappers around `invoke`. Components never call `invoke` directly, so
 * the whole IPC surface is one mockable module in tests.
 */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export function addWatchFolder(path: string): Promise<void> {
  return invoke<void>("add_watch_folder", { path });
}

export function listWatchFolders(): Promise<string[]> {
  return invoke<string[]>("list_watch_folders");
}

/** Resolves when the scan finishes; follow progress with {@link onScanProgress}. */
export function scanLibrary(): Promise<ScanSummary> {
  return invoke<ScanSummary>("scan_library");
}

/**
 * Deletes the rows of files that are no longer on disk, returning how many.
 *
 * The only call that destroys library rows. A scan marks what it cannot find
 * instead of deleting it, so an unplugged drive is recoverable - and throwing
 * those rows away, along with the playlist entries pointing at them, is a
 * decision the user makes rather than a side effect of scanning.
 */
export function removeMissingTracks(): Promise<number> {
  return invoke<number>("remove_missing_tracks");
}

export function queryTracks(query: TrackQuery): Promise<Track[]> {
  return invoke<Track[]>("query_tracks", { query });
}

export function countTracks(query: TrackQuery): Promise<number> {
  return invoke<number>("count_tracks", { query });
}

/**
 * Count, total duration and total size for a view.
 *
 * What the store asks for on a query change: the table needs the count for its
 * scrollbar and the footer needs all three, and they always change together.
 */
export function libraryStats(query: TrackQuery): Promise<LibraryStats> {
  return invoke<LibraryStats>("library_stats", { query });
}

/**
 * The albums, artists or genres inside a view.
 *
 * Takes the same query the songs table uses, so a search or an open playlist
 * narrows this list exactly as it narrows the rows. `kind` is separate because
 * which grouping to show belongs to the open tab, not to the query.
 *
 * Unpaged: a library of tens of thousands of tracks is a few hundred albums.
 */
export function browseGroups(query: TrackQuery, kind: BrowseKind): Promise<BrowseGroup[]> {
  return invoke<BrowseGroup[]>("browse_groups", { query, kind });
}

/**
 * Ids of every track matching the query, ignoring offset/limit.
 *
 * Backs "select all": selection is a set of ids, so it must not be truncated
 * by the page cap that applies to full rows.
 */
export function allTrackIds(query: TrackQuery): Promise<number[]> {
  return invoke<number[]>("all_track_ids", { query });
}

/**
 * The stored column layout for a view, or null if it has never been set.
 *
 * The payload is opaque to the backend - which columns exist and how a width
 * is stored is decided here, and mirroring that into Rust would be two
 * definitions to keep in step for nothing.
 */
export function loadColumnConfig(playlistId: number | null): Promise<string | null> {
  return invoke<string | null>("load_column_config", { playlistId });
}

export function saveColumnConfig(playlistId: number | null, configJson: string): Promise<void> {
  return invoke<void>("save_column_config", { playlistId, configJson });
}

/** The stored webview zoom factor, or null if it has never been set. */
export function loadZoom(): Promise<string | null> {
  return invoke<string | null>("load_zoom");
}

export function saveZoom(factor: string): Promise<void> {
  return invoke<void>("save_zoom", { factor });
}

/**
 * Which sidebar sections the user has folded away, or null on a first run.
 *
 * Opaque to the backend, like the column layout: which sections exist is
 * decided here, in `features/playlists/sections.ts`.
 */
export function loadSidebarSections(): Promise<string | null> {
  return invoke<string | null>("load_sidebar_sections");
}

export function saveSidebarSections(sectionsJson: string): Promise<void> {
  return invoke<void>("save_sidebar_sections", { sectionsJson });
}

/**
 * Whether the background takes its colours from the playing cover.
 *
 * A bool rather than the opaque strings above, because Rust reads this one:
 * it is on the export allowlist, so the backend has to know what it means.
 * Unset reads as on - the design draws the blobs.
 */
export function loadDynamicBackground(): Promise<boolean> {
  return invoke<boolean>("load_dynamic_background");
}

export function saveDynamicBackground(enabled: boolean): Promise<void> {
  return invoke<void>("save_dynamic_background", { enabled });
}

/** Writes an export to `path`, resolving to how many tracks it holds. */
export function exportLibrary(path: string, scope: ExportScope): Promise<number> {
  return invoke<number>("export_library", { path, scope });
}

/**
 * The panic the previous run wrote down, if there is one the user has not
 * dismissed yet.
 *
 * `null` in the overwhelmingly common case, which is why this is asked once at
 * startup rather than subscribed to: a crash that has already happened cannot
 * happen again while the app is running.
 */
export function lastCrash(): Promise<CrashReport | null> {
  return invoke<CrashReport | null>("last_crash");
}

/** Marks every crash up to `when` as seen, so the notice does not return. */
export function acknowledgeCrash(when: number): Promise<void> {
  return invoke<void>("acknowledge_crash", { when });
}

/** Opens the OS file manager with the crash log selected. */
export function revealCrashLog(): Promise<void> {
  return invoke<void>("reveal_crash_log");
}

/** Opens the OS file manager with this track selected. */
export function revealTrack(trackId: number): Promise<void> {
  return invoke<void>("reveal_track", { trackId });
}

export function saveWindowGeometry(geometry: string): Promise<void> {
  return invoke<void>("save_window_geometry", { geometry });
}

export function loadWindowGeometry(): Promise<string | null> {
  return invoke<string | null>("load_window_geometry");
}

/**
 * The rows behind a selection.
 *
 * Ids rather than a query: the selection survives scrolling, and the rows it
 * names may have been evicted from the page cache.
 */
export function tracksByIds(trackIds: number[]): Promise<Track[]> {
  return invoke<Track[]>("tracks_by_ids", { trackIds });
}

/** Applies one edit to every track named, reporting what it managed. */
export function writeTags(trackIds: number[], edit: TagEdit): Promise<TagWriteSummary> {
  return invoke<TagWriteSummary>("write_tags", { trackIds, edit });
}

export function undoTagEdit(): Promise<TagWriteSummary> {
  return invoke<TagWriteSummary>("undo_tag_edit");
}

export function canUndoTagEdit(): Promise<boolean> {
  return invoke<boolean>("can_undo_tag_edit");
}

/**
 * Values already in the library for `field`, best match first.
 *
 * Matched in SQLite rather than here: the alternative is shipping every
 * distinct artist in a 50k-track library over IPC on the chance someone types.
 */
export function suggestTagValues(field: TagValueField, query: string): Promise<string[]> {
  return invoke<string[]>("suggest_tag_values", { field, query });
}

export function listPlaylists(): Promise<Playlist[]> {
  return invoke<Playlist[]>("list_playlists");
}

export function createPlaylist(name: string): Promise<Playlist> {
  return invoke<Playlist>("create_playlist", { name });
}

/**
 * Creates a smart playlist. Its contents are its filter and cutoff, evaluated
 * live.
 */
export function createSmartPlaylist(
  name: string,
  filter: FilterGroup,
  order: SmartOrder,
): Promise<Playlist> {
  return invoke<Playlist>("create_smart_playlist", { name, filter, order });
}

/**
 * Replaces both halves of what a smart playlist holds.
 *
 * The filter and the order go together because with a cutoff in play they
 * jointly decide the membership, and writing one without the other would leave
 * a moment where the playlist is a combination the user never asked for.
 */
export function setPlaylistFilter(
  playlistId: number,
  filter: FilterGroup,
  order: SmartOrder,
): Promise<void> {
  return invoke<void>("set_playlist_filter", { playlistId, filter, order });
}

/** The stored filter, for the editor to open. Null when there is none to read. */
export function playlistFilter(playlistId: number): Promise<FilterGroup | null> {
  return invoke<FilterGroup | null>("playlist_filter", { playlistId });
}

/**
 * The stored sort and cutoff.
 *
 * Never null: a playlist with neither reads as `{ sort: null, limit: null }`,
 * which is a real answer rather than a missing one.
 */
export function playlistOrder(playlistId: number): Promise<SmartOrder> {
  return invoke<SmartOrder>("playlist_order", { playlistId });
}

export function renamePlaylist(playlistId: number, name: string): Promise<void> {
  return invoke<void>("rename_playlist", { playlistId, name });
}

export function deletePlaylist(playlistId: number): Promise<void> {
  return invoke<void>("delete_playlist", { playlistId });
}

/** Appends tracks to a playlist; resolves to how many were actually added. */
export function addToPlaylist(playlistId: number, trackIds: number[]): Promise<number> {
  return invoke<number>("add_to_playlist", { playlistId, trackIds });
}

export function removeFromPlaylist(playlistId: number, trackIds: number[]): Promise<number> {
  return invoke<number>("remove_from_playlist", { playlistId, trackIds });
}

/**
 * Moves tracks so they sit immediately before the row at `targetIndex`.
 *
 * The index is stated against the playlist as it looks right now, moved rows
 * included, which is what a drop on a visible row means.
 */
export function moveInPlaylist(
  playlistId: number,
  trackIds: number[],
  targetIndex: number,
): Promise<void> {
  return invoke<void>("move_in_playlist", { playlistId, trackIds, targetIndex });
}

export function onScanProgress(handler: (progress: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan://progress", (event) => handler(event.payload));
}

/**
 * Something changed the library behind the view's back.
 *
 * Emitted sparingly and only when a row really changed - today, when playing a
 * track clears a missing mark left over from an unplugged drive. The player
 * reports every load, so a handler that ran on all of them would drop every
 * cached page once per song.
 */
export function onLibraryChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("library://changed", () => handler());
}

/**
 * Replaces the play queue with `trackIds` and starts at `index`.
 *
 * Ids rather than rows: the backend resolves paths and durations itself, so a
 * queue can never carry stale metadata, and the frontend already has the id
 * list for the current view.
 */
export function playerPlay(trackIds: number[], index: number): Promise<void> {
  return invoke<void>("player_play", { trackIds, index });
}

export function playerToggle(): Promise<void> {
  return invoke<void>("player_toggle");
}

export function playerPause(): Promise<void> {
  return invoke<void>("player_pause");
}

export function playerResume(): Promise<void> {
  return invoke<void>("player_resume");
}

export function playerStop(): Promise<void> {
  return invoke<void>("player_stop");
}

export function playerNext(): Promise<void> {
  return invoke<void>("player_next");
}

export function playerPrevious(): Promise<void> {
  return invoke<void>("player_previous");
}

export function playerSeek(positionMs: number): Promise<void> {
  return invoke<void>("player_seek", { positionMs });
}

export function playerSetVolume(volume: number): Promise<void> {
  return invoke<void>("player_set_volume", { volume });
}

/**
 * Silences output without touching the level.
 *
 * Muted is its own state rather than a volume of zero, so that unmuting can
 * come back to the level the rail was at.
 */
export function playerSetMuted(muted: boolean): Promise<void> {
  return invoke<void>("player_set_muted", { muted });
}

/** Loops the current song at its end instead of advancing the queue. */
export function playerSetRepeatOne(repeat: boolean): Promise<void> {
  return invoke<void>("player_set_repeat_one", { repeat });
}

/** The current state, for a window that started after playback did. */
export function playerSnapshot(): Promise<PlayerSnapshot> {
  return invoke<PlayerSnapshot>("player_snapshot");
}

export function onPlayerState(handler: (snapshot: PlayerSnapshot) => void): Promise<UnlistenFn> {
  return listen<PlayerSnapshot>("player://state", (event) => handler(event.payload));
}

/** Playhead ticks, a few times a second while something is playing. */
export function onPlayerPosition(handler: (position: PlayerPosition) => void): Promise<UnlistenFn> {
  return listen<PlayerPosition>("player://position", (event) => handler(event.payload));
}

/** Playback problems the user should see: an unreadable file, no audio device. */
export function onPlayerError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("player://error", (event) => handler(event.payload));
}

/**
 * URL for a track's cover art.
 *
 * Cover bytes never travel with a track row - they are served by a custom
 * protocol handler keyed on the content hash, so the webview caches each image
 * once no matter how many rows reference it.
 *
 * The URL shape is platform-specific (Windows serves custom protocols as
 * `http://cover.localhost/...`, other platforms as `cover://localhost/...`),
 * so this defers to Tauri rather than hand-building it.
 */
export function coverUrl(hash: string): string {
  return convertFileSrc(hash, "cover");
}

export const defaultTrackQuery: TrackQuery = {
  search: null,
  playlistId: null,
  browse: null,
  sortBy: "artist",
  direction: "asc",
  offset: 0,
  limit: 100,
};
