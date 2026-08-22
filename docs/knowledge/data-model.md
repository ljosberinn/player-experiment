# Data model

SQLite via `rusqlite` (bundled), migrations in `src-tauri/src/db/schema.rs`.
`PRAGMA user_version` records progress. **Migrations are append-only** — never
edit a shipped one.

| # | Adds |
| --- | --- |
| 1 | `covers`, `tracks`, `playlists`, `playlist_tracks`, `settings`, `watch_folders` |
| 2 | `tracks_fts` (FTS5 external-content over title/artist/album/album_artist/genre/comment, kept current by triggers) |
| 3 | `tag_undo` — one row per track per edit, grouped by `batch_id` |
| 4 | `tracks.missing_since` + a **partial** index |
| 5 | `tag_values` — the distinct values a library uses, for autocompletion |
| 6 | `covers.palette` — the dominant colours of a cover |

## One query, narrowed

Everything the table shows comes from one statement built by `db::query`'s
`scope()`. A search, an open playlist, a browse drill-in and a smart playlist's
cutoff are all **clauses on the same query**, not queries of their own — which
is why paging, sorting, search-within, "select all", the play queue, export and
`library_stats` work in every view with no second code path.

- **Placeholders are anonymous `?` bound in order**, so a clause can be added or
  dropped without renumbering its neighbours.
- **Relevance and position are `SortField`s**, not flags: valid only when a
  search or a playlist is joined in, and falling back to a real column
  otherwise, so a stored sort is harmless in a view that cannot honour it.
- **`bm25` is weighted** so a title hit outranks one buried in a comment, and it
  ignores sort direction — there is no useful "worst match first".
- **Row count is a separate `COUNT(*)`**, so the scrollbar is right without
  loading rows. `count_tracks` is a thin wrapper over `library_stats`, so the
  footer and the scrollbar cannot describe different views.
- **`sum()` of no rows is NULL in SQLite**, not 0 — every aggregate is
  `coalesce`d or an empty library fails to decode.
- **`all_track_ids`** exists because "select all" needs ids, not rows; routing
  it through the paged query would silently cap a 50k selection at the page
  size.

## Playlists

- `playlist_tracks` is keyed on `(playlist_id, track_id)`: **a playlist holds
  each track at most once.** A drop reports "added 6 of 10, 4 already there".
- **`position` is gapped by 1024**, so a drop is one UPDATE per moved row. When
  a gap runs out the playlist is renumbered once, with a gap wide enough that
  the retry cannot fail for the same reason.
- **Reordering is offered only in a playlist's own order.** Sorted by a column
  the arrangement is derived and a drop would have nothing to persist.
- A deleted playlist reads as an **empty view**, not an error — dropping the
  clause instead would show the whole library.
- Per-playlist columns live in `playlists.columns_json`; the library view keeps
  its own row in `settings`. `None` stays distinguishable from "configured to
  show nothing" — a playlist with no layout inherits the library's.

## Smart playlists

A persisted filter **tree**, never SQL. `smart/compile.rs` turns it into a
parameterized `WHERE` plus a bind vector, and `playlists.sort_json` carries the
optional sort and limit.

```ts
type Rule  = { field: TrackField; op: Op; value: FilterValue };
type Group = { combinator: "and" | "or"; children: (Rule | Group)[] };
```

- The compiler whitelists fields **and** sort fields — both are concatenated
  into SQL, so neither can ever be user text.
- **`FilterValue` is typed.** A rule whose value does not match its field is
  refused at save time, not coerced.
- **Exclusion rules spell out the NULL case.** `NULL <> 'Guitar'` is NULL, so
  `IsNot` and friends read `(col IS NULL OR …)` or every untagged file silently
  disappears.
- **`LIKE` patterns escape `%`, `_` and the escape character** — otherwise "50%"
  matches every title starting with 50.
- **Depth and rule count are capped** (10 and 200): compilation recurses.
- **An empty filter matches everything** — a new smart playlist shows the
  library to narrow down.
- **`now` is passed into the compiler**, so "added in the last 7 days" is
  testable without waiting a week.
- **A limit decides membership, not display order**: it lives in `scope()` as
  `tracks.id IN (SELECT id … ORDER BY … LIMIT ?)`. Appended to the page query
  instead, sorting the open playlist would change which songs it holds and a
  search inside it would search the whole library.
- The backend validates every filter by compiling it before storing.
