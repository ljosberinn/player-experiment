# 178 — A drill-in fits its columns to the last release's layout

Now and then a drill-in opens with a column narrower than its widest entry:
*Disko im Dunkeln*, track 5's `Degenhardt feat. Gossenboss mit Z…`.

From one drill-in to another, `ReleaseGroups` stays mounted and `releases`
still holds the previous view's list until `loadGroups` replaces it. The new
view's first page lands first, laid out in the old groups: a group renders
`trackCount` rows, so a new release longer than the old one leaves its tail
unmeasured by [54](54-fit-columns-when-a-view-opens.md)'s fit, and nothing
refits when the right `releases` arrive.

Grid to drill-in is unaffected: `releases` is empty until it lands, so no
group renders and no page is fetched.

## Fix

`loadGroups` records `releasesToken`, the `queryToken` its `releases` were
loaded under, and fetches `browseGroups` and `releaseGroups` side by side.
Until `releasesToken` matches `queryToken`, `ReleaseGroups` fetches no rows
and `useSongTableWiring` fits no columns (`laidOut`). A failed load leaves the
token behind.

## Verification

- `ReleaseGroups` test: a 3-track drill-in, then a 6-track one whose releases
  land late; the sixth row is measured.
- Tanzlabor, then back to a short release and forward again: no column clips.
