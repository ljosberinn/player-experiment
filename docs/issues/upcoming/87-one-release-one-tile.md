# 87 — One release, one tile

A release with several artists — a compilation, a split — shows up once per
artist. 356 titles in this library are in that state and they cost 1,364
duplicate tiles.

**[82b](82b-the-unattended-lookup-pass.md) is what fixes those, not this.** 332 of the 356
have no album artist on any track, and 82 writes one for every release above the
threshold: `Various Artists` for a compilation, the joint credit for a split. The
existing `(album, GROUP_ARTIST)` key then collapses them on its own, and keeps
apart the ~102 titles that are two unrelated albums sharing a name — `Above` by
two artists with twelve and fourteen tracks each, `Alice` with fourteen and
fifteen — which no grouping by title may ever merge.

What survives 82 is what this is for:

- **Two distinct releases landing on the same `(album, album_artist)`.** Two
  unrelated various-artists compilations with the same name are one tile after 82
  and there is nothing in the tags left to tell them apart.
- **A tile that stops falling apart.** Once identity is the release rather than
  the spelling of two tags, hand-editing an album artist, or a rescan of a file
  somebody retagged, no longer shatters a tile.

**It lands after 82, and the reason is measured.** Of the 4,356 tracks under
those 356 titles, 116 carry a MusicBrainz release MBID today and only 2 of the
356 titles carry one on every track. Grouping by the MBIDs already in the library
saves **zero** tiles. The identity is worth nothing until 82 has filled it in,
and by then 82 has also written the album artist.

**Release group, not release.** A release MBID is per pressing, so two rips of
the same album from different pressings would resolve to two of them and split a
tile that is one today. [79a](../done/79a-per-track-edits-and-the-release-mbid.md) carries
`MUSICBRAINZ_RELEASEGROUPID` (`ItemKey::MusicBrainzReleaseGroupId`) beside the
release MBID for this; every file measured carrying one carried the other, so the
coverage is the same and the identity is the right one.

**One identity expression, and `scope` gets smaller.**
`coalesce(tracks.release_group_mbid, album || U+001F || GROUP_ARTIST)` is what
the browse query groups by. `key` and `secondary` stop being the grouping columns
and become display aggregates over the group, `ORDER BY` moves to the aggregated
title, and the drill-in goes from two `IS ?` conditions to one against the same
expression. The two keys coexist in one column rather than in two code paths.

Mixed keys are the permanent state, not a transitional one: a file nobody ever
looks up never gets an MBID. 11 of the 356 titles are already mixed within a
single title.

**`secondary` needs a third state.** `None` means no artist at all; many artists
is not the same thing, and a merged compilation has to read `Various Artists`
rather than whichever of twelve sorted first. The row carries
`count(distinct GROUP_ARTIST)`; the label lives beside `unknownLabel` in
`browse.ts`, the way `Unknown Artist` already does. The database says how many
artists there are, not what to call them.

`min(cover_hash)` over a merged group picks one of twelve byte-different rips of
the same artwork. Deterministic, and no change.

**No smart-playlist exception.** `browse_groups` already runs through `scope`, so
a merged tile inside a playlist filtered to one artist shows that artist's track
count and drills into exactly those tracks. Nothing is hidden, so there is
nothing to switch off — and "the filter mentions an artist" is not definable
anyway across `Artist` against `AlbumArtist`, negation, and nesting under `Any`.

Migration adds the column; migrations are append-only, so it is whatever number
is next when this lands.

Testing: a fixture with both keys in one result — one release identified by MBID,
one falling back — asserted to produce one tile each; two releases sharing
`(title, "Various Artists")` with different release groups asserted to stay two;
two pressings sharing a release group asserted to be one; the drill-in asserted
on an MBID group and on a fallback group; the subtitle's three states.
