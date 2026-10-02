# 199 — A resolve that moves many plays is not quadratic

The first `resolve` over the real library after 195 moved 13,994 plays and
took 38s, 37s of it in the `losing` statements: correlated subqueries over
`temp.moved` by `old` and `new`, which had no index. `refold` v9 runs that
pass at launch on every library's first launch of the release that carries
195 (release PR #367).

- `temp.moved` is indexed on `(old, new)` and `new`; the exclusion of plays
  that arrived on a track asks `temp.moved` by `play_id` alone. A moved play
  that links to the track moved to it, so `new = t` is redundant.
- `UPDATE tracks … FROM temp.losing` reads `losing` and seeks `tracks`
  (`+l.id`), rather than scanning `tracks` when nothing moved.
- `tests/perf.rs`, `a_resolve_that_moves_many_plays_is_one_pass_over_them`:
  every fifth track goes missing behind a present copy, moving 13,333 plays;
  1.06B steps before, 8.0M after. The budget allows three reads of the log,
  as on any resolve.

## Verification

- First launch of a library on match fold 8: `plays.refold` finishes in
  seconds.
- Counts on songs whose plays moved to their album's copy (195) are
  unchanged.
