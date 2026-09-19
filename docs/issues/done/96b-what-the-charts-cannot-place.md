# 96b — What the charts cannot place

Stacks on [96a](96a-a-play-without-a-time.md), which stops the undated plays
from being drawn as 1970 and adds `ListenTotals.dated`.

Once they are excluded, Plays over time sums to less than the Plays tile and
nothing says why. Time spent already has this shape — `timed` under it reads
"68% of plays timed" — so the answer is the same one: the panel names its
coverage rather than reporting a subset as the whole.

A caption on Plays over time, New artists and When you listen, shown only
where `dated < plays`, saying what share could be placed in time. Shown over an
empty chart too: with every play undated the chart says "Nothing in this
range." under a Plays tile that is not zero.

New artists leaves out artists, not plays — those first heard undated — so a
play share misstates it. Its share is the series' sum over `artists`: wherever
`dated < plays` the range reaches back before any dated play, so every artist
missing from the series was first heard undated. No new field.

## The caption is the panel's

On `StatsPanel`, not `ChartFrame`. When you listen draws two charts over one
coverage, and drops the hour bars once the clock is empty — a caption on
either chart would be drawn twice or not at all. `BarList`'s stays where it is.

## Testing

The caption asserted present when `dated < plays` and absent when equal, over
each of the three panels, and present over an empty chart.
