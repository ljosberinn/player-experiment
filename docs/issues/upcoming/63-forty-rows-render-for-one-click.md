# 63 — Forty rows render for one click

`SongTable` subscribes to `selection` and builds its rows as inline JSX
(`SongTable.tsx`), so every click re-creates all forty virtualized `<tr>` and
their cells to change the class on one - or two, when a click moves the
selection off another row. [60](../done/60-a-row-click-re-renders-the-table.md)
could not fix this and did not try: it stopped `App` and its fifteen
uninterested children from waking, and left the table's own single render in
place.

Nothing yet says this costs anything. Forty rows of eight cells is a cheap diff,
and the row body is where the drag handling, the context-menu decision, the
keyboard route and the drop indicator all live - extracting it is a real change
to the most interaction-dense component in the app.

To decide:

- **Whether it is worth measuring at all.** A profile of a click on a full
  library, or a shift-range across a page, before any extraction.
- **What a `Row` would take.** Memoizing on `selected` and `playing` booleans
  means the selection subscription moves out of the table body and into the
  rows, which is forty subscriptions instead of one - the trade the memo buys.
- **Where the shared handlers go.** `clickRow`, `onActivate`, the drag and drop
  callbacks and `dropIndex` are per-table, so they have to arrive as stable
  props or the memo misses on every one of them.
