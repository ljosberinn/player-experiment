# 196 — A removal ends with its file

A tombstone in `removed_paths` outlives the file it was written for. Once the
file is deleted or renamed outside the app, the tombstone suppresses nothing,
but File ▸ Forget N Removed Songs still counts it.

## Fix

A scan drops every tombstone whose file is gone.

- `load_removed` keys each tombstone folded, to its path as stored. `plan`
  reports as `unseen`, as stored, the ones `on_disk` does not hold, outside
  `absent` roots.
- `scan_roots` drops an unseen one only when `try_exists` says `Ok(false)`, and
  never under a root that is not a directory: a Rescan passes no `absent`, and
  an unplugged drive keeps its removals. The disk check also covers tombstones
  outside every root (195) and folders the walk could not read.
- Deleted by the stored path, in the same transaction as `set_missing`.
  Nothing written when nothing is dropped (193).
- `ScanSummary.lapsed` counts them and is part of `changed()`, so the unattended
  pass announces a drop. The scan's log line gains `lapsed=`.
- `docs/knowledge/architecture.md`, `data-model.md`, `limitations.md`.

Accepted: a file renamed away and back between two scans comes back into the
library.

## Tests

In `scan/mod.rs`: a tombstone the walk did not find is unseen, one it found is
not, one under an absent root is not; a scan drops the tombstone whose file is
gone and reports `changed()`; one under a root that is not on disk stays
through a Rescan; one outside every root stays while its file exists and goes
once it is deleted.

## Verification

- Remove a song, delete its file, Rescan: the Forget entry's count drops by
  one, or the entry disappears.
- Remove a song on an external drive, unplug it, Rescan: the count stays.
