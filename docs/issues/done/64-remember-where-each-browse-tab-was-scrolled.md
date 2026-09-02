# 64 — Remember where each browse tab was scrolled

Scroll Albums, click Artists: the list opens at the offset the grid was left
at. `<BrowseView kind={tab} />` has no `key` (`App.tsx`), so the three tabs are
one component instance and one scroll container — `song-body` and `song-body
browse-body` are both a `div` in the same slot, so React reuses the element
even across the empty-state frame in between and only drops the attributes —
and `scrollTop` rides along with it.

The reflow correction makes it worse. `BrowseView`'s column effect exists for a
window resize, where the row height is unchanged and only the column count
moves; a kind change trips the same condition, because the grid has four
columns and a list has one. It then rewrites `scrollTop` in units of
`TILE_HEIGHT`, which is the grid's row height and not the list's:

| step | value |
| --- | --- |
| albums, 800px wide, scrolled | 2000 |
| effect: `floor(2000 / 235) * 4` groups | group 32 |
| effect: `floor(32 / 1) * 235` | 7520 |
| artists list, 200 rows at 41px | 8200 tall |

Each tab keeps its own place instead: Albums and Artists are two places, not
two renderings of one, and coming back to the letter S is the point of leaving
it. It covers the drill-in too, which resets today — `browse !== null` renders
the table, so `BrowseView` genuinely unmounts, and backing out of an album puts
you at the top of the grid rather than back on the album you opened.

## Build

- **`key={tab}` on `BrowseView`** (`App.tsx`). One instance per tab: separate
  scroll containers, `kind` constant for the life of an instance, and the
  column effect can no longer see a kind change. On its own this resets to the
  top, which is the floor the memory is built on.
- **An offset per `ViewTab` in the library store**, written by `BrowseView`
  through `getState()` and never subscribed to, so scrolling costs no render.
  Store the index of the top group rather than pixels: the window can be
  resized while another tab is open, and an index survives a changed column
  count where a pixel offset would point at a different album. Save
  `floor(scrollTop / rowHeight) * columns` on unmount, restore
  `floor(topGroup / columns) * rowHeight`, with `rowHeight` the kind's own —
  the effect's hardcoded `TILE_HEIGHT` is only right because it now runs for
  the grid alone.
- **Restore once the groups are in**, not on mount: the empty state has no
  container to scroll, and the virtualizer needs the count before an offset
  means anything. Guard on the row count and a `restored` ref.

The ordering trap between the last two: the column effect fires on the first
measurement of every mount, because `columns` falls back to 1 until `attachRow`
reports a width, so the first commit at four columns looks like a reflow. That
is harmless today with `scrollTop` at 0; against a restored offset it divides
it by four. Skip the correction on the first measurement — there is no previous
layout to re-anchor — and restore after the width is known.

## Reset

A remembered position into a different set of groups means nothing:

- `applySearch` (`store.ts`) — the term decides what is listed at all.
- `applyEntry`'s `crossesPlaylist` — a playlist's albums are not the library's.

Anything else that reshuffles groups keeps its offset; a shorter list clamps
itself and lands near where it was in the alphabet.

While in `applyEntry`: it blanks `groups` with `groupsLoading` still false, so
a tab switch renders "No songs yet" for a frame and detaches the container. Set
the flag in the same `set`.

## Tests

`BrowseView.test.tsx` already stubs layout and drives the virtualizer.

- Unmount at an offset and remount the same kind restores it; a different kind
  opens at the top.
- Mounting with an offset stored and no groups yet stays put, and restores when
  the groups arrive.
- `keeps the album at the top of the view there across a reflow` must still
  pass, and the first measurement of a mount must leave a restored offset
  alone.
- In the store tests: a search and a playlist change clear all three offsets.
