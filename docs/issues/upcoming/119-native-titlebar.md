# 119 — Native titlebar

"Native OS titlebar assumed. App menus live in the content area, so nothing here
draws window buttons."

`decorations: true` in `tauri.conf.json` and `tauri.scan.conf.json`. The drawn
36px bar goes: `.window-buttons`, the minimise/maximise/close glyphs, the drag
region, the double-click-to-maximize handling and the mark.

What the bar carried has to land somewhere:

- **Menus** move into the content area, above the sidebar and the table. Still
  `MenuBar`, still Base UI.
- **The version** moves to the status bar, which already holds it on the right.
  Delete the duplicate.
- **The mark** has no home in the sheet. Either it goes, or it sits with the
  menus — decide with a screenshot rather than in the abstract.
- **The 3px accent strip along the top of the window** is the design's most
  recognisable single element and belongs to the old design file, which still
  governs the shell. Keep it, now along the top of the content area.

What it breaks:

- `App.css.test.ts` "keeps the title bar and the footer the heights the design
  draws" and "lets the caption buttons paint over the title bar's own
  separator". The first changes, the second goes.
- The `menus` and `smoke` e2e specs, and any spec measuring from the top of the
  window. `e2e/viewport.ts` converges on the *inner* viewport, so it absorbs the
  new window-to-viewport delta on its own — but check the first run rather than
  assuming.
- Translucent chrome: a native frame does not blur, so the top edge of the
  window stops being a continuous surface. Look at it before deciding whether
  the sidebar veil still reads.

Independent of the rest of the sequence. Its own worktree.

Part of the [component library sweep](../../plans/apex-components.md).
