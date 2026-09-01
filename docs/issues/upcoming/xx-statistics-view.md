# xx — Statistics

The sidebar ships a dimmed, inert **Statistics** item, as the design draws it.
What it shows is undecided — that decision is the work, not the rendering.

Material already in the database: play counts and `last_played_at` per track,
`added_at`, durations, sizes, missing counts, and per-field vocabularies in
`tag_values`. Anything aggregate goes through `db::query`'s `scope()` so it can
be view-scoped rather than library-wide, and wants a perf guard — these are the
queries with no `LIMIT` behind them.

Needs a decision before it needs a branch.
