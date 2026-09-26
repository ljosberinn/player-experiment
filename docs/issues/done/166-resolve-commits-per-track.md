# 166 — `plays::resolve` commits once per track

Called bare - at the end of a scan and after both removals - `resolve`
inserted each track's key into `temp.play_keys` in autocommit mode: 10,005
commits over 10k tracks (`tests/perf.rs`). It now runs in a savepoint, as
`regroup` does; the tag write and the import already wrapped it in theirs.

## Verification

- `resolving_the_play_log_is_affordable_cold_and_cheap_warm` budgets one
  commit, the vanish scan ten (it measures eight).
