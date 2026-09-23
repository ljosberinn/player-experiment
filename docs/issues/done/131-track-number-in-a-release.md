# 131 — A release drill-in always shows # first

`#` is a default column since 130. Inside a release drill-in
(`browse.kind === "albums"`) it is also pinned: the row reads status, `#`, then
the configured columns, even when the layout hid `#` or moved it.

Every release drill-in, library included: a smart playlist's tiles open one
inside the playlist, and `showTrackGroup` from a playlist row lands in the
library's (`entryForTrack`). Artist and genre drill-ins are out of scope.

Display-only: the stored `ColumnConfig` is not rewritten. `displayedColumns`
in [columns.ts](../../../src/features/library/columns.ts) feeds:

- `resolveColumns` and the fit on navigation in
  [useSongTableWiring.ts](../../../src/features/library/useSongTableWiring.ts).
- `visibleSort` in `loadColumns`, `applyColumns` and `resetAllColumns`, so
  `trackNo` survives inside the drill-in, and in `sortForEntry` for a sort
  kept through a search, so a `#` clicked inside the release does not follow
  into a view that hides it.
- `ColumnHeader`: `#` is checked and disabled in the menu, cannot be dragged,
  and is left out of `headerBounds`. A drop index counted among the draggable
  headers goes through `storedDropIndex`, which maps it by neighbour, since the
  stored order may hold `#` anywhere. It can still be resized; the width goes
  into the sparse `widths`.

## Stacking

132 stacks on this: its third bullet is done here.

## Verification

- Library layout with `#` hidden: a release drill-in shows status, `#`, Title, …
- Layout with `#` last: the drill-in shows it first; the Songs view still
  shows it last.
- Column menu in a drill-in: `#` checked and disabled. Dragging another header
  drops it where the pointer is.
- Smart playlist → tile → release: `#` first, sorted by it. Back and forward
  across the playlist boundary keep it.
- Search, open a release, click `#`, switch to Songs with `#` hidden: sorted by
  the first column.
- Artist drill-in unchanged.
