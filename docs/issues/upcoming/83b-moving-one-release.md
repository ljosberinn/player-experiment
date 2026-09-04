# 83b — Moving one release

The mover: one release from wherever it is to where
[83a](../done/83a-where-a-file-goes.md) says it goes, with the rows following the files.
Reachable from nothing yet — [83c](83c-turning-the-library-folder-on.md) is what
calls it — so this phase is the operation and its tests.

**`tracks.path` is the row's identity.** `insert_track` is `ON CONFLICT(path)`,
so a move the scanner discovers is a new row plus an old row marked missing,
which costs the play count, `added_at` and every playlist the track was in. The
`UPDATE tracks SET path` commits in the **same transaction** as the rename, and
nothing about this feature may route through a rescan.

**The release is the unit.** It is what the layout is built around, it is what
82b already resolved, and a half-moved release is the only state worth never
leaving behind. `ScanLock` is taken per release, not for the pass, the way
[82b](../done/82b-the-unattended-lookup-pass.md) takes it: the mover rewrites the paths
a scan reads, but holding the lock for a four-hour backfill would block every
scan in that window.

## One release, one transaction

Acquire the lock, open the transaction, rename each file, `UPDATE` each row,
commit. Files first inside the transaction so a rename that fails rolls the
rows back with it.

**`mtime` and `size` update in the same statement.** `plan` diffs on exactly
that pair, and a cross-volume move gives the target a fresh `mtime` — leaving
the row stale would make the next scan re-read tags for all 65,535 files. It is
the same discipline `sync_row` already keeps after a tag write.

**Failure does not need unwinding, because the target is derived.** A release
left with some files moved and some not computes the same targets on the next
attempt, and a file already at its target is a no-op. That is the resume
mechanism and the retry mechanism at once, and it is why there is no state table
here.

- **A rename across volumes fails** with `ERROR_NOT_SAME_DEVICE`, so the
  fallback is copy, verify the size, delete the source. Size and not a hash:
  hashing a 400 GB library to confirm what the filesystem already confirmed
  costs hours and answers nothing.
- **A target that already exists** is two different situations, and the `tracks`
  table separates them. If a row owns that path it is a real collision — two
  releases that sanitize to one name — and the filename gets a ` (2)` suffix
  before the extension. If no row owns it, it is the partial file an interrupted
  copy left behind, and it is overwritten.

## The tombstone is a hazard at the target, not the source

`plan` skips any on-disk path in `removed_paths` **before** it marks the path
seen, so a known row whose path is tombstoned is not merely skipped — it is
marked missing on every scan, forever. That cannot happen today because
`remove_tracks` deletes the row it tombstones. It can happen the moment a file
lands on a path the user once removed a different file from.

So the transaction deletes any `removed_paths` row for the target path. Nothing
writes one for the source: the mover only ever moves rows that exist, and only
an explicit removal tombstones. [73](../done/73-remove-a-song-from-the-library.md)'s
note about lifting a tombstone is about [85b](85b-drop-files-and-folders.md)'s
drop, which is the other half of it — and which needs the move below without the
`UPDATE`, for a file that has no row yet.

## What travels and what stays

- **Cover art travels, nothing else does.** `cover`/`folder`/`front`
  `.jpg|.png`, matched case-insensitively, move into the release folder;
  `.nfo`, `.cue`, `.log`, `.m3u` stay.
- **And only when the folder held nothing else.** A source folder containing two
  releases would otherwise have its artwork taken away from whichever release
  moved second.
- **Source folders left empty are removed**, walking upward until a folder is
  not empty or is a watch-folder root, which is never removed. `remove_dir`
  rather than `remove_dir_all`, so the folder that kept its `.nfo` keeps
  existing too.

## Skipped, not failed

- **A track already marked missing.** There is no file to move, and the row's
  path is the last place it was seen.
- **The release the player currently has open.** `audio::sink` holds a
  `std::fs::File` on the playing track and a second on the prepared next one.
  A same-volume rename survives that, but the cross-volume path deletes the
  source under a live decoder, and the difference is not something a caller can
  see before it tries.

*Open:* what "skipped" means for the playing release during a long backfill,
where the next pass is a relaunch away. Recommendation: deferred to the end of
the run rather than skipped, so a user who leaves one album on does not find it
the only one left behind.

One `log::Op` per release through `announcing_with`, which is what
[86](../done/86-every-operation-in-a-logfile.md) named this work for, and one
`library://changed` per release — coalesced on the emit side by
[82a](../done/82a-what-eight-thousand-releases-break.md), which is why that lands first.

Testing: a `tempfile` root throughout. A moved release asserted to keep its
track ids, play counts and playlist places; the rename asserted to roll the rows
back when it fails partway; a collision against a row-owned target asserted
suffixed and an orphan target asserted overwritten; the cross-volume fallback
driven by injecting a rename that returns `ERROR_NOT_SAME_DEVICE`; a shared
source folder asserted to keep its cover; an emptied folder asserted removed and
a watch root asserted not; a target path carrying a tombstone asserted to leave
the row present after a following scan.
