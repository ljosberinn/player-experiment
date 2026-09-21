# 115 — Stat rows and tiles

Section 4a, plus 4b's upper drawing. Section 4b's token line is
[122](../upcoming/122-filter-tokens.md).

4a is not two alternatives. Its row is Plays / Artists / Tracks / Time spent and
its cells are LISTENING DAYS "since 14.9.2011", OWNED "plays matched to a file",
THIS MONTH — that caption is verbatim from `ListeningTiles.tsx`. The sheet is
drawing the Listening tab, split by one rule: **a bare figure sits on the row, a
figure that needs a line of prose takes a cell.**

**`StatRow`** — figures on a shared baseline, no boxes. A 2px rule across the
top, `12px` to the row, columns `minmax(0,1fr)` `18px` apart. Label `400 11px`
muted, 6px, then `800 28px/1`, `-.02em`, tabular. A unit riding on a figure is
`800 16px` muted.

**`StatTiles`** — bordered cells, `repeat(3, …)` with a 2px gap over a border
colour so the gap reads as a rule. `12px` padding. Eyebrow `800 9.5px`, `.11em`,
muted, 8px; figure `800 24px/1` tabular; caption `400 11px/1.3` muted at 5px. A
delta takes accent-deep instead of muted.

Both are one `<dl>` around the whole set, rather than `charts/StatTile`'s one
per tile: six tiles were twelve unrelated announcements.

Listening is the sheet's split, four and three. Library's six are one kind of
answer at one weight, so all six are cells, three across. Streaks keeps its two
until [116](../upcoming/116-streaks-heatmap-leaderboard.md) redraws the panel,
and `.stats-panel` narrows the grid to two columns so the empty third track is
not a block of the gap colour.

The unit rider needs the number and its unit apart, so `spanParts` and
`byteParts` are what `formatSpan` and `formatBytes` are now built from.

**`FilterBar`** — `.stats-filters` becomes labelled controls on one rule: label
`400 11px` muted, 5px, then the control, the set `14px` apart on a 2px bottom
rule with `16px` under it. The panels below start 22px down rather than 8px:
4a's rule and 4b's are both 2px, and at the old gap the two read as one double
rule.

Part of the [component library sweep](../../plans/apex-components.md).
