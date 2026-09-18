# 94 — A folder the case fold cannot see

Six releases are re-placed every 15 s, forever. From
`%APPDATA%\dev.ljosberinn.apex\main.log`, one sweep of 2,080 identical ones:

```text
2026-09-18T19:54:02Z ok  library.place   album=Lügenkabinett artist=Akrea status=moved files=11 covers=0 skipped=0 ms=19
2026-09-18T19:54:02Z ok  library.place   album=belle époque artist=FJØRT status=moved files=11 covers=0 skipped=0 ms=17
2026-09-18T19:54:02Z ok  library.place   album=Couleur artist=FJØRT status=moved files=13 covers=0 skipped=0 ms=17
2026-09-18T19:54:02Z ok  library.place   album=d'accord artist=FJØRT status=moved files=10 covers=0 skipped=0 ms=17
2026-09-18T19:54:02Z ok  library.place   album=Demontage artist=FJØRT status=moved files=6 covers=0 skipped=0 ms=15
2026-09-18T19:54:02Z ok  library.place   album=Kontakt artist=FJØRT status=moved files=13 covers=0 skipped=0 ms=17
```

`files=` is every file of the release, on every pass. Nothing on disk changes:
`D:\Library\Akrea\LÜGENKABINETT - 2010 - Album` has mtime `2026-09-17 12:26`,
untouched across all 2,080.

The three other releases in the same `placed=9` sweep are
[95](95-two-rips-swap-the-marker-forever.md), a different fault.

## Why

The tags compute `Lügenkabinett` and `FJØRT`; the folders on disk are
`LÜGENKABINETT` and `Fjørt`.

- [`layout::same`](../../../src-tauri/src/library/layout.rs#L179) is
  `eq_ignore_ascii_case`, so `Ü`/`ü` and `Ø`/`ø` are two paths.
  [`layout::fold`](../../../src-tauri/src/library/layout.rs#L189) folds the same
  way.
- NTFS folds them, so `create_dir_all` reuses the existing folder and the rename
  is a no-op on the same file.
- [`mover::landed_at`](../../../src-tauri/src/library/mover.rs#L467)
  canonicalizes and writes the filesystem's spelling back to `tracks.path` —
  the old casing, by design ([82j](82j-the-path-the-mover-asked-for.md)).
- [`survey::placed`](../../../src-tauri/src/library/survey.rs#L130) compares
  ASCII-only again next sweep. Loop.

[82i](82i-paths-compare-byte-exact.md) replaced a byte-exact compare with
this one to stop exactly this loop, and
[81](81-two-casings-two-tiles.md) records the ASCII limit as accepted. The
limit is the loop.

`tracks.path` is `COLLATE NOCASE`, which is ASCII too, so `owned_by_other` and
the `removed_paths` lifts carry the same blind spot.

## Shape

Fold the way the filesystem does. `to_lowercase` on both sides in
[`layout::same`](../../../src-tauri/src/library/layout.rs#L179) and
[`layout::fold`](../../../src-tauri/src/library/layout.rs#L189) covers every
name in this library and is a two-line change; full Unicode case folding is
not what NTFS does either.

`COLLATE NOCASE` cannot be taught this, so the SQL half stays ASCII. It only
has to agree with itself, and 81 already names the cost.

**No migration.** Rows hold the filesystem's spelling already; the compare is
what changes.

## Tests

- A release whose folder differs from its computed name only by `Ü`/`ü` reads as
  placed, and a sweep over it moves nothing.
- The same for `Ø`/`ø` in the artist folder.
- A release genuinely elsewhere still moves.
- A path differing by a real character, not a case, still reads as unplaced.

No screenshots — nothing visible changes.
