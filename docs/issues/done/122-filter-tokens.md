# 122 — Filter tokens

Section 4b's lower drawing, split out of [115](115-stat-tiles.md), which took
the selects.

The sheet captions 4b "Top: labelled selects on one rule. Bottom: a token line
— filters read as a sentence and each token is removable." and draws both in
one frame. So the view wears both: the tokens are a line under the bar, not a
second form of it. The selects read `All time` / `Either` / `Either` while the
tokens under them read `last 12 months` / `owned only` because a token line
draws only what is off its default — at those select values it is empty, and a
specimen sheet cannot show an empty row.

Muted "Showing", then one token per facet off its default at `5px 8px` on
`--accent-tint` in `--accent-deep`, weight 600, each closed by a 10px × at
stroke 2.5 that resets that facet. The whole line is gone when nothing is
filtered.

**No "+ add filter".** The sheet's dashed chip has no job: `listenQuery` reads
range, owned and loved, `libraryQuery` reads scope and genre, so every facet a
tab has is already a select above the line and always reachable. The chip
wants a facet the bar cannot express; `genre: null` meaning *untagged* rather
than *every genre* is the only candidate today, and it is not this issue.

**A token is not a select option.** A select answers a caption — Owned: *In the
library* — and a token continues a sentence — Showing *owned only*. Two
grammars, so the phrases are their own table rather than the option labels
reused. Range is the exception: `RANGE_TITLES` lower-cased is already the
sentence form, and `custom` is its two dates instead.

**`activeFilters` takes the playlists rather than reading them**, for the
reason `libraryQuery` takes the view: the caller subscribes and a pure function
of both is what the tests can drive. It is also what `ListeningTiles` asks
whether anything is filtered at all, so its empty state and the token line
cannot disagree.

The line sits between the bar and `.stats-breadcrumb`. Both say what narrows
the view, and they run outermost first: the bar's facets, then the drill path.

The × is a bare button rather than an `IconButton` — that component's four
sizes are four places the sheet states, and a chip is not one of them.

Part of the [component library sweep](../../plans/apex-components.md).
