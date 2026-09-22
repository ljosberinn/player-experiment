# 129 — Everything is a size larger

The app's own lengths grow by about 10%. Interface zoom is untouched: 100% is
still webview zoom 1.0, and the steps, the range and the stored `window.zoom`
stay as they are. This is the same kind of pass as 21a, which scaled by 1.2
([21](../done/21-density-and-zoom.md)).

## The map

Each value is rounded to its nearest neighbour, not multiplied by exactly
1.1. The sheet is not on a 4px grid (7, 11.5 and 13.5 are all in use), so
there is no grid to keep.

- **Font sizes:** ×1.1 to the nearest 0.5 below 20px and to a whole pixel
  above. This keeps every current size distinct and in order: 9.5→10.5,
  10.5→11.5, 11→12, 11.5→12.5, 12→13, 12.5→13.5, 13→14.5, 13.5→15,
  14→15.5, 15→16.5, 16→17.5, 17→18.5, 24→26, 26→29, 28→31. 91
  declarations, including the root `font-size` at
  [tokens.css:60](../../../src/styles/tokens.css#L60).
- **Lengths ≥ 4px:** ×1.1 to a whole pixel. Width, height, padding, margin,
  gap, inset, grid tracks and the px half of `min(Npx, vw)`. For example
  5→6, 7→8, 10→11, 12→13, 18→20, 24→26, 30→33, 36→40, 44→48, 158→174,
  232→255, 340→374, 912→1003.
- **Unchanged:** values ≤ 3.5px, and every `border*`, `outline*`,
  `box-shadow`/`--shadow*` and `blur()`. The reason is 21a's: a 1.1px
  hairline is a blurry hairline. Unitless line-heights, `em`, `%`, `vw`,
  `vh` and `vmax` also stay. Radius is 0 everywhere already. 122 of the
  sheet's ~606 px literals fall under the ≤ 3.5px rule.
- **Sums are re-derived, not mapped.** Rounding does not distribute:
  168 = 158 + 2×5 maps to 185, but 174 + 2×6 is 186.

## Values that have to agree

| What | Now | New |
| --- | --- | --- |
| `--control-height` ([tokens.css:53](../../../src/styles/tokens.css#L53)) | 26 | 29 |
| `.appbar` ([app.css:38](../../../src/styles/app.css#L38)) | 36 | 40 |
| `.transport-strip` ([app.css:148](../../../src/styles/app.css#L148)) | 78 | 86 |
| `.statusbar` ([app.css:2204](../../../src/styles/app.css#L2204)) | 27 | 30 |
| `.sidebar` ([app.css:504](../../../src/styles/app.css#L504)) | 232 | 255 |
| `ROW_HEIGHT` ([SongRow.tsx:22](../../../src/features/library/SongRow.tsx#L22)) | 32 | 35 |
| `GROUP_ROW_HEIGHT`, group padding ([releaseLayout.ts:21](../../../src/features/library/releaseLayout.ts#L21)) | 28, 14+14 | 31, 15+15, so `groupHeight` = 31n + 63 |
| Drill-in header offset ([app.css:909](../../../src/styles/app.css#L909)) | `12 + 168 + 16` | `13 + 185 + 18`, which is the `.release-group` padding, track and gap |
| `.browse-cover` / `TILE_WIDTH` / `TILE_GAP` ([BrowseView.tsx:15](../../../src/features/library/BrowseView.tsx#L15)) | 158 / 168 / 10 | 174 / 186 / 11 |
| `TILE_HEIGHT` / `LIST_ROW_HEIGHT` | 235 / 41 | measure in the app |
| `STATUS_COLUMN_WIDTH` ([rowStatus.ts:15](../../../src/features/library/rowStatus.ts#L15)) | 26 | 29 |
| `MIN_COLUMN_WIDTH` ([columns.ts:67](../../../src/features/library/columns.ts#L67)) | 48 | 53 |
| `ALL_COLUMNS` widths ([columns.ts:16](../../../src/features/library/columns.ts#L16)) | 336 77 216 216 156 72 53 216 72 384 | 370 85 238 238 172 79 58 238 79 422 |
| Cell padding / `CELL_PADDING_PX` ([columnDrag.ts:68](../../../src/features/library/columnDrag.ts#L68)) | 5 a side / 10 | 6 / 12 |
| `TOOLTIP_WIDTH` and `.chart-tooltip` ([Tooltip.tsx:11](../../../src/components/charts/Tooltip.tsx#L11), [app.css:2638](../../../src/styles/app.css#L2638)) | 160 | 176 |
| `CHART_MARGIN` / `RADIAL_MARGIN` ([ChartFrame.tsx:18](../../../src/components/charts/ChartFrame.tsx#L18)) | 8 8 20 40 / 8 | 9 9 22 44 / 9 |
| `GLYPH` ([IconButton.tsx:15](../../../src/components/primitives/IconButton.tsx#L15)) | 14 14 11 9 | 15 15 12 10 |
| `<Icon size>` literals and `ICON_SIZE` | 10 12 13 15 17 18 22 | 11 13 14 17 19 20 24 |
| Inline `<svg>` in `RowStatusCell`, `Checkbox` | 12, 10 | 13, 11 |
| `MENU_INSET`, `BADGE_OFFSET_PX` | 8, 14 | 9, 15 |

`DRAG_THRESHOLD_PX`, `SLIVER`, the edge-scroll speed and the physical-pixel
floors in `geometry.ts` do not change.

**Window.** Grow it with the content in
[tauri.conf.json](../../../src-tauri/tauri.conf.json) and
[tauri.wdio.conf.json](../../../src-tauri/tauri.wdio.conf.json): default
1416×864 → 1560×950, minimum 1032×624 → 1136×686. A stored geometry still
wins, so only fresh installs see the new default.

**Covers.** At 174px, `MAX_ZOOM` 2 and 150% scaling a tile is 522 device px
against `MAX_EDGE` 500
([covers.rs:24](../../../src-tauri/src/db/covers.rs#L24)). Keep 500, which is
Cover Art Archive's `-500` size, and update the comment.

## Decisions

- **Stored column widths.** `ColumnConfig.widths` are px overrides. Leave
  them, so a column the user resized keeps its width and may now clip
  (recommended). The alternative is to scale them ×1.1 once on load.
- **design.md.** The type table and layout values
  ([design.md:186](../../knowledge/design.md#L186),
  [:202](../../knowledge/design.md#L202)) are the sheet's. Either record the
  map once as a departure and keep the sheet's numbers, so a re-fetch
  compares directly (recommended), or restate every table in the app's
  numbers.
- **Font rounding.** Half pixels as above, or whole pixels only. With whole
  pixels, 12.5 and 13 both become 14.
- **[139](139-the-review-dialog-has-room.md) lands after this** and sets its
  dialog sizes in the new scale.

## Tests and docs

- Hard-coded copies: `App.css.test.ts` asserts the app bar and status bar
  heights and the cell padding
  ([:1096](../../../src/App.css.test.ts#L1096),
  [:1113](../../../src/App.css.test.ts#L1113)). `appearance.test.ts` asserts
  the band heights ([:570](../../../e2e/specs/appearance.test.ts#L570)).
  `browse-scroll.test.ts` copies the tile constants
  ([:24](../../../e2e/specs/browse-scroll.test.ts#L24)).
  `release-groups.test.ts` expects 114 and 28
  ([:70](../../../e2e/specs/release-groups.test.ts#L70)), which become 125
  and 31. `releaseLayout.test.ts` checks `groupHeight`: 86 and 338 become 94
  and 373. `BrowseView.test.tsx` uses `235`, and `SongTable.renders.test.tsx`
  has its own `ROW_HEIGHT` and `WINDOW_ROWS`.
- Every e2e screenshot changes. `SHOT_ZOOM` 0.9 at 1920×1080 stays, so each
  shot holds about 10% less.
- Stale prose: [frontend.md:98](../../knowledge/frontend.md#L98) (28/32px
  rows), [:409](../../knowledge/frontend.md#L409) (icon button sizes),
  [:609](../../knowledge/frontend.md#L609), and the header of
  [zoom.ts](../../../src/features/shell/zoom.ts) ("`ROW_HEIGHT` stays 26").
- Diff the stylesheets for length declarations that did not change. 21a's
  scripted pass missed twelve that followed a comment.

## Verification

- At 100% zoom, the text, rows, bars, controls, icons, covers and dialogs
  are all about 10% larger than on `main`. Hairlines, rules and focus rings
  are unchanged.
- Zoom still steps from 80% to 200%, and Ctrl+0 is still webview 1.0.
- Songs table: rows do not overlap or gap while scrolling fast, and a
  row-drag drop lands on the row under the pointer.
- Releases drill-in: groups do not overlap, and the header columns line up
  with each group's cells.
- Albums grid: a tile never overflows its row at any width, including a
  maximised window.
- Double-clicking a column divider fits the column without clipping it.
- A chart tooltip stays inside the chart at both edges.
- At 1136×686 the transport strip stays on one row and nothing clips. A
  fresh install opens at 1560×950.
