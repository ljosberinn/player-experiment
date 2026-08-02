import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppInfo } from "./bindings/AppInfo";
import type { ScanProgress } from "./bindings/ScanProgress";
import type { ScanSummary } from "./bindings/ScanSummary";
import type { SortDirection } from "./bindings/SortDirection";
import type { SortField } from "./bindings/SortField";
import type { Track } from "./bindings/Track";
import type { TrackQuery } from "./bindings/TrackQuery";

export type { AppInfo, ScanProgress, ScanSummary, SortDirection, SortField, Track, TrackQuery };

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

export function onScanProgress(handler: (progress: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan://progress", (event) => handler(event.payload));
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
  sortBy: "artist",
  direction: "asc",
  offset: 0,
  limit: 100,
};
