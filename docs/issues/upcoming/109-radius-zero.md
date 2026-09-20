# 109 — Radius zero

"Radius 0 everywhere, no exceptions. Structure is carried by rules and
alignment, never by cards or shadow."

48 `border-radius` declarations in `App.css` go, including the ones that are not
obviously corners:

- the transport pill (`26px`) and its three round buttons (`50%`)
- the play button's halo and the cover thumbnail's ring
- the app mark in the title bar, drawn as a rounded accent square
- every field, menu, badge and dialog at `2px`–`6px`

A guard in `App.css.test.ts` asserting no rule declares a non-zero
`border-radius`, so it cannot come back one control at a time.

The transport pill is the one that changes shape rather than softness: three
square buttons in a row read as a segmented control, which is what section 02
draws. Screenshot it before and after.

Part of the [component library sweep](../../plans/apex-components.md).
