# 62 — One invalidation channel

Every mutation reaches across stores to say what it invalidated.
`useLibraryStore.getState()` appears fifteen times outside the library store -
twelve in `playlists/store.ts`, two in `editor/store.ts`, one in
`library/scan.ts` - each `refresh` guarded by its own "is this playlist the
open one" check. Ordering is load-bearing and stated in comments (`remove` must
leave the playlist before the sidebar drops it). Every new mutation is another
chance to forget one, and forgetting is silent.

The channel meant for this exists and is nearly unused. `library://changed` is
emitted from two places: the e2e `seed_synthetic_tracks` command and the
missing-mark clear in `lib.rs`. Not a scan, not a tag write, not a playlist
edit.

So three pieces of documentation are wrong, and one thing is broken.
`playlists/store.ts` debounces its recount because "a scan emits
`library://changed` far more often than anyone can read a number";
`ipc/index.ts` says it is emitted "only when a row really changed";
`knowledge/architecture.md` says scanning emits it. None of that is true, and
because the sidebar's subscription never fires for the case it was written for,
the count beside each playlist is stale after a scan until something else
reloads it - `rescan` refreshes the library and nothing reloads
`list_playlists`.

## The event

A bare ping, no payload. Both stores subscribe and debounce their own reload
at the shared `INVALIDATE_DEBOUNCE_MS` (today's 250ms, moved out of
`playlists/store.ts`).

Scope was considered and is not worth its cost: nearly every write is both -
a tag edit changes smart playlist membership, a playlist drop changes the open
view - so `{ tracks, playlists }` would be `true, true` at almost every site
while adding a payload two stores must agree on. The one case it would buy is
`rename_playlist`, which costs a single debounced re-query.

## Emit sites

Twelve, all after the write commits:

- `scan_library` - once when the scan returns, not per file. `scan://progress`
  already drives the bar, and per-file would re-query per file.
- `write_tags`, `undo_tag_edit` - once after `apply`/`undo_last` returns.
  `TAG_PROGRESS` stays per track.
- `remove_missing_tracks`
- `create_playlist`, `create_smart_playlist`, `set_playlist_filter`,
  `rename_playlist`, `delete_playlist`, `add_to_playlist`,
  `remove_from_playlist`, `move_in_playlist`

The eight playlist commands and `remove_missing_tracks` are sync and take only
`State<'_, Db>`; each gains `app: tauri::AppHandle`. Name the event as a
`const` beside `TAG_PROGRESS` and `EXPORT_PROGRESS`.

## What the frontend drops

Ten of the fifteen reach-arounds go: every `refresh` and its guard. Five stay,
because an event cannot express "leave this view before it stops existing" -
`showPlaylist(created.id)` after a smart create, `showPlaylist(null)` and
`forgetPlaylist` after a delete, `clearSelection` in `removeTracks`,
`showPlaylist(playlistId)` in `playPlaylist`. Those are navigation and
selection, not invalidation, and they run synchronously in the action, so the
debounced reload always arrives after them and the comment about ordering goes
with the code it described.

The library store gains a `watch()` mirroring the playlists store's, and
`App`'s `onLibraryChanged` effect becomes a call to it. It is a stable action
selector, so it adds no renders.

`playlists.load()` mostly goes the same way, with two exceptions: `create` and
`createFrom` set `renaming` to a row that has to be on screen for the inline
rename to open, so they keep their direct `load()`. Waiting a debounce there
would put the rename input on a row that does not exist yet.

## Notes

`editor.save` currently awaits `refresh`, so the table is correct the moment
the dialog closes; it will now lag by the debounce. Acceptable, but it is the
one visible behaviour change - check it against the e2e specs.

Six tests prove a cross-store refresh by reading `queryToken`
(`editor/store.test.ts`, `playlists/store.test.ts`); they become tests that the
event drives the reload. `debounce` is already fake-timer friendly, as
`playlists/store.test.ts` shows.

Fix all three comments and `knowledge/architecture.md` with the code.
