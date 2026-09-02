# 54 — Fit every column when a view opens

Opening a playlist or drilling into an album showed the library's widths over
different content: a playlist of one artist gave its Artist column 216px for a
word, and Name 336px for titles that stopped well short of it.

## Transient widths, held apart from the config

`fittedWidths` is its own field, never serialized and never handed to
`saveColumnConfig`. A stored width wins over a fit — `resizeColumn` persists per
view, and a fit painting over it would leave the stored number with no way to be
seen — so `resolveColumns(config, fitted)` reads `config.widths[id] ?? fitted[id]`
and the fit fills the sparse majority the config says nothing about.

Recomputed rather than cached, so a playlist that has grown since its last visit
is fitted again instead of keeping the answer from its first. Not clamped to the
pane either: `.song-table` is `width: max-content` inside an `overflow: auto`
body, the divider double-click already overflows it, and a second fit under a
different rule would be two fits with two answers.

## Where it hooks

`applyEntry` raises `fitPending`, not `refresh` — every navigation reaches
`refresh`, but so does every sort toggle and every debounced keystroke, and
columns that resize while typing are worse than columns that are too wide. Not
the `crossesPlaylist` branch either: that fires on the way back to the library
and misses the album drill-in, where the mismatch is most visible.

The fit consumes the flag in `SongTable` once `pages` has an entry. Rows that
have not arrived render a skeleton bar, and measuring those measures the
shimmer. A view that lands nothing measures nothing and leaves the request
outstanding.

`resetColumns` drops the fit with the config, or it appears to do nothing at all
to the columns that were fitted.

## What moved

- **`columnFit.ts`** — `contentWidth` and the header-plus-cells collection were
  trapped in `ColumnHeader`'s double-click handler. Both callers now measure
  through `measuredWidth` / `measureColumns`. A column with nothing rendered is
  left out rather than given the minimum: a width invented from a measurement of
  nothing would be applied the moment it was switched on.
- **One `set` for the whole fit.** `resizeColumn` goes through `applyColumns`,
  which saves and may re-query; five columns would have been five writes of a
  config that must not be written at all. A width cannot move the sort, so
  `visibleSort` has nothing to say here.
- **`resolveColumns` out of `App`.** Its result fed `SongTable` alone, so
  resolving there removes the `s.columns` subscription from the shell rather
  than adding one, and drops the `columns` prop.
