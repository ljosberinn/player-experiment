# 21 — Density and webview zoom

Merged in #33, confirmed by the user (*"the new default for 100 is good!"*).

**21a — the density rebase.** Type and spacing scale multiplied by 1.2 and
rounded to whole pixels: base font 12→14px, row height 22→26. Borders, radii and
shadows untouched — a 1.2px hairline is a blurry hairline and a scaled radius
reads as a different shape.

- The caption buttons are deliberately excluded: they mirror the OS cluster, and
  34×30 scaled would put them back at the size already rejected as oversized.
- **The virtualizer constants moved with the CSS.** A CSS row that grows while
  the estimate does not is what makes rows overlap and the scrollbar lie.
- The scripted pass missed twelve declarations that follow a comment rather than
  a `;` or `{`, including `.status-display`'s fixed height. Found by diffing for
  density properties that had *not* changed.
- Only `--control-height` became a variable; `--row-height` and `--gutter` were
  added and removed again because nothing referenced them.
- The theme-parity guard now compares colours **by value**, since density
  variables have no dark variant and should not be forced to invent one.

**21b — webview zoom**, `getCurrentWebview().setZoom()`, 0.8–2.0, default 1.0.

- Webview zoom, not CSS: CSS pixel coordinates are unchanged, so `ROW_HEIGHT`
  stays 26 at any zoom and text is laid out at the target size rather than
  stretched.
- Applied before the window is shown, inside the geometry restore.
- Ctrl+plus/minus/0 go through the same store as the control, or the webview acts
  on them itself and the control reports a zoom that is no longer true.
- Rounded to one decimal everywhere — 0.1 is not binary-representable, so
  stepping up from 0.8 lands on 0.9999999999999999.
- A rejected zoom is not persisted.

The control ended up as **two buttons and a value** in the status bar's empty
first column, not a slider: the steps are 0.1 over a narrow range, which suits
clicking. That move broke the footer onto two lines — grid auto-placement only
moves *forward*, so a child assigned to column 1 after one in column 2 starts a
new row. Fixed by putting the stepper first in the DOM too and pinning every
status-bar child to `grid-row: 1`, with a guard that any `.statusbar-*` rule
setting a column must also set a row.
