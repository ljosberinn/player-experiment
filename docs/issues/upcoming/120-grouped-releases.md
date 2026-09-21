# 120 — A release drawn as a group

Section 03's 3f, marked *Selected*. It replaces the **drill-in**, not the cover
grid: opening one release draws that release as a group instead of a flat
`SongTable`. The grid, the breadcrumb and the per-tab scroll memory all stay.

- Group is `168px 1fr`, `16px` gap, `14px 12px` padding, separated by a 2px
  rule.
- Gutter: a 52px cover, then album `800 12.5px/1.25`, year and format each
  `400 11.5px/1.35` muted.
- Table side: rows are `24px 1fr 46px`, `10px` gap, `0 6px` padding, 28px high
  — track number, title, duration.
- Closing row: 1px top border at 45% grey, `opacity: .72`, `600 11.5px`, song
  count left and total duration right.

One group per drill-in means no virtualizer over groups and no per-group page
cache: `queryTracks` with the `browse` filter already returns exactly the rows,
and the count and total are on the `BrowseGroup` the grid was clicked on.

## Open

- **Format has no source.** The gutter wants album / year / format.
  `BrowseGroup` carries neither format nor codec, and `Track` carries only
  `path`, `bitrate` and `sample_rate`. Either `browse_groups` grows a field or
  the line goes.
- **Three columns against ten.** 3f draws number, title and duration. A drill-in
  that drops resize, reorder and hide also strips `ColumnHeader`, `columnFit`
  and the view's stored layout. The sheet leaves this open itself — *"take 3f
  to full width with all seven columns"*. Settle it before building.

If the group ever has to scroll many releases rather than one, its height is
closed-form and must not be measured: `28n + 58`, from `14 + 14` padding,
`(n + 1) × 28` for the rows and the footer, and the 2px rule. The 52px gutter
never wins for n ≥ 1, and `trackCount` is already on `BrowseGroup`, already
narrowed by the same query.

Part of the [component library sweep](../../plans/apex-components.md).
