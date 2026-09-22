# 132 — A release opens in track order

A Releases drill-in should always open sorted by disc, then track number,
ascending. `sortForEntry` asks for `trackNo`, but three things undo it:

- **Disc is ignored.** `sort_order_by` sorts `tracks.track_no` alone, so a
  two-disc release reads 1-1, 2-1, 1-2, 2-2. `trackNo` has to mean
  `coalesce(disc_no, 1), track_no` — at least inside a drill-in, where
  `RELEASE_ORDER` already does this for the lookup.
- **A search overrides it.** `sortForEntry` keeps the current sort while the
  box holds a term: relevance, or whatever column was clicked. Clicking a
  tile in a searched grid opens the release in match order.
- **`visibleSort` overrides it.** A navigation that crosses a playlist runs
  `loadColumns`, which falls a hidden `trackNo` back to the first column. 131
  pins `#` in every release drill-in, which fixes this; stacks on 131.

Clicking a column header inside the release still re-sorts it.

Artist and genre drill-ins open in `artist`, which inside each release group
is scan order. Out of scope unless decided otherwise.

## Verification

- A two-disc release opens 1-1 … 1-n, 2-1 … 2-n.
- A release opened from a searched grid is in track order, and stays in it
  when the search is cleared.
- A release opened from a playlist row with `#` hidden is in track order.
