# 72 — Cover art is 96% of the database

`library.sqlite3` is 1.13 GB. `covers` is 1.09 GB of it.

| | |
| --- | --- |
| rows | 5,799 |
| bytes | 1,145,844,662 |
| PNG | 4,263 rows, 898 MB — 78% of the whole database on its own |
| avg / max | 198 KB / 10.4 MB |
| ≥ 1 MB | 133 rows, 314 MB |

Normalize in `db::covers::store`, which the scanner and the tag writer both
already go through: decode, fit inside **500×500** without upscaling, re-encode
JPEG q85, hash the *normalized* bytes. `image` is already a dependency with the
two decoders this needs, and the palette then comes off the smaller image.

**500, not 200.** `.browse-cover` is 158px, `MAX_ZOOM` is 2 and Windows display
scaling stacks on top — roughly 474 device pixels at the top end. It is also
exactly Cover Art Archive's `-500` thumbnail, so a cover fetched by [79](79-online-release-lookup.md)
needs no resample. Around 50 KB a row, ~290 MB, three quarters off.

**Undo stops restoring artwork.** `tags::write::to_resolved` reads the stored
bytes back and writes them *into the mp3*, so after this it would bake a
re-encode into the file. `cover` becomes `None` there — absent means leave alone
— and an edit that replaced artwork is no longer undoable. Goes in
[limitations](../../knowledge/limitations.md), and it frees `covers` from the
one thing that kept it unbounded: once nothing reads artwork back out, a
replaced row is dead weight, and a vacuum keeping only what `tracks` references
is safe. Do that vacuum here, in the same pass.

A cover the user picks still reaches the mp3 at full resolution. That path reads
the file it names and never consults `covers`.

Existing rows need a one-shot pass or nothing is recovered on a library that
already exists. Re-encoding changes the hash, so `tracks.cover_hash` moves in
the same transaction, and two originals that normalize to identical bytes
collapse to one row — which `INSERT OR IGNORE` already does.

Rows that will not decode are left alone rather than deleted; `cover://` still
serves them. They name themselves: `mime` holds `JPG`, `PNG`, `ima`,
`image/(null)`, `image/bmp`, `image/gif` and one zero-byte row, all from before
`check_cover` existed.

Before [79](79-online-release-lookup.md), not after — a lookup that fetches
8,045 covers into the old store doubles the number this issue exists to cut.
