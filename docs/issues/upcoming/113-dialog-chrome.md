# 113 — Dialog chrome

Section 06's shell, pulled out before the two dialogs that use it.

`Dialog` = header, body, footer. Dialog fill over the behind-dialog ground,
`1px solid` line border, `0 12px 32px` shadow, `18px` padding.

- **Header** `800 17px/1.1`, `padding-bottom: 12px`, a 2px section rule under
  it, `14px` to the body. A paned dialog's header is `800 16px` with a muted
  `400 12.5px` caption on the same baseline, at `16px 18px 12px`.
- **Footer** a 2px rule above, `12px` to the actions. Actions bottom right,
  **primary last**, `8px` apart, secondary `8px 16px` and primary `8px 18px`. A
  left-hand slot for the one action that leaves rather than completes ("Back to
  queue", ghost).
- A muted `400 11.5px` status line sits at the footer's left when the dialog has
  a count to state ("2 conditions · 116 songs match").

Then 6a, the smart playlist editor, as the first caller:

- Name row: muted `400 12.5px` label in a 44px column, field with an accent
  border.
- Rule box: `1px solid` line, `12px` padding. Header line is `Match [any ▾] of
  the following:`, then `+ Rule` and `+ Group` pushed right, `800 12px`,
  `6px 11px`.
- Rule rows are **one grid**, `130px 130px 1fr 30px`, `6px` gap, so the selects
  line up down the column. The remove button is a 30px square cell.
- **The sort and limit rows stay in place, disabled**, rather than appearing on
  toggle: checkbox, label, then disabled selects at the disabled fill, border
  and text. `100` sits in a 62px box.

`ConfirmDialog`, `SettingsDialog`, `AlbumLinkDialog`, `GenreOverrideDialog` and
`CrashNotice` move onto the primitive here. `.modal` keeps the sizing and
scroll-region rules that `App.css.test.ts` asserts — one size, one scroller.

Part of the [component library sweep](../../plans/apex-components.md).
