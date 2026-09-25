# 147a — A bar is a stretch of time

Clicking a bar in *Plays over time* or *New artists* drills the Listening tab
into that bucket. [147c](147c-who-was-new.md) stacks on this.

## The crumb

- `StatsCrumb.kind` gains `"period"`. Key is `<YYYY-MM-DD>/<bucket>`, the
  bucket's first local day and its `TimeBucket`, so `sameStatsPath` and history
  need nothing new.
- `listenQuery`: the deepest period crumb's span replaces `rangeFor(filters)`,
  the way a genre crumb replaces the genre facet in `libraryQuery`. Span is
  local midnight to the next bucket's local midnight — `series.ts`'
  `bucketStart` / `nextBucket`, not seconds added.
- The breadcrumb prints `crumb.key` verbatim. A period needs a label: `2023`,
  `March 2023`, `Week of 6 Mar 2023`, `6 Mar 2023`.
- Every panel stays under a period crumb.

## The bar

- `Bar` gains `onSelect?: (index: number) => void`. With it, rects take a
  pointer cursor and the table reading's row headers become buttons: the svg is
  presentational under `ChartShell`, so the table is the keyboard path.
- `SeriesPanel` passes it only when the series has more than one bar. The
  bucket follows the span as it does now — a year drills to weeks, a month or
  a week to days, and a day stops.

## Testing

- `listenQuery`: period crumb overrides every range id; deepest of two wins.
- Crumb span across a DST change and a year boundary.
- Crumb labels per bucket.
- `Bar`: row buttons only with `onSelect`; click and table button report the
  same index.
- `SeriesPanel`: click pushes the right crumb; a one-bar series does not drill.
