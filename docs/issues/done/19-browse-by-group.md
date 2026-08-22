# 19 — Browse by album, artist and genre

Merged in #27. The three tabs had been rendered `disabled` with a "Not
implemented yet" tooltip since phase 3.

One query plus one condition, not a second table:

- **`browse_groups` runs through the same `scope()` the songs table uses**, so a
  search or an open playlist narrows the album list exactly as it narrows the
  rows. That reuse is why this phase was small.
- Drilling in is `TrackQuery.browse`, so paging, sorting, select-all, the queue
  and export keep working inside an album with no second code path.
- **`IS ?` rather than `= ?`**: a bound NULL equals nothing, so `=` returns an
  empty view for the untagged group and dropping the clause returns the whole
  library. Both failures are silent; both have tests.
- Grouped on `coalesce(nullif(album_artist,''), nullif(artist,''))` so a
  compilation stays one album and a `""` tag is absent rather than its own group.
  Albums are keyed by title **and** artist.
- "Unknown Album" is a frontend label, not a stored value.
- The group list deliberately ignores an open drill-in, or opening an album
  collapses the list to that album with no way back.
- Unpaged but virtualized: a few hundred albums needs no window cache. It is the
  one query in the app with no `LIMIT`, so it has a perf guard.
- The React key joins two keys with U+001F — with a space, album "A" by "B C" and
  album "A B" by "C" collide and React reuses one tile for the other.
- The e2e suite switches tabs now, because "three of four tabs do nothing" is
  exactly what a smoke test should catch.
