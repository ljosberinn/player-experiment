# 147c — Who was new

*New artists* names them. Stacks on [147a](147a-a-bar-is-a-stretch-of-time.md),
which makes its bars drill to a period.

- `stats::new_artists(query, offset, limit)` → `{ artist, firstAt, plays }`,
  newest first. Same rule as `firsts`: the range narrows the result, not the
  plays, and an artist first heard undated is left out. `plays` counts every
  play under the query minus its range — plays since first heard, not plays in
  the bucket.
- Wrapper `statsNewArtists` in `src/ipc/index.ts`.
- A list under the chart in the *New artists* panel: artist, first heard date,
  plays. Paged and virtualized like `RecentPlays`. A row drills to the artist
  crumb.
- Under a period crumb or a range it is who was new there; under all time,
  the latest discoveries.
- Hidden under an artist or album crumb, as the chart is.

## Testing

- Rust: range narrows the result; undated first play excluded; `plays`
  ignores the range; paging; perf budget in `tests/perf.rs` at
  `seed_plays` size.
- Row pushes an artist crumb.
- Story under `Features/Statistics`: a list, empty.
