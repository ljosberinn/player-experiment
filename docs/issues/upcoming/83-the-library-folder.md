# 83 — The Library folder

Opt-in, off by default, configured in Settings: a root folder, and everything
added to the library is moved into it under a fixed layout.

```
Ukendt Kunstner/Forbandede Ungdom - 2014 - Album/11 - Englebarn.mp3
└ album artist  └ release      └ year └ type   └ track  └ title
```

- **Multi-disc prefixes the filename** — `2-07 - Title.mp3` — and only when the
  release has more than one disc. A subfolder per disc would split one release
  across two folders; 57,600 of 65,535 tracks have no disc number at all.
- **The track artist joins the filename only when it differs from the album
  artist** — `11 - Elffor - Kortirion Among The Trees.mp3`. On a compilation it
  is the one thing identifying the track; on a normal release it repeats the
  folder.
- **Missing fields get placeholder segments**: `Unknown Artist`, `Unknown
  Release`, `0000`, `00`, `Unknown Title`. A junk drawer under the root is
  visible; a list of skipped files somewhere is not. 416 tracks have no album,
  3,063 no year, 1,035 no track number, 125 no title.
- **Release type comes from MusicBrainz's primary type**, so
  [82b](82b-the-unattended-lookup-pass.md) runs before a file can be placed. A
  file that matched nothing keeps its own tags and is placed from them, with
  `Album` as the type. `ReleaseDetail` does not carry the primary type today;
  adding it is this phase's, the way the genre field is 82b's.
- **Cover art travels, nothing else does.** `cover`/`folder`/`front` `.jpg|.png`
  move into the release folder; `.nfo`, `.cue`, `.log`, `.m3u` stay. Source
  folders left empty are removed.

**`tracks.path` is the row's identity** — `ON CONFLICT(path)` in the scanner. A
move the scanner discovers is a new row plus an old row marked missing, which
costs the play count, `added_at` and every playlist the track was in. The
`UPDATE tracks SET path` commits in the **same transaction** as the rename, and
nothing about this feature may route through a rescan.

**Windows path rules are not optional here.** Titles in this library already
carry both offenders: `Addicts: Black Meddle Pt. 2` has a colon and
`Nachtmystium/Murmur` a slash. Each segment sanitizes `<>:"/\|?*` and control
characters, drops trailing dots and spaces, and avoids the reserved device
names. Segments also need a length cap: a compilation like "Looking for Europe:
The Neofolk Compendium" under a deep root can pass 260 characters even with the
verbatim prefix in play, and truncating a segment is better than a rename that
fails at the end of a four-hour run.

**Opting in late is a background task**, and it is the same shape as
[82b](82b-the-unattended-lookup-pass.md): a worker thread, cancellable,
resumable across a restart, and the second producer for
[82c](82c-the-review-queue-and-progress.md)'s sidebar progress readout. **Committed per
release** — a release is what the layout is built around, it is the unit the
lookup already resolved, and a half-moved release is the only state worth never
leaving behind. The resume point is which releases are done, not which files.

- **A rename across volumes fails**, so the fallback is copy, verify the size,
  delete. Interrupted mid-copy leaves a partial file at the target, which the
  next run overwrites because the release is not marked done.
- **A target that already exists** is a real collision, not a retry, once the
  release is keyed: suffix it rather than overwrite.
- **The Library root has to be a watch folder** or the moved files leave the
  library on the next scan.
- **The mover lifts the tombstone**
  [73](../done/73-remove-a-song-from-the-library.md) left on the source path,
  and does not write one for it: the row is following the file, not going.
