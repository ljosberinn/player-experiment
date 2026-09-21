# 116b — Heatmap

Section 4d. Hour × weekday, 7 rows of 24. Row is `22px 1fr` with a `6px` gap;
the day label is `400 9.5px` muted; cells are 13px high with a `2px` gap,
`repeat(24, minmax(0,1fr))`. An hour axis under the grid, `00 06 12 18 23`,
spread with `space-between`.

**The ramp grows to eight steps, derived per ground.** `--chart-ramp-0`…`-7` as
`color-mix(in oklab, var(--accent) N%, var(--surface))` — the sheet's "one
accent at eight opacity steps" without compositing, so a cell's colour stays a
token and `e2e/contrast.ts` measures a value rather than a stack. One formula
per ground replaces sixteen hand-tuned `oklch` values. `RAMP_STEPS` goes 4 → 7,
which regrades `Donut` too: `rampStep` is shared, and two copies of it is where
a heatmap and a donut stop agreeing about how dark the quietest thing on screen
is. State the choice in [frontend.md](../../knowledge/frontend.md#charts).

**Open: the sheet's heatmap is intrinsically sized and the app's is not.** Seven
13px rows is ~117px; `.chart` is a fixed 180px box that `ChartFrame` measures,
which today gives ~21.7px cells. Honouring the sheet means an HTML grid, and
`ChartFrame` owns the `role="img"` label and the show-as-table toggle that 168
cells cannot ship without. Either `ChartFrame` gains a mode that keeps the
toggle, the empty and the loading states without measuring or drawing an svg —
which `BarList` could then fold back into — or `Heatmap` owns its own toggle,
and the app has two toggle mechanisms. Decide before starting.

Off main. Independent of [116a](../done/116a-streak.md) and
[116c](116c-leaderboard.md); the ramp is the only shared surface and neither of
those touches it.

Part of the [component library sweep](../../plans/apex-components.md).
