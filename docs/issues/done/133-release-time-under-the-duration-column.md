# 133 — A release's total sits under the Duration column

The closing row is laid out on `columns`, as `SongRow` is
([SongRow.tsx:233](../../../src/features/library/SongRow.tsx#L233)): a
`STATUS_COLUMN_WIDTH` spacer, the count in one cell spanning the columns before
Duration, then the total at Duration's width with `.song-cell.right`. It follows
reorder, resize and the fit; the 1px rule still runs full width. A deliberate
departure from 3f's closing row, which spreads the two with `space-between`.

- `#` alone before Duration (it is pinned first in a release since 131): too
  narrow for "12 songs", so the count reads `#12`, right-aligned, labelled
  "12 songs".
- Duration first (artist and genre drill-ins): the count trails it.
- Duration hidden: the total goes to the right edge.

The footer cells carry no `data-column`, so the fit does not measure them; the
header label "Duration" is wider than any total.

## Verification

- Default layout: each group's total is right-aligned under the Duration header,
  digits flush with the track durations above it.
- Drag Duration to another position, resize it, double-click its divider: the
  totals follow.
- Release drill-in with Duration right after `#`: the count reads `#12` under
  the track numbers.
- Artist drill-in with Duration first: the count follows it rather than
  overlapping.
- Duration hidden: the total is at the right edge.
- Group height unchanged (`31n + 63`); no scroll jump when groups load.
