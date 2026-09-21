# 116 — Streaks, heatmap, leaderboard

Sections 4c, 4d and 4e. "Charts carry no gridline chrome beyond a single
baseline, and the accent is the only fill."

**`Streak`** — two figures over a 2px rule, `44px` apart: Current and Longest,
each `400 11px` muted label over `800 26px/1`, with the record's span as a
`400 11px` muted third line. Under them, the current streak as progress toward
the record: a caption row with the streak left and "Record 198" right, a 10px
track with an accent fill at the ratio, then seven equal bars 22px high with a
3px gap — accent for a day with plays, track colour for one without — and "Last
seven days" muted under it. New; the app has no streak panel.

**`Heatmap`** — hour × weekday, 7 rows of 24. Row is `22px 1fr` with a `6px`
gap; the day label is `400 9.5px` muted; cells are 13px high with a `2px` gap,
`repeat(24, minmax(0,1fr))`. **One accent at eight opacity steps**, from
`accent / 0.08` to `accent / 0.93`. An hour axis under the grid, `00 06 12 18
23`, spread with `space-between`.

`charts/Heatmap` exists and draws from `--chart-ramp-0`…`-4`, five opaque steps.
The sheet asks for eight translucent ones. Translucent over two grounds is what
the opaque ramp was chosen to avoid, so either the ramp grows to eight opaque
steps per theme or the sheet wins and the cells composite — pick one, state the
reason in `frontend.md`, and let `e2e/contrast.ts` measure the result.

**`Leaderboard`**, two forms, both in the sheet:

- Ranked rows with the count as a bar behind the name — 30px high, 3px apart,
  the selection fill spanning the row's share of the largest, name weight 600
  left and count tabular muted right, both at `0 9px`.
- A numbered list under a 2px rule — `24px 1fr auto`, 28px rows, rank in
  `800 10px` accent-deep, name, count tabular muted, 1px separators, hover veil.

`charts/BarList` is the first form. The second is the same data without the
chart, and the pair is the show-as-table toggle `ChartFrame` already owns.

Part of the [component library sweep](../../plans/apex-components.md).
