# 82k — A removed file is not a free name

`free_target` calls a path free when no row owns it, and the module header
licenses what follows: "a path no row owns is the partial file an interrupted
copy left behind, and `rename` overwrites that for free."

`scan::remove_tracks` breaks that. It deletes the row, tombstones the path and
**leaves the file on disk**. A tombstoned path with a file behind it is a path
no row owns whose file is there on purpose, and the mover renames over it —
then `lift` deletes the tombstone that recorded the removal.

Remove a bad rip from the library, add a better one from another watch folder,
and placement computes the same target and destroys the original.

**A candidate is taken when a file is there and `removed_paths` holds it.** The
tombstone is the only thing that tells a file left on purpose from a partial
copy. Not the tombstone alone: one whose file is gone costs the release its
ideal name for nothing, and landing on it and lifting it is what keeps a later
scan from marking the row missing forever.

## What this issue asked for before

`AND missing_since IS NULL` on `owned_by_other`, so a row whose file is gone
stops holding a name. It cannot be done:

- `tracks.path` is `COLLATE NOCASE UNIQUE`. The move renames the file and then
  fails `UPDATE tracks SET path`, rolling the transaction back over a rename
  that already happened — a row pointing at a path its file left, which is the
  row-per-generation engine
  [82j](82j-the-path-the-mover-asked-for.md) just put out.
- `scan::mark_missing` marks a row from the player when a file will not open.
  A lock or a permission is not an absent file, and `rename` overwrites.
- The 1,580 stale rows are indistinguishable from an unplugged drive.
  [82m](../upcoming/82m-undoing-the-placement-loop.md) is where they are
  counted and where the user removes them; a sweep ignoring them decides that
  for them, unattended.

Testing: a release whose ideal holds a removed-but-present file, asserted to
take the marker and leave the file where it is; a release whose ideal is only
tombstoned, asserted to land on it.
