# 84c — The shape of a week

The Listening tab's charts, and the primitive that draws one of them. Stacks on
[84a](84a-what-you-have-heard.md), which built the tab's lists and the panel
plumbing under them, and on [84b](84b-what-you-own.md) for `Bar`.

Split from 84a along the primitive seam rather than the tab: `BarList` is HTML
and `Bar` and `Heatmap` are SVG over `scales.ts`, so a split by primitive lands
each one with its callers — [70](70-chart-primitives.md)'s rule one level up.
`Bar` then moved to 84b, which had three callers for it first; this phase adds
two more and keeps `Heatmap`.

Plays over time; new artists per bucket; a weekday-by-hour heatmap with
hour-of-day bars under it. Their three `src/ipc/index.ts` wrappers —
`stats_plays_over_time`, `stats_week_clock`, `stats_firsts` — land here with
them.

`d3-shape` is still not a dependency: nothing draws an arc or an area, and the
donut is [84d](84d-a-genre-is-a-guess.md)'s.

## The bucket follows the span, not the range id

No control picks it. **Custom has no id to derive one from, and all time has no
span until the history is read** — cut into months, a new user's two weeks is
one bar. So the span is the range's own, or under all time the history's
extent, `firstAt`–`lastAt` from `listen_totals`: the tiles already ask for it
through `listenTotalsOnce`, so the chart joins that scan rather than starting
one.

Up to 62 days is days, up to 400 is weeks, up to 25 years is months, and past
that years. The axis is the whole span, empty buckets filled — a sparse series
drawn as it arrives would put a silent month beside a loud one as neighbours.

## Hour-of-day costs no query because it shares the heatmap's panel

`week_clock` returns 168 counts and hour-of-day is its column sums. Two panels
would be two scans of the log for one answer, so it is **one panel and two
figures**, the way release years and decades are one panel. The bars are kept
beside the grid they duplicate because length reads better than colour: the
hour you listen most is easier found off 24 bars than off a 7×24 grid.

## New artists follows the range, and leaves a drill-in

The Rust already has the subtle part: the range narrows the *result*, not the
plays, so "new this year" is not "heard this year". Drilled into an artist or
an album the answer is one artist, once, so the panel goes, as top artists
does.

## `Heatmap`

Rows × columns of cells over a categorical axis on both sides, so
`ChartFrame` draws no gridlines for it: a line through each row's centre shows
through every gap between cells and measures nothing.

**The first sequential magnitude, so the accent ramp lands here**, as
[frontend.md](../../knowledge/frontend.md) deferred it: a few opaque steps up
toward `--accent` in the sheet, and a cell's step quantized from its share of
the largest cell. Steps rather than an opacity per cell: an empty cell must
read as empty beside the smallest non-empty one, and a colour computed in a
chart file is a literal the sheet's guard cannot see.

## The calendar year heatmap is not in it

It needs a control nothing else in the view has — a year selector — and a rule
for how that selector fights the range filter, which set to "last 7 days" would
light one week inside a year's grid. What it adds over plays-over-time at day
resolution is day-of-week alignment. Worth having, not worth blocking the panels
that need no new control. `Heatmap` lands with one caller; the second domain
arrives with the calendar.

## The seeded history has no shape

`seed_plays` spaces plays 613 seconds apart, which is uniform across all 168
hours of a week: the heatmap it photographs is a flat field and the hour bars a
flat line. So a play's time within its week comes from a fixed weighted table —
quiet nights, busy evenings, weekends that differ — as a pure function of its
index, which keeps timestamps distinct and a re-seed continuing where the last
stopped.

## Testing

Geometry, never pixels — `rect` extents against a fixed measured size, with
empty and single-datum inputs. The bucket rule against a table of spans; the
fill asserted across a DST change, since a local day is not 86,400 seconds. The
clock's column sums. New artists asserted gone under an artist crumb.

e2e screenshot of the heatmap panel over the seeded plays.
