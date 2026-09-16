# 82k — A missing row claims the target it no longer holds

`mover::owned_by_other` is `SELECT 1 FROM tracks WHERE path = ?1 AND id <> ?2`.
It does not ask whether that row still has a file. A row marked missing is one
whose file the scanner could not find, and it still makes `free_target` walk
past the ideal and hand back ` (n)`.

The module comment on `free_target` draws the distinction it needs — "a row
owning the path is a real collision, where a path no row owns is the partial
file an interrupted copy left behind" — and a row whose file is gone is neither.

**819 files in the library now carry a marker**, across 132 folders, one more
per sweep:

```
D:\Library\A Forest of Stars\The Corpse Of Rebirth - 2008 - Album\01 - God (5).mp3
```

`01 - God.mp3` was never taken by anything. Each sweep the previous generation's
row — missing since the scan after the move — held the ideal, so the stem got
the next number and the file was renamed for it.

**`AND missing_since IS NULL`.** A row with no file cannot collide with one.

The markers already written do not come off by themselves: `at_target` accepts a
marker deliberately, so a file at `(5)` reads as placed once
[82i](../done/82i-paths-compare-byte-exact.md) lands.
[82m](82m-undoing-the-placement-loop.md) takes them off.

Testing: a release whose ideal path is held by a missing row, asserted to move
to the ideal rather than beside it; a release whose ideal path is held by a
present row of another release, asserted to still take the marker.
