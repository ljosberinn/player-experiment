# 97 — Nothing collects an orphaned cover

`covers` rows are deleted in one place —
[covers.rs:237](../../../src-tauri/src/db/covers.rs#L237) — inside
`normalize_stored`, behind the `covers.normalized` flag that makes it run once
per database and never again. Three paths orphan a row and none of them is that
one:

- `scan::remove_missing` and `scan::remove_tracks` delete track rows
  ([scan/mod.rs:283](../../../src-tauri/src/scan/mod.rs#L283),
  [:316](../../../src-tauri/src/scan/mod.rs#L316)). `tracks.cover_hash` carries
  no `ON DELETE`.
- A tag write stores replacement artwork or removes it
  ([write.rs:368](../../../src-tauri/src/tags/write.rs#L368)) and rewrites
  `cover_hash`, leaving the old row.
- A rescan of a file retagged outside the app does the same through
  `scan::store_cover` ([scan/mod.rs:540](../../../src-tauri/src/scan/mod.rs#L540)).

[72](72-covers-are-most-of-the-database.md) named this — "73 orphans a row per
removal and 79b fetches 8,045 covers" — and put the prune behind the flag, so
its one run is the launch that finishes the backfill, before either had
happened. Both have since shipped.

A leak, not a cliff: an orphan averages 37 KB after 72, and the rate follows
removals and retags.

## Shape

Move the prune out of `normalize_stored` into a sweep of its own on the same
`cover-normalize` thread ([lib.rs:357](../../../src-tauri/src/lib.rs#L357)),
unflagged, every launch, after the backfill. `DELETE … WHERE hash NOT IN
(SELECT cover_hash FROM tracks WHERE cover_hash IS NOT NULL)` scans `covers`
— 5,799 rows plus what 79b fetched — against 65,535 track rows, and wants no
index.

**The VACUUM moves too, and becomes conditional.** It cannot run in a
transaction and rewrites the whole file — a gigabyte on every launch to reclaim
one 37 KB row is the trade that only made sense once. `PRAGMA freelist_count` ×
`PRAGMA page_size` over 32 MB is the gate, which is roughly 870 orphans, and
which the launch that finishes 72's backfill clears by a factor of twenty-five.
Nothing announces either way for the reason 72 gives — no cover changes, so no
view is stale — and the log records only a sweep that did something.

**The DELETE holds `ScanLock`**, dropped before the VACUUM, which needs no
ordering against anything. `covers::store` returns a hash it found without
writing anything ([covers.rs:56](../../../src-tauri/src/db/covers.rs#L56)), so
it holds no write lock, and a sweep committing between that read and the
caller's `UPDATE tracks … cover_hash` would abort the write on the foreign key.
It takes an orphan re-stored byte-identical inside the sweep's few
milliseconds, but the lock is free. `write_tags` takes no `ScanLock` at all and
is left as it is.

**No migration.**

## Tests

- The sweep drops a cover no track references and keeps a referenced one, on a
  database where `covers.normalized` is already set.
- Removing a track collects its cover; removing one of two tracks sharing a
  cover does not.
- A tag write that replaces artwork leaves a row the next sweep collects.
- The VACUUM gate holds below 32 MB of free pages and fires above it.

No screenshots — nothing visible changes.
