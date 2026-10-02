# 193 — A scan that changed nothing relinks nothing

`plays.resolve` is 950ms of a 1.5s no-op scan of the real library: it relinks
all 237k plays every time. `tag_values.rebuild` adds 110ms.

- `scan_roots` runs `plays::resolve` and `plays::count` only when its summary
  added, updated, marked missing or returned a row, or when
  `plays::is_resolved` is false. It runs `tag_values::rebuild` only when it
  added or updated a row; a missing file's tags stay in the vocabulary.
- The summary rather than the plan: a file that will not parse is planned on
  every pass and writes nothing.
- `resolve` sets `plays.resolved` (`settings::PLAYS_RESOLVED`) inside its
  savepoint. `plays::mark_unresolved` removes it, from `plays::record` and
  from `scan::mark_missing` and `scan::clear_missing` when they change a row:
  they can move a link, and the scan after them writes nothing.
- Absent on a library that predates it, which resolves on its next scan.
- A tag write's `resolve` is 197.
- `docs/knowledge/data-model.md`.

## Tests

In `scan/mod.rs`: an idle pass leaves a broken link alone; a library without
the marker resolves once; a local play of the other copy, and the player
marking a copy missing or back, move on the next idle pass; an unparseable
file does not make a pass relink.
