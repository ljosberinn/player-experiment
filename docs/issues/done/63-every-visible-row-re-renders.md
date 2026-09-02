# 63 — Every visible row re-renders for a click or a scroll

`SongTable` builds its rows as inline JSX, so any render of the table body
re-creates every visible `<tr>`, its cells and its eight handler closures.
[60](../done/60-a-row-click-re-renders-the-table.md) stopped `App` and its
fifteen uninterested children from waking and left this in place;
[65](../done/65-react-compiler.md) cannot reach it, because the `"use no memo"`
the virtualizer forces on this component means none of that JSX is cached.

Measured on the real table under jsdom, counting `ColumnDef.render` calls, with
a 900px body (47 rows in the window, five columns, so 282 cells with the status
cell):

| action                          | cell renders |
| ------------------------------- | ------------ |
| one click                       | 235          |
| shift-range                     | 235          |
| scroll 160px (six rows crossed) | 3265         |

The click is the small half. A scroll re-renders the whole body roughly twice
per row crossed, so a flick down a page costs hundreds of full body renders,
and that is the 60fps path.

## A row is its own component

`SongRow` in its own file, holding no virtualizer, so the compiler compiles it
and caches its JSX per props. No `memo` call - the repo has none since
[65](../done/65-react-compiler.md), and does not need one here: a row whose
props are `Object.is`-equal returns cached JSX and React bails out on the cells
beneath.

That puts the whole weight on prop stability, which means props are per-row
facts and never table state:

- `track` - identity is already stable, `rowAt` returns the element of the
  cached page.
- `rowIndex`, `selected`, `playing` - booleans, not `nowPlayingId`.
- `drop: "before" | "after" | null` - derived per row by the table, not
  `dropIndex`. Passed raw, a dragover would invalidate all 47 rows instead of
  the one under the pointer.
- `columns` - stable already: `resolveColumns` runs in compiled `App` and is
  cached on `columnConfig`.
- one `actions` object holding `onActivate`, `onReorder`, `onRemove`,
  `onContextMenu` and `setDropIndex`, built with a hand-written `useMemo` -
  `SongTable` is not compiled and gets no help.

The handlers move into the row with it. Where they read the selection -
right-click outside it, drag outside it, Delete - they read
`useLibraryStore.getState()`, as the window keydown effect in the same file
already does, so a row subscribes to nothing.

Forty-odd subscriptions are not the trade. The table keeps its single
`selection` subscription and spends it computing one boolean per row; its own
body render then costs 47 element creations and nothing below them.

The virtualizer, the `ContextMenu` on `<tbody>`, the `menu` state, the window
keydown effect and `ensureRange` all stay in the table.

## Tests

The numbers above come from a `columns` array whose `render` increments a
counter; that is the measurement to keep, in a `SongTable.renders.test.tsx`
beside `App.renders.test.tsx` and for the same reason - a count is exact where a
wall-clock budget is noise. A click should touch two rows' worth of cells (the
row gaining the selection and the one losing it), and a sub-row scroll none.

`SongTable.test.tsx` asserts on the DOM throughout and should pass across the
extraction unchanged. If it does not, the split changed behaviour.

`frontend.md`'s subscription-lever section says `memo(SongTable)` was declined
because the table subscribes to the selection itself. That stays true and is
what this issue does instead - the paragraph needs the second half.
