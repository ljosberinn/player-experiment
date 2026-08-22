# 14 — Library totals in the footer

Merged in `e079457`.

`library_stats(query)` returns `{ tracks, duration_ms, bytes, missing }` for the
**current** view, so it reflects a search or an open playlist.

- `count_tracks` became a thin wrapper over it rather than a second query, so the
  scrollbar and the footer cannot describe different views. A test asserts they
  agree.
- `duration_ms` and `bytes` are `i64`: a library passes four billion milliseconds
  at about seven hundred hours.
- `sum()` of no rows is NULL in SQLite — without `coalesce` an empty library does
  not return zeroes, it fails to decode. Three tests cover it.
- The footer shows size, the status display does not: room for two facts, not
  three. A zero size is omitted rather than rendered as "0 MB".
