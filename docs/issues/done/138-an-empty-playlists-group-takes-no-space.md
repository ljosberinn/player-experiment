# 138 — An empty Playlists group takes no space

With no static playlists, an expanded Playlists section drew the new-playlist
dropzone anyway: blank, but 42px tall plus padding, border and margins, pushing
the review queue down.

The dropzone is the only pointer route to a first playlist, so it stays mounted.

- `.sidebar-dropzone.collapsed` zeroes min-height, padding, margin and border.
  `PlaylistSidebar` sets it while `statics` is empty and no track drag is in
  progress.
- `trackDrag.ts` gains `onTrackDragStart`, fired once a press becomes a drag.
  `PlaylistSidebar` keeps a `dragging` flag from it and `onTrackDragEnd`, so
  it re-renders twice per drag.
- The expanded zone stays blank with no static playlists; the outline on hover
  marks it.

The Smart Playlists section's "None yet" hint is out of scope.

## Verification

- With no static playlists and Playlists expanded, the heading has nothing
  below it before the next sidebar item.
- Dragging songs out of the table opens a drop target under the heading.
  Dropping on it creates the playlist and starts a rename.
- Escape during the drag collapses the zone again.
- With static playlists present, the zone looks as it does today.
