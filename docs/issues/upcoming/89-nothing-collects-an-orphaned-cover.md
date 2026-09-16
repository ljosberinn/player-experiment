# 89 — Nothing collects an orphaned cover

`covers` rows are deleted in one place —
[covers.rs:237](../../../src-tauri/src/db/covers.rs#L237) — inside
`normalize_stored`, behind the `covers.normalized` flag that makes it run once
per database and never again. Three paths orphan a row and none of them is that
one:

- `scan::remove_missing` and `scan::remove_tracks` delete track rows
  ([scan/mod.rs:283](../../../src-tauri/src/scan/mod.rs#L283),
  [:316](../../../src-tauri/src/scan/mod.rs#L316)). `tracks.cover_hash` carries
  no `ON DELETE`.
- A tag write stores replacement artwork
  ([write.rs:368](../../../src-tauri/src/tags/write.rs#L368)) and rewrites
  `cover_hash`, leaving the old row.
- A rescan of a file retagged outside the app does the same through
  `scan::store_cover` ([scan/mod.rs:540](../../../src-tauri/src/scan/mod.rs#L540)).

[72](../done/72-covers-are-most-of-the-database.md) named this — "73 orphans a
row per removal and 79b fetches 8,045 covers" — and put the prune behind the
flag, so its one run is the launch that finishes the backfill, before either had
happened. Both have since shipped.

A leak, not a cliff: an orphan averages 37 KB after 72, and the rate follows
removals and retags.

## Shape

Move the prune out of `normalize_stored` into a sweep of its own on the same
`cover-normalize` thread ([lib.rs:357](../../../src-tauri/src/lib.rs#L357)),
unflagged, every launch. `DELETE … WHERE hash NOT IN (SELECT cover_hash FROM
tracks WHERE cover_hash IS NOT NULL)` is one pass over 65k rows and wants no
index.

**VACUUM stays conditional.** It cannot run in a transaction and rewrites the
whole file — a gigabyte on every launch to reclaim one 37 KB row is the trade
that only made sense once. `PRAGMA freelist_count` × `PRAGMA page_size` over a
threshold is the gate, and the sweep is silent either way for the reason 72
gives.

**No migration.**

## Tests

- The sweep drops a cover no track references and keeps a referenced one, on a
  database where `covers.normalized` is already set.
- Removing a track collects its cover; removing one of two tracks sharing a
  cover does not.
- A tag write that replaces artwork collects the old row.
- The VACUUM gate holds below the threshold and fires above it.

No screenshots — nothing visible changes.
