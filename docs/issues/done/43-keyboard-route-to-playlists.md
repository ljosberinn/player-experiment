# 43 — A keyboard route into playlists

Adding a selection to a playlist was a mouse drag and nothing else. Removing had
Delete; reordering had no route at all. Both gaps are closed by two shortcuts on
the songs table, bound at the window rather than on a row — Ctrl+A and a click in
the sidebar both leave focus off the table, and the selection they leave behind
is exactly what these act on.

**The Menu key and Shift+F10 open the row menu** on the selection, which gives
adding, editing, exporting and the web lookups a keyboard route in one move.
Shift+F10 exists because not every keyboard has a Menu key.

**Alt+Up / Alt+Down nudge the selection** one place within a playlist, valid
only where `onReorder` is — a static playlist in its own order, the same
condition the drop already checks, since a derived arrangement has nothing to
persist.

## Decisions

**The menu shortcut synthesizes a `contextmenu` event** on the anchor row rather
than opening the menu itself. `ContextMenu.Trigger` derives its position from
that event, and the row's own handler settles which rows the menu applies to; a
second way in would have to duplicate both, and the duplicate is what drifts.
The row is scrolled into view and focused first, so closing the menu returns the
keyboard to the row rather than to the body.

**Alt, not a bare arrow.** Bare arrows are the player's seek and volume keys and
`shortcutFor` returns null for anything pressed with a modifier, so an Alt chord
cannot collide with them by construction.

**Down is `last + 2`, not `last + 1`.** The insertion index is expressed against
the list *including* the rows being moved, and the backend takes them out before
resolving it — `last + 1` resolves back to where the block already sits, and the
row appears not to move at all.

**A scattered selection is refused rather than moved.** The backend collapses a
multi-selection into one block wherever it lands, which is right for a drag: the
drop indicator shows exactly where it is going before the mouse comes up. A
nudge shows nothing beforehand, so the same rule would silently gather rows from
across a playlist into a pile — and a reorder has no undo.

**Row indices come from the page cache, all or nothing.** `rowIndicesOf` returns
null when any selected id is not in a cached page, so an id it cannot place stops
the move rather than shrinking it. `Select All` over a large playlist is that
case, and it is also a move with no meaning.

## Tests

- `reorder.test.ts` — the nudge arithmetic in both directions, blocks, the two
  edges, and the scattered refusal.
- `pageCache.test.ts` — `rowIndicesOf`, including the uncached id.
- `SongTable.test.tsx` — nine cases over both shortcuts. Proven red by disabling
  the listener: five of the nine fail, the other four assert an absence.
- `e2e/specs/row-menu.test.ts` — Shift+F10 opens the menu in real WebView2. The
  one part jsdom cannot vouch for is whether Base UI opens on a *synthesized*
  `contextmenu`; the component test proves the shortcut fires, not that the
  menu hears it.
