# 73 — Remove a song from the library

Nothing takes out a row the user simply does not want. `remove_missing_tracks`
is the only command that destroys library rows, and it takes every missing row
or none.

Del, the File menu and the row's right-click menu. The file on disk is not
touched.

**A rescan brings it back.** `scan::plan` adds every audio file under a watch
folder it does not already know, so a removal that leaves no record lasts until
the next Rescan — one File-menu item away. So this needs a tombstone: a
`removed_paths` table (migration 8), checked in `plan` before a path lands in
`added`. And an escape hatch beside it, or a mis-click is reversible only by
editing the database — File gains **Forget N Removed Songs…** next to Remove N
Missing Songs…, which drops the tombstones so the next rescan re-adds them.

**Del already means something.** Inside a static playlist it removes the
membership row — `useSelectionShortcuts` for the window, `SongRow` for the
focused row. That stays: it is the less destructive reading and the one the view
is about. Everywhere else — the library, a browse drill-in, a smart playlist —
Del removes from the library. Which makes Del destructive in most views, so the
confirmation is not optional. `ConfirmDialog`, phrased like the missing-songs
one: the count, that the files are not touched, that playlist entries go too.

**Menu placement.** The right-click menu's entries come from `rowMenuItems`,
which `menus()` spreads into Edit so the two cannot drift. This entry is the
exception — the user wants it in File, beside the other row-destroying entry —
so it reaches `rowMenuItems` through a callback that `AppMenus` leaves
undefined. Present on right-click, present in File, not twice.

What follows the delete:

- `playlist_tracks` and `tag_undo` cascade, so a tag edit on a removed track
  stops being undoable.
- `covers` keeps the orphan: `tracks.cover_hash` has no cascade and nothing
  prunes it yet. One more reason for the vacuum
  [72](72-covers-are-most-of-the-database.md) makes safe, not a blocker here.
- `tag_values::rebuild`, as `remove_missing` already does. Five full aggregates
  per gesture, against per-value decrements across five fields — the rebuild is
  the cheaper thing to be sure of.
- Playback keeps going. `QueueEntry` holds a path and a duration, not a row, so
  removing what is playing does not interrupt it; the row leaves the table and
  `nowPlayingId` matches nothing. Stopping the music because of a library edit
  is worse.

Two comments become false: `rowMenu.ts`'s "In the library this action would have
to mean deleting the file, which is not something a menu should offer next to
Edit", and `scan::remove_missing`'s "the only place library rows are destroyed".
