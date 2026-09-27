# 170 — One schema, no history

`db::schema::MIGRATIONS` is 20 steps. Fold them into one that creates the
schema as it stands at 20, written as if it had always been known.

## Fix

- One `CREATE` per table with its final columns, constraints and indexes:
  `tracks.path` `NOCASE` from the start, `release_lookup`'s five statuses in
  the first `CHECK`, `loved` rather than `lastfm_loved`, `covers.palette`,
  `playlists.built_in`, `tracks.match_key`, migration 20's group indexes.
- Only the genre seed stays as data. Every step that exists only for a library
  from before it goes: the `tag_values` backfill (4), the case-fold merge
  (12), the settings deletes (15, 19), the `release_lookup` repair (17), the
  `loved.syncedWith` copy (18), the built-in claim (19), and every
  table rebuild.
- An existing library at version 20 opens unchanged: the folded schema counts
  as version 20, a fresh database is stamped 20, and 1–19 are refused with a
  message naming 0.20.0 as the build that upgrades them.
- Comments explain the schema, not how it got there. Drop the `tag_undo` note
  and every "migration N" reference in code, comments and
  [data-model](../../knowledge/data-model.md).

## Done when

- A fresh database and one migrated 1→20 on `main` have the same tables,
  columns (`table_xinfo`: type, nullability, default, collation), indexes
  (`index_xinfo`, partial `WHERE`), triggers and `CHECK`s. Column order may
  differ.
- Tests that stop short of a migration (`before_the_fold`, `take(n)`,
  `MIGRATIONS[n]`) are gone; the constraints they covered are still tested on
  a fresh database.
- A version-20 database from `main` opens with its data intact.
- `tests/perf.rs`' migrate budget still holds.
