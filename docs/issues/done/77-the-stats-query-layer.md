# 77 — The stats query layer

`src-tauri/src/db/stats.rs`, its commands and the IPC types over it. Every
aggregate [84a](../upcoming/84a-what-you-have-heard.md) and
[84b](../upcoming/84b-what-you-own.md) draw, with no frontend yet. Stacks on
[76](76-the-play-log.md); [80](80-the-statistics-view.md) waits on it.

## Two query types

Holding to the smart-playlist discipline — typed structs and whitelisted fields,
never user text concatenated into SQL.

```rust
pub struct ListenQuery {
    pub range: Option<TimeRange>, // unix seconds, [from, to)
    pub artist: Option<String>,
    pub genre: Option<String>,    // the genre and its descendants
    pub album: Option<String>,
    pub owned: Option<bool>,      // track_id IS [NOT] NULL
}
```

**No `loved` filter yet.** [76](76-the-play-log.md) keeps loved off `plays` —
it is the current state of a track, not a fact about a moment — and nothing has
imported the loved set, so the field would filter data no phase has written.
[78](78-import-the-lastfm-history.md) adds both.

**Library panels take the existing `TrackQuery` instead**, so every library
aggregate goes through `scope()` and can be scoped to a view or a playlist
rather than only to the whole library. A second query type for them would fork
scoping.

**`genre` walks the tree the donut draws, not `genre_edges`.** A tag is free
text — "DSBM", "Atmospheric Black Metal" — that reaches a label only through
[75](75-the-genre-tree.md)'s Rust-side normalization, aliases, suffix derivation
and overrides, none of which an edge table holds. And the edges are the DAG:
filtering on them would put blackened death metal under black metal after an
override moved it to death metal, so the filter and the donut would disagree.
So the distinct `tracks.genre` values are resolved through `genres::Tree`, the
raw strings whose primary-parent chain passes through the label are kept, and
they are bound as one JSON array through `json_each`. A chain walk stops at a
label it has seen, because an override can close a cycle; refusing one at write
time is 84b's, which is the only writer.

Artists and albums group `COLLATE NOCASE`, as `browse_groups` does; a track is
its `match_key`. Blank artists, albums and keys are not an entry in a top list.

## The aggregates

Small independent functions returning small `Vec`s. Over `plays`:
`listen_totals`, `recent_plays`, `top(dimension)`, `plays_over_time(bucket)`,
`week_clock`, `firsts(bucket)`, `streaks`. Over `tracks`: `library_totals`,
`histogram(field)`, `worst_by_bitrate`, `genre_breakdown(parent)`,
`added_over_time(bucket)`, `tag_health`.

Against the plan's list: **`listen_totals` and `library_totals`** are the two
tile rows, which nothing covered. **`coverage` folds into `listen_totals`** —
the share-owned tile is the same count over the same scan. **`clock` goes**:
hour-of-day is `week_clock`'s column sums. **`quality_histogram` becomes
`histogram(field)`** over bitrate, sample rate, year and duration, because 84b
draws all four and they are one query shape.

- **A play with no matching file counts everywhere**, marked as not in the
  library. Artist, track, time-of-day and calendar aggregates take every play;
  genre can only take matched plays, so `listen_totals` carries how many have a
  known genre and a panel can say "genre known for 84% of plays" rather than
  quietly report a subset as the whole.
- **Time spent is `coalesce(plays.duration_ms, tracks.duration_ms)`.** An
  imported scrobble carries no duration, so `listen_totals` counts the plays
  with one, for the same reason.
- **`firsts` narrows the result by the range, not the plays.** Every other
  filter picks the plays; each artist's first one is then found over all time.
  Otherwise "new this year" is every artist heard this year.
- **`streaks` takes `now`**, as `smart::compile` does, so the current streak is
  testable. A streak still counts if today has no play yet.
- **Buckets are named by their first local day**, `YYYY-MM-DD`, weeks starting
  Monday, and are sparse: the chart owns its axis and fills the gaps.
- **No rollup tables.** 237k rows is one indexed `GROUP BY`. A materialized
  aggregate would buy nothing and would owe an invalidation path.
- **Bucketing is local time** — `datetime(started_at, 'unixepoch', 'localtime')`.
  Under UTC, listening at 23:00 lands on tomorrow's Tuesday, which ruins the
  hour-of-day panel specifically. DST leaves two irregular days a year;
  documented, not corrected.
- **`sum()` over no rows is NULL**, so every aggregate is `coalesce`d — the trap
  `library_stats` already names.

Commands are `async` through `blocking`: a full-history aggregate is not
something to run on the thread that paints the window. `#[derive(TS)]` on every
type crossing IPC, so `npm run bindings` runs. The `ipc/index.ts` wrappers land
with their callers.

## Testing

Each aggregate over a seeded database, including the empty case, which is
where the `coalesce` rule is actually asserted. `ListenQuery` gets a
filter-combination test per field; the genre filter an alias, a derived child,
an override and a cycle.

**Local time is asserted from a play built at 23:00 local**, by SQLite's own
`'utc'` modifier, so the test holds in any zone. It only bites off UTC, and the
Windows runner is UTC, so the CI test step pins `TZ`.

`tests/perf.rs` gets a budget per aggregate at 250k plays. `seed_plays` spaced
its rows one second apart, which puts a quarter of a million plays inside three
days; they are spread over years instead, so day buckets and streaks are
measured at the cardinality a real history has.
