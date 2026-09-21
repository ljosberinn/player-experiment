# 116a — Streak

Section 4c. "Charts carry no gridline chrome beyond a single baseline, and the
accent is the only fill."

Two figures over a 2px rule, `44px` apart: Current and Longest, each
`400 11px` muted label over `800 26px/1`, with the record's span as a
`400 11px` muted third line. Under them, the current streak as progress toward
the record: a caption row with the streak left and "Record 198" right, a 10px
track with an accent fill at the ratio, then seven equal bars 22px high with a
3px gap — accent for a day with plays, track colour for one without — and "Last
seven days" muted under it.

**Not new.** `StreakTiles` has drawn this panel since 84a, and 115 moved it onto
`StatTiles`; 116a is the redraw 115 deferred. `.stats-panel .stat-tiles`'s
two-column override in `app.css` existed only for it and goes with it.

**The seven bars need a field the backend does not have.** `Streaks` is
`current`, `longest`, `longest_from`, `longest_to`. `stats::streaks` already
walks the distinct local days and already takes `now`, so `last_seven: [bool; 7]`
fills in that walk — a fixed array rather than a `Vec` so `Streaks::default()`
stays the answer an empty history gives. `stats_plays_over_time` at day width
would be a second scan, cut by `bucketFor`'s span rule and needing `fillSeries`
to put the empty days back.

**The bars run chronologically, newest right** — the sheet's mock fills the
leftmost four for a four-day current streak, which reads against 4d's hour axis
directly below it. Mock data, not a drawing.

The caption row keeps its left half, `Current streak · 4 days`, although the
figure above it says the same thing. The sheet draws it.

Part of the [component library sweep](../../plans/apex-components.md).
