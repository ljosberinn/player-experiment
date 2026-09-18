# 84c — The shape of a week

The Listening tab's charts, and the two primitives that draw them. Stacks on
[84a](../done/84a-what-you-have-heard.md), which built the tab's lists and the panel
plumbing under them.

Split from 84a along the primitive seam rather than the tab: `BarList` is HTML
and `Bar` and `Heatmap` are SVG over `scales.ts`, so a split by primitive lands
each one with its callers — [70](../done/70-chart-primitives.md)'s rule one
level up — and a split by tab-half would have put three `Bar` callers on one
side of it and one on the other.

Plays over time, bucket chosen from the range; new artists per bucket;
hour-of-day bars; a weekday-by-hour heatmap. Their three `src/ipc/index.ts`
wrappers — `stats_plays_over_time`, `stats_week_clock`, `stats_firsts` — land
here with them.

`scales.ts` gets its first real caller here. `d3-shape` is still not a
dependency: nothing draws an arc or an area, and the donut is 84b's.

- **Hour-of-day costs no query.** `week_clock` returns 168 counts and
  hour-of-day is its column sums, done in the panel. It is kept beside the
  heatmap it duplicates because length reads better than colour: finding the
  hour you listen most off a 7×24 grid is worse than off 24 bars.
- **New artists per bucket follows the range**, not a fixed month. The Rust
  already has the subtle part: the range narrows the *result*, not the plays, so
  each artist's first play is found over all time and "new this year" is not
  "heard this year".
- **The bucket is derived from the range**, not chosen by a control. All time is
  months.
- Every panel subscribes to `statsStore` itself, and uses 84a's
  `usePanelQuery`.

## The calendar year heatmap is not in it

It is the one entry on 84a's original list needing a control nothing else in the
view has — a year selector — and a rule for how that selector fights the range
filter, which set to "last 7 days" would light one week inside a year's grid.
What it adds over plays-over-time at day resolution is day-of-week alignment.
Worth having, not worth blocking the panels that need no new control.

`Heatmap` therefore lands with one caller rather than the two 70 imagined. That
is the rule, not an exception to it: the second domain arrives with the
calendar.

Testing: geometry, never pixels — `rect` extents and `path` commands against a
fixed measured size, with empty and single-datum inputs where the scale domains
collapse. e2e screenshot for the weekday heatmap, over the plays
`seed_synthetic_plays` seeds.
