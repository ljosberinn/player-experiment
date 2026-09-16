# 82i — Paths compare byte-exact on a filesystem that folds case

`survey::at_target` is `actual == ideal` on `Path`, which on Windows compares
component bytes. The ideal is built from the tags; the actual is what the
directory is really called. `The Corpse of Rebirth` and `The Corpse Of Rebirth`
are one directory to NTFS and two paths here, so `placed` is false for that
release on every sweep, forever — the direction the doc comment on `placed`
already names as the one worth avoiding.

**67 releases are in that state.** Every sweep that reached them placed them
again — nine times each for the ones present through the whole log, `files=`
identical every time:

```
A Forest of Stars / The Corpse of Rebirth
  09-16 13:13  files=5 skipped=5  …  15:43  files=5 skipped=25
```

Case folds everywhere a release is keyed — `GROUP_ALBUM`, `GROUP_ARTIST`,
`idx_release_lookup_key`, `same_key`. It folds nowhere a path is:

- `survey::at_target`, and `collision_nth`'s comparison against
  `layout::suffixed` with it.
- `mover::owned_by_other`, `WHERE path = ?1`.
- `mover::place_file`'s `source == target` early-out, and `move_release`'s
  `target != source` before it.
- `tracks.path TEXT NOT NULL UNIQUE` in `schema`, which is what turns one file
  into two rows when the scanner reads the spelling the mover did not write.

**This is the one that stops the loop.** With the comparison folded,
`at_target` accepts the file where it actually sits and the release leaves the
survey. [82j](82j-the-path-the-mover-asked-for.md) and
[82k](82k-a-missing-row-claims-its-target.md) are what has been feeding it, and
neither of them stops it alone: the ideal comes from the tags, so a row holding
the true spelling still does not match it.

`NOCASE` is ASCII-only, the limit [81](../done/81-two-casings-two-tiles.md)
already records. A path differing by `Ä`/`ä` stays two paths; nothing in this
library does.

The migration rebuilds `tracks` with the unique constraint folded, and **492
rows collide under it** — a present row and the missing row the same file left
behind in another casing. It cannot rebuild around them, so the fold and the
merge are one migration: the surviving row is the present one, taking the
higher `play_count`, the earlier `added_at` and the playlist rows of the one it
absorbs. The 1,580 rows of earlier generations do not collide, and removing
them stays the user's gesture — they are what File ▸ Remove *n* Missing Songs
is for. Accepting any marker is itself too generous, which is
[82m](82m-a-marker-only-survives-while-held.md)'s.

Testing: a release whose directory sits under a different casing than its tags,
asserted placed and asserted to leave the survey; a second release sanitizing to
the same name asserted to still take a collision marker; the folded unique index
asserted to update rather than insert when the scanner reads a path back in
another casing.
