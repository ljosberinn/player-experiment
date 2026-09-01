# 64 — A browse tab opens where the last one was scrolled

Scroll Albums, click Artists: the list opens at an offset carried over from the
grid instead of at the top, so the view starts somewhere arbitrary in the
alphabet with nothing above it worth seeing.

`<BrowseView kind={tab} />` has no `key` (`App.tsx`), so the three tabs are one
component instance and one scroll container. The DOM node survives the switch
even through the empty state — `song-body` and `song-body browse-body` are both
a `div` in the same slot, so React reuses the element and only drops the
attributes — and `scrollTop` rides along with it.

The reflow correction makes it worse. `BrowseView`'s column effect exists for a
window resize, where the row height is unchanged and only the column count
moves; a kind change trips the same condition, because the grid has four columns
and a list has one. It then rewrites `scrollTop` in units of `TILE_HEIGHT`,
which is the grid's row height and not the list's:

| step | value |
| --- | --- |
| albums, 800px wide, scrolled | 2000 |
| effect: `floor(2000 / 235) * 4` groups | group 32 |
| effect: `floor(32 / 1) * 235` | 7520 |
| artists list, 200 rows at 41px | 8200 tall |

So a click 8 rows into the albums grid lands 183 artists down a 200-artist
list. Whether the effect gets to run at all depends on the render the store
happens to produce in between — `applyEntry` clears `groups` while
`groupsLoading` is still false (`store.ts`), which renders the empty state for a
frame and detaches the ref — so the offset that survives is 7520 or 2000
depending on timing. Both are wrong.

## Which behaviour

Reset to the top is one line — `key={tab}` on `BrowseView` — and remembering
per tab is what the tabs are for: Albums and Artists are two places, not two
renderings of one, and coming back to the letter S is the point of leaving it.

Remembering also covers the drill-in, which resets today: `browse !== null`
renders the table instead, `BrowseView` genuinely unmounts, and backing out of
an album puts you at the top of the grid rather than back on the album you
opened.

If it remembers: the offset is per `ViewTab`, and it is only valid while the
list under it is. A search, a playlist change or a rescan gives a different set
of groups, and a remembered pixel offset into the old one means nothing —
those reset. The store already distinguishes these; `applyEntry`'s
`crossesPlaylist` and the `search` transitions are where the reset belongs.

Restore after the groups land, not on the tab change: the empty-state frame has
no container to scroll, and the virtualizer needs the count before an offset
means anything.

## Tests

`BrowseView.test.tsx` already stubs layout and drives the virtualizer, and
`keeps the album at the top of the view there across a reflow` is the neighbour
of the effect that has to stop firing here — a rerender with a different `kind`
must leave `scrollTop` alone, and a real width change must still correct it.
