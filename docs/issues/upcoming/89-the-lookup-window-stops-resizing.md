# 89 — The lookup window stops resizing

`ReleaseLookup` is a different size in every state it passes through, and it is
centred, so both edges move. Measured against `App.css` in the engine the
webview runs, at a 1440×900 window (1416×808 viewport):

| On screen | Height | Top edge | Action row |
| --- | --- | --- | --- |
| Reading the files… / Searching MusicBrainz… | 154 | 327 | 434 |
| 1 candidate | 255 | 277 | 485 |
| 3 candidates | 409 | 200 | 562 |
| 15 candidates | 554 | 127 | 634 |
| Confirm, 3 files | 580 | 114 | 647 |
| Confirm, 11 files or more | 695 | 57 | 704 |

Cancel, Set Aside and Skip Release travel 270px over one release. And
`advance` calls `enter`, which sets `stage: "opening"` and `tracks: []`, so
**every Skip collapses the dialog to 154px before the next release's cached
candidates expand it again** — the buttons jump the full 270px twice per
release, under a pointer that is resting on them.

**The width is already fixed and does not move**: 912px in every row above,
and 912px with a 124-character track title, which wraps rather than widening
anything. `.modal` is `width: min(912px, 92vw)` and `box-sizing: border-box` is
global. What is asked for here is the vertical half of the same property.

## One box, one scroller

`.modal` is `max-height: 86vh` with `overflow: auto`, and the two inner
`max-height` caps — `.lookup-results` at 46vh, `.lookup-map-scroll` at 40vh —
exist to keep the buttons on screen, which a footer that does not scroll does
better. Three scroll areas in one dialog is what they cost.

So: `.modal.lookup` takes a **height** rather than a maximum, and the dialog
becomes a heading that stays, a body that scrolls, and an action row that
stays. `min(720px, 86vh)` leaves the tallest state exactly where it is — a
confirm step of 11 files already wants 695 — and only the short states grow.
The two inner caps go with it, and `overflow` comes off the popup, or there are
two scrollers again.

The body is a flex child at `flex: 1`, and needs `min-height: 0` beside it: a
flex item's automatic minimum is its content, which is what makes an
`overflow-y: auto` child of a column flex refuse to shrink.

**It is the same dialog on a selection**, opened from a right-click on rows
rather than from the review row, so this is not review-queue-only.

`.modal.settings` has the same defect and worse — see
[91](91-settings-reorganised.md), which gives it the same treatment. Whatever
this phase writes for a fixed-height dialog with a pinned footer should be
reusable there rather than specific to `.lookup`.

Testing: e2e cannot reach this dialog — the transport is MusicBrainz and the
driver runs the real app — so the numbers above are the acceptance criterion,
re-measured by hand. `ReleaseLookup.test.tsx` asserts the structure jsdom can
see: the heading and the action row are siblings of the scrolling body rather
than inside it, at both the results and the confirm step.
