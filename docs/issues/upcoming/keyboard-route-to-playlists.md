# A keyboard route into playlists

Adding a selection to a playlist is a mouse drag and nothing else. Removing has
Delete; reordering has no route at all.

The context menu's "Add to Playlist ▸" covers adding — it exists and works, so
what is missing is reaching it and reordering without a pointer:

- A shortcut that opens the row menu on the current selection (Windows uses
  Shift+F10 / the Menu key), which gives adding, editing and exporting a keyboard
  route in one move.
- Move-within-a-playlist as a shortcut on the selection, valid only in a
  playlist's own order — the same condition the drop already checks, since a
  derived arrangement has nothing to persist.

Both belong in the existing shortcut layer (`features/player/shortcuts.ts`,
`useSelectionShortcuts`), which already stands down inside text fields, rather
than a bare listener.
