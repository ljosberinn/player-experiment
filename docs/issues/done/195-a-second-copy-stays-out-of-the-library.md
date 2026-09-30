# 195 — A second copy stays out of the library

*Abyss* (Chelsea Wolfe) had been in `D:\Library` since 2026-09-02: ids
13817–13827, 320 kbps, tagged and played. A second download of it landed in
`D:\dl` on 2026-09-30, also 320 kbps. The scan added it, and the pass filed it
beside the first copy as `NN - Title (2).mp3`:

```text
2026-09-30T12:01:18Z ok  scan.watch      added=56 ...
2026-09-30T12:06:20Z ok  library.place   album=Abyss artist=Chelsea Wolfe status=moved files=11 covers=0 skipped=0 ms=50
```

The mover treats album and artist as one release, so the new rows joined the
placed ones and `free_target` numbered them. [95](95-two-rips-swap-the-marker-forever.md)
keeps two rips of one release on purpose. The problem is only a copy that
arrives from outside the library.

## Shape

A **newcomer** is a present file outside the Library folder. Its
**incumbent** is the present row of the same release that holds the
newcomer's ideal path, with the same `match_key`, and a file on disk. A drop
lands inside the Library folder, so it is numbered as before. Held there, it
would sit in the library unlisted.

- **Newcomer has a higher bitrate: swap.** The incumbent's file moves into the
  newcomer's folder under its own name, or the first free ` (n)`. Its row is
  removed and tombstoned there, and 169 hands its plays and playlist places on.
  The newcomer then files as usual and takes the plain name.
- **Otherwise: hold.** The newcomer's row is removed and tombstoned where it
  is. The file stays, and no scan adds it back.

Each displacement commits before anything moves into the library. A swap
renames first, so a crash leaves a file where no row expects it rather than
overwriting one. `library.place` gains `held=` and `swapped=`.

Existing ` (n)` files inside the library are not touched.

## Tests

- A newcomer equal to its incumbent is held: its file stays, its row is gone,
  and its path is tombstoned. A second sweep does nothing.
- A better newcomer swaps: it takes the plain name and the incumbent's plays,
  and the incumbent's file sits tombstoned in the newcomer's folder.
- A swapped-out file whose name is taken in the newcomer's folder gets a ` (n)`.
- A newcomer whose `match_key` differs from the row at its target is still
  numbered.
- Two rips already in the target folder stay as they are, and so does a file
  inside the Library folder whose target a copy holds.

## Verification

- Put a copy of an album the library already has into a watch folder. After a
  sweep, the library shows it once, and the copy is still in the watch folder.
- Do the same with a higher-bitrate copy. It is in the library under the plain
  names, with the old copy's plays, and the old files are in the watch folder.
