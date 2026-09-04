# 77 — The stats query layer

`src-tauri/src/db/stats.rs` and the IPC types over it. Every aggregate
[84a](84a-what-you-have-heard.md) and [84b](84b-what-you-own.md) draw, with no
frontend yet. Stacks on [76](76-the-play-log.md); [80](80-the-statistics-view.md)
waits on it.

## Two query types

Holding to the smart-playlist discipline — typed structs and whitelisted fields,
never user text concatenated into SQL.

```rust
pub struct ListenQuery {
    pub range: Option<(i64, i64)>,
    pub artist: Option<String>,
    pub genre: Option<String>,   // the genre and its descendants
    pub album: Option<String>,
    pub owned: Option<bool>,
    pub loved: Option<bool>,
}
```

**Library panels take the existing `TrackQuery` instead**, so every library
aggregate goes through `scope()` and can be scoped to a view or a playlist
rather than only to the whole library. A second query type for them would fork
scoping.

`genre` expands through [75](75-the-genre-tree.md)'s `genre_edges` when that has
landed and matches the label alone when it has not — the descendant expansion is
one recursive CTE and this phase does not depend on 75 for anything else.

## The aggregates

Small independent functions returning small `Vec`s. Over `plays`:
`recent_plays`, `top(dimension)`, `plays_over_time(bucket)`, `clock`,
`week_clock`, `streaks`, `firsts`, `coverage`. Over `tracks`:
`quality_histogram`, `worst_by_bitrate`, `genre_breakdown(parent)`,
`added_over_time`, `untagged_report`.

- **A play with no matching file counts everywhere**, marked as not in the
  library. Artist, track, time-of-day and calendar aggregates take every play;
  genre and quality ones can only take matched plays, so `coverage` exists to
  let a panel say "genre known for 84% of plays" rather than quietly report a
  subset as the whole.
- **No rollup tables.** 237k rows is one indexed `GROUP BY`. A materialized
  aggregate would buy nothing and would owe an invalidation path.
- **Bucketing is local time** — `datetime(started_at, 'unixepoch', 'localtime')`.
  Under UTC, listening at 23:00 lands on tomorrow's Tuesday, which ruins the
  hour-of-day panel specifically. DST leaves two irregular days a year;
  documented, not corrected.
- **`sum()` over no rows is NULL**, so every aggregate is `coalesce`d — the trap
  `library_stats` already names.

`#[derive(TS)]` on every returned struct, so `npm run bindings` runs.

Testing: each aggregate over a seeded database, including the empty case, which
is where the `coalesce` rule is actually asserted. Local-time bucketing gets a
play at 23:00 asserted onto its own day. `ListenQuery` gets a filter-combination
test per field. `tests/perf.rs` gets a budget per aggregate at 237k rows.
