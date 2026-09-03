# 72 — Cover art is 96% of the database

`library.sqlite3` is 1,186,648,064 bytes. `covers` is 1,145,844,662 of them.

| | |
| --- | --- |
| rows | 5,799, referenced by 55,781 of 65,535 tracks |
| PNG | 4,263 rows, 856 MB — 75% of the whole file on its own |
| JPEG | 1,520 rows, 232 MB |
| neither | 16 rows, 4.4 MB |
| avg / max | 193 KB / 9.9 MB |
| ≥ 1 MB | 124 rows, 291 MB |

Normalize in `db::covers::store`, which the scanner and the tag writer both
already go through: decode, fit inside **500×500** without upscaling, re-encode
JPEG q85. `image` is already a dependency with the two decoders and the encoder
this needs, and the palette comes off the image that decode already produced
rather than a second `image::load_from_memory`.

Measured over all 5,799 rows with `image` 0.25.10, Lanczos3, q85: **1,093 MB →
208 MB**, 81% off, avg 37 KB and p99 116 KB a row, at 6.1 ms a cover
single-threaded. Triangle instead of Lanczos3 is 208 → 202 MB and 1 ms a cover
cheaper; the sharper filter is worth more than either on the one image the user
looks at.

**500, not 200.** `.browse-cover` is 158px, `MAX_ZOOM` is 2 and Windows display
scaling stacks on top — roughly 474 device pixels at the top end, and the next
largest use is the editor's 120px. It is also exactly Cover Art Archive's
`-500`, so a cover fetched by [79b](../upcoming/79b-online-release-lookup.md) needs no
resample.

**The re-encode is the lever, not the resize.** 4,722 of the 5,799 rows (81%)
are already within 500px and still hold 529 MB — half the total — because they
are PNGs of a photograph. A downscale-only pass would leave most of the problem
in place.

**The hash stays the hash of the source bytes**, and only the payload is
normalized. `tags::read` computes it in the scan's parallel phase from the art
as embedded, so hashing the normalized bytes instead would mean `store` decodes
before it knows whether the row already exists: 55,781 decode-and-encodes on a
first scan instead of 5,799, all inside the serial write transactions. Keeping
the source hash keeps today's cheap path — an existing hash returns without
decoding anything — and costs `tracks.cover_hash` no rewrite, `tag_undo` no
dangling references, and the backfill no foreign-key dance. The column stops
describing its own bytes, which is the one thing the comment on it has to say.

**Keep the source bytes when the re-encode is not smaller.** 681 rows grow
otherwise, worst case 3.3 KB → 9.5 KB, for 4.6 MB against the 885 MB saved. Two
lines to make "stored art is never larger than what the file carries" true.

**Undo stops restoring artwork.** `tags::write::to_resolved` reads the stored
bytes back and writes them *into the mp3*, so after this it would bake a 500px
re-encode into the file. `cover` becomes `None` there — absent means leave alone
— and an edit that replaced or removed artwork is no longer undoable.
`TagSnapshot.cover_hash` keeps being written and stops being read. Goes in
[limitations](../../knowledge/limitations.md), and it frees `covers` from the
one thing that kept it unbounded.

**The backfill is a background thread, not a migration.** Migration 6 already
settled that decoding a library's worth of covers must not happen inside the
one transaction that runs before the window is shown, and 35 seconds of CPU is
what that would cost here. A named thread spawned from `lib.rs`'s setup beside
`Player::spawn`, silent throughout — the picture the user sees does not change,
so there is nothing to report and no `library://changed` — committing in chunks
of ~50 rows so a scan or a tag write is never behind it for long. Two `settings`
keys, no schema change: `covers.normalized` set once at the end, in the shape of
`PLAYLISTS_SEEDED`, and `covers.normalizedThrough` holding the last hash
finished so a run cut short by a quit resumes instead of re-encoding a
generation onto what it already did. `palette` is left alone; q85 does not move
three dominant colours.

**Then prune and VACUUM, in the same pass.** The 885 MB only leaves the file
after a VACUUM — the pages are merely free otherwise. Pruning covers no track
references is worth 123 KB today (one orphan row) and is about what comes next:
[73](73-remove-a-song-from-the-library.md) orphans a row per removal and
[79b](../upcoming/79b-online-release-lookup.md) fetches 8,045 covers. It is only safe because
nothing reads artwork back out any more.

**No migration**, so [73](73-remove-a-song-from-the-library.md) keeps migration
8.

**24 rows will not decode** and are left as they are rather than deleted;
`cover://` still serves them. They are exactly the rows with `palette IS NULL`,
which is what `store`'s extraction failing already records: one zero-byte row,
one four-byte row, four BMPs, two GIFs, and a dozen mislabelled or truncated
files from before `check_cover` existed.

A cover the user picks still reaches the mp3 at full resolution. `read_cover`
reads the file the edit names and never consults `covers`.

`cover://<hash>` answers `Cache-Control: immutable`, which the backfill makes
untrue once per row. A webview serving the old full-res bytes from its own cache
shows the same picture, so nothing is done about it.

## Tests

- `db::covers` — a 1200px PNG comes back as a JPEG within 500px under the
  source's own hash; a hash already present is not decoded again; a cover whose
  re-encode is larger is stored verbatim; an undecodable cover is stored
  verbatim and gains no palette.
- The backfill — resumes from the cursor rather than from the start, leaves
  `palette` and undecodable rows alone, sets the flag, and is a no-op on a
  second run.
- The prune — a cover no track references goes, a referenced one stays.
- `tags::write` — an undo leaves the file's artwork untouched.

No e2e screenshots: the seeded library carries no artwork, and at display size
the image is the one that was there before.

Before [79b](../upcoming/79b-online-release-lookup.md), not after — a lookup that fetches
8,045 covers into the old store doubles the number this issue exists to cut.
