# 96b — What the charts cannot place

Stacks on [96a](96a-a-play-without-a-time.md), which stops the undated plays
from being drawn as 1970 and adds `ListenTotals.dated`.

Once they are excluded, Plays over time sums to less than the Plays tile and
nothing says why. Time spent already has this shape — `timed` under it reads
"68% of plays timed" — so the answer is the same one: the panel names its
coverage rather than reporting a subset as the whole.

A caption on Plays over time, New artists and When you listen, shown only
where `dated < plays`, saying what share of the plays could be placed in time.

## `Bar` and `Heatmap` have no caption

`BarList` does, and the genre panel uses it. The primitive seam
([70](../done/70-chart-primitives.md)) puts it on `ChartFrame` rather than a
third copy in each SVG chart — both already draw through it, and both need it
here.

## Testing

The caption asserted present when `dated < plays` and absent when equal, over
each of the three panels. `ChartFrame`'s own caption asserted where its other
chrome is.
