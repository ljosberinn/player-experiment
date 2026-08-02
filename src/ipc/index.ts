import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppInfo } from "./bindings/AppInfo";
import type { PlaybackStatus } from "./bindings/PlaybackStatus";
import type { PlayerPosition } from "./bindings/PlayerPosition";
import type { PlayerSnapshot } from "./bindings/PlayerSnapshot";
import type { Playlist } from "./bindings/Playlist";
import type { PlaylistKind } from "./bindings/PlaylistKind";
import type { ScanProgress } from "./bindings/ScanProgress";
import type { ScanSummary } from "./bindings/ScanSummary";
import type { SortDirection } from "./bindings/SortDirection";
import type { SortField } from "./bindings/SortField";
import type { Track } from "./bindings/Track";
import type { TrackQuery } from "./bindings/TrackQuery";

export type {
  AppInfo,
  PlaybackStatus,
  PlayerPosition,
  PlayerSnapshot,
  Playlist,
  PlaylistKind,
  ScanProgress,
  ScanSummary,
  SortDirection,
  SortField,
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

export function queryTracks(query: TrackQuery): Promise<Track[]> {
  return invoke<Track[]>("query_tracks", { query });
}

export function countTracks(query: TrackQuery): Promise<number> {
  return invoke<number>("count_tracks", { query });
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

export function listPlaylists(): Promise<Playlist[]> {
  return invoke<Playlist[]>("list_playlists");
}

export function createPlaylist(name: string): Promise<Playlist> {
  return invoke<Playlist>("create_playlist", { name });
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
  sortBy: "artist",
  direction: "asc",
  offset: 0,
  limit: 100,
};
