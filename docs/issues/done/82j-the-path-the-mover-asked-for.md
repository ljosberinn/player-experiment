# 82j — The row records the path the mover asked for, not the one it got

`move_release` renames to `target`, then writes `key(target)` into `tracks.path`.
Windows' `create_dir_all` will not re-case a directory that already exists, so a
file computed into `The Corpse of Rebirth` lands in `The Corpse Of Rebirth` and
the rename still reports success. The row names a path the tree does not carry.

The next `scan.watch` walks the real tree and reads the real spelling, which
`insert_track`'s `ON CONFLICT(path)` does not match:

```
2026-09-16T14:58:29Z scan.watch added=460 missing=460
2026-09-16T15:13:30Z scan.watch added=452 missing=452
2026-09-16T15:28:30Z scan.watch added=492 missing=492
2026-09-16T15:44:10Z scan.watch added=492 missing=492
```

Every sweep costs one generation of rows. 492 rows in the database are a present
row's path in another casing, and 1,580 more are earlier generations whose file
has since been renamed out from under them. This is the cost
[83b](83b-moving-one-release.md) wrote `UPDATE tracks SET path` in the
rename's transaction to avoid, routed around by a rename that did not go where it
said.

**The path the row carries has to be the path that exists.** `std::fs::metadata`
already runs on `target` for the `mtime` and `size`, so the spelling is asked
for at a call site that is already there. `canonicalize` answers it and returns
a `\\?\` path; every other row in `tracks` is a plain `D:\…`, so the prefix has
to come off before `key()` sees it.

Not sufficient on its own. The ideal is still built from the tags, so a row
holding the true spelling still fails `at_target` and the release is still
offered every sweep — [82i](82i-paths-compare-byte-exact.md) is what ends that.
This is what stops it costing two rows each time.

Testing: a release moved into a directory whose on-disk casing differs from the
one its tags compute, asserted to leave rows the scanner reads back without
adding or missing any.
