# 84a — What you have heard

The Listening tab's panels. Stacks on [78](78-import-the-lastfm-history.md) and
[80](80-the-statistics-view.md); independent of
[84b](84b-what-you-own.md), which is the other tab and shares only the chart
primitives.

Split off from the plan's single phase 84 for that independence, and because one
phase drawing both tabs is not workable as written.

Tiles: plays, distinct artists / albums / tracks, listening days, time spent,
share owned. Then recent plays; top artists, albums, tracks and genres as bar
lists with share; plays over time, bucket chosen from the range; hour-of-day
bars; a weekday-by-hour heatmap; a calendar year heatmap; new artists per month;
current and longest streak; and **heard, never owned**, exportable.

An artist bar drills to that artist's page — first heard, total plays, top
tracks, plays over time, albums.

**Which of those earn their place is answered by using them, not by this file.**
Expect the list to lose entries. Every one of them is a `ListenQuery` and a
primitive that both already exist, so dropping one costs nothing and keeping a
bad one costs a panel nobody reads.

- **Heard, never owned is the point of the residue, not a leftover.** It is a
  shopping list, and it is why plays with no matching file are kept rather than
  discarded at import.
- **A genre panel says what it covers** — "genre known for 84% of plays", from
  `coverage` — because genre is only knowable for matched plays and reporting a
  subset as the whole is the failure mode.
- Every panel subscribes to `statsStore` itself. `App` must not re-render
  because a range changed.

Testing: panels get `role="img"` with a generated summary label and a
show-as-table toggle where the numbers matter more than the shape, both from
`ChartFrame`. Geometry assertions only, never pixels. e2e screenshots for the
tab and for the weekday heatmap.
