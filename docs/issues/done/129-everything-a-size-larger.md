# 129 — Everything is a size larger

The app's own lengths grow by about 10%. Interface zoom is untouched: 100% is
still webview zoom 1.0, and the steps, the range and the stored `window.zoom`
stay as they are. The same kind of pass as 21a, which scaled by 1.2
([21](../done/21-density-and-zoom.md)).

## The map

Each value is rounded to its nearest neighbour, not multiplied by exactly 1.1.

- **Font sizes:** ×1.1 to the nearest 0.5 below 20px and to a whole pixel
  above, which keeps every size distinct and in order: 9.5→10.5, 10.5→11.5,
  11→12, 11.5→12.5, 12→13, 12.5→13.5, 13→14.5, 13.5→15, 14→15.5, 15→16.5,
  16→17.5, 17→18.5, 24→26, 26→29, 28→31. Includes the root `font-size` in
  `tokens.css`.
- **Lengths ≥ 4px:** ×1.1 to a whole pixel, in all four stylesheets and in the
  sizes TSX passes inline.
- **Unchanged:** values ≤ 3.5px, and every `border*` that is a line,
  `outline*`, `box-shadow`/`--shadow*` and `blur()`. Unitless line-heights,
  `em`, `%`, `vw`, `vh` and `vmax` stay.
- **Exceptions to the map:**
  - Border-trick triangles are shapes and scale: `.appbar-mark::after`
    4.5/4.5/6.5, `.sidebar-chevron` 4.5/4/4. So does the play button's halo
    spread, 5→6.
  - `.row-status .wave`'s `transform-origin: 8px 8px` is in the 16-unit
    `viewBox` and stays.
  - `.column-resizer` stays `right: -4px; width: 8px`, centred on the edge.
- **Sums are re-derived, not mapped.** Rounding does not distribute.

## Values that have to agree

| What | Was | Now |
| --- | --- | --- |
| `--control-height` | 26 | 29 |
| `.appbar` / `.transport-strip` / `.statusbar` | 36 / 78 / 27 | 40 / 86 / 30 |
| `.sidebar` | 232 | 255 |
| `ROW_HEIGHT` (`SongRow.tsx`) | 32 | 35 |
| `GROUP_ROW_HEIGHT`, group padding | 28, 14+14 | 31, 15+15, so `groupHeight` = 31n + 63 |
| Drill-in header offset | `12 + 168 + 16` | `13 + 185 + 18` |
| `.browse-cover` / `TILE_WIDTH` / `TILE_GAP` | 158 / 168 / 10 | 174 / 186 (174 + 2×6) / 11 |
| `TILE_HEIGHT` / `LIST_ROW_HEIGHT` | 235 / 41 | 260 / 46 — measured tile 247 + 13, item 40 + 6 |
| `STATUS_COLUMN_WIDTH` | 26 | 29 |
| `MIN_COLUMN_WIDTH` | 48 | 53 |
| `ALL_COLUMNS` widths | 336 77 216 216 156 72 53 216 72 384 | 370 85 238 238 172 79 58 238 79 422 |
| Cell padding / `CELL_PADDING_PX` | 5 a side / 10 | 6 / 12 |
| `TOOLTIP_WIDTH`, `.chart-tooltip` | 160 | 176 |
| `CHART_MARGIN` / `RADIAL_MARGIN` | 8 8 20 40 / 8 | 9 9 22 44 / 9 |
| `GLYPH` (`IconButton.tsx`) | 14 14 11 9 | 15 15 12 10 |
| `<Icon size>` literals and `ICON_SIZE` | 10 12 13 15 17 18 22 | 11 13 14 17 19 20 24 |
| Inline `<svg>` in `RowStatusCell`, `Checkbox` | 12, 10 | 13, 11 |
| `MENU_INSET`, `BADGE_OFFSET_PX` | 8, 14 | 9, 15 |
| `ROW_HEIGHT` (`RecentPlays.tsx`) | 28 | 31 |
| `RAIL` (`TaskLine.tsx`, `ReleaseLookup.tsx`) | 118, 56 | 130, 62 |
| Checkbox hit area over its mark | 24 over 15, `left: -4.5px` | 26 over 17, `left: -4.5px` |
| `.switch` / `.switch-knob` | 34×18 / 14 | 37×20 / 16, the knob still filling the box inside its edge and padding |

`DRAG_THRESHOLD_PX`, `SLIVER`, the edge-scroll speed and the floors in
`geometry.ts` do not change.

**Window.** Default 1416×864 → 1560×950, minimum 1032×624 → 1136×686, in
`tauri.conf.json` and `tauri.wdio.conf.json`. A stored geometry still wins, so
only fresh installs see the new default.

**Covers.** At 174px, `MAX_ZOOM` 2 and 150% scaling a tile is 522 device px.
`MAX_EDGE` stays 500, Cover Art Archive's `-500` size.

## Decisions

- **Stored column widths** are left alone: a column the user resized keeps its
  width and may now clip.
- **design.md** records the map once and keeps the sheet's numbers, so a
  re-fetch compares directly.
- **Half-pixel font sizes**, as above.
- **[139](../upcoming/139-the-review-dialog-has-room.md) lands after this** and sets its
  dialog sizes in the new scale.

## Verification

- At 100% zoom, the text, rows, bars, controls, icons, covers and dialogs are
  all about 10% larger than before. Hairlines, rules and focus rings are
  unchanged.
- Zoom still steps from 80% to 200%, and Ctrl+0 is still webview 1.0.
- Songs table: rows do not overlap or gap while scrolling fast, and a row-drag
  drop lands on the row under the pointer.
- Releases drill-in: groups do not overlap, and the header columns line up with
  each group's cells.
- Albums grid: a tile never overflows its row at any width, including a
  maximised window.
- Double-clicking a column divider fits the column without clipping it.
- A chart tooltip stays inside the chart at both edges.
- At 1136×686 the transport strip stays on one row and nothing clips. A fresh
  install opens at 1560×950.
