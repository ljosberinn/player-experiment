import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppInfo } from "./bindings/AppInfo";
import type { BackgroundTask } from "./bindings/BackgroundTask";
import type { BrowseFilter } from "./bindings/BrowseFilter";
import type { BrowseGroup } from "./bindings/BrowseGroup";
import type { BrowseKind } from "./bindings/BrowseKind";
import type { Colour } from "./bindings/Colour";
import type { Combinator } from "./bindings/Combinator";
import type { CoverEdit } from "./bindings/CoverEdit";
import type { CrashReport } from "./bindings/CrashReport";
import type { ExportScope } from "./bindings/ExportScope";
import type { FilterField } from "./bindings/FilterField";
import type { FilterFieldKind } from "./bindings/FilterFieldKind";
import type { FilterGroup } from "./bindings/FilterGroup";
import type { FilterNode } from "./bindings/FilterNode";
import type { FilterOp } from "./bindings/FilterOp";
import type { FilterRule } from "./bindings/FilterRule";
import type { FilterValue } from "./bindings/FilterValue";
import type { LastfmConnection } from "./bindings/LastfmConnection";
import type { LastfmStatus } from "./bindings/LastfmStatus";
import type { LibraryStats } from "./bindings/LibraryStats";
import type { PlaybackStatus } from "./bindings/PlaybackStatus";
import type { PlayerPosition } from "./bindings/PlayerPosition";
import type { PlayerSnapshot } from "./bindings/PlayerSnapshot";
import type { Playlist } from "./bindings/Playlist";
import type { PlaylistKind } from "./bindings/PlaylistKind";
import type { ReleaseCandidate } from "./bindings/ReleaseCandidate";
import type { ReleaseDetail } from "./bindings/ReleaseDetail";
import type { ReleaseIdentity } from "./bindings/ReleaseIdentity";
import type { ReleaseSelection } from "./bindings/ReleaseSelection";
import type { RemoteTrack } from "./bindings/RemoteTrack";
import type { ReviewCounts } from "./bindings/ReviewCounts";
import type { ReviewEntry } from "./bindings/ReviewEntry";
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
import type { TrackEdit } from "./bindings/TrackEdit";
import type { TrackQuery } from "./bindings/TrackQuery";
import type { WriteProgress } from "./bindings/WriteProgress";

