# 66 — The albums grid overflows sideways

The albums view scrolls on the x-axis at some window widths, cutting the last
tile in a row. It should never scroll sideways: the tiles are fixed-size and the
column count is computed from the container, so a row is meant to fit by
construction.

The count is computed from the wrong box. `BrowseView` measures
`element.clientWidth` (`BrowseView.tsx`), which is the padding box, while the
tiles lay out in the content box - 60px narrower, from `.browse-body`'s
`padding: 0 30px 30px`. The comment at `attachScroll` has this backwards: it
says `contentRect` excludes the padding the tiles use, when the observer reports
the content box for a `border-box` element, which is exactly the width the row
gets. With `TILE_WIDTH` at 178 (a 168px tile plus the row's 10px gap), `n` tiles
need `178n - 10` and have `clientWidth - 60`, so the grid overflows whenever
`clientWidth % 178 < 50` - roughly a quarter of widths, the maximised window
among them. Nothing clamps the result: `.browse-body` is `overflow: auto`, and a
tile cannot shrink into the shortfall because its 168px is its min-content width
(a 158px cover plus 5px of padding each side).

To decide:

- **Where the corrected width comes from.** The observer's `contentRect` is the
  right number but only arrives on a callback; the eager `setWidth` before
  `observe` has nothing to read it from, so either that path reads
  `clientWidth` minus the computed padding, or the first measurement waits for
  the observer's initial call.
- **How the fix is pinned.** `BrowseView.test`'s `stubLayout` defines
  `clientWidth` only, and jsdom has no layout, so a padding-aware measurement
  needs the stub to carry the padding too. An e2e check that
  `browse-scroll`'s `scrollWidth` never exceeds its `clientWidth` across a few
  window widths would catch it where real layout exists -
  `virtualization.test.ts` already drives that kind of assertion.
