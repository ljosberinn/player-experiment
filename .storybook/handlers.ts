import { useLovedStore } from "../src/features/love/store";
import { usePlayerStore } from "../src/features/player/store";
import type { LastfmConnection, LastfmImported, LibraryFolder } from "../src/ipc";
import { CRASH, LIBRARY } from "./fixtures";
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
