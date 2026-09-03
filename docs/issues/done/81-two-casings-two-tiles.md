# 81 — Two casings, two tiles

`A Sense Of Purpose` and `A Sense of Purpose` are two tiles in Releases, both In
Flames, sorted next to each other. `browse_groups` groups by the raw `key` and
`secondary` expressions but orders by them `COLLATE NOCASE`, so a pair differing
only in case is two groups printed side by side. 37 tiles in this library are
that: folding both keys takes it from 8,044 groups to 8,007.

Both keys, not just the album. `Wrath Of The Weak` / `Wrath of the Weak` splits
an album on the title; one pair is two casings of `ASP` on tracks with no album
tag at all.

The only part of the duplicate-tile problem that is a bug in the query rather
than a gap in the tags; the rest is [87](../upcoming/87-one-release-one-tile.md), which
folds this same collation into its identity expression either way round.

## The grouping

`browse_groups` in [query.rs](../../../src-tauri/src/db/query.rs) groups by
`{key}, {secondary}` and both gain `COLLATE NOCASE`. `key` and `secondary` stop
being bare grouping columns and become `min()` over the group, so the label is a
value SQLite picked rather than one it happened to leave on the row. `min()` is
a binary comparison, so the uppercase variant wins — arbitrary but stable, which
is what `groupId`'s React keys need. `min()` over a NULL group is still NULL, so
the untagged group keeps its NULL key and its `IS NULL`-first ordering.

`ORDER BY` moves onto those aggregates rather than the raw expressions, which
after the change no longer identify a row of the group.

Deciding a label, not a tag: the files keep whatever they carry.

## The drill-in

`scope` filters with `{key_sql} IS ?` (and `{GROUP_ARTIST} IS ?` for albums)
against the key the tile was labelled with. Folding the grouping alone would
open a tile and show only the tracks whose casing won `min()`. Both conditions
take `COLLATE NOCASE`, placed after the parameter the way `smart/mod.rs` already
writes `{column} = ? COLLATE NOCASE`.

## The lookup path

[79b](79b-online-release-lookup.md) keys off `(album, artist)` in two
places and both are downstream of a tile the user drilled into:

- `release_selections` orders by the two keys and folds consecutive rows with
  `==`. Unfolded, one release is searched twice at one request per second.
- `release_members` matches `{GROUP_ALBUM} IS ?1 AND {GROUP_ARTIST} IS ?2`.
  Unfolded, it is handed one casing and returns half the release — so
  `tagsource_apply`'s `with_identity` writes the MBIDs to that half only, which
  is the exact defect the release-wide write exists to prevent.

Both take the same collation. 82b's `release_lookup` inherits the folded
expressions when it lands.

## Not in scope

No migration, no network, no MBID. The grouping expressions are already
`nullif`/`coalesce` calls, so `idx_tracks_album` was never serving this query
and nothing regresses.

`NOCASE` is ASCII-only, so `Ä` and `ä` would stay two groups. This library has
no such pair, so ICU buys nothing here.

Testing: a seeded pair differing only in album case asserted to be one group,
and a pair differing only in artist case likewise; that group's label asserted
to be the uppercase variant; the drill-in on it asserted to return both casings'
tracks; the untagged group asserted unchanged, since `nullif` still runs before
the collation; `release_selections` over a mixed-case release asserted to be one
selection and `release_members` asserted to return every file of it.
