# 133 — A release's total sits under the Duration column

The closing row prints the song count and the total with
`justify-content: space-between`
([ReleaseGroups.tsx:221](../../../src/features/library/ReleaseGroups.tsx#L221),
[app.css:1005](../../../src/styles/app.css#L1005)), so the total lands at the
table's right edge — the pane's, since the table is at least pane-wide. A
deliberate departure from 3f's closing row.

Lay the footer out as a row: a `STATUS_COLUMN_WIDTH` spacer, then one cell per
entry in `columns` at its width, as `SongRow` does
([SongRow.tsx:233](../../../src/features/library/SongRow.tsx#L233)). The total
goes in the `durationMs` cell with `.song-cell.right`. Being the same `columns`,
it follows reorder, resize and the fit, and the 1px rule still runs full width.
The count stays leading: in the cells before Duration, or after it when
Duration is first.

Duration hidden: the total goes back to the right edge. Stacks on 131, whose
pinned `#` the footer then includes.

## Verification

- Default layout: each group's total is right-aligned under the Duration header,
  digits flush with the track durations above it.
- Drag Duration to another position, resize it, double-click its divider: the
  totals follow.
- Duration first: the count follows it rather than overlapping.
- Duration hidden: the total is at the right edge.
- Group height unchanged (`28n + 58`); no scroll jump when groups load.
