# 83a — Where a file goes

The layout as a pure function: a row's tags in, a relative path out. No
filesystem, no move, no setting — [83b](83b-moving-one-release.md) does that and
[83c](83c-turning-the-library-folder-on.md) turns it on. Alone because it is the
half that is decidable in a unit test, and because a wrong path is only cheap
before anything has been renamed 65,535 times.

```
Ukendt Kunstner/Forbandede Ungdom - 2014 - Album/11 - Englebarn.mp3
└ album artist  └ release      └ year └ type   └ track  └ title
```

## The two names come from the grid's own expressions

The top folder is `GROUP_ARTIST` in `db::query` —
`coalesce(nullif(album_artist, ''), nullif(artist, ''))` — and the release
folder is `GROUP_ALBUM`, `nullif(album, '')`. Not `album_artist` read straight
off the row: a release the grid draws as one tile has to be one folder, and the
tile is drawn from those two expressions. This is the same key
[82b](82b-the-unattended-lookup-pass.md) looks a release up by, so all three
phases agree on what a release is.

## The rules on top of it

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

## The release type comes from 82b

`Album` in the example is MusicBrainz's release-group primary type. It was going
to arrive here, the same way migration 8's two MBIDs did; it arrived in
[82b](82b-the-unattended-lookup-pass.md) instead, because that is the
phase that writes it and a column nothing writes is a column nothing can be
tested against. `tracks.release_type`, the `tags::read` fill from
`ItemKey::MusicBrainzReleaseType` and `primary-type` on `ReleaseGroup` are all
there already, so this phase only reads the column.

**A release with no type is `Album`.** It is what 8 of 10 releases are, and a
sixth placeholder segment would put `Unknown Type` in the name of most folders
in the library.

## Windows path rules are not optional here

Titles in this library already carry both offenders: `Addicts: Black Meddle
Pt. 2` has a colon and `Nachtmystium/Murmur` a slash. Each segment:

- Replaces `<>:"/\|?*` and control characters with `_`. Replaced rather than
  dropped — dropping turns `AC/DC` into `ACDC`, which is a different band.
- Drops trailing dots and spaces, which Windows silently strips on creation and
  then cannot address.
- Avoids the reserved device names, **extension included**: `NUL.mp3` is as
  reserved as `NUL`, and `Con` and `Aux` are real titles.

### The length cap is a budget, not a constant

There is no `longPathAware` manifest in `src-tauri`, and Rust's `std::fs` hands
paths to the wide Win32 API without adding a `\?\` prefix of its own, so **260
characters is the ceiling for every path this app builds**. A compilation like
"Looking for Europe: The Neofolk Compendium" under a deep root passes it, and
truncating a segment is better than a rename that fails at the end of a
four-hour run.

So the cap is computed from the root's own length rather than fixed: what is
left of 260 after the root, split across the three segments below it, filename
reserved first. Prefixing `\?\` ourselves was considered and declined — it
would let this phase write paths the user's own file manager, and every other
`std::fs` call in this codebase, cannot then open.

A truncated segment is cut hard, on a character boundary, with no ellipsis: a
truncated folder name is already visibly truncated, and a marker only spends
budget. Measured in UTF-16 units, which is what Windows counts a path in, so a
library of Nordic titles gets the budget it actually has. The two folders share
what the filename leaves, and the longer of the two pays first — one long
release title does not cut the artist above it to nothing. No segment goes below
eight characters, which is also why the reserved-name underscore can be appended
without re-checking the budget, and the extension is never what gets cut.

A root deep enough to leave no budget at all is floored rather than truncated to
nothing here; `has_path_budget` is what
[83c](83c-turning-the-library-folder-on.md) refuses such a root
with, at the picker.

Testing: table-driven, no filesystem. Both real offenders above; a title that is
a reserved name with an extension; a two-disc release asserted to prefix and a
one-disc release asserted not to; a track artist matching the album artist
asserted absent from the filename and a differing one asserted present; every
placeholder; and one path built under a root long enough to force the cut.
