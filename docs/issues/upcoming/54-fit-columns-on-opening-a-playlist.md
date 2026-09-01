# 54 — Fit every column when a playlist opens

Opening a playlist should size its columns to what is in them, instead of
showing the library's widths over different content - a playlist of one artist
gives its Artist column 216px for a word.

The measurement exists: `ColumnHeader`'s divider double-click measures a
column's header and cells with a `Range` and hands the result to
`fittedWidth` (`columnDrag.ts`). Doing it for every visible column after
`applyEntry`'s `crossesPlaylist` branch has run `loadColumns` and `refresh` is
the same call in a loop - the table is virtualized, so it measures the rows on
screen, which is what "to the extent visible" means here anyway.

Two things to decide before writing it:

- **What it does to a width the user set.** `resizeColumn` persists per
  playlist (`loadColumnConfig(playlistId)`). Fitting on every visit overwrites
  a deliberate width every time; fitting only where nothing is stored means it
  happens once and never again. A transient fit that is not written back is the
  third option and the only one that keeps both.
- **Whether the fitted widths are allowed to overflow the window.** Fitting
  Location to a full path makes the table scroll sideways.

Rows that have not arrived render a skeleton; measuring those is measuring the
shimmer. Fit after the first page lands, not on navigation.
