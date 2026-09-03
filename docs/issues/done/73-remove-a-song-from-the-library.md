# 73 — Remove a song from the library

Nothing takes out a row the user simply does not want. `remove_missing_tracks`
is the only command that destroys library rows, and it takes every missing row
or none.

Del, the File menu and the row's right-click menu. The file on disk is not
touched.

## A rescan brings it back

`scan::plan` adds every audio file under a watch folder it does not already
know, so a removal that leaves no record lasts until the next Rescan — one
File-menu item away. Migration 8:

```sql
CREATE TABLE removed_paths (path TEXT PRIMARY KEY, removed_at INTEGER NOT NULL);
```

`plan` takes the tombstones as a third argument and a tombstoned path is
neither added nor counted — it never reaches `known`, so the missing loop below
cannot see it either. Keyed on `path.to_string_lossy()`, the same string
`load_known` matches `tracks.path` on, so case behaves exactly as it already
does. `plan` is pure and covered on its own; the new rule belongs in those
tests.

**`remove_missing` writes no tombstones.** A drive coming back should restore
what was on it — that is what migration 4 exists for. Only an explicit per-row
removal is a statement about wanting the song gone.

**An explicit add lifts the tombstone.** Nothing does that yet;
[85](../upcoming/85-drop-files-and-folders.md)'s file drop and [83](../upcoming/83-the-library-folder.md)'s
mover both must, or a dropped file would silently do nothing.

And an escape hatch, or a mis-click is reversible only by editing the database:
File gains **Forget N Removed Songs…**, which drops the tombstones so the next
rescan re-adds them.

## Del already means something

Inside a static playlist it removes the membership row —
`useSelectionShortcuts` for the window, `SongRow` for the focused row. That
stays: it is the less destructive reading and the one the view is about.
Everywhere else — the library, a browse drill-in, a smart playlist — Del removes
from the library.

Two callbacks, not one. `SongTable`'s `onRemove` keeps meaning "out of this
playlist"; the library removal is its own prop. `App` passes the first only when
`editable`, the second always. `SongRow`'s existing rule — the row under the
cursor wins over the selection when they disagree — carries over unchanged.

Which makes Del destructive in most views, so the confirmation is not optional.
`ConfirmDialog`, phrased like the missing-songs one: the count, that the files
are not touched, that playlist entries go too, and that a rescan will not bring
them back.

## Menu placement

The right-click menu's entries come from `rowMenuItems`, which `menus()` spreads
into Edit so the two cannot drift. This entry is the exception — the user wants
it in File, beside the other row-destroying entry — so it reaches `rowMenuItems`
through a callback that `AppMenus` leaves undefined. Present on right-click,
present in File, not twice. File becomes:

```
Add Folders…  ·  Rescan  ─  Remove N Songs from Library…  ·  Remove N Missing Songs…  ·  Forget N Removed Songs…
```

with the last two still absent at zero. `LibraryStats` gains `removed` for that
label — a bare `count(*)` over `removed_paths`, outside `scope()`, unlike
`missing`, which is narrowed to the current view.

## What follows the delete

- `playlist_tracks` and `tag_undo` cascade (`foreign_keys` is ON), and
  `tracks_fts_delete` keeps the index in step.
- **Undo Tag Edit gets quietly older.** `undo_last` takes `max(batch_id)`, so a
  removal that cascades away the newest batch leaves Undo pointing at the edit
  before it. `can_undo` is only re-read on mount and after an edit, so the
  entry can also sit enabled over an empty journal — `refreshUndo` after a
  removal.
- `clearSelection()` afterwards, as `removeTracks` already does: the ids it
  names are gone. The command goes through `announcing`, so `library://changed`
  drives the reload.
- `covers` keeps the orphan: `tracks.cover_hash` has no cascade and nothing
  prunes it yet. One more reason for the vacuum
  [72](72-covers-are-most-of-the-database.md) makes safe, not a blocker here.
- `tag_values::rebuild`, as `remove_missing` already does. Five full aggregates
  per gesture, against per-value decrements across five fields — the rebuild is
  the cheaper thing to be sure of.
- **Playback keeps going, and the transport goes blank.** `QueueEntry` holds a
  path and a duration, so removing what is playing does not interrupt it — but
  `db::playback::snapshot` fills `track` from the row by id, so the next
  `player://state` event renders "Nothing playing" over audio that is still
  playing, until the queue moves on. Accepted rather than excluding the playing
  row from the removal: stopping the music because of a library edit is worse,
  and refusing to remove one row out of a selection is worse still.

## Also

Three comments become false: `rowMenu.ts`'s "In the library this action would
have to mean deleting the file, which is not something a menu should offer next
to Edit", `useSelectionShortcuts.ts`'s "deleting the file is not what Delete
means", and the "only place library rows are destroyed" claim carried by both
`scan::remove_missing` and `commands::remove_missing_tracks`.

`docs/knowledge/data-model.md`'s migration table gains row 8. The new entries
belong in the `menus` and `row-menu` e2e specs.
