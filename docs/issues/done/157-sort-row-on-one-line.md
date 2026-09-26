# 157 — The smart playlist's sort sits on one line

In `SmartPlaylistEditor`, "Sorted by" and its two selects each take a line of
their own. `.select` is `width: 100%`, and in `.filter-row`, which wraps,
each one goes onto its own line. `.filter-head .select` sets the width back
to `auto`; `.filter-order` does not.

## Verification

- `Features/Editing/SmartPlaylistEditor`, `SortedAndLimited`: the checkbox,
  "Sorted by", the field and the direction sit on one line, like "Limited to".
