# 17 — Context menus, and dropping onto nothing

Merged in `8caf601`.

Right-click menus for songs, playlists and (later) column headers, plus dragging
a selection onto empty sidebar space to create a playlist from it. The stopgap
buttons added in the fifth build were removed here.

- The menu is positioned in **fixed** coordinates — an absolutely-positioned menu
  inside the scrolling table travels with the rows it describes — and nudged back
  inside the viewport after *measuring*, since the playlist submenu makes its size
  depend on the library.
- `rowMenuItems()` is pure and returns a `MenuItem[]`, knowing nothing about how
  the menu opens. That is what let phase 24 swap the whole implementation and
  phase 34 reuse it for the Edit menu.
- The submenu opened at the panel top until its row got `position: relative` —
  the wrapper had no positioning context, so `absolute` resolved against the
  `fixed` panel.

Replaced by Base UI's `ContextMenu` in phase 24.
