# 115 — Stat tiles and the filter bar

Sections 4a and 4b. "Figures are the loudest thing on the page; labels stay
small and flush left above them."

**`StatRow`** — four figures on a shared baseline, no boxes. A 2px rule across
the top, `12px` to the row, columns `repeat(4, minmax(0,1fr))` `18px` apart.
Label `400 11px` muted, 6px, then `800 28px/1`, `-.02em`, tabular. A unit riding
on a figure is `800 16px` muted ("1,5 **yrs**").

**`StatTile`** — bordered cells, `repeat(3, …)` with a 2px gap over a border
colour so the gap reads as a rule. `12px` padding. Eyebrow `800 9.5px`, `.11em`,
muted, 8px; figure `800 24px/1` tabular; caption `400 11px/1.3` muted at 5px. A
delta takes accent-deep / accent instead of muted ("+18% on last month").

`charts/StatTile` is the closest thing today and becomes one of these two — keep
the `<dl>`, because a row of six tiles is otherwise twelve unrelated
announcements.

**`FilterBar`** — labelled selects on one rule: label `400 11px` muted, 5px,
then the select at `6px 9px`, the set `14px` apart on a 2px bottom rule with
`16px` of padding under it.

**`FilterToken`** — the same filters read back as a sentence. Muted "Showing",
then tokens at `5px 8px` on the selection fill in accent-deep / a light accent,
weight 600, each with a 10px × at stroke 2.5. The set closes with a dashed
`1px` "+ add filter" in muted.

Both forms are in the sheet and both are wanted: the selects are how a filter is
set, the tokens are how the current filter is read and cleared. `.stats-filter`
becomes the first, the token line is new.

Part of the [component library sweep](../../plans/apex-components.md).
