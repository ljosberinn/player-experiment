# 165 — A drill-in page reads the whole library

`scope()` filters a drill-in on `identity_sql() IS ? COLLATE NOCASE`, which no
index served, so the page, the totals and the release list of every artist,
album or genre drill-in were a full scan of `tracks` (9,999 rows for a 40-row
artist). Migration 20 indexes each identity expression under `NOCASE`.

## Verification

- `drilling_into_a_group_reads_only_the_group`: page, totals and releases of
  all three kinds scan nothing, within a budget per row of the group.
