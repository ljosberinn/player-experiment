# 117 — The row menu and the task line

Section 05. Both are drawings; neither changes what the menu offers or when the
readout appears.

**One drawing, two menus.** `renderMenuItem` draws the row menu and every
menu-bar dropdown, so section 05 lands on File and Edit as well. The classes
become `.menu-*` — "context" stops being true at the menu bar — and move to
`library.css`. The sheet's 226px is a `min-width`: fixed, it would leave File
two thirds empty and clip a long entry at the next zoom step.

**Items go full bleed.** `4px 0` on the popup, `7px 12px` on an item, so the
highlight is a band across the panel and a separator a rule across it. This
reverses the inset `.context-menu` has carried since phase 24, whose comment
argued the opposite; the comment goes with it.

**The trailing column carries the app's own shortcuts.** The sheet draws
`Ctrl+E` on Show in Explorer and the app has no such binding. `MenuItem` gains
`shortcut`, set where a binding exists — `Ctrl+I` on Edit, `Del` on whichever
removal `Delete` performs in that context — and nowhere else.
`aria-keyshortcuts` carries it to a screen reader, so an item's accessible name
stays its label. The column is `hint`'s too; a hinted entry is disabled and has
no binding, so the two never meet. File's own removal entry gets none: `menus()`
does not know whether a static playlist is open, and `Del` there would be wrong
half the time.

**Nothing to reorder.** `rowMenuItems` already emits the sheet's order and its
three separators, with the destructive entry last in its group.

**The task line is two lines and a bar.** `taskSummary`'s one joined string
becomes the label with the percentage, then the estimate; under them 118px of
`--track` with an accent fill at the ratio. The bar is `aria-hidden` and takes
the bare slab rather than `.streak-track`'s hairline: the ratio it draws is
printed in words on the line above, so it is not a graphic anything needs to be
understood, and at 4px an edge either side would leave 2px of rail.

**`ProgressBar` lands with it.** The sheet draws that 4px track twice — here and
under 6f's loading pane — so the track is the primitive and `TaskLine` is its
first caller.

`TaskLine` and `ProgressBar` go in `primitives/`; `BackgroundTaskProgress` keeps
the subscription, and `.sidebar-task` keeps its placement at the foot of the
sidebar and nothing else. `ui/ContextMenu.tsx` stays where it is: the item
renderer and the trigger region are one vocabulary, and splitting them across
two directories to satisfy a row of the plan's table buys nothing — 116b's rule.

Not drawn: the sheet's `0,22%` is its author's decimal comma, and its dark popup
fill (`#221d17`) disagrees with its own dialog fill; tokens win. `Skeleton` is
6f's pulse, which is 118.

Part of the [component library sweep](../../plans/apex-components.md).
