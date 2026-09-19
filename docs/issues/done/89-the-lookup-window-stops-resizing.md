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
`overflow-y: auto` child of a column flex refuse to shrink. The parts that stay
take `flex: none`, so a tall body cannot shrink them instead.

## The mechanism is shared, so it is not a `.lookup` rule

Six dialogs carry `.modal`: `ConfirmDialog`, `CrashNotice`, `SettingsDialog`,
`ReleaseLookup`, `TagEditor`, `SmartPlaylistEditor`. Taking `overflow: auto`
off the base rule would leave the other four unable to scroll at all, so the
fixed height, the `overflow: hidden` and the scrolling body are an opt-in
modifier — `.modal.paned` with a `.modal-body` inside it — that
[91](91-settings-reorganised.md) applies to `.modal.settings` unchanged.

`.lookup-map-scroll` is deleted rather than uncapped: an `overflow-y: auto` box
at automatic height is a scroll container that never scrolls, and it would
capture `.lookup-map th`'s `position: sticky` away from the scrollport the
header should stick to.

## The confirm step has two action rows

`Confirm` renders its own `.modal-actions.lookup-confirm-actions` — Back to
Results, Apply — which today sits above the outer Cancel / Set Aside / Skip
row. Both stay, and so does the summary line above them, or Apply scrolls off a
22-track reissue, which is the defect `.lookup-map-scroll`'s cap exists to
prevent. They are not merged into one row: Skip Release discards the release
and Apply writes to disk, and they should not be adjacent.

`Confirm` therefore renders the scrolling body and the pinned row as siblings,
not one inside the other.

The error line is outside the scroller too, above the action rows — an error
that can scroll out of sight is no error message.

Testing: e2e cannot reach this dialog — the transport is MusicBrainz, the
driver runs the real app, and the review queue is only ever filled by the
unattended pass, which no command seeds — so the numbers above are the
acceptance criterion, re-measured by hand against `App.css` in headless Edge.
`ReleaseLookup.test.tsx` asserts the structure jsdom can see: the heading and
the action rows are siblings of the scrolling body rather than inside it, at
both the results and the confirm step.

**It is the same dialog on a selection**, opened from a right-click on rows
rather than from the review row, so this is not review-queue-only.
