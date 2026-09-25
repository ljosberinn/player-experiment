# 147a — A bar is a stretch of time

Clicking a bar in *Plays over time* or *New artists* drills the Listening tab
into that bucket. [147c](../upcoming/147c-who-was-new.md) stacks on this.

## The crumb

- `StatsCrumb.kind` gains `"period"`, keyed `<YYYY-MM-DD>/<bucket>`: the
  bucket's first local day and its `TimeBucket`.
- `listenQuery`'s range is the intersection of `rangeFor(filters)` and every
  period crumb's span. A week opens on its Monday, so the first week under a
  year starts before it; intersecting keeps the drill equal to the bar. A
  range changed after drilling can leave it empty, which asks for nothing.
- `periodSpan` / `periodLabel` in `series.ts`. Span is local midnight to the
  next bucket's local midnight. Labels: `2023`, `March 2023`,
  `Week of 6 Mar 2023`, `6 Mar 2023` (locale-formatted).
- The breadcrumb prints the label. Under any crumb the tiles' empty state is
  "No plays in this range.", never the import prompt.

## The bar

- `Bar` gains `onSelect?: (index) => void`. Each non-zero bar gets a
  transparent full-height `.chart-bar-hit` rect with `data-drills`; in the
  table reading its row header is a `.chart-table-drill` button. Zero bars stay
  inert.
- `SeriesPanel` passes it only for more than one bar. A year drills to weeks,
  a month or week to days, a day stops.

## Verification

- Storybook Charts/Bar, Drillable: table rows Jul and Sep are buttons, Aug is
  not.
- In app: clicking a bar in Plays over time pushes a crumb named for its
  period, every panel narrows to it, Back walks out.
- A short bar is clickable anywhere in its band's height; hovering still shows
  its readout.
