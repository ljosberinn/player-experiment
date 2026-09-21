# 122 — Filter tokens

Section 4b's lower drawing, split out of [115](../done/115-stat-tiles.md), which
took the selects.

Muted "Showing", then the current filters as tokens at `5px 8px` on the
selection fill in accent-deep, weight 600, each with a 10px × at stroke 2.5. The
set closes with a dashed `1px` "+ add filter" in muted.

4b draws the selects and the tokens in one frame, but the selects read `All
time` / `Either` / `Either` while the tokens under them read `last 12 months` /
`owned only`. A page never shows a filter and its own contradiction; a specimen
sheet showing two forms of one control does. So this is a second form of the
filter bar rather than a line under it, and landing it means deciding which of
the two the Statistics view wears.

Two unanswered questions:

- **What "+ add filter" opens.** `StatsFilters` is a closed struct of six
  fields, and the bar draws every one that applies to the open tab. An
  affordance for adding a filter needs a facet that is *absent* rather than at
  its default, which nothing in the store distinguishes today.
- **What each token says.** A token is a phrase per facet-value pair — `owned:
  false` is "not in the library", or "unowned only", or something else — and
  `Range: custom` is two dates rather than a phrase at all. The copy is the
  work.
