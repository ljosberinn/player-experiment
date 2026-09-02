# 81 — One release, one tile

A release with several artists — a compilation, a split — shows up once per
artist. "...And In The Darkness Bind Them" is twelve tiles; Nachtmystium/Murmur
is two. In this library 357 titles are in that state and they cost 1,612
duplicate tiles.

The browse view groups by `(album, coalesce(album_artist, artist))`, and 59,189
of 65,535 tracks have no album artist, so the second key is the *track* artist
almost everywhere.

**Grouping by title alone is wrong**, and cheaply disproved: it merges "Demos"
by 3 Inches Of Blood with "Demos" by Tame Impala, "Liberation" by 1349 with
"Liberation" by March of Heroes, and seven unrelated records called "Demo".

**The directory cannot rescue it either.** Of those 357 titles, zero live in a
single folder — the library is filed `artist\album`, so a compilation is
physically duplicated once per artist.

So this needs the release MBID [79](79-online-release-lookup.md) stores. Group
by it where it is present, fall back to `(album, coalesce(album_artist, artist))`
where it is not, and the two keys have to coexist in `browse_groups`,
`BrowseGroup`, `BrowseFilter` and the drill-in clause at the same time — a
library where only some releases carry one is the normal case, both after
[79](79-online-release-lookup.md) and during
[82](82-lookup-runs-itself.md)'s first pass, not an edge one.

The tile's subtitle is the release's artist credit, so a merged tile reads
"Various Artists" rather than whichever of the twelve sorted first.

**Not inside a smart playlist filtered to an artist.** There, the point of the
view is that artist's tracks, and merging a split into a unit credited to
somebody else hides what was asked for. The browse query already takes the smart
filter as a clause on the same statement; merging is off whenever an artist
rule is in it.