export type {
  AppInfo,
  BackgroundTask,
  BrowseFilter,
  BrowseGroup,
  BrowseKind,
  Colour,
  Combinator,
  CoverEdit,
  CrashReport,
  ExportScope,
  FilterField,
  FilterFieldKind,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterRule,
  FilterValue,
  LastfmConnection,
  LastfmStatus,
  LibraryStats,
  PlaybackStatus,
  PlayerPosition,
  PlayerSnapshot,
  Playlist,
  PlaylistKind,
  ReleaseCandidate,
  ReleaseDetail,
  ReleaseIdentity,
  ReleaseSelection,
  RemoteTrack,
  ReviewCounts,
  ReviewEntry,
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
  TrackEdit,
  TrackQuery,
  WriteProgress,
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

/**
 * Stops watching a folder, leaving the songs already in the library alone.
 *
 * They stay until a scan does not find them and marks them missing, which is
 * the path that already exists - a second kind of removal would take the play
 * counts and playlist places on those rows with it.
 */
export function removeWatchFolder(path: string): Promise<void> {
  return invoke<void>("remove_watch_folder", { path });
}

/** Resolves when the scan finishes; follow progress with {@link onScanProgress}. */
export function scanLibrary(): Promise<ScanSummary> {
  return invoke<ScanSummary>("scan_library");
}

/**
 * Deletes the rows of files that are no longer on disk, returning how many.
 *
 * A scan marks what it cannot find instead of deleting it, so an unplugged
 * drive is recoverable - and throwing those rows away, along with the playlist
 * entries pointing at them, is a decision the user makes rather than a side
 * effect of scanning.
 *
 * Writes no tombstones, unlike `removeTracks`: a drive coming back should
 * restore what was on it.
 */
export function removeMissingTracks(): Promise<number> {
  return invoke<number>("remove_missing_tracks");
}

/**
 * Removes the named songs from the library, leaving the files on disk.
 *
 * The other call that destroys library rows, and the one reached per row rather
 * than per condition. It also tombstones the paths, which is what stops the
 * next rescan from adding those files straight back - the file is still sitting
 * under a watch folder. Resolves to how many rows went.
 */
export function removeTracks(trackIds: number[]): Promise<number> {
  return invoke<number>("remove_tracks", { trackIds });
}

/**
 * Forgets every removal, so the next rescan finds those files again.
 *
 * The way back from a mis-click, and all there is: the rows are gone and their
 * ids with them, so this lifts the suppression rather than restoring anything.
 */
export function forgetRemovedTracks(): Promise<number> {
  return invoke<number>("forget_removed_tracks");
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
 * Minutes between unattended passes over the watch folders; zero means off.
 *
 * A number rather than the opaque strings around it, because Rust is what acts
 * on it: the `library-watch` thread reads this setting on every wake, so a
 * change here applies without a restart.
 */
export function loadWatchInterval(): Promise<number> {
  return invoke<number>("load_watch_interval");
}

export function saveWatchInterval(minutes: number): Promise<void> {
  return invoke<void>("save_watch_interval", { minutes });
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

/**
 * Whether the app may look releases up on MusicBrainz on its own.
 *
 * Off until it is turned on, unlike every other preference here: it is what
 * lets the app talk to a server and write tags with nobody watching. Turning
 * it off cancels a pass in flight — the backend reads the setting between
 * releases, so neither call needs a restart.
 */
export function loadUnattendedLookup(): Promise<boolean> {
  return invoke<boolean>("load_unattended_lookup");
}

export function saveUnattendedLookup(enabled: boolean): Promise<void> {
  return invoke<void>("save_unattended_lookup", { enabled });
}

/**
 * Writes an export to `path`, resolving to how many tracks it holds.
 *
 * Runs on a worker thread; follow it with {@link onExportProgress}.
 */
export function exportLibrary(path: string, scope: ExportScope): Promise<number> {
  return invoke<number>("export_library", { path, scope });
}

/**
 * Whether this build can talk to last.fm, and which account is connected.
 *
 * Read from the database alone. Whether an account is connected is a stored
 * fact, and asking last.fm at startup would make a local-only player talk to a
 * server before the user has done anything.
 */
export function lastfmStatus(): Promise<LastfmStatus> {
  return invoke<LastfmStatus>("lastfm_status");
}

/**
 * Step one of connecting: a token, and the page to send the user to with it.
 *
 * The only thing that leaves the machine is an API key — the password is typed
 * on last.fm's own page, in the user's own browser.
 */
export function lastfmBeginConnect(): Promise<LastfmConnection> {
  return invoke<LastfmConnection>("lastfm_begin_connect");
}

/**
 * One attempt at exchanging the token for a session key.
 *
 * `null` means the user has not finished in the browser yet, so ask again. The
 * cadence is decided here rather than in Rust, which is what keeps it testable
 * against a mocked `ipc`.
 */
export function lastfmCompleteConnect(token: string): Promise<string | null> {
  return invoke<string | null>("lastfm_complete_connect", { token });
}

/**
 * Forgets the account. Local only: last.fm has no method to revoke a session
 * key, so nothing is sent and the pane says where the user can revoke it.
 */
export function lastfmDisconnect(): Promise<void> {
  return invoke<void>("lastfm_disconnect");
}

/**
 * last.fm rejected the stored session key, so the app has forgotten it.
 *
 * Emitted by the scrobbler thread, not in response to anything the user did:
 * the key was revoked from last.fm's own settings screen, or invalidated. The
 * Account menu is claiming an account that no longer works until this lands.
 */
export function onLastfmDisconnected(handler: () => void): Promise<UnlistenFn> {
  return listen("lastfm://disconnected", () => handler());
}

/**
 * How many plays are recorded but not yet accepted by last.fm.
 *
 * Emitted after every attempt to drain the queue, zero included - the pane has
 * to be able to stop saying it.
 */
export function onLastfmQueued(handler: (depth: number) => void): Promise<UnlistenFn> {
  return listen<number>("lastfm://queued", (event) => handler(event.payload));
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

/**
 * Opens the OS file manager with `main.log` selected.
 *
 * Revealed rather than rendered, like the crash log: it is every operation the
 * backend has run since the file was last rotated, which is an editor's job.
 */
export function revealMainLog(): Promise<void> {
  return invoke<void>("reveal_main_log");
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

/**
 * Applies one edit to every track named, reporting what it managed.
 *
 * Runs on a worker thread; follow it with {@link onTagWriteProgress}.
 */
export function writeTags(trackIds: number[], edit: TagEdit): Promise<TagWriteSummary> {
  return invoke<TagWriteSummary>("write_tags", { trackIds, edit });
}

/**
 * Writes a dropped image to a staging file and resolves to its path.
 *
 * The editor carries a replacement cover as a path, and a drop hands the page
 * a `File` - bytes with no path anywhere - so the bytes cross once, here, and
 * what comes back is what `CoverEdit.Replace` already knew how to carry.
 *
 * The buffer is the *whole* payload rather than a field of an args object,
 * which is the only shape Tauri sends as a raw body: a `Uint8Array` inside an
 * object is JSON-serialized as one number per byte. Rejects with the sentence
 * to show when the bytes are not a JPEG or a PNG, or are too big.
 */
export function stageDroppedCover(bytes: ArrayBuffer): Promise<string> {
  return invoke<string>("stage_dropped_cover", bytes);
}

/**
 * Copies a picked image into the same staging file, and resolves to its path.
 *
 * The picker's own path would do for the save, but only what the backend can
 * serve can be previewed - and staging both routes is what makes a picked
 * image refused while the dialog is open rather than at save time. Rejects
 * with the sentence to show.
 */
export function stagePickedCover(path: string): Promise<string> {
  return invoke<string>("stage_picked_cover", { path });
}

/**
 * The releases a selection covers, in the order the dialog works through them.
 *
 * A release rather than a track is the unit a lookup is worth doing at, so
 * this is what decides how many searches a selection costs.
 */
export function tagsourceGroups(trackIds: number[]): Promise<ReleaseSelection[]> {
  return invoke<ReleaseSelection[]>("tagsource_groups", { trackIds });
}

/**
 * Searches MusicBrainz for the release these files might be, best fit first.
 *
 * Blocks on a process-wide limiter that lets one request out every ten
 * seconds before it blocks on the network, so two of these started at once
 * queue behind each other rather than going out together.
 */
export function tagsourceSearch(
  album: string | null,
  artist: string | null,
): Promise<ReleaseCandidate[]> {
  return invoke<ReleaseCandidate[]>("tagsource_search", { album, artist });
}

/**
 * Reads one candidate's tracklist, and stages its cover beside it.
 *
 * The album and artist go back so the score can be recomputed against the
 * files: the per-track durations that separate two pressings of one album do
 * not exist until the tracklist does.
 */
export function tagsourceFetch(
  mbid: string,
  album: string | null,
  artist: string | null,
): Promise<ReleaseDetail> {
  return invoke<ReleaseDetail>("tagsource_fetch", { mbid, album, artist });
}

/**
 * Writes a confirmed lookup as one batch.
 *
 * `identity` is written to every file of the release, selected or not - it is
 * the one thing a lookup writes outside what was picked.
 */
export function tagsourceApply(
  edits: TrackEdit[],
  identity: ReleaseIdentity,
): Promise<TagWriteSummary> {
  return invoke<TagWriteSummary>("tagsource_apply", { edits, identity });
}

/**
 * The releases the unattended pass would not write, in the order to work
 * through them.
 *
 * Each carries the candidates the pass found when it queued it, so the dialog
 * opens on the results rather than on a rate-limited ten seconds. Opening the
 * queue is also what drops entries for releases that have since been retagged
 * or removed, so the length of this is the honest count.
 */
export function tagsourceReviewQueue(): Promise<ReviewEntry[]> {
  return invoke<ReviewEntry[]>("tagsource_review_queue");
}

/** How many releases await a decision, and how many were set aside. */
export function tagsourceReviewCounts(): Promise<ReviewCounts> {
  return invoke<ReviewCounts>("tagsource_review_counts");
}

/**
 * Takes one release out of the review queue until somebody asks for it back.
 *
 * The other thing Skip could have meant. Skip is "not now" and offers the
 * release again; this is "leave this alone".
 */
export function tagsourceSetAside(album: string | null, artist: string | null): Promise<void> {
  return invoke<void>("tagsource_set_aside", { album, artist });
}

/** Puts every set-aside release back in the queue, and says how many. */
export function tagsourceRestoreReview(): Promise<number> {
  return invoke<number>("tagsource_restore_review");
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
 * How far a tag write has got.
 *
 * One channel for every writer: they write the same files the same way, and a
 * dialog watching one has no reason to distinguish.
 */
export function onTagWriteProgress(
  handler: (progress: WriteProgress) => void,
): Promise<UnlistenFn> {
  return listen<WriteProgress>("tags://progress", (event) => handler(event.payload));
}

/** How far an export has got gathering the tracks it will write. */
export function onExportProgress(handler: (progress: WriteProgress) => void): Promise<UnlistenFn> {
  return listen<WriteProgress>("export://progress", (event) => handler(event.payload));
}

/**
 * How far a task measured in hours has got, or null when none is running.
 *
 * Not one of the two channels above: those report on writes that finish in a
 * minute, from the content header. This one stands at the foot of the sidebar
 * for as long as the task runs, and it carries the label because it has more
 * than one producer - the unattended lookup pass is only the first.
 */
export function onTaskProgress(
  handler: (task: BackgroundTask | null) => void,
): Promise<UnlistenFn> {
  return listen<BackgroundTask | null>("task://progress", (event) => handler(event.payload));
}

/**
 * How long a subscriber waits after the library changes before reloading.
 *
 * A scan announces itself once, but a burst is ordinary - a tag write over a
 * selection and a scan finishing can land together - and each reload is a
 * count, a page and a `list_playlists` that recounts every
 * playlist, smart ones by re-running their compiled filter. A quarter of a
 * second is under the threshold at which a number feels stale and well above
 * the rate a burst arrives at.
 */
export const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * The library is no longer what the view thinks it is.
 *
 * A bare ping, no payload: every write that commits emits it - a scan, a tag
 * write, removing missing rows, and each of the eight playlist
 * commands - and a subscriber reloads whatever it holds rather than being told
 * what changed. Debounce it by `INVALIDATE_DEBOUNCE_MS`; both subscribers do.
 *
 * The backend coalesces it as well, at a window measured in seconds, so a
 * write that commits for hours does not arrive as thousands of pings. That
 * window is what bounds how stale a view can be during such a write; this
 * debounce is only for the burst that lands together.
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

/**
 * The image the tag editor has staged but not written yet.
 *
 * `staged` is the one path under `cover://` that is not a hash. Its file has a
 * fixed name, so the URL is the only thing that can tell the webview this is
 * not the image it fetched a moment ago - hence `version`, bumped by whoever
 * staged. The release lookup passes a release id rather than a counter: it
 * stages one cover per release, so the id already names the bytes.
 */
export function stagedCoverUrl(version: number | string): string {
  return `${convertFileSrc("staged", "cover")}?v=${version}`;
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
