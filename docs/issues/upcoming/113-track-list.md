# 113 — Track list

Section 03. Two things: the row treatment everywhere, and 3f, which is a layout
the app does not have.

**The row.** Height 32px, `400 12.5px/1`, `white-space: nowrap`, text columns
truncate with an ellipsis and never wrap, numeric columns are tabular and right
aligned. A 1px separator under each row. Hover is the veil. The playing row is
the selection fill **plus `box-shadow: inset 3px 0 0` accent** and a 10px accent
play triangle in the 14px leading column; its title is weight 600 and its album
and duration come up to full ink from muted.

**3f, grouped by release with an art gutter.** Marked *Selected*.

- Group is `168px 1fr`, `16px` gap, `14px 12px` padding, separated by a 2px
  rule.
- Gutter: a 52px cover, then album `800 12.5px/1.25`, year and format each
  `400 11.5px/1.35` muted.
- Table side: rows are `24px 1fr 46px`, `10px` gap, `0 6px` padding, **28px**
  high — track number, title, duration.
- Closing row per group: 1px top border at 45% grey, `opacity: .72`,
  `600 11.5px`, song count left and total duration right. The count and total
  are in this footer, not in the gutter.

This is the Releases view, and the sheet's version is a CSS grid over 22 songs
in memory. Ours is virtualized over 150k rows with resizable, reorderable,
hideable columns and counts from `COUNT(*)` — the look transfers, the markup
does not, and the variable group height is a real question for the virtualizer.
Measure a group rather than estimating it, the way `SongTable` already measures
a row.

The flat Songs view keeps its columns and takes only the row treatment.

Part of the [component library sweep](../../plans/apex-components.md).
