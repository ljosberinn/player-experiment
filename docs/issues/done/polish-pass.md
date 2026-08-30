# A polish pass

Seventeen small things, each workable on its own. Nothing here depends on
anything else here, with one exception noted under the cogwheel.

Back and forward navigation was asked for in the same pass and is not in this
file: it needs a history stack that does not exist yet, which is a phase.
See [navigation-history.md](navigation-history.md).

## Formatting

### The footer duration stops at hours

`formatLibrarySummary` in `src/lib/format.ts` has two rungs, minutes and hours,
so a library of any size reports a four-digit hour count.

A ladder instead: minutes below an hour, hours below two days, days below two
weeks, weeks below a year, then years. No months — a month is not a fixed
length, and the jump from weeks to years is the only judgement call in the
list.

`viewSummary` is the sole caller, so the footer is the only surface affected.

### A year of 0 renders as a year

`groupMeta` in `src/features/library/browse.ts` already omits a null year. The
zero is real data: `parse_year` in `src-tauri/src/tags/mod.rs` accepts any
four-digit run, so `0000` in a date tag becomes `Some(0)`, and the browse query
takes `min(tracks.year)`, which keeps it.

Fix the parser, and guard `groupMeta` as well — rows already scanned keep their
zero until somebody rescans, and the guard is the half that shows up today.

### Two lines of text to delete

- `src/features/editor/TagEditor.tsx`, the single-track branch of
  `.modal-summary`: **Blank a field to clear it.**
- `src/features/playlists/PlaylistSidebar.tsx`, the empty Playlists section:
  **Drag songs here to start one, or use +.**

`PlaylistSidebar.test.tsx` asserts the second one.

## Layout

### The close button stops a pixel short of the bar

Not two elements that cannot meet. `.titlebar` is `height: 36px` plus a `1px`
`border-bottom`, and `.window-buttons button` is `36px` — so the red hover fill
ends where the bar's own line begins, leaving the line uncovered in the corner.

One rule: the buttons want the bar's full 37px, or the border wants to move off
`.titlebar` and onto something the buttons overlap.

### The Albums grid does not reflow

`BrowseView` reads `scrollRef.current?.clientWidth` during render to decide how
many tiles fit. Nothing re-renders it when the window resizes, so the column
count is whatever the first measurement said.

A `ResizeObserver` on the scroll container, held in state. The virtualizer is
keyed on the row count, which changes with the column count, so it has to be
told — a resize that only changes the CSS leaves the scroll offset pointing at
the wrong row.

### Artists and Genres do not stripe

Songs alternate through `.song-row.odd`, applied by row index. The browse lists
should match.

Index parity, not `:nth-child`: the rows are virtualized and absolutely
positioned, so the DOM order is the window, not the data. Lists only — the
Albums grid is tiles and has no rows to alternate.

### The drill-in breadcrumb

`‹ All {tab}` in `App.tsx` interpolates the tab id, which is lowercase, so it
reads "All genres". Capitalize it.

`.browse-back` in `App.css` is `padding: 7px 14px 0` and sits directly on the
table below it. It needs a bottom.

### The smart playlist cogwheel sits low

`PlaylistSidebar.tsx` renders `⚙` and `≡` as text. Neither is in the UI font, so
Windows substitutes, and the substitute's baseline is not the row's.

Fixable here with alignment, and fixed properly by the icon library below. The
alignment fix is worth doing anyway — it is one line and it does not wait on a
dependency decision.

## Interaction

### The volume rail ignores the wheel

Hovering it and scrolling should change the volume.

React attaches `wheel` passively, so `preventDefault` inside an `onWheel` prop
does nothing but log a warning. This needs a ref and a non-passive
`addEventListener` on the `.volume` wrapper.

### Double-clicking a column divider should fit the column

Widest rendered cell plus the header, committed through `resizeColumn`.

Visible rows only. The table is virtualized and a library runs to six figures,
so the widest value in the column is neither in the DOM nor cheap to ask the
database for. The consequence is that the fit is not idempotent: scroll, fit
again, get a different width. That is the accepted behaviour, not a bug to
report later.

### Double-clicking what is playing should reveal it

On the `NowPlaying` box in the transport strip: open the track's album, or its
artist if it has no album, or fall back to Songs.

Not two calls. `openGroup` reads `tab` off the store and returns early when the
tab is `songs`, so setting the tab and then opening the group would either
no-op or refresh twice. This wants one store action that sets `tab` and
`browse` together and refreshes once.

### `NowPlaying` should be invisible when nothing is playing

Hidden, keeping its box. The box is deliberately always present — it is the
widest thing on a fixed strip, and one that appeared with the first song would
shove the volume and the search field sideways as it arrived. That reason still
holds; only the "Nothing playing" text is unwanted.

`App.test.tsx` and `chrome.test.tsx` assert the text is in the document, and
change to assert it is hidden.

### Add Folder takes one folder

`open({ directory: true, multiple: false })` in `src/features/library/scan.ts`.
Allowing several means `multiple: true`, a string array back, `addWatchFolder`
per entry, and **one** `rescan()` after the loop rather than one per folder.

### The window title should say what is playing

`tauri.conf.json` sets a static `Apex`. With `decorations: false` the title is
invisible in the app itself and only shows in Alt+Tab and the taskbar, which is
where it is wanted: `Apex — <title> — <artist>`, back to `Apex` when nothing is
playing.

`getCurrentWindow().setTitle()`, driven off the player store.

## The icon library

Icons are drawn four different ways today: CSS shapes for the transport,
three `<i>` bars for the volume mark, Segoe MDL2 glyphs for the caption
buttons, and bare Unicode for the playlist rows. The last of those is the
cogwheel bug, and it is the one that has no defence.

**`lucide-react`.** MIT, per-icon ESM so it tree-shakes to what is imported,
stroke-based, and no network at runtime — which rules out anything that expects
a CDN.

Two things this deliberately reverses, and one it deliberately does not:

- The transport glyphs are CSS-drawn on purpose: the previous version used the
  geometric-shapes block and inherited whichever font the machine had, at
  whatever size and baseline that font chose. Replacing rectangles that are
  already exactly right is a consistency argument, not a correctness one.
- The volume mark's three bars are drawn to the design, and the mute state
  greys them and crosses them. A library icon has to carry both states.
- **The caption buttons keep Segoe MDL2.** Those are the OS glyphs; a Lucide X
  in the corner of a Windows title bar reads as a web page.

## Testing

Unit tests for `format`, `browse`, `menus` and `viewSummary` — those four hold
the formatting and menu changes and are already tested at that level.

E2E screenshots for the Albums reflow and the Artists/Genres striping. Both are
changes whose result is only visible, and neither is asserted by anything else.
