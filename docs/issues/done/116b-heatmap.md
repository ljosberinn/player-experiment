# 116b — Heatmap

Section 4d. Hour × weekday, 7 rows of 24. Row is `22px 1fr` with a `6px` gap;
the day label is `400 9.5px` muted; cells are 13px high with a `2px` gap,
`repeat(24, minmax(0,1fr))`. An hour axis under the grid, `00 06 12 18 23`,
spread with `space-between`. The five labels come from the columns the panel
passed, at 0, 6, 12, 18 and the last, so the axis and the table agree.

**The ramp grows to eight steps, derived per ground.** `--chart-ramp-0`…`-7` as
`color-mix(in oklab, var(--accent) N%, var(--surface))` at 12.5% a step — the
sheet's "one accent at eight opacity steps" without compositing, so a cell's
colour stays a token and `e2e/contrast.ts` measures a value rather than a
stack. One formula replaces sixteen hand-tuned `oklch` values. `RAMP_STEPS`
goes 4 → 7, which regrades `Donut` too: `rampStep` is shared, and two copies of
it is where a heatmap and a donut stop agreeing about how dark the quietest
thing on screen is.

The empty step is 12.5% rather than nothing, since a cell the colour of the
ground takes the grid away wherever the week was quiet. `--accent` on light is
the darkened text accent rather than the sheet's raw `#e8730f`, so the light
ramp runs a shade deeper than 4d draws it — the price of the ramp tracking the
accent instead of holding a second copy of it.

**Settled: `ChartFrame` splits.** Seven 13px rows is ~117px and `.chart` is a
fixed 180px box that `ChartFrame` measures, so honouring the sheet means an
HTML grid — and `ChartFrame` owns the `role="img"` label and the show-as-table
toggle that 168 cells cannot ship without. `ChartShell` is those, plus the
empty and loading states; `ChartFrame` is that shell plus the svg, the margins
and the axes. `Heatmap` uses the shell directly with `intrinsic`. The label
moves onto the measured box so a grid of `<div>`s gets it on an svg's terms.
`BarList` could fold in later and does not here.

The skeleton is the grid drawn empty rather than the shell's block: nothing
measures this chart, so the only thing that holds its height is the grid.

`Heatmap` stays in `charts/` — `rampStep` and the shell are chart
infrastructure — but its drawing moved to `library.css`, and the guard that
keeps 4a and 4c out of `app.css` covers it now.

Part of the [component library sweep](../../plans/apex-components.md).
