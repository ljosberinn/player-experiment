# 132 — A release opens in track order

A Releases drill-in always opens sorted by disc, then track number, ascending.

- `#` sorts `coalesce(disc_no, 1)` before `track_no`, everywhere, so a
  two-disc release no longer reads 1-1, 2-1, 1-2, 2-2.
- `sortForEntry` opens a release in `trackNo` even while a search runs, over
  relevance or a column clicked during it. Clearing the search keeps it.
- Leaving a release while the search still runs goes back to relevance: the
  release's `#` is not a choice the next view should inherit.
- A `#` hidden by a playlist's layout was already handled by 131.

Clicking a column header inside the release still re-sorts it.

Artist and genre drill-ins open in `artist`, which inside each release group
is scan order. Out of scope.

## Verification

- A two-disc release opens 1-1 … 1-n, 2-1 … 2-n.
- A release opened from a searched grid is in track order, and stays in it
  when the search is cleared.
- A release opened from a playlist row with `#` hidden is in track order.
