# 54 — Fit every column when a view opens

Opening a playlist or drilling into an album shows the library's widths over
different content: a playlist of one artist gives its Artist column 216px for
a word, and Name 336px for titles that stop well short of it.

## Behaviour

Every navigation that lands rows fits each visible column to what is on screen.
Fitted widths are transient — held apart from `ColumnConfig`, recomputed on the
next navigation, never saved — so a width the user dragged survives, and a
playlist that has grown since its last visit is fitted again rather than
keeping the answer from its first.

A stored width wins over a fit. `resizeColumn` persists per view
(`loadColumnConfig(playlistId)`), and a fit painting over it would leave the
stored number with no way to be seen. The fit fills the columns `config.widths`
says nothing about, which is the sparse majority (`columns.ts`).

Fitted widths are not clamped to the pane. `.song-table` is `width: max-content`
inside `.song-body`'s `overflow: auto` (`App.css`), the divider double-click
already overflows it, and a second fit under a different rule would be two fits
with two answers.

## Where it hooks

`applyEntry`, not `refresh`. Every navigation reaches `refresh`, but so does
every sort toggle and every debounced keystroke of a search, and columns that
resize while typing are worse than columns that are too wide. `applyEntry`
raises a pending flag and the fit consumes it.

Not the `crossesPlaylist` branch either: it fires on the way back to the
library and misses the album drill-in, where the mismatch is most visible.

Fit once the first page has landed. Rows that have not arrived render
`<span className="skeleton" />` (`SongTable.tsx`), and measuring those measures
the shimmer. `pages` gaining an entry under the current `queryToken` is the
signal; `total === 0` fits nothing.

## What has to move

- **The measurement.** `contentWidth` and the header-plus-cells collection
  inside `onResizeDoubleClick` (`ColumnHeader.tsx`) are the whole of it, and
  both are trapped in an event handler. Extracted to a module the double-click
  and the fit both call, once per visible column.
- **A batched write.** `resizeColumn` goes through `applyColumns`, which saves
  the config and may re-query. Fitting five columns has to be one `set`, no
  save, no refresh — a width cannot move the sort, so `visibleSort` has nothing
  to say here.
- **Column resolution, out of `App`.** `resolveColumns(columnConfig)` sits at
  `App.tsx:290` and its result feeds `SongTable` alone. Layering the fit on top
  there re-renders `App` per fit; resolving inside `SongTable` instead removes
  the `s.columns` subscription from `App` rather than adding one.

`resetColumns` (the header menu's "Reset Columns") has to drop the fit along
with the config, or it appears to do nothing to the columns that were fitted.

## Tests

`fittedWidth` is covered (`columnDrag.test.ts`); the extracted measurement
needs the cell collection tested against the same `Range` stub
`ColumnHeader.test.tsx` already installs. In `store.test.ts`: a fit does not
reach `saveColumnConfig`, a stored width is not replaced by one, and a
navigation drops the previous view's fit. `SongTable.test.tsx` drives the
virtualizer already — a page landing after a navigation is where the fit fires,
and a sort toggle is where it must not.

An e2e screenshot of a single-artist playlist is the only place the point of
this is visible; the playlist fixtures are in `library.test.ts`.
