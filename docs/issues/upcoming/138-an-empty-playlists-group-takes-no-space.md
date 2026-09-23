# 138 — An empty Playlists group takes no space

With no static playlists, an expanded Playlists section still draws the
new-playlist dropzone. It has no text but still takes about 69px: a 38px
`min-height`, 7px padding, a 1px border and `5px 10px 10px` margins
([app.css:2228-2235](../../../src/styles/app.css#L2228-L2235)). That space
pushes the review queue down
([PlaylistSidebar.tsx:264-286](../../../src/features/playlists/PlaylistSidebar.tsx#L264-L286)).

The dropzone is the only pointer route to a first playlist, which
`row-drag.test.ts` uses. It has to stay reachable.

- The dropzone stays mounted but has zero size (no min-height, padding or
  margin) while `statics` is empty and nothing is being dragged. Once a track
  drag starts, it expands to its normal size. Keeping it mounted leaves the
  existence checks in
  [sidebar.test.ts:86-90](../../../e2e/specs/sidebar.test.ts#L86-L90) as they
  are.
- `trackDrag.ts` has `onTrackDragEnd`, but no start event
  ([trackDrag.ts:67-70](../../../src/features/playlists/trackDrag.ts#L67-L70)).
  Add `onTrackDragStart` and fire it where the session begins
  ([:207](../../../src/features/playlists/trackDrag.ts#L207)). Keep the
  `dragging` flag in `PlaylistSidebar` state. It re-renders only this
  component, twice per drag.
- The expanded zone pushes the review queue down mid-drag. That is acceptable,
  because the zone is above the queue.
- **Decide:** when the list is empty, should the expanded zone show "Drop songs
  here for a new playlist"? It shows nothing today
  ([:285](../../../src/features/playlists/PlaylistSidebar.tsx#L285)).
  Recommended: yes, because on its own the dashed outline only appears once
  the pointer is over the zone.

The Smart Playlists section's "None yet" hint is out of scope.

`row-drag.test.ts` measures the zone after the drag starts
([row-drag.test.ts:158](../../../e2e/specs/row-drag.test.ts#L158)), so it keeps
working on a fresh library. Add a `PlaylistSidebar.test.tsx` case with no
static playlists: the zone is collapsed, a drag expands it, and a drop still
creates a playlist.

## Verification

- With no static playlists and Playlists expanded, the heading has nothing
  below it before the next sidebar item.
- Dragging songs out of the table opens a drop target under the heading.
  Dropping on it creates the playlist and starts a rename.
- Escape during the drag collapses the zone again.
- With static playlists present, the zone looks as it does today.
