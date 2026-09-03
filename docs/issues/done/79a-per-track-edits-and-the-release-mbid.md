# 79a — Per-track edits and the release MBIDs

A seam, like [10a](10a-lastfm-seam.md): nothing user-visible ships here.
It is what [79b](../upcoming/79b-online-release-lookup.md) writes through and what
[87](../upcoming/87-one-release-one-tile.md) groups by.

**`write::apply` takes one edit per track.** Today it is
`apply(conn, track_ids, &TagEdit, …)` — one edit over many files, which is
right for a bulk edit and cannot express a tracklist, where title, track number
and disc number differ per file. It becomes `&[(i64, TagEdit)]` under a single
`batch_id`, so undo restores a whole release in one step, with
`tag_values::rebuild` still running once at the end of the transaction. The bulk
editor becomes a caller that repeats one edit; its existing tests are the proof
that nothing changed for it.

**The release MBID is a tag, not a column.** `ItemKey::MusicBrainzReleaseId`
(`MUSICBRAINZ_ALBUMID`) read in `tags::read`, written in `write_file`, a
`TagEdit` field, and `tracks.release_mbid` as the cached projection every other
tag already has. A column the writer fills but `tags::read` does not is blank
again the next time a rescan re-adds the file — conventions calls the file the
source of truth, and this is the case that tests it. It is also what makes a
second lookup pass idempotent; without it the only identity a release has is its
title, which collides.

**And the release group MBID beside it**, `ItemKey::MusicBrainzReleaseGroupId`
(`MUSICBRAINZ_RELEASEGROUPID`), through the same three places. The two are not
interchangeable: the release MBID is per pressing, which is what re-lookup and
Cover Art Archive are keyed by, and the release group is the album across its
pressings, which is what [87](../upcoming/87-one-release-one-tile.md) has to group by or two
rips of one album become two tiles. Both or neither — of 600 files sampled from
this library, every one carrying either carried both, so a reader that takes one
and drops the other throws away identity it was handed.

- Migration adds both columns and an index on the release group. Migrations are
  append-only, so it is whatever number is next when this lands — not one this
  file can name.
- Absent still means leave alone: an edit that does not mention an MBID never
  clears one.
- No editor field. Nothing sets it until
  [79b](../upcoming/79b-online-release-lookup.md), which is the point of doing it first.

Testing: a per-track batch asserted to produce one undoable batch and to restore
all of it; both MBIDs round-tripped write → read → row; the bulk path asserted
unchanged against the tests already written for it.
