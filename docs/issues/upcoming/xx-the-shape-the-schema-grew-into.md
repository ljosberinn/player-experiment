# xx — The shape the schema grew into

Eleven migrations, none of them a redesign. Does the schema still describe the
data, or only the order the features arrived in? Backwards compatibility is not
a concern: `library.sqlite3` is rebuildable from disk by a rescan, so the
answer may be to collapse 1–11 into one migration rather than append a twelfth.

**Not workable yet.** [76](76-the-play-log.md) and
[87](87-one-release-one-tile.md) both add tables, and a schema still growing is
one that would be refactored twice.

## Candidates

- **A release is a first-class thing in four places and a table in none.** The
  browse grid groups by two `COLLATE NOCASE` expressions
  ([query.rs:445](../../../src-tauri/src/db/query.rs#L445)); `release_lookup`
  is keyed by the same pair through a `coalesce(…) COLLATE NOCASE` unique
  index; `library::layout` computes a folder from it; 87 draws a tile per one.
  Four derivations of one identity, each of which has to fold case the same way
  or the counts disagree.
- **`tracks` carries five concerns in 24 columns** — file identity (`path`,
  `mtime`, `size`), tags, decoded properties (`bitrate`, `sample_rate`), play
  aggregates (`play_count`, `last_played_at`, both derivable once 76 lands),
  and scan state (`missing_since`).
- **Tag strings are stored per row and again in `tag_values`.** `artist`,
  `album`, `album_artist` and `genre` repeat across the library; `tag_values`
  already holds each distinct value with its use count. Interning is a
  measurement, not an argument: FTS5 external-content and `scope()`'s sort
  columns both read `tracks` directly.
- **Two mechanisms for an absent file**, keyed differently:
  `tracks.missing_since` by id, `removed_paths` by path.
- **A genre's parent can live in three tables.** `genres.parent` is an edge
  `genre_edges` already holds, and `genre_overrides` is a third; resolution
  reads all three plus a suffix rule.
- **Five JSON columns**: `playlists.filter_json`, `sort_json`, `columns_json`,
  `covers.palette`, `release_lookup.candidates_json`. Each was argued for at
  the time — whether all five still hold is the question.
- **`settings` is seventeen named keys of unrelated shape** in one key/value
  table: player state, window geometry, a column layout, two thread resume
  markers (`covers.normalized`, `playlists.seeded`), credentials kept out of an
  export by an `is_exportable` allowlist. Column layout also lives in
  `playlists.columns_json`, per playlist.
- **Migration 10 rebuilt a table to widen a `CHECK`.** A status vocabulary that
  has grown once will grow again, and SQLite cannot widen one in place.

## What decides it

Measure before arguing. `db::synthetic` seeds 150k rows and `tests/perf.rs`
already asserts the plans that must not regress — row width, the page query and
the browse grouping, before and after. A schema that reads tidier and queries
slower is not the trade.

The other half is [knowledge/data-model.md](../../knowledge/data-model.md),
which is the record of why each of the above is the way it is. Anything the
investigation proposes to collapse has to answer the reasoning already written
down there, and anything it collapses has to rewrite it.
