# 131 — A release drill-in always shows # first

`#` is a default column since 130. Inside a release drill-in
(`browse.kind === "albums"`) it is also pinned: the row reads status, `#`, then
the configured columns, even when the layout hid `#` or moved it.

Every release drill-in, library included: a smart playlist's tiles open one
inside the playlist, but `showTrackGroup` from a playlist row lands in the
library's ([store.ts:1052](../../../src/features/library/store.ts#L1052)).
Narrowing to playlists is one `playlistId !== null`. Artist and genre drill-ins
are out of scope.

Display-only: the stored `ColumnConfig` is not rewritten. One derivation in
[columns.ts](../../../src/features/library/columns.ts) — the displayed ids for
a config and a browse — feeds:

- `resolveColumns` in the wiring
  ([useSongTableWiring.ts:58](../../../src/features/library/useSongTableWiring.ts#L58))
  and the fit on navigation, which measures `columnConfig.ids`
  ([:134](../../../src/features/library/useSongTableWiring.ts#L134)).
- `visibleSort` in `loadColumns` and `applyColumns`
  ([store.ts:685](../../../src/features/library/store.ts#L685),
  [:699](../../../src/features/library/store.ts#L699)), so `trackNo` survives
  inside the drill-in.
- `ColumnHeader`
  ([ColumnHeader.tsx](../../../src/features/library/ColumnHeader.tsx)): `#` is
  checked and disabled in the menu, cannot be dragged, and is left out of
  `headerBounds`, or every drop index shifts by one before `moveColumn`
  receives it. It can still be resized; the width goes into the sparse
  `widths`, which works for an id missing from `ids`.

## Stacking

Stacks on 130. 132 stacks on this: its third bullet is done here.

## Verification

- Library layout with `#` hidden: a release drill-in shows status, `#`, Title, …
- Layout with `#` last: the drill-in shows it first; the Songs view still
  shows it last.
- Column menu in a drill-in: `#` checked and disabled. Dragging another header
  drops it where the pointer is.
- Smart playlist → tile → release: `#` first, sorted by it. Back and forward
  across the playlist boundary keep it.
- Artist drill-in unchanged.
