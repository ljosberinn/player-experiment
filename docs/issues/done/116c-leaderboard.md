# 116c — Leaderboard

Section 4e. Ranked rows with the count as a bar behind the name: 30px high,
3px apart, the fill spanning the row's share of the largest over its whole
height, `400 12.5px` with the name at weight 600 left and the count tabular
muted right, both inset `0 9px`.

`charts/BarList` is that drawing, restyled to those numbers. Its drawing moves
to `library.css` the way 116b moved the heatmap's, and the guard that keeps 4a,
4c and 4d out of `app.css` covers `.bar-list` too.

**The numbered list is the alternative, and the app declines it.** 4e's two
blocks iterate the same five rows twice — the lower one drops the bar and adds
a rank numeral, and says nothing the upper one does not. By the rule 4b
settled, that is a choice rather than a second form to ship, and the bar form
is the one four panels already call. `WorstByBitrate` stays a table: it is one
because it carries album, artist, songs and mean kbps, not because a bar of 320
would read flat, and it is read to the end rather than skimmed as a ranking.

Off main. Independent of [116a](116a-streak.md) and [116b](116b-heatmap.md).

Part of the [component library sweep](../../plans/apex-components.md).
