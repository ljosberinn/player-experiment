# 147c — Who was new

*New artists* names them. Stacks on
[147a](../done/147a-a-bar-is-a-stretch-of-time.md), whose period crumb reaches
the list through `listenQuery`'s range.

- `stats::new_artists(query, offset, limit)` → `NewArtist { artist, firstAt,
  plays }`, newest first, the name breaking a tie. Shares `FirstHeard` with
  `firsts`: the range narrows the result, not the plays, and an artist first
  heard undated is left out. `plays` counts every play under the query minus
  its range.
- Command `stats_new_artists`, wrapper `statsNewArtists`.
- `NewArtistList`: artist, first heard, plays since. Rows are buttons that
  drill to the artist crumb. Draws nothing when empty. Sits in `SeriesPanel`'s
  `children`, which `StatsPanel` draws under the caption as `footer`.
- `usePagedRows` holds the paging and the virtualizer for it and `RecentPlays`.
- Hidden under an artist or album crumb, with the chart.

## Testing

- Rust: range narrows; undated first play excluded; `plays` ignores the range;
  the list's length is the chart's sum; paging through a tie. Perf budget over
  all time at `seed_plays` size.
- `NewArtistList`: rows, a row pushes an artist crumb, paging, empty.
- `ListeningPanels`: the list sits under the caption; hidden under an album.
- Story `Features/Statistics/NewArtistList`: a list, empty.
