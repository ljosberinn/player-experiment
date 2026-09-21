# 116c — Leaderboard

Section 4e, two forms:

- Ranked rows with the count as a bar behind the name — 30px high, 3px apart,
  the selection fill spanning the row's share of the largest, name weight 600
  left and count tabular muted right, both at `0 9px`.
- A numbered list under a 2px rule — `24px 1fr auto`, 28px rows, rank in
  `800 10px` accent-deep, name, count tabular muted, 1px separators, hover veil.

`charts/BarList` is the first form, restyled to those numbers.

**The second form is not the show-as-table toggle.** `BarList` is deliberately
outside `ChartFrame` and [frontend.md](../../knowledge/frontend.md#charts) says
why — a ranked list is already the table the toggle offers, and `role="img"`
would cost the focusable rows and the `<ol>`. The numbered list is a second
visual form of an already-accessible list, so it lands as `variant="bars" |
"ranked"` and the panel picks.

**`WorstByBitrate` is the caller that makes the second form real.** It is a bare
table today "because the bar would be a share of 320", which is the numbered
list's case exactly. Without it the variant is drawn only by its own test.

Off main. Independent of [116a](../done/116a-streak.md) and
[116b](116b-heatmap.md).

Part of the [component library sweep](../../plans/apex-components.md).
